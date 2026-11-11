/**
 * Lector de Word (`.docx`) — TSK-FORM-020.
 *
 * Un `.docx` es un ZIP; el contenido está en `word/document.xml`. Se recorre
 * con un parser SAX (`saxes`, que ya viene con exceljs; sin dependencias
 * nuevas) y se reduce a bloques (`documento.ts`): títulos, párrafos y tablas.
 * Encabezados y pies de página viven en otras partes del ZIP y no se leen.
 *
 * Casillas: los caracteres ☐/☒, los símbolos Wingdings de casilla, los
 * controles de contenido `w14:checkbox` y los campos heredados `FORMCHECKBOX`
 * se normalizan a "☐"; los `FORMTEXT` a "____", para que el núcleo los reconozca.
 */
import JSZip from 'jszip'
import { SaxesParser } from 'saxes'
import type { Bloque } from './documento'
import { proponerDesdeDocumento } from './documento'
import type { ParseResult } from '../xlsx/types'

/** Wingdings/Symbol: códigos de casilla vacía o marcada. */
const SIMBOLOS_CASILLA = new Set(['F06F', 'F0A8', 'F071', 'F072', 'F0FE', 'F0FD', 'F078', 'F0A3', '006F', '00A8'])

interface Parrafo {
  texto: string
  estilo: string
  lista: boolean
  runs: number
  runsNegrita: number
}

interface Tabla {
  filas: string[][]
  fila: string[] | null
  celda: string[] | null
}

/** Recorre `document.xml` y devuelve los bloques en orden de lectura. */
export function bloquesDeDocumentXml(xml: string): Bloque[] {
  const bloques: Bloque[] = []
  const tablas: Tabla[] = []
  let p: Parrafo | null = null
  let enTexto = false
  let runNegrita = false
  let enRun = false
  let enRPr = false
  let instr = ''
  let enInstr = false

  const parser = new SaxesParser({ xmlns: false })

  const cerrarParrafo = () => {
    if (!p) return
    const texto = p.texto.replace(/\s+/g, ' ').trim()
    const tabla = tablas[tablas.length - 1]
    if (tabla?.celda) {
      if (texto) tabla.celda.push(texto)
    } else if (texto) {
      const estilo = p.estilo.toLowerCase()
      const esTitulo =
        /^(heading|t[ií]tulo|ttulo|title|subtitle|subt[ií]tulo)/.test(estilo) ||
        (p.runs > 0 && p.runsNegrita === p.runs && texto.length <= 80 && !/[:_]$/.test(texto) && !/[☐□]/.test(texto)) ||
        (texto.length <= 60 && /^[^a-záéíóúñ]*[A-ZÁÉÍÓÚÑ]{3}[^a-záéíóúñ]*$/.test(texto) && !/[:_☐□]/.test(texto))
      bloques.push(esTitulo && !p.lista ? { tipo: 'titulo', texto } : { tipo: 'parrafo', texto, lista: p.lista })
    }
    p = null
  }

  parser.on('opentag', (tag) => {
    const a = tag.attributes as Record<string, string>
    switch (tag.name) {
      case 'w:tbl':
        cerrarParrafo()
        tablas.push({ filas: [], fila: null, celda: null })
        break
      case 'w:tr': {
        const t = tablas[tablas.length - 1]
        if (t) t.fila = []
        break
      }
      case 'w:tc': {
        const t = tablas[tablas.length - 1]
        if (t) t.celda = []
        break
      }
      case 'w:p':
        // Una tabla dentro de otra: su texto queda en la celda exterior.
        p = { texto: '', estilo: '', lista: false, runs: 0, runsNegrita: 0 }
        break
      case 'w:pStyle':
        if (p) p.estilo = a['w:val'] ?? ''
        break
      case 'w:numPr':
        if (p) p.lista = true
        break
      case 'w:r':
        enRun = true
        runNegrita = false
        break
      case 'w:rPr':
        enRPr = true
        break
      case 'w:b':
        if (enRun && enRPr && a['w:val'] !== '0' && a['w:val'] !== 'false') runNegrita = true
        break
      case 'w:t':
        enTexto = true
        break
      case 'w:tab':
        if (p && enRun) p.texto += ' '
        break
      case 'w:br':
        if (p) p.texto += ' '
        break
      case 'w:sym':
        if (p && SIMBOLOS_CASILLA.has((a['w:char'] ?? '').toUpperCase())) p.texto += ' ☐ '
        break
      case 'w14:checkbox':
        if (p) p.texto += ' ☐ '
        break
      case 'w:instrText':
        instr = ''
        enInstr = true
        break
    }
  })

  parser.on('text', (t) => {
    if (enInstr) {
      instr += t
      return
    }
    if (!enTexto) return
    if (p) {
      if (t.trim()) {
        p.runs += 1
        if (runNegrita) p.runsNegrita += 1
      }
      p.texto += t
    }
  })

  parser.on('closetag', (tag) => {
    switch (tag.name) {
      case 'w:t':
        enTexto = false
        break
      case 'w:instrText':
        enInstr = false
        if (p && /FORMCHECKBOX/.test(instr)) p.texto += ' ☐ '
        else if (p && /FORMTEXT/.test(instr)) p.texto += ' ____ '
        instr = ''
        break
      case 'w:rPr':
        enRPr = false
        break
      case 'w:r':
        enRun = false
        break
      case 'w:p':
        cerrarParrafo()
        break
      case 'w:tc': {
        const t = tablas[tablas.length - 1]
        if (t?.fila && t.celda) t.fila.push(t.celda.join(' '))
        if (t) t.celda = null
        break
      }
      case 'w:tr': {
        const t = tablas[tablas.length - 1]
        if (t?.fila) t.filas.push(t.fila)
        if (t) t.fila = null
        break
      }
      case 'w:tbl': {
        const t = tablas.pop()
        if (!t) break
        const exterior = tablas[tablas.length - 1]
        if (exterior?.celda) exterior.celda.push(t.filas.map((f) => f.join(' ')).join(' '))
        else if (t.filas.length > 0) bloques.push({ tipo: 'tabla', filas: t.filas })
        break
      }
    }
  })

  parser.write(xml).close()
  return bloques
}

/** `.docx` → propuesta de plantilla. */
export async function proponerImportDocx(buffer: Uint8Array, nombre_archivo = 'plantilla.docx'): Promise<ParseResult> {
  let xml: string | undefined
  try {
    const zip = await JSZip.loadAsync(buffer)
    xml = await zip.file('word/document.xml')?.async('string')
  } catch {
    return { ok: false, error: 'No se pudo leer el archivo: no es un .docx válido (¿es un .doc antiguo? guárdalo como .docx).' }
  }
  if (!xml) return { ok: false, error: 'El archivo no es un documento de Word (.docx).' }
  try {
    return proponerDesdeDocumento(bloquesDeDocumentXml(xml), nombre_archivo, 'docx')
  } catch (err) {
    return { ok: false, error: `No se pudo leer el .docx: ${err instanceof Error ? err.message : String(err)}` }
  }
}
