/**
 * Informe Word (`.docx`) de inspecciones — TSK-REP-007 (ADR-003 Enmienda 4: docx).
 *
 * Misma estructura que el PDF: portada con filtro y resumen, una inspección
 * por página (respuestas por sección con No OK en rojo, hallazgos y fotos
 * incrustadas ≤ 512 kB) y pie con número de página. Es editable: quien lo
 * recibe puede agregar observaciones antes de firmarlo.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { InspeccionExportable, MetaExportacion } from '@terreno/shared/exportar'
import { ESTADO_HALLAZGO_LABEL, ESTADO_LABEL, SEVERIDAD_LABEL, fechaLegible, nokDe } from '@terreno/shared/exportar'

const ROJO = 'B91C1C'
const GRIS = '6B7280'
const FONDO_NOK = 'FDE2E2'
const FONDO_CAB = 'E5E7EB'
const BORDE = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' }
const BORDES = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE }

function celda(texto: string, opts: { negrita?: boolean; color?: string; fondo?: string; ancho?: number } = {}): TableCell {
  return new TableCell({
    borders: BORDES,
    width: opts.ancho ? { size: opts.ancho, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.fondo ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fondo } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: texto, bold: opts.negrita, color: opts.color, size: 19 })] })],
  })
}

function tabla(cab: string[], filas: (string | { texto: string; negrita?: boolean; color?: string; fondo?: string })[][], anchos: number[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: cab.map((c, k) => celda(c, { negrita: true, fondo: FONDO_CAB, ancho: anchos[k] })) }),
      ...filas.map(
        (f) => new TableRow({ children: f.map((v, k) => (typeof v === 'string' ? celda(v, { ancho: anchos[k] }) : celda(v.texto, { ...v, ancho: anchos[k] }))) }),
      ),
    ],
  })
}

const gris = (text: string) => new Paragraph({ children: [new TextRun({ text, color: GRIS, size: 20 })] })

export async function informeWord(inspecciones: InspeccionExportable[], meta: MetaExportacion): Promise<Buffer> {
  const ordenadas = [...inspecciones].sort((a, b) => a.capturada_at.localeCompare(b.capturada_at))
  const hijos: (Paragraph | Table)[] = [
    new Paragraph({ text: 'Informe de inspecciones', heading: HeadingLevel.TITLE }),
    gris(meta.empresa),
    gris(meta.filtro),
    gris(`${inspecciones.length} inspecciones · generado ${fechaLegible(meta.generado_at)}`),
    new Paragraph(''),
    tabla(
      ['Fecha', 'Faena', 'Formulario', 'Autor', 'Estado', 'No OK'],
      ordenadas.map((i) => {
        const nok = nokDe(i)
        return [
          fechaLegible(i.capturada_at),
          i.faena,
          `${i.formulario.nombre} v${i.formulario.version}`,
          i.autor,
          ESTADO_LABEL[i.estado],
          nok > 0 ? { texto: String(nok), negrita: true, color: ROJO } : '0',
        ]
      }),
      [16, 16, 28, 18, 12, 10],
    ),
  ]

  for (const i of ordenadas) {
    hijos.push(
      new Paragraph({ text: i.formulario.nombre, heading: HeadingLevel.HEADING_1, pageBreakBefore: true }),
      gris(`Faena: ${i.faena}  ·  Autor: ${i.autor}  ·  Versión ${i.formulario.version}`),
      gris(`Capturada: ${fechaLegible(i.capturada_at)}  ·  Estado: ${ESTADO_LABEL[i.estado]}${i.revisada_at ? `  ·  Revisada: ${fechaLegible(i.revisada_at)}` : ''}`),
    )
    for (const s of i.secciones) {
      hijos.push(
        new Paragraph({ text: s.titulo, heading: HeadingLevel.HEADING_2 }),
        tabla(
          ['Pregunta', 'Respuesta'],
          s.respuestas.map((r) => [
            r.nok ? { texto: r.prompt, fondo: FONDO_NOK } : r.prompt,
            r.nok ? { texto: String(r.valor ?? '—'), negrita: true, color: ROJO, fondo: FONDO_NOK } : String(r.valor ?? '—'),
          ]),
          [62, 38],
        ),
      )
    }
    if (i.hallazgos.length > 0) {
      hijos.push(
        new Paragraph({ text: 'Hallazgos', heading: HeadingLevel.HEADING_2 }),
        tabla(
          ['Severidad', 'Estado', 'Descripción'],
          i.hallazgos.map((h) => [
            h.severidad === 'critical' || h.severidad === 'high' ? { texto: SEVERIDAD_LABEL[h.severidad], negrita: true, color: ROJO } : SEVERIDAD_LABEL[h.severidad],
            ESTADO_HALLAZGO_LABEL[h.estado],
            h.descripcion,
          ]),
          [16, 16, 68],
        ),
      )
    }
    if (i.evidencias.length > 0) {
      hijos.push(new Paragraph({ text: 'Evidencias', heading: HeadingLevel.HEADING_2 }))
      for (const e of i.evidencias) {
        if (e.bytes && e.bytes.length > 0) {
          hijos.push(
            new Paragraph({
              children: [
                new ImageRun({ type: e.mime.includes('png') ? 'png' : 'jpg', data: Buffer.from(e.bytes), transformation: { width: 240, height: 180 } }),
              ],
            }),
            gris(e.item_prompt),
          )
        } else {
          hijos.push(gris(`${e.item_prompt}: foto de ${Math.round(e.bytesLength / 1024)} kB, no incrustada${e.fileKey ? ` (${e.fileKey})` : ''}`))
        }
      }
    }
  }

  const doc = new Document({
    creator: 'Terreno Conectado',
    title: `Inspecciones — ${meta.empresa}`,
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [
      {
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: `${meta.empresa} · Página `, color: GRIS, size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], color: GRIS, size: 16 }),
                  new TextRun({ text: ' de ', color: GRIS, size: 16 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], color: GRIS, size: 16 }),
                ],
              }),
            ],
          }),
        },
        children: hijos,
      },
    ],
  })
  return Packer.toBuffer(doc)
}
