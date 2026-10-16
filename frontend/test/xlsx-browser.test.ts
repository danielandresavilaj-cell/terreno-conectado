import { describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { proponerImport } from '@terreno/shared/xlsx'

async function crearLibro(): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet('Inspección')
  hoja.getCell('A1').value = 'Observación'
  hoja.getCell('A2').value = 'Correcta'
  return new Uint8Array(await libro.xlsx.writeBuffer())
}

describe('importación XLSX en navegador', () => {
  it('lee el libro sin requerir un global Buffer', async () => {
    const bytes = await crearLibro()
    const bufferOriginal = globalThis.Buffer
    vi.stubGlobal('Buffer', undefined)
    try {
      const resultado = await proponerImport(bytes, 'navegador.xlsx')
      expect(resultado.ok).toBe(true)
    } finally {
      vi.stubGlobal('Buffer', bufferOriginal)
    }
  })
})
