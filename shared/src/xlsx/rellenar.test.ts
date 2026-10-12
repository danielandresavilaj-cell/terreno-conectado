/**
 * Tests del relleno del documento original — módulo 007 (TSK-FORM-010, FR-019/044).
 *
 * Estrategia (la del resto del módulo): los libros se generan
 * **programáticamente con ExcelJS** y se releen con `leerCuadricula`, de modo
 * que se ejercita el round-trip completo de producción —generar → `proponerImport`
 * → `propuestaADefinicion` → `rellenarOriginal` → releer— sin depender de
 * binarios frágiles. Sólo hay un test de integración con el fixture real del
 * spike, igual que en `import.test.ts`.
 *
 * El emparejamiento siempre se hace con la propuesta re-parseada del **mismo**
 * libro, que es el supuesto que sostiene el módulo (task #43); los casos
 * negativos lo rompen a propósito para comprobar que se falla en vez de
 * escribir en la celda del ítem equivocado.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { TemplateDefinition } from '../templates'
import type { CeldaLibro, HojaLibro } from './escolta'
import { leerCuadricula } from './escolta'
import { proponerImport } from './import'
import { propuestaADefinicion } from './to-definition'
import type { TemplateImportProposal } from './types'
import type { EvidenciaRellenable } from './rellenar'
import { emparejarItemsConOrigen, rellenarOriginal } from './rellenar'

/** PNG 1×1 mínimo: bytes reales, porque el camino de imagen es el que importa. */
const PNG_1x1 = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

interface Escenario {
  original: Uint8Array
  propuesta: TemplateImportProposal
  definition: TemplateDefinition
}

async function aBuffer(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/** Índice 1-based de una letra de columna (`A`→1, `D`→4). */
function indiceDeColumna(letra: string): number {
  return letra.charCodeAt(0) - 64
}

/** Celda normalizada por (hoja, fila, columna). Fila y columna son 1-based. */
function celda(
  hojas: HojaLibro[],
  nombreHoja: string,
  fila: number,
  columna: string,
): CeldaLibro | null {
  return hojas.find((h) => h.nombre === nombreHoja)?.filas[fila - 1]?.[indiceDeColumna(columna) - 1] ?? null
}

/**
 * Re-parsea un libro ya generado en memoria y publica la plantilla. Es el
 * camino exacto de producción (import → definición) y deja a
 * `rellenarOriginal` en el mismo estado en el que lo recibe el export; si algo
 * falla lo dice el test, no un `if (!res.ok) return` que se trague el resto de
 * aserciones.
 */
async function escenario(original: Uint8Array, nombre = 'plantilla.xlsx'): Promise<Escenario> {
  const parseo = await proponerImport(original, nombre)
  if (!parseo.ok) throw new Error(`el libro de prueba no es parseable: ${parseo.error}`)
  const def = propuestaADefinicion(parseo.propuesta)
  if (!def.ok) throw new Error(`la definición de prueba no es válida: ${def.error}`)
  return { original, propuesta: parseo.propuesta, definition: def.definition }
}

/**
 * Libro de dos ítems con encabezado en la fila 2, como el fixture del spike:
 * `firstDataRow` = 3 y hace falta una fila de muestra para la detección.
 */
function libroDeDosItems(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Inspección Diaria')
  ws.getCell('A2').value = 'Responsable (texto)'
  ws.getCell('B2').value = 'Cantidad verificada (número)'
  ws.getCell('A3').value = 'Muestra'
  ws.getCell('B3').value = 1
  return wb
}

/** Libro de una sola hoja con un único ítem, para forzar un desajuste de ítems. */
function libroDeUnItem(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Inspección Diaria')
  ws.getCell('A2').value = 'Responsable (texto)'
  ws.getCell('A3').value = 'Muestra'
  return wb
}

/** Libro de dos hojas: el emparejamiento posicional debe rechazarlo. */
function libroDeDosHojas(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const a = wb.addWorksheet('Inspección')
  a.getCell('A2').value = 'Estado (ok/nok/na)'
  a.getCell('A3').value = 'OK'
  const b = wb.addWorksheet('Resumen')
  b.getCell('A2').value = 'Observación (texto)'
  b.getCell('A3').value = 'Sin novedad'
  return wb
}

/**
 * Un ítem por cada `response_type`. Los hints `(…)` del encabezado fijan el
 * tipo de forma determinista: sin ellos el parser autodetectaría y el test
 * dependería de los valores de muestra en vez del contrato.
 */
function libroDeLos8Tipos(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Checklist')
  ws.getCell('A2').value = 'Estado (ok/nok/na)'
  ws.getCell('B2').value = 'Observación (texto)'
  ws.getCell('C2').value = 'Cantidad (número)'
  ws.getCell('D2').value = 'Fecha (fecha)'
  ws.getCell('E2').value = 'Hora (hora)'
  ws.getCell('F2').value = 'Turno (lista)'
  ws.getCell('G2').value = 'Áreas (multi)'
  ws.getCell('H2').value = 'Evidencia (foto)'
  for (const fila of [3, 4]) {
    ws.getCell(`A${fila}`).value = 'OK'
    ws.getCell(`B${fila}`).value = 'Sin novedad'
    ws.getCell(`C${fila}`).value = fila
    ws.getCell(`D${fila}`).value = '2026-03-01'
    ws.getCell(`E${fila}`).value = '08:00'
    ws.getCell(`F${fila}`).value = 'Día'
    ws.getCell(`G${fila}`).value = 'Perimetral; Tajones'
  }
  return wb
}

describe('emparejarItemsConOrigen — mapeo ítem → celda', () => {
  it('resuelve cada itemId a la hoja y columna que le tocarían en el libro', async () => {
    const { propuesta, definition } = await escenario(await aBuffer(libroDeLos8Tipos()))
    const res = emparejarItemsConOrigen(definition, propuesta)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.destinos.size).toBe(8)
    // El destino de cada ítem es el `source` del ítem homónimo de la propuesta,
    // en el MISMO orden: ése es el contrato del emparejamiento posicional.
    definition.sections[0].items.forEach((item, i) => {
      expect(res.destinos.get(item.id)).toEqual(propuesta.secciones[0].items[i].source)
    })
    expect(res.destinos.get(definition.sections[0].items[2].id)).toMatchObject({
      sheet: 'Checklist',
      column: 'C',
      headerCell: 'C2',
      firstDataRow: 3,
    })
  })

  it('falla con el conteo de hojas si el libro tiene más secciones que la plantilla', async () => {
    const una = await escenario(await aBuffer(libroDeDosItems()))
    const dos = await escenario(await aBuffer(libroDeDosHojas()))
    const res = emparejarItemsConOrigen(una.definition, dos.propuesta)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/1 sección\(es\)/)
    expect(res.error).toMatch(/2 hoja\(s\)/)
    expect(res.error).toMatch(/no corresponde a esta plantilla/i)
  })

  it('falla nombrando la sección si el conteo de ítems no cuadra', async () => {
    const dos = await escenario(await aBuffer(libroDeDosItems()))
    const uno = await escenario(await aBuffer(libroDeUnItem()))
    const res = emparejarItemsConOrigen(dos.definition, uno.propuesta)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('Inspección Diaria')
    expect(res.error).toMatch(/2 ítem\(s\) en la plantilla y 1 en el libro original/)
  })

  it('rellenarOriginal propaga el mismo error sin tocar el libro original', async () => {
    const { original, definition } = await escenario(await aBuffer(libroDeDosItems()))
    const otra = await escenario(await aBuffer(libroDeDosHojas()))
    const res = await rellenarOriginal({
      original,
      definition,
      propuesta: otra.propuesta,
      respuestas: [],
      evidencias: [],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/no corresponde a esta plantilla/i)
  })
})

describe('rellenarOriginal — round-trip de escritura', () => {
  it('escribe cada respuesta en su columna y firstDataRow respetando el tipo', async () => {
    const { original, propuesta, definition } = await escenario(await aBuffer(libroDeDosItems()))
    const [responsable, cantidad] = definition.sections[0].items
    const [srcResponsable, srcCantidad] = propuesta.secciones[0].items.map((i) => i.source)

    const res = await rellenarOriginal({
      original,
      definition,
      propuesta,
      respuestas: [
        { itemId: responsable.id, valor: 'Juan Pérez' },
        { itemId: cantidad.id, valor: 7 },
      ],
      evidencias: [],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.celdasEscritas).toBe(2)
    expect(res.omitidas).toEqual([])

    const hojas = await leerCuadricula(res.libro)
    // El texto llega como texto…
    expect(celda(hojas, 'Inspección Diaria', srcResponsable.firstDataRow, srcResponsable.column))
      .toEqual({ texto: 'Juan Pérez' })
    // …y el número como número, no como el texto '7': el documento original
    // debe seguir siendo un `.xlsx` usable (sumas, filtros, validaciones).
    const celdaNumero = celda(
      hojas,
      'Inspección Diaria',
      srcCantidad.firstDataRow,
      srcCantidad.column,
    )
    expect(celdaNumero?.numero).toBe(7)
    expect(typeof celdaNumero?.numero).toBe('number')
    // Los encabezados no se tocan: se escribe en la fila de datos, no en la
    // del header. El hint `(…)` forma parte del encabezado original y también
    // se conserva.
    expect(celda(hojas, 'Inspección Diaria', 2, 'A')?.texto).toBe('Responsable (texto)')
    expect(celda(hojas, 'Inspección Diaria', 2, 'B')?.texto).toBe('Cantidad verificada (número)')
  })

  it('respeta la fila explícita de la respuesta en vez de firstDataRow', async () => {
    const { original, propuesta, definition } = await escenario(await aBuffer(libroDeDosItems()))
    const [responsable] = definition.sections[0].items
    const origen = propuesta.secciones[0].items[0].source

    const res = await rellenarOriginal({
      original,
      definition,
      propuesta,
      respuestas: [{ itemId: responsable.id, valor: 'Supervisor de turno', fila: 5 }],
      evidencias: [],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const hojas = await leerCuadricula(res.libro)
    expect(celda(hojas, 'Inspección Diaria', 5, origen.column)?.texto).toBe('Supervisor de turno')
    // firstDataRow (3) conserva su valor de muestra: `fila` elige, no añade.
    expect(celda(hojas, 'Inspección Diaria', origen.firstDataRow, origen.column)?.texto).toBe('Muestra')
  })

  it('no escribe nada con valor null y no lo cuenta como celda escrita', async () => {
    const { original, propuesta, definition } = await escenario(await aBuffer(libroDeDosItems()))
    const responsable = definition.sections[0].items[0]

    const res = await rellenarOriginal({
      original,
      definition,
      propuesta,
      respuestas: [{ itemId: responsable.id, valor: null }],
      evidencias: [],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.celdasEscritas).toBe(0)

    // El original se conserva tal cual: `null` es "no contestado", no "borra".
    const hojas = await leerCuadricula(res.libro)
    expect(celda(hojas, 'Inspección Diaria', 3, 'A')?.texto).toBe('Muestra')
  })

  it('omite el ítem sin destino y rellena el resto sin fallar', async () => {
    const { original, propuesta, definition } = await escenario(await aBuffer(libroDeDosItems()))
    const [responsable] = definition.sections[0].items
    const huerfano = '00000000-0000-7000-8000-000000000000'

    const res = await rellenarOriginal({
      original,
      definition,
      propuesta,
      respuestas: [
        { itemId: huerfano, valor: 'No hay celda para esto' },
        { itemId: responsable.id, valor: 'Ana Ruiz' },
      ],
      evidencias: [],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.omitidas).toEqual([huerfano])
    expect(res.celdasEscritas).toBe(1)

    const hojas = await leerCuadricula(res.libro)
    expect(celda(hojas, 'Inspección Diaria', 3, 'A')?.texto).toBe('Ana Ruiz')
  })
})

describe('rellenarOriginal — hoja de evidencias (FR-019/037)', () => {
  const evidencias: EvidenciaRellenable[] = [
    {
      itemId: 'item-estado',
      nombre: 'captura-01.png',
      mime: 'image/png',
      bytes: PNG_1x1,
      capturadoAt: '2026-03-14T10:00:00.000Z',
    },
    {
      itemId: 'item-observacion',
      // Sin bytes: el adjunto aún no se descargó (offline, FR-012). La fila debe
      // existir igual, con los metadatos que sí están en el dispositivo.
      nombre: 'captura-02.jpg',
      mime: 'image/jpeg',
      bytes: new Uint8Array(0),
      capturadoAt: '2026-03-14T10:05:00.000Z',
    },
    {
      // Segunda evidencia CON bytes: anclar una miniatura no debe insertar filas
      // fantasma que desplace a la siguiente evidencia.
      itemId: 'item-cantidad',
      nombre: 'captura-03.jpg',
      mime: 'image/jpeg',
      bytes: PNG_1x1,
      capturadoAt: '2026-03-14T10:09:00.000Z',
    },
  ]

  it('añade la hoja Evidencias con encabezado y una fila por evidencia', async () => {
    const { original, propuesta, definition } = await escenario(await aBuffer(libroDeDosItems()))
    const res = await rellenarOriginal({ original, definition, propuesta, respuestas: [], evidencias })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const hojas = await leerCuadricula(res.libro)
    const hojaEvidencias = hojas.find((h) => h.nombre === 'Evidencias')
    expect(hojaEvidencias).toBeDefined()

    const textos = (fila: number) =>
      (hojaEvidencias?.filas[fila - 1] ?? []).map((c) => c?.texto ?? null)
    expect(textos(1)).toEqual(['Ítem', 'Evidencia', 'MIME', 'Capturado'])
    expect(textos(2)).toEqual([
      'item-estado',
      'captura-01.png',
      'image/png',
      '2026-03-14T10:00:00.000Z',
    ])
    expect(textos(3)).toEqual([
      'item-observacion',
      'captura-02.jpg',
      'image/jpeg',
      '2026-03-14T10:05:00.000Z',
    ])
    expect(textos(4)).toEqual([
      'item-cantidad',
      'captura-03.jpg',
      'image/jpeg',
      '2026-03-14T10:09:00.000Z',
    ])
    // Exactamente encabezado + una fila por evidencia: ninguna fila de relleno.
    expect(hojaEvidencias?.filas).toHaveLength(4)

    // La foto va incrustada en el propio `.xlsx`: el buffer lleva la entrada
    // `xl/media/…`, no una referencia a un archivo externo del dispositivo.
    const crudo = Buffer.from(res.libro).toString('latin1')
    expect(crudo).toContain('xl/media/image')
  })

  it('usa el nombre de hoja indicado en hojaEvidencias', async () => {
    const { original, propuesta, definition } = await escenario(await aBuffer(libroDeDosItems()))
    const res = await rellenarOriginal({
      original,
      definition,
      propuesta,
      respuestas: [],
      evidencias,
      hojaEvidencias: 'Otra',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const nombres = (await leerCuadricula(res.libro)).map((h) => h.nombre)
    expect(nombres).toContain('Otra')
    expect(nombres).not.toContain('Evidencias')
  })

  it('no duplica la hoja de evidencias si el documento ya traía una', async () => {
    const wb = libroDeDosItems()
    const previa = wb.addWorksheet('Evidencias')
    previa.addRow(['basura', 'basura', 'basura', 'basura'])
    const { original, propuesta, definition } = await escenario(await aBuffer(wb))

    const res = await rellenarOriginal({ original, definition, propuesta, respuestas: [], evidencias })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const hojas = await leerCuadricula(res.libro)
    expect(hojas.filter((h) => h.nombre === 'Evidencias')).toHaveLength(1)
    expect(hojas.find((h) => h.nombre === 'Evidencias')?.filas[0][1]?.texto).toBe('Evidencia')
  })
})

describe('rellenarOriginal — degradación (no lanza, devuelve el motivo)', () => {
  it('devuelve ok:false con un buffer que no es un .xlsx válido', async () => {
    const { propuesta, definition } = await escenario(await aBuffer(libroDeDosItems()))
    const res = await rellenarOriginal({
      original: new Uint8Array([1, 2, 3, 4, 5]),
      definition,
      propuesta,
      respuestas: [{ itemId: definition.sections[0].items[0].id, valor: 'x' }],
      evidencias: [],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/No se pudo escribir el \.xlsx/)
  })

  it('devuelve ok:false si la hoja de destino no existe en el libro', async () => {
    // Cached `.xlsx` corrupto o sustituido: la propuesta dice 'Inspección Diaria'
    // pero el libro ya no tiene esa hoja. `escribirLibro` lanza y el módulo lo
    // traduce a `{ ok: false }` en vez de propagar la excepción al caller.
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Inspección Diaria')
    ws.getCell('A2').value = 'Responsable (texto)'
    ws.getCell('A3').value = 'Muestra'
    const { propuesta, definition } = await escenario(await aBuffer(wb))
    const otro = new ExcelJS.Workbook()
    otro.addWorksheet('Otra').getCell('A1').value = 'no es lo mismo'
    const original = await aBuffer(otro)

    const res = await rellenarOriginal({
      original,
      definition,
      propuesta,
      respuestas: [{ itemId: definition.sections[0].items[0].id, valor: 'x' }],
      evidencias: [],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/No se pudo escribir el \.xlsx/)
  })
})

describe('rellenarOriginal — los 8 response_type', () => {
  /**
   * El caller es quien serializa (aquí, el test); esta tabla documenta qué
   * acaba en la celda para cada tipo y comprueba que el módulo no reinterpreta
   * el valor. Se espera la celda derivada del `ImportSourceOrigin`, no una
   * constante escrita a mano, para que el test siga valiendo si cambia el libro.
   */
  const CASOS: {
    tipo: string
    columna: string
    valor: string | number
    esperado: CeldaLibro
  }[] = [
    // `ok_nok_na` se serializa a la etiqueta corta que el parser reconoce.
    { tipo: 'ok_nok_na', columna: 'A', valor: 'nok', esperado: { texto: 'nok' } },
    { tipo: 'text', columna: 'B', valor: 'Grieta en soporte', esperado: { texto: 'Grieta en soporte' } },
    { tipo: 'numeric', columna: 'C', valor: 12, esperado: { texto: '12', numero: 12 } },
    { tipo: 'date', columna: 'D', valor: '2026-03-14', esperado: { texto: '2026-03-14', fecha: '2026-03-14' } },
    { tipo: 'time', columna: 'E', valor: '08:30', esperado: { texto: '08:30', hora: '08:30' } },
    { tipo: 'select_single', columna: 'F', valor: 'Noche', esperado: { texto: 'Noche' } },
    // `select_multiple` se serializa con ';' porque es lo que el propio parser
    // vuelve a leer como lista en la siguiente importación.
    { tipo: 'select_multiple', columna: 'G', valor: 'Perimetral; Tajones', esperado: { texto: 'Perimetral; Tajones' } },
    // `photo` escribe la referencia local; el binario va en la hoja Evidencias.
    { tipo: 'photo', columna: 'H', valor: 'extintor-01.jpg', esperado: { texto: 'extintor-01.jpg' } },
  ]

  let escenario8: Escenario

  beforeAll(async () => {
    escenario8 = await escenario(await aBuffer(libroDeLos8Tipos()))
    expect(escenario8.definition.sections[0].items.map((i) => i.response_type)).toEqual(
      CASOS.map((c) => c.tipo),
    )
  })

  it.each(CASOS)('$tipo escribe "$valor" en la columna $columna', async (caso) => {
    const { original, propuesta, definition } = escenario8
    const indice = CASOS.indexOf(caso)
    const item = definition.sections[0].items[indice]
    const origen = propuesta.secciones[0].items[indice].source
    expect(origen.column).toBe(caso.columna)

    const res = await rellenarOriginal({
      original,
      definition,
      propuesta,
      respuestas: [{ itemId: item.id, valor: caso.valor }],
      evidencias: [],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.celdasEscritas).toBe(1)

    const hojas = await leerCuadricula(res.libro)
    expect(celda(hojas, origen.sheet, origen.firstDataRow, origen.column)).toEqual(caso.esperado)
  })
})

describe('rellenarOriginal — integración con el fixture del spike', () => {
  it('rellena el spike-referencia.xlsx real en la columna y fila que dice el parser', async () => {
    const fixture = fileURLToPath(new URL('../../fixtures/xlsx/spike-referencia.xlsx', import.meta.url))
    const original = new Uint8Array(readFileSync(fixture))
    const { propuesta, definition } = await escenario(original, 'spike-referencia.xlsx')
    const porPrompt = Object.fromEntries(definition.sections[0].items.map((i) => [i.prompt, i]))
    const origenDe = (prompt: string) =>
      propuesta.secciones[0].items.find((i) => i.prompt === prompt)!.source

    const res = await rellenarOriginal({
      original,
      definition,
      propuesta,
      respuestas: [
        { itemId: porPrompt['Estado']!.id, valor: 'nok' },
        { itemId: porPrompt['Cantidad verificada']!.id, valor: 42 },
      ],
      evidencias: [],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const hojas = await leerCuadricula(res.libro)
    expect(hojas.find((h) => h.nombre === 'Inspección Diaria')).toBeDefined()
    const estado = origenDe('Estado')
    const cantidad = origenDe('Cantidad verificada')
    expect(estado.column).toBe('D')
    expect(estado.firstDataRow).toBe(3)

    // Se escribe justo en la celda que el parser localize en el libro real.
    expect(celda(hojas, estado.sheet, estado.firstDataRow, estado.column)).toEqual({ texto: 'nok' })
    expect(celda(hojas, cantidad.sheet, cantidad.firstDataRow, cantidad.column)?.numero).toBe(42)
    // El encabezado de la fila 2 sigue intacto, hint incluido.
    expect(celda(hojas, estado.sheet, estado.headerRow, estado.column)?.texto).toBe('Estado (ok/nok/na)')
    expect(hojas.map((h) => h.nombre)).toContain('Evidencias')
  })
})