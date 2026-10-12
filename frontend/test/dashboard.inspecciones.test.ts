/* Cliente de inspecciones del supervisor — TSK-FORM-010 (FR-044).
 *
 * Lo que se fija aquí son las TRES decisiones que la ruta introduce y que el
 * resto del cliente ya tenía resueltas en otra forma:
 *
 *  1. El listado se pide con los MISMOS filtros de período y faena que
 *     `summary`/`findings`, porque la pantalla manda los mismos. Un filtro
 *     propio acá mostraría inspecciones de un rango que el supervisor no está
 *     mirando.
 *  2. La descarga va por `fetch` con `Authorization` (no un `<a href>`: el JWT
 *     no viaja en cookie), devuelve BYTES y toma el nombre de
 *     `Content-Disposition`, que es la ÚNICA cabecera que lo transporta — con
 *     su `filename*` percent-encoded, porque un header HTTP sólo habla latin1 y
 *     un nombre de faena viene con acentos y º.
 *  3. Los errores llegan como `ApiError` con el motivo del servidor. Un 404 acá
 *     no es una caída: es "esta inspección no tiene documento original" (una
 *     plantilla creada a mano no viene de un import) y ese texto es lo
 *     accionable para el supervisor, así que no se sustituye por un genérico.
 *
 * El runner es `environment: 'node'` a propósito (ver `vitest.config.ts`), así
 * que `window`, `sessionStorage` y `fetch` se inyectan con `vi.stubGlobal`: en el
 * navegador existen, en Node hay que fingirlos — y para observar el evento de
 * logout el `window` fingido tiene que ser el que registra.
 *
 * El parseo del nombre NO se prueba aquí: es del contrato compartido
 * (`nombreArchivoDeContentDisposition`) y tiene sus propios tests. Lo que se ve
 * es que el cliente USE ese parser y no un `split('=')` de su propio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  EVENTO_LOGOUT,
  descargarInspeccion,
  getInspecciones,
  setToken,
} from '../src/lib/api'
import { uuid } from './fixtures'

interface Llamada {
  url: string
  headers: Record<string, string>
}

const DESCRIPCIONES: { status: number; headers?: Record<string, string>; cuerpo?: string }[] = []
const LLAMADAS: Llamada[] = []
let eventos: string[] = []

function responder(status: number, init: { headers?: Record<string, string>; cuerpo?: string } = {}) {
  DESCRIPCIONES.push({ status, ...init })
}

beforeEach(() => {
  DESCRIPCIONES.length = 0
  LLAMADAS.length = 0
  eventos = []
  vi.stubGlobal('sessionStorage', {
    getItem: () => 'token-de-prueba',
    setItem: () => {},
    removeItem: () => {},
  })
  vi.stubGlobal('window', {
    dispatchEvent: (e: Event) => {
      eventos.push(e.type)
    },
  })
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    LLAMADAS.push({ url, headers: (init.headers ?? {}) as Record<string, string> })
    const d = DESCRIPCIONES.shift()
    if (!d) throw new Error('fetch sin respuesta preparada')
    return new Response(d.cuerpo ?? null, { status: d.status, headers: d.headers })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /dashboard/inspections', () => {
  it('manda el período y la faena que eligió el supervisor', async () => {
    responder(200, { cuerpo: JSON.stringify({ items: [] }) })
    const desde = '2026-10-05T00:00:00.000Z'
    const hasta = '2026-10-12T00:00:00.000Z'

    await getInspecciones({ site_id: uuid(50), desde, hasta })

    const q = new URL(LLAMADAS[0].url).searchParams
    expect(q.get('site_id')).toBe(uuid(50))
    // Las fechas viajan tal cual las da `rangoPeriodo`: el backend las revalida y
    // las pasa a timestamptz. Reconstruirlas acá sólo abriría la puerta a que
    // el cliente y el filtro del panel midieran cosas distintas.
    expect(q.get('desde')).toBe(desde)
    expect(q.get('hasta')).toBe(hasta)
  })

  it('sin faena elegida no manda `site_id`: "todas las faenas" es la ausencia del filtro', async () => {
    responder(200, { cuerpo: JSON.stringify({ items: [] }) })

    await getInspecciones({ site_id: undefined, desde: '2026-10-05T00:00:00.000Z' })

    expect(new URL(LLAMADAS[0].url).searchParams.has('site_id')).toBe(false)
  })

  it('sin filtros no inventa un `?` vacío', async () => {
    responder(200, { cuerpo: JSON.stringify({ items: [] }) })

    await getInspecciones()

    expect(LLAMADAS[0].url).not.toContain('?')
  })

  it('un 401 cierra sesión como el resto del cliente', async () => {
    responder(401, { cuerpo: JSON.stringify({ message: 'Sesión expirada' }) })

    await expect(getInspecciones()).rejects.toBeInstanceOf(ApiError)
    expect(eventos).toEqual([EVENTO_LOGOUT])
  })
})

describe('GET /dashboard/inspections/:id/export', () => {
  it('devuelve los bytes del libro y el nombre que viaja en `Content-Disposition`', async () => {
    const inspeccionId = uuid(60)
    const nombre = 'Chequeo de seguridad — revisión Nº2 (Ñuñoa).xlsx'
    // Lo que compone `contentDisposition()` en el backend: la `filename` ASCII
    // es el respaldo y la `filename*` UTF-8 el valor real.
    const ascii = 'Chequeo de seguridad - revision N2 (Nunoa).xlsx'
    responder(200, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      },
      cuerpo: 'PKcontenido-del-libro',
    })
    setToken('token-de-prueba')

    const r = await descargarInspeccion(inspeccionId)

    expect(new URL(LLAMADAS[0].url).pathname).toContain(
      `/dashboard/inspections/${inspeccionId}/export`,
    )
    // El JWT viaja en `Authorization`, no en cookie: por eso esta ruta no puede
    // ser un `<a href>` y tiene que pasar por el cliente con su header.
    expect(LLAMADAS[0].headers.Authorization).toBe('Bearer token-de-prueba')
    expect(new TextDecoder().decode(r.bytes)).toBe('PKcontenido-del-libro')
    // Sin decodificar la `filename*` el supervisor guardaría el archivo con la ñ y
    // la º corruptas (FR-019).
    expect(r.fileName).toBe(nombre)
  })

  it('sin cabecera legible (CORS no la expone) rotula con el id en vez de perder la descarga', async () => {
    const inspeccionId = uuid(60)
    responder(200, { cuerpo: 'PK' })

    const r = await descargarInspeccion(inspeccionId)

    expect(new TextDecoder().decode(r.bytes)).toBe('PK')
    expect(r.fileName).toBe(`inspeccion-${inspeccionId}.xlsx`)
  })

  it('un 404 llega como ApiError con el motivo del servidor, no como excepción opaca', async () => {
    // Lo que responde el backend cuando la plantilla se creó a mano: nunca hubo
    // un import, así que no hay revisión —y por tanto ningún documento original—
    // que rellenar. Ese texto es lo que el supervisor puede usar; un "algo salió
    // mal" no le dice nada.
    const detalle = 'la inspección apunta a una revisión de plantilla que no existe en este tenant'
    responder(404, { cuerpo: JSON.stringify({ message: detalle }) })

    const err = await descargarInspeccion(uuid(60)).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).detalle).toBe(detalle)
    // Un 404 no es una sesión inválida: no debe cerrar la sesión, y la pantalla
    // lo muestra como motivo accionable en vez de reintentar.
    expect(eventos).toEqual([])
  })

  it('un 422 del servidor también llega con su motivo (original que no se pudo interpretar)', async () => {
    responder(422, {
      cuerpo: JSON.stringify({
        message: 'el documento original de la plantilla no se pudo interpretar: hoja ausente',
      }),
    })

    const err = await descargarInspeccion(uuid(60)).catch((e: unknown) => e)

    expect((err as ApiError).status).toBe(422)
    expect((err as ApiError).detalle).toContain('no se pudo interpretar')
  })

  it('un 401 dispara `tc:logout` como el resto del cliente', async () => {
    responder(401, { cuerpo: JSON.stringify({ message: 'Sesión expirada' }) })

    await expect(descargarInspeccion(uuid(60))).rejects.toBeInstanceOf(ApiError)
    expect(eventos).toEqual([EVENTO_LOGOUT])
  })

  it('un campo_worker (403) no se reintenta: el rol no va a cambiar', async () => {
    responder(403, { cuerpo: JSON.stringify({ message: 'rol insuficiente' }) })

    const err = await descargarInspeccion(uuid(60)).catch((e: unknown) => e)

    expect((err as ApiError).status).toBe(403)
    expect(eventos).toEqual([])
  })

  it('sin señal responde ApiError 0 y no intenta leer el cuerpo', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })

    const err = await descargarInspeccion(uuid(60)).catch((e: unknown) => e)

    expect((err as ApiError).status).toBe(0)
  })

  it('el aislamiento por tenant es 404, no 403: el listado y la descarga no lo delatan', async () => {
    // Un id de inspección de otro tenant no puede responder 403, porque eso le
    // confirmaría al supervisor que el registro existe en otro lado (NFR-05).
    responder(404, { cuerpo: JSON.stringify({ message: 'inspección no encontrada para este tenant' }) })

    const err = await descargarInspeccion(uuid(61)).catch((e: unknown) => e)

    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).detalle).toBe('inspección no encontrada para este tenant')
  })
})