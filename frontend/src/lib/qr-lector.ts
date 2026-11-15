/* Lectura de un cuadro de la cámara — TSK-OPS-003-C, tramo 3 (FR-061).
 *
 * `jsqr` (Apache-2.0, sin dependencias) decodifica en el teléfono. Se usa en
 * vez de `BarcodeDetector` porque Safari de iPhone no lo trae. Este módulo se
 * carga sólo al abrir el lector (import dinámico), así no pesa en el arranque.
 */
import jsQR from 'jsqr'

/** Texto del QR en un cuadro RGBA, o `null` si no hay uno legible. */
export function leerQr(datos: Uint8ClampedArray, ancho: number, alto: number): string | null {
  return jsQR(datos, ancho, alto, { inversionAttempts: 'dontInvert' })?.data ?? null
}
