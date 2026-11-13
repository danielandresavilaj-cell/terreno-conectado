/* Crear formulario desde cero — TSK-FORM-022: operaciones del editor y guardado. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIELD_PROPS_SCHEMA } from '@terreno/shared'
import { propuestaADefinicion } from '@terreno/shared/xlsx'
import {
  agregarPregunta,
  agregarSeccion,
  moverPregunta,
  moverSeccion,
  nuevaPregunta,
  propuestaVacia,
  quitarPregunta,
  quitarSeccion,
  renombrarSeccion,
} from '../src/lib/editor-formulario'
import { crearPlantilla, setToken } from '../src/lib/api'

describe('editor de formularios', () => {
  it('parte con una sección y una pregunta en blanco, obligatoria y de tipo OK/No OK/N.A.', () => {
    const p = propuestaVacia()
    expect(p.secciones).toHaveLength(1)
    expect(p.secciones[0].titulo).toBe('General')
    expect(p.secciones[0].items[0]).toMatchObject({ prompt: '', response_type: 'ok_nok_na', required: true })
    expect(p.resumen).toMatchObject({ secciones: 1, items: 1 })
    expect(FIELD_PROPS_SCHEMA.ok_nok_na.safeParse(p.secciones[0].items[0].props).success).toBe(true)
  })

  it('agrega, mueve y quita preguntas y secciones sin perder el orden', () => {
    let p = propuestaVacia()
    p = agregarPregunta(p, 0, 'numeric')
    p = agregarSeccion(p)
    p = renombrarSeccion(p, 1, 'Luces')
    expect(p.secciones.map((s) => s.titulo)).toEqual(['General', 'Luces'])
    expect(p.resumen).toMatchObject({ secciones: 2, items: 3 })

    p = moverPregunta(p, 0, 1, -1)
    expect(p.secciones[0].items.map((i) => i.response_type)).toEqual(['numeric', 'ok_nok_na'])
    // Mover fuera del borde no cambia nada.
    expect(moverPregunta(p, 0, 0, -1)).toEqual(p)

    p = moverSeccion(p, 1, -1)
    expect(p.secciones.map((s) => s.titulo)).toEqual(['Luces', 'General'])

    p = quitarPregunta(p, 1, 0)
    expect(p.secciones[1].items).toHaveLength(1)
    p = quitarSeccion(p, 0)
    expect(p.secciones.map((s) => s.titulo)).toEqual(['General'])
    // Nunca queda sin secciones.
    expect(quitarSeccion(p, 0).secciones).toHaveLength(1)
    // "Sección N" no repite un nombre que ya existe.
    expect(agregarSeccion(renombrarSeccion(p, 0, 'Sección 2')).secciones[1].titulo).toBe('Sección 3')
  })

  it('un formulario armado desde cero se convierte en una definición válida', () => {
    let p = propuestaVacia()
    p = { ...p, secciones: [{ ...p.secciones[0], items: [{ ...p.secciones[0].items[0], prompt: '¿Frenos operativos?' }] }] }
    p = agregarPregunta(p, 0, 'select_single')
    const lista = p.secciones[0].items[1]
    p = {
      ...p,
      secciones: [{ ...p.secciones[0], items: [p.secciones[0].items[0], { ...lista, prompt: 'Turno', props: { ...lista.props, options: ['Día', 'Noche'] } }] }],
    }
    const r = propuestaADefinicion(p)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const items = r.definition.sections[0].items
    expect(items.map((i) => [i.prompt, i.response_type])).toEqual([
      ['¿Frenos operativos?', 'ok_nok_na'],
      ['Turno', 'select_single'],
    ])
    expect(items[1].props?.options).toEqual(['Día', 'Noche'])
    // Una lista sin opciones no pasa la validación de props (el editor la marca y bloquea "Continuar").
    expect(FIELD_PROPS_SCHEMA.select_single.safeParse(nuevaPregunta('select_single').props).success).toBe(false)
  })
})

describe('crearPlantilla', () => {
  let llamada: { url: string; init: RequestInit } | null = null
  beforeEach(() => {
    setToken('t')
    vi.stubGlobal('window', { dispatchEvent: () => true })
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      llamada = { url, init }
      return new Response(JSON.stringify({ id: 'rev', status: 'draft' }), { status: 201, headers: { 'Content-Type': 'application/json' } })
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('hace POST /templates con el nombre y la definición', async () => {
    const definition = { sections: [{ title: 'General', items: [] }] }
    const r = await crearPlantilla({ name: 'Checklist nuevo', definition })
    expect(llamada?.url).toMatch(/\/templates$/)
    expect(llamada?.init.method).toBe('POST')
    expect(JSON.parse(String(llamada?.init.body))).toEqual({ name: 'Checklist nuevo', definition })
    expect(r).toMatchObject({ id: 'rev', status: 'draft' })
  })
})
