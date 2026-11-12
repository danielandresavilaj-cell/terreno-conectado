/* Importar con IA — TSK-FORM-021: cliente de la API (motor, capacidades, reintento). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analizarImportConIA, getCapacidadesImport, setToken, subirImportOriginal } from '../src/lib/api'

const llamadas: { url: string; method?: string; body: unknown }[] = []
let respuesta: () => Response

beforeEach(() => {
  llamadas.length = 0
  setToken('t')
  vi.stubGlobal('window', { dispatchEvent: () => true })
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    llamadas.push({ url, method: init.method, body: init.body })
    return respuesta()
  })
})
afterEach(() => vi.unstubAllGlobals())

const json = (b: unknown) => () => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('cliente de importar con IA', () => {
  it('sube con motor "ia" como campo del formulario; con reglas no lo manda', async () => {
    respuesta = json({ id: 'i1', status: 'proposed', motor: 'ia' })
    const foto = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'pauta.jpg', { type: 'image/jpeg' })
    await subirImportOriginal(foto, 'ia')
    const fd = llamadas[0].body as FormData
    expect(llamadas[0].url).toContain('/templates/imports')
    expect(fd.get('motor')).toBe('ia')
    expect((fd.get('file') as File).name).toBe('pauta.jpg')

    await subirImportOriginal(foto)
    expect((llamadas[1].body as FormData).has('motor')).toBe(false)
  })

  it('capacidades y reintento con IA', async () => {
    respuesta = json({ ia: true, restantes_hoy: 7, tope_diario: 20 })
    expect(await getCapacidadesImport()).toEqual({ ia: true, restantes_hoy: 7, tope_diario: 20 })
    expect(llamadas[0].url).toContain('/templates/imports/capacidades')

    respuesta = json({ id: 'abc', status: 'proposed', motor: 'ia' })
    const r = await analizarImportConIA('abc')
    expect(llamadas[1]).toMatchObject({ method: 'POST' })
    expect(llamadas[1].url).toContain('/templates/imports/abc/analizar-ia')
    expect(r.motor).toBe('ia')
  })
})
