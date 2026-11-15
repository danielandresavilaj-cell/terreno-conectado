/* Reparto de secciones en la barra inferior del teléfono — TSK-OFF-022.
 *
 * En el teléfono la navegación va abajo, al alcance del pulgar, para todos los
 * roles de empresa. Caben cinco botones cómodos en 360 px: con cinco secciones
 * o menos van todas; con más, van las cuatro que ese rol usa a diario y el
 * quinto botón, "Más", abre una hoja con el resto.
 *
 * El administrador de plataforma tiene una sola sección y no lleva barra.
 */
import type { Pantalla } from './navegacion'
import type { Rol } from './types'

export const MAX_BOTONES_BARRA = 5

/** Las cuatro secciones de uso diario por rol cuando no caben todas. */
const PRINCIPALES: Partial<Record<Rol, Pantalla[]>> = {
  supervisor: ['formularios', 'captura', 'dashboard', 'hallazgos'],
  tenant_admin: ['dashboard', 'hallazgos', 'administracion', 'plantillas'],
}

export interface RepartoBarra {
  /** Botones que se ven siempre en la barra, en el orden de `secciones`. */
  principales: Pantalla[]
  /** Secciones que van en la hoja "Más" (vacía si caben todas). */
  mas: Pantalla[]
}

/** `secciones` llega en el orden de la navegación (el de las pestañas). */
export function repartirSecciones(rol: Rol, secciones: Pantalla[]): RepartoBarra {
  if (secciones.length <= MAX_BOTONES_BARRA) return { principales: secciones, mas: [] }
  const preferidas = (PRINCIPALES[rol] ?? []).filter((p) => secciones.includes(p))
  const elegidas = new Set<Pantalla>(preferidas)
  for (const s of secciones) {
    if (elegidas.size >= MAX_BOTONES_BARRA - 1) break
    elegidas.add(s)
  }
  return {
    principales: secciones.filter((s) => elegidas.has(s)),
    mas: secciones.filter((s) => !elegidas.has(s)),
  }
}

/** ¿Lleva barra inferior? Sólo en el teléfono y con más de una sección. */
export function llevaBarraInferior(esTelefono: boolean, secciones: readonly unknown[]): boolean {
  return esTelefono && secciones.length > 1
}

/* ── Navegación por tamaño de pantalla — TSK-OFF-024 ─────────────────────
 *
 * Un solo menú que es fijo o no según el ancho:
 *  - teléfono (< 640 px): barra inferior; "Más" abre el cajón lateral;
 *  - tableta (640–1023 px): cajón que abre la hamburguesa;
 *  - escritorio (≥ 1024 px): menú lateral fijo.
 * Con una sola sección (plataforma) no hay menú.
 */
export type Ancho = 'telefono' | 'tableta' | 'escritorio'
export type ModoNavegacion = 'barra' | 'cajon' | 'lateral' | 'ninguno'

export function modoNavegacion(ancho: Ancho, nSecciones: number): ModoNavegacion {
  if (nSecciones <= 1) return 'ninguno'
  if (ancho === 'telefono') return 'barra'
  return ancho === 'tableta' ? 'cajon' : 'lateral'
}

export type TituloGrupo = 'Terreno' | 'Operación' | 'Configuración'

export interface GrupoSecciones {
  titulo: TituloGrupo
  ids: Pantalla[]
}

const GRUPO_DE: Partial<Record<Pantalla, TituloGrupo>> = {
  formularios: 'Terreno',
  captura: 'Terreno',
  bitacora: 'Terreno',
  cola: 'Terreno',
  dashboard: 'Operación',
  hallazgos: 'Operación',
  conflictos: 'Operación',
  administracion: 'Configuración',
  plantillas: 'Configuración',
  activos: 'Configuración',
  importar: 'Configuración',
}

const ORDEN_GRUPOS: TituloGrupo[] = ['Terreno', 'Operación', 'Configuración']

/**
 * Agrupa las secciones (en su orden de navegación) para el menú lateral. Para
 * el trabajador "Hallazgos" es parte de su terreno (los que le asignaron); para
 * supervisión y administración es operación. Los grupos vacíos se omiten; una
 * sección sin grupo conocido (p. ej. plataforma) va al final, en "Operación".
 */
export function agruparSecciones(rol: Rol, secciones: readonly Pantalla[]): GrupoSecciones[] {
  const grupoDe = (id: Pantalla): TituloGrupo =>
    id === 'hallazgos' && rol === 'field_worker' ? 'Terreno' : (GRUPO_DE[id] ?? 'Operación')
  return ORDEN_GRUPOS.map((titulo) => ({ titulo, ids: secciones.filter((s) => grupoDe(s) === titulo) })).filter(
    (g) => g.ids.length > 0,
  )
}
