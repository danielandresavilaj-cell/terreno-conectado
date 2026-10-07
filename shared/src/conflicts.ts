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
}

export interface ListConflictsResponse {
  items: ConflictRecordDto[]
  total: number
}