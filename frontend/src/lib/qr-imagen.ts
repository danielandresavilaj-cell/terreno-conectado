/* QR como imagen — TSK-OPS-003-C, tramo 3 (FR-060/061).
 *
 * `matrizQr` genera la matriz de módulos con `qrcode-generator` (MIT, sin
 * dependencias). La pantalla Activos la dibuja como SVG en React (sin
 * `innerHTML`) para verla e imprimirla. Ver `research.md` §6.
 */
import qrcode from 'qrcode-generator'

/** Matriz de módulos (true = oscuro). Corrección de errores M: tolera manchas. */
export function matrizQr(texto: string): boolean[][] {
  const qr = qrcode(0, 'M')
  qr.addData(texto)
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, fila) => Array.from({ length: n }, (_, col) => qr.isDark(fila, col)))
}
