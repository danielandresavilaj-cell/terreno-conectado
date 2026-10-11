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
  TemplateAssignmentDto,
  TemplateAssignmentRole,
  TemplateAssignmentsResponse,
  TemplateDefinition,
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
  const resp = await apiFetchResp(path, opts)
  return (await resp.json()) as T
}

/**
 * Petición sin tocar el cuerpo de la respuesta.
 *
 * `apiFetch` SIEMPRE acaba en `resp.json()`, así que no puede servir el
 * documento original `.xlsx` (que son bytes, no JSON). Compartir esta parte
 * garantiza que el cliente binario respete las MISMAS reglas de sesión que el
 * resto: 401 ⇒ evento `tc:logout`, error ⇒ `ApiError` con el mensaje del
 * servidor.
 */
async function apiFetchResp(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<Response> {
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
  return resp
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

/** Revisiones publicadas con su definición; `since` pedida = delta (FR-027).
 *  `since` es el cursor `published_seq` persistido (NO `version`: es por
 *  plantilla y un umbral global saltaba revisiones). `siteId` es la faena
 *  activa del dispositivo: un rol operativo sólo recibe lo asignado a su
 *  faena y rol (FR-009); el admin lo ignora (ve todo). */
export function getPlantillas(since?: number, siteId?: string | null): Promise<TemplatesDeltaResponse> {
  const q = new URLSearchParams()
  if (since !== undefined) q.set('since', String(since))
  if (siteId) q.set('site_id', siteId)
  const suffix = q.size ? `?${q}` : ''
  return apiFetch<TemplatesDeltaResponse>(`/templates${suffix}`)
}

/** Documento original descargado de una revisión (bytes + nombre real). */
export interface OriginalDescargado {
  bytes: Blob
  fileName: string
}

/**
 * Bytes del `.xlsx` fuente de una revisión (FR-018, TSK-FORM-009).
 *
 * El nombre llega en `X-File-Name` PERCENT-ENCODED: un header HTTP sólo
 * transporta latin1, así que un nombre con acentos viajaría corrupto si se
 * mandara en crudo. El cliente lo decodifica y lo persiste tal cual (FR-019).
 * `Content-Disposition` es el respaldo (trae `filename*` UTF-8) y, si tampoco
 * está, se usa un nombre derivado de la revisión: sólo rotula el archivo
 * exportado, no participa del contrato de la plantilla.
 *
 * El MIME no se devuelve: V1 tiene un único formato de original (ADR-003), así
 * que la fila del caché siempre guarda el literal del contrato.
 *
 * Un 404 significa "no visible para ti" (sin asignación o de otro tenant), no
 * un fallo transitorio: llega como `ApiError` y el llamador lo descarta sin
 * reintentar — reintentar sería intentar enumerar originales ajenos.
 */
export async function getPlantillaOriginal(
  revisionId: string,
  siteId?: string | null,
): Promise<OriginalDescargado> {
  const q = new URLSearchParams()
  if (siteId) q.set('site_id', siteId)
  const suffix = q.size ? `?${q}` : ''
  const resp = await apiFetchResp(
    `/templates/revisions/${encodeURIComponent(revisionId)}/original${suffix}`,
  )
  return { bytes: await resp.blob(), fileName: nombreArchivoDeHeaders(resp, revisionId) }
}

function nombreArchivoDeHeaders(resp: Response, revisionId: string): string {
  const crudo = resp.headers.get('X-File-Name')
  if (crudo) return decodificarNombre(crudo)
  const estrella = /filename\*=UTF-8''([^;]+)/i.exec(resp.headers.get('Content-Disposition') ?? '')
  if (estrella) return decodificarNombre(estrella[1])
  return `${revisionId}.xlsx`
}

function decodificarNombre(valor: string): string {
  try {
    return decodeURIComponent(valor)
  } catch {
    // Header malformado (no es un percent-encoding válido): se conserva en
    // crudo en vez de tumbar la descarga — el nombre sólo rotula el archivo.
    return valor
  }
}

/** Asignaciones faena+rol del tenant (sólo `tenant_admin`, FR-008). */
export function getAsignaciones(): Promise<TemplateAssignmentsResponse> {
  return apiFetch<TemplateAssignmentsResponse>('/templates/assignments')
}

/** Asigna (o reactiva) una revisión publicada a faena+rol; `site_id` null = global. */
export function crearAsignacion(payload: {
  revision_id: string
  site_id?: string | null
  role: TemplateAssignmentRole
  active?: boolean
}): Promise<TemplateAssignmentDto> {
  return apiFetch('/templates/assignments', { method: 'POST', body: payload })
}

/** Quita una asignación (FR-008). */
export function eliminarAsignacion(assignmentId: string): Promise<void> {
  return apiFetch(`/templates/assignments/${assignmentId}`, { method: 'DELETE' })
}

/* ---------------------------------------------- plantillas (escritura) */

/* Importación asistida (TSK-FORM-006, FR-029/048): crear borrador → editar →
 * publicar. La respuesta es la revisión (`TemplateRevisionDetailDto`, ya
 * exportado por `@terreno/shared`), así el wizard no inventa una forma propia.
 * Publicar NUNCA es automático: `publicarRevision` sólo se llama desde el
 * botón explícito de confirmación del paso 5 (FR-048). */

/** Crea el template + su primer borrador (`POST /templates`). */
export function crearPlantillaConBorrador(payload: {
  name: string
  description?: string
  definition: TemplateDefinition
}): Promise<TemplateRevisionDetailDto> {
  return apiFetch('/templates', { method: 'POST', body: payload })
}

/** Actualiza la definición de un borrador existente (PATCH de la revisión). */
export function actualizarBorrador(
  revisionId: string,
  definition: TemplateDefinition,
): Promise<TemplateRevisionDetailDto> {
  return apiFetch(`/templates/revisions/${revisionId}`, { method: 'PATCH', body: { definition } })
}

/** Publica una revisión ya guardada: acción explícita del admin (FR-048). */
export function publicarRevision(revisionId: string): Promise<TemplateRevisionDetailDto> {
  return apiFetch(`/templates/revisions/${revisionId}/publish`, { method: 'POST' })
}

export type { ConflictRecordDto }