/**
 * Importador `.xlsx` — módulo 007 (TSK-FORM-005, FR-029).
 *
 * Convertidor **determinístico** de un libro estructurado a una propuesta de
 * plantilla (`TemplateImportProposal`): analiza hojas, encabezados, filas y
 * columnas; propone secciones, ítems y el mapeo campo→celda/columna; registra
 * la hoja + celda de origen en cada ítem para el export rellenado (FORM-010).
 * Sin IA en la ruta offline (FR-048 solo proposa mapas en backend con flag `ai`).
 *
 * ## Convención (documentada en spec 007 — "Importación asistida")
 *
 * - Cada **hoja** = una **sección** (título = nombre de la hoja).
 * - **Encabezado** = primera fila con ≥ 2 celdas pobladas (las filas previas
 *   se ignoran: títulos fusionados, parámetros, etc.).
 * - Cada **columna con encabezado** = un **ítem** propuesto; el prompt es el
 *   encabezado (sin el hint de tipo).
 * - Las **filas siguientes** son datos: se usan para detectar el tipo y para
 *   construir `props` (min/max, options[]) y `required`.
 * - Hints opcionales de tipo en el encabezado `(foto)`, `(ok/nok/na)`,
 *   `(fecha)`, `(hora)`, `(número)`, `(texto)`, `(lista)`, `(multi)`.
 * - Detección automática (sin hint): ok/nok/n/a → numeric → fecha → hora →
 *   multi (valores con `;`) → lista única (≤ 12 valores) → texto.
 *
 * La propuesta se valida contra el contrato Zod (`FIELD_PROPS_SCHEMA`) antes de
 * devolverse: **propuesta válida ⇒ se puede poblar `definition` con ids y
 * validar** (invariante FR-036/039).
 */
import { FIELD_PROPS_SCHEMA } from '../templates'
import type { FieldProps, ResponseType } from '../templates'
import type { CeldaLibro, HojaLibro } from './escolta'
import { leerCuadricula } from './escolta'
import type {
  ImportSourceOrigin,
  ParseResult,
  ProposedItem,
  ProposedSection,
  TemplateImportProposal,
} from './types'

const HINTS: Record<string, ResponseType> = {
  foto: 'photo',
  'ok/nok/na': 'ok_nok_na',
  fecha: 'date',
  hora: 'time',
  'número': 'numeric',
  numero: 'numeric',
  texto: 'text',
  lista: 'select_single',
  multi: 'select_multiple',
}

const RE_HINT = /^\s*(.+?)\s+\(([^()]*)\)\s*$/
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
const OK_NOK_NA = new Set(['ok', 'nok', 'na', 'n/a'])
const MAX_COLUMNA = 26 * 26 // ZZ
const UMBRAL_SELECT = 12

function letraDeColumna(idx: number): string {
  let n = idx + 1
  let out = ''
  while (n > 0) {
    const resto = (n - 1) % 26
    out = String.fromCharCode(65 + resto) + out
    n = (n - 1 - resto) / 26
  }
  return out
}

function celdaDireccion(columna: number, fila: number): string {
  return `${letraDeColumna(columna)}${fila}`
}

function textoNormalizado(celda: CeldaLibro): string {
  return celda.texto.toLowerCase().replace(/[.\u00a0]/g, '').trim()
}

function esOkNokNa(celda: CeldaLibro): boolean {
  return OK_NOK_NA.has(textoNormalizado(celda))
}

interface Deteccion {
  type: ResponseType
  props: FieldProps
}

function conDato(celdas: (CeldaLibro | null)[]): CeldaLibro[] {
  return celdas.filter((c): c is CeldaLibro => c !== null)
}

/** Detecta `response_type` y `props` de una columna (hint o automático). */
function detectarCampo(hint: ResponseType | null, celdas: (CeldaLibro | null)[]): Deteccion {
  const datos = conDato(celdas)
  const requerido = celdas.length > 0 && datos.length === celdas.length
  const conteoBase: FieldProps = { required: requerido }

  if (hint === 'photo' || hint === 'text' || hint === 'ok_nok_na') {
    return { type: hint, props: conteoBase }
  }

  if (hint === 'numeric') {
    const nums = datos.map((c) => c.numero).filter((n): n is number => n !== undefined)
    return {
      type: 'numeric',
      props: propsNumericas(nums, requerido),
    }
  }

  if (hint === 'date') {
    const minMax = minMaxDe(datos, (c) => c.fecha)
    return { type: 'date', props: { required: requerido, ...minMax } }
  }

  if (hint === 'time') {
    return { type: 'time', props: conteoBase }
  }

  if (hint === 'select_single' || hint === 'select_multiple') {
    const opciones =
      hint === 'select_multiple' ? opcionesDeMulti(datos) : obtenerUnicos(datos)
    if (opciones.length === 0) return { type: 'text', props: conteoBase }
    return { type: hint, props: { required: requerido, options: opciones } }
  }

  // ── Sin hint: detección automática determinística ────────────────────────
  if (datos.length === 0) return { type: 'text', props: { required: false } }

  if (datos.every((c) => c.numero !== undefined)) {
    return { type: 'numeric', props: propsNumericas(datos.map((c) => c.numero as number), requerido) }
  }

  if (datos.every((c) => c.fecha !== undefined || RE_FECHA.test(c.texto))) {
    const minMax = minMaxDe(datos, (c) => c.fecha ?? c.texto)
    return { type: 'date', props: { required: requerido, ...minMax } }
  }

  if (datos.every((c) => RE_HORA.test(c.hora ?? c.texto))) {
    return { type: 'time', props: conteoBase }
  }

  if (datos.every(esOkNokNa)) {
    return { type: 'ok_nok_na', props: conteoBase }
  }

  if (datos.some((c) => c.texto.includes(';'))) {
    const opciones = opcionesDeMulti(datos)
    if (opciones.length > 0) return { type: 'select_multiple', props: { required: requerido, options: opciones } }
  }

  const unicos = obtenerUnicos(datos)
  if (unicos.length > 0 && unicos.length <= UMBRAL_SELECT) {
    return { type: 'select_single', props: { required: requerido, options: unicos } }
  }

  return { type: 'text', props: conteoBase }
}

function propsNumericas(nums: number[], requerido: boolean): FieldProps {
  const props: FieldProps = { required: requerido }
  if (nums.length > 0) {
    const min = Math.min(...nums)
    const max = Math.max(...nums)
    if (min < max) {
      props.min = min
      props.max = max
    }
  }
  return props
}

function minMaxDe<T>(celdas: CeldaLibro[], get: (c: CeldaLibro) => T): { min?: T; max?: T } {
  const valores = celdas
    .map(get)
    .filter((v): v is T => v !== undefined && v !== null)
  if (valores.length === 0) return {}
  const min = valores.reduce((a, b) => (a < b ? a : b))
  const max = valores.reduce((a, b) => (a > b ? a : b))
  if (String(min) === String(max)) return {}
  return { min, max }
}

function obtenerUnicos(datos: CeldaLibro[]): string[] {
  return [...new Set(datos.map((c) => c.texto))].sort((a, b) => a.localeCompare(b))
}

function opcionesDeMulti(datos: CeldaLibro[]): string[] {
  const set = new Set<string>()
  for (const c of datos) {
    for (const parte of c.texto.split(';')) {
      const t = parte.trim()
      if (t !== '') set.add(t)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/**
 * Núcleo puro y determinístico: cuadrículas → propuesta. Exportado para tests
 * y para correr igual sinon la librería (Web Worker, Art. I).
 */
export function proponerDesdeCuadriculas(hojas: HojaLibro[], nombre_archivo: string): ParseResult {
  try {
    const secciones: ProposedSection[] = []
    let filasDatos = 0

    for (const hoja of hojas) {
      const titulo = hoja.nombre.trim()
      const items: ProposedItem[] = []

      // Encabezado: primera fila con ≥ 2 celdas pobladas.
      const encabezadoIdx = hoja.filas.findIndex(
        (fila) => conDato(fila).length >= 2,
      )
      if (encabezadoIdx === -1) continue

      const filaEncabezado = hoja.filas[encabezadoIdx]
      if (!filaEncabezado) continue

      const filasDato = hoja.filas.length - encabezadoIdx - 1
      if (filasDato > filasDatos) filasDatos = filasDato

      for (let col = 0; col < filaEncabezado.length && col < MAX_COLUMNA; col++) {
        const celdaEncabezado = filaEncabezado[col]
        if (celdaEncabezado === null) continue

        const m = celdaEncabezado.texto.match(RE_HINT)
        const prompt = (m ? m[1] : celdaEncabezado.texto).trim()
        if (prompt === '') continue
        const hint = m ? (HINTS[m[2].trim().toLowerCase()] ?? null) : null

        const columnaDatos = hoja.filas
          .slice(encabezadoIdx + 1)
          .map((fila) => fila[col] ?? null)

        const { type, props } = detectarCampo(hint, columnaDatos)
        const datos = conDato(columnaDatos)

        const source: ImportSourceOrigin = {
          sheet: titulo,
          column: letraDeColumna(col),
          headerCell: celdaDireccion(col, encabezadoIdx + 1),
          headerRow: encabezadoIdx + 1,
          firstDataRow: encabezadoIdx + 2,
        }

        const opcionesConteo: Record<string, number> = {}
        const muestra = [...new Set(datos.map((c) => c.texto))].slice(0, 5)
        for (const c of datos) opcionesConteo[c.texto] = (opcionesConteo[c.texto] ?? 0) + 1

        items.push({
          prompt,
          response_type: type,
          required: props.required ?? false,
          props,
          source,
          opcionesConteo,
          muestra,
          filasConDato: datos.length,
        })
      }

      // Invariante FR-036/039: toda propuesta debe validar con el contrato Zod.
      for (const item of items) {
        const check = FIELD_PROPS_SCHEMA[item.response_type].safeParse(item.props)
        if (!check.success) {
          return {
            ok: false,
            error: `'${item.prompt}' (${item.response_type}): ${check.error.issues[0]?.message}`,
          }
        }
      }

      if (items.length > 0) secciones.push({ titulo, items })
    }

    if (secciones.length === 0) {
      return { ok: false, error: 'No se detectó ninguna hoja válida (sin fila de encabezado con columnas)' }
    }

    return {
      ok: true,
      propuesta: {
        nombre_archivo,
        secciones,
        resumen: {
          secciones: secciones.length,
          items: secciones.reduce((acc, s) => acc + s.items.length, 0),
          filasDatos,
        },
      },
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Punto de entrada del importador: buffer del `.xlsx` → propuesta (async,
 * corre igual en Web Worker/offline y en Node — ADR-003 d5).
 */
export async function proponerImport(
  buffer: Uint8Array,
  nombre_archivo = 'plantilla.xlsx',
): Promise<ParseResult> {
  try {
    const hojas = await leerCuadricula(buffer)
    if (hojas.length === 0) return { ok: false, error: 'El archivo no contiene hojas' }
    return proponerDesdeCuadriculas(hojas, nombre_archivo)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? `No se pudo leer el .xlsx: ${err.message}` : 'No se pudo leer el .xlsx',
    }
  }
}