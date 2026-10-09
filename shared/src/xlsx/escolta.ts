/**
 * Escolta de `.xlsx` — módulo 007 (ADR-003 d4/d5, TSK-FORM-005/010).
 *
 * Enmienda 1 del ADR-003: **ExcelJS** es la única escolta de V1 (spike cerrado,
 * `plans/007-formularios-dinamicos/spike-xlsx-result.md`).
 *
 * Este wrapper aísla la API de la librería para poder correr igual en un Web
 * Worker (dispositivo, Art. I) y en Node (servidor), y normaliza cada celda a
 * una forma agnóstica (`CeldaLibro`) para que el parser (`import.ts`) sea puro,
 * determinístico y testeable sin depender de la librería.
 *
 * El import (read) se usa en TSK-FORM-005; `escribirLibro` (write) lo consumirá
 * el export rellenado del TSK-FORM-010. Misma escolta, mismo módulo (ADR-003 d5).
 */
import ExcelJS from 'exceljs'

/** Celda normalizada y agnóstica de la librería. */
export interface CeldaLibro {
  /** Texto limpio (para detección de tipos y preview). */
  texto: string
  /** Valor numérico real (celdas numéricas puras). */
  numero?: number
  /** Fecha ISO `YYYY-MM-DD` (celdas de fecha, formato de Excel). */
  fecha?: string
  /** Hora `HH:MM` (celdas de hora de Excel). */
  hora?: string
}

/** Hoja de un libro ya normalizada a cuadrícula. */
export interface HojaLibro {
  nombre: string
  filas: (CeldaLibro | null)[][]
}

export interface CambioCelda {
  hoja: string
  celda: string
  valor: string | number | boolean | Date | null
}

const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

/** Rellena con ceros a la izquierda hasta dos dígitos (hora/fecha). */
function dos(n: number): string {
  return String(n).padStart(2, '0')
}

/** Hora `HH:MM` desde la fracción de día de Excel (0.5 → `12:00`). */
function horaDeFraccion(frac: number): string {
  const totalMin = Math.round(frac * 24 * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${dos(h % 24)}:${dos(m)}`
}

function textoDe(valor: unknown): string | null {
  if (typeof valor === 'string') {
    const t = valor.trim()
    return t === '' ? null : t
  }
  if (typeof valor === 'boolean') return valor ? 'true' : 'false'
  if (typeof valor === 'number' || valor instanceof Date) return null
  if (typeof valor === 'object' && valor !== null) {
    const o = valor as { result?: unknown; richText?: { text: string }[]; text?: unknown }
    if (o.result !== undefined && o.result !== null) return textoDe(o.result)
    if (o.richText) {
      const joined = o.richText.map((r) => r.text ?? '').join('').trim()
      return joined === '' ? null : joined
    }
    if (o.text !== undefined && o.text !== null) {
      const t = String(o.text).trim()
      return t === '' ? null : t
    }
  }
  return null
}

function normalizarCelda(celda: ExcelJS.Cell): CeldaLibro | null {
  // ExcelJS expone `cell.type` como `ValueType` (enum numérico, no string).
  const type = celda.type
  const fmt = (celda.numFmt ?? '').toLowerCase()

  if (type === ExcelJS.ValueType.Number) {
    const n = celda.value as number
    if (Number.isFinite(n) && fmt.includes('h') && fmt.includes('m')) {
      const h = horaDeFraccion(n)
      return { texto: h, hora: h }
    }
    if (Number.isFinite(n)) {
      return { texto: String(n), numero: n }
    }
  }

  if (type === ExcelJS.ValueType.Date || celda.value instanceof Date) {
    const raw = celda.value
    const d = raw instanceof Date ? raw : new Date(typeof raw === 'number' ? raw : Date.parse(String(raw)))
    if (Number.isNaN(d.getTime())) return null
    if (fmt.includes('h') && !fmt.includes('y') && !fmt.includes('d')) {
      const h = `${dos(d.getHours())}:${dos(d.getMinutes())}`
      return { texto: h, hora: h }
    }
    const fecha = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`
    return { texto: fecha, fecha }
  }

  // Celdas de texto, rich text, booleanos y fórmulas resueltas: coaccionamos
  // a texto y detectamos numérico/fecha/hora si aplica (evita rechazar libros
  // que guardan valores como texto).
  if (
    type === ExcelJS.ValueType.String ||
    type === ExcelJS.ValueType.RichText ||
    type === ExcelJS.ValueType.Boolean ||
    type === ExcelJS.ValueType.Formula
  ) {
    const t = textoDe(celda.value)
    if (!t) return null
    // numérico (acepta coma o punto decimal)
    if (/^-?\d+(?:[.,]\d+)?$/.test(t.replace(',', '.'))) {
      const n = parseFloat(t.replace(',', '.'))
      if (Number.isFinite(n)) return { texto: t, numero: n }
    }
    // fecha ISO
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { texto: t, fecha: t }
    // hora
    if (RE_HORA.test(t)) return { texto: t, hora: t }
    return { texto: t }
  }

  return null
}

/** Lee un libro desde un buffer y lo normaliza a cuadrículas (`HojaLibro[]`). */
export async function leerCuadricula(buffer: Uint8Array): Promise<HojaLibro[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof wb.xlsx.load>[0])
  return wb.worksheets.map((hoja) => {
    const filas: (CeldaLibro | null)[][] = []
    for (let r = 1; r <= hoja.rowCount; r++) {
      const fila: (CeldaLibro | null)[] = []
      const row = hoja.getRow(r)
      for (let c = 1; c <= hoja.columnCount; c++) fila.push(normalizarCelda(row.getCell(c)))
      filas.push(fila)
    }
    return { nombre: hoja.name, filas }
  })
}

/**
 * Reabre un libro, aplica cambios por celda y devuelve el buffer resultante.
 * Es el punto de entrada del export rellenado (TSK-FORM-010, FR-019/044):
 * misma escolta y mismo módulo que el import (ADR-003 d5).
 */
export async function escribirLibro(buffer: Uint8Array, cambios: CambioCelda[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof wb.xlsx.load>[0])
  for (const cambio of cambios) {
    const hoja = wb.getWorksheet(cambio.hoja)
    if (!hoja) throw new Error(`hoja '${cambio.hoja}' no existe en el libro`)
    hoja.getCell(cambio.celda).value = cambio.valor
  }
  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out)
}