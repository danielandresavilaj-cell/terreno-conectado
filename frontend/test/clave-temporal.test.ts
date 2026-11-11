/* TSK-ADM-001 — la clave temporal se dicta o copia a mano: largo fijo, sin
 * caracteres ambiguos y distinta en cada llamada. */
import { describe, expect, it } from 'vitest'
import { generarClaveTemporal } from '../src/lib/clave'

describe('generarClaveTemporal', () => {
  it('respeta el largo y evita 0/O/1/l/I', () => {
    for (let i = 0; i < 200; i++) {
      const c = generarClaveTemporal(14)
      expect(c).toHaveLength(14)
      expect(c).not.toMatch(/[0O1lI]/)
    }
  })

  it('no repite claves', () => {
    const vistas = new Set(Array.from({ length: 500 }, () => generarClaveTemporal()))
    expect(vistas.size).toBe(500)
  })
})
