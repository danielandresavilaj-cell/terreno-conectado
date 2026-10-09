/**
 * Harness del spike xlsx (plans/007 spike-xlsx §4).
 * Mide, para ExcelJS y SheetJS CE, el ciclo parse + rellenar celda destino +
 * export a buffer (tiempo), la memoria del módulo, el bundle gzip, la
 * ejecución en worker_threads y la fidelidad de estilos al re-exportar.
 * Escribe spike-xlsx-metrics.json en tmp (lo consume report.mjs).
 */
import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import esbuild from 'esbuild'
import { gzipSync } from 'node:zlib'
import { Worker } from 'node:worker_threads'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('../../fixtures/xlsx/spike-referencia.xlsx', import.meta.url))
const buf = readFileSync(fixture)
const REDONDEAR = (n) => Math.round(n * 100) / 100

async function medirAsync(fn, runs = 5) {
  await fn() // warm-up
  const t0 = performance.now()
  for (let i = 0; i < runs; i++) await fn()
  return REDONDEAR((performance.now() - t0) / runs)
}
const medirSync = (fn, runs = 5) => {
  fn()
  const t0 = performance.now()
  for (let i = 0; i < runs; i++) fn()
  return REDONDEAR((performance.now() - t0) / runs)
}

/* ── tiempo: parse + rellenar D4 + export a buffer ──────────────────────── */
const msExceljs = await medirAsync(async () => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  wb.getWorksheet('Inspección Diaria').getCell('D4').value = 'OK'
  await wb.xlsx.writeBuffer()
})
const msXlsx = medirSync(() => {
  const wb = XLSX.read(buf, { type: 'buffer' })
  wb.Sheets['Inspección Diaria'].D4 = { t: 's', v: 'OK' }
  XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
})

/* ── memoria del módulo (child --expose-gc, heapUsed bootstrap) ─────────── */
const memModulo = (spec) => {
  const out = execFileSync(process.execPath, ['--expose-gc', '-e',
    `(()=>{ const b0=process.memoryUsage().heapUsed; import('${spec}').then(()=>{ global.gc(); const b1=process.memoryUsage().heapUsed; console.log(((b1-b0)/1048576).toFixed(2)) }) })()`,
  ], { encoding: 'utf8' })
  return REDONDEAR(parseFloat(out.trim()))
}
const heapExceljs = memModulo('exceljs')
const heapXlsx = memModulo('xlsx')

/* ── bundle gzip (solo el módulo importado, build de producción) ─────────── */
const spikeDir = fileURLToPath(new URL('.', import.meta.url))
async function bundleGzip(lib) {
  const entry = join(spikeDir, `.spike-entry-${lib}.mjs`)
  const out = join(spikeDir, `.spike-entry-${lib}.js`)
  const imp = lib === 'xlsx' ? "import * as XLSX from 'xlsx'; globalThis.__spike = XLSX.read" : "import ExcelJS from 'exceljs'; globalThis.__spike = ExcelJS.Workbook"
  writeFileSync(entry, imp)
  await esbuild.build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', platform: 'browser', outfile: out, logLevel: 'error', absWorkingDir: spikeDir })
  const raw = readFileSync(out)
  return { totalKB: REDONDEAR(raw.length / 1024), gzipKB: REDONDEAR(gzipSync(raw).length / 1024) }
}
const bundleExceljs = await bundleGzip('exceljs')
const bundleXlsx = await bundleGzip('xlsx')

/* ── worker_threads: parse offline sin bloquear el hilo principal ────────── */
const workerMs = (code, data) =>
  new Promise((resolve, reject) => {
    const w = new Worker(code, { eval: true, workerData: data })
    const t0 = performance.now()
    w.on('message', () => resolve(REDONDEAR(performance.now() - t0)))
    w.on('error', reject)
  })
const workerExceljs = await workerMs(
  `const {parentPort,workerData}=require('node:worker_threads');
   const ExcelJS=require('exceljs');
   new ExcelJS.Workbook().xlsx.load(Buffer.from(workerData)).then(()=>parentPort.postMessage('ok'))`,
  buf
).catch((e) => `fail: ${e.message}`)
const workerXlsx = await workerMs(
  `const {parentPort,workerData}=require('node:worker_threads');
   const XLSX=require('xlsx');
   XLSX.read(new Uint8Array(workerData),{type:'buffer'});
   parentPort.postMessage('ok')`,
  buf
).catch((e) => `fail: ${e.message}`)

/* ── fidelidad de estilos al rellenar y re-exportar ──────────────────────── */
function libroBase() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('S')
  const c = ws.getCell('A1')
  c.value = 'Título'
  c.font = { bold: true }
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
  c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  ws.mergeCells('A1:B1')
  ws.getCell('C1').value = 42
  ws.columns = [{ width: 25 }, { width: 25 }, { width: 25 }]
  return wb
}
async function evaluarFidelidad(buffer) {
  const w2 = new ExcelJS.Workbook()
  await w2.xlsx.load(buffer)
  const s = w2.getWorksheet('S')
  const a1 = s.getCell('A1')
  const merges = s.model.merges ? s.model.merges.length : (s._merges ? s._merges.length : 0)
  return {
    negrita: a1.font?.bold === true,
    fondo: !!a1.fill?.fgColor,
    bordes: !!a1.border?.top?.style,
    fusion: merges >= 1,
    ancho: s.getColumn(1).width === 25,
    tipoNumero: s.getCell('C1').value === 42,
  }
}
const wbE = libroBase()
const outE = await wbE.xlsx.writeBuffer()
const tickE = await evaluarFidelidad(outE)
const wbX = libroBase()
const outX = XLSX.write(XLSX.read(new Uint8Array(await wbX.xlsx.writeBuffer()), { type: 'array' }), { type: 'buffer', bookType: 'xlsx' })
const tickX = await evaluarFidelidad(outX)
const score = (t) => Object.values(t).filter(Boolean).length

const metrics = {
  fecha: new Date().toISOString(),
  run: `npm run spike:xlsx — fixture ${fixture}`,
  tiempo_ms: { exceljs: msExceljs, xlsx: msXlsx },
  memoria_modulo_MB: { exceljs: heapExceljs, xlsx: heapXlsx },
  bundle: { exceljs: bundleExceljs, xlsx: bundleXlsx },
  worker_ms: { exceljs: workerExceljs, xlsx: workerXlsx },
  fidelidad: { exceljs: { ...tickE, score: score(tickE) }, xlsx: { ...tickX, score: score(tickX) } },
}
writeFileSync(join(tmpdir(), 'spike-xlsx-metrics.json'), JSON.stringify(metrics, null, 2))
process.stdout.write(JSON.stringify(metrics, null, 2) + '\n')
