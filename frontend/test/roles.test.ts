/* Subtítulo del encabezado por rol — TSK-ADM-004 (#245). */
import { describe, expect, it } from 'vitest'
import { subtituloEncabezado } from '../src/lib/roles'

describe('subtituloEncabezado', () => {
  it('el admin de plataforma ve su alcance global, no una faena', () => {
    expect(subtituloEncabezado({ rol: 'platform_admin', faena: 'Chuquicamata' })).toBe('Administrador de plataforma')
    expect(subtituloEncabezado({ rol: 'platform_admin', faena: '—' })).toBe('Administrador de plataforma')
  })

  it('los roles de empresa siguen viendo su faena actual', () => {
    expect(subtituloEncabezado({ rol: 'field_worker', faena: 'Faena Cerro Plata' })).toBe('Faena Cerro Plata')
    expect(subtituloEncabezado({ rol: 'supervisor', faena: 'Planta Llano Seco' })).toBe('Planta Llano Seco')
    expect(subtituloEncabezado({ rol: 'tenant_admin', faena: 'Obra Camino del Cobre' })).toBe('Obra Camino del Cobre')
  })

  it('sin faena conocida muestra un guion', () => {
    expect(subtituloEncabezado({ rol: 'field_worker', faena: '' })).toBe('—')
  })
})
