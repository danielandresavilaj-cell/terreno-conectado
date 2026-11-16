/* Desplegar y plegar sin perder el lugar — TSK-REP-019. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asomarSiQuedoArriba, conservarPosicion } from '../src/lib/anclar'

/* El entorno de pruebas es `node` (sin DOM): basta con lo que usa `anclar`. */
function elementoEn(top: () => number): HTMLElement {
  return { isConnected: true, getBoundingClientRect: () => ({ top: top() }) } as unknown as HTMLElement
}

describe('anclar', () => {
  let desplazado: number[]
  beforeEach(() => {
    desplazado = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    vi.stubGlobal('window', { scrollBy: (_x: number, y: number) => desplazado.push(y) })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('si al abrir se pliega un detalle de arriba, compensa para que la ficha tocada no salte', () => {
    let top = 500
    const boton = elementoEn(() => top)
    conservarPosicion(boton, () => {
      top = 120 // se plegó un detalle de 380 px más arriba
    })
    expect(desplazado).toEqual([-380])
  })

  it('si nada se movió, no desplaza', () => {
    const boton = elementoEn(() => 300)
    conservarPosicion(boton, () => {})
    expect(desplazado).toEqual([])
  })

  it('al plegar, trae la ficha bajo la barra superior sólo si quedó por encima', () => {
    asomarSiQuedoArriba(elementoEn(() => -400))
    expect(desplazado).toEqual([-472])
    desplazado = []
    asomarSiQuedoArriba(elementoEn(() => 200))
    expect(desplazado).toEqual([])
  })
})
