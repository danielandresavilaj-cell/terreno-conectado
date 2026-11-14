import { beforeEach, describe, expect, it } from 'vitest'
import {
  db,
  fotosDeHallazgo,
  guardarHallazgo,
  hallazgoDeRespuesta,
  hallazgoPorId,
  hallazgosDeInspeccion,
  hallazgosDirectos,
} from '../src/lib/db'
import { detalleDeHallazgo, erroresDeHallazgo, exigeDescripcion } from '../src/lib/hallazgo'
import { TENANT_A } from './fixtures'

const foto = (contenido: string) => ({
  blob: new Blob([contenido], { type: 'image/jpeg' }),
  ancho: 4,
  alto: 3,
  mime: 'image/jpeg',
})

const base = {
  inspectionId: 'ins-1',
  responseId: 'resp-1',
  tenantId: TENANT_A,
  detalle: 'resumen',
}

async function filasDe(entityType: 'finding' | 'attachment') {
  return (await db.outbox.toArray()).filter((f) => f.entityType === entityType)
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('reglas del hallazgo (FR-032, TSK-OFF-007)', () => {
  it('la severidad se elige: sin ella no se guarda', () => {
    expect(erroresDeHallazgo(null, 'Baranda suelta en el nivel 2')).toEqual({
      severidad: 'Elige la severidad del hallazgo.',
    })
  })

  it('alta y crítica exigen una descripción que diga algo', () => {
    expect(exigeDescripcion('alta')).toBe(true)
    expect(exigeDescripcion('critica')).toBe(true)
    expect(exigeDescripcion('media')).toBe(false)
    expect(erroresDeHallazgo('critica', '   ').descripcion).toBeDefined()
    expect(erroresDeHallazgo('alta', 'ok').descripcion).toBeDefined()
    expect(erroresDeHallazgo('alta', 'Baranda suelta')).toEqual({})
  })

  it('baja y media se pueden guardar sin descripción', () => {
    expect(erroresDeHallazgo('baja', '')).toEqual({})
    expect(erroresDeHallazgo('media', '')).toEqual({})
  })

  it('el resumen para la cola se acorta sin partir espacios', () => {
    expect(detalleDeHallazgo('')).toBe('Sin descripción')
    expect(detalleDeHallazgo('  Fuga   de aceite ')).toBe('Fuga de aceite')
    expect(detalleDeHallazgo('x'.repeat(60))).toHaveLength(42)
  })
})

describe('guardarHallazgo: una respuesta NOK tiene un solo hallazgo', () => {
  it('la primera vez crea el hallazgo y lo encola', async () => {
    const r = await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', fotosNuevas: [], fotosQuitar: [] })

    expect(r.creado).toBe(true)
    expect(await hallazgosDeInspeccion('ins-1')).toHaveLength(1)
    expect(await filasDe('finding')).toHaveLength(1)
  })

  it('corregirlo actualiza el mismo registro en vez de crear otro', async () => {
    const primero = await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', fotosNuevas: [], fotosQuitar: [] })
    const segundo = await guardarHallazgo({
      ...base,
      severity: 'critical',
      description: 'Fuga de aceite bajo el motor',
      fotosNuevas: [], fotosQuitar: [],
    })

    expect(segundo).toEqual({ id: primero.id, creado: false })
    const hallazgos = await hallazgosDeInspeccion('ins-1')
    expect(hallazgos).toHaveLength(1)
    expect(hallazgos[0]).toMatchObject({
      id: primero.id,
      severity: 'critical',
      description: 'Fuga de aceite bajo el motor',
      clientVersion: 1,
    })
    // Sigue habiendo UNA fila por enviar, ahora con el título de la severidad nueva.
    const filas = await filasDe('finding')
    expect(filas).toHaveLength(1)
    expect(filas[0].titulo).toBe('Hallazgo · Severidad crítica')
  })

  it('si la versión anterior ya salió, la corrección viaja en una fila nueva', async () => {
    const { id } = await guardarHallazgo({ ...base, severity: 'low', description: 'Fuga', fotosNuevas: [], fotosQuitar: [] })
    await db.outbox.where('[entityType+entityId]').equals(['finding', id]).modify({ status: 'synced' })

    await guardarHallazgo({ ...base, severity: 'high', description: 'Fuga mayor', fotosNuevas: [], fotosQuitar: [] })

    const filas = await filasDe('finding')
    expect(filas.map((f) => f.status).sort()).toEqual(['pending', 'synced'])
    expect(await hallazgosDeInspeccion('ins-1')).toHaveLength(1)
  })

  it('corregir sin tomar otra foto conserva las que había', async () => {
    await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', fotosNuevas: [foto('uno')], fotosQuitar: [] })
    await guardarHallazgo({ ...base, severity: 'high', description: 'Fuga mayor', fotosNuevas: [], fotosQuitar: [] })

    const guardado = await hallazgoDeRespuesta('ins-1', 'resp-1')
    expect(guardado?.fotos).toHaveLength(1)
    expect(await db.attachments.count()).toBe(1)
    expect(await filasDe('attachment')).toHaveLength(1)
  })

  it('varias fotos nuevas se agregan a las que ya tenía, en orden (TSK-OFF-016)', async () => {
    const { id } = await guardarHallazgo({
      ...base,
      severity: 'medium',
      description: 'Fuga',
      fotosNuevas: [foto('uno'), foto('dos')],
      fotosQuitar: [],
    })
    await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', fotosNuevas: [foto('tres')], fotosQuitar: [] })

    const fotos = await fotosDeHallazgo(id)
    expect(fotos).toHaveLength(3)
    expect(await Promise.all(fotos.map((f) => f.blob.text()))).toEqual(['uno', 'dos', 'tres'])
    expect(fotos.every((f) => !f.enviada)).toBe(true)
    expect(await filasDe('attachment')).toHaveLength(3)
  })

  it('quitar una foto que no salió la borra junto con su fila de envío', async () => {
    const { id } = await guardarHallazgo({
      ...base,
      severity: 'medium',
      description: 'Fuga',
      fotosNuevas: [foto('uno'), foto('dos')],
      fotosQuitar: [],
    })
    const [primera] = await fotosDeHallazgo(id)
    await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', fotosNuevas: [], fotosQuitar: [primera.id] })

    const fotos = await fotosDeHallazgo(id)
    expect(await Promise.all(fotos.map((f) => f.blob.text()))).toEqual(['dos'])
    const filas = await filasDe('attachment')
    expect(filas.map((f) => f.entityId)).toEqual([fotos[0].id])
  })

  it('una foto ya enviada no se borra aunque se pida quitarla', async () => {
    const { id } = await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', fotosNuevas: [foto('uno')], fotosQuitar: [] })
    await db.outbox.where('entityType').equals('attachment').modify({ status: 'synced' })
    const [enviada] = await fotosDeHallazgo(id)
    expect(enviada.enviada).toBe(true)

    await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', fotosNuevas: [], fotosQuitar: [enviada.id] })

    expect(await db.attachments.count()).toBe(1)
    expect(await filasDe('attachment')).toHaveLength(1)
  })

  it('no quita fotos de otro hallazgo aunque reciba su id', async () => {
    const a = await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', fotosNuevas: [foto('a')], fotosQuitar: [] })
    const [fotoDeA] = await fotosDeHallazgo(a.id)
    await guardarHallazgo({
      ...base,
      responseId: 'resp-2',
      severity: 'low',
      description: 'Polvo',
      fotosNuevas: [],
      fotosQuitar: [fotoDeA.id],
    })

    expect(await fotosDeHallazgo(a.id)).toHaveLength(1)
  })

  it('respuestas distintas tienen hallazgos distintos', async () => {
    const a = await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', fotosNuevas: [], fotosQuitar: [] })
    const b = await guardarHallazgo({ ...base, responseId: 'resp-2', severity: 'low', description: 'Polvo', fotosNuevas: [], fotosQuitar: [] })

    expect(b.creado).toBe(true)
    expect(b.id).not.toBe(a.id)
    expect((await hallazgoDeRespuesta('ins-1', 'resp-2'))?.hallazgo.id).toBe(b.id)
    expect(await hallazgoDeRespuesta('ins-1', 'resp-3')).toBeNull()
  })
})

describe('hallazgo directo, sin pregunta (TSK-OFF-015)', () => {
  const directo = { inspectionId: 'ins-1', responseId: null, tenantId: TENANT_A, detalle: 'resumen' }

  it('cada hallazgo directo nuevo es un registro aparte', async () => {
    const a = await guardarHallazgo({ ...directo, severity: 'low', description: 'Polvo', fotosNuevas: [], fotosQuitar: [] })
    const b = await guardarHallazgo({ ...directo, severity: 'high', description: 'Cable suelto', fotosNuevas: [], fotosQuitar: [] })

    expect(a.creado && b.creado).toBe(true)
    expect((await hallazgosDirectos('ins-1')).map((h) => h.id)).toEqual([a.id, b.id])
  })

  it('corregirlo por su id actualiza el mismo registro', async () => {
    const { id } = await guardarHallazgo({ ...directo, severity: 'low', description: 'Polvo', fotosNuevas: [], fotosQuitar: [] })
    const r = await guardarHallazgo({
      ...directo,
      hallazgoId: id,
      severity: 'medium',
      description: 'Polvo en el tablero',
      fotosNuevas: [],
      fotosQuitar: [],
    })

    expect(r).toEqual({ id, creado: false })
    const lista = await hallazgosDirectos('ins-1')
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({ severity: 'medium', description: 'Polvo en el tablero', clientVersion: 1 })
    expect((await db.outbox.toArray()).filter((f) => f.entityType === 'finding')).toHaveLength(1)
  })

  it('no lista los hallazgos de una respuesta y devuelve sus fotos por id', async () => {
    await guardarHallazgo({ ...directo, responseId: 'resp-1', severity: 'high', description: 'NOK', fotosNuevas: [], fotosQuitar: [] })
    const { id } = await guardarHallazgo({
      ...directo,
      severity: 'low',
      description: 'Polvo',
      fotosNuevas: [{ blob: new Blob(['x'], { type: 'image/jpeg' }), ancho: 1, alto: 1, mime: 'image/jpeg' }],
      fotosQuitar: [],
    })

    expect((await hallazgosDirectos('ins-1')).map((h) => h.id)).toEqual([id])
    expect((await hallazgoPorId(id))?.fotos).toHaveLength(1)
    expect(await hallazgoPorId('no-existe')).toBeNull()
  })
})
