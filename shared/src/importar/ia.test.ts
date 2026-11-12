/* Importar con IA — TSK-FORM-021: de la salida del modelo a la propuesta. */
import { describe, expect, it } from 'vitest'
import { templateImportProposalSchema } from '../templates'
import { detectarFormato } from './formato'
import { type SalidaIA, propuestaDesdeIA, salidaIASchema, textoDeBloques } from './ia'

const item = (pregunta: string, tipo: SalidaIA['secciones'][0]['items'][0]['tipo'], extra: Partial<SalidaIA['secciones'][0]['items'][0]> = {}) => ({
  pregunta,
  tipo,
  obligatorio: true,
  opciones: null,
  minimo: null,
  maximo: null,
  ...extra,
})

describe('propuestaDesdeIA', () => {
  it('limpia, corrige tipos, omite firmas y duplicados; la propuesta es válida', () => {
    const salida = salidaIASchema.parse({
      secciones: [
        {
          titulo: 'Motor',
          items: [
            item('☐ Nivel de aceite', 'ok_nok_na'),
            item('Nivel de aceite', 'ok_nok_na'),
            item('Frenos', 'select_single', { opciones: ['Sí', 'No', 'N/A'] }),
            item('Estado neumáticos', 'select_single', { opciones: ['Bueno', 'Regular', 'Malo', 'Bueno'] }),
            item('Turno', 'select_multiple', { opciones: ['Día'] }),
            item('Kilometraje', 'numeric', { minimo: 0, maximo: 999999 }),
            item('Presión', 'numeric', { minimo: 50, maximo: 10 }),
            item('Firma del inspector', 'text'),
            item('   ', 'text'),
          ],
        },
        { titulo: 'Motor', items: [item('Correa', 'ok_nok_na'), item('Frenos', 'ok_nok_na')] },
        { titulo: 'Vacía', items: [item('Firma supervisor', 'text')] },
      ],
      advertencias: ['La foto está algo borrosa abajo.'],
    })
    const r = propuestaDesdeIA(salida, 'pauta.jpg', 'jpg')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const p = templateImportProposalSchema.parse(r.propuesta)
    expect(p.formato).toBe('jpg')
    expect(p.secciones).toHaveLength(1)
    const [s] = p.secciones
    expect(s.items.map((i) => [i.prompt, i.response_type])).toEqual([
      ['Nivel de aceite', 'ok_nok_na'],
      ['Frenos', 'ok_nok_na'],
      ['Estado neumáticos', 'select_single'],
      ['Turno', 'text'],
      ['Kilometraje', 'numeric'],
      ['Presión', 'numeric'],
      ['Correa', 'ok_nok_na'],
    ])
    expect(s.items[2].props.options).toEqual(['Bueno', 'Regular', 'Malo'])
    expect(s.items[4].props).toMatchObject({ min: 0, max: 999999 })
    expect(s.items[5].props.min).toBeUndefined()
    expect(p.resumen).toEqual({ secciones: 1, items: 7, filasDatos: 0 })
    expect(p.advertencias).toEqual(expect.arrayContaining(['La foto está algo borrosa abajo.', expect.stringContaining('Turno')]))
  })

  it('sin preguntas: error claro con el motivo que dio la IA', () => {
    const r = propuestaDesdeIA({ secciones: [], advertencias: ['La imagen es una factura, no una pauta.'] }, 'x.png', 'png')
    expect(r).toEqual({ ok: false, error: expect.stringContaining('factura') })
  })
})

describe('apoyo', () => {
  it('Word a texto con tablas en Markdown', () => {
    const t = textoDeBloques([
      { tipo: 'titulo', texto: 'Checklist' },
      { tipo: 'parrafo', texto: 'Revisar antes de salir', lista: true },
      { tipo: 'tabla', filas: [['Ítem', 'Sí', 'No'], ['Luces | altas', '', '']] },
    ])
    expect(t).toContain('## Checklist')
    expect(t).toContain('- Revisar antes de salir')
    expect(t).toContain('| Luces / altas |  |  |')
  })

  it('detecta JPEG y PNG por firma', () => {
    expect(detectarFormato(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpg')
    expect(detectarFormato(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('png')
    expect(detectarFormato(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull()
  })
})
