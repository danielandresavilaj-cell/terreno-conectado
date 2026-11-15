/* Contenido del QR — TSK-OPS-003-C (FR-061: entrada manual). */
import { describe, expect, it } from 'vitest'
import { normalizarQr } from './assets'

describe('normalizarQr', () => {
  const token = 'Ab3_dE-fGh1JkL2mNo4PqR'
  it('acepta el contenido completo o sólo el token, con espacios', () => {
    expect(normalizarQr(`tc1:${token}`)).toBe(`tc1:${token}`)
    expect(normalizarQr(`  TC1:${token} `)).toBe(`tc1:${token}`)
    expect(normalizarQr(token)).toBe(`tc1:${token}`)
    expect(normalizarQr('Ab3_ dE-fGh1 JkL2mNo4PqR')).toBe(`tc1:${token}`)
  })

  it('rechaza lo que no parece un QR de la app', () => {
    expect(normalizarQr('')).toBeNull()
    expect(normalizarQr('https://otro.sitio/qr')).toBeNull()
    expect(normalizarQr('corto')).toBeNull()
  })
})
