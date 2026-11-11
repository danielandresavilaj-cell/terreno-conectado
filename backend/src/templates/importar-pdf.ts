/**
 * Lector de PDF — TSK-FORM-020 (Enmienda 005, ADR-003 Enmienda 2).
 *
 * Corre sólo en el servidor (`pdfjs-dist`, build legacy para Node), para no
 * sumar el peso de pdf.js al bundle de la PWA. Reduce el PDF a bloques
 * (`@terreno/shared/importar`) por uno de tres caminos:
 *
 * 1. **Formulario rellenable (AcroForm):** cada campo es un ítem con su tipo
 *    exacto (casilla → OK/No OK/N.A.; grupo de radios o lista → opciones;
 *    texto → texto, fecha o número según su etiqueta). La etiqueta es el texto
 *    alternativo del campo o el texto impreso a su izquierda/arriba.
 * 2. **PDF con texto:** se reconstruyen renglones (coordenada y) y celdas
 *    (saltos grandes en x); renglones seguidos con varias celdas son una tabla.
 * 3. **PDF escaneado (sin texto ni campos):** error claro; el OCR es V2.
 */
import type { Bloque } from '@terreno/shared/importar'
import { proponerDesdeDocumento, tipoDeOpciones, tipoPorEtiqueta } from '@terreno/shared/importar'
import type { ParseResult } from '@terreno/shared/xlsx'

const MAX_PAGINAS = 40
const MIN_TEXTO_ESCANEADO = 20

interface Texto {
  str: string
  x: number
  y: number
  w: number
  h: number
}

interface Linea {
  y: number
  h: number
  celdas: { texto: string; x: number }[]
}

interface Widget {
  fieldType?: string
  fieldName?: string
  alternativeText?: string
  checkBox?: boolean
  radioButton?: boolean
  pushButton?: boolean
  buttonValue?: string
  exportValue?: string
  options?: { exportValue?: string; displayValue?: string }[]
  rect: number[]
  subtype?: string
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjs: Promise<PdfJs> | null = null
function cargarPdfJs(): Promise<PdfJs> {
  // Import dinámico real: pdf.js es ESM y el backend compila a CommonJS.
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjs
}

function textosDe(items: unknown[]): Texto[] {
  const out: Texto[] = []
  for (const it of items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
    if (!it.str || !it.transform || it.str.trim() === '') continue
    out.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, h: Math.abs(it.height ?? it.transform[3] ?? 10) })
  }
  return out
}

/** Agrupa el texto en renglones y celdas. */
export function lineasDe(textos: Texto[]): Linea[] {
  const orden = [...textos].sort((a, b) => b.y - a.y || a.x - b.x)
  const lineas: { y: number; h: number; items: Texto[] }[] = []
  for (const t of orden) {
    const l = lineas.find((x) => Math.abs(x.y - t.y) <= Math.max(2, Math.min(x.h, t.h) * 0.5))
    if (l) {
      l.items.push(t)
      l.h = Math.max(l.h, t.h)
    } else lineas.push({ y: t.y, h: t.h, items: [t] })
  }
  return lineas
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      const items = l.items.sort((a, b) => a.x - b.x)
      const celdas: { texto: string; x: number }[] = []
      let fin = -Infinity
      for (const it of items) {
        const hueco = it.x - fin
        const ultima = celdas[celdas.length - 1]
        if (ultima && hueco <= Math.max(6, it.h * 0.9)) ultima.texto += (hueco > it.h * 0.15 ? ' ' : '') + it.str
        else celdas.push({ texto: it.str, x: it.x })
        fin = it.x + it.w
      }
      return { y: l.y, h: l.h, celdas: celdas.map((c) => ({ ...c, texto: c.texto.replace(/\s+/g, ' ').trim() })).filter((c) => c.texto) }
    })
    .filter((l) => l.celdas.length > 0)
}

function mediana(ns: number[]): number {
  if (ns.length === 0) return 10
  const s = [...ns].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Renglones → títulos, párrafos y tablas. */
export function bloquesDeLineas(lineas: Linea[], alturaBase: number): Bloque[] {
  const bloques: Bloque[] = []
  let i = 0
  const esFichaLinea = (l: Linea) => l.celdas.every((c) => /:\s*([_.…]{3,})?$/.test(c.texto))
  const esTituloLinea = (l: Linea) =>
    l.celdas.length === 1 && l.h >= alturaBase * 1.25 && l.celdas[0].texto.length <= 80 && !/[:_☐□]/.test(l.celdas[0].texto)
  while (i < lineas.length) {
    const l = lineas[i]
    if (l.celdas.length >= 2 && !esFichaLinea(l)) {
      // Tabla: renglones seguidos con ≥ 2 celdas. Una fila de una celda en medio
      // es un subtítulo de la pauta; un título, una ficha o un salto grande la cortan.
      let j = i + 1
      while (j < lineas.length) {
        const g = lineas[j]
        const prev = lineas[j - 1]
        if (prev.y - g.y > Math.max(prev.h, g.h) * 2.8) break
        if (esFichaLinea(g) || esTituloLinea(g)) break
        if (g.celdas.length === 1 && !(j + 1 < lineas.length && lineas[j + 1].celdas.length >= 2)) break
        j++
      }
      const grupo = lineas.slice(i, j)
      if (grupo.filter((g) => g.celdas.length >= 2).length >= 2) {
        const base = grupo.reduce((a, b) => (b.celdas.length > a.celdas.length ? b : a))
        const anclas = base.celdas.map((c) => c.x)
        const filas = grupo.map((g) => {
          if (g.celdas.length === 1) return [g.celdas[0].texto]
          const fila: string[] = anclas.map(() => '')
          for (const c of g.celdas) {
            let k = 0
            for (let a = 1; a < anclas.length; a++) if (Math.abs(anclas[a] - c.x) < Math.abs(anclas[k] - c.x)) k = a
            fila[k] = fila[k] ? `${fila[k]} ${c.texto}` : c.texto
          }
          return fila
        })
        bloques.push({ tipo: 'tabla', filas })
        i = j
        continue
      }
      // Un renglón con varias celdas suelto: "Fecha: ____   Hora: ____".
      bloques.push({ tipo: 'parrafo', texto: l.celdas.map((c) => c.texto).join('   ') })
      i++
      continue
    }
    if (l.celdas.length >= 2) {
      bloques.push({ tipo: 'parrafo', texto: l.celdas.map((c) => c.texto).join('   ') })
      i++
      continue
    }
    const texto = l.celdas[0].texto
    bloques.push(esTituloLinea(l) ? { tipo: 'titulo', texto } : { tipo: 'parrafo', texto })
    i++
  }
  return bloques
}

function nombreLegible(fieldName: string): string {
  const base = fieldName.split('.').pop() ?? fieldName
  return base
    .replace(/[_-]+/g, ' ')
    .replace(/([a-záéíóú])([A-ZÁÉÍÓÚ])/g, '$1 $2')
    .replace(/\s+\d+$/, '')
    .trim()
}

/** La etiqueta impresa a la izquierda del campo (mismo renglón) o justo arriba. */
function etiquetaCercana(w: Widget, lineas: Linea[]): string | null {
  const [x1, y1, , y2] = w.rect
  const cy = (y1 + y2) / 2
  let mejor: { texto: string; d: number } | null = null
  for (const l of lineas) {
    for (const c of l.celdas) {
      if (c.x >= x1) continue
      const dy = Math.abs(l.y - cy)
      if (dy <= Math.max(6, l.h)) {
        const d = x1 - c.x
        if (!mejor || d < mejor.d) mejor = { texto: c.texto, d }
      }
    }
  }
  if (mejor) return mejor.texto
  const arriba = lineas.filter((l) => l.y > y2 && l.y - y2 < 24).sort((a, b) => a.y - b.y)[0]
  return arriba ? arriba.celdas.map((c) => c.texto).join(' ') : null
}

function bloquesDeCampos(widgets: Widget[], lineas: Linea[], alturaBase: number): Bloque[] {
  const entradas: { y: number; x: number; b: Bloque }[] = []
  const radios = new Map<string, Widget[]>()
  for (const w of widgets) {
    if (w.radioButton && w.fieldName) radios.set(w.fieldName, [...(radios.get(w.fieldName) ?? []), w])
  }
  const vistos = new Set<string>()
  for (const w of widgets) {
    if (w.pushButton || w.fieldType === 'Sig') continue
    const clave = w.fieldName ?? ''
    if (w.radioButton && vistos.has(clave)) continue
    vistos.add(clave)
    const prompt = (w.alternativeText?.trim() || etiquetaCercana(w, lineas) || nombreLegible(clave)).replace(/[:\s]+$/, '')
    if (!prompt) continue
    let b: Bloque
    if (w.fieldType === 'Btn' && w.radioButton) {
      const opciones = [...new Set((radios.get(clave) ?? []).map((r) => r.buttonValue ?? r.exportValue ?? '').filter(Boolean))]
      const t = tipoDeOpciones(opciones)
      b = { tipo: 'campo', prompt, response_type: t.type, options: t.options }
    } else if (w.fieldType === 'Btn') {
      b = { tipo: 'campo', prompt, response_type: 'ok_nok_na' }
    } else if (w.fieldType === 'Ch') {
      const opciones = (w.options ?? []).map((o) => (o.displayValue ?? o.exportValue ?? '').trim()).filter(Boolean)
      b = opciones.length > 0 ? { tipo: 'campo', prompt, response_type: 'select_single', options: [...new Set(opciones)] } : { tipo: 'campo', prompt, response_type: 'text' }
    } else {
      const t = tipoPorEtiqueta(prompt)
      b = { tipo: 'campo', prompt, response_type: t === 'omitir' ? 'text' : t }
    }
    entradas.push({ y: w.rect[3], x: w.rect[0], b })
  }
  // Títulos impresos (letra grande) para separar secciones.
  for (const l of lineas) {
    const texto = l.celdas.map((c) => c.texto).join(' ')
    if (l.celdas.length === 1 && l.h >= alturaBase * 1.25 && texto.length <= 80) entradas.push({ y: l.y + 0.1, x: 0, b: { tipo: 'titulo', texto } })
  }
  return entradas.sort((a, b) => b.y - a.y || a.x - b.x).map((e) => e.b)
}

/** `.pdf` → propuesta de plantilla. */
export async function proponerImportPdf(buffer: Uint8Array, nombre_archivo = 'plantilla.pdf'): Promise<ParseResult> {
  let doc
  try {
    const lib = await cargarPdfJs()
    doc = await lib.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    }).promise
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/password/i.test(msg)) return { ok: false, error: 'El PDF está protegido con contraseña. Quítala y vuelve a subirlo.' }
    return { ok: false, error: 'No se pudo leer el archivo: no es un PDF válido.' }
  }

  try {
    const bloques: Bloque[] = []
    let caracteres = 0
    let campos = 0
    const paginas = Math.min(doc.numPages, MAX_PAGINAS)
    for (let n = 1; n <= paginas; n++) {
      const page = await doc.getPage(n)
      const textos = textosDe((await page.getTextContent()).items)
      caracteres += textos.reduce((a, t) => a + t.str.trim().length, 0)
      const lineas = lineasDe(textos)
      const alturaBase = mediana(textos.map((t) => t.h))
      const widgets = ((await page.getAnnotations()) as Widget[]).filter((a) => a.subtype === 'Widget' && a.fieldType)
      campos += widgets.length
      bloques.push(...(widgets.length > 0 ? bloquesDeCampos(widgets, lineas, alturaBase) : bloquesDeLineas(lineas, alturaBase)))
      page.cleanup()
    }
    if (caracteres < MIN_TEXTO_ESCANEADO && campos === 0) {
      return {
        ok: false,
        error:
          'Este PDF es una imagen escaneada: no tiene texto que leer. El reconocimiento de imágenes (OCR) llega en una versión futura; mientras, usa el Word o el Excel original del formulario.',
      }
    }
    const r = proponerDesdeDocumento(bloques, nombre_archivo, 'pdf')
    if (r.ok && doc.numPages > MAX_PAGINAS) {
      r.propuesta.advertencias = [...(r.propuesta.advertencias ?? []), `Se leyeron sólo las primeras ${MAX_PAGINAS} páginas.`]
    }
    return r
  } catch (err) {
    return { ok: false, error: `No se pudo leer el PDF: ${err instanceof Error ? err.message : String(err)}` }
  } finally {
    await doc.destroy()
  }
}
