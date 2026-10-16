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
  /** Latencia media captura → disponibilidad en segundos (FR-040/NFR-03). */
  latencia_media_seg: number | null
  /** Percentil 95 de la misma métrica. */
  latencia_p95_seg: number | null
  conflictos_pendientes: number
  sincronizaciones: number
}

export interface DashboardFindingsResponse {
  items: FindingDto[]
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
})

/** Vista auditable de una inspección y sus respuestas, sin alterar el registro. */
export const inspectionDetalleSchema = z.object({
  id: z.string().uuid(),
  faena_nombre: z.string(),
  template_nombre: z.string().nullable(),
  template_version: z.number().int(),
  ejecutado_por: z.string(),
  status: z.enum(['draft', 'in_progress', 'submitted', 'reviewed']),
  captured_at: z.string().datetime(),
  secciones: z.array(
    z.object({
      title: z.string(),
      respuestas: z.array(inspectionRespuestaSchema),
    }),
  ),
})

export type InspectionDetalle = z.infer<typeof inspectionDetalleSchema>
