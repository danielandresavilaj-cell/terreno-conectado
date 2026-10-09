/**
 * Contrato de formularios dinámicos — módulo 007 (ADR-003 d2/d5, FR-036/FR-039).
 *
 * Fuente de verdad de los 8 tipos de campo de V1 y sus `props` (data-model §2.2).
 * Vive en `shared/` a propósito: el dispositivo valida la respuesta ANTES de
 * encolar con el MISMO schema que el backend usa al guardar la plantilla
 * (FR-039), y el importador `.xlsx` (TSK-FORM-005) lo usa para mapear celdas.
 *
 * - `response_type` es el discriminante (8 tipos). `props` válidas por tipo:
 *   min/max (numeric/date), options[] (select_*), required (todos),
 *   photo_max_kb (photo), max_length (text).
 * - Los schemas son `strict()` en `props`: una prop desconocida es un error de
 *   contrato, no se ignora silenciosamente.
 */
import { z } from 'zod'

/** Los 8 tipos de campo de V1 (FR-036). En orden de presentación habitual. */
export const RESPONSE_TYPES = [
  'ok_nok_na',
  'text',
  'numeric',
  'date',
  'time',
  'select_single',
  'select_multiple',
  'photo',
] as const

export type ResponseType = (typeof RESPONSE_TYPES)[number]

export interface FieldProps {
  required?: boolean
  /** Límites según response_type: numeric → number; date → string ISO `YYYY-MM-DD`. */
  min?: number | string
  max?: number | string
  /** select_*: opciones del campo. */
  options?: string[]
  /** photo: tamaño máximo del adjunto comprimido en KB (FR-012). */
  photo_max_kb?: number
  /** text: longitud máxima del texto (protocolo de import/export). */
  max_length?: number
}

export interface TemplateItem {
  id: string
  prompt: string
  response_type: ResponseType
  require_finding_on_nok?: boolean
  props?: FieldProps
  help?: string
}

export interface TemplateSection {
  id?: string
  title: string
  position?: number
  items: TemplateItem[]
}

export interface TemplateDefinition {
  sections: TemplateSection[]
}

/** Validación de `props` por tipo. `strict()`: props desconocidas = error. */
const okNokNaProps = z.object({ required: z.boolean().optional() }).strict()

const textProps = z
  .object({
    required: z.boolean().optional(),
    max_length: z.number().int().positive().max(10_000).optional(),
  })
  .strict()

const numericProps = z
  .object({
    required: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .strict()
  .refine((p) => p.min === undefined || p.max === undefined || p.min <= p.max, {
    message: 'min debe ser menor o igual a max',
    path: ['min'],
  })

const dateProps = z
  .object({
    required: z.boolean().optional(),
    min: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha ISO YYYY-MM-DD').optional(),
    max: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha ISO YYYY-MM-DD').optional(),
  })
  .strict()
  .refine((p) => p.min === undefined || p.max === undefined || p.min <= p.max, {
    message: 'min debe ser menor o igual a max',
    path: ['min'],
  })

const timeProps = z.object({ required: z.boolean().optional() }).strict()

const selectProps = z
  .object({
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1)).min(1, 'select_* requiere al menos una opción'),
  })
  .strict()

const photoProps = z
  .object({
    required: z.boolean().optional(),
    photo_max_kb: z.number().int().positive().optional(),
  })
  .strict()

/** Props válidas por `response_type` (FR-036, data-model §2.2). */
export const FIELD_PROPS_SCHEMA: Record<ResponseType, z.ZodType> = {
  ok_nok_na: okNokNaProps,
  text: textProps,
  numeric: numericProps,
  date: dateProps,
  time: timeProps,
  select_single: selectProps,
  select_multiple: selectProps,
  photo: photoProps,
}

export const templateItemSchema: z.ZodType<TemplateItem> = z
  .object({
    id: z.string().uuid(),
    prompt: z.string().trim().min(1, 'prompt no puede estar vacío'),
    response_type: z.enum(RESPONSE_TYPES),
    require_finding_on_nok: z.boolean().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    help: z.string().optional(),
  })
  .superRefine((item, ctx) => {
    const parsedProps = FIELD_PROPS_SCHEMA[item.response_type].safeParse(item.props ?? {})
    if (!parsedProps.success) {
      for (const issue of parsedProps.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['props', ...issue.path],
          message: `${item.response_type}: ${issue.message}`,
        })
      }
    }
  })

export const templateSectionSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'title no puede estar vacío'),
  position: z.number().int().nonnegative().optional(),
  items: z.array(templateItemSchema).default([]),
})

export const templateDefinitionSchema = z.object({
  sections: z.array(templateSectionSchema).default([]),
})

/** Valida y normaliza una definición completa (lanza ZodError si no cumple). */
export function parseTemplateDefinition(input: unknown): TemplateDefinition {
  return templateDefinitionSchema.parse(input)
}

/* ── Valores de respuesta por tipo (FR-036, FR-039) ────────────────────────
 * El dispositivo valida la respuesta con ESTE contrato antes de encolarla
 * (TSK-FORM-001/003): mismo criterio que `props` valida al guardar la
 * plantilla, así "plantilla guardada ⇒ render válida" es una invariante.
 */

/** Valor runtime de cada `response_type`. */
export type ValorPorTipo = {
  ok_nok_na: 'ok' | 'nok' | 'na'
  text: string
  numeric: number
  date: string
  time: string
  select_single: string
  select_multiple: string[]
  /** Referencia local del adjunto; `null` = sin foto. El binario vive en el
   *  dispositivo hasta TSK-FORM-004 (ATTACHMENT de respuesta). */
  photo: string | null
}

/** Un valor de campo sin discriminar por tipo (para estado de UI/persistencia). */
export type CampoValor = ValorPorTipo[ResponseType]

export type ValidacionCampo = { ok: true; valor: CampoValor } | { ok: false; error: string }

const OK_NOK_NA = new Set<unknown>(['ok', 'nok', 'na'])

function vacio(valor: unknown): boolean {
  return (
    valor === null ||
    valor === undefined ||
    (typeof valor === 'string' && valor.trim() === '') ||
    (Array.isArray(valor) && valor.length === 0)
  )
}

/**
 * Valida una respuesta contra `props` del ítem (FR-039): `ok` devuelve el
 * valor normalizado; `!ok` devuelve el mensaje que la UI muestra al capturar.
 * Se usa también como compuerta de encolado — una respuesta inválida nunca
 * llega al outbox.
 */
export function validateValorCampo(item: TemplateItem, valor: unknown): ValidacionCampo {
  const props = (item.props ?? {}) as FieldProps
  if (vacio(valor)) {
    return props.required
      ? { ok: false, error: 'Campo obligatorio' }
      : { ok: true, valor: null }
  }

  switch (item.response_type) {
    case 'ok_nok_na': {
      if (!OK_NOK_NA.has(valor)) return { ok: false, error: 'Respuesta inválida: use OK, NOK o N/A' }
      return { ok: true, valor: valor as ValorPorTipo['ok_nok_na'] }
    }
    case 'text': {
      if (typeof valor !== 'string') return { ok: false, error: 'Debe ser texto' }
      if (props.max_length !== undefined && valor.length > props.max_length) {
        return { ok: false, error: `Máximo ${props.max_length} caracteres` }
      }
      return { ok: true, valor }
    }
    case 'numeric': {
      if (typeof valor !== 'number' || !Number.isFinite(valor)) {
        return { ok: false, error: 'Debe ser un número' }
      }
      if (typeof props.min === 'number' && valor < props.min) {
        return { ok: false, error: `Mínimo ${props.min}` }
      }
      if (typeof props.max === 'number' && valor > props.max) {
        return { ok: false, error: `Máximo ${props.max}` }
      }
      return { ok: true, valor }
    }
    case 'date': {
      if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        return { ok: false, error: 'Fecha inválida (YYYY-MM-DD)' }
      }
      if (typeof props.min === 'string' && valor < props.min) {
        return { ok: false, error: `Antes de ${props.min}` }
      }
      if (typeof props.max === 'string' && valor > props.max) {
        return { ok: false, error: `Después de ${props.max}` }
      }
      return { ok: true, valor }
    }
    case 'time': {
      if (typeof valor !== 'string' || !/^\d{2}:\d{2}(:\d{2})?$/.test(valor)) {
        return { ok: false, error: 'Hora inválida (HH:MM)' }
      }
      return { ok: true, valor }
    }
    case 'select_single': {
      if (typeof valor !== 'string') return { ok: false, error: 'Debe elegir una opción' }
      if (props.options && !props.options.includes(valor)) {
        return { ok: false, error: 'Opción fuera del catálogo de la plantilla' }
      }
      return { ok: true, valor }
    }
    case 'select_multiple': {
      if (!Array.isArray(valor) || valor.some((v) => typeof v !== 'string')) {
        return { ok: false, error: 'Debe elegir una o más opciones' }
      }
      if (props.options && valor.some((v) => !props.options!.includes(v))) {
        return { ok: false, error: 'Opción fuera del catálogo de la plantilla' }
      }
      return { ok: true, valor: valor as string[] }
    }
    case 'photo': {
      if (typeof valor !== 'string' || valor === '') {
        return { ok: false, error: 'Debe adjuntar una foto' }
      }
      return { ok: true, valor }
    }
  }
}

/* ── DTOs de lectura (TSK-FORM-001, FR-018/027) ─────────────────────────── */

/** Revisión publicada lista para renderizar en la captura. */
export interface TemplatePublicadaDto {
  template_id: string
  revision_id: string
  /** Tenant dueño (RLS) — el caché offline lo filtra por tenant activo. */
  tenant_id: string
  name: string
  /** `version` es asignada al publicar (FR-027) y base del delta `since`. */
  version: number
  published_at: string | null
  definition: TemplateDefinition
}

/** Respuesta de `GET /api/v1/templates?since=` (delta, FR-027). */
export interface TemplatesDeltaResponse {
  /** Revisions con `version > since` (o todas si `since` ausente), más nueva primero. */
  items: TemplatePublicadaDto[]
  /** Mayor versión publicada del tenant — base del próximo `since`. */
  latest_version: number | null
}

/** Detalle de una revisión (`GET /api/v1/templates/revisions/:id`). */
export interface TemplateRevisionDetailDto {
  id: string
  template_id: string
  version: number | null
  status: 'draft' | 'published' | 'archived'
  definition: TemplateDefinition
  published_at: string | null
  created_at: string
  updated_at: string
}