/**
 * Importador de documentos (Word / PDF) — TSK-FORM-020, Enmienda 005.
 *
 * Un `.docx` o un `.pdf` no tiene hojas: tiene títulos, párrafos, tablas y, en
 * los PDF rellenables, campos. Cada lector (`docx.ts`, y el de PDF en el
 * backend) reduce el archivo a esta lista de bloques, y este módulo, puro y
 * determinístico, la convierte en la misma `TemplateImportProposal` que produce
 * el `.xlsx`. La inferencia de tipos de las tablas "en columnas" es literalmente
 * la del `.xlsx` (`proponerDesdeCuadriculas`), así que ambos formatos proponen
 * igual frente a los mismos datos.
 *
 * Tres formas de tabla, porque en Word una pauta casi nunca es como un Excel:
 * - **Lista de chequeo:** una fila por pregunta y columnas de opciones
 *   (`Sí | No | N/A`, `Cumple | No cumple`, `B | R | M`). Cada fila = un ítem.
 * - **Ficha:** pares `Etiqueta | (vacío)` (`Fecha | ___`). Cada etiqueta = un ítem.
 * - **Cuadrícula:** encabezado con columnas y filas de datos. Igual que el `.xlsx`.
 *
 * Los ítems de Word/PDF no llevan `source` (celda de origen): la exportación
 * "original rellenado" es sólo para plantillas que vienen de un `.xlsx`.
 */
import { FIELD_PROPS_SCHEMA } from '../templates'
import type { FieldProps, ResponseType } from '../templates'
import type { CeldaLibro } from '../xlsx/escolta'
import { proponerDesdeCuadriculas } from '../xlsx/import'
import type { FormatoImport, ParseResult, ProposedItem, ProposedSection } from '../xlsx/types'

export type Bloque =
  | { tipo: 'titulo'; texto: string }
  | { tipo: 'parrafo'; texto: string; lista?: boolean }
  | { tipo: 'tabla'; filas: string[][] }
  /** Campo de un formulario PDF rellenable: el tipo ya viene dado. */
  | { tipo: 'campo'; prompt: string; response_type: ResponseType; options?: string[] }

/** Más largo que esto no es una pregunta sino instrucciones. */
export const MAX_PROMPT_DOC = 200
const SECCION_POR_DEFECTO = 'General'

const CASILLA = /[☐□❑▢◻⬜☑☒✓✔]/
const RE_CASILLAS = /[☐□❑▢◻⬜☑☒]|\[\s?[xX]?\s?\]/g
const RE_LLENAR = /[_.…]{3,}/
const RE_ETIQUETA_LINEA = /([^:_.…]{2,60}?):\s*(?:[_.…]{3,}|$)/g
const RE_NUMERADO = /^\s*(\d{1,3}|[a-z])[.)]\s+(.+)$/i

const POSITIVOS = new Set(['si', 'sí', 'cumple', 'c', 'ok', 'bueno', 'b', 'aprobado', 'conforme', 'bien'])
const NEGATIVOS = new Set(['no', 'no cumple', 'nc', 'nok', 'malo', 'm', 'rechazado', 'no conforme', 'mal'])
const NO_APLICA = new Set(['na', 'n/a', 'no aplica', 'n.a', 'n a'])
const INTERMEDIOS = new Set(['regular', 'r', 'parcial', 'observado'])
const OBSERVACION = /^(obs|observaci|comentario|nota)/i
const PREGUNTA = /^(ítem|item|pregunta|descripci|aspecto|actividad|punto|elemento|requisito|criterio|verificaci|control|condici)/i

function norm(t: string): string {
  return t.toLowerCase().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').replace(/[.:]+$/, '').trim()
}

/** Texto sin casillas, rayas para llenar ni espacios sobrantes. */
export function limpiar(t: string): string {
  return t.replace(RE_CASILLAS, ' ').replace(/[_…]{3,}|\.{4,}/g, ' ').replace(/\s+/g, ' ').trim()
}

function esVacia(t: string): boolean {
  return limpiar(t).replace(/^[xX✓✔]$/, '') === ''
}

function esOpcion(t: string): boolean {
  const n = norm(t)
  return POSITIVOS.has(n) || NEGATIVOS.has(n) || NO_APLICA.has(n) || INTERMEDIOS.has(n)
}

/** Tipo de un ítem a partir de su etiqueta ("Fecha", "N° de equipo", "Firma"). */
export function tipoPorEtiqueta(etiqueta: string): ResponseType | 'omitir' {
  const e = norm(etiqueta)
  if (/firma|timbre|v[°º]\s?b[°º]|visto bueno/.test(e)) return 'omitir'
  if (/\bfecha\b/.test(e)) return 'date'
  if (/\bhora\b/.test(e)) return 'time'
  if (/\b(foto|fotograf|imagen|evidencia)/.test(e)) return 'photo'
  if (/^(n[°º]|nro|num|número|numero|cantidad|cant|total|km|kilometraje|horómetro|horometro|temperatura|presión|presion|peso|litros|edad|años)(?![a-záéíóúñ])/.test(e)) return 'numeric'
  if (/\b(temperatura|kilometraje|horómetro|horometro|cantidad)\b/.test(e)) return 'numeric'
  return 'text'
}

/** Opciones de encabezado → `ok_nok_na` si son sí/no(/n.a.), si no lista. */
export function tipoDeOpciones(opciones: string[]): { type: ResponseType; options?: string[] } {
  const ns = opciones.map(norm)
  const pos = ns.filter((n) => POSITIVOS.has(n)).length
  const neg = ns.filter((n) => NEGATIVOS.has(n)).length
  const na = ns.filter((n) => NO_APLICA.has(n)).length
  if (pos === 1 && neg === 1 && pos + neg + na === ns.length) return { type: 'ok_nok_na' }
  return { type: 'select_single', options: opciones.map((o) => o.trim()) }
}

interface Acumulador {
  secciones: ProposedSection[]
  actual: ProposedSection
  advertencias: string[]
}

function nuevaSeccion(acc: Acumulador, titulo: string): void {
  const t = titulo.trim().slice(0, 120) || SECCION_POR_DEFECTO
  if (acc.actual.items.length === 0) {
    acc.actual.titulo = t
    return
  }
  acc.secciones.push(acc.actual)
  acc.actual = { titulo: t, items: [] }
}

function agregar(acc: Acumulador, prompt: string, type: ResponseType, props: FieldProps = {}): void {
  const p = prompt.replace(/\s+/g, ' ').replace(/[:\s]+$/, '').trim()
  if (p === '') return
  if (p.length > MAX_PROMPT_DOC) {
    acc.advertencias.push(`Se omitió un texto largo que parece instrucción: "${p.slice(0, 60)}…"`)
    return
  }
  const fullProps: FieldProps = { required: false, ...props }
  if (!FIELD_PROPS_SCHEMA[type].safeParse(fullProps).success) return
  acc.actual.items.push({
    prompt: p,
    response_type: type,
    required: false,
    props: fullProps,
    opcionesConteo: {},
    muestra: [],
    filasConDato: 0,
  })
}

function agregarPorEtiqueta(acc: Acumulador, etiqueta: string): void {
  const tipo = tipoPorEtiqueta(etiqueta)
  if (tipo === 'omitir') {
    acc.advertencias.push(`Se omitió "${limpiar(etiqueta)}": las firmas no son un campo de captura.`)
    return
  }
  agregar(acc, limpiar(etiqueta), tipo)
}

/* ── Párrafos ─────────────────────────────────────────────────────────────── */

function procesarParrafo(acc: Acumulador, b: { texto: string; lista?: boolean }): void {
  const texto = b.texto.replace(/\s+/g, ' ').trim()
  if (texto === '') return

  // "¿Frenos operativos? ☐ Sí ☐ No ☐ N/A" o "☐ Extintor vigente".
  if (CASILLA.test(texto) || /\[\s?[xX]?\s?\]/.test(texto)) {
    const partes = texto.split(RE_CASILLAS).map((s) => s.trim()).filter(Boolean)
    const opciones = partes.slice(1).filter(esOpcion)
    if (partes.length > 1 && opciones.length >= 2 && opciones.length === partes.length - 1) {
      const t = tipoDeOpciones(opciones)
      agregar(acc, partes[0], t.type, t.options ? { options: t.options } : {})
      return
    }
    // Cada casilla con su texto es un ítem sí/no.
    for (const p of partes) if (!esOpcion(p)) agregar(acc, p, 'ok_nok_na')
    return
  }

  // "Fecha: ______  Hora: ______" → dos ítems.
  if (RE_LLENAR.test(texto) || /:\s*$/.test(texto)) {
    const etiquetas = [...texto.matchAll(RE_ETIQUETA_LINEA)].map((m) => m[1].trim()).filter(Boolean)
    if (etiquetas.length > 0) {
      for (const e of etiquetas) agregarPorEtiqueta(acc, e)
      return
    }
  }

  // Lista numerada → punto de chequeo.
  const num = texto.match(RE_NUMERADO)
  if (b.lista || num) {
    const p = num ? num[2] : texto
    if (p.length <= MAX_PROMPT_DOC) {
      agregar(acc, p, 'ok_nok_na')
      acc.advertencias.push(`"${p.slice(0, 50)}" se propuso como OK/No OK/N.A. por estar en una lista; cámbialo en Editar si no corresponde.`)
    }
  }
  // Un párrafo suelto es instrucción o contexto: no es pregunta.
}

/* ── Tablas ──────────────────────────────────────────────────────────────── */

function celda(t: string): CeldaLibro | null {
  const texto = limpiar(t)
  if (texto === '') return null
  const c: CeldaLibro = { texto }
  if (/^-?\d+(?:[.,]\d+)?$/.test(texto)) c.numero = Number(texto.replace(',', '.'))
  const dmy = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) c.fecha = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  else if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) c.fecha = texto
  const hm = texto.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (hm) c.hora = `${hm[1].padStart(2, '0')}:${hm[2]}`
  return c
}

function procesarListaChequeo(acc: Acumulador, filas: string[][], enc: number): void {
  const cab = filas[enc]
  const colsOpcion = cab.map((c, i) => (esOpcion(c) ? i : -1)).filter((i) => i >= 0)
  const colObs = cab.findIndex((c) => OBSERVACION.test(norm(c)))
  // Columna de la pregunta: la que se llama así, o la primera con texto que no sea número ni opción.
  let colP = cab.findIndex((c) => PREGUNTA.test(norm(c)))
  if (colP < 0) {
    colP = cab.findIndex((_, i) => {
      if (colsOpcion.includes(i) || i === colObs) return false
      const cuerpo = filas.slice(enc + 1).map((f) => limpiar(f[i] ?? ''))
      const conTexto = cuerpo.filter((t) => t !== '' && !/^\d+[.)]?$/.test(t))
      return conTexto.length > 0
    })
  }
  if (colP < 0) return
  const t = tipoDeOpciones(colsOpcion.map((i) => cab[i]))

  for (const fila of filas.slice(enc + 1)) {
    const llenas = fila.filter((c) => !esVacia(c))
    // Fila de una sola celda (combinada) = subtítulo dentro de la pauta.
    if (llenas.length === 1 && (fila.length === 1 || esVacia(fila[colP] ?? ''))) {
      nuevaSeccion(acc, limpiar(llenas[0]))
      continue
    }
    const pregunta = limpiar(fila[colP] ?? '')
    if (pregunta === '' || /^\d+[.)]?$/.test(pregunta)) continue
    agregar(acc, pregunta, t.type, t.options ? { options: t.options } : {})
  }
  if (colObs >= 0) {
    agregar(acc, `Observaciones — ${acc.actual.titulo}`, 'text')
    acc.advertencias.push(`La columna "${limpiar(cab[colObs])}" se convirtió en un solo campo de observaciones por sección.`)
  }
}

function esFicha(filas: string[][]): boolean {
  const utiles = filas.filter((f) => f.some((c) => !esVacia(c)))
  if (utiles.length === 0) return false
  const pares = utiles.filter((f) => {
    const llenas = f.map((c, i) => (!esVacia(c) ? i : -1)).filter((i) => i >= 0)
    // Etiquetas en columnas pares y el resto para llenar: "Fecha | ___ | Hora | ___".
    return llenas.length > 0 && llenas.every((i) => i % 2 === 0) && f.length >= 2
  })
  return pares.length / utiles.length >= 0.6
}

function procesarTabla(acc: Acumulador, filas: string[][], nombre: string): void {
  const utiles = filas.filter((f) => f.some((c) => !esVacia(c)))
  if (utiles.length === 0) return

  // 1. Lista de chequeo: alguna de las primeras filas tiene ≥ 2 columnas de opciones.
  const enc = utiles.slice(0, 3).findIndex((f) => f.filter(esOpcion).length >= 2)
  if (enc >= 0) {
    procesarListaChequeo(acc, utiles, enc)
    return
  }

  // 2. Ficha "Etiqueta | ___".
  if (esFicha(utiles)) {
    for (const f of utiles) {
      for (let i = 0; i < f.length; i += 2) if (!esVacia(f[i])) agregarPorEtiqueta(acc, f[i])
    }
    return
  }

  // 3. Cuadrícula: la misma inferencia que el .xlsx.
  const r = proponerDesdeCuadriculas([{ nombre: acc.actual.titulo, filas: utiles.map((f) => f.map(celda)) }], nombre)
  if (!r.ok) return
  acc.advertencias.push(...(r.propuesta.advertencias ?? []))
  for (const s of r.propuesta.secciones) {
    for (const it of s.items) {
      const tipo = tipoPorEtiqueta(it.prompt)
      if (tipo === 'omitir') {
        acc.advertencias.push(`Se omitió "${it.prompt}": las firmas no son un campo de captura.`)
        continue
      }
      // Sin datos de ejemplo, la etiqueta dice más que la columna vacía.
      const sinDatos = it.filasConDato === 0
      const { source: _s, ...resto } = it
      acc.actual.items.push(
        sinDatos && tipo !== 'text' ? { ...resto, response_type: tipo, props: { required: false } } : resto,
      )
    }
  }
}

/** Bloques → propuesta. Puro y determinístico. */
export function proponerDesdeDocumento(bloques: Bloque[], nombre_archivo: string, formato: FormatoImport): ParseResult {
  const acc: Acumulador = { secciones: [], actual: { titulo: SECCION_POR_DEFECTO, items: [] }, advertencias: [] }
  try {
    for (const b of bloques) {
      if (b.tipo === 'titulo') nuevaSeccion(acc, limpiar(b.texto))
      else if (b.tipo === 'parrafo') procesarParrafo(acc, b)
      else if (b.tipo === 'tabla') procesarTabla(acc, b.filas, nombre_archivo)
      else if (b.tipo === 'campo') {
        const tipo = tipoPorEtiqueta(b.prompt)
        if (tipo === 'omitir') acc.advertencias.push(`Se omitió "${b.prompt}": las firmas no son un campo de captura.`)
        else agregar(acc, b.prompt, b.response_type, b.options?.length ? { options: b.options } : {})
      }
    }
    if (acc.actual.items.length > 0) acc.secciones.push(acc.actual)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // Preguntas repetidas dentro de una sección (encabezados de tabla que se repiten por página).
  const secciones = acc.secciones
    .map((s) => {
      const vistos = new Set<string>()
      return { ...s, items: s.items.filter((it: ProposedItem) => !vistos.has(norm(it.prompt)) && vistos.add(norm(it.prompt))) }
    })
    .filter((s) => s.items.length > 0)

  if (secciones.length === 0) {
    return {
      ok: false,
      error:
        'No se encontraron preguntas en el documento. Usa tablas (una fila por pregunta con columnas Sí/No/N.A., o un encabezado con columnas) o líneas con casillas ☐ o "Etiqueta: ____".',
    }
  }
  return {
    ok: true,
    propuesta: {
      nombre_archivo,
      formato,
      secciones,
      resumen: {
        secciones: secciones.length,
        items: secciones.reduce((n, s) => n + s.items.length, 0),
        filasDatos: 0,
      },
      advertencias: [...new Set(acc.advertencias)].slice(0, 30),
    },
  }
}
