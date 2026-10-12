import { ForbiddenException } from '@nestjs/common'
import type { JwtClaims } from '../auth/auth.types'

/**
 * Autorización del dashboard (FR-035/044).
 *
 * Vive aparte de `DashboardService` porque ahora lo consumen dos servicios del
 * módulo (las consultas y la exportación de TSK-FORM-010) y la regla —el que
 * autoriza es el rol + tener tenant— no puede depender del servicio que la
 * escriba primero.
 */

/** El supervisor y el administrador del tenant; nadie más ve el dashboard. */
export const DASHBOARD_ROLES = ['supervisor', 'tenant_admin'] as const

/**
 * `platform_admin` no tiene tenant y por eso cae en el 403 de "Requerido un
 * tenant" antes que en el de rol: no es un rol de negocio del dashboard, es de
 * plataforma. `field_worker` recibe el 403 de rol y sólo ve su faena por otros
 * caminos (FR-006).
 */
export function exigirDashboard(u: JwtClaims, roles: readonly string[] = DASHBOARD_ROLES): void {
  if (!u.tenant_id) throw new ForbiddenException('Requerido un tenant')
  if (!roles.includes(u.rol)) throw new ForbiddenException('Rol no autorizado')
}
