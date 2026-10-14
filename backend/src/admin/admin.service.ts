/**
 * Lógica del módulo de administración de plataforma (spec 006, FR-050/051).
 *
 * Decisión rectora (§1 del spec): el `platform_admin` opera **fuera de RLS de
 * tenant** por la conexión *owner* (`DbService.queryOwner`). Cada mutación se
 * escribe junto con su fila de `audit_log` en **una sola sentencia** (CTE con
 * `INSERT`/`UPDATE` + auditoría): o queda la mutación y su rastro, o no queda
 * ninguna de las dos. No hay un segundo mecanismo de autorización: el rol se
 * verifica en el controlador con `AuthGuard`.
 */

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { hash } from '@node-rs/argon2'
import { DbService } from '../db/db.service'
import type {
  AdminUserDto,
  AuditEntryDto,
  FiltroAuditInput,
  TenantDto,
} from './contract'

/** `23505` = unique_violation de PostgreSQL. */
function esViolacionUnica(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  )
}

@Injectable()
export class AdminService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /* -------------------------------------------------------- FR-050: tenant */

  /** Crea un tenant activo y registra `tenant_created` (atómico). */
  async crearTenant(name: string, slug: string, actorId: string): Promise<TenantDto> {
    try {
      const rows = await this.db.queryOwner<TenantDto>(
        `WITH creado AS (
           INSERT INTO tenant (id, name, slug)
           VALUES ($1, $2, $3)
           RETURNING id, name, slug, status, created_at
         ), auditado AS (
           INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
           SELECT $4, $5, creado.id, 'tenant_created', 'tenant', creado.id::text,
                  jsonb_build_object('name', creado.name, 'slug', creado.slug)
           FROM creado
         )
         SELECT id, name, slug, status, created_at FROM creado`,
        [randomUUID(), name, slug, randomUUID(), actorId],
      )
      return rows[0]
    } catch (error) {
      if (esViolacionUnica(error)) {
        throw new ConflictException(`El slug "${slug}" ya existe`)
      }
      throw error
    }
  }

  /**
   * Habilita o suspende un tenant. Al suspender revoca además todas sus
   * sesiones (`auth_session`), para que el corte de acceso sea inmediato en el
   * próximo refresh. Idempotente: fijar el estado vigente no escribe auditoría.
   */
  async cambiarEstado(
    tenantId: string,
    status: 'active' | 'suspended',
    actorId: string,
  ): Promise<{ tenant: TenantDto; changed: boolean }> {
    const actuales = await this.db.queryOwner<{ status: string }>(
      'SELECT status FROM tenant WHERE id = $1',
      [tenantId],
    )
    if (actuales.length === 0) {
      throw new NotFoundException('Tenant no encontrado')
    }
    if (actuales[0].status === status) {
      const rows = await this.db.queryOwner<TenantDto>(
        'SELECT id, name, slug, status, created_at FROM tenant WHERE id = $1',
        [tenantId],
      )
      return { tenant: rows[0], changed: false }
    }

    const accion = status === 'suspended' ? 'tenant_suspended' : 'tenant_reactivated'
    const rows = await this.db.queryOwner<TenantDto>(
      `WITH actualizado AS (
         UPDATE tenant SET status = $2
          WHERE id = $1 AND status <> $2
         RETURNING id, name, slug, status, created_at
       ), revocadas AS (
         UPDATE auth_session SET revoked_at = now()
          WHERE $2 = 'suspended' AND tenant_id = $1 AND revoked_at IS NULL
         RETURNING id
       ), auditado AS (
         INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
         SELECT $3, $4, actualizado.id, $5, 'tenant', actualizado.id::text,
                jsonb_build_object('status', actualizado.status) ||
                CASE WHEN $2 = 'suspended'
                     THEN jsonb_build_object('revoked_sessions', (SELECT count(*) FROM revocadas))
                     ELSE '{}'::jsonb END
         FROM actualizado
       )
       SELECT id, name, slug, status, created_at FROM actualizado`,
      [tenantId, status, randomUUID(), actorId, accion],
    )
    return { tenant: rows[0], changed: true }
  }

  /* ------------------------------------------------ FR-050: tenant_admin */

  /**
   * Asigna el `tenant_admin` inicial. Crea la cuenta si el email no existe en
   * el tenant; si existe con otro rol, lo promueve (`role_changed`); si ya es
   * `tenant_admin`, la operación es idempotente y no escribe auditoría.
   */
  async asignarAdmin(
    tenantId: string,
    input: { email: string; fullName: string; password: string },
    actorId: string,
  ): Promise<{ user: AdminUserDto; created: boolean; changed: boolean }> {
    const tenant = await this.db.queryOwner<{ id: string }>(
      'SELECT id FROM tenant WHERE id = $1',
      [tenantId],
    )
    if (tenant.length === 0) {
      throw new NotFoundException('Tenant no encontrado')
    }

    const existentes = await this.db.queryOwner<{ id: string; role: string }>(
      'SELECT id, role FROM app_user WHERE tenant_id = $1 AND email = $2',
      [tenantId, input.email],
    )

    if (existentes.length === 0) {
      const passwordHash = await hash(input.password)
      const rows = await this.db.queryOwner<AdminUserDto>(
        `WITH creado AS (
           INSERT INTO app_user (id, tenant_id, email, password_hash, role, full_name)
           VALUES ($1, $2, $3, $4, 'tenant_admin', $5)
           RETURNING id, tenant_id, email, full_name, role, is_active
         ), auditado AS (
           INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
           SELECT $6, $7, creado.tenant_id, 'tenant_admin_assigned', 'app_user', creado.id::text,
                  jsonb_build_object('tenant_id', creado.tenant_id, 'email', creado.email,
                                     'rol', 'tenant_admin')
           FROM creado
         )
         SELECT id, tenant_id, email, full_name, role, is_active FROM creado`,
        [randomUUID(), tenantId, input.email, passwordHash, input.fullName, randomUUID(), actorId],
      )
      return { user: rows[0], created: true, changed: false }
    }

    const existente = existentes[0]
    if (existente.role === 'tenant_admin') {
      const rows = await this.db.queryOwner<AdminUserDto>(
        'SELECT id, tenant_id, email, full_name, role, is_active FROM app_user WHERE id = $1',
        [existente.id],
      )
      return { user: rows[0], created: false, changed: false }
    }

    const rows = await this.db.queryOwner<AdminUserDto>(
      `WITH actualizado AS (
         UPDATE app_user SET role = 'tenant_admin', updated_at = now()
          WHERE id = $1 AND role <> 'tenant_admin'
         RETURNING id, tenant_id, email, full_name, role, is_active
       ), auditado AS (
         INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
         SELECT $2, $3, actualizado.tenant_id, 'role_changed', 'app_user', actualizado.id::text,
                jsonb_build_object('tenant_id', actualizado.tenant_id, 'from', $4::text, 'to', 'tenant_admin')
         FROM actualizado
       )
       SELECT id, tenant_id, email, full_name, role, is_active FROM actualizado`,
      [existente.id, randomUUID(), actorId, existente.role],
    )
    return { user: rows[0], created: false, changed: true }
  }

  /* --------------------------------------------------- FR-051: audit_log */

  /** Lectura filtrada del audit log, más reciente primero. No escribe auditoría. */
  async listarAudit(
    filtros: FiltroAuditInput,
  ): Promise<{ items: AuditEntryDto[]; limit: number; offset: number }> {
    const condiciones: string[] = []
    const params: unknown[] = []

    if (filtros.tenant) {
      params.push(filtros.tenant)
      condiciones.push(`tenant_id = $${params.length}`)
    }
    if (filtros.action) {
      params.push(filtros.action)
      condiciones.push(`action = $${params.length}`)
    }
    if (filtros.desde) {
      params.push(filtros.desde)
      condiciones.push(`occurred_at >= $${params.length}::timestamptz`)
    }
    if (filtros.hasta) {
      params.push(filtros.hasta)
      condiciones.push(`occurred_at <= $${params.length}::timestamptz`)
    }
    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : ''

    params.push(filtros.limit)
    const limitIdx = params.length
    params.push(filtros.offset)
    const offsetIdx = params.length

    const items = await this.db.queryOwner<AuditEntryDto>(
      `SELECT id, occurred_at, actor_id, tenant_id, action, entity_type, entity_id, payload
         FROM audit_log
         ${where}
        ORDER BY occurred_at DESC, id DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    )

    return { items, limit: filtros.limit, offset: filtros.offset }
  }
}
