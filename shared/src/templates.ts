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
  /** `version` es POR PLANTILLA: max+1 dentro de su `template_id` (FR-027). */
  version: number
  /** Secuencia GLOBAL de publicación — cursor del delta (FR-027, TSK-FORM-009). */
  published_seq: number
  published_at: string | null
  definition: TemplateDefinition
}

/** Revisión publicada tal como la consume el cliente (Zod = contrato único). */
export const templatePublicadaSchema = z.object({
  template_id: z.string().uuid(),
  revision_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  name: z.string().min(1),
  version: z.number().int().positive(),
  published_seq: z.number().int().nonnegative(),
  published_at: z.string().datetime().nullable(),
  definition: templateDefinitionSchema,
})

/**
 * Respuesta de `GET /api/v1/templates?since=` (delta, FR-027).
 *
 * El cursor es `published_seq`, NO `version`: `version` se asigna por
 * plantilla (max+1 dentro de su `template_id`), así que un umbral global la
 * saltaría — con la plantilla A en v9 y la B en v3, `since=9` impide que la v4
 * de B llegue nunca al dispositivo. `published_seq` es monotónica entre
 * publicaciones, con huecos tolerados.
 */
export interface TemplatesDeltaResponse {
  /** Revisiones con `published_seq > since` (todas si `since` ausente), más nueva primero. */
  items: TemplatePublicadaDto[]
  /** Mayor `published_seq` visible — base del próximo `since`. */
  latest_seq: number | null
}

export const templatesDeltaResponseSchema = z.object({
  items: z.array(templatePublicadaSchema),
  latest_seq: z.number().int().nonnegative().nullable(),
})

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

/* ── Importación de plantillas desde .xlsx (TSK-FORM-007, FR-029/047/051) ──
 * Estos schemas modelan el ciclo de vida del import y la propuesta parseada.
 * No importan de `./xlsx` para mantener el barrel libre de tipos Node/Buffer.
 */

export const TEMPLATE_IMPORT_STATUSES = [
  'uploaded',
  'parsed',
  'proposed',
  'confirmed',
  'failed',
] as const

export type TemplateImportStatus = (typeof TEMPLATE_IMPORT_STATUSES)[number]

export const importSourceOriginSchema = z.object({
  sheet: z.string().trim().min(1),
  column: z.string().trim().min(1),
  headerCell: z.string().trim().min(1),
  headerRow: z.number().int().positive(),
  firstDataRow: z.number().int().positive(),
})

export type ImportSourceOrigin = z.infer<typeof importSourceOriginSchema>

export const proposedItemSchema = z
  .object({
    prompt: z.string().trim().min(1),
    response_type: z.enum(RESPONSE_TYPES),
    required: z.boolean(),
    props: z.record(z.string(), z.unknown()),
    source: importSourceOriginSchema,
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

export type ProposedItem = z.infer<typeof proposedItemSchema>

export const proposedSectionSchema = z.object({
  titulo: z.string().trim().min(1),
  items: z.array(proposedItemSchema),
})

export type ProposedSection = z.infer<typeof proposedSectionSchema>

export const templateImportProposalSchema = z.object({
  nombre_archivo: z.string().min(1),
  secciones: z.array(proposedSectionSchema),
  resumen: z.object({
    secciones: z.number().int().nonnegative(),
    items: z.number().int().nonnegative(),
    filasDatos: z.number().int().nonnegative(),
  }),
})

export type TemplateImportProposal = z.infer<typeof templateImportProposalSchema>

/**
 * Cuerpo de `POST /templates/imports/:id/confirm` (FR-029, FR-048).
 *
 * `definition` es **opcional a propósito**: sin ella el import se publica tal
 * como lo propuso el parser, que es el camino simple. Con ella, quien revisa
 * manda la definición que realmente va a la plantilla — es lo que necesita el
 * wizard, que edita ítems en el dispositivo y luego confirma. Lo que el import
 * NO admite es un documento fuente distinto: la revisión siempre nace atada a
 * este import, que es lo que hace posible exportar el `.xlsx` original (FR-019).
 */
export const confirmImportBodySchema = z.object({
  /** Publicar de inmediato; nunca automático sin este flag explícito (FR-048). */
  publish: z.boolean().optional(),
  /** Definición revisada por el humano; si falta, se usa la propuesta. */
  definition: templateDefinitionSchema.optional(),
  /** Nombre de la plantilla editado por el admin; si falta, el nombre del
   *  archivo (`file_name` del import). */
  name: z.string().trim().min(1, 'name debe tener al menos 1 carácter').optional(),
  description: z.string().trim().optional(),
})

export type ConfirmImportBody = z.infer<typeof confirmImportBodySchema>

export const templateImportSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  uploaded_by: z.string().uuid(),
  file_key: z.string().min(1),
  file_name: z.string().min(1),
  status: z.enum(TEMPLATE_IMPORT_STATUSES),
  proposed_schema: templateImportProposalSchema.nullable(),
  error: z.string().nullable().optional(),
  confirmed_at: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})

/* ── Asignación de plantillas por faena y rol (TSK-FORM-008, FR-008/009) ──
 * Una revisión publicada se asigna a una combinación faena + rol. `site_id`
 * NULL = todas las faenas del tenant. El worker sólo ve lo asignado a su
 * faena y rol (FR-009).
 */

export const TEMPLATE_ASSIGNMENT_ROLES = ['field_worker', 'supervisor'] as const
export type TemplateAssignmentRole = (typeof TEMPLATE_ASSIGNMENT_ROLES)[number]

export const assignTemplateSchema = z.object({
  revision_id: z.string().uuid(),
  /** `null` = asignación global (todas las faenas); ausente = global. */
  site_id: z.string().uuid().nullable().optional(),
  role: z.enum(TEMPLATE_ASSIGNMENT_ROLES),
  /** `false` desactiva una asignación existente sin borrarla. */
  active: z.boolean().optional(),
})

export type AssignTemplateBody = z.infer<typeof assignTemplateSchema>

export interface TemplateAssignmentDto {
  id: string
  template_revision_id: string
  tenant_id: string
  site_id: string | null
  role: TemplateAssignmentRole
  active: boolean
  assigned_by: string
  assigned_at: string
  created_at: string
  updated_at: string
}

export interface TemplateAssignmentsResponse {
  items: TemplateAssignmentDto[]
}

/* ── Documento original para export offline (TSK-FORM-009, FR-018/019) ────
 * El dispositivo cachea el `.xlsx` fuente de cada revisión publicada asignada
 * para poder exportar el documento rellenado sin conexión (FR-019/044). Lo que
 * viaja por el cable son los BYTES; esta forma es la que el cliente persiste y
 * valida antes de escribirla en IndexedDB.
 */

/** MIME del libro original; único formato de V1 (ADR-003, ExcelJS). */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Fila del caché local del documento original (una por revisión). */
export const templateOriginalMetaSchema = z.object({
  revision_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  /** Nombre del archivo tal como lo subió el `tenant_admin`. */
  file_name: z.string().min(1),
  mime: z.literal(XLSX_MIME),
  bytes_length: z.number().int().positive(),
  /** Epoch ms de la descarga local (no del servidor): decide la purga. */
  cached_at: z.number().int().nonnegative(),
})

export type TemplateOriginalMeta = z.infer<typeof templateOriginalMetaSchema>

/** Presupuesto de bytes para los originales cacheados (FR-018). */
export const PRESUPUESTO_ORIGINALES_BYTES = 25 * 1024 * 1024

/* ── Nombre del documento original (RFC 6266) ──────────────────────────────
 * El nombre viaja en `Content-Disposition` y el navegador sólo puede leerlo si
 * el servidor lo expone por CORS (`Access-Control-Expose-Headers`): no es un
 * header "simple", así que sin esa cabecera el JS ve `null` y el nombre se
 * pierde en silencio. El parser vive acá, en el paquete que es fuente única del
 * contrato (ADR-003 d1), y no en el cliente.
 */

/** Tope del nombre: suficiente para el libro y acotado para el filesystem. */
export const MAX_NOMBRE_ARCHIVO = 120

/** Caracteres de control (C0 + DEL): no pueden ir en un nombre de archivo. */
function tieneCaracteresDeControl(valor: string): boolean {
  for (const ch of valor) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * Un nombre de archivo utilizable. Rechaza separadores de ruta y caracteres de
 * control porque el valor viene de un upload remoto y TSK-FORM-010 lo va a
 * usar tal cual para nombrar el `.xlsx` exportado en disco.
 */
export const nombreArchivoSchema = z
  .string()
  .min(1)
  .max(MAX_NOMBRE_ARCHIVO)
  .refine((v) => !tieneCaracteresDeControl(v), 'el nombre no puede llevar caracteres de control')
  .refine((v) => !v.includes('/') && !v.includes('\\'), 'el nombre no puede llevar separadores de ruta')
  .refine((v) => v !== '.' && v !== '..', 'el nombre no puede ser un segmento de ruta')

/** `filename*=UTF-8''nombre%20con%20acentos.xlsx` (preferred, RFC 5987). */
const RE_FILENAME_EXT = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i
/** `filename="control-diario.xlsx"` (ASCII, RFC 6266). */
const RE_FILENAME = /filename\s*=\s*"([^"]*)"/i

/** Valida el nombre ya decodificado y se queda sólo con el base del path. */
function sanear(valor: string): string | null {
  const base = valor.trim().split(/[/\\]/).pop() ?? ''
  const r = nombreArchivoSchema.safeParse(base)
  return r.success ? r.data : null
}

/**
 * Nombre del documento original a partir de la cabecera `Content-Disposition`.
 *
 * Prefiere `filename*` (UTF-8, el único que sobrevive a acentos) y cae a
 * `filename` ASCII. Devuelve `null` si no hay cabecera o si lo que trae no es
 * un nombre utilizable — el *fallback* (nombre derivado de la revisión) es
 * decisión del cliente, que es quien sabe de qué revisión se trata.
 *
 * El percent-encoding se decodifica **sólo en la rama extendida**: por RFC 5987
 * `filename*` va codificado, mientras que `filename` es un literal ASCII y
 * decodificarlo rompería un nombre legítimo con `%` (`100% roto.xlsx`).
 */
export function nombreArchivoDeContentDisposition(header: string | null): string | null {
  if (!header) return null
  const extendido = RE_FILENAME_EXT.exec(header)?.[1]
  if (extendido) {
    let decodificado: string
    try {
      decodificado = decodeURIComponent(extendido)
    } catch {
      // Percent-encoding malformado: por RFC 5987 el valor extendido no es
      // interpretable. Se cae al `filename` ASCII, que es la única señal que
      // queda; si tampoco está, el llamador decide el fallback.
      decodificado = ''
    }
    const sanificado = decodificado ? sanear(decodificado) : null
    if (sanificado) return sanificado
  }
  const ascii = RE_FILENAME.exec(header)?.[1]
  return ascii ? sanear(ascii) : null
}

export type TemplateImport = z.infer<typeof templateImportSchema>