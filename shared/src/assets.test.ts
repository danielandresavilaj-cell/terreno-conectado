/* Contenido del QR — TSK-OPS-003-C (FR-061: entrada manual). */
import { describe, expect, it } from 'vitest'
import { normalizarQr } from './assets'

describe('normalizarQr', () => {
  // Valor de ejemplo de baja entropía: un token real es aleatorio (y el escáner
  // de secretos marca con razón cualquier literal que lo parezca).
  const codigo = 'abcdefghijklmnopqrstuv'
  it('acepta el contenido completo o sólo el token, con espacios', () => {
    expect(normalizarQr(`tc1:${codigo}`)).toBe(`tc1:${codigo}`)
    expect(normalizarQr(`  TC1:${codigo} `)).toBe(`tc1:${codigo}`)
    expect(normalizarQr(codigo)).toBe(`tc1:${codigo}`)
    expect(normalizarQr('abcdefgh ijklmno pqrstuv')).toBe(`tc1:${codigo}`)
  })

  it('rechaza lo que no parece un QR de la app', () => {
    expect(normalizarQr('')).toBeNull()
    expect(normalizarQr('https://otro.sitio/qr')).toBeNull()
    expect(normalizarQr('corto')).toBeNull()
  })
})
