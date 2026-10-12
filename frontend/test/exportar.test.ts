/* Orquestación de la exportación en el dispositivo — FR-019/044 (TSK-FORM-010).
 *
 * Lo que se prueba aquí es lo que es del CLIENTE: construir las evidencias desde
 * el estado de Dexie, pegar el original cacheado con `rellenarOriginal`, elegir el
 * nombre de descarga y dispararla.
 *
 * La serialización del valor a celda y el criterio de "contestado" NO se prueban
 * aquí: viven en `@terreno/shared/xlsx/serializar.ts` porque FR-044 exige que el
 * servidor produzca el mismo artefacto que el dispositivo, y sus casos están en
 * `shared/src/xlsx/serializar.test.ts`, junto al código.
 *
 * El original REAL es el del caché de Dexie (`fake-indexeddb`) y un `.xlsx`
 * pequeño generado con ExcelJS: original → `proponerImport` → `rellenarOriginal`
 * → releer. El libro se relee del resultado para comprobar qué quedó escrito de
 * verdad, no lo que la función dice haber escrito.
 *
 * El runner es `environment: 'node'`: sin DOM salvo donde hace falta para la
 * descarga, que se finge con stubs mínimos (igual que `api.binario.test.ts` con
 * `window`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import {
  MAX_NOMBRE_ARCHIVO,
  XLSX_MIME,
  type TemplateDefinition,
  type TemplateItem,
} from '@terreno/shared'
import { INDICADOR_EVIDENCIA } from '@terreno/shared/xlsx'
import {
  construirEvidencias,
  descargarLibro,
  exportarDocumento,
  hayOriginalCacheado,
  nombreDeExportacion,
  type RespuestaExportable,
} from '../src/lib/exportar'
import {
  db,
  ensureDraftInspection,
  guardarFotoRespuesta,
  guardarOriginalPlantilla,
  upsertResponse,
  type AttachmentRow,
} from '../src/lib/db'
import { META_ORIGINAL_BASE, TENANT_A, uuid } from './fixtures'

const HOY = new Date('2026-10-11T12:00:00.000Z')

/** Ítem de plantilla con la forma del contrato (id UUID, tipo del catálogo). */
function item(id: number, tipo: TemplateItem['response_type'], prompt = `Ítem ${id}`): TemplateItem {
  return { id: uuid(id), prompt, response_type: tipo }
}

/** Respuesta del store reducida a lo que la exportación mira. */
function campo(valor: RespuestaExportable['campo']): RespuestaExportable {
  return { campo: valor }
}

/** Relee un libro devuelto por la exportación (el mismo wrapper que la escolta). */
async function releer(libro: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(libro) as unknown as Parameters<typeof wb.xlsx.load>[0])
  return wb
}

/* ── 1. Evidencias desde el estado de la captura ──────────────────────────── */

/** Adjunto de una respuesta `photo`, con los campos que la exportación no mira. */
function adjunto(over: { bytes: number; blob: Blob }): AttachmentRow {
  return {
    id: 'att-foto',
    tenantId: TENANT_A,
    ownerId: 'resp-1',
    ownerType: 'response',
    mime: 'image/jpeg',
    capturedAt: '2026-10-11T10:00:00.000Z',
    ancho: 1280,
    alto: 960,
    clientVersion: 1,
    ...over,
  }
}

describe('construcción de evidencias', () => {
  it('una foto con marcador pero sin binario local no inventa evidencia', async () => {
    const sinAdjuntos = new Map<string, AttachmentRow>()

    const evidencias = await construirEvidencias(
      [item(1, 'photo', 'Foto')],
      { [uuid(1)]: campo('capturada') },
      sinAdjuntos,
    )

    expect(evidencias).toEqual([])
  })

  it('el nombre de la evidencia es el prompt del ítem, acotado a la columna', async () => {
    const evidencias = await construirEvidencias(
      [item(1, 'photo', `1. ${'Señalización en la rampa'.repeat(5)}`)],
      { [uuid(1)]: campo('capturada') },
      new Map([
        [
          uuid(1),
          adjunto({ bytes: 1024, blob: new Blob([new Uint8Array([1, 2, 3])]) }),
        ],
      ]),
    )

    expect(evidencias).toHaveLength(1)
    expect(evidencias[0].nombre).toHaveLength(60)
    // El tamaño DECLARADO es el que decide, y los bytes sólo se leen si la foto
    // acaba embebida (FR-046): aquí cabe de sobra, así que sí se leen.
    expect(evidencias[0].bytesLength).toBe(1024)
    expect(evidencias[0].bytes).toHaveLength(3)
  })

  it('una foto por encima del umbral se referencia SIN llegar a leer sus bytes', async () => {
    const blob = new Blob([new Uint8Array(4 * 1024 * 1024)])
    const lectura = vi.spyOn(blob, 'arrayBuffer')

    const evidencias = await construirEvidencias(
      [item(1, 'photo', 'Foto')],
      { [uuid(1)]: campo('capturada') },
      new Map([[uuid(1), adjunto({ bytes: 4 * 1024 * 1024, blob })]]),
    )

    expect(evidencias[0].bytesLength).toBe(4 * 1024 * 1024)
    expect(evidencias[0].bytes).toHaveLength(0)
    // Leer 4 MB para no incrustarlos sería tirar la RAM del teléfono por nada, y
    // quien arma la lista en el servidor ni siquiera los tiene a mano.
    expect(lectura).not.toHaveBeenCalled()
    lectura.mockRestore()
  })
})

/* ── 2. Orquestación con el original cacheado ───────────────────────────── */

/** Libro mínimo de una hoja con una fila de datos (el caso del import real). */
async function libroDePrueba(encabezados = ['Estado', 'Personas', 'Observación', 'Turno']) {
  const wb = new ExcelJS.Workbook()
  const hoja = wb.addWorksheet('Seguridad')
  hoja.addRow(encabezados)
  hoja.addRow(encabezados.map(() => 'OK'))
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

const DEFINICION_LIBRO: TemplateDefinition = {
  sections: [
    {
      title: 'Seguridad',
      items: [
        item(1, 'ok_nok_na', 'Estado'),
        item(2, 'numeric', 'Personas'),
        item(3, 'text', 'Observación'),
        item(4, 'select_single', 'Turno'),
      ],
    },
  ],
}

async function cachearOriginal(bytes: Uint8Array, fileName = META_ORIGINAL_BASE.file_name) {
  await guardarOriginalPlantilla({
    meta: { ...META_ORIGINAL_BASE, file_name: fileName, bytes_length: bytes.byteLength },
    bytes: new Blob([new Uint8Array(bytes)], { type: XLSX_MIME }),
  })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('exportación con el documento original en el caché', () => {
  it('escribe las respuestas serializadas en la fila de datos del libro', async () => {
    await cachearOriginal(await libroDePrueba())

    const res = await exportarDocumento({
      revisionId: META_ORIGINAL_BASE.revision_id,
      templateName: 'Chequeo de seguridad minera',
      definition: DEFINICION_LIBRO,
      respuestas: {
        [uuid(1)]: campo('nok'),
        [uuid(2)]: campo(7),
        [uuid(3)]: campo('falta cono en la rampa'),
        [uuid(4)]: campo('Noche'),
      },
      hoy: HOY,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.celdasEscritas).toBe(4)
    expect(res.omitidas).toEqual([])
    // El nombre sale del `file_name` cacheado: es el documento que el cliente ya
    // reconoce (#90), no uno inventado en el cliente.
    expect(res.fileName).toBe(META_ORIGINAL_BASE.file_name)

    // Se relee el libro DEVUELTO: importa qué quedó en las celdas, no lo que la
    // función dice que escribió.
    const hoja = (await releer(res.libro)).getWorksheet('Seguridad')!
    expect(hoja.getCell('A2').value).toBe('NOK')
    expect(hoja.getCell('B2').value).toBe(7)
    expect(hoja.getCell('C2').value).toBe('falta cono en la rampa')
    expect(hoja.getCell('D2').value).toBe('Noche')
  })

  it('lo no contestado no se escribe: la celda del libro queda como estaba', async () => {
    await cachearOriginal(await libroDePrueba())

    const res = await exportarDocumento({
      revisionId: META_ORIGINAL_BASE.revision_id,
      templateName: 'Chequeo de seguridad minera',
      definition: DEFINICION_LIBRO,
      respuestas: { [uuid(1)]: campo('ok') },
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    const wb = await releer(res.libro)
    const hoja = wb.getWorksheet('Seguridad')!
    expect(hoja.getCell('A2').value).toBe('OK')
    // Sin respuesta no se inventa nada: lo que traía el libro sigue ahí.
    expect(hoja.getCell('B2').value).toBe('OK')
    expect(hoja.getCell('C2').value).toBe('OK')
    // La hoja de evidencias existe aunque no haya fotos (FR-019).
    expect(wb.getWorksheet('Evidencias')).toBeDefined()
  })

  it('las fotos del borrador van a la hoja de evidencias, no a la celda', async () => {
    const png = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    )
    const definition: TemplateDefinition = {
      sections: [
        {
          title: 'Seguridad',
          items: [item(1, 'ok_nok_na', 'Estado'), item(2, 'photo', 'Foto de la señalización')],
        },
      ],
    }
    await cachearOriginal(await libroDePrueba(['Estado', 'Foto']))
    const draft = await ensureDraftInspection({
      tenantId: TENANT_A,
      siteId: 'faena-a',
      executedBy: 'user-1',
      templateName: 'Chequeo de seguridad minera',
      siteName: 'Faena El Roble',
      totalItems: 2,
      templateRevisionId: META_ORIGINAL_BASE.revision_id,
    })
    await upsertResponse({
      inspectionId: draft.id,
      templateItemId: uuid(1),
      tenantId: TENANT_A,
      valueOk: 'ok',
    })
    const respuestaFoto = await upsertResponse({
      inspectionId: draft.id,
      templateItemId: uuid(2),
      tenantId: TENANT_A,
      valueText: 'capturada',
    })
    await guardarFotoRespuesta({
      responseId: respuestaFoto,
      tenantId: TENANT_A,
      foto: { blob: new Blob([png], { type: 'image/png' }), ancho: 1, alto: 1, mime: 'image/png' },
    })

    const res = await exportarDocumento({
      revisionId: META_ORIGINAL_BASE.revision_id,
      templateName: 'Chequeo de seguridad minera',
      definition,
      respuestas: { [uuid(1)]: campo('ok'), [uuid(2)]: campo('capturada') },
      inspectionId: draft.id,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    const wb = await releer(res.libro)
    // La celda del ítem foto lleva la referencia, no los bytes.
    expect(wb.getWorksheet('Seguridad')!.getCell('B2').value).toBe(INDICADOR_EVIDENCIA)
    const evidencias = wb.getWorksheet('Evidencias')!
    expect(evidencias.rowCount).toBe(2)
    expect(evidencias.getCell('A2').value).toBe(uuid(2))
    // Columnas de la hoja: Ítem | Evidencia | Adjunto | MIME | Capturado. La foto
    // es pequeña, así que va embebida (columna `Adjunto`, no una referencia).
    expect(evidencias.getCell('C2').value).toBe('embebida')
    expect(evidencias.getCell('D2').value).toBe('image/png')
    // Y la miniatura va anclada en la fila de SU evidencia (FR-019/037): la
    // segunda de la hoja, que en el XML del drawing es 0-based → nativeRow 1.
    const ancladas = evidencias.getImages()
    expect(ancladas).toHaveLength(1)
    expect(ancladas[0].range.tl.nativeRow).toBe(1)
    expect(wb.model.media).toHaveLength(1)
    expect(wb.model.media[0].extension).toBe('png')
  })

  it('un libro que no corresponde a la plantilla se rechaza en vez de escribir mal', async () => {
    // Libro de DOS hojas contra una plantilla de UNA: `rellenarOriginal` no
    // puede emparejar ítem→celda, y ese error tiene que verse, no adivinarse.
    const wb = new ExcelJS.Workbook()
    const seguridad = wb.addWorksheet('Seguridad')
    seguridad.addRow(['Estado'])
    seguridad.addRow(['OK'])
    const extra = wb.addWorksheet('Extra')
    extra.addRow(['Otro'])
    extra.addRow(['OK'])
    await cachearOriginal(new Uint8Array(await wb.xlsx.writeBuffer()))

    const res = await exportarDocumento({
      revisionId: META_ORIGINAL_BASE.revision_id,
      templateName: 'Chequeo de seguridad minera',
      definition: DEFINICION_LIBRO,
      respuestas: { [uuid(1)]: campo('ok') },
    })

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('no corresponde a esta plantilla')
  })
})

describe('cuando el original no está en el dispositivo', () => {
  it('falla con un motivo accionable y NO toca la red', async () => {
    const red = vi.fn(() => {
      throw new Error('la exportación no debe usar la red (Art. I)')
    })
    vi.stubGlobal('fetch', red)

    const res = await exportarDocumento({
      revisionId: META_ORIGINAL_BASE.revision_id,
      templateName: 'Chequeo de seguridad minera',
      definition: DEFINICION_LIBRO,
      respuestas: { [uuid(1)]: campo('ok') },
    })

    expect(res.ok).toBe(false)
    if (res.ok) return
    // El motivo dice qué hacer (volver a tener señal) y no promete una descarga.
    expect(res.error).toContain('no está en el dispositivo')
    expect(res.error).toContain('Se descarga solo')
    expect(red).not.toHaveBeenCalled()
  })

  it('sin revisión publicada (plantilla local) tampoco hay documento que rellenar', async () => {
    const res = await exportarDocumento({
      revisionId: null,
      templateName: 'Seguridad en rajo',
      definition: DEFINICION_LIBRO,
      respuestas: {},
    })

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('no viene de una revisión publicada')
  })

  it('`hayOriginalCacheado` es exactamente lo que habilita el botón', async () => {
    expect(await hayOriginalCacheado(META_ORIGINAL_BASE.revision_id)).toBe(false)
    expect(await hayOriginalCacheado(null)).toBe(false)
    await cachearOriginal(await libroDePrueba())
    expect(await hayOriginalCacheado(META_ORIGINAL_BASE.revision_id)).toBe(true)
  })
})

/* ── Nombre del archivo y descarga ───────────────────────────────────────── */

describe('nombre del documento exportado', () => {
  it('usa el `file_name` cacheado del original', () => {
    expect(nombreDeExportacion('Chequeo de seguridad (rev 1).xlsx', 'Otro nombre', HOY)).toBe(
      'Chequeo de seguridad (rev 1).xlsx',
    )
  })

  it('si el nombre cacheado no es utilizable, cae al de la plantilla con la fecha', () => {
    // Separadores de ruta y caracteres de control: el contrato `nombreArchivoSchema`
    // los rechaza, así que el cliente compone su propio nombre utilizable.
    expect(nombreDeExportacion('carpeta/invierno.xlsx', 'Seguridad en rajo', HOY)).toBe(
      'Seguridad en rajo 2026-10-11.xlsx',
    )
    expect(nombreDeExportacion('', 'Rajo/Aseo', HOY)).toBe('Rajo-Aseo 2026-10-11.xlsx')
  })

  it('acota el nombre al tope del contrato aunque la plantilla sea enorme', () => {
    const nombre = nombreDeExportacion('carpeta/x.xlsx', 'L'.repeat(400), HOY)
    expect(nombre.length).toBeLessThanOrEqual(MAX_NOMBRE_ARCHIVO)
    expect(nombre.endsWith(' 2026-10-11.xlsx')).toBe(true)
  })
})

describe('descarga del libro', () => {
  it('crea el blob, dispara la descarga y revoca la URL de objeto', () => {
    // Stubs mínimos del DOM: `descargarLibro` es la ÚNICA función del módulo que
    // lo toca, y lo que se fija es que la URL no queda viva (retiene el libro
    // entero en memoria) y que el nombre viaja en `download`.
    const blobs: Blob[] = []
    const revocadas: string[] = []
    const descargas: Array<{ href: string; download: string }> = []
    let href = ''
    vi.stubGlobal('URL', {
      createObjectURL: (b: Blob) => {
        blobs.push(b)
        return 'blob:terreno/1'
      },
      revokeObjectURL: (u: string) => {
        revocadas.push(u)
      },
    })
    vi.stubGlobal('document', {
      createElement: () => ({
        set href(v: string) {
          href = v
        },
        set download(v: string) {
          descargas.push({ href, download: v })
        },
        click: () => {},
      }),
    })

    descargarLibro(new Uint8Array([1, 2, 3]), 'Chequeo.xlsx')

    expect(blobs[0].type).toBe(XLSX_MIME)
    expect(descargas).toEqual([{ href: 'blob:terreno/1', download: 'Chequeo.xlsx' }])
    expect(revocadas).toEqual(['blob:terreno/1'])
  })
})