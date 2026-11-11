/**
 * Excel consolidado — TSK-REP-007. Se genera y se vuelve a leer con ExcelJS.
 */
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { columnasDe, construirConsolidado, nombreHoja } from './consolidado'
import type { InspeccionExportable } from './tipos'

const FORM_A = '11111111-1111-4111-8111-111111111111'
const FORM_B = '22222222-2222-4222-8222-222222222222'
// PNG 1×1.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

function ins(over: Partial<InspeccionExportable> & Pick<InspeccionExportable, 'id' | 'formulario' | 'secciones'>): InspeccionExportable {
  return {
    faena: 'Faena Norte',
    autor: 'Ana Pérez',
    estado: 'submitted',
    capturada_at: '2026-11-05T12:00:00.000Z',
    revisada_at: null,
    hallazgos: [],
    evidencias: [],
    ...over,
  }
}

const v1 = ins({
  id: 'a1',
  formulario: { template_id: FORM_A, nombre: 'Camioneta', version: 1 },
  capturada_at: '2026-11-03T12:00:00.000Z',
  secciones: [
    {
      titulo: 'Motor',
      respuestas: [
        { item_id: 'frenos', prompt: 'Frenos', tipo: 'ok_nok_na', valor: 'No OK', nok: true },
        { item_id: 'km', prompt: 'Kilometraje', tipo: 'numeric', valor: 1200, nok: false },
      ],
    },
  ],
  hallazgos: [{ severidad: 'high', estado: 'resolved', descripcion: 'Pastillas gastadas', capturado_at: '2026-11-03T12:00:00.000Z', resuelto_at: '2026-11-04T12:00:00.000Z' }],
  evidencias: [{ item_prompt: 'Foto frenos', nombre: '1. Foto', mime: 'image/png', bytesLength: PNG.length, bytes: PNG, fileKey: 'k' }],
})
// v2 agrega "Luces" y renombra la sección: las columnas se juntan por id.
const v2 = ins({
  id: 'a2',
  formulario: { template_id: FORM_A, nombre: 'Camioneta', version: 2 },
  secciones: [
    {
      titulo: 'Motor y luces',
      respuestas: [
        { item_id: 'frenos', prompt: 'Frenos', tipo: 'ok_nok_na', valor: 'OK', nok: false },
        { item_id: 'luces', prompt: 'Luces', tipo: 'ok_nok_na', valor: 'OK', nok: false },
        { item_id: 'km', prompt: 'Kilometraje', tipo: 'numeric', valor: 1350, nok: false },
      ],
    },
  ],
})
const manual = ins({
  id: 'b1',
  formulario: { template_id: FORM_B, nombre: 'Charla: 5 minutos / seguridad', version: 1 },
  secciones: [{ titulo: 'General', respuestas: [{ item_id: 'tema', prompt: 'Tema', tipo: 'text', valor: 'Altura', nok: false }] }],
})

describe('Excel consolidado', () => {
  it('Resumen + una hoja por formulario + Hallazgos + Evidencias en un solo libro', async () => {
    const bytes = await construirConsolidado([v2, manual, v1], { empresa: 'Minera', filtro: 'Noviembre', generado_at: '2026-11-11T12:00:00.000Z' })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(bytes.buffer as ArrayBuffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumen', 'Camioneta', 'Charla 5 minutos seguridad', 'Hallazgos', 'Evidencias'])

    const resumen = wb.getWorksheet('Resumen')!
    // 3 inspecciones ordenadas por fecha, con No OK y hallazgos contados.
    expect([5, 6, 7].map((f) => resumen.getRow(f).getCell(3).value)).toEqual(['Camioneta', 'Camioneta', 'Charla: 5 minutos / seguridad'])
    expect(resumen.getRow(5).getCell(7).value).toBe(1)
    expect(resumen.getRow(5).getCell(8).value).toBe(1)
    expect(String((resumen.getRow(5).getCell(9).value as { hyperlink: string }).hyperlink)).toContain("'Camioneta'!A3")

    const cam = wb.getWorksheet('Camioneta')!
    // Columnas: 5 fijas + Frenos, Luces, Kilometraje (orden de la v2), por id.
    expect([6, 7, 8].map((c) => cam.getRow(2).getCell(c).value)).toEqual(['Frenos', 'Luces', 'Kilometraje'])
    expect([6, 7, 8].map((c) => cam.getRow(3).getCell(c).value)).toEqual(['No OK', null, 1200])
    expect([6, 7, 8].map((c) => cam.getRow(4).getCell(c).value)).toEqual(['OK', 'OK', 1350])
    expect((cam.getRow(3).getCell(6).font?.bold)).toBe(true)

    expect(wb.getWorksheet('Hallazgos')!.getRow(2).getCell(8).value).toBe(24)
    expect(wb.getWorksheet('Evidencias')!.getImages()).toHaveLength(1)
  })

  it('nombres de hoja válidos y únicos; columnas unidas entre versiones', () => {
    const u = new Set<string>()
    expect(nombreHoja('Resumen', u)).toBe('Resumen')
    expect(nombreHoja('resumen', u)).toBe('resumen (2)')
    expect(nombreHoja('x'.repeat(40), u)).toHaveLength(31)
    expect(columnasDe([v1, v2]).map((c) => c.item_id)).toEqual(['frenos', 'luces', 'km'])
  })
})
