import { describe, expect, it } from 'vitest'
import { mensajeErrorCamara } from '../src/components/CamaraCaptura'

describe('mensajes de cámara', () => {
  it('explica permisos y deja claro que se puede usar un archivo', () => {
    expect(mensajeErrorCamara(new DOMException('', 'NotAllowedError'))).toContain('seleccionar un archivo')
  })

  it('distingue la ausencia de una cámara de un error genérico', () => {
    expect(mensajeErrorCamara(new DOMException('', 'NotFoundError'))).toContain('cámara disponible')
    expect(mensajeErrorCamara(new Error('falló'))).toContain('No se pudo iniciar')
  })
})
