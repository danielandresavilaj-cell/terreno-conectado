/**
 * Ingesta idempotente por lotes — TSK-WS-007 (FR-020, FR-021, FR-024).
 *
 * Contrato: `POST /api/v1/sync/batch`. Garantías:
 *  · **Orden de dependencias (FR-020):** el lote se procesa agrupado en
 *    inspection → responses → findings → log_entries → attachments, sin importar
 *    el orden en que llegue.
 *  · **Idempotencia (FR-021):** cada registro hace
 *    `INSERT … ON CONFLICT (id) DO UPDATE … WHERE excluded.client_version > t`.
 *    Reenviar un lote ya procesado no duplica ni altera filas (se reporta
 *    `records_unchanged`).
 *  · **Cross-tenant (FR-025):** la validación es PREVIA a cualquier escritura:
 *    un registro con `tenant_id` distinto al JWT rechaza el lote completo y
 *    deja incidente en `audit_log` (defensa en profundidad sobre RLS).
 *  · **SYNC_LOG (FR-024):** cada intento deja fila con totales, estado y
 *    `started_at/finished_at`; `inspection.synced_at` entrega la latencia
 *    `captured_at → synced_at` (NFR-03/FR-040).
 *
 * Decisiones:
 *  · Escrituras vía `DbService.queryAsTenant` (SET LOCAL + RLS): no existe
 *    camino de escritura que salte el tenant de la sesión.
 *  · Referencias se validan contra las filas del MISMO tenant (site/user) para
 *    impedir que un registro apunte a un sitio de otra empresa: el FK por sí
 *    solo comprobaría existencia, no tenancy.
 *  · Los bytes de la foto se escriben al volumen Docker (`SYNC_VOLUME`,
 *    data-model §2.2 V1) como archivo `sync/<tenant>/<uuid>.<ext>`; evolución
 *    a S3 documentada en research.md §6.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DbService } from '../db/db.service'
import type { JwtClaims } from '../auth/auth.types'
import type {
  SyncAttachmentPayload,
  SyncBatchRequest,
  SyncBatchResponse,
  SyncBatchStatus,
  SyncEntityType,
  SyncFindingPayload,
  SyncInspectionPayload,
  SyncLogEntryPayload,
  SyncRecord,
  SyncResponsePayload,
} from './sync.types'

const MAX_RECORDS = 500
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
const MAX_ERRORS = 5

/** Orden de dependencias fijo (FR-020, data-model §4.2). */
const BATCH_ORDER: SyncEntityType[] = [
  'inspection',
  'response',
  'finding',
  'log_entry',
  'attachment',
]

const ENTITY_TYPES = new Set<SyncEntityType>(BATCH_ORDER)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INSPECTION_STATUSES = new Set(['draft', 'in_progress', 'submitted', 'reviewed'])
const OK_NOK_NA = new Set(['ok', 'nok', 'na'])
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])
const FINDING_STATUSES = new Set(['open', 'in_progress', 'resolved'])
const OWNER_TYPES = new Set(['inspection', 'finding', 'log_entry'])
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name)

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async batch(claims: JwtClaims, body: SyncBatchRequest): Promise<SyncBatchResponse> {
    const tenantId = claims.tenant_id
    if (!tenantId) throw new ForbiddenException('La sincronización requiere un rol de tenant')

    const records = await this.validate(body, tenantId, claims)
    const startedAt = new Date()
    const result = await this.process(tenantId, records)
    const finishedAt = new Date()

    const status: SyncBatchStatus =
      result.records_failed === 0
        ? 'ok'
        : result.records_ok > 0
          ? 'partial'
          : 'failed'

    await this.writeSyncLog({
      tenantId,
      userId: claims.sub,
      deviceId: body.device_id,
      batchId: body.batch_id,
      startedAt,
      finishedAt,
      total: result.records_total,
      ok: result.records_ok,
      failed: result.records_failed,
      status,
    })

    this.logger.log(
      `batch ${body.batch_id} tenant=${tenantId} device=${body.device_id} ` +
        `total=${result.records_total} ok=${result.records_ok} failed=${result.records_failed} ` +
        `unchanged=${result.records_unchanged} status=${status} ` +
        `ms=${finishedAt.getTime() - startedAt.getTime()}`,
    )

    return { batch_id: body.batch_id, status, ...result }
  }

  /* --------------------------------------------------------- validación */

  /**
   * Valida TODO el lote antes de escribir nada. El rechazo por cruce de tenant
   * es pre-escritura por diseño: el lote se descarta completo (FR-025).
   */
  private async validate(
    body: SyncBatchRequest,
    tenantId: string,
    claims: JwtClaims,
  ): Promise<SyncRecord[]> {
    if (!body || typeof body !== 'object') throw new BadRequestException('Cuerpo inválido')
    this.assertUuid(body.batch_id, 'batch_id')
    this.assertUuid(body.device_id, 'device_id')

    const records = body.records
    if (!Array.isArray(records) || records.length === 0) {
      throw new BadRequestException('records vacío')
    }
    if (records.length > MAX_RECORDS) {
      throw new BadRequestException(`Lote demasiado grande (máx. ${MAX_RECORDS} registros)`)
    }

    const foreignTenants = new Set<string>()
    for (const [i, rec] of records.entries()) {
      const at = `records[${i}]`
      if (!rec || typeof rec !== 'object') throw new BadRequestException(`${at} inválido`)
      if (!ENTITY_TYPES.has(rec.entity_type)) {
        throw new BadRequestException(`${at}.entity_type inválido: ${String(rec.entity_type)}`)
      }
      this.assertUuid(rec.id, `${at}.id`)
      this.assertUuid(rec.tenant_id, `${at}.tenant_id`)
      if (rec.tenant_id !== tenantId) foreignTenants.add(rec.tenant_id)
      if (!Number.isInteger(rec.client_version) || rec.client_version < 0) {
        throw new BadRequestException(`${at}.client_version debe ser un entero ≥ 0`)
      }
      if (typeof rec.captured_at !== 'string' || Number.isNaN(Date.parse(rec.captured_at))) {
        throw new BadRequestException(`${at}.captured_at inválido`)
      }
      this.validatePayload(rec, at)
    }

    if (foreignTenants.size > 0) {
      await this.auditTenantMismatch(claims, body, [...foreignTenants])
      throw new ConflictException('Lote rechazado: registros de un tenant distinto al del JWT')
    }

    return records
  }

  private validatePayload(rec: SyncRecord, at: string): void {
    const p: unknown = rec.payload
    if (typeof p !== 'object' || p === null) throw new BadRequestException(`${at}.payload inválido`)

    switch (rec.entity_type) {
      case 'inspection': {
        const x = p as unknown as SyncInspectionPayload
        this.assertUuid(x.site_id, `${at}.payload.site_id`)
        this.assertUuid(x.template_id, `${at}.payload.template_id`)
        if (!Number.isInteger(x.template_version) || x.template_version < 1) {
          throw new BadRequestException(`${at}.payload.template_version inválido`)
        }
        this.assertUuid(x.executed_by, `${at}.payload.executed_by`)
        if (!INSPECTION_STATUSES.has(x.status)) {
          throw new BadRequestException(`${at}.payload.status inválido`)
        }
        break
      }
      case 'response': {
        const x = p as unknown as SyncResponsePayload
        this.assertUuid(x.inspection_id, `${at}.payload.inspection_id`)
        this.assertUuid(x.template_item_id, `${at}.payload.template_item_id`)
        if (x.value_ok !== null && !OK_NOK_NA.has(x.value_ok)) {
          throw new BadRequestException(`${at}.payload.value_ok inválido`)
        }
        if (x.value_text !== null && typeof x.value_text !== 'string') {
          throw new BadRequestException(`${at}.payload.value_text inválido`)
        }
        if (x.value_number !== null && typeof x.value_number !== 'number') {
          throw new BadRequestException(`${at}.payload.value_number inválido`)
        }
        break
      }
      case 'finding': {
        const x = p as unknown as SyncFindingPayload
        if (x.inspection_id !== null) this.assertUuid(x.inspection_id, `${at}.payload.inspection_id`)
        if (x.response_id !== null) this.assertUuid(x.response_id, `${at}.payload.response_id`)
        if (!SEVERITIES.has(x.severity)) {
          throw new BadRequestException(`${at}.payload.severity inválido`)
        }
        if (typeof x.description !== 'string' || x.description.trim().length === 0) {
          throw new BadRequestException(`${at}.payload.description vacío`)
        }
        if (!FINDING_STATUSES.has(x.status)) {
          throw new BadRequestException(`${at}.payload.status inválido`)
        }
        break
      }
      case 'log_entry': {
        const x = p as unknown as SyncLogEntryPayload
        this.assertUuid(x.site_id, `${at}.payload.site_id`)
        this.assertUuid(x.author_id, `${at}.payload.author_id`)
        if (typeof x.entry_text !== 'string' || x.entry_text.trim().length === 0) {
          throw new BadRequestException(`${at}.payload.entry_text vacío`)
        }
        if (!Array.isArray(x.tags) || x.tags.some((t) => typeof t !== 'string')) {
          throw new BadRequestException(`${at}.payload.tags inválido`)
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(x.shift_date)) {
          throw new BadRequestException(`${at}.payload.shift_date inválido (YYYY-MM-DD)`)
        }
        break
      }
      case 'attachment': {
        const x = p as unknown as SyncAttachmentPayload
        if (!OWNER_TYPES.has(x.owner_type)) {
          throw new BadRequestException(`${at}.payload.owner_type inválido`)
        }
        this.assertUuid(x.owner_id, `${at}.payload.owner_id`)
        if (!MIME_EXT[x.mime]) {
          throw new BadRequestException(`${at}.payload.mime no soportado: ${String(x.mime)}`)
        }
        if (!Number.isInteger(x.bytes) || x.bytes < 1 || x.bytes > MAX_ATTACHMENT_BYTES) {
          throw new BadRequestException(
            `${at}.payload.bytes fuera de rango (1..${MAX_ATTACHMENT_BYTES})`,
          )
        }
        if (!Number.isInteger(x.width) || x.width < 1 || !Number.isInteger(x.height) || x.height < 1) {
          throw new BadRequestException(`${at}.payload.width/height inválidos`)
        }
        if (typeof x.data !== 'string' || x.data.length === 0) {
          throw new BadRequestException(`${at}.payload.data requerido (base64, V1 volumen Docker)`)
        }
        break
      }
    }
  }

  private assertUuid(value: unknown, field: string): void {
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
      throw new BadRequestException(`${field} debe ser un UUID`)
    }
  }

  /* ------------------------------------------------------------ proceso */

  private async process(
    tenantId: string,
    records: SyncRecord[],
  ): Promise<Omit<SyncBatchResponse, 'batch_id' | 'status'>> {
    // Referencias deben pertenecer al MISMO tenant (más allá del FK).
    const [siteIds, userIds] = await Promise.all([
      this.pluck(tenantId, 'site'),
      this.pluck(tenantId, 'app_user'),
    ])

    const total = records.length
    let ok = 0
    let unchanged = 0
    let failed = 0
    const errors: string[] = []

    for (const entityType of BATCH_ORDER) {
      for (const rec of records.filter((r) => r.entity_type === entityType)) {
        try {
          const outcome = await this.applyRecord(tenantId, rec, siteIds, userIds)
          ok += 1
          if (outcome === 'unchanged') unchanged += 1
        } catch (err) {
          failed += 1
          if (errors.length < MAX_ERRORS) {
            const msg = err instanceof Error ? err.message : String(err)
            errors.push(`${rec.entity_type}:${rec.id}: ${msg}`)
          }
          this.logger.warn(`registro rechazado ${rec.entity_type}:${rec.id} — ${msg(err)}`)
        }
      }
    }

    return { records_total: total, records_ok: ok, records_failed: failed, records_unchanged: unchanged, errors }
  }

  private async applyRecord(
    tenantId: string,
    rec: SyncRecord,
    siteIds: Set<string>,
    userIds: Set<string>,
  ): Promise<'applied' | 'unchanged'> {
    const upsert = async (sql: string, values: unknown[]): Promise<boolean> => {
      const rows = await this.db.queryAsTenant<{ id: string }>(tenantId, sql, values)
      return rows.length > 0
    }

    switch (rec.entity_type) {
      case 'inspection': {
        const p = rec.payload as unknown as SyncInspectionPayload
        if (!siteIds.has(p.site_id)) throw new Error('site_id ajeno al tenant o inexistente')
        if (!userIds.has(p.executed_by)) throw new Error('executed_by ajeno al tenant o inexistente')
        const applied = await upsert(
          `INSERT INTO inspection
             (id, tenant_id, site_id, template_id, template_version, executed_by, status,
              captured_at, synced_at, client_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
           ON CONFLICT (id) DO UPDATE SET
             site_id = excluded.site_id,
             template_id = excluded.template_id,
             template_version = excluded.template_version,
             executed_by = excluded.executed_by,
             status = excluded.status,
             captured_at = excluded.captured_at,
             client_version = excluded.client_version,
             synced_at = now(),
             updated_at = now()
           WHERE excluded.client_version > inspection.client_version
           RETURNING id`,
          [rec.id, tenantId, p.site_id, p.template_id, p.template_version, p.executed_by, p.status, rec.captured_at, rec.client_version],
        )
        return applied ? 'applied' : 'unchanged'
      }
      case 'response': {
        const p = rec.payload as unknown as SyncResponsePayload
        if (!(await this.existsInTenant(tenantId, 'inspection', p.inspection_id))) {
          throw new Error('inspection_id ajeno al tenant o inexistente')
        }
        const applied = await upsert(
          `INSERT INTO inspection_response
             (id, inspection_id, template_item_id, tenant_id, value_ok, value_text, value_number,
              captured_at, client_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             inspection_id = excluded.inspection_id,
             template_item_id = excluded.template_item_id,
             value_ok = excluded.value_ok,
             value_text = excluded.value_text,
             value_number = excluded.value_number,
             captured_at = excluded.captured_at,
             client_version = excluded.client_version,
             updated_at = now()
           WHERE excluded.client_version > inspection_response.client_version
           RETURNING id`,
          [rec.id, p.inspection_id, p.template_item_id, tenantId, p.value_ok, p.value_text, p.value_number, rec.captured_at, rec.client_version],
        )
        return applied ? 'applied' : 'unchanged'
      }
      case 'finding': {
        const p = rec.payload as unknown as SyncFindingPayload
        if (p.inspection_id !== null && !(await this.existsInTenant(tenantId, 'inspection', p.inspection_id))) {
          throw new Error('inspection_id ajeno al tenant o inexistente')
        }
        if (p.response_id !== null && !(await this.existsInTenant(tenantId, 'inspection_response', p.response_id))) {
          throw new Error('response_id ajeno al tenant o inexistente')
        }
        const applied = await upsert(
          `INSERT INTO finding
             (id, inspection_id, response_id, tenant_id, severity, description, status,
              captured_at, client_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             inspection_id = excluded.inspection_id,
             response_id = excluded.response_id,
             severity = excluded.severity,
             description = excluded.description,
             status = excluded.status,
             captured_at = excluded.captured_at,
             client_version = excluded.client_version,
             updated_at = now()
           WHERE excluded.client_version > finding.client_version
           RETURNING id`,
          [rec.id, p.inspection_id, p.response_id, tenantId, p.severity, p.description, p.status, rec.captured_at, rec.client_version],
        )
        return applied ? 'applied' : 'unchanged'
      }
      case 'log_entry': {
        const p = rec.payload as unknown as SyncLogEntryPayload
        if (!siteIds.has(p.site_id)) throw new Error('site_id ajeno al tenant o inexistente')
        if (!userIds.has(p.author_id)) throw new Error('author_id ajeno al tenant o inexistente')
        const applied = await upsert(
          `INSERT INTO log_entry
             (id, site_id, author_id, tenant_id, entry_text, tags, shift_date,
              captured_at, client_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             entry_text = excluded.entry_text,
             tags = excluded.tags,
             shift_date = excluded.shift_date,
             captured_at = excluded.captured_at,
             client_version = excluded.client_version,
             updated_at = now()
           WHERE excluded.client_version > log_entry.client_version
           RETURNING id`,
          [rec.id, p.site_id, p.author_id, tenantId, p.entry_text, p.tags, p.shift_date, rec.captured_at, rec.client_version],
        )
        return applied ? 'applied' : 'unchanged'
      }
      case 'attachment': {
        const p = rec.payload as unknown as SyncAttachmentPayload
        const ownerTable = { inspection: 'inspection', finding: 'finding', log_entry: 'log_entry' } as const
        if (!(await this.existsInTenant(tenantId, ownerTable[p.owner_type], p.owner_id))) {
          throw new Error('owner_id ajeno al tenant o inexistente')
        }
        const fileKey = await this.writeAttachmentFile(tenantId, rec.id, p)
        let applied: boolean
        try {
          applied = await upsert(
            `INSERT INTO attachment
               (id, tenant_id, owner_type, owner_id, file_key, mime, bytes, width, height,
                captured_at, client_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (id) DO UPDATE SET
               owner_type = excluded.owner_type,
               owner_id = excluded.owner_id,
               file_key = excluded.file_key,
               mime = excluded.mime,
               bytes = excluded.bytes,
               width = excluded.width,
               height = excluded.height,
               captured_at = excluded.captured_at,
               client_version = excluded.client_version,
               updated_at = now()
             WHERE excluded.client_version > attachment.client_version
             RETURNING id`,
            [rec.id, tenantId, p.owner_type, p.owner_id, fileKey, p.mime, p.bytes, p.width, p.height, rec.captured_at, rec.client_version],
          )
        } catch (err) {
          // No dejar bytes huérfanos si la fila no se pudo persistir.
          await unlink(
            join(
              resolve(this.config.get<string>('SYNC_VOLUME') ?? join(process.cwd(), '.vol')),
              fileKey,
            ),
          ).catch(() => undefined)
          throw err
        }
        return applied ? 'applied' : 'unchanged'
      }
    }
  }

  /** Bytes base64 → volumen Docker (data-model §2.2 V1). Devuelve la `file_key`. */
  private async writeAttachmentFile(
    tenantId: string,
    id: string,
    p: SyncAttachmentPayload,
  ): Promise<string> {
    const buf = Buffer.from(p.data as string, 'base64')
    if (buf.length !== p.bytes) {
      throw new Error(`bytes no coincide con el base64 (${buf.length} ≠ ${p.bytes})`)
    }
    const volume = resolve(
      this.config.get<string>('SYNC_VOLUME') ?? join(process.cwd(), '.vol'),
    )
    const key = `sync/${tenantId}/${id}.${MIME_EXT[p.mime]}`
    const path = join(volume, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, buf)
    return key
  }

  /** ids de una tabla dentro del tenant (referencias permitidas). */
  private async pluck(tenantId: string, table: 'site' | 'app_user'): Promise<Set<string>> {
    const rows = await this.db.queryAsTenant<{ id: string }>(
      tenantId,
      `SELECT id FROM ${table} WHERE tenant_id = $1`,
      [tenantId],
    )
    return new Set(rows.map((r) => r.id))
  }

  /**
   * Existe la fila Y pertenece al tenant: bajo `queryAsTenant` el filtro RLS ya
   * hace deny si el registro es de otra empresa — el FK de Postgres por sí solo
   * sólo comprobaría existencia, no tenancy (evita enlaces cross-tenant).
   */
  private async existsInTenant(
    tenantId: string,
    table: 'inspection' | 'inspection_response' | 'finding' | 'log_entry',
    id: string,
  ): Promise<boolean> {
    const rows = await this.db.queryAsTenant<{ id: string }>(
      tenantId,
      `SELECT id FROM ${table} WHERE id = $1`,
      [id],
    )
    return rows.length > 0
  }

  /* ------------------------------------------------------------ auditoría */

  private async writeSyncLog(entry: {
    tenantId: string
    userId: string
    deviceId: string
    batchId: string
    startedAt: Date
    finishedAt: Date
    total: number
    ok: number
    failed: number
    status: SyncBatchStatus
  }): Promise<void> {
    try {
      await this.db.queryAsTenant(
        entry.tenantId,
        `INSERT INTO sync_log
           (id, tenant_id, user_id, device_id, batch_id, records_total, records_ok,
            records_failed, started_at, finished_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          randomUUID(),
          entry.tenantId,
          entry.userId,
          entry.deviceId,
          entry.batchId,
          entry.total,
          entry.ok,
          entry.failed,
          entry.startedAt,
          entry.finishedAt,
          entry.status,
        ],
      )
    } catch (err) {
      // El log no debe tumbar la ingesta: el lote ya fue procesado.
      this.logger.error(`no se pudo escribir sync_log para batch ${entry.batchId}: ${msg(err)}`)
    }
  }

  /** FR-025/FR-051: incidente append-only antes de rechazar el lote. */
  private async auditTenantMismatch(
    claims: JwtClaims,
    body: SyncBatchRequest,
    foreignTenantIds: string[],
  ): Promise<void> {
    try {
      await this.db.queryOwner(
        `INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
         VALUES ($1, $2, NULL, $3, $4, $5, $6)`,
        [
          randomUUID(),
          claims.sub,
          'sync_tenant_mismatch',
          'sync_batch',
          body.batch_id,
          JSON.stringify({
            jwt_tenant_id: claims.tenant_id,
            foreign_tenant_ids: foreignTenantIds,
            device_id: body.device_id,
          }),
        ],
      )
    } catch (err) {
      this.logger.error(`no se pudo auditar cruce de tenant del batch ${body.batch_id}: ${msg(err)}`)
    }
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}