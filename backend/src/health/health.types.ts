/** Contrato `GET /health` (FR-052, consumible por un uptime monitor). */
export interface HealthResponse {
  status: 'ok' | 'degraded'
  uptime_s: number
  version: string
  db: 'up' | 'down'
}

export interface HealthResult {
  ok: boolean
  body: HealthResponse
}