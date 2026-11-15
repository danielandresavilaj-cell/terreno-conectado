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
 * Los roles de empresa ven su faena actual: es lo primero que alguien revisa
 * al tomar un equipo compartido (TSK-OFF-009). El `platform_admin` no opera en
 * una faena ni en una empresa: administra la plataforma, y el subtítulo dice
 * ese alcance global en vez de una faena que no le corresponde.
 */
export function subtituloEncabezado(u: Pick<Usuario, 'rol' | 'faena'>): string {
  if (u.rol === 'platform_admin') return ROL_LABEL.platform_admin
  return u.faena || '—'
}
