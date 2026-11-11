/**
 * Excel consolidado — TSK-REP-007 (FR-045 en su texto literal: un `.xlsx`).
 *
 * Un solo libro con todas las inspecciones elegidas:
 * 1. **Resumen**: una fila por inspección (enlaza a su fila de detalle).
 * 2. **Una hoja por formulario**: filas = inspecciones, columnas = preguntas
 *    agrupadas por sección. Las columnas se identifican por el id del ítem y se
 *    juntan entre versiones, así una plantilla que cambió no desalinea nada.
 * 3. **Hallazgos** de esas inspecciones.
 * 4. **Evidencias**: fotos incrustadas bajo umbral, referenciadas por encima.
 *
 * Funciona para cualquier plantilla (hecha a mano, desde Excel, Word o PDF):
 * no necesita el libro original.
 */
import ExcelJS from 'exceljs'
import type { InspeccionExportable, MetaExportacion } from './tipos'
import { ESTADO_HALLAZGO_LABEL, ESTADO_LABEL, SEVERIDAD_LABEL, fechaLegible, nokDe } from './tipos'

const COLOR_ENCABEZADO = 'FF1F2937'
const COLOR_SECCION = 'FF374151'
const COLOR_NOK = 'FFFDE2E2'
const COLOR_NOK_TEXTO = 'FFB91C1C'

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Nombre de hoja válido en Excel (≤ 31, sin `[]:*?/\`) y único. */
export function nombreHoja(base: string, usados: Set<string>): string {
  const limpio = base.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Formulario'
  let nombre = limpio.slice(0, 31)
  for (let n = 2; usados.has(nombre.toLowerCase()); n++) {
    const suf = ` (${n})`
    nombre = limpio.slice(0, 31 - suf.length) + suf
  }
  usados.add(nombre.toLowerCase())
  return nombre
}

function encabezado(fila: ExcelJS.Row): void {
  fila.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ENCABEZADO } }
  fila.alignment = { vertical: 'middle', wrapText: true }
  fila.height = 30
}

interface Columna {
  item_id: string
  seccion: string
  prompt: string
}

/** Columnas de un formulario: unión de ítems entre versiones, en orden de aparición. */
export function columnasDe(inspecciones: InspeccionExportable[]): Columna[] {
  const vistas = new Map<string, Columna>()
  // La versión más nueva primero: sus títulos y su orden mandan.
  const orden = [...inspecciones].sort((a, b) => b.formulario.version - a.formulario.version)
  for (const ins of orden) {
    for (const s of ins.secciones) {
      for (const r of s.respuestas) {
        if (!vistas.has(r.item_id)) vistas.set(r.item_id, { item_id: r.item_id, seccion: s.titulo, prompt: r.prompt })
      }
    }
  }
  return [...vistas.values()]
}

export async function construirConsolidado(
  inspecciones: InspeccionExportable[],
  meta: MetaExportacion,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Terreno Conectado'
  wb.created = new Date(meta.generado_at)
  const usados = new Set<string>()

  const resumen = wb.addWorksheet(nombreHoja('Resumen', usados), { views: [{ state: 'frozen', ySplit: 4 }] })
  resumen.getCell('A1').value = `${meta.empresa} — Inspecciones`
  resumen.getCell('A1').font = { bold: true, size: 14 }
  resumen.getCell('A2').value = `${meta.filtro} · ${inspecciones.length} inspecciones · generado ${fechaLegible(meta.generado_at)}`
  resumen.getCell('A2').font = { color: { argb: 'FF6B7280' } }

  // Hojas por formulario (template_id): se crean antes para poder enlazar.
  const porFormulario = new Map<string, InspeccionExportable[]>()
  for (const i of inspecciones) porFormulario.set(i.formulario.template_id, [...(porFormulario.get(i.formulario.template_id) ?? []), i])
  const destino = new Map<string, { hoja: string; fila: number }>()

  // Hojas de formulario en orden alfabético: predecible para quien busca una.
  const grupos = [...porFormulario.values()].sort((a, b) => a[0].formulario.nombre.localeCompare(b[0].formulario.nombre, 'es'))
  for (const grupo of grupos) {
    const nombre = nombreHoja(grupo[0].formulario.nombre, usados)
    const hoja = wb.addWorksheet(nombre, { views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }] })
    const cols = columnasDe(grupo)
    const fijas = ['Fecha', 'Faena', 'Autor', 'Estado', 'Versión']
    // Fila 1: sección (agrupa columnas); fila 2: pregunta.
    const filaSeccion = hoja.getRow(1)
    const filaPregunta = hoja.getRow(2)
    fijas.forEach((t, k) => {
      filaPregunta.getCell(k + 1).value = t
      filaSeccion.getCell(k + 1).value = k === 0 ? grupo[0].formulario.nombre : null
    })
    let inicioSeccion = fijas.length + 1
    cols.forEach((c, k) => {
      const col = fijas.length + 1 + k
      filaPregunta.getCell(col).value = c.prompt
      const siguiente = cols[k + 1]
      if (!siguiente || siguiente.seccion !== c.seccion) {
        filaSeccion.getCell(inicioSeccion).value = c.seccion
        if (col > inicioSeccion) hoja.mergeCells(1, inicioSeccion, 1, col)
        inicioSeccion = col + 1
      }
    })
    encabezado(filaPregunta)
    filaSeccion.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    filaSeccion.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_SECCION } }

    const orden = [...grupo].sort((a, b) => a.capturada_at.localeCompare(b.capturada_at))
    orden.forEach((ins, k) => {
      const valores = new Map(ins.secciones.flatMap((s) => s.respuestas.map((r) => [r.item_id, r] as const)))
      const fila = hoja.getRow(3 + k)
      ;[fechaLegible(ins.capturada_at), ins.faena, ins.autor, ESTADO_LABEL[ins.estado], ins.formulario.version].forEach(
        (v, j) => (fila.getCell(j + 1).value = v),
      )
      cols.forEach((c, j) => {
        const r = valores.get(c.item_id)
        const celda = fila.getCell(fijas.length + 1 + j)
        // Un ítem que no existía en la versión de esta inspección queda vacío, no "—".
        celda.value = r ? r.valor : null
        if (r?.nok) {
          celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_NOK } }
          celda.font = { bold: true, color: { argb: COLOR_NOK_TEXTO } }
        }
      })
      destino.set(ins.id, { hoja: nombre, fila: 3 + k })
    })
    hoja.columns.forEach((c, k) => (c.width = k < fijas.length ? [17, 18, 20, 11, 8][k] : 22))
    hoja.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2 + orden.length, column: fijas.length + cols.length } }
  }

  // Resumen.
  const cab = resumen.getRow(4)
  ;['Fecha', 'Faena', 'Formulario', 'Versión', 'Autor', 'Estado', 'No OK', 'Hallazgos', 'Ver detalle'].forEach(
    (t, k) => (cab.getCell(k + 1).value = t),
  )
  encabezado(cab)
  const ordenadas = [...inspecciones].sort((a, b) => a.capturada_at.localeCompare(b.capturada_at))
  ordenadas.forEach((ins, k) => {
    const fila = resumen.getRow(5 + k)
    const d = destino.get(ins.id)
    const nok = nokDe(ins)
    ;[fechaLegible(ins.capturada_at), ins.faena, ins.formulario.nombre, ins.formulario.version, ins.autor, ESTADO_LABEL[ins.estado], nok, ins.hallazgos.length].forEach(
      (v, j) => (fila.getCell(j + 1).value = v),
    )
    if (nok > 0) fila.getCell(7).font = { bold: true, color: { argb: COLOR_NOK_TEXTO } }
    if (d) {
      fila.getCell(9).value = { text: 'Abrir', hyperlink: `#'${d.hoja.replace(/'/g, "''")}'!A${d.fila}` }
      fila.getCell(9).font = { color: { argb: 'FF2563EB' }, underline: true }
    }
  })
  resumen.columns.forEach((c, k) => (c.width = [17, 18, 30, 8, 20, 11, 8, 10, 11][k] ?? 12))
  resumen.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + ordenadas.length, column: 8 } }

  // Hallazgos.
  const hallazgos = wb.addWorksheet(nombreHoja('Hallazgos', usados), { views: [{ state: 'frozen', ySplit: 1 }] })
  const cabH = hallazgos.addRow(['Fecha', 'Faena', 'Formulario', 'Severidad', 'Estado', 'Descripción', 'Resuelto', 'Horas al cierre'])
  encabezado(cabH)
  for (const ins of ordenadas) {
    for (const h of ins.hallazgos) {
      const horas = h.resuelto_at ? Math.round(((Date.parse(h.resuelto_at) - Date.parse(h.capturado_at)) / 3_600_000) * 10) / 10 : null
      const fila = hallazgos.addRow([
        fechaLegible(h.capturado_at),
        ins.faena,
        ins.formulario.nombre,
        SEVERIDAD_LABEL[h.severidad],
        ESTADO_HALLAZGO_LABEL[h.estado],
        h.descripcion,
        fechaLegible(h.resuelto_at),
        horas,
      ])
      if (h.severidad === 'critical' || h.severidad === 'high') fila.getCell(4).font = { bold: true, color: { argb: COLOR_NOK_TEXTO } }
    }
  }
  hallazgos.columns.forEach((c, k) => (c.width = [17, 18, 26, 10, 10, 50, 17, 12][k]))

  // Evidencias.
  const ev = wb.addWorksheet(nombreHoja('Evidencias', usados))
  encabezado(ev.addRow(['Fecha', 'Faena', 'Formulario', 'Ítem', 'Foto', 'Adjunto']))
  for (const ins of ordenadas) {
    for (const e of ins.evidencias) {
      const fila = ev.addRow([
        fechaLegible(ins.capturada_at),
        ins.faena,
        ins.formulario.nombre,
        e.item_prompt,
        null,
        e.bytes ? 'incrustada' : `referenciada${e.fileKey ? ` (${e.fileKey})` : ''}`,
      ])
      if (e.bytes && e.bytes.length > 0) {
        fila.height = 80
        const id = wb.addImage({ base64: base64(e.bytes), extension: e.mime.includes('png') ? 'png' : 'jpeg' })
        ev.addImage(id, { tl: { col: 4, row: fila.number - 1 }, ext: { width: 140, height: 100 } })
      }
    }
  }
  ev.columns.forEach((c, k) => (c.width = [17, 18, 26, 34, 22, 40][k]))

  return new Uint8Array(await wb.xlsx.writeBuffer())
}
