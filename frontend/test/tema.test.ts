/* Modo claro / oscuro — TSK-OFF-005: elección, persistencia y barra del navegador. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLAVE_TEMA, COLOR_BARRA, aplicarTema, otroTema, temaGuardado, temaInicial } from '../src/lib/tema'

const meta = { content: '', setAttribute(_: string, v: string) { this.content = v } }
const raiz = { dataset: {} as Record<string, string> }
let guardado: Record<string, string> = {}

beforeEach(() => {
  raiz.dataset = { theme: 'dark' }
  meta.content = COLOR_BARRA.oscuro
  guardado = {}
  vi.stubGlobal('document', { documentElement: raiz, querySelector: () => meta })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => guardado[k] ?? null,
    setItem: (k: string, v: string) => {
      guardado[k] = v
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('tema', () => {
  it('sin elección o con un valor raro usa el modo oscuro; alterna entre los dos', () => {
    expect(temaGuardado(null)).toBe('oscuro')
    expect(temaGuardado('azul')).toBe('oscuro')
    expect(temaGuardado('claro')).toBe('claro')
    expect(otroTema('oscuro')).toBe('claro')
    expect(otroTema('claro')).toBe('oscuro')
  })

  it('aplicar el claro cambia <html>, la barra del navegador y lo recuerda', () => {
    aplicarTema('claro')
    expect(raiz.dataset.theme).toBe('light')
    expect(meta.content).toBe(COLOR_BARRA.claro)
    expect(guardado[CLAVE_TEMA]).toBe('claro')
    aplicarTema('oscuro')
    expect(raiz.dataset.theme).toBe('dark')
    expect(meta.content).toBe(COLOR_BARRA.oscuro)
  })

  it('si el almacenamiento falla, el cambio igual se aplica en la sesión', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('bloqueado')
      },
    })
    expect(() => aplicarTema('claro')).not.toThrow()
    expect(raiz.dataset.theme).toBe('light')
  })

  it('sin elección sigue el tema del sistema; una elección guardada manda (TSK-OFF-011)', () => {
    expect(temaInicial(null, true)).toBe('claro')
    expect(temaInicial(null, false)).toBe('oscuro')
    expect(temaInicial('raro', true)).toBe('claro')
    expect(temaInicial('oscuro', true)).toBe('oscuro')
    expect(temaInicial('claro', false)).toBe('claro')
  })
})
