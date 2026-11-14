/**
 * Resumen de Gerencia con IA — el redactor (TSK-REP-014, FR-068, ADR-005 Enmienda 1).
 *
 * Claude recibe sólo las cifras de `datosParaResumen` y devuelve, con salida
 * estructurada, un titular, 2 a 4 puntos y la acción más urgente. No decide ni
 * guarda nada: el texto se muestra marcado "generado con IA".
 *
 * `RedactorResumen` es un provider de Nest: los tests inyectan uno falso, así
 * la CI nunca llama a la API. Sin `ANTHROPIC_API_KEY` queda apagado.
 */
import Anthropic from '@anthropic-ai/sdk'
import { Logger } from '@nestjs/common'
import { resumenIASalidaSchema, type ResumenIASalida } from '@terreno/shared'
import { MODELO_POR_DEFECTO } from '../templates/importar-ia'
import type { DatosResumen } from './resumen-ia.datos'

export const REDACTOR_RESUMEN = Symbol('REDACTOR_RESUMEN')

export type ResultadoRedaccion =
  | { ok: true; salida: ResumenIASalida; modelo: string; tokens_entrada: number; tokens_salida: number }
  | { ok: false; error: string; modelo: string; tokens_entrada: number; tokens_salida: number }

export interface RedactorResumen {
  /** false = sin clave configurada: Gerencia no muestra el botón. */
  disponible(): boolean
  /** Nunca lanza: un problema de la API llega como `{ ok: false, error }`. */
  redactar(datos: DatosResumen): Promise<ResultadoRedaccion>
}

/** Instrucciones fijas (van en caché del lado de la API). */
export const INSTRUCCIONES_RESUMEN = `Eres analista de operaciones de una empresa minera o de construcción en Chile.
Recibes, entre etiquetas <datos>, las cifras agregadas del panel de Gerencia de una plataforma de inspecciones en terreno, para una faena (o todas) y un período.

Redacta un resumen para la gerencia, en español de Chile, claro y sin jerga técnica:
- "titular": una sola frase con lo más importante del período.
- "puntos": de 2 a 4 frases cortas, cada una con al menos una cifra de los datos.
- "atencion": la acción más urgente para la gerencia en una frase, o null si nada requiere atención.

Reglas:
- Usa SOLO las cifras entregadas. No inventes causas, nombres, lugares ni porcentajes que no puedas calcular de los datos.
- Prioriza, en este orden: hallazgos urgentes sin resolver (alta o crítica), acciones con plazo vencido, conflictos pendientes de revisión y la tendencia de las últimas semanas.
- "acciones_con_plazo_vencido" y "tendencia_semanal" se miden a hoy, no dentro del período: no digas que ocurrieron en el período. Si no vienen, el período ya terminó: resume sólo lo que ocurrió en él.
- Si no hay actividad o todo está en cero, dilo con naturalidad.
- Escribe las cifras con dígitos. No uses markdown ni emojis.`

/** JSON Schema de `resumenIASalidaSchema` para la salida estructurada. */
const ESQUEMA_SALIDA = {
  type: 'object',
  additionalProperties: false,
  required: ['titular', 'puntos', 'atencion'],
  properties: {
    titular: { type: 'string' },
    puntos: { type: 'array', items: { type: 'string' } },
    atencion: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const

/** Valida el texto que devolvió el modelo. `null` = no sirve. */
export function interpretarSalida(texto: string): ResumenIASalida | null {
  let json: unknown
  try {
    json = JSON.parse(texto)
  } catch {
    return null
  }
  // El esquema estructurado no fija largos: se recortan los puntos sobrantes
  // antes de validar para no perder un resumen bueno por un quinto punto.
  if (json && typeof json === 'object' && Array.isArray((json as { puntos?: unknown }).puntos)) {
    ;(json as { puntos: unknown[] }).puntos = (json as { puntos: unknown[] }).puntos.slice(0, 4)
  }
  const r = resumenIASalidaSchema.safeParse(json)
  return r.success ? r.data : null
}

export class RedactorClaude implements RedactorResumen {
  private readonly log = new Logger('ResumenIA')
  private readonly cliente: Anthropic | null
  readonly modelo: string

  constructor(apiKey = process.env.ANTHROPIC_API_KEY, modelo = process.env.IA_MODELO) {
    this.cliente = apiKey ? new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 }) : null
    this.modelo = modelo?.trim() || MODELO_POR_DEFECTO
  }

  disponible(): boolean {
    return this.cliente !== null
  }

  async redactar(datos: DatosResumen): Promise<ResultadoRedaccion> {
    const fallo = (error: string, tokens_entrada = 0, tokens_salida = 0): ResultadoRedaccion => ({
      ok: false,
      error,
      modelo: this.modelo,
      tokens_entrada,
      tokens_salida,
    })
    if (!this.cliente) return fallo('La IA no está configurada en este servidor.')

    try {
      const respuesta = await this.cliente.messages.create({
        model: this.modelo,
        max_tokens: 4_000,
        system: [{ type: 'text', text: INSTRUCCIONES_RESUMEN, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `<datos>\n${JSON.stringify(datos, null, 1)}\n</datos>` }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_SALIDA } },
      })
      const ent = respuesta.usage.input_tokens
      const sal = respuesta.usage.output_tokens
      if (respuesta.stop_reason === 'refusal') return fallo('La IA no pudo redactar el resumen. Vuelve a intentarlo.', ent, sal)
      if (respuesta.stop_reason === 'max_tokens') return fallo('La IA no alcanzó a terminar el resumen. Vuelve a intentarlo.', ent, sal)
      const texto = respuesta.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
      const salida = interpretarSalida(texto)
      if (!salida) return fallo('La IA devolvió un resumen con un formato inesperado. Vuelve a intentarlo.', ent, sal)
      return { ok: true, salida, modelo: respuesta.model, tokens_entrada: ent, tokens_salida: sal }
    } catch (err) {
      return fallo(this.mensajeDeError(err))
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
      if (/credit|billing|balance/i.test(err.message)) return 'Se acabó el crédito de IA. Avisa al administrador.'
      return 'La IA no pudo procesar el resumen. Inténtalo más tarde.'
    }
    if (err instanceof Anthropic.APIConnectionTimeoutError) return 'La IA tardó demasiado en responder. Vuelve a intentarlo.'
    if (err instanceof Anthropic.APIError) {
      this.log.warn(`Error de la API de IA: ${err.status ?? '?'} ${err.message}`)
      return 'La IA no está disponible en este momento. Inténtalo más tarde.'
    }
    this.log.error(`Fallo inesperado al redactar el resumen: ${err instanceof Error ? err.message : String(err)}`)
    return 'No se pudo redactar el resumen con IA.'
  }
}
