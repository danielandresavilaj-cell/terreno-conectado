import { describe, expect, it } from 'vitest'
import { instruccionesInstalacion } from '../src/components/PwaInstalacion'

describe('instalación de la PWA', () => {
  it('explica la instalación manual en navegadores sin prompt', () => {
    expect(instruccionesInstalacion(false)).toContain('Instalar aplicación')
  })

  it('da la ruta propia de Safari en iOS', () => {
    expect(instruccionesInstalacion(true)).toContain('Añadir a pantalla de inicio')
  })
})
