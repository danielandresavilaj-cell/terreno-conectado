/* Barra inferior del teléfono — TSK-OFF-022. */
import { describe, expect, it } from 'vitest'
import { agruparSecciones, llevaBarraInferior, modoNavegacion, repartirSecciones } from '../src/lib/nav-telefono'
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

describe('modoNavegacion (TSK-OFF-024)', () => {
  it('barra en el teléfono, cajón en tableta y lateral fijo en escritorio', () => {
    expect(modoNavegacion('telefono', ADMIN.length)).toBe('barra')
    expect(modoNavegacion('tableta', ADMIN.length)).toBe('cajon')
    expect(modoNavegacion('escritorio', SUPERVISOR.length)).toBe('lateral')
  })

  it('con una sola sección (plataforma) no hay menú en ningún tamaño', () => {
    for (const ancho of ['telefono', 'tableta', 'escritorio'] as const) expect(modoNavegacion(ancho, 1)).toBe('ninguno')
  })
})

describe('agruparSecciones (TSK-OFF-024)', () => {
  it('administración: Terreno (Cola), Operación y Configuración, sin perder secciones', () => {
    const conActivos: Pantalla[] = [...ADMIN, 'activos']
    const grupos = agruparSecciones('tenant_admin', conActivos)
    expect(grupos).toEqual([
      { titulo: 'Terreno', ids: ['cola'] },
      { titulo: 'Operación', ids: ['hallazgos', 'dashboard', 'conflictos'] },
      { titulo: 'Configuración', ids: ['administracion', 'plantillas', 'importar', 'activos'] },
    ])
    expect(grupos.flatMap((g) => g.ids).sort()).toEqual([...conActivos].sort())
  })

  it('para el trabajador, Hallazgos es parte de su terreno', () => {
    expect(agruparSecciones('field_worker', TRABAJADOR)).toEqual([
      { titulo: 'Terreno', ids: ['formularios', 'captura', 'bitacora', 'hallazgos', 'cola'] },
    ])
  })

  it('agrupa sólo lo que recibe (p. ej. lo que queda en "Más")', () => {
    const { mas } = repartirSecciones('supervisor', SUPERVISOR)
    expect(agruparSecciones('supervisor', mas)).toEqual([
      { titulo: 'Terreno', ids: ['bitacora', 'cola'] },
      { titulo: 'Operación', ids: ['conflictos'] },
    ])
  })
})
