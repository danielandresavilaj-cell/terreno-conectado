import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { hash } from '@node-rs/argon2'
import { randomUUID } from 'node:crypto'
import { DbService } from '../db/db.service'
import type { FaenaDto, RolEmpresa, UsuarioDto } from './contract'

type Run = <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>

const COLUMNAS_USUARIO =
  'id, email, full_name, role, is_active, must_change_password, created_at'

/**
 * Administración de la empresa (TSK-ADM-001): cuentas y faenas del tenant del
 * `tenant_admin` que llama. Todo corre en `withTenantTransaction` (RLS), así
 * que una fila de otra empresa simplemente no existe para estas consultas.
 * Cada cambio queda en `audit_log` en la MISMA transacción.
 */
@Injectable()
export class UsersService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /* ----------------------------------------------------------- usuarios */

  listar(tenantId: string): Promise<UsuarioDto[]> {
    return this.db.queryAsTenant<UsuarioDto>(
      tenantId,
      `SELECT ${COLUMNAS_USUARIO},
              COALESCE((SELECT array_agg(us.site_id ORDER BY us.site_id) FROM user_site us
                         WHERE us.user_id = app_user.id), '{}') AS faena_ids
         FROM app_user ORDER BY is_active DESC, full_name`,
    )
  }

  async crear(
    tenantId: string,
    actorId: string,
    input: { email: string; full_name: string; role: RolEmpresa; password: string },
  ): Promise<UsuarioDto> {
    const passwordHash = await hash(input.password)
    try {
      return await this.db.withTenantTransaction(tenantId, async (run) => {
        const rows = await run<UsuarioDto>(
          `INSERT INTO app_user (id, tenant_id, email, password_hash, role, full_name, must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           RETURNING ${COLUMNAS_USUARIO}`,
          [randomUUID(), tenantId, input.email, passwordHash, input.role, input.full_name],
        )
        await auditar(run, actorId, tenantId, 'user_created', 'app_user', rows[0].id, {
          email: input.email,
          role: input.role,
        })
        return rows[0]
      })
    } catch (error) {
      if (esViolacionUnica(error)) {
        throw new ConflictException('Ya existe una cuenta con ese correo en tu empresa')
      }
      throw error
    }
  }

  async actualizar(
    tenantId: string,
    actorId: string,
    id: string,
    cambios: { full_name?: string; role?: RolEmpresa; is_active?: boolean },
  ): Promise<UsuarioDto> {
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const actual = (
        await run<UsuarioDto>(`SELECT ${COLUMNAS_USUARIO} FROM app_user WHERE id = $1 FOR UPDATE`, [id])
      )[0]
      if (!actual) throw new NotFoundException('Usuario no encontrado')

      const pierdeAdmin =
        actual.role === 'tenant_admin' &&
        actual.is_active &&
        ((cambios.role !== undefined && cambios.role !== 'tenant_admin') || cambios.is_active === false)
      if (id === actorId && pierdeAdmin) {
        throw new BadRequestException('No puedes desactivarte ni quitarte el rol de administrador')
      }
      if (pierdeAdmin) {
        const otros = await run<{ n: number }>(
          `SELECT count(*)::int AS n FROM app_user
            WHERE role = 'tenant_admin' AND is_active AND id <> $1`,
          [id],
        )
        if ((otros[0]?.n ?? 0) === 0) {
          throw new BadRequestException('La empresa debe conservar al menos un administrador activo')
        }
      }

      const rows = await run<UsuarioDto>(
        `UPDATE app_user
            SET full_name = COALESCE($2, full_name),
                role = COALESCE($3, role),
                is_active = COALESCE($4, is_active),
                updated_at = now()
          WHERE id = $1
          RETURNING ${COLUMNAS_USUARIO}`,
        [id, cambios.full_name ?? null, cambios.role ?? null, cambios.is_active ?? null],
      )
      if (cambios.is_active === false || (cambios.role && cambios.role !== actual.role)) {
        // Desactivar o cambiar el rol corta las sesiones vigentes: el rol viaja
        // en el token y no debe sobrevivir con permisos viejos.
        await revocarSesiones(run, id)
      }
      await auditar(run, actorId, tenantId, 'user_updated', 'app_user', id, {
        antes: { full_name: actual.full_name, role: actual.role, is_active: actual.is_active },
        cambios,
      })
      return rows[0]
    })
  }

  /**
   * TSK-ADM-003 (FR-065): reemplaza las faenas en que puede capturar una cuenta.
   * Lista vacía = todas las faenas de la empresa. Todo con la conexión del
   * tenant (RLS): una cuenta o faena de otra empresa no existe para esta
   * consulta. Queda `user_sites_updated` en audit_log con antes y después.
   */
  async asignarFaenas(
    tenantId: string,
    actorId: string,
    id: string,
    faenaIds: string[],
  ): Promise<{ id: string; faena_ids: string[] }> {
    const unicas = [...new Set(faenaIds)].sort()
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const [cuenta] = await run<{ id: string }>('SELECT id FROM app_user WHERE id = $1 FOR UPDATE', [id])
      if (!cuenta) throw new NotFoundException('Usuario no encontrado')
      if (unicas.length > 0) {
        const [existen] = await run<{ n: number }>('SELECT count(*)::int AS n FROM site WHERE id = ANY($1::uuid[])', [
          unicas,
        ])
        if ((existen?.n ?? 0) !== unicas.length) throw new BadRequestException('Alguna faena no existe en tu empresa')
      }
      const antes = (
        await run<{ site_id: string }>('SELECT site_id FROM user_site WHERE user_id = $1 ORDER BY site_id', [id])
      ).map((r) => r.site_id)
      await run('DELETE FROM user_site WHERE user_id = $1', [id])
      for (const siteId of unicas) {
        await run('INSERT INTO user_site (tenant_id, user_id, site_id, created_by) VALUES ($1, $2, $3, $4)', [
          tenantId,
          id,
          siteId,
          actorId,
        ])
      }
      await auditar(run, actorId, tenantId, 'user_sites_updated', 'app_user', id, { antes, despues: unicas })
      return { id, faena_ids: unicas }
    })
  }

  async resetearClave(
    tenantId: string,
    actorId: string,
    id: string,
    password: string,
  ): Promise<UsuarioDto> {
    const passwordHash = await hash(password)
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const rows = await run<UsuarioDto>(
        `UPDATE app_user
            SET password_hash = $2, must_change_password = true,
                failed_login_count = 0, locked_until = NULL, updated_at = now()
          WHERE id = $1
          RETURNING ${COLUMNAS_USUARIO}`,
        [id, passwordHash],
      )
      if (!rows[0]) throw new NotFoundException('Usuario no encontrado')
      await revocarSesiones(run, id)
      await auditar(run, actorId, tenantId, 'password_reset', 'app_user', id, {})
      return rows[0]
    })
  }

  /* ------------------------------------------------------------- faenas */

  async crearFaena(
    tenantId: string,
    actorId: string,
    input: { name: string; kind: FaenaDto['kind'] },
  ): Promise<FaenaDto> {
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const rows = await run<FaenaDto>(
        'INSERT INTO site (id, tenant_id, name, kind) VALUES ($1, $2, $3, $4) RETURNING id, name, kind',
        [randomUUID(), tenantId, input.name, input.kind],
      )
      await auditar(run, actorId, tenantId, 'site_created', 'site', rows[0].id, input)
      return rows[0]
    })
  }

  async actualizarFaena(
    tenantId: string,
    actorId: string,
    id: string,
    cambios: { name?: string; kind?: FaenaDto['kind'] },
  ): Promise<FaenaDto> {
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const rows = await run<FaenaDto>(
        `UPDATE site SET name = COALESCE($2, name), kind = COALESCE($3, kind)
          WHERE id = $1 RETURNING id, name, kind`,
        [id, cambios.name ?? null, cambios.kind ?? null],
      )
      if (!rows[0]) throw new NotFoundException('Faena no encontrada')
      await auditar(run, actorId, tenantId, 'site_updated', 'site', id, cambios)
      return rows[0]
    })
  }
}

async function auditar(
  run: Run,
  actorId: string,
  tenantId: string,
  action: string,
  entityType: string,
  entityId: string,
  payload: unknown,
): Promise<void> {
  await run(
    `INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), actorId, tenantId, action, entityType, entityId, JSON.stringify(payload)],
  )
}

async function revocarSesiones(run: Run, userId: string): Promise<void> {
  await run('UPDATE auth_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
    userId,
  ])
}

function esViolacionUnica(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
}
