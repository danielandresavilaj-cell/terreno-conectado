/**
 * Ingesta idempotente por lotes — TSK-WS-007 (FR-020, FR-021, FR-024) y
 * resolución LWW — TSK-WS-009 (FR-023, Artículo III).
 *
 * Contrato: `POST /api/v1/sync/batch`. Garantías:
 *  · **Orden de dependencias (FR-020):** el lote se procesa agrupado en
 *    inspection → responses → findings → log_entries → attachments, sin importar
 *    el orden en que llegue.
 *  · **Idempotencia (FR-021):** reenviar un lote ya procesado no duplica ni
 *    altera filas (misma versión → `records_unchanged`). Reintentos de un
 *    registro PERDEDOR tampoco duplican el conflicto (dedupe contra el último
 *    par winner/loser: reintentos idempotentes, crecimiento acotado).
 *  · **LWW determinista (FR-023):** dos ediciones del mismo registro offline
 *    se resuelven por `captured_at` → `client_version` → mayor UUIDv7
 *    (plan §3.1): reproducible ante relojes desviados. El ganador se persiste
 *    y AMBAS versiones quedan en `CONFLICT_RECORD` (winner/loser payload),
 *    visibles para el supervisor — nunca sobrescritura silenciosa.
 *  · **Atomicidad:** aplicar el ganador Y auditar el conflicto ocurren en la
 *    MISMA transacción (`withTenantTransaction`): no existe ventana en que la
 *    fila cambie sin su registro de conflicto, ni conflicto sin su ganador.
 *  · **Cross-tenant (FR-025):** la validación es PREVIA a cualquier escritura:
 *    un registro con `tenant_id` distinto al JWT rechaza el lote completo y
 *    deja incidente en `audit_log` (defensa en profundidad sobre RLS).
 *  · **SYNC_LOG (FR-024):** cada lote abre una fila `pending` y la cierra con
 *    totales/estado y `finished_at`; `sync_log_id` enlaza cada conflicto al
 *    batch que lo detectó. `inspection.synced_at` entrega la latencia
 *    `captured_at → synced_at` (NFR-03/FR-040).
 *
 * Decisiones:
 *  · Escrituras vía `DbService.queryAsTenant`/`withTenantTransaction`
 *    (SET LOCAL + RLS): no existe camino de escritura que salte el tenant.
 *  · Referencias se validan contra filas del MISMO tenant (site/user), y
 *    referencias encontradas fuera del lote vía `SELECT` bajo RLS: el FK por
 *    sí solo comprobaría existencia, no tenancy.
 *  · Los bytes de la foto se escriben al volumen Docker (`SYNC_VOLUME`,
 *    data-model §2.2 V1) SOLO cuando la versión gana (nueva o por LWW); al
 *    perder, ni se escribe ni se dejan huérfanos. El payload de conflicto de
 *    un attachment omite `data` (los bytes ya viven en el volumen).
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
  ConflictRecordDto,
  ListConflictsResponse,
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
const MAX_CONFLICTS_VIEW = 100
/** Tamaño máximo serializado de `value_json` (forma híbrida FR-036, data-model §2.2). */
const MAX_VALUE_JSON = 16_384

/** Orden de dependencias fijo (FR-020, data-model §4.2). */
const BATCH_ORDER: SyncEntityType[] = [
  'inspection',
  'response',
  'finding',
  'log_entry',
  'attachment',
]

/** Roles que ven los conflictos (FR-023: el supervisor revisa, no es silencioso). */
const CONFLICT_VIEWER_ROLES = new Set(['supervisor', 'admin', 'admin_plataforma'])

const ENTITY_TYPES = new Set<SyncEntityType>(BATCH_ORDER)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INSPECTION_STATUSES = new Set(['draft', 'in_progress', 'submitted', 'reviewed'])
const OK_NOK_NA = new Set(['ok', 'nok', 'na'])
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])
const FINDING_STATUSES = new Set(['open', 'in_progress', 'resolved'])
const OWNER_TYPES = new Set(['inspection', 'finding', 'log_entry', 'response'])
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Ejecutor acotado a una transacción con tenant (sesgo RLS ya fijado). */
type Run = <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>

/** Fila existente de dominio + el par de autoridad de versión (en epoch ms). */
interface Version {
  captured_at_ms: number
  client_version: number
  id: string
}

type LwwDecision = 'incoming_wins' | 'existing_wins' | 'equal'

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

    // Abre el log ANTES de procesar: los conflictos enlazan su `sync_log_id`.
    const syncLogId = await this.beginSyncLog({
      tenantId,
      userId: claims.sub,
      deviceId: body.device_id,
      batchId: body.batch_id,
      total: records.length,
      startedAt,
    })

    const result = await this.process(tenantId, records, syncLogId)
    const finishedAt = new Date()
    const status: SyncBatchStatus =
      result.records_failed === 0
        ? 'ok'
        : result.records_ok > 0
          ? 'partial'
          : 'failed'

    await this.finishSyncLog(syncLogId, {
      tenantId,
      batchId: body.batch_id,
      ok: result.records_ok,
      failed: result.records_failed,
      status,
      finishedAt,
    })

    this.logger.log(
      `batch ${body.batch_id} tenant=${tenantId} device=${body.device_id} ` +
        `total=${result.records_total} ok=${result.records_ok} failed=${result.records_failed} ` +
        `unchanged=${result.records_unchanged} status=${status} ` +
        `ms=${finishedAt.getTime() - startedAt.getTime()}`,
    )

    return { batch_id: body.batch_id, status, ...result }
  }

  /**
   * `GET /api/v1/conflicts` — lectura para supervisor/admin (lo consume el
   * dashboard, TSK-WS-011). Ordenado por `resolved_at` DESC, paginado.
   */
  async listConflicts(
    claims: JwtClaims,
    query: { limit?: number; offset?: number },
  ): Promise<ListConflictsResponse> {
    if (!claims.tenant_id) {
      throw new ForbiddenException('Los conflictos requieren un rol con tenant')
    }
    if (!CONFLICT_VIEWER_ROLES.has(claims.rol)) {
      throw new ForbiddenException('Solo el supervisor o admin puede ver conflictos')
    }
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? 20), 1), MAX_CONFLICTS_VIEW)
    const offset = Math.max(Math.trunc(query.offset ?? 0), 0)

    const [items, totals] = await Promise.all([
      this.db.queryAsTenant<ConflictRecordDto>(
        claims.tenant_id,
        `SELECT id, entity_type, entity_id, winner_payload, loser_payload, resolution,
                resolved_at
         FROM conflict_record
         ORDER BY resolved_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.db.queryAsTenant<{ n: number }>(
        claims.tenant_id,
        'SELECT count(*)::int AS n FROM conflict_record',
      ),
    ])
    return { items, total: totals[0]?.n ?? 0 }
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
        // Forma híbrida (FR-036): string (date/time/select_single) o string[]
        // (select_multiple); ausente ≡ null. La validación contra template_item.props
        // es device-side antes de encolar (FR-039); acá sólo forma y tamaño.
        const vj = x.value_json
        if (vj !== undefined && vj !== null) {
          const esCadena = typeof vj === 'string'
          const esLista = Array.isArray(vj) && vj.every((v) => typeof v === 'string')
          if (!esCadena && !esLista) {
            throw new BadRequestException(`${at}.payload.value_json inválido (string | string[])`)
          }
          if (JSON.stringify(vj).length > MAX_VALUE_JSON) {
            throw new BadRequestException(
              `${at}.payload.value_json demasiado grande (máx. ${MAX_VALUE_JSON} caracteres)`,
            )
          }
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
    syncLogId: string | undefined,
  ): Promise<Omit<SyncBatchResponse, 'batch_id' | 'status'>> {
    const total = records.length
    let ok = 0
    let unchanged = 0
    let failed = 0
    const errors: string[] = []

    for (const entityType of BATCH_ORDER) {
      for (const rec of records.filter((r) => r.entity_type === entityType)) {
        try {
          const outcome = await this.applyRecord(tenantId, syncLogId, rec)
          ok += 1
          if (outcome === 'unchanged') unchanged += 1
        } catch (err) {
          failed += 1
          if (errors.length < MAX_ERRORS) {
            const message = msg(err)
            errors.push(`${rec.entity_type}:${rec.id}: ${message}`)
            this.logger.warn(`registro rechazado ${rec.entity_type}:${rec.id} — ${message}`)
          }
        }
      }
    }

    return {
      records_total: total,
      records_ok: ok,
      records_failed: failed,
      records_unchanged: unchanged,
      errors,
    }
  }

  private async applyRecord(
    tenantId: string,
    syncLogId: string | undefined,
    rec: SyncRecord,
  ): Promise<'applied' | 'unchanged'> {
    switch (rec.entity_type) {
      case 'inspection': {
        const p = rec.payload as unknown as SyncInspectionPayload
        return this.db.withTenantTransaction(tenantId, (run) =>
          this.applyAny(run, tenantId, syncLogId, rec, {
            table: 'inspection',
            refs: [
              ['site', p.site_id],
              ['app_user', p.executed_by],
            ],
            insertValues: () => [
              rec.id,
              tenantId,
              p.site_id,
              p.template_id,
              p.template_version,
              p.executed_by,
              p.status,
              rec.captured_at,
              rec.client_version,
            ],
            insertSql: `INSERT INTO inspection
              (id, tenant_id, site_id, template_id, template_version, executed_by,
               status, captured_at, client_version, synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
             RETURNING id`,
            updateSql: `UPDATE inspection SET
              site_id = $3, template_id = $4, template_version = $5, executed_by = $6,
              status = $7, captured_at = $8, client_version = $9,
              synced_at = now(), updated_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            updateValues: () => [
              rec.id,
              tenantId,
              p.site_id,
              p.template_id,
              p.template_version,
              p.executed_by,
              p.status,
              rec.captured_at,
              rec.client_version,
            ],
            payloadFrom: (r) => ({
              site_id: r.site_id,
              template_id: r.template_id,
              template_version: r.template_version,
              executed_by: r.executed_by,
              status: r.status,
            }),
          }),
        )
      }
      case 'response': {
        const p = rec.payload as unknown as SyncResponsePayload
        // node-postgres serializa los arrays JS como literal de array PG ({…}),
        // que no es jsonb: la forma híbrida va serializada (string | string[]).
        const valueJson = p.value_json == null ? null : JSON.stringify(p.value_json)
        return this.db.withTenantTransaction(tenantId, (run) =>
          this.applyAny(run, tenantId, syncLogId, rec, {
            table: 'inspection_response',
            refs: [['inspection', p.inspection_id]],
            insertValues: () => [
              rec.id,
              tenantId,
              p.inspection_id,
              p.template_item_id,
              p.value_ok,
              p.value_text,
              p.value_number,
              valueJson,
              rec.captured_at,
              rec.client_version,
            ],
            insertSql: `INSERT INTO inspection_response
              (id, tenant_id, inspection_id, template_item_id, value_ok, value_text,
               value_number, value_json, captured_at, client_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING id`,
            updateSql: `UPDATE inspection_response SET
              inspection_id = $3, template_item_id = $4, value_ok = $5, value_text = $6,
              value_number = $7, value_json = $8, captured_at = $9, client_version = $10,
              updated_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            updateValues: () => [
              rec.id,
              tenantId,
              p.inspection_id,
              p.template_item_id,
              p.value_ok,
              p.value_text,
              p.value_number,
              valueJson,
              rec.captured_at,
              rec.client_version,
            ],
            payloadFrom: (r) => ({
              inspection_id: r.inspection_id,
              template_item_id: r.template_item_id,
              value_ok: r.value_ok,
              value_text: r.value_text,
              value_number: r.value_number == null ? null : Number(r.value_number),
              value_json: r.value_json ?? null,
            }),
          }),
        )
      }
      case 'finding': {
        const p = rec.payload as unknown as SyncFindingPayload
        const refs: Array<[string, string]> = []
        if (p.inspection_id !== null) refs.push(['inspection', p.inspection_id])
        if (p.response_id !== null) refs.push(['inspection_response', p.response_id])
        return this.db.withTenantTransaction(tenantId, (run) =>
          this.applyAny(run, tenantId, syncLogId, rec, {
            table: 'finding',
            refs,
            insertValues: () => [
              rec.id,
              tenantId,
              p.inspection_id,
              p.response_id,
              p.severity,
              p.description,
              p.status,
              rec.captured_at,
              rec.client_version,
            ],
            insertSql: `INSERT INTO finding
              (id, tenant_id, inspection_id, response_id, severity, description, status,
               captured_at, client_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            updateSql: `UPDATE finding SET
              inspection_id = $3, response_id = $4, severity = $5, description = $6,
              status = $7, captured_at = $8, client_version = $9,
              updated_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            updateValues: () => [
              rec.id,
              tenantId,
              p.inspection_id,
              p.response_id,
              p.severity,
              p.description,
              p.status,
              rec.captured_at,
              rec.client_version,
            ],
            payloadFrom: (r) => ({
              inspection_id: r.inspection_id,
              response_id: r.response_id,
              severity: r.severity,
              description: r.description,
              status: r.status,
            }),
          }),
        )
      }
      case 'log_entry': {
        const p = rec.payload as unknown as SyncLogEntryPayload
        return this.db.withTenantTransaction(tenantId, (run) =>
          this.applyAny(run, tenantId, syncLogId, rec, {
            table: 'log_entry',
            refs: [
              ['site', p.site_id],
              ['app_user', p.author_id],
            ],
            insertValues: () => [
              rec.id,
              tenantId,
              p.site_id,
              p.author_id,
              p.entry_text,
              p.tags,
              p.shift_date,
              rec.captured_at,
              rec.client_version,
            ],
            insertSql: `INSERT INTO log_entry
              (id, tenant_id, site_id, author_id, entry_text, tags, shift_date,
               captured_at, client_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            updateSql: `UPDATE log_entry SET
              site_id = $3, author_id = $4, entry_text = $5, tags = $6, shift_date = $7,
              captured_at = $8, client_version = $9, updated_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            updateValues: () => [
              rec.id,
              tenantId,
              p.site_id,
              p.author_id,
              p.entry_text,
              p.tags,
              p.shift_date,
              rec.captured_at,
              rec.client_version,
            ],
            payloadFrom: (r) => ({
              site_id: r.site_id,
              author_id: r.author_id,
              entry_text: r.entry_text,
              tags: r.tags,
              shift_date: r.shift_date,
            }),
          }),
        )
      }
      case 'attachment': {
        const p = rec.payload as unknown as SyncAttachmentPayload
        const ownerTable = {
          inspection: 'inspection',
          finding: 'finding',
          log_entry: 'log_entry',
          response: 'inspection_response',
        } as const
        return this.db.withTenantTransaction(tenantId, async (run) => {
          await this.assertRefs(run, [[ownerTable[p.owner_type], p.owner_id]])
          const row = await this.selectExisting(run, 'attachment', rec.id)
          if (!row) {
            // Nuevo registro: se escribe la foto porque esta versión gana.
            const fileKey = await this.writeAttachmentFile(tenantId, rec.id, p)
            try {
              await run(
                `INSERT INTO attachment
                   (id, tenant_id, owner_type, owner_id, file_key, mime, bytes,
                    width, height, captured_at, client_version)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 RETURNING id`,
                [
                  rec.id,
                  tenantId,
                  p.owner_type,
                  p.owner_id,
                  fileKey,
                  p.mime,
                  p.bytes,
                  p.width,
                  p.height,
                  rec.captured_at,
                  rec.client_version,
                ],
              )
            } catch (err) {
              await this.removeAttachmentFile(fileKey)
              throw err
            }
            return 'applied'
          }

          const outcome = this.decideLww(row, rec)
          if (outcome === 'equal') return 'unchanged'
          await this.recordConflict(run, tenantId, syncLogId, rec, row, outcome)

          if (outcome === 'existing_wins') return 'unchanged'

          // Gana la versión entrante: foto nueva y limpieza de la anterior.
          const newKey = await this.writeAttachmentFile(tenantId, rec.id, p)
          try {
            await run(
              `UPDATE attachment SET
                 owner_type = $3, owner_id = $4, file_key = $5, mime = $6, bytes = $7,
                 width = $8, height = $9, captured_at = $10, client_version = $11,
                 updated_at = now()
               WHERE id = $1 AND tenant_id = $2`,
              [
                rec.id,
                tenantId,
                p.owner_type,
                p.owner_id,
                newKey,
                p.mime,
                p.bytes,
                p.width,
                p.height,
                rec.captured_at,
                rec.client_version,
              ],
            )
          } catch (err) {
            await this.removeAttachmentFile(newKey)
            throw err
          }
          await this.removeAttachmentFile(String(row.file_key)).catch(() => undefined)
          return 'applied'
        })
      }
    }
  }

  /**
   * Flujo común del LWW para tablas sin bytes (inspection/response/finding/log):
   * refs → cargar versión → decidir → (insertar / ganó entrante / perdió) →
   * cuando hay conflicto, persistir ganador + CONFLICT_RECORD en UNA transacción.
   */
  private async applyAny(
    run: Run,
    tenantId: string,
    syncLogId: string | undefined,
    rec: SyncRecord,
    spec: {
      table: string
      refs: Array<[string, string]>
      insertSql: string
      insertValues: () => unknown[]
      updateSql: string
      updateValues: () => unknown[]
      payloadFrom: (row: Record<string, unknown>) => Record<string, unknown>
    },
  ): Promise<'applied' | 'unchanged'> {
    await this.assertRefs(run, spec.refs)
    const row = await this.selectExisting(run, spec.table, rec.id)
    if (!row) {
      await run(spec.insertSql, spec.insertValues())
      return 'applied'
    }

    const outcome = this.decideLww(row, rec)
    if (outcome === 'equal') return 'unchanged'
    await this.recordConflict(run, tenantId, syncLogId, rec, row, outcome)

    if (outcome === 'existing_wins') return 'unchanged'

    await run(spec.updateSql, spec.updateValues())
    return 'applied'
  }

  /** Referencias dentro del MISMO tenant (RLS filtra; el FK no validaría tenancy). */
  private async assertRefs(run: Run, refs: Array<[string, string]>): Promise<void> {
    for (const [table, id] of refs) {
      const rows = await run<{ id: string }>(`SELECT id FROM ${table} WHERE id = $1`, [id])
      if (rows.length === 0) {
        throw new Error(`${table}:${id} ajeno al tenant o inexistente`)
      }
    }
  }

  private async selectExisting(
    run: Run,
    table: string,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const rows = await run<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = $1`, [id])
    return rows[0] ?? null
  }

  /* ------------------------------------------------------------ LWW */

  /**
   * Decisión determinista (plan §3.1, FR-023): gana quien tenga mayor
   * `captured_at`; si empatan, mayor `client_version`; si aún empatan, mayor
   * UUIDv7 (orden lexicográfico). Reproducible ante relojes desviados.
   *
   * `captured_at` se compara en EPOCH ms (nunca vía `String(Date)`, que pierde
   * los milisegundos): la comparación es estable entre el ISO cliente y el
   * `timestamptz` de Postgres.
   */
  private decideLww(row: Record<string, unknown>, rec: SyncRecord): LwwDecision {
    const existing: Version = {
      captured_at_ms: Number(new Date(row.captured_at as string | Date).getTime()),
      client_version: Number(row.client_version),
      id: rec.id,
    }
    const incoming: Version = {
      captured_at_ms: Date.parse(rec.captured_at),
      client_version: rec.client_version,
      id: rec.id,
    }
    if (existing.captured_at_ms === incoming.captured_at_ms && existing.client_version === incoming.client_version) {
      return 'equal'
    }
    return this.lwwWins(incoming, existing) ? 'incoming_wins' : 'existing_wins'
  }

  /** `true` si `a` gana a `b` según el orden del tie-breaker. */
  private lwwWins(a: Version, b: Version): boolean {
    if (a.captured_at_ms !== b.captured_at_ms) return a.captured_at_ms > b.captured_at_ms
    if (a.client_version !== b.client_version) return a.client_version > b.client_version
    return a.id > b.id
  }

  /** Conserva AMBAS versiones (Artículo III) en la misma transacción del ganador. */
  private async recordConflict(
    run: Run,
    tenantId: string,
    syncLogId: string | undefined,
    rec: SyncRecord,
    row: Record<string, unknown>,
    outcome: Exclude<LwwDecision, 'equal'>,
  ): Promise<void> {
    const winnerPayload = outcome === 'incoming_wins' ? this.conflictPayload(rec) : this.payloadFromRow(row, rec.entity_type)
    const loserPayload = outcome === 'incoming_wins' ? this.payloadFromRow(row, rec.entity_type) : this.conflictPayload(rec)

    // Reintento idempotente: el MISMO par winner/loser para el MISMO registro
    // no se vuelve a auditar (replays de un registro perdedor no crecen el log).
    const dupes = await run<{ id: string }>(
      `SELECT id FROM conflict_record
        WHERE tenant_id = $1 AND entity_id = $2
          AND winner_payload = $3::jsonb AND loser_payload = $4::jsonb
        LIMIT 1`,
      [tenantId, rec.id, JSON.stringify(winnerPayload), JSON.stringify(loserPayload)],
    )
    if (dupes.length > 0) return

    await run(
      `INSERT INTO conflict_record
         (id, tenant_id, entity_type, entity_id, winner_payload, loser_payload,
          resolution, resolved_at, sync_log_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'lww', now(), $7)`,
      [
        randomUUID(),
        tenantId,
        rec.entity_type,
        rec.id,
        JSON.stringify(winnerPayload),
        JSON.stringify(loserPayload),
        syncLogId ?? null,
      ],
    )
  }

  /**
   * Payload del registro entrante tal como se audita: el contrato, pero sin
   * `data` en attachments (los bytes viven en el volumen, data-model §2.2).
   */
  private conflictPayload(rec: SyncRecord): Record<string, unknown> {
    if (rec.entity_type === 'attachment') {
      const rest: Record<string, unknown> = {
        ...(rec.payload as unknown as SyncAttachmentPayload),
      }
      delete rest['data']
      return rest
    }
    return rec.payload as unknown as Record<string, unknown>
  }

  /** Payload reconstruido desde la fila persistida (para el perdedor/ganador DB). */
  private payloadFromRow(row: Record<string, unknown>, entityType: SyncEntityType): Record<string, unknown> {
    switch (entityType) {
      case 'inspection':
        return {
          site_id: row.site_id,
          template_id: row.template_id,
          template_version: row.template_version,
          executed_by: row.executed_by,
          status: row.status,
        }
      case 'response':
        return {
          inspection_id: row.inspection_id,
          template_item_id: row.template_item_id,
          value_ok: row.value_ok,
          value_text: row.value_text,
          value_number: row.value_number == null ? null : Number(row.value_number),
          value_json: row.value_json ?? null,
        }
      case 'finding':
        return {
          inspection_id: row.inspection_id,
          response_id: row.response_id,
          severity: row.severity,
          description: row.description,
          status: row.status,
        }
      case 'log_entry':
        return {
          site_id: row.site_id,
          author_id: row.author_id,
          entry_text: row.entry_text,
          tags: row.tags,
          shift_date: row.shift_date,
        }
      case 'attachment':
        return {
          owner_type: row.owner_type,
          owner_id: row.owner_id,
          mime: row.mime,
          bytes: row.bytes,
          width: row.width,
          height: row.height,
        }
    }
  }

  /* -------------------------------------------------------- volúmen foto */

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

  /** Borra bytes huérfanos (regresa la versión que perdió tras un LWW). */
  private async removeAttachmentFile(fileKey: string): Promise<void> {
    const volume = resolve(
      this.config.get<string>('SYNC_VOLUME') ?? join(process.cwd(), '.vol'),
    )
    await unlink(join(volume, fileKey))
  }

  /* ------------------------------------------------------------ auditoría */

  /** Abre el log del lote (estado `pending`): da `sync_log_id` a los conflictos. */
  private async beginSyncLog(entry: {
    tenantId: string
    userId: string
    deviceId: string
    batchId: string
    total: number
    startedAt: Date
  }): Promise<string | undefined> {
    try {
      const rows = await this.db.queryAsTenant<{ id: string }>(
        entry.tenantId,
        `INSERT INTO sync_log
           (id, tenant_id, user_id, device_id, batch_id, records_total,
            records_ok, records_failed, started_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, 'pending')
         RETURNING id`,
        [
          randomUUID(),
          entry.tenantId,
          entry.userId,
          entry.deviceId,
          entry.batchId,
          entry.total,
          entry.startedAt,
        ],
      )
      return rows[0]?.id
    } catch (err) {
      // El log no debe tumbar la ingesta: el lote igual se procesa.
      this.logger.error(`no se pudo abrir sync_log del batch ${entry.batchId}: ${msg(err)}`)
      return undefined
    }
  }

  /** Cierra el log con totales/estado y `finished_at`. El log jamás se borra. */
  private async finishSyncLog(
    syncLogId: string | undefined,
    entry: {
      tenantId: string
      batchId: string
      ok: number
      failed: number
      status: SyncBatchStatus
      finishedAt: Date
    },
  ): Promise<void> {
    if (!syncLogId) return
    try {
      await this.db.queryAsTenant(
        entry.tenantId,
        `UPDATE sync_log
           SET records_ok = $2, records_failed = $3, status = $4, finished_at = $5
         WHERE id = $1`,
        [syncLogId, entry.ok, entry.failed, entry.status, entry.finishedAt],
      )
    } catch (err) {
      this.logger.error(`no se pudo cerrar sync_log del batch ${entry.batchId}: ${msg(err)}`)
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