/**
 * Lector de Word — TSK-FORM-020. Los `.docx` se arman en el test (ZIP con un
 * `word/document.xml` mínimo) para no versionar binarios.
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { templateImportProposalSchema } from '../templates'
import { propuestaADefinicion } from '../xlsx/to-definition'
import { bloquesDeDocumentXml, proponerImportDocx } from './docx'
import { proponerDesdeDocumento, tipoPorEtiqueta } from './documento'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const p = (t: string, opts: { estilo?: string; negrita?: boolean; lista?: boolean } = {}) =>
  `<w:p><w:pPr>${opts.estilo ? `<w:pStyle w:val="${opts.estilo}"/>` : ''}${opts.lista ? '<w:numPr><w:ilvl w:val="0"/></w:numPr>' : ''}</w:pPr><w:r>${opts.negrita ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${t}</w:t></w:r></w:p>`
const tabla = (filas: string[][]) =>
  `<w:tbl>${filas.map((f) => `<w:tr>${f.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
const doc = (cuerpo: string) => `<?xml version="1.0"?><w:document ${W}><w:body>${cuerpo}</w:body></w:document>`

async function docx(cuerpo: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('word/document.xml', doc(cuerpo))
  return zip.generateAsync({ type: 'uint8array' })
}

const PAUTA = [
  p('Inspección de camioneta', { estilo: 'Title' }),
  p('Fecha: ________   Hora: ________'),
  p('N° interno: ________'),
  p('Estado general', { estilo: 'Heading1' }),
  tabla([
    ['N°', 'Ítem a verificar', 'Sí', 'No', 'N/A', 'Observaciones'],
    ['1', 'Frenos operativos', '', '', '', ''],
    ['2', 'Luces delanteras y traseras', '', '', '', ''],
    ['Neumáticos'],
    ['3', 'Presión correcta', '', '', '', ''],
  ]),
  p('Equipamiento', { negrita: true }),
  p('☐ Extintor vigente'),
  p('¿Botiquín completo? ☐ Sí ☐ No ☐ N/A'),
  p('Firma del inspector: ______________'),
].join('')

describe('lector .docx', () => {
  it('lee títulos, pauta Sí/No/N.A. en tabla, casillas y etiquetas', async () => {
    const r = await proponerImportDocx(await docx(PAUTA), 'pauta.docx')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { propuesta } = r
    expect(propuesta.formato).toBe('docx')
    expect(templateImportProposalSchema.safeParse(propuesta).success).toBe(true)

    const porTitulo = Object.fromEntries(propuesta.secciones.map((s) => [s.titulo, s.items.map((i) => [i.prompt, i.response_type])]))
    expect(porTitulo['Inspección de camioneta']).toEqual([
      ['Fecha', 'date'],
      ['Hora', 'time'],
      ['N° interno', 'numeric'],
    ])
    expect(porTitulo['Estado general']).toEqual([
      ['Frenos operativos', 'ok_nok_na'],
      ['Luces delanteras y traseras', 'ok_nok_na'],
    ])
    // La fila combinada abre una sección y la columna de observaciones queda como un campo.
    expect(porTitulo['Neumáticos']).toEqual([
      ['Presión correcta', 'ok_nok_na'],
      ['Observaciones — Neumáticos', 'text'],
    ])
    expect(porTitulo['Equipamiento']).toEqual([
      ['Extintor vigente', 'ok_nok_na'],
      ['¿Botiquín completo?', 'ok_nok_na'],
    ])
    // La firma no es un campo, pero se avisa.
    expect(propuesta.advertencias?.some((a) => a.includes('Firma'))).toBe(true)
    expect(propuesta.secciones.flatMap((s) => s.items).every((i) => i.source === undefined)).toBe(true)
    expect(propuestaADefinicion(propuesta).ok).toBe(true)
  })

  it('una ficha "Etiqueta | ___" y una cuadrícula con columnas', () => {
    const bloques = bloquesDeDocumentXml(
      doc(
        tabla([
          ['Faena', '', 'Turno', ''],
          ['Fecha', '', 'Temperatura', ''],
        ]) +
          p('Registro de equipos', { estilo: 'Heading2' }) +
          tabla([
            ['Equipo', 'Horómetro', 'Estado'],
            ['CAEX 01', '1200', 'Operativo'],
            ['CAEX 02', '1350', 'Detenido'],
          ]),
      ),
    )
    const r = proponerDesdeDocumento(bloques, 'ficha.docx', 'docx')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const items = r.propuesta.secciones.flatMap((s) => s.items.map((i) => [i.prompt, i.response_type]))
    expect(items).toEqual([
      ['Faena', 'text'],
      ['Turno', 'text'],
      ['Fecha', 'date'],
      ['Temperatura', 'numeric'],
      ['Equipo', 'text'],
      ['Horómetro', 'numeric'],
      ['Estado', 'select_single'],
    ])
  })

  it('opciones B/R/M dan lista; Cumple/No cumple da OK/No OK', () => {
    const r = proponerDesdeDocumento(
      [
        { tipo: 'tabla', filas: [['Aspecto', 'B', 'R', 'M'], ['Orden y aseo', '', '', '']] },
        { tipo: 'tabla', filas: [['Requisito', 'Cumple', 'No cumple'], ['Señalética visible', '', '']] },
      ],
      'x.docx',
      'docx',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [a, b] = r.propuesta.secciones[0].items
    expect([a.response_type, a.props.options]).toEqual(['select_single', ['B', 'R', 'M']])
    expect(b.response_type).toBe('ok_nok_na')
  })

  it('casillas de control de contenido y campos de formulario heredados', () => {
    const xml = doc(
      `<w:p><w:r><w:t>Arnés revisado</w:t></w:r><w:sdt><w:sdtPr><w14:checkbox xmlns:w14="x"/></w:sdtPr></w:sdt></w:p>` +
        `<w:p><w:r><w:t>Patente:</w:t></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r></w:p>`,
    )
    const r = proponerDesdeDocumento(bloquesDeDocumentXml(xml), 'x.docx', 'docx')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.propuesta.secciones[0].items.map((i) => [i.prompt, i.response_type])).toEqual([
      ['Arnés revisado', 'ok_nok_na'],
      ['Patente', 'text'],
    ])
  })

  it('errores claros: no es docx, o no tiene preguntas', async () => {
    const malo = await proponerImportDocx(new Uint8Array([1, 2, 3]), 'x.docx')
    expect(malo.ok).toBe(false)
    const vacio = await proponerImportDocx(await docx(p('Sólo un párrafo de instrucciones generales.')), 'x.docx')
    expect(vacio.ok).toBe(false)
    if (!vacio.ok) expect(vacio.error).toMatch(/No se encontraron preguntas/)
  })

  it('tipo por etiqueta', () => {
    expect(tipoPorEtiqueta('Fecha de inspección')).toBe('date')
    expect(tipoPorEtiqueta('Hora de inicio')).toBe('time')
    expect(tipoPorEtiqueta('Kilometraje')).toBe('numeric')
    expect(tipoPorEtiqueta('Firma supervisor')).toBe('omitir')
    expect(tipoPorEtiqueta('Foto del daño')).toBe('photo')
    expect(tipoPorEtiqueta('Nombre del operador')).toBe('text')
  })
})
