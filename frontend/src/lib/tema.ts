/**
 * Modo claro / oscuro — TSK-OFF-005.
 *
 * El tema vive en `data-theme` de <html> (`light` | `dark`). Al cargar, lo fija
 * `public/tema-inicial.js` ANTES del primer pintado (sin destello). Aquí se
 * cambia y se recuerda por dispositivo. Todos los colores salen de tokens CSS
 * (`index.css`), así que cambiar el atributo basta para toda la app.
 *
 * Sin elección guardada se sigue el tema del sistema (TSK-OFF-011): a pleno
 * sol muchos teléfonos ya están en claro y una pantalla clara se lee mejor. `localStorage` puede fallar (modo privado, almacenamiento bloqueado):
 * entonces el tema funciona igual durante la sesión, solo que no se recuerda.
 */
import { useSyncExternalStore } from 'react'

export type Tema = 'claro' | 'oscuro'

export const CLAVE_TEMA = 'tc-tema'
/** Color de la barra del navegador / PWA para cada tema (`<meta name="theme-color">`). */
export const COLOR_BARRA: Record<Tema, string> = { oscuro: '#0e0f11', claro: '#f5f3ef' }

/** Valor guardado → tema válido (cualquier otra cosa cae al oscuro por defecto). */
export function temaGuardado(valor: string | null | undefined): Tema {
  return valor === 'claro' ? 'claro' : 'oscuro'
}

/** Tema al abrir: lo elegido en este equipo o, si no hay elección, el del sistema. */
export function temaInicial(guardado: string | null | undefined, sistemaClaro: boolean): Tema {
  if (guardado === 'claro' || guardado === 'oscuro') return guardado
  return sistemaClaro ? 'claro' : 'oscuro'
}

export const otroTema = (t: Tema): Tema => (t === 'claro' ? 'oscuro' : 'claro')

function leer(): Tema {
  if (typeof document === 'undefined') return 'oscuro'
  return document.documentElement.dataset.theme === 'light' ? 'claro' : 'oscuro'
}

const oyentes = new Set<() => void>()

/** Aplica el tema al documento, lo recuerda y avisa a los botones montados. */
export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement
  raiz.dataset.theme = tema === 'claro' ? 'light' : 'dark'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLOR_BARRA[tema])
  try {
    localStorage.setItem(CLAVE_TEMA, tema)
  } catch {
    // Sin almacenamiento: el cambio vale para esta sesión.
  }
  oyentes.forEach((o) => o())
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente)
  return () => oyentes.delete(oyente)
}

/** Tema actual y función para alternarlo; todos los botones quedan sincronizados. */
export function useTema(): { tema: Tema; alternar: () => void } {
  const tema = useSyncExternalStore(suscribir, leer, () => 'oscuro' as Tema)
  return { tema, alternar: () => aplicarTema(otroTema(tema)) }
}
