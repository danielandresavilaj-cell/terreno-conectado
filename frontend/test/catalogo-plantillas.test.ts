/* Usar una plantilla del catálogo — TSK-FORM-025 (FR-070).
 *
 * La copia que se envía a `POST /templates` cumple el esquema, no comparte
 * ningún id con el catálogo (las respuestas se guardan por id de ítem) y
 * conserva la cofirma; dos copias de la misma plantilla tampoco comparten ids.
 */
import { describe, expect, it } from 'vitest'
import { CATALOGO_PLANTILLAS, parseTemplateDefinition, type TemplateDefinition } from '@terreno/shared'
import { duplicarDefinicion, nombreDeCopia } from '../src/lib/duplicar-formulario'

const ids = (d: TemplateDefinition) => d.sections.flatMap((s) => [s.id, ...s.items.map((i) => i.id)])

describe('copiar una plantilla del catálogo', () => {
  it.each(CATALOGO_PLANTILLAS.map((p) => [p.nombre, p] as const))('«%s» se copia válida y con ids nuevos', (_n, p) => {
    const copia = duplicarDefinicion(p.definition)
    expect(() => parseTemplateDefinition(copia)).not.toThrow()
    const originales = new Set(ids(p.definition))
    expect(ids(copia).some((id) => originales.has(id))).toBe(false)
    expect(copia.closing).toEqual(p.definition.closing)
    expect(copia.sections.map((s) => s.items.map((i) => i.prompt))).toEqual(
      p.definition.sections.map((s) => s.items.map((i) => i.prompt)),
    )
  })

  it('dos copias de la misma plantilla no comparten ids ni modifican el catálogo', () => {
    const p = CATALOGO_PLANTILLAS[0]
    const antes = JSON.stringify(p.definition)
    const a = new Set(ids(duplicarDefinicion(p.definition)))
    expect(ids(duplicarDefinicion(p.definition)).some((id) => a.has(id))).toBe(false)
    expect(JSON.stringify(p.definition)).toBe(antes)
  })

  it('si la empresa ya tiene ese nombre, la copia se nombra "(copia)"', () => {
    expect(nombreDeCopia('Inspección de andamios', ['Inspección de andamios'])).toBe('Inspección de andamios (copia)')
  })
})
