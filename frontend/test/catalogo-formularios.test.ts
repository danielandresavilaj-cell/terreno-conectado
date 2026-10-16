import { beforeEach, expect, it, vi } from 'vitest'
import { db, guardarPlantillasCache } from '../src/lib/db'
import { actualizarCatalogo, leerCatalogo } from '../src/lib/catalogo-formularios'
import { getPlantillas, getToken } from '../src/lib/api'
import { publicada, TENANT_A, uuid } from './fixtures'

vi.mock('../src/lib/api', () => ({ getPlantillas: vi.fn(), getToken: vi.fn() }))
const trabajador = { tenantId: TENANT_A, id: uuid(20), rol: 'field_worker' as const, faenaId: uuid(30) }
const admin = { ...trabajador, id: uuid(21), rol: 'tenant_admin' as const }
const asignada = publicada()
const otra = publicada({ revision_id: uuid(12) })

beforeEach(async () => {
  await db.delete()
  await db.open()
  vi.resetAllMocks()
  vi.mocked(getToken).mockReturnValue('token-de-prueba')
})

it('no hereda el catálogo del admin ni la caché legada por tenant', async () => {
  await guardarPlantillasCache([asignada, otra])
  expect(await leerCatalogo(trabajador)).toEqual([])
  vi.mocked(getPlantillas).mockResolvedValueOnce({ items: [asignada, otra], latest_seq: 9 })
  await actualizarCatalogo(admin)
  vi.mocked(getPlantillas).mockResolvedValueOnce({ items: [asignada], latest_seq: 1 })
  expect((await actualizarCatalogo(trabajador)).items).toEqual([asignada])
  expect(await leerCatalogo(trabajador)).toHaveLength(1)
  expect(await leerCatalogo({ ...trabajador, id: uuid(22) })).toEqual([])
  expect(await leerCatalogo({ ...trabajador, rol: 'supervisor' })).toEqual([])
  expect(await leerCatalogo({ ...trabajador, faenaId: uuid(31) })).toEqual([])
  expect(getPlantillas).toHaveBeenLastCalledWith(undefined, trabajador.faenaId)
})

it('reconcilia asignaciones de revisiones antiguas y desasignaciones, incluso catálogo vacío', async () => {
  vi.mocked(getPlantillas).mockResolvedValueOnce({ items: [otra], latest_seq: 9 })
  await actualizarCatalogo(trabajador)
  vi.mocked(getPlantillas).mockResolvedValueOnce({ items: [asignada], latest_seq: 1 })
  await actualizarCatalogo(trabajador)
  expect((await leerCatalogo(trabajador)).map((i) => i.revision_id)).toEqual([asignada.revision_id])
  vi.mocked(getPlantillas).mockResolvedValueOnce({ items: [], latest_seq: 0 })
  await actualizarCatalogo(trabajador)
  expect(await leerCatalogo(trabajador)).toEqual([])
  // Las definiciones históricas no se borran ni se modifica el outbox.
  expect(await db.plantillas.count()).toBe(2)
})

it('sin conexión conserva únicamente el catálogo validado del trabajador', async () => {
  vi.mocked(getPlantillas).mockResolvedValueOnce({ items: [asignada], latest_seq: 1 })
  await actualizarCatalogo(trabajador)
  vi.mocked(getPlantillas).mockRejectedValue(new Error('offline'))
  expect((await actualizarCatalogo(trabajador)).items).toHaveLength(1)
  expect((await actualizarCatalogo(admin)).items).toEqual([])
  vi.mocked(getToken).mockReturnValue(null)
  expect((await actualizarCatalogo(trabajador)).enRed).toBe(false)
})

it('un fallo al persistir no publica un snapshot incompleto', async () => {
  vi.mocked(getPlantillas).mockResolvedValueOnce({ items: [asignada], latest_seq: 1 })
  await actualizarCatalogo(trabajador)
  vi.mocked(getPlantillas).mockResolvedValueOnce({ items: [otra], latest_seq: 2 })
  const put = vi.spyOn(db.meta, 'put').mockRejectedValueOnce(new Error('cuota agotada'))
  expect((await actualizarCatalogo(trabajador)).enRed).toBe(false)
  put.mockRestore()
  expect((await leerCatalogo(trabajador)).map((i) => i.revision_id)).toEqual([asignada.revision_id])
  expect(await db.plantillas.get(otra.revision_id)).toBeUndefined()
})
