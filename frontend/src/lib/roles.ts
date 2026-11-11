/* Nombres visibles de los roles canónicos (spec 001 §3). */
import type { Rol } from './types'

export const ROL_LABEL: Record<Rol, string> = {
  field_worker: 'Trabajador de terreno',
  supervisor: 'Supervisor',
  tenant_admin: 'Administrador de empresa',
  platform_admin: 'Administrador de plataforma',
}

/** Roles que el administrador de una empresa puede asignar (TSK-ADM-001). */
export const ROLES_DE_EMPRESA: Rol[] = ['field_worker', 'supervisor', 'tenant_admin']
