/**
 * Genera shared/fixtures/xlsx/spike-referencia.xlsx — libro de referencia del
 * spike xlsx (plans/007-formularios-dinamicos/spike-xlsx.md §3).
 * Estructura: hoja = sección; fila 1 título fusionado A1:J1; fila 2 encabezado
 * tipado (8 tipos FR-036); ≥200 filas de datos; celda destino D4 para rellenar.
 * Deterministico: RNG con semilla fija.
 */
import ExcelJS from 'exceljs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const outFile = fileURLToPath(new URL('../../fixtures/xlsx/spike-referencia.xlsx', import.meta.url))

// Aleatorio determinístico (mulberry32)
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = rng(20261008)
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

const workbook = new ExcelJS.Workbook()
const ws = workbook.addWorksheet('Inspección Diaria', { views: [{ state: 'frozen', ySplit: 2 }] })

// Fila 1: título fusionado (fidelidad de fusión)
ws.mergeCells('A1:J1')
const title = ws.getCell('A1')
title.value = 'Inspección de Seguridad Diaria — Minera El Cobre'
title.font = { bold: true, size: 14 }
title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } }
title.alignment = { horizontal: 'center' }

// Fila 2: encabezado tipado (8 tipos FR-036) con hints de convención
const headers = [
  ['A', 'Ítem a inspeccionar', 'text'],
  ['B', 'Responsable', 'text'],
  ['C', 'Turno', 'select_single'],
  ['D', 'Estado (ok/nok/na)', 'ok_nok_na'],
  ['E', 'Cantidad verificada', 'numeric'],
  ['F', 'Fecha de inspección (fecha)', 'date'],
  ['G', 'Hora de inicio (hora)', 'time'],
  ['H', 'Áreas revisadas (multi)', 'select_multiple'],
  ['I', 'Subsector', 'text'],
  ['J', 'Evidencia (foto)', 'photo'],
]
const headerRow = 2
for (const [col, label, tipo] of headers) {
  const cell = ws.getCell(`${col}${headerRow}`)
  cell.value = label
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
  cell.alignment = { vertical: 'middle', wrapText: true }
  cell.border = {
    top: { style: 'thin' }, left: { style: 'thin' },
    bottom: { style: 'thin' }, right: { style: 'thin' },
  }
}

ws.columns = [
  { key: 'a', width: 32 }, { key: 'b', width: 14 }, { key: 'c', width: 10 },
  { key: 'd', width: 16 }, { key: 'e', width: 12 }, { key: 'f', width: 14 },
  { key: 'g', width: 12 }, { key: 'h', width: 20 }, { key: 'i', width: 14 },
  { key: 'j', width: 18 },
]

const items = [
  'Zona A · Extintor 01', 'Zona A · Extintor 02', 'Zona B · Tablero eléctrico',
  'Zona B · Luminaria 03', 'Zona C · Pasillo de evacuación', 'Zona C · Señalética',
  'Zona D · Grúa horquilla', 'Zona D · Puerta de emergencia', 'Zona E · Escalera',
  'Zona E · Plataforma de acceso',
]
const responsables = ['Juan Pérez', 'Ana Silva', 'Luis Rojas', 'María Fuentes', 'Pedro Soto']
const turnos = ['Día', 'Tarde', 'Noche']
const estados = ['OK', 'NOK', 'N/A']
const areas = ['Operación', 'Mantención', 'Seguridad', 'Medio Ambiente', 'Bodega']
const subsectores = ['A', 'B', 'C', 'D', 'E', 'F', 'G']

for (let i = 0; i < 250; i++) {
  const row = i + 3 // filas 3..252
  const celda = (col, value) => {
    const c = ws.getCell(`${col}${row}`)
    c.value = value
    c.border = {
      top: { style: 'hair' }, left: { style: 'hair' },
      bottom: { style: 'hair' }, right: { style: 'hair' },
    }
    if (i % 2 === 0) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F7FB' } }
  }
  celda('A', `${items[i % items.length]} — puesto ${1 + ((i / items.length) | 0)}`)
  celda('B', pick(responsables))
  celda('C', pick(turnos))
  // D: Estado (celda destino D4 = 'OK' para el harness de export)
  celda('D', pick(estados))
  celda('E', Math.floor(rnd() * 51))
  // F: fecha real (número de serie + formato) — medio día UTC para evitar deriva de zona horaria
  const fecha = new Date(Date.UTC(2026, 0, 1 + (i % 360), 12))
  celda('F', fecha)
  const f = ws.getCell(`F${row}`)
  f.value = fecha
  f.numFmt = 'yyyy-mm-dd'
  // G: hora real (fracción) con formato hh:mm
  const hora = new Date(Date.UTC(2026, 0, 1, 6 + (i % 12), 5 * (i % 12)))
  const g = ws.getCell(`G${row}`)
  g.value = hora
  g.numFmt = 'hh:mm'
  // H: multi con ';'
  celda('H', `${pick(areas)}; ${pick(areas.slice(0, 3))}`)
  // I: subsector — a veces vacío (para cubrir required=false y huecos en dato)
  celda('I', i % 5 === 0 ? null : pick(subsectores))
  // J: foto (marcador vacío)
  celda('J', null)
}

mkdirSync(dirname(outFile), { recursive: true })
const buf = await workbook.xlsx.writeBuffer()
writeFileSync(outFile, Buffer.from(buf))
console.log(`OK ${outFile} (${buf.length} bytes, 250 filas de datos)`)
