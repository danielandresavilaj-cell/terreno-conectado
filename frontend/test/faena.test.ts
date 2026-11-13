import { describe, expect, it } from 'vitest'
import { elegirFaenaInicial, motivoParaNoCambiar } from '../src/lib/faena'
import type { Faena } from '../src/lib/types'

const faena = (id: string): Faena => ({ id, nombre: `Faena ${id}`, tipo: 'mina', region: '' })
const A = faena('a')
const B = faena('b')

describe('faena de la sesión (TSK-OFF-010, FR-034)', () => {
  it('con una sola faena no hay nada que elegir', () => {
    expect(elegirFaenaInicial([A], null, null)).toEqual({ faena: A, porElegir: false })
  })

  it('con varias y sin elección previa parte en la primera y pide elegir', () => {
    expect(elegirFaenaInicial([A, B], null, null)).toEqual({ faena: A, porElegir: true })
  })

  it('recuerda la última faena elegida en este equipo', () => {
    expect(elegirFaenaInicial([A, B], 'b', null)).toEqual({ faena: B, porElegir: false })
  })

  it('la inspección en curso manda sobre la elección guardada', () => {
    expect(elegirFaenaInicial([A, B], 'a', 'b')).toEqual({ faena: B, porElegir: false })
  })

  it('ignora una faena guardada que ya no existe en la empresa', () => {
    expect(elegirFaenaInicial([A, B], 'borrada', null)).toEqual({ faena: A, porElegir: true })
    expect(elegirFaenaInicial([A, B], 'b', 'borrada')).toEqual({ faena: B, porElegir: false })
  })

  it('una empresa sin faenas no revienta', () => {
    expect(elegirFaenaInicial([], null, null)).toEqual({ faena: null, porElegir: false })
  })

  it('no deja cambiar de faena con una inspección sin enviar', () => {
    expect(motivoParaNoCambiar([A, B], 'b', true)).toMatch(/sin enviar/)
    expect(motivoParaNoCambiar([A, B], 'b', false)).toBeNull()
    expect(motivoParaNoCambiar([A, B], 'z', false)).toMatch(/ya no existe/)
  })
})
