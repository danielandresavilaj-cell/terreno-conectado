/**
 * Informe PDF de inspecciones — TSK-REP-007 (ADR-003 Enmienda 4: pdfkit).
 *
 * Portada con el filtro y una tabla resumen; luego cada inspección en su
 * página: encabezado, respuestas por sección (No OK en rojo), hallazgos y
 * fotos incrustadas cuando pesan ≤ 512 kB. Pie con número de página.
 */
import PDFDocument from 'pdfkit'
import type { InspeccionExportable, MetaExportacion } from '@terreno/shared/exportar'
import { ESTADO_HALLAZGO_LABEL, ESTADO_LABEL, SEVERIDAD_LABEL, fechaLegible, nokDe } from '@terreno/shared/exportar'

const MARGEN = 48
const ROJO = '#B91C1C'
const GRIS = '#6B7280'
const OSCURO = '#111827'
const BANDA = '#F3F4F6'
const EXTRA_WINANSI = new Set(['€', '‘', '’', '“', '”', '–', '—', '…', '•'])

/** pdfkit con fuentes estándar habla WinAnsi: se reemplaza lo que no cabe. */
function t(v: unknown): string {
  const base = String(v ?? '—').replace(/[☐□❑▢◻⬜]/g, '[ ]').replace(/[☑☒✓✔]/g, '[x]')
  return Array.from(base, (c) => (c.charCodeAt(0) <= 0xff || EXTRA_WINANSI.has(c) ? c : '?')).join('')
}

function aBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = []
    doc.on('data', (b: Buffer) => partes.push(b))
    doc.on('end', () => resolve(Buffer.concat(partes)))
    doc.on('error', reject)
  })
}

export async function informePdf(inspecciones: InspeccionExportable[], meta: MetaExportacion): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true, info: { Title: `Inspecciones — ${meta.empresa}`, Author: 'Terreno Conectado' } })
  const listo = aBuffer(doc)
  const ancho = doc.page.width - MARGEN * 2
  const limite = () => doc.page.height - MARGEN - 30
  const espacio = (alto: number) => {
    if (doc.y + alto > limite()) doc.addPage()
  }

  // Portada.
  doc.fillColor(OSCURO).font('Helvetica-Bold').fontSize(20).text(t(`Informe de inspecciones`))
  doc.moveDown(0.2).font('Helvetica').fontSize(12).fillColor(GRIS).text(t(meta.empresa))
  doc.text(t(meta.filtro))
  doc.text(t(`${inspecciones.length} inspecciones · generado ${fechaLegible(meta.generado_at)}`))
  doc.moveDown(1)

  const colsR = [{ t: 'Fecha', w: 82 }, { t: 'Faena', w: 90 }, { t: 'Formulario', w: 150 }, { t: 'Autor', w: 95 }, { t: 'Estado', w: 52 }, { t: 'No OK', w: 30 }]
  const filaTabla = (valores: string[], negrita: boolean, fondo?: string, color = OSCURO) => {
    const alto = Math.max(...valores.map((v, k) => doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).heightOfString(t(v), { width: colsR[k].w - 6 }))) + 6
    espacio(alto)
    const y = doc.y
    if (fondo) doc.rect(MARGEN, y, ancho, alto).fill(fondo)
    let x = MARGEN
    valores.forEach((v, k) => {
      doc.fillColor(k === 5 && v !== '0' && !negrita ? ROJO : color).font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).text(t(v), x + 3, y + 3, { width: colsR[k].w - 6 })
      x += colsR[k].w
    })
    doc.x = MARGEN
    doc.y = y + alto
  }
  filaTabla(colsR.map((c) => c.t), true, BANDA)
  const ordenadas = [...inspecciones].sort((a, b) => a.capturada_at.localeCompare(b.capturada_at))
  for (const i of ordenadas) {
    filaTabla([fechaLegible(i.capturada_at), i.faena, `${i.formulario.nombre} v${i.formulario.version}`, i.autor, ESTADO_LABEL[i.estado], String(nokDe(i))], false)
  }

  // Una inspección por página.
  for (const i of ordenadas) {
    doc.addPage()
    doc.fillColor(OSCURO).font('Helvetica-Bold').fontSize(15).text(t(i.formulario.nombre))
    doc.font('Helvetica').fontSize(9.5).fillColor(GRIS)
      .text(t(`Faena: ${i.faena}   ·   Autor: ${i.autor}   ·   Versión ${i.formulario.version}`))
      .text(t(`Capturada: ${fechaLegible(i.capturada_at)}   ·   Estado: ${ESTADO_LABEL[i.estado]}${i.revisada_at ? `   ·   Revisada: ${fechaLegible(i.revisada_at)}` : ''}`))
    doc.moveDown(0.8)

    for (const s of i.secciones) {
      espacio(40)
      const y = doc.y
      doc.rect(MARGEN, y, ancho, 18).fill('#374151')
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10).text(t(s.titulo), MARGEN + 6, y + 4, { width: ancho - 12 })
      doc.x = MARGEN
      doc.y = y + 22
      for (const r of s.respuestas) {
        const wP = ancho * 0.62
        const wV = ancho - wP
        const alto = Math.max(doc.font('Helvetica').fontSize(9.5).heightOfString(t(r.prompt), { width: wP - 8 }), doc.heightOfString(t(r.valor), { width: wV - 8 })) + 6
        espacio(alto)
        const yy = doc.y
        if (r.nok) doc.rect(MARGEN, yy, ancho, alto).fill('#FDE2E2')
        doc.fillColor(OSCURO).font('Helvetica').fontSize(9.5).text(t(r.prompt), MARGEN + 4, yy + 3, { width: wP - 8 })
        doc.fillColor(r.nok ? ROJO : OSCURO).font(r.nok ? 'Helvetica-Bold' : 'Helvetica').text(t(r.valor), MARGEN + wP + 4, yy + 3, { width: wV - 8 })
        doc.moveTo(MARGEN, yy + alto).lineTo(MARGEN + ancho, yy + alto).strokeColor('#E5E7EB').lineWidth(0.5).stroke()
        doc.x = MARGEN
        doc.y = yy + alto
      }
      doc.moveDown(0.6)
    }

    if (i.hallazgos.length > 0) {
      espacio(40)
      doc.fillColor(OSCURO).font('Helvetica-Bold').fontSize(11).text(t('Hallazgos'))
      doc.moveDown(0.2)
      for (const h of i.hallazgos) {
        espacio(30)
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(h.severidad === 'critical' || h.severidad === 'high' ? ROJO : OSCURO)
          .text(t(`${SEVERIDAD_LABEL[h.severidad]} · ${ESTADO_HALLAZGO_LABEL[h.estado]}`), { continued: true })
          .font('Helvetica').fillColor(OSCURO).text(t(`  ${h.descripcion}`))
      }
      doc.moveDown(0.6)
    }

    const fotos = i.evidencias.filter((e) => e.bytes && e.bytes.length > 0)
    const referenciadas = i.evidencias.filter((e) => !e.bytes || e.bytes.length === 0)
    if (i.evidencias.length > 0) {
      espacio(40)
      doc.fillColor(OSCURO).font('Helvetica-Bold').fontSize(11).text(t('Evidencias'))
      doc.moveDown(0.3)
      for (const e of fotos) {
        espacio(150)
        const y = doc.y
        try {
          doc.image(Buffer.from(e.bytes as Uint8Array), MARGEN, y, { fit: [180, 135] })
        } catch {
          doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(t('(imagen no legible)'), MARGEN, y)
        }
        doc.font('Helvetica').fontSize(9).fillColor(OSCURO).text(t(e.item_prompt), MARGEN + 192, y, { width: ancho - 192 })
        doc.x = MARGEN
        doc.y = y + 142
      }
      for (const e of referenciadas) {
        doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(t(`${e.item_prompt}: foto de ${Math.round(e.bytesLength / 1024)} kB, no incrustada${e.fileKey ? ` (${e.fileKey})` : ''}`))
      }
    }
  }

  // Pie con número de página.
  const rango = doc.bufferedPageRange()
  for (let p = 0; p < rango.count; p++) {
    doc.switchToPage(rango.start + p)
    const y = doc.page.height - MARGEN + 10
    doc.font('Helvetica').fontSize(8).fillColor(GRIS)
      .text(t(`${meta.empresa} · Terreno Conectado`), MARGEN, y, { width: ancho / 2, lineBreak: false })
      .text(t(`Página ${p + 1} de ${rango.count}`), MARGEN + ancho / 2, y, { width: ancho / 2, align: 'right', lineBreak: false })
  }
  doc.end()
  return listo
}
