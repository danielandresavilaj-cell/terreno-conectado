import { describe, expect, it } from 'vitest'
import { elegirFaenaInicial } from '../src/lib/faena'
import type { Faena } from '../src/lib/types'

/* TSK-ADM-003 (FR-065): el teléfono recibe de `GET /sites` sólo las faenas
 * asignadas a la cuenta. La elección de faena (TSK-OFF-010) tiene que seguir
 * funcionando con esa lista reducida. */

const faena = (id: string): Faena => ({ id, nombre: `Faena ${id}`, tipo: 'mina', region: '' })

describe('faena de la sesión con faenas limitadas (TSK-ADM-003)', () => {
  it('con una sola faena asignada no pide elegir', () => {
    expect(elegirFaenaInicial([faena('b')], null, null)).toEqual({ faena: faena('b'), porElegir: false })
  })

  it('una elección guardada de una faena que le quitaron se ignora', () => {
    expect(elegirFaenaInicial([faena('b'), faena('c')], 'a', null)).toEqual({ faena: faena('b'), porElegir: true })
  })

  it('un borrador de una faena que le quitaron no la impone', () => {
    expect(elegirFaenaInicial([faena('b')], null, 'a')).toEqual({ faena: faena('b'), porElegir: false })
  })
})
