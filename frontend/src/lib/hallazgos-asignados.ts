/**
 * TSK-DOM-008 (FR-067) — "Hallazgos": los que me asignaron, también sin señal.
 *
 * Mismo patrón que el catálogo de formularios (`catalogo-formularios.ts`): la
 * lista se pide cuando hay red y se guarda en `db.meta` por empresa y cuenta.
 * Sin red se muestra la última que llegó. Un dispositivo compartido no mezcla
 * los hallazgos de dos personas.
 *
 * "Nuevo" = asignado y todavía no abierto por la persona. Se recuerda el
 * `assigned_at` que vio: si se lo reasignan de nuevo más tarde, vuelve a ser
 * nuevo. Los resueltos nunca cuentan como nuevos.
 *
 * Empezar y reportar van directo al servidor (`PATCH /findings/:id/avance`), no
 * por la cola de sync: necesitan señal. Lo que la persona escribe sin señal
 * queda como borrador en este teléfono hasta que lo pueda enviar.
 */
import type { HallazgoAsignadoDto } from '@terreno/shared'
import { getHallazgosAsignados, getToken } from './api'
import { db } from './db'

export interface AmbitoAsignados {
  tenantId: string
  id: string
}

const clave = (prefijo: string, a: AmbitoAsignados, ...resto: string[]) =>
  `${prefijo}:${JSON.stringify([a.tenantId, a.id, ...resto])}`

async function leerJson<T>(key: string, vacio: T): Promise<T> {
  const row = await db.meta.get(key)
  if (typeof row?.value !== 'string') return vacio
  try {
    return JSON.parse(row.value) as T
  } catch {
    return vacio
  }
}

async function guardarJson(key: string, valor: unknown): Promise<void> {
  await db.meta.put({ key, value: JSON.stringify(valor) })
}

/** La última lista que llegó del servidor para esta cuenta (o vacía). */
export function leerAsignados(a: AmbitoAsignados): Promise<HallazgoAsignadoDto[]> {
  return leerJson<HallazgoAsignadoDto[]>(clave('tc_hallazgos_asignados', a), [])
}

/** Pide la lista al servidor y la guarda; sin red, conserva la anterior. */
export async function actualizarAsignados(
  a: AmbitoAsignados,
  traer: () => Promise<HallazgoAsignadoDto[]> = getHallazgosAsignados,
): Promise<{ items: HallazgoAsignadoDto[]; enRed: boolean }> {
  const anteriores = await leerAsignados(a)
  if (!getToken()) return { items: anteriores, enRed: false }
  try {
    const items = await traer()
    await guardarJson(clave('tc_hallazgos_asignados', a), items)
    return { items, enRed: true }
  } catch {
    return { items: anteriores, enRed: false }
  }
}

/** id del hallazgo → `assigned_at` que la persona ya vio. */
export type VistosAsignados = Record<string, string>

export function leerVistos(a: AmbitoAsignados): Promise<VistosAsignados> {
  return leerJson<VistosAsignados>(clave('tc_hallazgos_vistos', a), {})
}

/** Marca como visto y olvida los que ya no están en la lista. */
export async function marcarVisto(
  a: AmbitoAsignados,
  hallazgo: Pick<HallazgoAsignadoDto, 'id' | 'assigned_at'>,
  lista: readonly Pick<HallazgoAsignadoDto, 'id'>[],
): Promise<VistosAsignados> {
  const vigentes = new Set(lista.map((h) => h.id))
  const previos = await leerVistos(a)
  const vistos: VistosAsignados = {}
  for (const [id, cuando] of Object.entries(previos)) if (vigentes.has(id)) vistos[id] = cuando
  vistos[hallazgo.id] = hallazgo.assigned_at
  await guardarJson(clave('tc_hallazgos_vistos', a), vistos)
  return vistos
}

export function esNuevo(h: Pick<HallazgoAsignadoDto, 'id' | 'assigned_at' | 'status'>, vistos: VistosAsignados): boolean {
  return h.status !== 'resolved' && vistos[h.id] !== h.assigned_at
}

export function contarNuevos(
  lista: readonly Pick<HallazgoAsignadoDto, 'id' | 'assigned_at' | 'status'>[],
  vistos: VistosAsignados,
): number {
  return lista.filter((h) => esNuevo(h, vistos)).length
}

export type EstadoAsignado = 'nuevo' | 'pendiente' | 'en-curso' | 'listo' | 'resuelto'

/** Lo que la persona lee en la tarjeta. "Listo para revisar" = en curso y reportado. */
export function estadoAsignado(
  h: Pick<HallazgoAsignadoDto, 'id' | 'assigned_at' | 'status' | 'reported_at'>,
  vistos: VistosAsignados,
): EstadoAsignado {
  if (h.status === 'resolved') return 'resuelto'
  if (h.status === 'in_progress') return h.reported_at ? 'listo' : 'en-curso'
  return esNuevo(h, vistos) ? 'nuevo' : 'pendiente'
}

/** Borrador del reporte escrito sin señal (por hallazgo y cuenta). */
export async function leerBorradorReporte(a: AmbitoAsignados, hallazgoId: string): Promise<string> {
  const row = await db.meta.get(clave('tc_hallazgo_reporte', a, hallazgoId))
  return typeof row?.value === 'string' ? row.value : ''
}

export async function guardarBorradorReporte(a: AmbitoAsignados, hallazgoId: string, texto: string): Promise<void> {
  const key = clave('tc_hallazgo_reporte', a, hallazgoId)
  if (texto.trim()) await db.meta.put({ key, value: texto })
  else await db.meta.delete(key)
}
