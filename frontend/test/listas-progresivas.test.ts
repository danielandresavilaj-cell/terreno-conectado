import { describe, expect, it } from 'vitest'
import type { FindingDto } from '@terreno/shared'
import { ordenarHallazgosPorPrioridad, ordenarPorFechaReciente, siguienteLimite, TANDA_LISTADO } from '../src/lib/listas-progresivas'

function hallazgo(parcial: Partial<FindingDto> = {}): FindingDto {
  return {
    id: crypto.randomUUID(),
    severity: 'low',
    status: 'open',
    description: 'Hallazgo de prueba',
    faena_id: null,
    faena_nombre: null,
    autor_id: null,
    autor: null,
    captured_at: '2026-11-10T10:00:00.000Z',
    synced_at: null,
    foto_id: null,
    fotos_ids: [],
    foto_mime: null,
    foto_bytes: null,
    foto_ancho: null,
    foto_alto: null,
    assignee_id: null,
    responsable: null,
    due_date: null,
    resolution_note: null,
    progress_note: null,
    reported_at: null,
    ...parcial,
  }
}

describe('listas progresivas de Gerencia', () => {
  it('avanza de cinco en cinco sin sobrepasar el total', () => {
    expect(TANDA_LISTADO).toBe(5)
    expect(siguienteLimite(5, 26)).toBe(10)
    expect(siguienteLimite(25, 26)).toBe(26)
  })

  it('pone vencidos, severidad y fecha en el orden de atención', () => {
    const recienteBajo = hallazgo({ id: 'reciente-bajo', severity: 'low', captured_at: '2026-11-11T10:00:00.000Z' })
    const critico = hallazgo({ id: 'critico', severity: 'critical' })
    const vencido = hallazgo({ id: 'vencido', severity: 'medium', due_date: '2026-11-09' })
    const recienteAlto = hallazgo({ id: 'reciente-alto', severity: 'high', captured_at: '2026-11-12T10:00:00.000Z' })

    expect(ordenarHallazgosPorPrioridad([recienteBajo, critico, vencido, recienteAlto], '2026-11-10').map((h) => h.id))
      .toEqual(['vencido', 'critico', 'reciente-alto', 'reciente-bajo'])
  })

  it('mantiene inspecciones y bitácora de la más reciente a la más antigua', () => {
    expect(ordenarPorFechaReciente([{ captured_at: '2026-11-10', id: 1 }, { captured_at: '2026-11-12', id: 2 }]).map((x) => x.id))
      .toEqual([2, 1])
  })
})
