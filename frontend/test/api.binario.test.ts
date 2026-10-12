/* Cliente binario del documento original (TSK-FORM-009, FR-018).
 *
 * `apiFetch` SIEMPRE acaba en `resp.json()`, así que el `.xlsx` necesita su
 * propia ruta. Lo que se fija aquí es el contrato de esa ruta: devuelve BYTES,
 * toma el nombre de la ÚNICA cabecera que lo transporta (`Content-Disposition`,
 * con su `filename*` percent-encoded porque un header HTTP sólo habla latin1),
 * respeta el `tc:logout` en 401 como el resto del cliente y traduce un 404 en
 * `ApiError` para que el llamador NO lo reintente (FR-009: un 404 es "no
 * visible para ti", no un fallo transitorio).
 *
 * El nombre NO se parsea aquí: el parseo es del contrato compartido y tiene sus
 * propios tests. Lo que este fichero fija es la decisión del cliente — el
 * fallback por `revision_id` cuando no hay nombre legible — porque ésa es
 * información que el parser no tiene.
 *
 * El runner es `environment: 'node'` a propósito, así que `window` y
 * `sessionStorage` se inyectan: en el navegador existen, en el test hay que
 * fingirlos para poder observar el evento de logout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  EVENTO_LOGOUT,
  getPlantillaOriginal,
  setToken,
} from '../src/lib/api'
import { uuid } from './fixtures'

const DESCRIPCIONES: { status: number; headers?: Record<string, string>; cuerpo?: string }[] = []
let eventos: string[] = []

function responder(status: number, init: { headers?: Record<string, string>; cuerpo?: string } = {}) {
  DESCRIPCIONES.push({ status, ...init })
}

beforeEach(() => {
  DESCRIPCIONES.length = 0
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
  vi.stubGlobal('fetch', async () => {
    const d = DESCRIPCIONES.shift()
    if (!d) throw new Error('fetch sin respuesta preparada')
    return new Response(d.cuerpo ?? null, { status: d.status, headers: d.headers })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET del documento original', () => {
  it('devuelve los bytes y el nombre que viaja en `Content-Disposition`', async () => {
    const nombre = 'Chequeo de seguridad — revisión Nº2 (Ñuñoa).xlsx'
    // Lo que compone `contentDisposition()` en el backend: la `filename` ASCII
    // es el respaldo y la `filename*` UTF-8 el valor real.
    const ascii = 'Chequeo de seguridad - revision N2 (Nunoa).xlsx'
    responder(200, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      },
      cuerpo: 'PKcontenido-del-libro',
    })
    setToken('token-de-prueba')

    const r = await getPlantillaOriginal(uuid(11))

    expect(await r.bytes.text()).toBe('PKcontenido-del-libro')
    // Sin decodificar la `filename*` el nombre se persistiría con la ñ y la º
    // corruptas en la caché local del original (FR-019).
    expect(r.fileName).toBe(nombre)
  })

  it('sin cabecera legible cae al nombre derivado del `revision_id`', async () => {
    const revisionId = uuid(11)
    // Es lo que ve el navegador cuando `Content-Disposition` no está en
    // `Access-Control-Expose-Headers`: `headers.get` devuelve `null` y el
    // nombre original se pierde. El cliente no puede tumbar la descarga por eso.
    responder(200, { cuerpo: 'PKcontenido-del-libro' })

    const r = await getPlantillaOriginal(revisionId)

    expect(await r.bytes.text()).toBe('PKcontenido-del-libro')
    expect(r.fileName).toBe(`${revisionId}.xlsx`)
  })

  it('un nombre no utilizable (percent-encoding roto) también cae al fallback', async () => {
    const revisionId = uuid(11)
    responder(200, {
      headers: { 'Content-Disposition': "attachment; filename*=UTF-8''100% roto.xlsx" },
      cuerpo: 'PK',
    })

    const r = await getPlantillaOriginal(revisionId)

    expect(await r.bytes.text()).toBe('PK')
    expect(r.fileName).toBe(`${revisionId}.xlsx`)
  })

  it('el 401 dispara `tc:logout` como el resto del cliente', async () => {
    responder(401, { cuerpo: JSON.stringify({ message: 'Sesión expirada' }) })

    await expect(getPlantillaOriginal(uuid(11))).rejects.toBeInstanceOf(ApiError)
    expect(eventos).toEqual([EVENTO_LOGOUT])
  })

  it('un 404 (no visible para ti) llega como ApiError, no como excepción opaca', async () => {
    responder(404, { cuerpo: JSON.stringify({ message: 'Revisión no encontrada' }) })

    const err = await getPlantillaOriginal(uuid(11)).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).detalle).toBe('Revisión no encontrada')
    // Un 404 no es una sesión inválida: no debe cerrar la sesión.
    expect(eventos).toEqual([])
  })

  it('sin señal responde ApiError 0 y no intenta leer el cuerpo', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })

    const err = await getPlantillaOriginal(uuid(11)).catch((e: unknown) => e)

    expect((err as ApiError).status).toBe(0)
  })

  it('manda la faena activa para que el backend filtre por asignación (FR-009)', async () => {
    const llamado: string[] = []
    responder(200, {
      headers: { 'Content-Disposition': "attachment; filename=libro.xlsx" },
      cuerpo: 'PK',
    })
    vi.stubGlobal('fetch', async (url: string) => {
      llamado.push(url)
      return new Response('PK', { status: 200 })
    })

    await getPlantillaOriginal(uuid(11), uuid(50))

    expect(llamado[0]).toContain(`/templates/revisions/${uuid(11)}/original`)
    expect(llamado[0]).toContain(`site_id=${uuid(50)}`)
  })
})