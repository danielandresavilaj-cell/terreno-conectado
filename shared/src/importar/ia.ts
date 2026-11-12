/**
 * Importar con IA — TSK-FORM-021 (Enmienda 006).
 *
 * El servidor manda la pauta EN BLANCO (PDF, foto o el texto de un Word) a
 * Claude y recibe `SalidaIA`. Aquí vive lo que no depende del SDK: el esquema
 * de la salida, las instrucciones y el paso de la salida a la propuesta de
 * siempre (`TemplateImportProposal`), que luego valida
 * `templateImportProposalSchema` y revisa una persona en el asistente.
 *
 * La IA propone; nunca se guarda nada sin que alguien confirme (FR-029).
 */
import { z } from 'zod'
import { FIELD_PROPS_SCHEMA, RESPONSE_TYPES, type FieldProps, type ResponseType } from '../templates'
import type { FormatoImport, ParseResult, ProposedItem, ProposedSection } from '../xlsx/types'
import { type Bloque, MAX_PROMPT_DOC, limpiar, tipoDeOpciones, tipoPorEtiqueta } from './documento'

/**
 * Lo que devuelve el modelo (salida estructurada). Sólo tipos simples y
 * `nullable` en vez de opcionales: el formato JSON que acepta la API.
 */
export const salidaIASchema = z.object({
  secciones: z.array(
    z.object({
      titulo: z.string(),
      items: z.array(
        z.object({
          pregunta: z.string(),
          tipo: z.enum(RESPONSE_TYPES),
          obligatorio: z.boolean(),
          /** Sólo `select_single` / `select_multiple`. */
          opciones: z.array(z.string()).nullable(),
          /** Sólo `numeric`. */
          minimo: z.number().nullable(),
          maximo: z.number().nullable(),
        }),
      ),
    }),
  ),
  advertencias: z.array(z.string()),
})

export type SalidaIA = z.infer<typeof salidaIASchema>

/** Instrucciones fijas (van primero, para que el prompt caching las reutilice). */
export const INSTRUCCIONES_IA = `Eres el asistente que convierte pautas de inspección en terreno (minería, construcción, flotas) en formularios digitales.

Recibes UNA pauta en blanco: un PDF, una foto de una hoja en papel o el texto de un documento Word. Devuelve sus secciones y preguntas para que una persona las revise antes de guardarlas.

Tipos de respuesta (campo "tipo"):
- ok_nok_na: verificación con resultado Sí/No/N.A., Cumple/No cumple, Bueno/Malo, OK/No OK, o una casilla para marcar.
- select_single: elegir UNA opción de una lista (por ejemplo Bueno/Regular/Malo, turno Día/Noche). Pon las opciones en "opciones".
- select_multiple: marcar VARIAS opciones de una lista. Pon las opciones en "opciones".
- numeric: un número (cantidad, kilometraje, horómetro, temperatura, presión). Si la pauta indica un rango, ponlo en "minimo"/"maximo".
- date: una fecha.
- time: una hora.
- photo: la pauta pide una foto o evidencia fotográfica.
- text: cualquier otra respuesta libre (nombre, patente, observaciones, comentarios).

Reglas:
- Una sección por cada título o bloque de la pauta, en el orden del documento. Si no hay títulos, usa una sola sección llamada "General".
- Cada pregunta es una línea corta y clara, copiada del documento sin inventar contenido. Corrige solo errores evidentes de lectura.
- Omite firmas, timbres, "V°B°", logos, encabezados y pies de página, instrucciones generales y numeración.
- Una columna de "Observaciones" de una tabla se convierte en UNA pregunta de tipo text al final de su sección, no una por fila.
- "obligatorio" es true salvo en observaciones, comentarios o lo que la pauta marque como opcional.
- "opciones" es null salvo en select_single y select_multiple; "minimo" y "maximo" son null salvo en numeric.
- En "advertencias" anota en español, en frases cortas, lo que no pudiste leer bien o supusiste (por ejemplo "La sección 3 está borrosa: revisa las preguntas"). Si la imagen o el documento no es una pauta de inspección, devuelve secciones vacías y explícalo en advertencias.`

/** Texto plano de un Word para la IA: títulos, párrafos y tablas en Markdown. */
export function textoDeBloques(bloques: Bloque[]): string {
  const lineas: string[] = []
  for (const b of bloques) {
    if (b.tipo === 'titulo') lineas.push('', `## ${b.texto}`)
    else if (b.tipo === 'parrafo') lineas.push(b.lista ? `- ${b.texto}` : b.texto)
    else if (b.tipo === 'campo') lineas.push(`${b.prompt}: ____`)
    else {
      const filas = b.filas.map((f) => `| ${f.map((c) => c.replace(/\|/g, '/').replace(/\s+/g, ' ').trim()).join(' | ')} |`)
      if (filas.length) lineas.push('', filas[0], `|${' --- |'.repeat(b.filas[0].length)}`, ...filas.slice(1), '')
    }
  }
  return lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const clave = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Salida de la IA → propuesta de siempre. Defensivo: limpia, recorta, quita
 * firmas y duplicados, y corrige tipos que no calzan con sus opciones; todo lo
 * que cambia queda en `advertencias` para quien revisa.
 */
export function propuestaDesdeIA(salida: SalidaIA, nombre_archivo: string, formato: FormatoImport): ParseResult {
  const advertencias = salida.advertencias.map((a) => a.trim()).filter(Boolean).slice(0, 20)
  const secciones: ProposedSection[] = []

  for (const s of salida.secciones) {
    const titulo = limpiar(s.titulo).slice(0, 120) || 'General'
    const vistos = new Set<string>()
    const items: ProposedItem[] = []
    for (const it of s.items) {
      let prompt = limpiar(it.pregunta)
      if (!prompt) continue
      if (tipoPorEtiqueta(prompt) === 'omitir') continue
      if (prompt.length > MAX_PROMPT_DOC) {
        prompt = `${prompt.slice(0, MAX_PROMPT_DOC - 1).trimEnd()}…`
        advertencias.push(`Se acortó una pregunta larga en "${titulo}".`)
      }
      if (vistos.has(clave(prompt))) continue
      vistos.add(clave(prompt))

      let tipo: ResponseType = it.tipo
      const props: FieldProps = {}
      if (tipo === 'select_single' || tipo === 'select_multiple') {
        const opciones = [...new Set((it.opciones ?? []).map((o) => limpiar(o)).filter(Boolean))].slice(0, 30)
        if (opciones.length < 2) {
          tipo = 'text'
          advertencias.push(`"${prompt}" no traía opciones claras: quedó como texto.`)
        } else if (tipo === 'select_single' && tipoDeOpciones(opciones).type === 'ok_nok_na') {
          tipo = 'ok_nok_na'
        } else {
          props.options = opciones
        }
      } else if (tipo === 'numeric') {
        const { minimo: min, maximo: max } = it
        if (min !== null && Number.isFinite(min)) props.min = min
        if (max !== null && Number.isFinite(max)) props.max = max
        if (min !== null && max !== null && min > max) {
          delete props.min
          delete props.max
        }
      }
      props.required = it.obligatorio
      if (!FIELD_PROPS_SCHEMA[tipo].safeParse(props).success) {
        advertencias.push(`Se omitió "${prompt}": la IA propuso datos inválidos.`)
        continue
      }
      items.push({ prompt, response_type: tipo, required: it.obligatorio, props, opcionesConteo: {}, muestra: [], filasConDato: 0 })
    }
    if (items.length === 0) continue
    // Dos secciones con el mismo título se juntan.
    const previa = secciones.find((x) => clave(x.titulo) === clave(titulo))
    if (previa) {
      const ya = new Set(previa.items.map((i) => clave(i.prompt)))
      previa.items.push(...items.filter((i) => !ya.has(clave(i.prompt))))
    } else {
      secciones.push({ titulo, items })
    }
  }

  const total = secciones.reduce((n, s) => n + s.items.length, 0)
  if (total === 0) {
    const motivo = advertencias[0] ? ` La IA indicó: ${advertencias[0]}` : ''
    return { ok: false, error: `La IA no encontró preguntas en el documento.${motivo}` }
  }
  return {
    ok: true,
    propuesta: {
      nombre_archivo,
      formato,
      secciones,
      resumen: { secciones: secciones.length, items: total, filasDatos: 0 },
      advertencias: [...new Set(advertencias)],
    },
  }
}
