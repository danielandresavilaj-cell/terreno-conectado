/* Catálogo de plantillas de inicio — TSK-FORM-025 (FR-070). */
import { describe, expect, it } from 'vitest'
import { CATALOGO_PLANTILLAS, plantillaDeCatalogo, totalPreguntas } from './catalogo-plantillas'
import { parseTemplateDefinition } from './templates'

describe('catálogo de plantillas', () => {
  it('trae al menos seis plantillas con clave y nombre únicos', () => {
    expect(CATALOGO_PLANTILLAS.length).toBeGreaterThanOrEqual(6)
    expect(new Set(CATALOGO_PLANTILLAS.map((p) => p.clave)).size).toBe(CATALOGO_PLANTILLAS.length)
    expect(new Set(CATALOGO_PLANTILLAS.map((p) => p.nombre)).size).toBe(CATALOGO_PLANTILLAS.length)
  })

  it.each(CATALOGO_PLANTILLAS.map((p) => [p.nombre, p] as const))('«%s» cumple el esquema de definición', (_n, p) => {
    expect(() => parseTemplateDefinition(p.definition)).not.toThrow()
    expect(p.definition.sections.length).toBeGreaterThan(0)
    expect(totalPreguntas(p.definition)).toBeGreaterThanOrEqual(5)
    expect(p.descripcion.length).toBeGreaterThan(10)
  })

  it('los ids de ítems y secciones no se repiten en todo el catálogo', () => {
    const ids = CATALOGO_PLANTILLAS.flatMap((p) => p.definition.sections.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('al menos una pide cofirma de supervisión', () => {
    expect(CATALOGO_PLANTILLAS.some((p) => p.definition.closing?.require_supervisor_signature)).toBe(true)
  })

  it('busca por clave', () => {
    expect(plantillaDeCatalogo('andamios')?.nombre).toBe('Inspección de andamios')
    expect(plantillaDeCatalogo('no-existe')).toBeUndefined()
  })
})
