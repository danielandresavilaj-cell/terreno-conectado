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

import { nombreArchivoDeContentDisposition } from '@terreno/shared'
import type {
  ConfirmImportBody,
  ConflictRecordDto,
  DashboardFindingsResponse,
  DashboardSummary,
  InspectionsResponse,
  ListConflictsResponse,
  SitesResponse,
  TemplateAssignmentDto,
  TemplateAssignmentRole,
  TemplateAssignmentsResponse,
  TemplateDefinition,
  TemplateImport,
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
  // `FormData` (subida de archivos) no lleva Content-Type propio: el navegador
  // lo compone con el boundary multipart. Si se lo pusiéramos, el servidor no
  // podría partir el cuerpo — y el `FileInterceptor` de multer fallaría.
  const esFormData = opts.body instanceof FormData
  if (opts.body !== undefined && !esFormData) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let resp: Response
  try {
    resp = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'include',
      body:
        opts.body === undefined
          ? undefined
          : esFormData
            ? (opts.body as FormData)
            : JSON.stringify(opts.body),
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

/**
 * Query string de los filtros del dashboard. `summary`, `findings` e
 * `inspections` mandan el MISMO trío (`site_id`/`desde`/`hasta`), así que se
 * arma en un solo sitio; `extra` agrega los parámetros propios de cada ruta
 * (p. ej. la paginación de `findings`) sin duplicar el filtrado base.
 */
function qsFiltros(
  f: DashboardFiltros,
  extra: Record<string, string | number | null | undefined> = {},
): string {
  const q = new URLSearchParams()
  if (f.site_id) q.set('site_id', f.site_id)
  if (f.desde) q.set('desde', f.desde)
  if (f.hasta) q.set('hasta', f.hasta)
  for (const [clave, valor] of Object.entries(extra)) {
    if (valor !== undefined && valor !== null && valor !== '') q.set(clave, String(valor))
  }
  return q.size ? `?${q}` : ''
}

export function getSummary(f: DashboardFiltros = {}): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>(`/dashboard/summary${qsFiltros(f)}`)
}

export interface FindingsFiltros extends DashboardFiltros {
  severidad?: string | null
  estado?: string | null
  /** FR-041: id del autor (usuario que ejecutó la inspección). */
  autor_id?: string | null
  limit?: number
  offset?: number
}

export function getFindings(f: FindingsFiltros = {}): Promise<DashboardFindingsResponse> {
  return apiFetch<DashboardFindingsResponse>(
    `/dashboard/findings${qsFiltros(f, {
      severidad: f.severidad,
      estado: f.estado,
      autor_id: f.autor_id,
      limit: f.limit,
      offset: f.offset,
    })}`,
  )
}

/**
 * Inspecciones del período (FR-044, TSK-FORM-010).
 *
 * Comparte `DashboardFiltros` con `summary` y `findings` a propósito: la pantalla
 * manda los MISMOS filtros a las tres rutas, así que lo que el supervisor ve
 * filtrado en las métricas y lo que aparece en la lista de inspecciones son el
 * mismo conjunto de registros. Un filtro propio acá sería una lista que no
 * corresponde con el panel.
 */
export function getInspecciones(f: DashboardFiltros = {}): Promise<InspectionsResponse> {
  return apiFetch<InspectionsResponse>(`/dashboard/inspections${qsFiltros(f)}`)
}

/**
 * El `.xlsx` original rellenado con las respuestas de la inspección, más la hoja
 * "Evidencias" (FR-019/044).
 *
 * Son BYTES, no JSON: por eso esta ruta va por `apiFetchResp` y no por
 * `apiFetch` (que siempre acaba en `resp.json()`), conservando las mismas reglas
 * de sesión del resto del cliente — 401 ⇒ `tc:logout`, error ⇒ `ApiError` con el
 * mensaje del servidor. Y NO puede bajarse con un `<a href>`: el JWT viaja en
 * `Authorization`, no en cookie, así que un link desnudo saldría sin token.
 *
 * Devuelve `Uint8Array` y no `Blob` como `getPlantillaOriginal`: acá los bytes
 * no van a la caché de Dexie sino directo a `descargarLibro`, que los escribe en
 * un `Blob` ella misma.
 */
export async function descargarInspeccion(
  inspeccionId: string,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const resp = await apiFetchResp(
    `/dashboard/inspections/${encodeURIComponent(inspeccionId)}/export`,
  )
  return {
    bytes: new Uint8Array(await resp.arrayBuffer()),
    // Mismo criterio que el original de plantilla: si `Content-Disposition` no es
    // legible (CORS no lo expone, o el nombre no es utilizable) se rotula con el
    // id, porque perder la descarga por el nombre sería peor que un nombre feo.
    fileName:
      nombreArchivoDeContentDisposition(resp.headers.get('Content-Disposition')) ??
      `inspeccion-${inspeccionId}.xlsx`,
  }
}

/**
 * El ZIP del período: un `.xlsx` por inspección más el `manifesto.json`
 * (FR-045/046, TSK-FORM-010).
 *
 * Los mismos filtros que la tabla, en el BODY y no en la query: es el mismo
 * `dashboardFiltrosSchema` del listado, así que el cliente reenvía el objeto de
 * filtros sin traducirlo a otro contrato que pueda divergir del primero. Se
 * mandan los tres campos explícitamente (con `null` en los que no aplican) para
 * que el servidor reciba una forma estable en vez de un objeto al que `JSON`
 * le amputa las claves `undefined`.
 *
 * Los tres campos del recuento vienen de las cabeceras `X-Lote-*` y son
 * `null` si el navegador no las deja leer: CORS sólo expone `Content-Disposition`
 * (`backend/src/app.setup.ts`), así que en cross-origin el desglose llega como
 * `null` y el detalle está dentro del ZIP. Por eso son `null` y no `0`: "no lo sé"
 * y "cero" son cosas distintas y mintiendo con un 0 se taparía el caso de un
 * lote con fallos.
 */
export interface LoteDescargado {
  bytes: Uint8Array
  fileName: string
  loteId: string | null
  exportadas: number | null
  fallidas: number | null
}

/**
 * Lote del período (FR-045/046).
 *
 * Va por POST y por `apiFetchResp`: son BYTES, no JSON, y además el POST no crea
 * nada que se pueda volver a pedir por id. Hereda las reglas de sesión del resto
 * del cliente (401 ⇒ `tc:logout`, error ⇒ `ApiError` con el motivo del servidor),
 * y los 413/404/422 del lote llegan con el texto que ya es accionable —el
 * límite, el filtro vacío, el motivo por el que no salió ninguna— para que la UI
 * los muestre sin traducirlos.
 */
export async function descargarLoteInspecciones(
  filtros: DashboardFiltros = {},
): Promise<LoteDescargado> {
  const resp = await apiFetchResp('/dashboard/inspections/export-lote', {
    method: 'POST',
    body: {
      site_id: filtros.site_id ?? null,
      desde: filtros.desde ?? null,
      hasta: filtros.hasta ?? null,
    },
  })
  return {
    bytes: new Uint8Array(await resp.arrayBuffer()),
    // Mismo criterio que la descarga individual: si `Content-Disposition` no es
    // legible se rotula con algo estable, porque perder el archivo por el nombre
    // sería peor que un nombre feo. El nombre real lo compone el servidor con el
    // rango del período, así que el fallback sólo rotula.
    fileName:
      nombreArchivoDeContentDisposition(resp.headers.get('Content-Disposition')) ??
      'inspecciones.zip',
    loteId: resp.headers.get('X-Lote-Id'),
    exportadas: conteoDeCabecera(resp, 'X-Lote-Exportadas'),
    fallidas: conteoDeCabecera(resp, 'X-Lote-Fallidas'),
  }
}

/**
 * Entero de una cabecera de recuento, o `null` si no está o no es un número.
 * El servidor la manda como `String(n)`; el `null` se reserva para "el navegador
 * no me dejó leerla", que la UI cuenta como "sin dato" y no como cero.
 */
function conteoDeCabecera(resp: Response, cabecera: string): number | null {
  const crudo = resp.headers.get(cabecera)
  if (crudo === null) return null
  const n = Number.parseInt(crudo, 10)
  return Number.isNaN(n) ? null : n
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
 * El nombre viaja UNA sola vez, en `Content-Disposition`: es un header CORS no
 * "simple", así que sólo es legible desde JS si el backend lo publica en
 * `Access-Control-Expose-Headers`; sin eso el navegador devuelve `null` y el
 * nombre se pierde en silencio. Por eso el parseo NO se reimplementa acá sino que
 * delega en el contrato compartido (`nombreArchivoDeContentDisposition`), que es
 * la fuente única de las reglas de saneo del nombre.
 *
 * Si el parser devuelve `null` (cabecera ausente, no expuesta por CORS o con un
 * nombre no utilizable) se usa un nombre derivado de la revisión: el fallback es
 * decisión del cliente porque es quien sabe de qué revisión se trata. Ese nombre
 * sólo rotula el archivo exportado, no participa del contrato de la plantilla.
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
  return {
    bytes: await resp.blob(),
    // El fallback vive acá y no en el parser: el parser no sabe de qué revisión
    // se trata, el cliente sí.
    fileName: nombreArchivoDeContentDisposition(resp.headers.get('Content-Disposition')) ??
      `${revisionId}.xlsx`,
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

/**
 * Sube el `.xlsx` fuente y crea el `template_import` (TSK-FORM-006/007, FR-029/048).
 *
 * El wizard parsea en local para el preview, pero el ORIGINAL tiene que subirse:
 * la revisión debe nacer atada a este import para que el export del documento
 * fuente (FR-019/044) tenga algo que rellenar. Sin él, una plantilla creada
 * desde la UI no era exportable — «importada» pero sin documento que exportar.
 */
export function subirImportOriginal(file: File): Promise<TemplateImport> {
  const fd = new FormData()
  fd.append('file', file)
  return apiFetch<TemplateImport>('/templates/imports', { method: 'POST', body: fd })
}

/**
 * Confirma el import con la definición revisada (FR-048) → crea plantilla +
 * borrador atado a `source_import_id`. Es la puerta de alta del wizard: una vez
 * confirmado, el borrador se edita con `actualizarBorrador` y se publica con
 * `publicarRevision`.
 */
export function confirmarImport(
  importId: string,
  body: ConfirmImportBody,
): Promise<TemplateRevisionDetailDto> {
  return apiFetch(`/templates/imports/${importId}/confirm`, { method: 'POST', body })
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