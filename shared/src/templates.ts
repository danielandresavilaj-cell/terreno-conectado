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

/** Valida y normaliza un ítem (lanza ZodError si no cumple el contrato). */
export function parseTemplateItem(input: unknown): TemplateItem {
  return templateItemSchema.parse(input)
}

/** Valida y normaliza una definición completa (lanza ZodError si no cumple). */
export function parseTemplateDefinition(input: unknown): TemplateDefinition {
  return templateDefinitionSchema.parse(input)
}