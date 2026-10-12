/* Exportación del documento original rellenado — FR-019/044 (TSK-FORM-010).
 *
 * El trabajador se lleva el `.xlsx` que subió el `tenant_admin` con sus
 * respuestas escritas encima y una hoja "Evidencias" con las fotos. **Todo ocurre
 * en el dispositivo**: el original está en el caché Dexie (FR-018/TSK-FORM-009) y
 * el relleno es el módulo local `@terreno/shared/xlsx`. No hay red en esta ruta —
 * y no debe haberla: si faltara el original, la respuesta es un error que explica
 * qué hacer, no una descarga silenciosa (Artículo I: la faena no tiene señal).
 *
 * El módulo está partido en tres capas, y lo que queda aquí es la última:
 *
 *   1. `construirEvidencias` — del estado de la captura (adjuntos de Dexie) a las
 *      filas de la hoja "Evidencias".
 *   2. `exportarDocumento` — orquesta (caché → parseo → relleno) y devuelve
 *      `{ok:true, libro}` o `{ok:false, error}`; nunca lanza por datos, para que
 *      la inspección ya capturada no se pierda por un fallo de exportación.
 *
 * La serialización del valor a celda (`serializarValorCampo`), el criterio de
 * "contestado" y el armado de `respuestas` (`construirRespuestas`) NO están aquí:
 * viven en `shared/src/xlsx/serializar.ts` porque FR-044 exige que el servidor
 * produzca el mismo artefacto que el dispositivo.
 *
 * No se reimplementa el parseo de `Content-Disposition` (no hay red aquí: el
 * nombre del archivo ya está en el caché, validado con `nombreArchivoSchema` al
 * guardarse) ni el emparejamiento ítem→celda, que es de `rellenar.ts`.
 */

import {
  MAX_NOMBRE_ARCHIVO,
  XLSX_MIME,
  nombreArchivoSchema,
  type CampoValor,
  type TemplateDefinition,
  type TemplateItem,
} from '@terreno/shared'
import {
  construirRespuestas,
  contestado,
  evidenciaSeIncrusta,
  nombreEvidencia,
  proponerImport,
  rellenarOriginal,
  type EvidenciaRellenable,
} from '@terreno/shared/xlsx'
import { db, getDraftInspectionId, originalDePlantilla, type AttachmentRow } from './db'
import { itemsDe } from './valores'

/**
 * Vista mínima de una respuesta capturada que necesita la exportación.
 *
 * Deliberadamente NO es el `RespuestaItem` del store: ese tipo vive en un `.tsx`
 * y arrastraría React (y `motion`) al programa de los tests, que corren en Node.
 * `RespuestaItem` es asignable a esta forma, así que el store no cambia.
 */
export interface RespuestaExportable {
  /** Valor tipado según `response_type` (FR-036); `null` = sin contestar. */
  campo: CampoValor | null
}

/* ── 2. Evidencias (hoja "Evidencias", FR-019/037) ───────────────────────── */

/** Nombre legible de la fila de una evidencia: el ítem al que pertenece. */
/**
 * Adjuntos de las respuestas `photo` del borrador, indexados por ítem de
 * plantilla (FR-037: el binario vive en el ATTACHMENT, no en la respuesta).
 */
async function adjuntosPorItem(draftId: string): Promise<Map<string, AttachmentRow>> {
  const respuestas = await db.responses.where('inspectionId').equals(draftId).toArray()
  const porItem = new Map<string, AttachmentRow>()
  for (const fila of respuestas) {
    const adjunto = await db.attachments
      .where('ownerId')
      .equals(fila.id)
      .and((a) => a.ownerType === 'response')
      .first()
    if (adjunto) porItem.set(fila.templateItemId, adjunto)
  }
  return porItem
}

/**
 * Adjuntos → filas de la hoja "Evidencias". Sólo entran los ítems `photo` con
 * marcador de captura Y binario local: un marcador sin adjunto (compresión
 * fallida, inválido) no se inventa como evidencia.
 */
export async function construirEvidencias(
  items: TemplateItem[],
  respuestas: Record<string, RespuestaExportable>,
  adjuntosPorItem: ReadonlyMap<string, AttachmentRow>,
): Promise<EvidenciaRellenable[]> {
  const fotos = items.filter((i) => i.response_type === 'photo')
  const evidencias: EvidenciaRellenable[] = []

  for (const [indice, item] of fotos.entries()) {
    const r = respuestas[item.id]
    if (!r || !contestado(r.campo)) continue
    const adjunto = adjuntosPorItem.get(item.id)
    if (!adjunto) continue
    evidencias.push({
      itemId: item.id,
      nombre: nombreEvidencia(indice + 1, item),
      mime: adjunto.mime,
      // El tamaño DECLARADO decide si se incrusta o se referencia (FR-046); los
      // bytes sólo hacen falta si acaba embebida.
      bytesLength: adjunto.bytes,
      bytes: evidenciaSeIncrusta(adjunto.bytes)
        ? new Uint8Array(await adjunto.blob.arrayBuffer())
        : new Uint8Array(0),
      fileKey: null,
      capturadoAt: adjunto.capturedAt,
    })
  }

  return evidencias
}

/** Atajo: lee los adjuntos del borrador y arma la hoja de evidencias. */
export async function evidenciasDeInspeccion(
  draftId: string,
  items: TemplateItem[],
  respuestas: Record<string, RespuestaExportable>,
): Promise<EvidenciaRellenable[]> {
  return construirEvidencias(items, respuestas, await adjuntosPorItem(draftId))
}

/* ── 3. Orquestación ─────────────────────────────────────────────────────── */

export interface ExportarDocumentoParams {
  /** Revisión congelada del turno (FR-028); `null` = plantilla local/demo. */
  revisionId: string | null
  /** Nombre de la plantilla, para el nombre de archivo de reserva. */
  templateName: string
  definition: TemplateDefinition
  respuestas: Record<string, RespuestaExportable>
  /** Borrador en curso; si falta, el export no lleva evidencias. */
  inspectionId?: string | null
  /** Hoy, inyectable para que el nombre de archivo sea determinista en tests. */
  hoy?: Date
}

export type ResultadoExportar =
  | {
      ok: true
      libro: Uint8Array
      fileName: string
      celdasEscritas: number
      /** Ítems que no llegaron al documento, con el motivo en la UI. */
      omitidas: string[]
    }
  | { ok: false; error: string }

const SIN_REVISION =
  'La plantilla activa no viene de una revisión publicada, así que no hay documento original ' +
  'que rellenar. Sincroniza las plantillas con señal y abre el turno de nuevo. Lo que ya ' +
  'respondiste queda guardado en el dispositivo.'

const SIN_ORIGINAL =
  'El documento original de esta plantilla no está en el dispositivo todavía. Se descarga solo ' +
  'cuando vuelve la señal, junto con la plantilla (FR-018): la exportación no descarga nada por ' +
  'su cuenta para no romper el trabajo sin conexión. Lo que ya respondiste queda guardado.'

/**
 * Rellena el documento original cacheado con la inspección en curso.
 *
 * Sin original cacheado NO se intenta la red (Artículo I): se devuelve el motivo
 * para que la UI lo muestre y el trabajador sepa qué hacer — volver a tener
 * señal, no "reintentar" una exportación que ya se sabe que fallará.
 */
export async function exportarDocumento(
  params: ExportarDocumentoParams,
): Promise<ResultadoExportar> {
  if (!params.revisionId) return { ok: false, error: SIN_REVISION }

  const original = await originalDePlantilla(params.revisionId)
  if (!original) return { ok: false, error: SIN_ORIGINAL }

  const bytes = new Uint8Array(await original.bytes.arrayBuffer())
  const items = itemsDe(params.definition)

  /* El original se vuelve a pasar por el parser porque `rellenarOriginal` empareja
   * la definición contra la propuesta por posición (sección, ítem): de aquí salen
   * la hoja y la columna destino de cada celda. El parser es determinista, así
   * que sobre los MISMOS bytes devuelve el mismo mapeo que produjo la plantilla. */
  const parseo = await proponerImport(bytes, original.file_name)
  if (!parseo.ok) {
    return { ok: false, error: `El documento original del dispositivo no se pudo interpretar: ${parseo.error}` }
  }

  // El estado del store guarda `{ campo }`; el contrato compartido habla de
  // `CampoValor`. El mapeo es de este lado para que `shared` no conozca la
  // forma del store — y para que el servidor pueda aplicar lo mismo desde sus
  // filas de `inspection_response` (FR-044).
  const campos: Record<string, CampoValor | null> = {}
  for (const item of items) campos[item.id] = params.respuestas[item.id]?.campo ?? null
  const { respuestas, omitidas } = construirRespuestas(items, campos)
  const draftId = params.inspectionId ?? (await getDraftInspectionId())
  const evidencias = draftId
    ? await evidenciasDeInspeccion(draftId, items, params.respuestas)
    : []

  const relleno = await rellenarOriginal({
    original: bytes,
    definition: params.definition,
    propuesta: parseo.propuesta,
    respuestas,
    evidencias,
  })
  if (!relleno.ok) return { ok: false, error: relleno.error }

  return {
    ok: true,
    libro: relleno.libro,
    fileName: nombreDeExportacion(original.file_name, params.templateName, params.hoy),
    celdasEscritas: relleno.celdasEscritas,
    // Las dos fuentes de omisión: lo que no se pudo serializar y lo que no tenía
    // celda destino en el libro (`emparejarItemsConOrigen`).
    omitidas: [...omitidas, ...relleno.omitidas],
  }
}

/**
 * Deja un texto apto para un nombre de archivo: fuera separadores de ruta y
 * caracteres de control, que `nombreArchivoSchema` rechaza por contrato. El
 * nombre de la plantilla viene del servidor y lo escribió un usuario, así que se
 * limpia en vez de rechazarlo.
 */
function textoAptoParaNombre(texto: string): string {
  return [...texto]
    .filter((ch) => {
      const punto = ch.codePointAt(0) ?? 0
      return punto >= 0x20 && punto !== 0x7f
    })
    .join('')
    .replace(/[/\\]/g, '-')
    .trim()
}

/**
 * Nombre del `.xlsx` exportado: el del original cacheado (es el documento que el
 * cliente reconoce) y, si ese nombre no fuera utilizable, el de la plantilla con
 * la fecha. El contrato `nombreArchivoSchema` es el del paquete compartido, que
 * ya resolvió el parseo de `Content-Disposition`; acá sólo se decide el *fallback*
 * del cliente (`templates.ts`, `nombreArchivoDeContentDisposition`).
 */
export function nombreDeExportacion(
  fileNameCacheado: string,
  nombrePlantilla: string,
  hoy: Date = new Date(),
): string {
  const directo = nombreArchivoSchema.safeParse(fileNameCacheado)
  if (directo.success) return directo.data

  const fecha = hoy.toISOString().slice(0, 10)
  const sufijo = ` ${fecha}.xlsx`
  // La fecha se reserva antes de recortar, para no perder la extensión.
  const base = textoAptoParaNombre(nombrePlantilla)
  const candidato = `${base.slice(0, Math.max(1, MAX_NOMBRE_ARCHIVO - sufijo.length))}${sufijo}`
  const limpio = nombreArchivoSchema.safeParse(candidato)
  return limpio.success ? limpio.data : `inspeccion-${fecha}.xlsx`
}

/**
 * MIME del ZIP del lote (FR-045). Vive acá y no en `api.ts` porque lo necesita
 * el que ESCRIBE el archivo, no el que lo pide: es el mismo literal que declara
 * el backend (`ZIP_MIME`) y se duplica a propósito porque un MIME de contenedor
 * no pertenece al contrato de datos.
 */
export const ZIP_MIME = 'application/zip'

/**
 * Última milla: `Blob` + `<a download>` sobre una URL de objeto, revocada al
 * terminar. Es la única función del módulo que toca el DOM (mismo patrón que el
 * CSV del `Dashboard`), y aísla ese trabajo para que la UI no lo repita.
 *
 * El `mime` es un parámetro y no una constante porque el mismo gesto descarga dos
 * cosas distintas: el `.xlsx` individual (FR-044) y el ZIP del lote (FR-045). El
 * nombre ya lo impone `a.download`, pero el tipo del `Blob` es lo que decide cómo
 * lo abre el sistema al recibirlo, y un ZIP etiquetado como hoja de cálculo se
 * abre igual de mal.
 */
export function descargarLibro(bytes: Uint8Array, fileName: string, mime = XLSX_MIME): void {
  // `new Uint8Array(bytes)` y no `bytes` directo: en TS 5.7 un `Uint8Array`
  // puede estar sobre un `SharedArrayBuffer` y no es asignable a `BlobPart`. La
  // copia además evita colgar en el Blob un `buffer` más grande que la vista.
  const blob = new Blob([new Uint8Array(bytes)], { type: mime })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
  } finally {
    // Siempre: una URL de objeto sin revocar retiene el libro en memoria hasta
    // que se recargue la página.
    URL.revokeObjectURL(url)
  }
}

/** ¿Hay original cacheado para esta revisión? Decide si el botón se habilita. */
export async function hayOriginalCacheado(revisionId: string | null): Promise<boolean> {
  if (!revisionId) return false
  return (await originalDePlantilla(revisionId)) !== undefined
}