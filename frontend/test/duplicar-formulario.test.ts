import { describe, expect, it } from 'vitest'
import type { TemplateDefinition } from '@terreno/shared'
import { duplicarDefinicion, nombreDeCopia } from '../src/lib/duplicar-formulario'
import { uuid } from './fixtures'

const original: TemplateDefinition = {
  closing: { require_supervisor_signature: true },
  sections: [
    {
      id: uuid(900),
      title: 'Seguridad',
      items: [
        {
          id: uuid(901),
          prompt: '¿EPP completo?',
          response_type: 'ok_nok_na',
          require_finding_on_nok: true,
          origen: { sheet: 'Hoja1', column: 'B', headerCell: 'B1', headerRow: 1, firstDataRow: 2 },
        },
        { id: uuid(902), prompt: 'Turno', response_type: 'select_single', props: { options: ['Día', 'Noche'] } },
      ],
    },
  ],
}

describe('duplicar un formulario (TSK-FORM-024)', () => {
  it('genera ids nuevos, quita el origen de planilla y conserva el contenido', () => {
    let n = 0
    const copia = duplicarDefinicion(original, () => uuid(1000 + n++))

    expect(copia.sections[0].id).toBe(uuid(1000))
    expect(copia.sections[0].items.map((i) => i.id)).toEqual([uuid(1001), uuid(1002)])
    expect(copia.sections[0].items.every((i) => i.origen === undefined)).toBe(true)
    expect(copia.sections[0].items[0]).toMatchObject({ prompt: '¿EPP completo?', require_finding_on_nok: true })
    expect(copia.sections[0].items[1].props).toEqual({ options: ['Día', 'Noche'] })
    expect(copia.closing).toEqual({ require_supervisor_signature: true })
  })

  it('no comparte objetos con el original', () => {
    const copia = duplicarDefinicion(original)
    copia.sections[0].items[1].props?.options?.push('Tarde')
    expect(original.sections[0].items[1].props?.options).toEqual(['Día', 'Noche'])
    expect(original.sections[0].items[0].origen).toBeDefined()
  })

  it('numera la copia si el nombre ya existe', () => {
    expect(nombreDeCopia('Grúa', [])).toBe('Grúa (copia)')
    expect(nombreDeCopia('Grúa', ['Grúa (copia)'])).toBe('Grúa (copia 2)')
    expect(nombreDeCopia('Grúa', ['Grúa (copia)', 'Grúa (copia 2)'])).toBe('Grúa (copia 3)')
  })
})
