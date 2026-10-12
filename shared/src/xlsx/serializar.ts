/**
 * Serialización del valor capturado a celda del libro — TSK-FORM-010 (FR-019/044).
 *
 * Vive en `shared/` y no en el cliente **a propósito**: FR-044 exige que el
 * servidor produzca el mismo artefacto que el dispositivo, y la única forma de
 * garantizarlo sin compararlos a mano es que ejecuten el mismo código (ADR-003
 * d5: el módulo corre igual en el Web Worker y en Node).
 *
 * PURE y sin dependencias: es el paso donde un error escribe basura en el
 * documento del cliente, así que va testeado por separado del resto.
 */
import type { CampoValor, TemplateItem } from '../templates'
import type { RespuestaRellenable } from './rellenar'

/** Lo que se escribe en la celda de un ítem `photo`. */
export const INDICADOR_EVIDENCIA = 'Sí (hoja Evidencias)'

/**
 * `ok_nok_na` en la convención del libro: `proponerImport` reconoce
 * `ok/nok/na/n/a` en minúsculas y sin punto (`esOkNokNa`, `import.ts`), así que
 * `OK`/`NOK`/`N/A` vuelven a detectarse igual al releer el libro exportado y son
 * las etiquetas que el trabajador ya ve en la pantalla.
 */
const OK_NOK_NA_CELDA = {
  ok: 'OK',
  nok: 'NOK',
  na: 'N/A',
} as const

/** `YYYY-MM-DD`: el formato con el que el parser vuelve a reconocer la celda. */
const RE_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/
/** `HH:MM` o `HH:MM:SS`: lo que valida `validateValorCampo` para `time`. */
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
/**
 * Separador de `select_multiple`: el punto y coma es el que usa la convención
 * del importador (`opcionesDeMulti`, que parte por `';'` y recorta), así que el
 * texto exportado se vuelve a leer como lista múltiple si alguien lo reimporta.
 */
const SEPARADOR_MULTI = '; '

/** ¿El campo cuenta como contestado? Vacío, `''` o `[]` NO es respuesta. */
export function contestado(campo: CampoValor | null | undefined): boolean {
  if (campo === null || campo === undefined) return false
  if (Array.isArray(campo)) return campo.length > 0
  if (typeof campo === 'string') return campo.length > 0
  return true
}

/**
 * Convierte el valor capturado al contenido de la celda, según el `response_type`.
 *
 * Regla general: si el valor no tiene la forma que el tipo declara, devuelve
 * `null` (no se escribe). Escribir "algo" en una celda cuyo tipo no corresponde
 * es peor que dejar la celda como estaba: el documento original va firmado por la
 * faena y una celda basura no se distingue de una respuesta.
 */
export function serializarValorCampo(
  item: TemplateItem,
  valor: CampoValor | null | undefined,
): string | number | null {
  if (valor === null || valor === undefined) return null

  switch (item.response_type) {
    // `switch` y no `in OK_NOK_NA_CELDA`: `in` también encuentra lo heredado del
    // prototipo (`'toString' in {}` es `true`) y una respuesta cualquiera
    // terminaría escribiendo una función en la celda.
    case 'ok_nok_na':
      if (valor === 'ok') return OK_NOK_NA_CELDA.ok
      if (valor === 'nok') return OK_NOK_NA_CELDA.nok
      if (valor === 'na') return OK_NOK_NA_CELDA.na
      return null
    case 'numeric':
      // Número de verdad, no texto: la columna del original puede tener formato
      // numérico y sus fórmulas siguen sirviendo.
      return typeof valor === 'number' && Number.isFinite(valor) ? valor : null
    case 'text':
      return typeof valor === 'string' && valor.trim() !== '' ? valor : null
    case 'date':
      return typeof valor === 'string' && RE_FECHA_ISO.test(valor) ? valor : null
    case 'time':
      return typeof valor === 'string' && RE_HORA.test(valor) ? valor : null
    case 'select_single':
      // La opción tal cual: son los valores del catálogo de la plantilla, que es
      // el mismo que el libro propone.
      return typeof valor === 'string' && valor !== '' ? valor : null
    case 'select_multiple':
      return Array.isArray(valor) && valor.length > 0 && valor.every((v) => typeof v === 'string')
        ? valor.join(SEPARADOR_MULTI)
        : null
    case 'photo':
      // La referencia, nunca los bytes (FR-019/037): la imagen va en la hoja
      // "Evidencias" y la celda sólo dice que la hay.
      return typeof valor === 'string' && valor !== '' ? INDICADOR_EVIDENCIA : null
  }
}
/** Respuestas y omisiones listas para `rellenarOriginal`. */
export interface RellenoPreparado {
  respuestas: RespuestaRellenable[]
  /**
   * Ítems que sí se respondieron pero que NO se pudieron serializar a la celda
   * (el tipo guardado no corresponde al del ítem). Se omiten en vez de escribir
   * un valor dudoso en el documento, y se devuelven para que quien exporta lo
   * diga (en el dispositivo, en la UI; en el servidor, en la respuesta).
   */
  omitidas: string[]
}

/**
 * Respuestas capturadas → array para `rellenarOriginal`, en el orden de los
 * ítems (que es el orden en que `rellenarOriginal` empareja con el libro).
 *
 * Vive aquí y no en el cliente por el mismo motivo que la serialización: el
 * servidor parte de `inspection_response` y tiene que aplicar exactamente el
 * mismo criterio (qué cuenta como contestado, qué se omite).
 */
export function construirRespuestas(
  items: TemplateItem[],
  respuestas: Record<string, CampoValor | null | undefined>,
): RellenoPreparado {
  const rellenables: RespuestaRellenable[] = []
  const omitidas: string[] = []

  for (const item of items) {
    const valor = respuestas[item.id]
    // Vacío, `''` o `[]` NO es una respuesta (mismo criterio que la barra de
    // progreso), así que no cuenta como omitida: no hubo nada que serializar.
    if (!valor || !contestado(valor)) continue
    const celda = serializarValorCampo(item, valor)
    if (celda === null) {
      omitidas.push(item.id)
      continue
    }
    rellenables.push({ itemId: item.id, valor: celda })
  }

  return { respuestas: rellenables, omitidas }
}
