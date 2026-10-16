import { describe, expect, it } from 'vitest'
import {
  esEdicionNumericaPosible,
  numeroDesdeEdicion,
  numeroDentroDeRango,
} from '../src/lib/campo-numerico'

describe('edición de campos numéricos', () => {
  it('permite escribir un valor por etapas aunque su primer dígito esté bajo el mínimo', () => {
    expect(esEdicionNumericaPosible('2')).toBe(true)
    expect(numeroDesdeEdicion('2')).toBe(2)
    expect(numeroDentroDeRango(2, { min: 10, max: 45 })).toBe(false)

    expect(esEdicionNumericaPosible('25')).toBe(true)
    expect(numeroDesdeEdicion('25')).toBe(25)
    expect(numeroDentroDeRango(25, { min: 10, max: 45 })).toBe(true)
  })

  it('conserva estados parciales y acepta coma decimal', () => {
    expect(esEdicionNumericaPosible('-')).toBe(true)
    expect(numeroDesdeEdicion('-')).toBeNull()
    expect(esEdicionNumericaPosible('18,')).toBe(true)
    expect(numeroDesdeEdicion('18,')).toBeNull()
    expect(numeroDesdeEdicion('18,5')).toBe(18.5)
  })
})
