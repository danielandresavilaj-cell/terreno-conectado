/**
 * Tests de `serializar.ts` — TSK-FORM-010 (FR-019/044).
 *
 * Este módulo está en `shared/` porque FR-044 exige que el servidor produzca el
 * mismo artefacto que el dispositivo; por eso sus casos se ejecutan AQUÍ, junto
 * al código, y no en el cliente (que ya sólo orquesta: caché → parseo → relleno).
 *
 * El foco no es sólo lo que se escribe, sino lo que NO se escribe: aquí un error
 * no rompe una pantalla, escribe basura en el documento firmado por la faena, y
 * una celda basura no se distingue de una respuesta.
 */
import { describe, expect, it } from 'vitest'
import type { ResponseType, TemplateItem } from '../templates'
import {
  INDICADOR_EVIDENCIA,
  construirRespuestas,
  contestado,
  serializarValorCampo,
} from './serializar'

/**
 * Los 8 tipos del catálogo (FR-036). Se recorre la lista completa en el test de
 * "sin respuesta", así que un tipo nuevo no puede colarse sin comprobarse.
 */
const TIPOS: ResponseType[] = [
  'ok_nok_na',
  'text',
  'numeric',
  'date',
  'time',
  'select_single',
  'select_multiple',
  'photo',
]

/** Ítem de plantilla con la forma del contrato (id estable, tipo del catálogo). */
function item(tipo: ResponseType, id = `item-${tipo}`): TemplateItem {
  return { id, prompt: 'Ítem', response_type: tipo }
}

describe('serializarValorCampo — el valor que acaba en la celda', () => {
  it('ok_nok_na escribe OK / NOK / N-A con la convención del libro', () => {
    const it_ = item('ok_nok_na')
    expect(serializarValorCampo(it_, 'ok')).toBe('OK')
    expect(serializarValorCampo(it_, 'nok')).toBe('NOK')
    expect(serializarValorCampo(it_, 'na')).toBe('N/A')
    // Un valor ajeno al tipo no se escribe: en la celda de un "conforme" no puede
    // quedar nada que se parezca a una respuesta.
    expect(serializarValorCampo(it_, 'casi')).toBeNull()
    // Ni un método heredado del prototipo: `'toString' in {}` es `true`, y una
    // comprobación por pertenencia acabaría escribiendo una función en la celda.
    expect(serializarValorCampo(it_, 'toString')).toBeNull()
    expect(serializarValorCampo(it_, 1)).toBeNull()
  })

  it('numeric escribe un número, no texto', () => {
    const it_ = item('numeric')
    expect(serializarValorCampo(it_, 0)).toBe(0)
    expect(serializarValorCampo(it_, 180.5)).toBe(180.5)
    // Una cadena numérica no se coacciona: la columna del original puede venir
    // con formato numérico y una cadena rompería el formato de la celda.
    expect(serializarValorCampo(it_, '180')).toBeNull()
    expect(serializarValorCampo(it_, Number.NaN)).toBeNull()
  })

  it('text escribe el texto tal cual y no escribe el vacío', () => {
    const it_ = item('text')
    expect(serializarValorCampo(it_, 'Sin señalización en la ruta de evacuación')).toBe(
      'Sin señalización en la ruta de evacuación',
    )
    expect(serializarValorCampo(it_, '')).toBeNull()
    expect(serializarValorCampo(it_, '   ')).toBeNull()
  })

  it('date escribe el ISO YYYY-MM-DD que el parser vuelve a reconocer', () => {
    const it_ = item('date')
    expect(serializarValorCampo(it_, '2026-10-11')).toBe('2026-10-11')
    expect(serializarValorCampo(it_, '11/10/2026')).toBeNull()
    expect(serializarValorCampo(it_, '2026-10-11T00:00:00Z')).toBeNull()
  })

  it('time conserva HH:MM y HH:MM:SS', () => {
    const it_ = item('time')
    expect(serializarValorCampo(it_, '14:30')).toBe('14:30')
    expect(serializarValorCampo(it_, '14:30:05')).toBe('14:30:05')
    expect(serializarValorCampo(it_, '25:00')).toBeNull()
    expect(serializarValorCampo(it_, '14h30')).toBeNull()
  })

  it('select_single escribe la opción del catálogo', () => {
    const it_ = item('select_single')
    expect(serializarValorCampo(it_, 'Turno')).toBe('Turno')
    expect(serializarValorCampo(it_, '')).toBeNull()
    expect(serializarValorCampo(it_, ['Turno'])).toBeNull()
  })

  it('select_multiple escribe texto legible con "; ", la convención del import', () => {
    const it_ = item('select_multiple')
    expect(serializarValorCampo(it_, ['Conos', 'Baliza'])).toBe('Conos; Baliza')
    expect(serializarValorCampo(it_, [])).toBeNull()
    expect(serializarValorCampo(it_, 'Conos')).toBeNull()
  })

  it('photo escribe la referencia, NUNCA los bytes', () => {
    const it_ = item('photo')
    expect(serializarValorCampo(it_, 'capturada')).toBe(INDICADOR_EVIDENCIA)
    expect(serializarValorCampo(it_, null)).toBeNull()
    // La imagen va anclada en la hoja "Evidencias"; la celda sólo la anuncia.
    expect(INDICADOR_EVIDENCIA).not.toContain('data:')
  })

  it('sin respuesta no hay celda que escribir en ninguno de los 8 tipos', () => {
    for (const tipo of TIPOS) {
      expect(serializarValorCampo(item(tipo), null)).toBeNull()
      expect(serializarValorCampo(item(tipo), undefined)).toBeNull()
    }
  })
})

describe('contestado — qué cuenta como respuesta', () => {
  it('lo vacío, ni siquiera es contestado', () => {
    expect(contestado(null)).toBe(false)
    expect(contestado(undefined)).toBe(false)
    expect(contestado('')).toBe(false)
    expect(contestado([])).toBe(false)
  })

  it('cualquier valor con contenido sí lo es, incluido el 0', () => {
    // `0` es una cantidad válida: si se contara como vacío, el ítem se omitiría
    // en silencio y el revisor vería una celda en blanco donde hubo captura.
    expect(contestado(0)).toBe(true)
    expect(contestado('a')).toBe(true)
    expect(contestado(['Turno'])).toBe(true)
  })
})

describe('construirRespuestas — del estado capturado al array de relleno', () => {
  it('sólo manda lo contestado, en el orden de los ítems', () => {
    const items = [item('ok_nok_na', 'a'), item('numeric', 'b'), item('text', 'c')]
    const respuestas = { c: 'hola', b: 42, a: 'ok' }

    const out = construirRespuestas(items, respuestas)

    expect(out.respuestas).toEqual([
      { itemId: 'a', valor: 'OK' },
      { itemId: 'b', valor: 42 },
      { itemId: 'c', valor: 'hola' },
    ])
    expect(out.omitidas).toEqual([])
  })

  it('lo vacío NO es una omisión: es lo que no se contestó', () => {
    const items = [item('text', 'a'), item('select_multiple', 'b')]

    const out = construirRespuestas(items, { a: '', b: [] })

    expect(out.respuestas).toEqual([])
    expect(out.omitidas).toEqual([])
  })

  it('un valor con el tipo equivocado se omite y se reporta', () => {
    const items = [item('numeric', 'a'), item('text', 'b')]
    // La fila guarda `ok` en un ítem numérico (la plantilla cambió de tipo sin
    // revisar el borrador): no se escribe nada en su celda, y se avisa.
    const respuestas = { a: 'ok', b: 'ok' }

    const out = construirRespuestas(items, respuestas)

    expect(out.respuestas).toEqual([{ itemId: 'b', valor: 'ok' }])
    expect(out.omitidas).toEqual(['a'])
  })

  it('lo que no está en la plantilla no se inventa', () => {
    const out = construirRespuestas([item('text', 'a')], { fantasma: 'fantasma' })
    expect(out.respuestas).toEqual([])
  })
})