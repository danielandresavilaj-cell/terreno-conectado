/**
 * Tests de `propuestaADefinicion` — módulo 007 (TSK-FORM-006, FR-029/036/039).
 *
 * Estrategia: se construyen propuestas en memoria (mismo shape que emite el
 * parser, TSK-FORM-005) y se verifica el mapeo al contrato de definición:
 * ids UUIDv7, `position`, propagación de `props` y descarte de los metadatos
 * del parser. El caso inválido comprueba que la invariante FR-036/039 rechaza
 * con la ruta del issue.
 */
import { describe, expect, it } from 'vitest'
import { templateDefinitionSchema } from '../templates'
import type { FieldProps, ResponseType } from '../templates'
import { propuestaADefinicion } from './to-definition'
import type { ProposedItem, ProposedSection, TemplateImportProposal } from './types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ítem propuesto con los metadatos que añade el parser (rellenados por defecto). */
function itemProposal(
  prompt: string,
  response_type: ResponseType,
  props: FieldProps,
  overrides: Partial<ProposedItem> = {},
): ProposedItem {
  return {
    prompt,
    response_type,
    required: props.required ?? false,
    props,
    source: {
      sheet: 'Hoja',
      column: 'A',
      headerCell: 'A1',
      headerRow: 1,
      firstDataRow: 2,
    },
    opcionesConteo: { ok: 1 },
    muestra: ['x'],
    filasConDato: 1,
    ...overrides,
  }
}

function propuesta(secciones: ProposedSection[]): TemplateImportProposal {
  return {
    nombre_archivo: 'test.xlsx',
    secciones,
    resumen: {
      secciones: secciones.length,
      items: secciones.reduce((acc, s) => acc + s.items.length, 0),
      filasDatos: 0,
    },
  }
}

/** Muestra de los 8 `response_type` con props válidas por tipo. */
const ITEMS_8: ProposedItem[] = [
  itemProposal('Estado', 'ok_nok_na', { required: true }),
  itemProposal('Observación', 'text', { required: false, max_length: 500 }),
  itemProposal('Cantidad', 'numeric', { required: true, min: 1, max: 10 }),
  itemProposal('Fecha', 'date', { required: false, min: '2026-01-01', max: '2026-12-31' }),
  itemProposal('Hora', 'time', { required: true }),
  itemProposal('Turno', 'select_single', { required: true, options: ['Día', 'Noche'] }),
  itemProposal('Áreas', 'select_multiple', { required: false, options: ['A', 'B'] }),
  itemProposal('Evidencia', 'photo', { required: false, photo_max_kb: 800 }),
]

describe('propuestaADefinicion — mapeo al contrato', () => {
  it('mapea los 8 response_type y la definición pasa el contrato Zod', () => {
    const res = propuestaADefinicion(propuesta([{ titulo: 'Inspección', items: ITEMS_8 }]))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const items = res.definition.sections[0].items
    expect(items.map((i) => i.response_type)).toEqual(ITEMS_8.map((i) => i.response_type))
    expect(templateDefinitionSchema.safeParse(res.definition).success).toBe(true)
  })

  it('genera ids UUIDv7 en la sección y en cada ítem', () => {
    const res = propuestaADefinicion(propuesta([{ titulo: 'Inspección', items: ITEMS_8 }]))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const [seccion] = res.definition.sections
    expect(seccion.id).toMatch(UUID_RE)
    for (const item of seccion.items) expect(item.id).toMatch(UUID_RE)
    // Los ids son únicos entre sí.
    const ids = [seccion.id!, ...seccion.items.map((i) => i.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('preserva min/max/options y propaga required en props', () => {
    const res = propuestaADefinicion(propuesta([{ titulo: 'Inspección', items: ITEMS_8 }]))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const porPrompt = Object.fromEntries(res.definition.sections[0].items.map((i) => [i.prompt, i]))
    expect(porPrompt['Cantidad'].props).toEqual({ required: true, min: 1, max: 10 })
    expect(porPrompt['Fecha'].props).toEqual({
      required: false,
      min: '2026-01-01',
      max: '2026-12-31',
    })
    expect(porPrompt['Turno'].props).toEqual({ required: true, options: ['Día', 'Noche'] })
    expect(porPrompt['Áreas'].props).toEqual({ required: false, options: ['A', 'B'] })
    expect(porPrompt['Evidencia'].props).toEqual({ required: false, photo_max_kb: 800 })
    expect(porPrompt['Observación'].props).toEqual({ required: false, max_length: 500 })
    for (const prompt of ['Estado', 'Hora']) {
      expect(porPrompt[prompt].props?.required).toBe(true)
    }
  })

  it('no copia los metadatos del parser (source/opcionesConteo/muestra/filasConDato)', () => {
    const res = propuestaADefinicion(propuesta([{ titulo: 'Inspección', items: ITEMS_8 }]))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const [seccion] = res.definition.sections
    expect(Object.keys(seccion).sort()).toEqual(['id', 'items', 'position', 'title'])
    for (const item of seccion.items) {
      expect(Object.keys(item).sort()).toEqual(['id', 'prompt', 'props', 'response_type'])
      expect(item).not.toHaveProperty('source')
      expect(item).not.toHaveProperty('opcionesConteo')
      expect(item).not.toHaveProperty('muestra')
      expect(item).not.toHaveProperty('filasConDato')
    }
  })

  it('asigna position por orden en dos secciones', () => {
    const res = propuestaADefinicion(
      propuesta([
        { titulo: 'Primera', items: [itemProposal('A', 'text', { required: false })] },
        { titulo: 'Segunda', items: [itemProposal('B', 'text', { required: true })] },
      ]),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.definition.sections.map((s) => s.title)).toEqual(['Primera', 'Segunda'])
    expect(res.definition.sections.map((s) => s.position)).toEqual([0, 1])
  })
})

describe('propuestaADefinicion — validación e invariante FR-036/039', () => {
  it('rechaza una propuesta sin secciones con un mensaje claro', () => {
    const res = propuestaADefinicion(propuesta([]))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/no tiene secciones/i)
  })

  it('rechaza una propuesta con secciones pero sin ítems', () => {
    const res = propuestaADefinicion(propuesta([{ titulo: 'Vacía', items: [] }]))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/no tiene ítems/i)
  })

  it('rechaza props fuera del contrato e indica la ruta del issue', () => {
    const invalido = itemProposal('Malo', 'numeric', {
      required: true,
      min: 10,
      max: 1,
    } as FieldProps)
    const res = propuestaADefinicion(propuesta([{ titulo: 'Sección', items: [invalido] }]))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('sections.0.items.0.props.min')
    expect(res.error).toMatch(/min debe ser menor o igual a max/i)
  })

  it('rechaza una prop desconocida (strict) indicando props', () => {
    const invalido = itemProposal('Malo', 'text', {
      required: true,
      foto: 'no-corresponde',
    } as unknown as FieldProps)
    const res = propuestaADefinicion(propuesta([{ titulo: 'Sección', items: [invalido] }]))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('sections.0.items.0.props')
    expect(res.error).toMatch(/unrecognized|desconoc/i)
  })
})
