/**
 * Contratos del módulo de administración de plataforma (spec 006, FR-050/051).
 *
 * Validación Zod de entradas HTTP (ADR-001) y tipos de salida. Los esquemas
 * viven en `backend/src/admin/` y no en `shared/`: son contratos de la consola
 * de plataforma, no de la PWA, y `shared/` es zona del módulo de sincronización.
 */

import { z } from 'zod'

/** UUID canónico (mismo formato que usa el backend para los ids). */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function esFecha(v: string): boolean {
  return !Number.isNaN(Date.parse(v))
}

/** `POST /admin/tenants` — crear tenant (FR-050). */
export const crearTenantSchema = z.object({
  name: z
    .string({ required_error: 'name es requerido' })
    .trim()
    .min(1, 'name no puede ir vacío')
    .max(120, 'name supera los 120 caracteres'),
  slug: z
    .string({ required_error: 'slug es requerido' })
    .trim()
    .toLowerCase()
    .min(3, 'slug debe tener al menos 3 caracteres')
    .max(50, 'slug supera los 50 caracteres')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug inválido: solo minúsculas, dígitos y guiones'),
})

/** `PATCH /admin/tenants/:id` — habilitar/suspender (FR-050). */
export const cambiarEstadoSchema = z.object({
  status: z.enum(['active', 'suspended']),
})

/** `POST /admin/tenants/:id/admins` — asignar el `tenant_admin` inicial (FR-050). */
export const asignarAdminSchema = z.object({
  email: z
    .string({ required_error: 'email es requerido' })
    .trim()
    .toLowerCase()
    .email('email inválido')
    .max(254, 'email supera los 254 caracteres'),
  full_name: z
    .string({ required_error: 'full_name es requerido' })
    .trim()
    .min(1, 'full_name no puede ir vacío')
    .max(120, 'full_name supera los 120 caracteres'),
  // Solo se aplica al crear la cuenta; al promover a un usuario existente se
  // ignora (no se resetea una credencial en uso).
  password: z
    .string({ required_error: 'password es requerido' })
    .min(12, 'password debe tener al menos 12 caracteres')
    .max(200, 'password supera los 200 caracteres'),
})

/** `GET /admin/audit-log` — filtros de lectura (FR-051). */
export const filtroAuditSchema = z.object({
  tenant: z.string().regex(UUID_RE, 'tenant debe ser un UUID').optional(),
  action: z.string().trim().min(1).max(60).optional(),
  desde: z.string().trim().refine(esFecha, 'desde debe ser una fecha ISO-8601').optional(),
  hasta: z.string().trim().refine(esFecha, 'hasta debe ser una fecha ISO-8601').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export type CrearTenantInput = z.infer<typeof crearTenantSchema>
export type CambiarEstadoInput = z.infer<typeof cambiarEstadoSchema>
export type AsignarAdminInput = z.infer<typeof asignarAdminSchema>
export type FiltroAuditInput = z.infer<typeof filtroAuditSchema>

/** Tenant devuelto por la API admin. */
export interface TenantDto {
  id: string
  name: string
  slug: string
  status: 'active' | 'suspended'
  created_at: string
}

/** Usuario (tenant_admin) devuelto por la API admin. */
export interface AdminUserDto {
  id: string
  tenant_id: string
  email: string
  full_name: string
  role: string
  is_active: boolean
}

/** Fila de `audit_log`. */
export interface AuditEntryDto {
  id: string
  occurred_at: string
  actor_id: string | null
  tenant_id: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  payload: unknown
}
