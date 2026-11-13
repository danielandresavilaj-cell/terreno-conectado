import { beforeEach, describe, expect, it } from 'vitest'
import { db, guardarHallazgo, hallazgoDeRespuesta, hallazgosDeInspeccion } from '../src/lib/db'
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
    const r = await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', foto: null })

    expect(r.creado).toBe(true)
    expect(await hallazgosDeInspeccion('ins-1')).toHaveLength(1)
    expect(await filasDe('finding')).toHaveLength(1)
  })

  it('corregirlo actualiza el mismo registro en vez de crear otro', async () => {
    const primero = await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', foto: null })
    const segundo = await guardarHallazgo({
      ...base,
      severity: 'critical',
      description: 'Fuga de aceite bajo el motor',
      foto: null,
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
    const { id } = await guardarHallazgo({ ...base, severity: 'low', description: 'Fuga', foto: null })
    await db.outbox.where('[entityType+entityId]').equals(['finding', id]).modify({ status: 'synced' })

    await guardarHallazgo({ ...base, severity: 'high', description: 'Fuga mayor', foto: null })

    const filas = await filasDe('finding')
    expect(filas.map((f) => f.status).sort()).toEqual(['pending', 'synced'])
    expect(await hallazgosDeInspeccion('ins-1')).toHaveLength(1)
  })

  it('corregir sin tomar otra foto conserva la que había', async () => {
    await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', foto: foto('uno') })
    await guardarHallazgo({ ...base, severity: 'high', description: 'Fuga mayor', foto: null })

    const guardado = await hallazgoDeRespuesta('ins-1', 'resp-1')
    expect(guardado?.foto).not.toBeNull()
    expect(await db.attachments.count()).toBe(1)
    expect(await filasDe('attachment')).toHaveLength(1)
  })

  it('una foto nueva reemplaza a la anterior si ésta no había salido', async () => {
    await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', foto: foto('uno') })
    const antes = (await db.attachments.toArray())[0].id
    await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', foto: foto('dos-mayor') })

    const adjuntos = await db.attachments.toArray()
    expect(adjuntos).toHaveLength(1)
    expect(adjuntos[0].id).not.toBe(antes)
    const filas = await filasDe('attachment')
    expect(filas).toHaveLength(1)
    expect(filas[0].entityId).toBe(adjuntos[0].id)
  })

  it('una foto ya enviada no se borra: la nueva se agrega', async () => {
    await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', foto: foto('uno') })
    await db.outbox.where('entityType').equals('attachment').modify({ status: 'synced' })
    await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', foto: foto('dos') })

    expect(await db.attachments.count()).toBe(2)
    expect(await filasDe('attachment')).toHaveLength(2)
  })

  it('respuestas distintas tienen hallazgos distintos', async () => {
    const a = await guardarHallazgo({ ...base, severity: 'medium', description: 'Fuga', foto: null })
    const b = await guardarHallazgo({ ...base, responseId: 'resp-2', severity: 'low', description: 'Polvo', foto: null })

    expect(b.creado).toBe(true)
    expect(b.id).not.toBe(a.id)
    expect((await hallazgoDeRespuesta('ins-1', 'resp-2'))?.hallazgo.id).toBe(b.id)
    expect(await hallazgoDeRespuesta('ins-1', 'resp-3')).toBeNull()
  })
})
