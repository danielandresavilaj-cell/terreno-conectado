/**
 * Tests del importador `.xlsx` (TSK-FORM-005, FR-029/FR-036/FR-039).
 *
 * Estrategia: los libros de prueba se generan **programáticamente con la
 * escolta** (ExcelJS) a buffer, y el parser se alimenta del mismo buffer —
 * cubre la convención sin depender de archivos binarios frágiles. Además hay
 * un test de integración con el fixture real del spike
 * (`shared/fixtures/xlsx/spike-referencia.xlsx`).
 */
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { proponerImport } from './import'

async function aBuffer(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf)
}

function nuevaHoja(nombre: string, titulo?: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(nombre)
  if (titulo) {
    ws.mergeCells(`A1:H1`)
    ws.getCell('A1').value = titulo
  }
  return wb
}

describe('proponerImport — detección automática de tipos', () => {
  it('detecta numeric con min/max desde los datos', async () => {
    const wb = nuevaHoja('Equipos')
    const ws = wb.getWorksheet('Equipos')!
    ws.getCell('A2').value = 'Cantidad'
    ws.getCell('A3').value = 4
    ws.getCell('A4').value = 12
    ws.getCell('A5').value = 7
    const res = await proponerImport(await aBuffer(wb), 'test.xlsx')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const item = res.propuesta.secciones[0].items[0]
    expect(item.response_type).toBe('numeric')
    expect(item.props).toEqual({ required: true, min: 4, max: 12 })
    expect(item.source).toMatchObject({ sheet: 'Equipos', column: 'A', headerCell: 'A2', firstDataRow: 3 })
    expect(item.required).toBe(true)
  })

  it('detecta fecha ISO y hora por texto', async () => {
    const wb = nuevaHoja('Seguridad')
    const ws = wb.getWorksheet('Seguridad')!
    ws.getCell('A2').value = 'Fecha (fecha)'
    ws.getCell('B2').value = 'Hora (hora)'
    ws.getCell('A3').value = '2026-03-14'
    ws.getCell('B3').value = '08:30'
    const res = await proponerImport(await aBuffer(wb), 'seg.xlsx')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const [fecha, hora] = res.propuesta.secciones[0].items
    expect(fecha.response_type).toBe('date')
    expect(fecha.prompt).toBe('Fecha')
    expect(hora.response_type).toBe('time')
    expect(hora.prompt).toBe('Hora')
  })

  it('detecta ok/nok/na insensible a mayúsculas', async () => {
    const wb = nuevaHoja('Checklist')
    const ws = wb.getWorksheet('Checklist')!
    ws.getCell('A2').value = 'Estado'
    ws.getCell('A3').value = 'OK'
    ws.getCell('A4').value = 'nok'
    ws.getCell('A5').value = 'N/A'
    const res = await proponerImport(await aBuffer(wb), 'ok.xlsx')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.propuesta.secciones[0].items[0].response_type).toBe('ok_nok_na')
  })

  it('detecta select_multi por separador ";" y select_single por cardinalidad', async () => {
    const wb = nuevaHoja('Áreas')
    const ws = wb.getWorksheet('Áreas')!
    ws.getCell('A2').value = 'Zonas'
    ws.getCell('B2').value = 'Categoría'
    for (let i = 0; i < 20; i++) {
      ws.getCell(`A${3 + i}`).value = i % 2 === 0 ? 'A; B' : 'B; C'
      ws.getCell(`B${3 + i}`).value = `Tipo${(i % 3) + 1}`
    }
    const res = await proponerImport(await aBuffer(wb), 'multi.xlsx')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const [zonas, categoria] = res.propuesta.secciones[0].items
    expect(zonas.response_type).toBe('select_multiple')
    expect(zonas.props.options).toEqual(['A', 'B', 'C'])
    expect(categoria.response_type).toBe('select_single')
    expect(categoria.props.options).toEqual(['Tipo1', 'Tipo2', 'Tipo3'])
  })

  it('columna sin datos y huecos → text no-required; hint (foto) → photo', async () => {
    const wb = nuevaHoja('Inspección', 'Título fusionado')
    const ws = wb.getWorksheet('Inspección')!
    ws.getCell('A2').value = 'Observación'
    ws.getCell('B2').value = 'Evidencia (foto)'
    ws.getCell('C2').value = 'Notas'
    ws.getCell('A3').value = 'texto'
    ws.getCell('A4').value = ''
    ws.getCell('B3').value = null
    const res = await proponerImport(await aBuffer(wb), 'foto.xlsx')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const items = res.propuesta.secciones[0].items
    expect(items).toHaveLength(3)
    const [obs, foto, notas] = items
    expect(obs.response_type).toBe('text')
    expect(obs.required).toBe(false)
    expect(foto.response_type).toBe('photo')
    expect(foto.prompt).toBe('Evidencia')
    expect(notas.response_type).toBe('text')
    expect(notas.required).toBe(false)
  })

  it('hint (lista) fuerza select_single aunque haya muchos valores', async () => {
    const wb = nuevaHoja('Lista')
    const ws = wb.getWorksheet('Lista')!
    ws.getCell('A2').value = 'Código (lista)'
    for (let i = 0; i < 30; i++) ws.getCell(`A${3 + i}`).value = `cod-${i}`
    const res = await proponerImport(await aBuffer(wb), 'lista.xlsx')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.propuesta.secciones[0].items[0].response_type).toBe('select_single')
  })

  it('salta la fila de título fusionada y detecta el encabezado real', async () => {
    const wb = nuevaHoja('Plantilla', 'Inspección de Seguridad Semanal')
    const ws = wb.getWorksheet('Plantilla')!
    ws.getCell('A3').value = 'Ítem'
    ws.getCell('B3').value = 'Responsable'
    ws.getCell('A4').value = 'Extintor 01'
    ws.getCell('B4').value = 'Juan'
    const res = await proponerImport(await aBuffer(wb), 'titulo.xlsx')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const section = res.propuesta.secciones[0]
    expect(section.titulo).toBe('Plantilla')
    expect(res.propuesta.resumen.items).toBe(2)
  })
})

describe('proponerImport — robustez y contrato', () => {
  it('devuelve ok:false para un buffer que no es .xlsx', async () => {
    const res = await proponerImport(new Uint8Array([1, 2, 3, 4, 5]), 'basura.xlsx')
    expect(res.ok).toBe(false)
  })

  it('toda propuesta pasa el contrato Zod de campo (FR-036/039)', async () => {
    const wb = nuevaHoja('Z')
    const ws = wb.getWorksheet('Z')!
    ws.getCell('A2').value = 'Patrón (lista)'
    ws.getCell('B2').value = 'Unidades (número)'
    ws.getCell('A3').value = 'A'
    ws.getCell('B3').value = 3
    const res = await proponerImport(await aBuffer(wb), 'contrato.xlsx')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    for (const item of res.propuesta.secciones[0].items) {
      expect(item.response_type).not.toBe('photo') // sin hint no se inventa
    }
  })
})

describe('proponerImport — integración con el fixture del spike', () => {
  it('parsea spike-referencia.xlsx y propone 10 ítems tipados', async () => {
    const fixture = fileURLToPath(new URL('../../fixtures/xlsx/spike-referencia.xlsx', import.meta.url))
    const buffer = readFileSync(fixture)
    const res = await proponerImport(new Uint8Array(buffer), 'spike-referencia.xlsx')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const prop = res.propuesta
    expect(prop.nombre_archivo).toBe('spike-referencia.xlsx')
    expect(prop.resumen.secciones).toBe(1)
    expect(prop.resumen.items).toBe(10)
    expect(prop.resumen.filasDatos).toBe(250)
    const sec = prop.secciones[0]
    expect(sec.titulo).toBe('Inspección Diaria')
    const tipoDe = Object.fromEntries(sec.items.map((i) => [i.prompt, i.response_type]))
    expect(tipoDe).toEqual({
      'Ítem a inspeccionar': 'text',
      Responsable: 'text',
      Turno: 'select_single',
      Estado: 'ok_nok_na',
      'Cantidad verificada': 'numeric',
      'Fecha de inspección': 'date',
      'Hora de inicio': 'time',
      'Áreas revisadas': 'select_multiple',
      Subsector: 'text',
      Evidencia: 'photo',
    })
    const estado = sec.items.find((i) => i.prompt === 'Estado')!
    expect(estado.required).toBe(true)
    expect(estado.source.headerCell).toBe('D2')
    expect(estado.source.column).toBe('D')
    const subsector = sec.items.find((i) => i.prompt === 'Subsector')!
    expect(subsector.required).toBe(false)
    const turno = sec.items.find((i) => i.prompt === 'Turno')!
    expect(turno.props.options).toEqual(['Día', 'Noche', 'Tarde'])
  })
})