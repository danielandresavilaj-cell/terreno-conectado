import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HallazgoAsignadoDto } from '@terreno/shared'
import { db } from '../src/lib/db'
import {
  actualizarAsignados,
  contarNuevos,
  estadoAsignado,
  guardarBorradorReporte,
  leerAsignados,
  leerBorradorReporte,
  leerVistos,
  marcarVisto,
} from '../src/lib/hallazgos-asignados'
import { getHallazgosAsignados, getToken } from '../src/lib/api'
import { TENANT_A, uuid } from './fixtures'

vi.mock('../src/lib/api', () => ({ getHallazgosAsignados: vi.fn(), getToken: vi.fn() }))

const trabajador = { tenantId: TENANT_A, id: uuid(40) }
const otro = { tenantId: TENANT_A, id: uuid(41) }

function hallazgo(n: number, extra: Partial<HallazgoAsignadoDto> = {}): HallazgoAsignadoDto {
  return {
    id: uuid(50 + n),
    severity: 'high',
    status: 'open',
    description: `Hallazgo ${n}`,
    due_date: null,
    assigned_at: '2026-11-15T10:00:00.000Z',
    progress_note: null,
    reported_at: null,
    resolution_note: null,
    resolved_at: null,
    faena: 'Faena El Roble',
    formulario: 'Checklist',
    pregunta: null,
    inspeccion_at: null,
    autor: null,
    fotos_ids: [],
    ...extra,
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  vi.resetAllMocks()
  vi.mocked(getToken).mockReturnValue('token-de-prueba')
})

describe('lista de hallazgos asignados sin señal (TSK-DOM-008, FR-067)', () => {
  it('guarda la última lista por cuenta y la entrega sin red', async () => {
    const uno = hallazgo(1)
    vi.mocked(getHallazgosAsignados).mockResolvedValueOnce([uno])
    expect(await actualizarAsignados(trabajador)).toEqual({ items: [uno], enRed: true })

    vi.mocked(getHallazgosAsignados).mockRejectedValueOnce(new Error('offline'))
    expect(await actualizarAsignados(trabajador)).toEqual({ items: [uno], enRed: false })
    expect(await leerAsignados(trabajador)).toEqual([uno])
    // Un teléfono compartido no muestra los hallazgos de otra persona.
    expect(await leerAsignados(otro)).toEqual([])
  })

  it('sin sesión no pide nada y conserva la lista', async () => {
    vi.mocked(getToken).mockReturnValue(null)
    expect(await actualizarAsignados(trabajador)).toEqual({ items: [], enRed: false })
    expect(getHallazgosAsignados).not.toHaveBeenCalled()
  })
})

describe('aviso de hallazgos nuevos', () => {
  it('cuenta los asignados que no he abierto; los resueltos no cuentan', async () => {
    const lista = [hallazgo(1), hallazgo(2), hallazgo(3, { status: 'resolved' })]
    expect(contarNuevos(lista, await leerVistos(trabajador))).toBe(2)
    const vistos = await marcarVisto(trabajador, lista[0], lista)
    expect(contarNuevos(lista, vistos)).toBe(1)
    expect(await leerVistos(otro)).toEqual({})
  })

  it('si me lo vuelven a asignar más tarde, vuelve a ser nuevo', async () => {
    const h = hallazgo(1)
    const vistos = await marcarVisto(trabajador, h, [h])
    expect(contarNuevos([h], vistos)).toBe(0)
    const reasignado = { ...h, assigned_at: '2026-11-16T08:00:00.000Z' }
    expect(contarNuevos([reasignado], vistos)).toBe(1)
  })

  it('olvida los vistos que ya no están en la lista', async () => {
    const a = hallazgo(1)
    const b = hallazgo(2)
    await marcarVisto(trabajador, a, [a, b])
    const vistos = await marcarVisto(trabajador, b, [b])
    expect(Object.keys(vistos)).toEqual([b.id])
  })
})

describe('estado que lee la persona', () => {
  it('nuevo, pendiente, en curso, listo para revisar y resuelto', () => {
    const h = hallazgo(1)
    expect(estadoAsignado(h, {})).toBe('nuevo')
    expect(estadoAsignado(h, { [h.id]: h.assigned_at })).toBe('pendiente')
    expect(estadoAsignado({ ...h, status: 'in_progress' }, {})).toBe('en-curso')
    expect(estadoAsignado({ ...h, status: 'in_progress', reported_at: '2026-11-15T12:00:00.000Z' }, {})).toBe('listo')
    expect(estadoAsignado({ ...h, status: 'resolved' }, {})).toBe('resuelto')
  })
})

describe('borrador del reporte escrito sin señal', () => {
  it('queda en el teléfono por hallazgo y cuenta, y se borra al vaciarlo', async () => {
    const h = hallazgo(1)
    await guardarBorradorReporte(trabajador, h.id, 'Se reinstaló la barrera')
    expect(await leerBorradorReporte(trabajador, h.id)).toBe('Se reinstaló la barrera')
    expect(await leerBorradorReporte(otro, h.id)).toBe('')
    await guardarBorradorReporte(trabajador, h.id, '   ')
    expect(await leerBorradorReporte(trabajador, h.id)).toBe('')
  })
})
