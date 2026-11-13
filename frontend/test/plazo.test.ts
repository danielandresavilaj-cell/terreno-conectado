import { describe, expect, it } from 'vitest'
import { estadoPlazo, hoyLocal, plazoSugerido } from '../src/lib/plazo'

describe('plazo de la acción correctiva (TSK-DOM-007)', () => {
  it('vencido, vence hoy, a tiempo y sin plazo', () => {
    expect(estadoPlazo('2026-11-12', 'open', '2026-11-13')).toBe('vencido')
    expect(estadoPlazo('2026-11-13', 'in_progress', '2026-11-13')).toBe('vence-hoy')
    expect(estadoPlazo('2026-11-20', 'open', '2026-11-13')).toBe('a-tiempo')
    expect(estadoPlazo(null, 'open', '2026-11-13')).toBe('sin-plazo')
  })

  it('un hallazgo resuelto no vence aunque el plazo haya pasado', () => {
    expect(estadoPlazo('2026-01-01', 'resolved', '2026-11-13')).toBe('cerrado')
  })

  it('sugiere plazos más cortos para lo más grave, en fecha local', () => {
    const ahora = new Date(2026, 10, 30, 22, 0)
    expect(hoyLocal(ahora)).toBe('2026-11-30')
    expect(plazoSugerido('critical', ahora)).toBe('2026-12-01')
    expect(plazoSugerido('high', ahora)).toBe('2026-12-03')
    expect(plazoSugerido('low', ahora)).toBe('2026-12-14')
  })
})
