/* Mapeo entre el valor tipado de un campo (FR-036) y las columnas de
 * `responses` (data-model §2.4: `value_ok`/`value_text`/`value_number`).
 *
 * El contrato híbrido `value_json` llega con TSK-FORM-004; hasta entonces
 * cada tipo se persiste en la columna natural:
 *  · ok/nok/na → `value_ok`      · numérico → `value_number`
 *  · texto/fecha/hora/selects → `value_text` (select_multiple como JSON)
 *  · foto → `value_text` con el marcador y el binario en `valuePhoto`
 *    (local; la subida como ATTACHMENT es TSK-FORM-004).
 *
 * El módulo de sync NO cambia: sigue leyendo las tres columnas de siempre.
 */

import type { CampoValor, TemplateDefinition, TemplateItem } from '@terreno/shared'
import type { ResponseRow, ResponseValor } from './db'

/** Ítems planos de una definición, en orden de render (secciones → ítems). */
export function itemsDe(def: TemplateDefinition): TemplateItem[] {
  return def.sections.flatMap((s) => s.items)
}

/** ¿El valor es una de las tres opciones ok/nok/na? */
export function esOkNokNa(valor: CampoValor | null | undefined): valor is ResponseValor {
  return valor === 'ok' || valor === 'nok' || valor === 'na'
}

/** ¿El campo cuenta como contestado para el progreso? (vacío = no). */
export function contestado(campo: CampoValor | null | undefined): boolean {
  if (campo === null || campo === undefined) return false
  if (Array.isArray(campo)) return campo.length > 0
  if (typeof campo === 'string') return campo.length > 0
  return true
}

/** Restaura el valor de un ítem desde la fila local del borrador. */
export function valorDesdeColumnas(item: TemplateItem, row: ResponseRow): CampoValor | null {
  switch (item.response_type) {
    case 'ok_nok_na':
      return row.valueOk
    case 'numeric':
      return row.valueNumber
    case 'photo':
      return row.valuePhoto ? (row.valueText ?? 'capturada') : null
    case 'select_multiple': {
      if (!row.valueText) return null
      try {
        const v: unknown = JSON.parse(row.valueText)
        return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : null
      } catch {
        return null
      }
    }
    default:
      return row.valueText
  }
}

/** Columnas a persistir para un valor ya validado contra `props`. */
export function columnasDesdeValor(
  item: TemplateItem,
  valor: CampoValor,
): { valueOk: ResponseValor | null; valueText: string | null; valueNumber: number | null } {
  switch (item.response_type) {
    case 'ok_nok_na':
      return { valueOk: esOkNokNa(valor) ? valor : null, valueText: null, valueNumber: null }
    case 'numeric':
      return { valueOk: null, valueText: null, valueNumber: typeof valor === 'number' ? valor : null }
    case 'select_multiple':
      return {
        valueOk: null,
        valueText: Array.isArray(valor) ? JSON.stringify(valor) : null,
        valueNumber: null,
      }
    default:
      return {
        valueOk: null,
        valueText: typeof valor === 'string' ? valor : null,
        valueNumber: null,
      }
  }
}
