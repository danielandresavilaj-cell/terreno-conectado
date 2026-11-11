/**
 * Contratos de la administración de la empresa (TSK-ADM-001, Enmienda 003).
 *
 * El `tenant_admin` gestiona las cuentas y las faenas de SU empresa. Todo pasa
 * por la conexión de la app con `app.tenant_id` fijado (RLS): no existe camino
 * para tocar otra empresa aunque se adivine un id.
 */
import { z } from 'zod'
import { MIN_PASSWORD_LENGTH } from '../auth/auth.types'

export const ROLES_EMPRESA = ['field_worker', 'supervisor', 'tenant_admin'] as const
export type RolEmpresa = (typeof ROLES_EMPRESA)[number]

const email = z
  .string({ required_error: 'email es requerido' })
  .trim()
  .toLowerCase()
  .email('email inválido')
  .max(254, 'email supera los 254 caracteres')

const nombre = z
  .string({ required_error: 'full_name es requerido' })
  .trim()
  .min(1, 'full_name no puede ir vacío')
  .max(120, 'full_name supera los 120 caracteres')

/** Clave temporal: el usuario está obligado a cambiarla al primer ingreso. */
const claveTemporal = z
  .string({ required_error: 'password es requerido' })
  .min(MIN_PASSWORD_LENGTH, `password debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`)
  .max(200, 'password supera los 200 caracteres')

export const crearUsuarioSchema = z.object({
  email,
  full_name: nombre,
  role: z.enum(ROLES_EMPRESA),
  password: claveTemporal,
})

export const actualizarUsuarioSchema = z
  .object({
    full_name: nombre.optional(),
    role: z.enum(ROLES_EMPRESA).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'nada que actualizar')

export const resetClaveSchema = z.object({ password: claveTemporal })

const nombreFaena = z
  .string({ required_error: 'name es requerido' })
  .trim()
  .min(1, 'name no puede ir vacío')
  .max(120, 'name supera los 120 caracteres')

export const crearFaenaSchema = z.object({
  name: nombreFaena,
  kind: z.enum(['mining', 'construction']),
})

export const actualizarFaenaSchema = z
  .object({ name: nombreFaena.optional(), kind: z.enum(['mining', 'construction']).optional() })
  .refine((v) => v.name !== undefined || v.kind !== undefined, 'nada que actualizar')

export interface UsuarioDto {
  id: string
  email: string
  full_name: string
  role: RolEmpresa
  is_active: boolean
  must_change_password: boolean
  created_at: string
}

export interface FaenaDto {
  id: string
  name: string
  kind: 'mining' | 'construction'
}
