/**
 * Exportación de inspecciones — TSK-REP-007 (Enmienda 005, FR-045/046).
 *
 * Una sola estructura por inspección (`InspeccionExportable`) alimenta los
 * tres formatos nuevos: Excel consolidado, PDF y Word. La arma el servidor con
 * la definición CONGELADA de cada inspección (FR-028), así que una plantilla
 * que cambió de versión no desalinea nada: cada respuesta lleva el id de su ítem.
 */
import type { ResponseType } from '../templates'

export interface RespuestaExportable {
  item_id: string
  prompt: string
  tipo: ResponseType
  /** Valor ya legible: "OK", "No OK", "N/A", texto, número, "a; b"… */
  valor: string | number | null
  /** Para destacar: la respuesta es "No OK". */
  nok: boolean
}

export interface HallazgoExportable {
  severidad: 'low' | 'medium' | 'high' | 'critical'
  estado: 'open' | 'in_progress' | 'resolved'
  descripcion: string
  capturado_at: string
  resuelto_at: string | null
}

export interface EvidenciaExportable {
  item_prompt: string
  nombre: string
  mime: string
  bytesLength: number
  /** Presentes sólo si la foto se incrusta (≤ `UMBRAL_EVIDENCIA_BYTES`). */
  bytes: Uint8Array | null
  fileKey: string | null
}

export interface InspeccionExportable {
  id: string
  faena: string
  formulario: { template_id: string; nombre: string; version: number }
  autor: string
  estado: 'draft' | 'in_progress' | 'submitted' | 'reviewed'
  capturada_at: string
  revisada_at: string | null
  secciones: Array<{ titulo: string; respuestas: RespuestaExportable[] }>
  hallazgos: HallazgoExportable[]
  evidencias: EvidenciaExportable[]
}

/** Contexto que encabeza el archivo (portada / hoja Resumen). */
export interface MetaExportacion {
  empresa: string
  /** Descripción legible del filtro: "Faena Norte · 01-11-2026 a 30-11-2026". */
  filtro: string
  generado_at: string
}

export const ESTADO_LABEL: Record<InspeccionExportable['estado'], string> = {
  draft: 'Borrador',
  in_progress: 'En curso',
  submitted: 'Enviada',
  reviewed: 'Revisada',
}

export const SEVERIDAD_LABEL: Record<HallazgoExportable['severidad'], string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
}

export const ESTADO_HALLAZGO_LABEL: Record<HallazgoExportable['estado'], string> = {
  open: 'Abierto',
  in_progress: 'En curso',
  resolved: 'Resuelto',
}

/** Fecha y hora de Chile para mostrar: "05-11-2026 14:32". */
export function fechaLegible(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${v('day')}-${v('month')}-${v('year')} ${v('hour')}:${v('minute')}`
}

export const nokDe = (i: InspeccionExportable) =>
  i.secciones.reduce((n, s) => n + s.respuestas.filter((r) => r.nok).length, 0)
