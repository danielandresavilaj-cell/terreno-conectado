/* Cuota de almacenamiento local — FR-017.
 *
 * SI el almacenamiento local supera el 80 % de la cuota estimada, ENTONCES se
 * advierte al trabajador y se prioriza la subida de fotos ya sincronizables.
 *
 * La estimación sale de la Storage API (`navigator.storage.estimate()`), que
 * devuelve `usage`/`quota` del origen. No todos los navegadores la exponen
 * (IE/WebView viejos): cuando falta, `disponible = false` y la UI no inventa un
 * porcentaje — mostrar una cuota falsa sería peor que no mostrar ninguna.
 *
 * El módulo es puro y sin dependencias de Dexie para poder probarlo en Node
 * (los tests del frontend corren sin DOM): la parte que toca la base vive en
 * `db.ts` (`contadorFotosPendientes`, `sincronizables` priorizado).
 */

/** Umbral de aviso (FR-017): sobre este porcentaje se advierte y se prioriza. */
export const UMBRAL_CUOTA_PCT = 80

export interface EstimacionCuota {
  /** ¿El navegador expone `navigator.storage.estimate()`? */
  disponible: boolean
  /** Bytes usados por el origen; null si no se pudo estimar. */
  usoBytes: number | null
  /** Cuota total estimada; null si no se pudo estimar. */
  cuotaBytes: number | null
  /** Uso como porcentaje entero [0..100]; null si no se pudo estimar. */
  usadaPct: number | null
}

interface StorageLike {
  estimate?: () => Promise<{ usage?: number; quota?: number }>
}

/**
 * Estima la cuota del origen. Nunca lanza: si la API no está o falla, devuelve
 * `disponible: false`. `nav` es inyectable para las pruebas.
 */
export async function estimarCuota(
  nav: StorageLike | undefined = typeof navigator === 'undefined' ? undefined : (navigator as StorageLike),
): Promise<EstimacionCuota> {
  const sinDatos: EstimacionCuota = { disponible: false, usoBytes: null, cuotaBytes: null, usadaPct: null }
  if (!nav?.estimate) return sinDatos
  try {
    const { usage, quota } = await nav.estimate()
    if (typeof usage !== 'number' || typeof quota !== 'number' || quota <= 0) return sinDatos
    return {
      disponible: true,
      usoBytes: usage,
      cuotaBytes: quota,
      usadaPct: Math.min(100, Math.round((usage / quota) * 100)),
    }
  } catch {
    return sinDatos
  }
}

/** ¿El uso supera el umbral de aviso (FR-017)? Sin dato no se avisa (no se inventa). */
export function cuotaEsAlta(usadaPct: number | null): boolean {
  return usadaPct !== null && usadaPct >= UMBRAL_CUOTA_PCT
}
