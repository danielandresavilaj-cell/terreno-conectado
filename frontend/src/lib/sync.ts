/* Worker de cola cliente — TSK-WS-008 (FR-016, FR-022, FR-026).
 *
 * Consume el outbox local (Dexie) contra `POST /api/v1/sync/batch`
 * (contrato `shared/src/sync.ts`):
 *  · **Concurrencia 1:** nunca hay dos lotes volando a la vez (spec 003 §4.2)
 *    — el módulo es un singleton: un guard impide reentrada.
 *  · **Disparo:** lo decide el store (evento `online` del navegador, FR-016, y
 *    el flush al terminar una captura, FR-004); acá sólo se ejecuta.
 *  · **Backoff (FR-022):** si algo falla se reprograma solo con
 *    1 s → 2 s → 4 s … máximo 5 min, sin intervención del usuario.
 *  · **Desenlace (FR-021/FR-026):** con respuesta del servidor marca cada fila
 *    `synced` (o la devuelve a `failed` con `lastError` + 1 intento). Los
 *    `records_unchanged` de un replay cuentan como éxito.
 *
 * Nota: V1 no autentica (no hay sesión real en el mockup); cuando llegue el
 * login real, basta con darle el access token a `fetchLote`. Autoridad de la
 * foto: `AttachmentRow.blob` ya viene comprimida (FR-012).
 */

import { uuidv7, type SyncBatchRequest, type SyncBatchResponse } from '@terreno/shared'
import {
  aSyncRecord,
  getDeviceId,
  marcarEnviando,
  marcarFallido,
  marcarSincronizado,
  sincronizables,
  type OutboxRow,
} from './db'

/** Máximo de registros por lote que acepta el servidor (límite FR-021). */
export const MAX_LOTE = 500
/** FR-022: tope del backoff exponencial. */
export const MAX_BACKOFF_MS = 5 * 60 * 1000

export const API_BASE: string =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3000/api/v1'

export type EstadoSync = 'ok' | 'parcial' | 'fallo' | 'vacio' | 'en_curso'

export interface ResultadoSync {
  estado: EstadoSync
  /** ids de cola (`entityType:entityId`) marcados `synced`. */
  sincronizados: string[]
  /** ids de cola devueltos a `failed` por el servidor. */
  fallidos: string[]
  sincronizables: number
  enviados: number
  /** Primer motivo si hubo fallos (para el aviso UI). */
  error: string | null
}

/** FR-022: espera entre reintentos. `intentos` = contador de la fila (0 = primero). */
export function backoffMs(intentos: number): number {
  return Math.min(1000 * 2 ** intentos, MAX_BACKOFF_MS)
}

/** HTTP puro, inyectable para pruebas. Headers icónicos de API. */
export async function fetchLote(
  url: string,
  lote: SyncBatchRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  return fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lote),
  })
}

let enCurso = false
let retryTimer: number | undefined

/** Concurrencia 1: anula el reintento pendiente si no queda nada que enviar. */
function cancelarReintento(): void {
  if (retryTimer !== undefined) {
    window.clearTimeout(retryTimer)
    retryTimer = undefined
  }
}

/** FR-022: reprograma un intento con backoff a partir del mayor contador. */
function programarReintento(filas: OutboxRow[]): void {
  cancelarReintento()
  const mayor = filas.reduce((m, f) => Math.max(m, f.retries ?? 0), 0)
  const espera = backoffMs(mayor)
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined
    void sincronizarCola()
  }, espera)
}

function idDeCola(f: OutboxRow): string {
  return `${f.entityType}:${f.entityId}`
}

/** Extrae el entityId de un error `entity_type:id: motivo` (respuesta FR-021). */
function entityIdDeError(err: string): string | null {
  const partes = err.split(':')
  return partes.length >= 2 ? partes[1] : null
}

/**
 * Intenta sincronizar la cola una vez (concurrencia 1). Devuelve el desenlace;
 * ante fallos programa solo el reintento con backoff. No lanza: los problemas
 * se reportan en `ResultadoSync.error`.
 */
export async function sincronizarCola(): Promise<ResultadoSync> {
  if (enCurso) return { estado: 'en_curso', sincronizados: [], fallidos: [], sincronizables: 0, enviados: 0, error: null }
  enCurso = true
  try {
    const filas = (await sincronizables()).slice(0, MAX_LOTE)
    if (filas.length === 0) {
      cancelarReintento()
      return { estado: 'vacio', sincronizados: [], fallidos: [], sincronizables: 0, enviados: 0, error: null }
    }

    await marcarEnviando(filas)
    const registros = await Promise.all(filas.map((f) => aSyncRecord(f)))
    const lote: SyncBatchRequest = {
      batch_id: uuidv7(),
      device_id: await getDeviceId(),
      records: registros,
    }

    const resp = await fetchLote(`${API_BASE}/sync/batch`, lote)
    if (!resp.ok) {
      const motivo = await resp.text().catch(() => `HTTP ${resp.status}`)
      const err = `HTTP ${resp.status}: ${motivo.slice(0, 120)}`
      for (const f of filas) await marcarFallido(f, err)
      programarReintento(filas)
      return {
        estado: 'fallo',
        sincronizados: [],
        fallidos: filas.map(idDeCola),
        sincronizables: filas.length,
        enviados: filas.length,
        error: err,
      }
    }

    const json = (await resp.json()) as SyncBatchResponse
    const rechazados = new Set<string>()
    for (const e of json.errors ?? []) {
      const id = entityIdDeError(e)
      if (id) rechazados.add(id)
    }

    const exitosas: OutboxRow[] = []
    const fallidas: OutboxRow[] = []
    for (const f of filas) {
      if (rechazados.has(f.entityId)) fallidas.push(f)
      else exitosas.push(f)
    }
    for (const f of fallidas) await marcarFallido(f, json.errors?.[0] ?? 'registro rechazado')
    await marcarSincronizado(exitosas)

    if (fallidas.length > 0) programarReintento(fallidas)
    else cancelarReintento()

    return {
      estado: fallidas.length === 0 ? 'ok' : 'parcial',
      sincronizados: exitosas.map(idDeCola),
      fallidos: fallidas.map(idDeCola),
      sincronizables: filas.length,
      enviados: filas.length,
      error: fallidas.length > 0 ? (json.errors?.[0] ?? null) : null,
    }
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err)
    const filas = await sincronizables().catch(() => [] as OutboxRow[])
    for (const f of filas) await marcarFallido(f, mensaje)
    programarReintento(filas)
    return { estado: 'fallo', sincronizados: [], fallidos: filas.map(idDeCola), sincronizables: filas.length, enviados: filas.length, error: mensaje }
  } finally {
    enCurso = false
  }
}