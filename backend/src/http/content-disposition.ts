/**
 * Utilidades de respuesta HTTP compartidas entre módulos.
 *
 * Vive acá (y no en el controlador que la usó primero) porque la descarga del
 * `.xlsx` original (TSK-FORM-009) y la del `.xlsx` rellenado (TSK-FORM-010)
 * necesitan exactamente la misma cabecera: dos copias drifting de una función de
 * cinco líneas es la forma más corta de que un nombre de archivo con acentos
 * funcione en un endpoint y se pierda en el otro.
 */

/**
 * `Content-Disposition` con `filename` ASCII de reserva y `filename*` UTF-8.
 *
 * El nombre viene del archivo que subió el `tenant_admin` (puede traer acentos)
 * y un header HTTP sólo transporta latin1. Se sanean comillas y saltos de línea
 * para que el valor no pueda inyectar cabeceras.
 */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}
