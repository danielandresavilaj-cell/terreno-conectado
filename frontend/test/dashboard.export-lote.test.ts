/* Cliente del lote de exportaciones — TSK-FORM-010 (FR-045/046).
 *
 * Lo que se fija aquí son las decisiones que la ruta del lote introduce y que el
 * resto del cliente ya tenía resueltas de otra forma:
 *
 *  1. El lote se pide por POST con el filtro EN EL BODY. Es el mismo
 *     `dashboardFiltrosSchema` que la tabla del período, así que el cliente
 *     reenvía los mismos `{ site_id, desde, hasta }`: si el lote usara un
 *     contrato de filtros propio, el ZIP podría no ser el período que el
 *     supervisor tiene delante de los ojos.
 *  2. La respuesta es un ZIP (BYTES) y el nombre viaja en `Content-Disposition`,
 *     igual que en el `.xlsx` individual, con su `filename*` percent-encoded:
 *     un header HTTP sólo habla latin1 y el nombre trae el rango del período.
 *  3. El desglose "3 exportadas · 1 fallida" llega en las cabeceras `X-Lote-*`.
 *     Se comprueba que el cliente las lee Y que, cuando el navegador no las
 *     expone (CORS sólo publica `Content-Disposition`), devuelve `null` en vez
 *     de `0`: inventar un cero haría que un lote con fallos se leyera como un
 *     lote limpio.
 *  4. Los errores del lote llegan como `ApiError` con el texto del servidor, y
 *     ese texto es el que la UI muestra: el 413 trae el límite y cuántas
 *     inspecciones se pidieron, el 404 dice que el filtro no trajo nada y el 422
 *     trae el motivo de cada inspección que no salió. Aplanarlos a un "algo salió
 *     mal" es justo lo que estos tests impiden.
 *
 * El runner es `environment: 'node'` a propósito (ver `vitest.config.ts`), así
 * que `window`, `sessionStorage` y `fetch` se inyectan con `vi.stubGlobal`: en el
 * navegador existen, en Node hay que fingirlos — y para observar el evento de
 * logout el `window` fingido tiene que ser el que registra.
 *
 * No se prueba la escritura del archivo en disco: eso es `descargarLibro`
 * (`lib/exportar.ts`), que no depende de la red. Lo que se prueba aquí es lo que
 * llega a sus manos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  EVENTO_LOGOUT,
  descargarLoteInspecciones,
  setToken,
} from '../src/lib/api'
import { uuid } from './fixtures'

interface Llamada {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

const RESPUESTAS: { status: number; headers?: Record<string, string>; cuerpo?: string }[] = []
const LLAMADAS: Llamada[] = []
let eventos: string[] = []

function responder(status: number, init: { headers?: Record<string, string>; cuerpo?: string } = {}) {
  RESPUESTAS.push({ status, ...init })
}

beforeEach(() => {
  RESPUESTAS.length = 0
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
    LLAMADAS.push({
      url,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    })
    const d = RESPUESTAS.shift()
    if (!d) throw new Error('fetch sin respuesta preparada')
    return new Response(d.cuerpo ?? null, { status: d.status, headers: d.headers })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /dashboard/inspections/export-lote', () => {
  it('manda por POST el filtro del período que el supervisor está viendo', async () => {
    responder(200, { cuerpo: 'PK' })
    const desde = '2026-10-05T00:00:00.000Z'
    const hasta = '2026-10-12T00:00:00.000Z'

    await descargarLoteInspecciones({ site_id: uuid(70), desde, hasta })

    const llamada = LLAMADAS[0]
    expect(llamada.method).toBe('POST')
    expect(new URL(llamada.url).pathname).toContain('/dashboard/inspections/export-lote')
    // Sin query: el filtro viaja entero en el body, que es el `dashboardFiltrosSchema`
    // del backend. Si además fuera por query, habría dos caminos para el mismo filtro.
    expect(llamada.url).not.toContain('?')
    expect(llamada.body).toEqual({ site_id: uuid(70), desde, hasta })
    // El JWT viaja en `Authorization`, no en cookie: por eso esta ruta no puede
    // ser un `<a download>` y tiene que pasar por el cliente con su header.
    expect(llamada.headers.Authorization).toBe('Bearer token-de-prueba')
    expect(llamada.headers['Content-Type']).toBe('application/json')
  })

  it('el filtro va con los tres campos aunque falten: `null` es la ausencia de filtro', async () => {
    responder(200, { cuerpo: 'PK' })

    await descargarLoteInspecciones({ site_id: undefined })

    // El esquema del backend acepta `null` como "sin filtro" y lo convierte en
    // ausencia; mandarlo evita depender de qué claves quita `JSON.stringify`.
    expect(LLAMADAS[0].body).toEqual({ site_id: null, desde: null, hasta: null })
  })

  it('devuelve los bytes del ZIP, el nombre de `Content-Disposition` y el desglose', async () => {
    const nombre = 'inspecciones-2026-10-05_2026-10-12.zip'
    responder(200, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${nombre}"`,
        'X-Lote-Id': uuid(71),
        'X-Lote-Exportadas': '3',
        'X-Lote-Fallidas': '1',
      },
      cuerpo: 'PKcontenido-del-lote',
    })
    setToken('token-de-prueba')

    const r = await descargarLoteInspecciones({})

    expect(new TextDecoder().decode(r.bytes)).toBe('PKcontenido-del-lote')
    expect(r.fileName).toBe(nombre)
    // El recuento de las cabeceras es lo único que la UI puede decir sin abrir el
    // ZIP que el navegador ya se está descargando.
    expect(r.exportadas).toBe(3)
    expect(r.fallidas).toBe(1)
    expect(r.loteId).toBe(uuid(71))
  })

  it('sin cabeceras de recuento (CORS no las expone) devuelve `null`, no `0`', async () => {
    // `exposedHeaders` del backend sólo publica `Content-Disposition`: en
    // cross-origin el navegador devuelve `null` para el resto. Un `0` aquí
    // mostraría "0 exportadas y 0 fallidas" de un lote que sí exportó.
    responder(200, { headers: { 'Content-Disposition': 'attachment; filename="lote.zip"' } })

    const r = await descargarLoteInspecciones({})

    expect(r.exportadas).toBeNull()
    expect(r.fallidas).toBeNull()
    expect(r.loteId).toBeNull()
    expect(r.fileName).toBe('lote.zip')
  })

  it('sin nombre legible rotula con uno utilizable en vez de perder la descarga', async () => {
    responder(200, { cuerpo: 'PK' })

    const r = await descargarLoteInspecciones({})

    expect(r.fileName).toBe('inspecciones.zip')
  })

  it('413: llega el límite y cuántas inspecciones se pidieron', async () => {
    // El backend cuenta el filtro ANTES de construir nada y lo dice: sin esos dos
    // números el supervisor no sabe cuánto tiene que acotar el período.
    const detalle = 'el filtro trae 51 inspecciones y un lote admite 50: acota el período o la faena'
    responder(413, { cuerpo: JSON.stringify({ message: detalle }) })

    const err = await descargarLoteInspecciones({}).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(413)
    expect((err as ApiError).detalle).toBe(detalle)
    expect((err as ApiError).detalle).toContain('50')
    expect((err as ApiError).detalle).toContain('51')
    // Acotar el período es una acción de la pantalla: no es una sesión inválida.
    expect(eventos).toEqual([])
  })

  it('404: el filtro no trajo ninguna inspección y eso se dice', async () => {
    const detalle = 'el filtro no trae ninguna inspección del período: no hay nada que exportar'
    responder(404, { cuerpo: JSON.stringify({ message: detalle }) })

    const err = await descargarLoteInspecciones({}).catch((e: unknown) => e)

    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).detalle).toBe(detalle)
  })

  it('422: llega el motivo REAL de cada inspección que no se pudo exportar', async () => {
    const detalle =
      'no se pudo exportar ninguna de las 2 inspecciones del período: ' +
      'no hay documento original para la revisión 01890000-0000-7000-8000-00000000000b; ' +
      'el documento original de la plantilla no se pudo interpretar: hoja ausente'
    responder(422, { cuerpo: JSON.stringify({ message: detalle }) })

    const err = await descargarLoteInspecciones({}).catch((e: unknown) => e)

    expect((err as ApiError).status).toBe(422)
    // El texto íntegro, no un resumen: es lo que dice qué revisar en la plantilla.
    expect((err as ApiError).detalle).toBe(detalle)
    expect((err as ApiError).detalle).toContain('no hay documento original')
    expect((err as ApiError).detalle).toContain('hoja ausente')
  })

  it('401 cierra sesión como el resto del cliente', async () => {
    responder(401, { cuerpo: JSON.stringify({ message: 'Sesión expirada' }) })

    await expect(descargarLoteInspecciones({})).rejects.toBeInstanceOf(ApiError)
    expect(eventos).toEqual([EVENTO_LOGOUT])
  })

  it('403 (rol insuficiente) no cierra sesión ni se reintenta: el rol no va a cambiar', async () => {
    responder(403, { cuerpo: JSON.stringify({ message: 'rol insuficiente' }) })

    const err = await descargarLoteInspecciones({}).catch((e: unknown) => e)

    expect((err as ApiError).status).toBe(403)
    expect(eventos).toEqual([])
  })

  it('sin señal responde ApiError 0 y no intenta leer el cuerpo', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })

    const err = await descargarLoteInspecciones({}).catch((e: unknown) => e)

    expect((err as ApiError).status).toBe(0)
  })

  it('el aislamiento por tenant es 404, no 403: el lote no delata que hay datos ajenos', async () => {
    // El filtro del tenant A con la sesión del B devuelve 404 (y no 403), porque
    // un 403 le confirmaría al supervisor que esas inspecciones existen en otro
    // lado (NFR-05).
    responder(404, { cuerpo: JSON.stringify({ message: 'el filtro no trae ninguna inspección del período: no hay nada que exportar' }) })

    const err = await descargarLoteInspecciones({ site_id: uuid(72) }).catch((e: unknown) => e)

    expect((err as ApiError).status).toBe(404)
  })
})
