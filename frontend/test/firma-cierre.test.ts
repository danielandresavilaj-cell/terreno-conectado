import { describe, expect, it } from 'vitest'
import { firmaTieneTrazo, puntoNormalizado } from '../src/components/FirmaCierre'

describe('firma de cierre', () => {
  it('normaliza el trazo para que no dependa del tamaño del teléfono', () => {
    expect(puntoNormalizado(60, 45, { left: 10, top: 5, width: 100, height: 80 })).toEqual({ x: 500, y: 500 })
    expect(puntoNormalizado(-10, 300, { left: 0, top: 0, width: 100, height: 100 })).toEqual({ x: 0, y: 1000 })
  })

  it('no acepta un toque aislado como firma', () => {
    expect(firmaTieneTrazo([])).toBe(false)
    expect(firmaTieneTrazo([{ points: [{ x: 1, y: 1 }] }])).toBe(false)
    expect(firmaTieneTrazo([{ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }])).toBe(true)
  })
})
