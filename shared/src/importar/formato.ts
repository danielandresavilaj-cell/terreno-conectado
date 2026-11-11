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
 */
import type { FormatoImport } from '../xlsx/types'

export const MIME_POR_FORMATO: Record<FormatoImport, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
}

/** Tope por formato: un PDF trae fuentes e imágenes y pesa más. */
export const TOPE_BYTES_POR_FORMATO: Record<FormatoImport, number> = {
  xlsx: 5 * 1024 * 1024,
  docx: 5 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
}

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
  const esZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  if (!esZip) return null
  if (contiene(bytes, 'word/document.xml')) return 'docx'
  if (contiene(bytes, 'xl/workbook.xml')) return 'xlsx'
  return null
}
