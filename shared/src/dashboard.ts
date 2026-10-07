/**
 * Contrato de lectura para el dashboard mínimo del supervisor (spec 005,
 * FR-035/040/043, TSK-WS-011). Fuente de verdad del wire; el backend espeja
 * estos tipos localmente (ver `backend/src/dashboard/dashboard.types.ts`).
 *
 * Alcance reducido del walking skeleton: sin queries materializadas ni
 * percentiles por lote — solo las métricas que demuestran la promesa
 * (`≤ 60 s` del dato en el dashboard, FR-043/NFR-03).
 */

import type { SyncSeverity } from './sync'

/** Faena/obra del tenant (data-model §2.1, `site`) — bootstrapea el offline. */
export interface SiteDto {
  id: string
  nombre: string
  tipo: 'mina' | 'obra'
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