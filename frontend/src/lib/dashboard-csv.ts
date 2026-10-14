import type { FindingDto } from '@terreno/shared'

/**
 * FR-042: CSV del listado de hallazgos de la vista del supervisor.
 *
 * Se aísla de la pantalla para poder probarlo sin DOM ni Dexie: el armado del
 * CSV es una función pura sobre el mismo `FindingDto` que ya pinta la tabla, y
 * el escapado (comillas envolventes + duplicado de comillas internas) es lo que
 * evita que una descripción con `"` o `,` corrompa las columnas.
 */

export const CABECERAS_CSV_HALLAZGOS = [
  'id',
  'severidad',
  'estado',
  'faena',
  'autor',
  'capturado_at',
] as const

/** Celda CSV: siempre entre comillas, con las comillas internas duplicadas. */
function celda(valor: string | null | undefined): string {
  return `"${(valor ?? '').replace(/"/g, '""')}"`
}

/** Convierte los hallazgos filtrados en el CSV que se descarga. */
export function construirCsvHallazgos(hallazgos: FindingDto[]): string {
  const filas: string[][] = [
    [...CABECERAS_CSV_HALLAZGOS],
    ...hallazgos.map((h) => [
      h.id,
      h.severity,
      h.status,
      h.faena_nombre ?? '',
      h.autor ?? '',
      h.captured_at,
    ]),
  ]
  return filas.map((r) => r.map(celda).join(',')).join('\n')
}
