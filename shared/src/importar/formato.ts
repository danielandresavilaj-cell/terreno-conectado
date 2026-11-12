/**
 * Formato de un archivo de plantilla por su FIRMA de bytes — TSK-FORM-020.
 *
 * El MIME que manda el navegador depende del sistema operativo (un `.docx` en
 * Windows sin Office llega como `application/octet-stream`) y la extensión la
 * escribe cualquiera; los primeros bytes no mienten:
 * - PDF: empieza con `%PDF-`.
 * - `.xlsx` y `.docx` son ZIP (`PK\x03\x04`); se distinguen por la parte que
 *   traen: `xl/workbook.xml` o `word/document.xml`. Los nombres de las partes
 *   van en ASCII dentro del ZIP, así que basta buscarlos.
 * - JPEG (`FF D8 FF`) y PNG (`89 50 4E 47 0D 0A 1A 0A`): fotos de pautas en
 *   papel; sólo las lee el motor de IA (TSK-FORM-021).
 */
import type { FormatoImport } from '../xlsx/types'

export const MIME_POR_FORMATO: Record<FormatoImport, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
}

/** Tope por formato: un PDF trae fuentes e imágenes y pesa más. */
export const TOPE_BYTES_POR_FORMATO: Record<FormatoImport, number> = {
  xlsx: 5 * 1024 * 1024,
  docx: 5 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  // La API de Claude acepta imágenes de hasta 5 MB; el asistente ya las comprime.
  jpg: 5 * 1024 * 1024,
  png: 5 * 1024 * 1024,
}

/** Formatos que sólo puede leer el motor de IA (no hay reglas para fotos). */
export const FORMATOS_SOLO_IA: readonly FormatoImport[] = ['jpg', 'png']
/** Formatos que acepta el motor de IA (el `.xlsx` se queda con las reglas). */
export const FORMATOS_IA: readonly FormatoImport[] = ['pdf', 'docx', 'jpg', 'png']

function contiene(bytes: Uint8Array, texto: string): boolean {
  const aguja = Array.from(texto, (c) => c.charCodeAt(0))
  outer: for (let i = 0; i <= bytes.length - aguja.length; i++) {
    for (let j = 0; j < aguja.length; j++) if (bytes[i + j] !== aguja[j]) continue outer
    return true
  }
  return false
}

export function detectarFormato(bytes: Uint8Array): FormatoImport | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-') return 'pdf'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= 8 && PNG.every((b, i) => bytes[i] === b)) return 'png'
  const esZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  if (!esZip) return null
  if (contiene(bytes, 'word/document.xml')) return 'docx'
  if (contiene(bytes, 'xl/workbook.xml')) return 'xlsx'
  return null
}
