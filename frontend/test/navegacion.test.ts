import { afterEach, describe, expect, it } from 'vitest'
import {
  anotarPantalla,
  cerrarCapaSuperior,
  hayCapasAbiertas,
  iniciarHistorial,
  pantallaDeEntrada,
  pantallaDesdeHash,
  registrarCapa,
  resolverRetroceso,
  type HistorialNavegador,
} from '../src/lib/navegacion'

/** Historial de navegador mínimo: una pila con cursor, como el real. */
function historial() {
  const pila: Array<{ data: unknown; url: string }> = [{ data: null, url: '' }]
  let i = 0
  const h: HistorialNavegador & { atras(): void; urls(): string[]; hash(): string } = {
    get state() {
      return pila[i].data
    },
    pushState(data, _unused, url = '') {
      pila.splice(i + 1)
      pila.push({ data, url })
      i = pila.length - 1
    },
    replaceState(data, _unused, url = '') {
      pila[i] = { data, url }
    },
    atras() {
      if (i > 0) i -= 1
    },
    urls: () => pila.map((e) => e.url),
    hash: () => pila[i].url,
  }
  return h
}

afterEach(() => {
  while (cerrarCapaSuperior()) {
    /* deja el registro de capas vacío entre pruebas */
  }
})

describe('navegación con historial (TSK-OFF-008)', () => {
  it('lee la pantalla del fragmento y rechaza lo que no es una pantalla', () => {
    expect(pantallaDesdeHash('#captura')).toBe('captura')
    expect(pantallaDesdeHash('#/cola')).toBe('cola')
    expect(pantallaDesdeHash('#crear-formulario')).toBe('crear-formulario')
    expect(pantallaDesdeHash('#admin')).toBeNull()
    expect(pantallaDesdeHash('')).toBeNull()
  })

  it('prefiere el estado de la entrada y cae al fragmento si no lo trae', () => {
    expect(pantallaDeEntrada({ pantalla: 'cola' }, '#captura')).toBe('cola')
    expect(pantallaDeEntrada(null, '#captura')).toBe('captura')
    expect(pantallaDeEntrada({ pantalla: 'inventada' }, '#bitacora')).toBe('bitacora')
  })

  it('Atrás vuelve a la pantalla anterior', () => {
    const h = historial()
    iniciarHistorial(h, 'formularios')
    anotarPantalla(h, 'captura', 'agregar')
    anotarPantalla(h, 'cola', 'agregar')

    h.atras()
    expect(resolverRetroceso(h, h.hash(), 'cola')).toEqual({ tipo: 'pantalla', pantalla: 'captura' })
    h.atras()
    expect(resolverRetroceso(h, h.hash(), 'captura')).toEqual({ tipo: 'pantalla', pantalla: 'formularios' })
  })

  it('en la primera pantalla, Atrás avisa la salida en vez de cerrar sin más', () => {
    const h = historial()
    iniciarHistorial(h, 'formularios')

    h.atras()
    expect(resolverRetroceso(h, h.hash(), 'formularios')).toEqual({ tipo: 'salida' })
  })

  it('con un panel abierto, Atrás lo cierra y la pantalla no cambia', () => {
    const h = historial()
    iniciarHistorial(h, 'formularios')
    anotarPantalla(h, 'captura', 'agregar')
    let cerrado = false
    registrarCapa(() => {
      cerrado = true
    })

    h.atras()
    expect(resolverRetroceso(h, h.hash(), 'captura')).toEqual({ tipo: 'capa' })
    expect(cerrado).toBe(true)
    expect(hayCapasAbiertas()).toBe(false)
    // El historial queda como estaba: el siguiente Atrás sí navega.
    expect(h.hash()).toBe('#captura')
    h.atras()
    expect(resolverRetroceso(h, h.hash(), 'captura')).toEqual({ tipo: 'pantalla', pantalla: 'formularios' })
  })

  it('con un panel abierto en la primera pantalla, Atrás lo cierra y no sale', () => {
    const h = historial()
    iniciarHistorial(h, 'captura')
    let cerrado = false
    registrarCapa(() => {
      cerrado = true
    })

    h.atras()
    expect(resolverRetroceso(h, h.hash(), 'captura')).toEqual({ tipo: 'capa' })
    expect(cerrado).toBe(true)
    // Volvió a quedar una entrada encima de la guarda.
    h.atras()
    expect(resolverRetroceso(h, h.hash(), 'captura')).toEqual({ tipo: 'salida' })
  })

  it('cierra primero la capa de más arriba (cámara sobre hallazgo)', () => {
    const cierres: string[] = []
    registrarCapa(() => cierres.push('hallazgo'))
    registrarCapa(() => cierres.push('cámara'))

    expect(cerrarCapaSuperior()).toBe(true)
    expect(cierres).toEqual(['cámara'])
    expect(cerrarCapaSuperior()).toBe(true)
    expect(cierres).toEqual(['cámara', 'hallazgo'])
    expect(cerrarCapaSuperior()).toBe(false)
  })

  it('una capa que se cierra sola deja de responder al botón Atrás', () => {
    let cierres = 0
    const baja = registrarCapa(() => {
      cierres += 1
    })
    baja()
    expect(cerrarCapaSuperior()).toBe(false)
    expect(cierres).toBe(0)
  })

  it('una redirección reemplaza la entrada: no deja a dónde volver', () => {
    const h = historial()
    iniciarHistorial(h, 'captura')
    anotarPantalla(h, 'dashboard', 'reemplazar')

    expect(h.urls()).toEqual(['#captura', '#dashboard'])
    h.atras()
    expect(resolverRetroceso(h, h.hash(), 'dashboard')).toEqual({ tipo: 'salida' })
  })
})
