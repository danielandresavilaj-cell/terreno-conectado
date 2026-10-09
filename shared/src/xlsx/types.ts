/**
 * Tipos del importador `.xlsx` — módulo 007 (TSK-FORM-005, FR-029).
 *
 * `proposed_schema` = mapeo columnas→ítems que el backend persiste en
 * `TEMPLATE_IMPORT.proposed_schema` (data-model §2.2): cada ítem propuesto
 * lleva su `ImportSourceOrigin` (hoja + celda) para que el export rellene el
 * documento original (TSK-FORM-010, FR-019/044).
 */
import type { FieldProps, ResponseType } from '../templates'

/** Dónde vive el ítem en el `.xlsx` de origen (para el export rellenado). */
export interface ImportSourceOrigin {
  /** Nombre de la hoja (sección). */
  sheet: string
  /** Letra de columna (p. ej. `B`). */
  column: string
  /** Celda del encabezado (p. ej. `B2`). */
  headerCell: string
  /** Fila del encabezado, 1-based. */
  headerRow: number
  /** Primer fila de datos, 1-based. */
  firstDataRow: number
}

/** Ítem propuesto por el parser (columna del `.xlsx`). */
export interface ProposedItem {
  prompt: string
  response_type: ResponseType
  required: boolean
  props: FieldProps
  source: ImportSourceOrigin
  /** Conteo por valor (select_*, ok_nok_na) — para el preview (TSK-FORM-006). */
  opcionesConteo: Record<string, number>
  /** Primeras celdas no vacías, para el preview. */
  muestra: string[]
  filasConDato: number
}

/** Sección propuesta (hoja del `.xlsx`). */
export interface ProposedSection {
  titulo: string
  items: ProposedItem[]
}

/** Propuesta determinística de plantilla desde un `.xlsx` estructurado. */
export interface TemplateImportProposal {
  nombre_archivo: string
  secciones: ProposedSection[]
  resumen: { secciones: number; items: number; filasDatos: number }
}

export type ParseResult =
  | { ok: true; propuesta: TemplateImportProposal }
  | { ok: false; error: string }