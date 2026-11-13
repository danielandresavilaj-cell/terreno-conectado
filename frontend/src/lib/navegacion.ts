/* Navegación con historial — TSK-OFF-008.
 *
 * La pantalla activa vivía sólo en un `useState`: el botón Atrás de Android (el
 * gesto más usado en una PWA instalada) no tenía a dónde volver y sacaba al
 * trabajador de la app. Acá cada cambio de pantalla deja una entrada en el
 * historial del navegador (`#captura`, `#cola`…), y Atrás vuelve a la anterior.
 *
 * Se usa el fragmento (`#`) y no una ruta: no depende de cómo el servidor o el
 * service worker resuelvan una URL desconocida, y funciona igual sin conexión.
 *
 * Las "capas" (hallazgo, cámara, firma) no agregan entradas al historial:
 * registran cómo cerrarse y, si llega un Atrás mientras hay una abierta, se
 * cierra la de más arriba y la pantalla no cambia. Así abrir y cerrar un panel
 * cien veces no obliga a pulsar Atrás cien veces para salir.
 *
 * Este módulo no importa React ni toca el DOM al cargarse: la lógica se prueba
 * en Node (`test/navegacion.test.ts`).
 */

export const PANTALLAS = [
  'cuenta',
  'administracion',
  'plataforma',
  'formularios',
  'captura',
  'bitacora',
  'cola',
  'dashboard',
  'conflictos',
  'importar',
  /** TSK-FORM-022: el mismo asistente, empezando en el editor sin archivo. */
  'crear-formulario',
  'plantillas',
] as const

export type Pantalla = (typeof PANTALLAS)[number]

export function esPantalla(valor: unknown): valor is Pantalla {
  return typeof valor === 'string' && (PANTALLAS as readonly string[]).includes(valor)
}

/** `#captura` → `'captura'`; cualquier otra cosa → `null`. */
export function pantallaDesdeHash(hash: string): Pantalla | null {
  const limpio = hash.replace(/^#\/?/, '')
  return esPantalla(limpio) ? limpio : null
}

export function hashDePantalla(pantalla: Pantalla): string {
  return `#${pantalla}`
}

/** Pantalla que nombra una entrada del historial (su `state`, o el fragmento). */
export function pantallaDeEntrada(state: unknown, hash: string): Pantalla | null {
  if (state && typeof state === 'object' && 'pantalla' in state) {
    const p = (state as { pantalla: unknown }).pantalla
    if (esPantalla(p)) return p
  }
  return pantallaDesdeHash(hash)
}

/* ── Capas ─────────────────────────────────────────────────────────────── */

type Cerrar = () => void

const capas: Cerrar[] = []

/** Registra una capa abierta. Devuelve cómo darla de baja al cerrarse. */
export function registrarCapa(cerrar: Cerrar): () => void {
  capas.push(cerrar)
  return () => {
    const i = capas.lastIndexOf(cerrar)
    if (i >= 0) capas.splice(i, 1)
  }
}

/** Cierra la capa de más arriba. `false` si no había ninguna abierta. */
export function cerrarCapaSuperior(): boolean {
  const cerrar = capas.pop()
  if (!cerrar) return false
  cerrar()
  return true
}

export function hayCapasAbiertas(): boolean {
  return capas.length > 0
}

/* ── Historial ─────────────────────────────────────────────────────────── */

/** Lo mínimo del navegador que usa este módulo; en los tests es un doble. */
export interface HistorialNavegador {
  state: unknown
  pushState(data: unknown, unused: string, url?: string): void
  replaceState(data: unknown, unused: string, url?: string): void
}

function esGuarda(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as { guarda?: unknown }).guarda === true
}

/**
 * Prepara el historial al entrar a la app: una entrada de GUARDA y, encima, la
 * primera pantalla.
 *
 * Sin la guarda, un Atrás en la primera pantalla descarga el documento sin
 * avisar a la app: no habría oportunidad de cerrar un panel abierto (se
 * perdería el hallazgo a medio escribir) ni de pedir confirmación para salir.
 * Con ella, ese Atrás llega como un retroceso normal y la app decide.
 */
export function iniciarHistorial(historial: HistorialNavegador, pantalla: Pantalla): void {
  const url = hashDePantalla(pantalla)
  historial.replaceState({ pantalla, guarda: true }, '', url)
  historial.pushState({ pantalla }, '', url)
}

/**
 * Deja `pantalla` como entrada actual del historial.
 *
 * `reemplazar` se usa en las redirecciones por permisos: con una entrada nueva,
 * Atrás devolvería a una pantalla que el rol no puede ver y la guarda de
 * permisos lo reenviaría adelante: un Atrás que no hace nada.
 */
export function anotarPantalla(
  historial: HistorialNavegador,
  pantalla: Pantalla,
  modo: 'agregar' | 'reemplazar',
): void {
  const datos = { pantalla }
  if (modo === 'reemplazar') historial.replaceState(datos, '', hashDePantalla(pantalla))
  else historial.pushState(datos, '', hashDePantalla(pantalla))
}

export type Retroceso =
  /** Había un panel abierto: se cerró y la pantalla no cambia. */
  | { tipo: 'capa' }
  /** Se llegó a la entrada de guarda: un Atrás más cierra la app. */
  | { tipo: 'salida' }
  | { tipo: 'pantalla'; pantalla: Pantalla }
  | { tipo: 'nada' }

/**
 * Qué hacer cuando el navegador avisa que se retrocedió (o avanzó).
 *
 * Con una capa abierta el navegador ya retrocedió una entrada, así que se
 * vuelve a anotar la pantalla visible: el historial queda como estaba.
 */
export function resolverRetroceso(
  historial: HistorialNavegador,
  hash: string,
  visible: Pantalla,
): Retroceso {
  if (cerrarCapaSuperior()) {
    anotarPantalla(historial, visible, 'agregar')
    return { tipo: 'capa' }
  }
  if (esGuarda(historial.state)) return { tipo: 'salida' }
  const destino = pantallaDeEntrada(historial.state, hash)
  return destino && destino !== visible ? { tipo: 'pantalla', pantalla: destino } : { tipo: 'nada' }
}
