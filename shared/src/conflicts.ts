/**
 * Contrato de lectura de conflictos — `GET /api/v1/conflicts` (spec 003,
 * FR-023, TSK-WS-009). Fuente de verdad del wire; el backend espeja estos
 * tipos localmente (ver `backend/src/sync/sync.types.ts`).
 *
 * Un conflicto nace cuando dos dispositivos editan EL MISMO registro offline:
 * la ingesta (LWW determinista, plan §3.1) elige un ganador pero conserva
 * ambas versiones (Artículo III): nunca sobrescritura silenciosa. El consumo
 * visual lo hace el dashboard del supervisor (TSK-WS-011).
 */

import type { SyncEntityType } from './sync'

/** Tie-breaker determinista del LWW (plan §3.1): única resolución existente. */
export type ConflictResolution = 'lww'

export interface ConflictRecordDto {
  id: string
  entity_type: SyncEntityType
  entity_id: string
  winner_payload: Record<string, unknown>
  loser_payload: Record<string, unknown>
  resolution: ConflictResolution
  resolved_at: string
  /** TSK-DOM-005: revisión persistente por supervisión; null = pendiente. */
  reviewed_at?: string | null
  reviewed_by?: string | null
}

export interface ListConflictsResponse {
  items: ConflictRecordDto[]
  total: number
}
/**
 * TSK-OFF-018 (FR-024): envíos que el servidor rechazó antes de procesarlos,
 * agrupados por equipo y motivo. Un teléfono reintenta el mismo lote, así que
 * cada grupo dice cuántas veces ocurrió y cuándo fue la última.
 */
export interface EnvioRechazadoDto {
  device_id: string
  usuario: string | null
  motivo: string
  intentos: number
  primero: string
  ultimo: string
}

export interface ListEnviosRechazadosResponse {
  items: EnvioRechazadoDto[]
}
