import { describe, expect, it } from 'vitest'
import type { TemplateDefinition } from '@terreno/shared'
import { erroresDeEnvio } from '../src/lib/validar-envio-inspeccion'
import { uuid } from './fixtures'

const definition: TemplateDefinition = {
  sections: [{
    id: uuid(80),
    title: 'Control',
    items: [
      { id: uuid(81), prompt: 'Estado', response_type: 'ok_nok_na', props: { required: true } },
      { id: uuid(82), prompt: 'Observación', response_type: 'text', props: { required: true } },
      { id: uuid(83), prompt: 'Foto', response_type: 'photo', props: { required: true } },
      { id: uuid(84), prompt: 'Riesgo', response_type: 'ok_nok_na', require_finding_on_nok: true, props: { required: true } },
    ],
  }],
}

describe('validación antes de enviar una inspección', () => {
  it('no envía el número viejo si la edición actual tiene un error de rango', () => {
    const numeric: TemplateDefinition = { sections: [{ id: uuid(90), title: 'Temperatura', items: [
      { id: uuid(91), prompt: 'Temperatura', response_type: 'numeric', props: { required: true, min: -10, max: 45 } },
    ] }] }
    const saved = { [uuid(91)]: { campo: 45 } }
    expect(erroresDeEnvio(numeric, saved, { [uuid(91)]: 'Fuera de rango' })).toEqual({ [uuid(91)]: 'Fuera de rango' })
    expect(erroresDeEnvio(numeric, saved, {})).toEqual({})
  })
  it('marca todos los obligatorios vacíos en un único intento', () => {
    const errores = erroresDeEnvio(definition, {})
    expect(errores).toEqual({
      [uuid(81)]: 'Campo obligatorio',
      [uuid(82)]: 'Campo obligatorio',
      [uuid(83)]: 'Campo obligatorio',
      [uuid(84)]: 'Campo obligatorio',
    })
  })

  it('bloquea un NOK hasta que exista su hallazgo obligatorio', () => {
    const respuestas = {
      [uuid(81)]: { campo: 'ok' as const },
      [uuid(82)]: { campo: 'Revisado' },
      [uuid(83)]: { campo: 'capturada' },
      [uuid(84)]: { campo: 'nok' as const },
    }
    expect(erroresDeEnvio(definition, respuestas)[uuid(84)]).toContain('hallazgo')
    expect(erroresDeEnvio(definition, { ...respuestas, [uuid(84)]: { campo: 'nok', hallazgoId: uuid(85) } })).toEqual({})
  })
})
