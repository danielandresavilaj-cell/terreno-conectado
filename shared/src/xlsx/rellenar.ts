/**
 * Relleno del documento original — módulo 007 (TSK-FORM-010, FR-019/044).
 *
 * Rellena el `.xlsx` que el `tenant_admin` subió con las respuestas de la
 * inspección y le añade la hoja "Evidencias" (FR-019). Es la segunda mitad de
 * `escolta.ts`: el import (read) ya existía de TSK-FORM-005; aquí se usa la
 * misma escolta y el mismo módulo (ADR-003 Enmienda 1, d5).
 *
 * ## El problema del mapeo ítem → celda
 *
 * El parser sabe dónde vive cada ítem en el libro (`ImportSourceOrigin`: hoja,
 * columna, celda de encabezado, primera fila de datos), pero esa información
 * **se pierde** al convertir la propuesta en plantilla: `propuestaADefinicion`
 * conserva `props` y descarta `source`. Sin ella no hay forma de saber a qué
 * celda escribir.
 *
 * Decisión (task #43): **recuperar re-parseando el original**. El libro está
 * cacheado en el dispositivo por TSK-FORM-009 y el parser es determinista, así
 * que volver a pasarlo sobre el mismo archivo devuelve exactamente el mismo
 * `source`. El emparejamiento es por orden `(sección, ítem)`, que es estable
 * porque el wizard de importación no reordena ni añade ítems.
 *
 * Si los conteos NO cuadran, este módulo **falla con error explícito**: rellenar
 * la celda equivocada en silencio sería peor que no exportar. Un desajuste
 * significa que alguien editó la plantilla de una forma que rompe el supuesto,
 * y eso tiene que verse.
 */
import type { TemplateDefinition, TemplateItem } from '../templates'
import type { ImportSourceOrigin, TemplateImportProposal } from './types'
import ExcelJS from 'exceljs'
import { escribirLibro } from './escolta'

/** Respuesta de un ítem, ya serializada al texto que se escribe en el libro. */
export interface RespuestaRellenable {
  /** Id del ítem dentro de la plantilla (`definition`). */
  itemId: string
  /** Valor ya convertido a texto/número según su `response_type`. */
  valor: string | number | null
  /**
   * Fila de datos donde escribir, 1-based. `undefined` = `firstDataRow`: el
   * libro describe una fila de captura, no un histórico. Por defecto cada
   * inspección se exporta sobre su propio `.xlsx` ("el documento original
   * rellenado", FR-019); el parámetro existe para cuando el supervisor agrupe
   * varias inspecciones en la misma fila de un mismo documento.
   */
  fila?: number
}

/**
 * Adjunto que va a la hoja "Evidencias" (FR-019/037).
 *
 * `bytes` puede venir vacío cuando la foto supera el umbral y se decide
 * referenciarla en vez de incrustarla; en ese caso `fileKey` identifica el
 * adjunto en el almacén para poder recuperarlo aparte.
 */
export interface EvidenciaRellenable {
  itemId: string
  /** Nombre legible del archivo de evidencia. */
  nombre: string
  mime: string
  /** Tamaño declarado del adjunto, aunque `bytes` venga vacío. */
  bytesLength: number
  bytes: Uint8Array
  /** Clave del adjunto en el almacén, para la referencia. */
  fileKey?: string | null
  /** Momento de la captura, para la columna de la hoja. */
  capturadoAt: string
}

/**
 * Umbral de incrustado de una evidencia (FR-046: "referenciados o embebidos
 * según tamaño"; decisión cerrada en ADR-003 Enmienda 2).
 *
 * El compresor de FR-012 deja las fotos de ítem entre 80 KB y 200 KB, así que
 * 512 KB incrusta todo lo normal y sólo recurre a referenciar fotos que se
 * colaron sin comprimir. Sin este tope, un archivo con muchas fotos no tiene
 * ningún límite en ningún FR y el `.xlsx` puede crecer sin control.
 */
export const UMBRAL_EVIDENCIA_BYTES = 512 * 1024

/** ¿La evidencia se incrusta o se referencia en la hoja? */
export function evidenciaSeIncrusta(bytesLength: number): boolean {
  return bytesLength > 0 && bytesLength <= UMBRAL_EVIDENCIA_BYTES
}

export interface RellenarOriginalInput {
  /** Bytes del `.xlsx` original (del caché local, TSK-FORM-009). */
  original: Uint8Array
  /** Definición publicada de la revisión (plantilla inmutable, FR-049). */
  definition: TemplateDefinition
  /** Propuesta re-parseada del MISMO libro: de aquí sale la celda destino. */
  propuesta: TemplateImportProposal
  respuestas: RespuestaRellenable[]
  evidencias: EvidenciaRellenable[]
  /** Nombre de la hoja de evidencias (FR-019). */
  hojaEvidencias?: string
}

/** Resultado del emparejamiento definición ↔ libro original. */
export type Emparejado =
  | { ok: true; destinos: Map<string, ImportSourceOrigin> }
  | { ok: false; error: string }

/** Resultado del relleno. */
export type ResultadoRellenado =
  | { ok: true; libro: Uint8Array; celdasEscritas: number; omitidas: string[] }
  | { ok: false; error: string }

const NOMBRE_HOJA_EVIDENCIAS = 'Evidencias'

/**
 * Empareja cada ítem de la plantilla con su celda en el libro original.
 *
 * Por posición: la sección N de la plantilla contra la hoja N del libro y el
 * ítem M contra el ítem M. El wizard de importación (TSK-FORM-006) no reordena
 * ni añade ítems, así que el supuesto se sostiene; el caso de que no se sostenga
 * es exactamente lo que este chequeo existe para detectar.
 *
 * **Sólo posición, deliberadamente.** Renombrar un ítem o cambiarle el tipo NO
 * rompe el mapeo (el destino depende del orden, no del texto), y si algún día
 * alguien reordena, el desajuste se ve como desajuste. Una comparación por texto
 * como red de seguridad sería peor: adivinaría en cuál celda escribir y podría
 * volcar la respuesta de un ítem en la celda de otro sin avisar. Fallar es el
 * comportamiento correcto.
 */
export function emparejarItemsConOrigen(
  definition: TemplateDefinition,
  propuesta: TemplateImportProposal,
): Emparejado {
  const seccionesDef = definition.sections
  const seccionesProp = propuesta.secciones

  if (seccionesDef.length !== seccionesProp.length) {
    return {
      ok: false,
      error:
        `el documento original tiene ${seccionesProp.length} hoja(s) y la plantilla ` +
        `${seccionesDef.length} sección(es): el libro no corresponde a esta plantilla. ` +
        'Reimporta el .xlsx o crea una plantilla nueva (FR-019).',
    }
  }

  const destinos = new Map<string, ImportSourceOrigin>()
  for (const [si, seccionDef] of seccionesDef.entries()) {
    const seccionProp = seccionesProp[si]
    const itemsDef = seccionDef.items
    const itemsProp = seccionProp.items
    if (itemsDef.length !== itemsProp.length) {
      return {
        ok: false,
        error:
          `la sección "${seccionDef.title}" tiene ${itemsDef.length} ítem(s) en la plantilla ` +
          `y ${itemsProp.length} en el libro original: el mapeo de celdas no es fiable. ` +
          'Reimporta el .xlsx o crea una plantilla nueva (FR-019).',
      }
    }
    for (const [ii, itemDef] of itemsDef.entries()) {
      destinos.set(itemDef.id, itemsProp[ii].source)
    }
  }
  return { ok: true, destinos }
}

/**
 * Rellena el original y añade la hoja "Evidencias" (FR-019/044).
 *
 * Nunca lanza por datos: devuelve `{ ok: false, error }` para que el cliente
 * pueda mostrar el motivo y no perder la inspección que ya está capturada.
 */
export async function rellenarOriginal(
  input: RellenarOriginalInput,
): Promise<ResultadoRellenado> {
  const emparejado = emparejarItemsConOrigen(input.definition, input.propuesta)
  if (!emparejado.ok) return emparejado

  const cambios = []
  const omitidas: string[] = []
  for (const r of input.respuestas) {
    const destino = emparejado.destinos.get(r.itemId)
    if (!destino) {
      // Ítem agregado a la plantilla después de importar el libro: no hay celda
      // donde escribirlo. Se reporta en vez de fallar — el resto sí se rellena.
      omitidas.push(r.itemId)
      continue
    }
    if (r.valor === null) continue
    cambios.push({
      hoja: destino.sheet,
      celda: `${destino.column}${r.fila ?? destino.firstDataRow}`,
      valor: r.valor,
    })
  }

  try {
    const libro = await escribirLibro(input.original, cambios)
    const conEvidencias = await agregarHojaEvidencias(
      libro,
      input.hojaEvidencias ?? NOMBRE_HOJA_EVIDENCIAS,
      input.evidencias,
    )
    return { ok: true, libro: conEvidencias, celdasEscritas: cambios.length, omitidas }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? `No se pudo escribir el .xlsx: ${err.message}` : String(err),
    }
  }
}

/** Uint8Array → base64 sin `Buffer`: `btoa` existe igual en Node y en el
 *  navegador, y así el frontend no tiene que ampliar el tipo global `Buffer`
 *  para consumir este módulo por el subpath. */
function aBase64(bytes: Uint8Array): string {
  let binario = ''
  for (const b of bytes) binario += String.fromCharCode(b)
  return btoa(binario)
}

/** Tope de la columna de evidencia: es angosta y el prompt identifica igual. */
export const MAX_NOMBRE_EVIDENCIA = 60

/**
 * Nombre legible de la fila de evidencia: el prompt del ítem es lo que le dice
 * al revisor a qué verificación corresponde la foto.
 *
 * Vive aquí porque **servidor y dispositivo deben nombrarla igual**: si cada
 * lado compusiera su propia versión, los artefactos divergirían justo en la hoja
 * que el supervisor compara (FR-044).
 */
export function nombreEvidencia(indice: number, item: TemplateItem): string {
  return `${indice}. ${item.prompt}`.slice(0, MAX_NOMBRE_EVIDENCIA)
}

/** Agrega (o reemplaza) la hoja de evidencias con los adjuntos (FR-019/037). */
async function agregarHojaEvidencias(
  libro: Uint8Array,
  nombreHoja: string,
  evidencias: EvidenciaRellenable[],
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(libro) as unknown as Parameters<typeof wb.xlsx.load>[0])

  const previa = wb.getWorksheet(nombreHoja)
  if (previa) wb.removeWorksheet(previa.id)
  const hoja = wb.addWorksheet(nombreHoja)
  hoja.addRow(['Ítem', 'Evidencia', 'Adjunto', 'MIME', 'Capturado'])

  for (const e of evidencias) {
    // La decisión se toma por el tamaño DECLARADO, no por si vienen bytes: quien
    // arma la lista puede no haberlos leído cuando la foto es grande (es lo que
    // hace el servidor), y referenciar e incrustar tiene que dar lo mismo.
    const incrusta = evidenciaSeIncrusta(e.bytesLength) && e.bytes.length > 0
    const referencia = !incrusta && e.fileKey ? `referenciada (${e.fileKey})` : 'referenciada'
    const fila = hoja.addRow([e.itemId, e.nombre, incrusta ? 'embebida' : referencia, e.mime, e.capturadoAt])
    if (incrusta) {
      // Sin `filename`: en ExcelJS esa prop significa "ruta en disco desde la
      // que leer la imagen" y TIENE prioridad sobre `base64` (`xlsx.js`
      // → `addMedia`), así que pasarla haría que el writer intentara abrir
      // `e.nombre` con `fs` —que en el Web Worker del dispositivo ni existe— y
      // abortaría todo el export. Los bytes ya viajan en `base64`.
      const idImagen = wb.addImage({
        base64: aBase64(e.bytes),
        extension: extensionDe(e.mime),
      })
      // La miniatura se ancla sobre la columna de evidencia de **su** fila.
      // `fila.number - 1` porque `tl.row` es 0-based en el XML del drawing:
      // con `fila.number` la imagen caía una fila por debajo de su evidencia y,
      // peor, el setter `row` de `Anchor` materializaba esa fila de más
      // (`getRow(nativeRow + 1)`), dejando un hueco por cada foto. Con el
      // índice correcto `getRow` devuelve la fila que ya existe: hay
      // exactamente una fila por evidencia, tenga o no bytes.
      hoja.addImage(idImagen, {
        tl: { col: 1, row: fila.number - 1 },
        ext: { width: 140, height: 100 },
      })
    }
  }
  hoja.columns = [{ width: 38 }, { width: 24 }, { width: 34 }, { width: 30 }, { width: 20 }]

  const out = await wb.xlsx.writeBuffer()
  return new Uint8Array(out)
}

/**
 * Extensión que ExcelJS acepta para incrustar. El tipo es una unión cerrada
 * (`jpeg | png | gif`) y la foto de ítem se comprime a JPEG en el dispositivo
 * (FR-012), así que se decide por MIME y no por el nombre del archivo, que el
 * usuario pudo haber llamado como quiera.
 */
type ExtensionImagen = 'jpeg' | 'png' | 'gif'

const EXTENSION_POR_MIME: Record<string, ExtensionImagen> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/gif': 'gif',
}

function extensionDe(mime: string): ExtensionImagen {
  return EXTENSION_POR_MIME[mime.toLowerCase()] ?? 'jpeg'
}
