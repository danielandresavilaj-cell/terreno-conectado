/* Mapeo entre el valor tipado de un campo (FR-036) y las columnas de
 * `responses` (data-model §2.4: `value_ok`/`value_text`/`value_number`/
 * `value_json` — contrato híbrido de TSK-FORM-004):
 *  · ok/nok/na → `value_ok`        · numérico → `value_number`
 *  · texto → `value_text`
 *  · fecha/hora/select_single → `value_json` (string)
 *  · select_multiple → `value_json` (string[])
 *  · foto → `value_text` con el marcador 'capturada' y el binario en un
 *    ATTACHMENT `owner_type='response'` (FR-037)
 *
 * La validación contra `template_item.props` es previa (FR-039, en el device);
 * acá sólo se persiste/lee. Al leer se cae a las columnas legadas de los
 * borradores previos a FORM-004 (select_multiple JSON y texto en `value_text`).
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
      return row.valueText === 'capturada' ? 'capturada' : null
    case 'select_multiple': {
      if (Array.isArray(row.valueJson)) return row.valueJson
      // Legado (previo a FORM-004): select_multiple persistido en value_text.
      if (!row.valueText) return null
      try {
        const v: unknown = JSON.parse(row.valueText)
        return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : null
      } catch {
        return null
      }
    }
    case 'text':
      return row.valueText
    default:
      // date/time/select_single: value_json, con caída al value_text legado.
      if (typeof row.valueJson === 'string') return row.valueJson
      return row.valueText
  }
}

/** Columnas a persistir para un valor ya validado contra `props`. */
export function columnasDesdeValor(
  item: TemplateItem,
  valor: CampoValor,
): {
  valueOk: ResponseValor | null
  valueText: string | null
  valueNumber: number | null
  valueJson: string | string[] | null
} {
  switch (item.response_type) {
    case 'ok_nok_na':
      return {
        valueOk: esOkNokNa(valor) ? valor : null,
        valueText: null,
        valueNumber: null,
        valueJson: null,
      }
    case 'numeric':
      return {
        valueOk: null,
        valueText: null,
        valueNumber: typeof valor === 'number' ? valor : null,
        valueJson: null,
      }
    case 'select_multiple':
      return {
        valueOk: null,
        valueText: null,
        valueNumber: null,
        valueJson: Array.isArray(valor) ? valor : null,
      }
    case 'photo':
      // El binario lo persiste `guardarFotoRespuesta`; acá va solo el marcador.
      return {
        valueOk: null,
        valueText: typeof valor === 'string' && valor.length > 0 ? valor : null,
        valueNumber: null,
        valueJson: null,
      }
    case 'text':
      return {
        valueOk: null,
        valueText: typeof valor === 'string' ? valor : null,
        valueNumber: null,
        valueJson: null,
      }
    default:
      // date/time/select_single
      return {
        valueOk: null,
        valueText: null,
        valueNumber: null,
        valueJson: typeof valor === 'string' ? valor : null,
      }
  }
}
