/* Cliente HTTP del dashboard/sesión real — TSK-WS-011 (FR-035/040/043).
 *
 * Alimenta la sesión (login/me) y las lecturas del supervisor contra el
 * backend NestJS. El access token (HS256, ≤15 min, NFR-06) viaja en
 * `Authorization: Bearer` y vive en sessionStorage: se pierde al cerrar la
 * pestaña, que es lo que espera un dispositivo de faena compartido.
 *
 * Un 401 en CUALQUIER ruta dispara el evento `tc:logout`: el store se encarga
 * de salir y mostrar el login (el panel se entera solo).
 *
 * El consumo de datos ES read-only: capturas/sync siguen en el outbox local
 * (Dexie); acá solo se lee lo sincronizado.
 */

import type {
  ConflictRecordDto,
  DashboardFindingsResponse,
  DashboardSummary,
  ListConflictsResponse,
  SitesResponse,
  TemplateRevisionDetailDto,
  TemplatesDeltaResponse,
} from '@terreno/shared'

export const API_BASE: string =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3000/api/v1'

const TOKEN_KEY = 'tc_access_token'

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token)
}
export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  readonly status: number
  readonly detalle: string
  constructor(status: number, mensaje: string) {
    super(mensaje)
    this.name = 'ApiError'
    this.status = status
    this.detalle = mensaje
  }
}

export const EVENTO_LOGOUT = 'tc:logout'

async function apiFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const token = opts.token !== undefined ? opts.token : getToken()
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let resp: Response
  try {
    resp = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Sin conexión con el servidor')
  }

  if (resp.status === 401) {
    window.dispatchEvent(new Event(EVENTO_LOGOUT))
    throw new ApiError(401, 'Sesión inválida o expirada')
  }
  if (!resp.ok) {
    const body = (await resp.json().catch(() => null)) as { message?: string } | null
    throw new ApiError(resp.status, body?.message ?? `HTTP ${resp.status}`)
  }
  return (await resp.json()) as T
}

/* ------------------------------------------------------------- sesión */

export interface PerfilWire {
  id: string
  tenant_id: string | null
  email: string
  role: string
  full_name: string
}

export function login(email: string, password: string): Promise<{ access_token: string; user: PerfilWire }> {
  return apiFetch('/auth/login', { method: 'POST', body: { email, password }, token: null })
}

export function me(): Promise<PerfilWire> {
  return apiFetch('/auth/me')
}

/* ----------------------------------------------------------- lecturas */

export function getSites(): Promise<SitesResponse> {
  return apiFetch<SitesResponse>('/sites')
}

export interface DashboardFiltros {
  site_id?: string | null
  desde?: string | null
  hasta?: string | null
}

export function getSummary(f: DashboardFiltros = {}): Promise<DashboardSummary> {
  const q = new URLSearchParams()
  if (f.site_id) q.set('site_id', f.site_id)
  if (f.desde) q.set('desde', f.desde)
  if (f.hasta) q.set('hasta', f.hasta)
  const suffix = q.size ? `?${q}` : ''
  return apiFetch<DashboardSummary>(`/dashboard/summary${suffix}`)
}

export interface FindingsFiltros extends DashboardFiltros {
  severidad?: string | null
  estado?: string | null
  limit?: number
  offset?: number
}

export function getFindings(f: FindingsFiltros = {}): Promise<DashboardFindingsResponse> {
  const q = new URLSearchParams()
  if (f.site_id) q.set('site_id', f.site_id)
  if (f.desde) q.set('desde', f.desde)
  if (f.hasta) q.set('hasta', f.hasta)
  if (f.severidad) q.set('severidad', f.severidad)
  if (f.estado) q.set('estado', f.estado)
  if (f.limit !== undefined) q.set('limit', String(f.limit))
  if (f.offset !== undefined) q.set('offset', String(f.offset))
  const suffix = q.size ? `?${q}` : ''
  return apiFetch<DashboardFindingsResponse>(`/dashboard/findings${suffix}`)
}

export function getConflicts(): Promise<ListConflictsResponse> {
  return apiFetch<ListConflictsResponse>('/conflicts')
}

/** Revisiones publicadas con su definición; `since` pedida = delta (FR-027). */
export function getPlantillas(since?: number): Promise<TemplatesDeltaResponse> {
  const suffix = since !== undefined ? `?since=${encodeURIComponent(String(since))}` : ''
  return apiFetch<TemplatesDeltaResponse>(`/templates${suffix}`)
}

export function getRevisionPlantilla(revisionId: string): Promise<TemplateRevisionDetailDto> {
  return apiFetch<TemplateRevisionDetailDto>(`/templates/revisions/${encodeURIComponent(revisionId)}`)
}

export type { ConflictRecordDto }