/* Subtítulo del encabezado por rol — TSK-ADM-004 (#245). */
import { describe, expect, it } from 'vitest'
import { subtituloEncabezado } from '../src/lib/roles'

describe('subtituloEncabezado', () => {
  it('el admin de plataforma ve su alcance global, no una faena', () => {
    expect(subtituloEncabezado({ rol: 'platform_admin', faena: 'Chuquicamata', tenant: '' })).toBe(
      'Administrador de plataforma',
    )
    expect(subtituloEncabezado({ rol: 'platform_admin', faena: '—', tenant: '' })).toBe('Administrador de plataforma')
  })

  it('el admin de empresa ve su empresa, no la primera faena de la lista', () => {
    expect(
      subtituloEncabezado({ rol: 'tenant_admin', faena: 'Chuquicamata', tenant: 'Minera Cordillera Austral SpA' }),
    ).toBe('Minera Cordillera Austral SpA')
    expect(subtituloEncabezado({ rol: 'tenant_admin', faena: 'Chuquicamata', tenant: '' })).toBe(
      'Administrador de empresa',
    )
  })

  it('quien captura sigue viendo su faena actual', () => {
    expect(subtituloEncabezado({ rol: 'field_worker', faena: 'Faena Cerro Plata', tenant: 'X' })).toBe('Faena Cerro Plata')
    expect(subtituloEncabezado({ rol: 'supervisor', faena: 'Planta Llano Seco', tenant: 'X' })).toBe('Planta Llano Seco')
  })

  it('sin faena conocida muestra un guion', () => {
    expect(subtituloEncabezado({ rol: 'field_worker', faena: '', tenant: 'X' })).toBe('—')
  })
})
