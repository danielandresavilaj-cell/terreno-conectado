import { describe, expect, it } from 'vitest'
import { focoEnDialogo, mensajeErrorCamara } from '../src/components/CamaraCaptura'

describe('mensajes de cámara', () => {
  it('explica permisos y deja claro que se puede usar un archivo', () => {
    expect(mensajeErrorCamara(new DOMException('', 'NotAllowedError'))).toContain('seleccionar un archivo')
  })

  it('distingue la ausencia de una cámara de un error genérico', () => {
    expect(mensajeErrorCamara(new DOMException('', 'NotFoundError'))).toContain('cámara disponible')
    expect(mensajeErrorCamara(new Error('falló'))).toContain('No se pudo iniciar')
  })
})

describe('foco del diálogo de cámara', () => {
  it('mantiene Tab dentro del diálogo al llegar al último control', () => {
    expect(focoEnDialogo('Tab', false, 2, 3)).toBe(0)
    expect(focoEnDialogo('Tab', false, 1, 3)).toBeNull()
  })

  it('mantiene Shift+Tab dentro del diálogo al llegar al primer control', () => {
    expect(focoEnDialogo('Tab', true, 0, 3)).toBe(2)
    expect(focoEnDialogo('Escape', false, 0, 3)).toBeNull()
  })
})
