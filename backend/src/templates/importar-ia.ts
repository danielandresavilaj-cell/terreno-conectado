/**
 * Importar plantillas con IA — TSK-FORM-021 (Enmienda 006, ADR-004).
 *
 * Claude lee la pauta EN BLANCO (PDF —también escaneado—, foto JPG/PNG o el
 * texto de un Word) y devuelve secciones y preguntas con salida estructurada.
 * La salida pasa por `propuestaDesdeIA` y por `templateImportProposalSchema`
 * como cualquier otra propuesta, y una persona la revisa antes de guardar.
 *
 * Sólo se manda el documento del formulario: nunca inspecciones, respuestas
 * ni fotos de terreno. Sin `ANTHROPIC_API_KEY` la función queda apagada.
 *
 * `AnalizadorIA` es un provider de Nest: los tests inyectan uno falso, así la
 * CI nunca llama a la API.
 */
import Anthropic from '@anthropic-ai/sdk'
import { Logger } from '@nestjs/common'
import {
  INSTRUCCIONES_IA,
  MIME_POR_FORMATO,
  bloquesDeDocx,
  propuestaDesdeIA,
  salidaIASchema,
  textoDeBloques,
} from '@terreno/shared/importar'
import { RESPONSE_TYPES } from '@terreno/shared'
import type { FormatoImport, ParseResult } from '@terreno/shared/xlsx'

export const ANALIZADOR_IA = Symbol('ANALIZADOR_IA')

export interface EntradaIA {
  bytes: Uint8Array
  formato: FormatoImport
  nombre_archivo: string
}

export interface ResultadoIA {
  resultado: ParseResult
  modelo: string
  tokens_entrada: number
  tokens_salida: number
}

export interface AnalizadorIA {
  /** false = sin clave configurada: el botón no se muestra. */
  disponible(): boolean
  /** Nunca lanza: un problema de la API llega como `{ ok: false, error }`. */
  analizar(entrada: EntradaIA): Promise<ResultadoIA>
}

export const MODELO_POR_DEFECTO = 'claude-haiku-5-5'

/** JSON Schema de `salidaIASchema` (formato que acepta la salida estructurada). */
const ESQUEMA_SALIDA = {
  type: 'object',
  additionalProperties: false,
  required: ['secciones', 'advertencias'],
  properties: {
    secciones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'items'],
        properties: {
          titulo: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['pregunta', 'tipo', 'obligatorio', 'opciones', 'minimo', 'maximo'],
              properties: {
                pregunta: { type: 'string' },
                tipo: { type: 'string', enum: [...RESPONSE_TYPES] },
                obligatorio: { type: 'boolean' },
                opciones: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
                minimo: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                maximo: { anyOf: [{ type: 'number' }, { type: 'null' }] },
              },
            },
          },
        },
      },
    },
    advertencias: { type: 'array', items: { type: 'string' } },
  },
} as const

const PEDIDO = 'Convierte esta pauta de inspección en un formulario siguiendo las reglas.'

export class AnalizadorClaude implements AnalizadorIA {
  private readonly log = new Logger('ImportarIA')
  private readonly cliente: Anthropic | null
  readonly modelo: string

  constructor(apiKey = process.env.ANTHROPIC_API_KEY, modelo = process.env.IA_MODELO) {
    this.cliente = apiKey ? new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 }) : null
    this.modelo = modelo?.trim() || MODELO_POR_DEFECTO
  }

  disponible(): boolean {
    return this.cliente !== null
  }

  async analizar({ bytes, formato, nombre_archivo }: EntradaIA): Promise<ResultadoIA> {
    const sinUso = (error: string): ResultadoIA => ({ resultado: { ok: false, error }, modelo: this.modelo, tokens_entrada: 0, tokens_salida: 0 })
    if (!this.cliente) return sinUso('La IA no está configurada en este servidor.')

    let documento: Anthropic.ContentBlockParam
    const data = Buffer.from(bytes).toString('base64')
    if (formato === 'pdf') {
      documento = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    } else if (formato === 'jpg' || formato === 'png') {
      documento = { type: 'image', source: { type: 'base64', media_type: MIME_POR_FORMATO[formato] as 'image/jpeg' | 'image/png', data } }
    } else if (formato === 'docx') {
      const r = await bloquesDeDocx(bytes)
      if (!r.ok) return sinUso(r.error)
      const texto = textoDeBloques(r.bloques)
      if (!texto) return sinUso('El documento de Word está vacío.')
      documento = { type: 'text', text: `<documento nombre="${nombre_archivo.replace(/"/g, '')}">\n${texto.slice(0, 200_000)}\n</documento>` }
    } else {
      return sinUso('La IA lee PDF, Word y fotos; un Excel se importa con las reglas.')
    }

    try {
      const respuesta = await this.cliente.messages.create({
        model: this.modelo,
        max_tokens: 16_000,
        system: [{ type: 'text', text: INSTRUCCIONES_IA, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: [documento, { type: 'text', text: PEDIDO }] }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA_SALIDA } },
      })
      const uso = { modelo: respuesta.model, tokens_entrada: respuesta.usage.input_tokens, tokens_salida: respuesta.usage.output_tokens }
      if (respuesta.stop_reason === 'refusal') {
        return { ...uso, resultado: { ok: false, error: 'La IA no pudo procesar este documento. Prueba con las reglas o con otra foto.' } }
      }
      if (respuesta.stop_reason === 'max_tokens') {
        return { ...uso, resultado: { ok: false, error: 'La pauta es demasiado larga para analizarla de una vez: divídela en partes.' } }
      }
      const texto = respuesta.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
      let json: unknown
      try {
        json = JSON.parse(texto)
      } catch {
        return { ...uso, resultado: { ok: false, error: 'La IA devolvió una respuesta ilegible. Vuelve a intentarlo.' } }
      }
      const salida = salidaIASchema.safeParse(json)
      if (!salida.success) {
        return { ...uso, resultado: { ok: false, error: 'La IA devolvió una propuesta con un formato inesperado. Vuelve a intentarlo.' } }
      }
      return { ...uso, resultado: propuestaDesdeIA(salida.data, nombre_archivo, formato) }
    } catch (err) {
      return sinUso(this.mensajeDeError(err))
    }
  }

  private mensajeDeError(err: unknown): string {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      this.log.error('Clave de IA rechazada por la API')
      return 'La clave de IA del servidor no es válida. Avisa al administrador.'
    }
    if (err instanceof Anthropic.RateLimitError) return 'La IA está ocupada en este momento. Inténtalo en un minuto.'
    if (err instanceof Anthropic.BadRequestError) {
      this.log.warn(`Petición rechazada por la API: ${err.message}`)
      // Sin crédito también llega como 400: el mensaje lo dice.
      if (/credit|billing|balance/i.test(err.message)) return 'Se acabó el crédito de IA. Avisa al administrador; mientras tanto usa las reglas.'
      return 'La IA no pudo leer este archivo (¿demasiado grande o dañado?). Prueba con las reglas.'
    }
    if (err instanceof Anthropic.APIConnectionTimeoutError) return 'La IA tardó demasiado en responder. Vuelve a intentarlo.'
    if (err instanceof Anthropic.APIError) {
      this.log.warn(`Error de la API de IA: ${err.status ?? '?'} ${err.message}`)
      return 'La IA no está disponible en este momento. Inténtalo más tarde o usa las reglas.'
    }
    this.log.error(`Fallo inesperado al analizar con IA: ${err instanceof Error ? err.message : String(err)}`)
    return 'No se pudo analizar el documento con IA.'
  }
}
