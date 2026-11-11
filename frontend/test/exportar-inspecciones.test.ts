/* Exportar inspecciones — TSK-REP-007: períodos, cuerpo de la petición y cliente. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, exportarInspecciones, setToken } from '../src/lib/api'
import { rangoPeriodo } from '../src/lib/periodos'
import { cuerpoExportacion } from '../src/components/dashboard/PanelExportar'

const llamadas: { url: string; body: unknown }[] = []
let respuesta: Response

beforeEach(() => {
  llamadas.length = 0
  setToken('t')
  vi.stubGlobal('window', { dispatchEvent: () => true })
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    llamadas.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body })
    return respuesta
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('períodos', () => {
  const ahora = new Date(2026, 10, 15, 10, 0, 0) // 15-nov-2026 local

  it('mes actual y mes anterior son meses calendario', () => {
    expect(new Date(rangoPeriodo('Este mes', undefined, ahora).desde!).getDate()).toBe(1)
    const ant = rangoPeriodo('Mes anterior', undefined, ahora)
    const desde = new Date(ant.desde!)
    const hasta = new Date(ant.hasta!)
    expect([desde.getMonth(), desde.getDate()]).toEqual([9, 1])
    expect([hasta.getMonth(), hasta.getDate(), hasta.getHours()]).toEqual([9, 31, 23])
  })

  it('rango libre incluye el día final completo; vacío = sin límite', () => {
    const r = rangoPeriodo('Rango', { desde: '2026-11-01', hasta: '2026-11-03' }, ahora)
    expect(new Date(r.hasta!).getHours()).toBe(23)
    expect(rangoPeriodo('Rango', { desde: '', hasta: '' }, ahora)).toEqual({ desde: undefined, hasta: undefined })
  })
})

describe('cuerpo de la exportación', () => {
  const filtros = { site_id: 'f', desde: 'a', hasta: 'b', template_id: 't' }

  it('con selección manda sólo los ids; sin selección, el filtro', () => {
    expect(cuerpoExportacion(filtros, ['x', 'y'], 'xlsx_consolidado', 'zip')).toEqual({ ids: ['x', 'y'], formato: 'xlsx_consolidado' })
    expect(cuerpoExportacion(filtros, [], 'pdf', 'zip')).toEqual({ ...filtros, formato: 'pdf', agrupar: 'zip' })
  })
})

describe('cliente exportarInspecciones', () => {
  it('devuelve bytes, nombre, MIME y conteos', async () => {
    respuesta = new Response(new Uint8Array([37, 80, 68, 70]), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': "attachment; filename=\"x.pdf\"; filename*=UTF-8''inspecciones_varios.pdf",
        'X-Export-Exportadas': '3',
        'X-Export-Fallidas': '0',
      },
    })
    const r = await exportarInspecciones({ formato: 'pdf', ids: ['a'] })
    expect(llamadas[0].url).toContain('/dashboard/inspections/exportar')
    expect(llamadas[0].body).toEqual({ formato: 'pdf', ids: ['a'] })
    expect([r.fileName, r.mime, r.exportadas, r.fallidas, r.bytes.length]).toEqual(['inspecciones_varios.pdf', 'application/pdf', 3, 0, 4])
  })

  it('413 llega como ApiError con el motivo del servidor', async () => {
    respuesta = new Response(JSON.stringify({ statusCode: 413, message: 'hay más de 100 inspecciones' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    })
    await expect(exportarInspecciones({ formato: 'pdf' })).rejects.toBeInstanceOf(ApiError)
  })
})
