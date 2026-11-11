/* TSK-AUTH-010 — el access token vive en memoria y se renueva con la cookie
 * de sesión. Ante un 401 el cliente pide un token nuevo y reintenta una vez;
 * si el refresh también falla se emite `tc:logout`, y sin red no se cierra la
 * sesión (el usuario sigue en modo sin conexión). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, clearToken, getSites, getToken, refrescarToken, setToken } from '../src/lib/api'

interface Llamada {
  url: string
  headers: Record<string, string>
}

let respuestas: Array<() => Response> = []
let llamadas: Llamada[] = []
let eventos: string[] = []

beforeEach(() => {
  respuestas = []
  llamadas = []
  eventos = []
  clearToken()
  vi.stubGlobal('document', { cookie: 'otra=1; csrf=token-csrf' })
  vi.stubGlobal('window', {
    dispatchEvent: (e: Event) => void eventos.push(e.type + ((e as CustomEvent).detail ? `:${(e as CustomEvent).detail}` : '')),
  })
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    llamadas.push({ url, headers: (init.headers ?? {}) as Record<string, string> })
    const r = respuestas.shift()
    if (!r) throw new TypeError('Failed to fetch')
    return r()
  })
})

afterEach(() => vi.unstubAllGlobals())

const json = (status: number, cuerpo: unknown) => () =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } })

const SITES = { tenant: { id: 't', nombre: 'Empresa' }, items: [] }

describe('refresh de sesión (TSK-AUTH-010)', () => {
  it('ante un 401 renueva el token con la cookie csrf y reintenta una vez', async () => {
    setToken('vencido')
    respuestas.push(json(401, {}), json(200, { access_token: 'nuevo' }), json(200, SITES))

    await expect(getSites()).resolves.toEqual(SITES)

    expect(llamadas[1].url).toMatch(/\/auth\/refresh$/)
    expect(llamadas[1].headers['x-csrf-token']).toBe('token-csrf')
    expect(llamadas[2].headers.Authorization).toBe('Bearer nuevo')
    expect(getToken()).toBe('nuevo')
    expect(eventos).toEqual([])
  })

  it('si el refresh falla, cierra la sesión con tc:logout', async () => {
    setToken('vencido')
    respuestas.push(json(401, {}), json(401, { message: 'Sesión expirada' }))

    await expect(getSites()).rejects.toMatchObject({ status: 401 })
    expect(eventos).toContain('tc:logout')
    expect(getToken()).toBeNull()
  })

  it('sin red no cierra la sesión: rechaza con status 0', async () => {
    setToken('vencido')
    respuestas.push(json(401, {}))

    const err = await getSites().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
    expect(eventos).not.toContain('tc:logout')
  })

  it('sin cookie csrf no intenta el refresh', async () => {
    vi.stubGlobal('document', { cookie: '' })
    await expect(refrescarToken()).rejects.toMatchObject({ status: 401 })
    expect(llamadas).toHaveLength(0)
  })

  it('varios 401 simultáneos comparten un solo refresh', async () => {
    respuestas.push(json(200, { access_token: 'uno' }))
    const [a, b] = await Promise.all([refrescarToken(), refrescarToken()])
    expect(a).toBe('uno')
    expect(b).toBe('uno')
    expect(llamadas).toHaveLength(1)
  })

  it('si otro dispositivo tomó la sesión, avisa con session_replaced (TSK-AUTH-011)', async () => {
    setToken('vencido')
    respuestas.push(json(401, {}), json(401, { code: 'session_replaced' }))
    await expect(getSites()).rejects.toMatchObject({ status: 401, codigo: 'session_replaced' })
    expect(eventos).toContain('tc:logout:session_replaced')
  })

  it('serializa el refresh entre pestañas con navigator.locks (TSK-AUTH-011)', async () => {
    const pedidos: string[] = []
    vi.stubGlobal('navigator', {
      locks: { request: async (nombre: string, fn: () => Promise<unknown>) => { pedidos.push(nombre); return fn() } },
    })
    respuestas.push(json(200, { access_token: 'conlock' }))
    await expect(refrescarToken()).resolves.toBe('conlock')
    expect(pedidos).toEqual(['tc-refresh'])
  })
})
