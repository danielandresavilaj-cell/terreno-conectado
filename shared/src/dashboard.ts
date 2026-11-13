/**
 * Contrato de lectura para el dashboard mínimo del supervisor (spec 005,
 * FR-035/040/043, TSK-WS-011). Fuente de verdad del wire; el backend espeja
 * estos tipos localmente (ver `backend/src/dashboard/dashboard.types.ts`).
 *
 * Alcance reducido del walking skeleton: sin queries materializadas ni
 * percentiles por lote — solo las métricas que demuestran la promesa
 * (`≤ 60 s` del dato en el dashboard, FR-043/NFR-03).
 */

import { z } from 'zod'
import type { SyncSeverity } from './sync'

/** Faena/obra del tenant (data-model §2.1, `site`) — bootstrapea el offline. */
export interface SiteDto {
  id: string
  nombre: string
  tipo: 'mina' | 'obra'
}

/** Autor (usuario que ejecutó inspecciones) para poblar el filtro por autor
 *  (FR-041). Sólo los que tienen actividad en el período consultado. */
export interface AutorDto {
  id: string
  nombre: string
}

/** `GET /api/v1/sites` — identidad del dispositivo offline (FR-006, TSK-WS-011). */
export interface SitesResponse {
  items: SiteDto[]
  tenant: { id: string; nombre: string }
}

/** Fila sincronizada de hallazgo que ve el supervisor (FR-035/040). */
export interface FindingDto {
  id: string
  /** Severidad en valores del contrato de ingesta (low…critical). */
  severity: SyncSeverity
  status: 'open' | 'in_progress' | 'resolved'
  description: string
  /** Sitio (faena) al que pertenece el hallazgo vía su inspección. */
  faena_id: string | null
  faena_nombre: string | null
  /** Usuario que ejecutó la inspección (FR-041): id para filtrar, nombre para mostrar. */
  autor_id: string | null
  autor: string | null
  captured_at: string
  synced_at: string | null
  /** Evidencia fotográfica más reciente (metadata; los bytes se sirven aparte). */
  foto_id: string | null
  foto_mime: string | null
  foto_bytes: number | null
  foto_ancho: number | null
  foto_alto: number | null
}

export interface DashboardSummary {
  site_id: string | null
  faenas: SiteDto[]
  /** Autores con actividad en el período (FR-041), para el filtro por autor. */
  autores: AutorDto[]
  inspecciones_por_estado: Record<'draft' | 'in_progress' | 'submitted' | 'reviewed', number>
  hallazgos_por_severidad: Record<SyncSeverity, number>
  /** FR-035: abiertos (no resueltos) de severidad alta o crítica. */
  hallazgos_urgentes: number
  hallazgos_total: number
  conflictos_pendientes: number
  sincronizaciones: number
}

export interface DashboardFindingsResponse {
  items: FindingDto[]
  total: number
}

/** TSK-REP-009 (FR-033/063): una entrada de bitácora leída desde el servidor. */
export interface BitacoraEntradaDto {
  id: string
  faena_id: string
  faena_nombre: string
  autor_id: string
  autor: string
  texto: string
  tags: string[]
  /** Fecha del turno (YYYY-MM-DD) que registró el dispositivo. */
  fecha_turno: string
  captured_at: string
}

export interface BitacoraResponse {
  items: BitacoraEntradaDto[]
  total: number
}
/* ── Exportación de inspecciones (TSK-FORM-010, FR-044) ─────────────────────
 * El supervisor ve las inspecciones del período y pide el `.xlsx` original
 * rellenado. El contrato vive aquí porque lo consumen las dos puntas: el backend
 * lo valida antes de responder y el frontend no inventa su propia forma.
 */
export const inspectionListaItemSchema = z.object({
  id: z.string().uuid(),
  faena_id: z.string().uuid(),
  faena_nombre: z.string(),
  template_id: z.string().uuid(),
  /** `null` si la plantilla se borró: `inspection.template_id` no lleva FK y una
   *  inspección huérfana debe seguir siendo visible, no desaparecer. */
  template_nombre: z.string().nullable(),
  /** Versión CONGELADA con la que se ejecutó (FR-028), no la última publicada. */
  template_version: z.number().int(),
  ejecutado_por: z.string(),
  /** Se muestra el estado en vez de filtrar: el registro es inmutable (FR-049). */
  status: z.enum(['draft', 'in_progress', 'submitted', 'reviewed']),
  captured_at: z.string().datetime(),
  /** Cuántas respuestas tiene: el supervisor ve de un vistazo si se puede exportar. */
  respuestas: z.number().int().nonnegative(),
})

export const inspectionsResponseSchema = z.object({
  items: z.array(inspectionListaItemSchema),
})

export type InspectionListaItem = z.infer<typeof inspectionListaItemSchema>
export type InspectionsResponse = z.infer<typeof inspectionsResponseSchema>

/** Respuesta leída con la definición congelada de su inspección. */
export const inspectionRespuestaSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string(),
  response_type: z.enum([
    'ok_nok_na',
    'text',
    'numeric',
    'date',
    'time',
    'select_single',
    'select_multiple',
    'photo',
  ]),
  value: z.union([z.string(), z.number(), z.array(z.string()), z.null()]),
  /** TSK-REP-008: adjunto con la foto de la respuesta (`GET /dashboard/attachments/:id`). */
  foto_id: z.string().uuid().nullable(),
})

/** TSK-REP-008: hallazgo de la inspección, con su evidencia si la tiene. */
export const inspectionHallazgoSchema = z.object({
  id: z.string().uuid(),
  /** Ítem del formulario del que nació; `null` si el hallazgo no viene de una respuesta. */
  item_id: z.string().uuid().nullable(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string(),
  status: z.enum(['open', 'in_progress', 'resolved']),
  foto_id: z.string().uuid().nullable(),
})

export type InspectionHallazgo = z.infer<typeof inspectionHallazgoSchema>

/** Vista auditable de una inspección y sus respuestas, sin alterar el registro. */
export const inspectionDetalleSchema = z.object({
  id: z.string().uuid(),
  faena_nombre: z.string(),
  template_nombre: z.string().nullable(),
  template_version: z.number().int(),
  ejecutado_por: z.string(),
  status: z.enum(['draft', 'in_progress', 'submitted', 'reviewed']),
  captured_at: z.string().datetime(),
  requires_supervisor_signature: z.boolean(),
  signatures: z.array(z.object({
    signer_role: z.enum(['inspector', 'supervisor']),
    signer_name: z.string(),
    signed_at: z.string().datetime(),
    content_hash: z.string(),
  })),
  secciones: z.array(
    z.object({
      title: z.string(),
      respuestas: z.array(inspectionRespuestaSchema),
    }),
  ),
  /** TSK-REP-008: hallazgos de la inspección, del más antiguo al más reciente. */
  hallazgos: z.array(inspectionHallazgoSchema),
})

export type InspectionDetalle = z.infer<typeof inspectionDetalleSchema>

/* ── Dashboard de supervisión v1.1 (TSK-REP-006) ─────────────────────────────
 * Cuatro bloques accionables. Toda duración se calcula con UN solo reloj:
 * la espera sin señal con el del dispositivo (encolado → envío) y el
 * procesamiento con el del servidor (inicio → fin del lote).
 */
export interface HallazgoCritico {
  id: string
  descripcion: string
  severidad: SyncSeverity
  faena_nombre: string | null
  dias_abierto: number
}

export interface ItemNok {
  template_item_id: string
  prompt: string
  plantilla: string | null
  nok: number
  respondidas: number
}

export interface PendienteRevision {
  id: string
  faena_nombre: string
  plantilla: string | null
  ejecutado_por: string
  captured_at: string
  dias_esperando: number
}

export interface EquipoInactivo {
  device_id: string
  usuario: string | null
  ultima_sync: string
  horas_sin_sync: number
}

export interface DashboardSupervision {
  hallazgos: {
    /** Abiertos (no resueltos) por antigüedad, sin filtro de período: es el backlog actual. */
    abiertos_por_antiguedad: { hasta_1d: number; de_1_a_7d: number; mas_de_7d: number }
    criticos_abiertos: HallazgoCritico[]
    /** Resueltos en el período: horas desde la captura hasta resolverse. */
    cierre_horas_media: number | null
    cierre_horas_p50: number | null
    resueltos_periodo: number
    top_nok: ItemNok[]
  }
  revision: {
    pendientes: number
    dias_mas_antigua: number | null
    dias_mediana: number | null
    mas_antiguas: PendienteRevision[]
  }
  actividad: {
    por_dia: Array<{ dia: string; inspecciones: number }>
    por_faena: Array<{ faena_id: string; faena_nombre: string; inspecciones: number }>
    por_trabajador: Array<{ usuario: string; inspecciones: number }>
    faenas_sin_actividad: number
  }
  sincronizacion: {
    /** Segundos que los datos esperaron en el dispositivo antes de enviarse. */
    espera_sin_senal_p50_seg: number | null
    espera_sin_senal_p95_seg: number | null
    /** Inspecciones con marcas de cola (clientes ≥ v1.1); sin ellas no se inventa. */
    muestras_espera: number
    /** Segundos que tardó el servidor en procesar un lote (NFR-03: ≤ 60 s). */
    procesamiento_p95_seg: number | null
    lotes: number
    lotes_con_error: number
    equipos_inactivos: EquipoInactivo[]
    equipos_activos_30d: number
  }
}

/* ── Exportar inspecciones — TSK-REP-007 (Enmienda 005) ──────────────────────
 * Un contrato para filtrar y elegir qué exportar y en qué formato. Sin `ids`
 * se exporta todo lo filtrado; con `ids`, sólo esas (siempre dentro de RLS).
 */
export const EXPORT_FORMATOS = ['xlsx_consolidado', 'pdf', 'docx', 'xlsx_original'] as const
export type ExportFormato = (typeof EXPORT_FORMATOS)[number]

/** Tope de inspecciones por formato: un PDF/Word con fotos pesa mucho más que filas de Excel. */
export const TOPE_EXPORTACION: Record<ExportFormato, number> = {
  xlsx_consolidado: 500,
  pdf: 100,
  docx: 100,
  xlsx_original: 50,
}

export const INSPECCION_ESTADOS = ['draft', 'in_progress', 'submitted', 'reviewed'] as const

const vacioANulo = (v: unknown) => (v === '' || v === null ? undefined : v)

/** Filtros de la lista de inspecciones y de toda exportación. */
export const inspeccionesFiltrosSchema = z.object({
  site_id: z.preprocess(vacioANulo, z.string().uuid('faena inválida').optional()),
  desde: z.preprocess(vacioANulo, z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'desde inválido').optional()),
  hasta: z.preprocess(vacioANulo, z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'hasta inválido').optional()),
  template_id: z.preprocess(vacioANulo, z.string().uuid('formulario inválido').optional()),
  status: z.preprocess(vacioANulo, z.enum(INSPECCION_ESTADOS).optional()),
  autor_id: z.preprocess(vacioANulo, z.string().uuid('autor inválido').optional()),
  ids: z.preprocess(vacioANulo, z.array(z.string().uuid('inspección inválida')).max(500).optional()),
})
export type InspeccionesFiltros = z.infer<typeof inspeccionesFiltrosSchema>

export const exportarInspeccionesBodySchema = inspeccionesFiltrosSchema.extend({
  formato: z.enum(EXPORT_FORMATOS),
  /** PDF/Word: un archivo con todas, o un ZIP con uno por inspección. */
  agrupar: z.enum(['un_archivo', 'zip']).default('un_archivo'),
})
export type ExportarInspeccionesBody = z.input<typeof exportarInspeccionesBodySchema>
