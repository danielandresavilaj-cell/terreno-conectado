/**
 * Tipos de lectura del dashboard — espejo wire de `shared/src/dashboard.ts`
 * (spec 005, TSK-WS-011). Se duplican deliberadamente aquí por la misma razón
 * que `sync.types.ts`: el build de backend compila con rootDir en `src/`.
 */

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

export interface FindingDto {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'in_progress' | 'resolved'
  description: string
  faena_id: string | null
  faena_nombre: string | null
  autor: string | null
  captured_at: string
  synced_at: string | null
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
  hallazgos_por_severidad: Record<'low' | 'medium' | 'high' | 'critical', number>
  hallazgos_urgentes: number
  hallazgos_total: number
  latencia_media_seg: number | null
  latencia_p95_seg: number | null
  conflictos_pendientes: number
  sincronizaciones: number
}

export interface DashboardFindingsResponse {
  items: FindingDto[]
  total: number
}