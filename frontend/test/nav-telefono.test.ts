/* Barra inferior del teléfono — TSK-OFF-022. */
import { describe, expect, it } from 'vitest'
import { llevaBarraInferior, repartirSecciones } from '../src/lib/nav-telefono'
import type { Pantalla } from '../src/lib/navegacion'

const TRABAJADOR: Pantalla[] = ['formularios', 'captura', 'bitacora', 'hallazgos', 'cola']
const SUPERVISOR: Pantalla[] = ['formularios', 'captura', 'bitacora', 'hallazgos', 'cola', 'dashboard', 'conflictos']
const ADMIN: Pantalla[] = ['hallazgos', 'cola', 'dashboard', 'administracion', 'conflictos', 'plantillas', 'importar']

describe('repartirSecciones', () => {
  it('con cinco secciones o menos van todas en la barra', () => {
    expect(repartirSecciones('field_worker', TRABAJADOR)).toEqual({ principales: TRABAJADOR, mas: [] })
  })

  it('supervisión: Formularios, Inspección, Hallazgos y Gerencia; el resto en Más', () => {
    expect(repartirSecciones('supervisor', SUPERVISOR)).toEqual({
      principales: ['formularios', 'captura', 'hallazgos', 'dashboard'],
      mas: ['bitacora', 'cola', 'conflictos'],
    })
  })

  it('administración: Hallazgos, Gerencia, Equipo y Plantillas; el resto en Más', () => {
    expect(repartirSecciones('tenant_admin', ADMIN)).toEqual({
      principales: ['hallazgos', 'dashboard', 'administracion', 'plantillas'],
      mas: ['cola', 'conflictos', 'importar'],
    })
  })

  it('nunca pierde ni repite una sección', () => {
    for (const [rol, secciones] of [
      ['supervisor', SUPERVISOR],
      ['tenant_admin', ADMIN],
    ] as const) {
      const { principales, mas } = repartirSecciones(rol, secciones)
      expect(principales).toHaveLength(4)
      expect([...principales, ...mas].sort()).toEqual([...secciones].sort())
    }
  })

  it('si una preferida no está, completa con las siguientes en orden', () => {
    const sinEquipo = ADMIN.filter((s) => s !== 'administracion')
    const { principales, mas } = repartirSecciones('tenant_admin', sinEquipo)
    expect(principales).toEqual(['hallazgos', 'cola', 'dashboard', 'plantillas'])
    expect(mas).toEqual(['conflictos', 'importar'])
  })
})

describe('llevaBarraInferior', () => {
  it('sólo en el teléfono y con más de una sección (plataforma no lleva)', () => {
    expect(llevaBarraInferior(true, TRABAJADOR)).toBe(true)
    expect(llevaBarraInferior(true, ADMIN)).toBe(true)
    expect(llevaBarraInferior(true, ['plataforma'])).toBe(false)
    expect(llevaBarraInferior(false, ADMIN)).toBe(false)
  })
})
