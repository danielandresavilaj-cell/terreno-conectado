/* Nombres visibles de los roles canónicos (spec 001 §3). */
import type { Rol, Usuario } from './types'

export const ROL_LABEL: Record<Rol, string> = {
  field_worker: 'Trabajador de terreno',
  supervisor: 'Supervisor',
  tenant_admin: 'Administrador de empresa',
  platform_admin: 'Administrador de plataforma',
}

/** Roles que el administrador de una empresa puede asignar (TSK-ADM-001). */
export const ROLES_DE_EMPRESA: Rol[] = ['field_worker', 'supervisor', 'tenant_admin']

/**
 * Subtítulo bajo el nombre en el encabezado (TSK-ADM-004, #245).
 *
 * Quien captura (trabajador y supervisión) ve su faena actual: es lo primero
 * que alguien revisa al tomar un equipo compartido (TSK-OFF-009). Quien no
 * captura en una faena ve su alcance real en vez de la primera faena de la
 * lista: el `tenant_admin` administra toda su empresa y ve el nombre de la
 * empresa; el `platform_admin` administra la plataforma.
 */
export function subtituloEncabezado(u: Pick<Usuario, 'rol' | 'faena' | 'tenant'>): string {
  if (u.rol === 'platform_admin') return ROL_LABEL.platform_admin
  if (u.rol === 'tenant_admin') return u.tenant || ROL_LABEL.tenant_admin
  return u.faena || '—'
}
