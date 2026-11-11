/**
 * Lector de PDF — TSK-FORM-020. Los PDF se generan en el test con pdfkit:
 * uno de texto con una pauta en tabla, uno rellenable (AcroForm) y uno sin
 * texto (como un escaneado).
 */
import PDFDocument from 'pdfkit'
import { describe, expect, it } from 'vitest'
import { templateImportProposalSchema } from '@terreno/shared'
import { proponerImportPdf } from '../src/templates/importar-pdf'

function pdf(dibujar: (d: PDFKit.PDFDocument) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const d = new PDFDocument({ size: 'A4', margin: 50 })
    const partes: Buffer[] = []
    d.on('data', (b: Buffer) => partes.push(b))
    d.on('end', () => resolve(new Uint8Array(Buffer.concat(partes))))
    d.on('error', reject)
    dibujar(d)
    d.end()
  })
}

const items = (r: Awaited<ReturnType<typeof proponerImportPdf>>) =>
  r.ok ? r.propuesta.secciones.map((s) => [s.titulo, s.items.map((i) => [i.prompt, i.response_type])]) : r.error

describe('lector .pdf', () => {
  it('PDF de texto: título, ficha "Etiqueta: ____" y pauta Sí/No/N.A. en tabla', async () => {
    const bytes = await pdf((d) => {
      d.fontSize(20).text('Inspección de grúa horquilla', 50, 50)
      d.fontSize(10).text('Fecha: ________', 50, 90).text('Hora: ________', 300, 90)
      d.fontSize(14).text('Verificaciones', 50, 130)
      const filas = [
        ['Ítem', 'Sí', 'No', 'N/A'],
        ['Bocina operativa', '', '', ''],
        ['Horquillas sin fisuras', '', '', ''],
        ['Cinturón de seguridad', '', '', ''],
      ]
      filas.forEach((f, i) => {
        const y = 160 + i * 20
        d.fontSize(10).text(f[0], 50, y)
        ;[300, 360, 420].forEach((x, k) => f[k + 1] && d.text(f[k + 1], x, y))
        if (i > 0) [300, 360, 420].forEach((x) => d.text('☐'.replace('☐', '[ ]'), x, y))
      })
    })
    const r = await proponerImportPdf(bytes, 'grua.pdf')
    expect(r.ok, String(items(r))).toBe(true)
    if (!r.ok) return
    expect(r.propuesta.formato).toBe('pdf')
    expect(templateImportProposalSchema.safeParse(r.propuesta).success).toBe(true)
    expect(items(r)).toEqual([
      ['Inspección de grúa horquilla', [['Fecha', 'date'], ['Hora', 'time']]],
      [
        'Verificaciones',
        [
          ['Bocina operativa', 'ok_nok_na'],
          ['Horquillas sin fisuras', 'ok_nok_na'],
          ['Cinturón de seguridad', 'ok_nok_na'],
        ],
      ],
    ])
  })

  it('PDF rellenable: casilla, lista, texto y fecha con su etiqueta impresa', async () => {
    const bytes = await pdf((d) => {
      d.initForm()
      d.fontSize(10)
      d.text('Patente', 50, 100)
      d.formText('patente', 150, 96, 150, 16)
      d.text('Fecha de revisión', 50, 130)
      d.formText('fecha', 150, 126, 150, 16)
      d.text('Turno', 50, 160)
      d.formCombo('turno', 150, 156, 150, 16, { select: ['Día', 'Noche'] })
      d.text('Luces operativas', 50, 190)
      d.formCheckbox('luces', 150, 186, 12, 12)
    })
    const r = await proponerImportPdf(bytes, 'form.pdf')
    expect(r.ok, String(items(r))).toBe(true)
    if (!r.ok) return
    const its = r.propuesta.secciones.flatMap((s) => s.items)
    expect(its.map((i) => [i.prompt, i.response_type])).toEqual([
      ['Patente', 'text'],
      ['Fecha de revisión', 'date'],
      ['Turno', 'select_single'],
      ['Luces operativas', 'ok_nok_na'],
    ])
    expect(its[2].props.options).toEqual(['Día', 'Noche'])
  })

  it('PDF sin texto (escaneado): error claro, nunca una plantilla vacía', async () => {
    const bytes = await pdf((d) => {
      d.rect(50, 50, 400, 300).fill('#cccccc')
    })
    const r = await proponerImportPdf(bytes, 'scan.pdf')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/escaneada/)
  })

  it('bytes que no son PDF', async () => {
    const r = await proponerImportPdf(new Uint8Array([37, 80, 68, 70, 1, 2]), 'x.pdf')
    expect(r.ok).toBe(false)
  })
})
