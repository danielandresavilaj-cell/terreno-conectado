/* Lógica pura de la sincronización de plantillas — TSK-FORM-009 (FR-018/027/028).
 *
 * Vive fuera del store a propósito: `store.tsx` es un componente de React con
 * `useCallback`, y la lógica que decide el cursor del delta, la plantilla activa
 * y la purga del caché tiene que poder probarse sin DOM (ver `vitest.config.ts`).
 * Ninguna función de acá toca red, reloj ni IndexedDB: reciben el estado y
 * devuelven el siguiente estado, y el store decide cuándo persistirlo.
 *
 * Los tipos salen de `@terreno/shared` (fuente única del contrato, ADR-003).
 */

import type { TemplateOriginalMeta, TemplatePublicadaDto } from '@terreno/shared'

/* ── Delta (FR-027) ───────────────────────────────────────────────────────── */

/**
 * Orden canónico del caché: `published_seq` descendente y, a igual secuencia,
 * `version` y `revision_id` para que el orden sea estable entre sincronizaciones
 * (dos pasadas sobre el mismo conjunto deben dar la misma lista).
 */
function compararPorSecuencia(
  a: TemplatePublicadaDto,
  b: TemplatePublicadaDto,
): number {
  return (
    b.published_seq - a.published_seq ||
    b.version - a.version ||
    a.revision_id.localeCompare(b.revision_id)
  )
}

/**
 * Merge del delta recibido sobre la caché local, por `revision_id`.
 *
 * La red pisa a la caché sin condiciones: una revisión publicada es inmutable
 * (FR-007/FR-049), así que el mismo `revision_id` trae siempre la misma
 * definición y descartar lo local sólo perdería datos si el delta venía
 * incompleto — y de eso se encarga el cursor, no este merge.
 */
export function fusionarDelta(
  cache: readonly TemplatePublicadaDto[],
  items: readonly TemplatePublicadaDto[],
): TemplatePublicadaDto[] {
  if (items.length === 0) return [...cache].sort(compararPorSecuencia)
  const porRevision = new Map<string, TemplatePublicadaDto>()
  for (const i of cache) porRevision.set(i.revision_id, i)
  for (const i of items) porRevision.set(i.revision_id, i)
  return [...porRevision.values()].sort(compararPorSecuencia)
}

export interface ResultadoCursor {
  /** Umbral que viaja como `since` en la petición. */
  since: number | null
  /** Cursor a persistir tras integrar el delta; `null` = todavía no hay cursor. */
  cursor: number | null
}

/**
 * Cursor del delta (FR-027).
 *
 * `since` es SIEMPRE el cursor persistido. El bug que motiva esta función era
 * calcular el umbral con `Math.max(items.map(i => i.version))`: `version` es POR
 * PLANTILLA (max+1 dentro de su `template_id`), así que un umbral global la
 * saltaba — con la plantilla A en v9 y la B en v3, `since=9` impedía que la v4 de
 * B llegara nunca al dispositivo. `published_seq` sí es monotónica global.
 *
 * `completo=false` modela el corte a mitad de la integración (caos #8 del
 * `test-plan.md`): el cursor NO avanza para que la próxima sincronización repita
 * el mismo delta. Jamás retrocede en ningún caso.
 */
export function cursorDesdeGuardado(
  cursorGuardado: number | null,
  items: readonly TemplatePublicadaDto[],
  latestSeq: number | null,
  completo = true,
): ResultadoCursor {
  const since = cursorGuardado
  if (!completo) return { since, cursor: cursorGuardado }
  const maxSeqItems = items.reduce((m, i) => Math.max(m, i.published_seq), 0)
  const objetivo = Math.max(latestSeq ?? 0, maxSeqItems)
  if (objetivo === 0 && cursorGuardado === null) return { since, cursor: null }
  return { since, cursor: Math.max(cursorGuardado ?? 0, objetivo) }
}

/* ── Resolución de la plantilla activa (FR-028) ───────────────────────────── */

/**
 * Marco congelado del borrador en curso. `templateRevisionId` es `null` en los
 * borradores anteriores a TSK-FORM-009: ahí el congelado era por
 * `template_id` + `version`, y sigue siendo válido como respaldo.
 */
export interface MarcoBorrador {
  templateId: string
  templateVersion: number
  templateRevisionId: string | null
}

export type ResolucionPlantilla =
  | { estado: 'ok'; revision: TemplatePublicadaDto }
  /** Hay borrador congelado y su revisión no está disponible (FR-028). */
  | { estado: 'no-disponible'; marco: MarcoBorrador }
  | { estado: 'sin-plantillas' }

/**
 * Qué plantilla renderiza la captura.
 *
 * Con borrador en curso manda SIEMPRE su revisión congelada (FR-028/FR-038): si
 * esa revisión no se puede resolver se devuelve `'no-disponible'` y la UI lo
 * dice. Reencuadrar en silencio a la de mayor versión dejaría al trabajador
 * respondiendo un ítem que no es el que estaba leyendo cuando abrió el turno.
 *
 * Sin borrador: la de mayor `published_seq` (la última publicada), con desempate
 * determinista por `version` y `revision_id`.
 */
export function elegirPlantillaActiva(
  items: readonly TemplatePublicadaDto[],
  borrador: MarcoBorrador | null,
  revisionPreferida?: string | null,
): ResolucionPlantilla {
  if (borrador) {
    if (borrador.templateRevisionId) {
      const exacta = items.find((i) => i.revision_id === borrador.templateRevisionId)
      return exacta ? { estado: 'ok', revision: exacta } : { estado: 'no-disponible', marco: borrador }
    }
    const porMarco = items.find(
      (i) => i.template_id === borrador.templateId && i.version === borrador.templateVersion,
    )
    if (porMarco) return { estado: 'ok', revision: porMarco }
    // Sin caché ninguna hay nada que renderizar: la demo local es el único
    // camino posible (un borrador pre-009 sin revisión no se puede "congelar").
    return items.length === 0
      ? { estado: 'sin-plantillas' }
      : { estado: 'no-disponible', marco: borrador }
  }
  if (items.length === 0) return { estado: 'sin-plantillas' }
  if (revisionPreferida) {
    const preferida = items.find((i) => i.revision_id === revisionPreferida)
    if (preferida) return { estado: 'ok', revision: preferida }
  }
  return { estado: 'ok', revision: [...items].sort(compararPorSecuencia)[0] }
}

/* ── Purga del caché de originales (FR-018) ───────────────────────────────── */

/** Fila mínima que necesita la purga: el resto del caché no la influye. */
export type OriginalCacheado = Pick<
  TemplateOriginalMeta,
  'revision_id' | 'bytes_length' | 'cached_at'
>

export interface PlanPurga {
  /** Revisiones cuyo original se borra, en orden de borrado. */
  aBorrar: string[]
  /** Bytes que quedan cacheados tras aplicar el plan. */
  bytesRestantes: number
}

/**
 * Qué originales sacar del dispositivo (FR-018).
 *
 * Dos reglas, en este orden:
 *  · Huérfanos: originales cuya revisión ya no está entre `plantillas` (se
 *    desasignó o se retiró de la vista del rol) — no sirven para nada.
 *  · Presupuesto: si los que quedan siguen sumando más que el presupuesto, se
 *    van los más antiguos por `cached_at` hasta entrar.
 *
 * La revisión activa NUNCA se borra, ni por presupuesto ni por huérfana: es la
 * que el borrador congelado necesita para exportar su documento (FR-019/044), y
 * perderla deja la inspección sin forma de salir del dispositivo.
 */
export function planificarPurga(
  originales: readonly OriginalCacheado[],
  presupuestoBytes: number,
  revisionActiva: string | null,
  revisionesVivas: readonly string[],
): PlanPurga {
  const vivas = new Set(revisionesVivas)
  const aBorrar: string[] = []
  const vivos: OriginalCacheado[] = []

  for (const o of originales) {
    if (o.revision_id === revisionActiva) {
      vivos.push(o)
      continue
    }
    if (!vivas.has(o.revision_id)) aBorrar.push(o.revision_id)
    else vivos.push(o)
  }

  let total = vivos.reduce((suma, o) => suma + o.bytes_length, 0)
  if (total > presupuestoBytes) {
    // Más antiguas primero; `revision_id` desempata las que comparten `cached_at`.
    const porAntiguedad = [...vivos].sort(
      (a, b) => a.cached_at - b.cached_at || a.revision_id.localeCompare(b.revision_id),
    )
    for (const o of porAntiguedad) {
      if (total <= presupuestoBytes) break
      if (o.revision_id === revisionActiva) continue
      total -= o.bytes_length
      aBorrar.push(o.revision_id)
    }
  }

  return { aBorrar, bytesRestantes: total }
}

/**
 * Revisiones cuyo original merece descargarse ahora: las que aún no están
 * cacheadas, acotadas a `limite` para no bajar el libro completo de golpe al
 * volver la señal en una faena con muchas plantillas publicadas.
 *
 * `primera` (la revisión congelada del borrador, FR-028) va siempre a la
 * cabeza: es la que se va a exportar y la que la purga no puede borrar, así que
 * sin esto un device con más de `limite` plantillas nuevas nunca la bajaría.
 */
export function revisionesParaOriginal(
  items: readonly TemplatePublicadaDto[],
  yaCacheadas: readonly string[],
  limite: number,
  primera?: string | null,
): string[] {
  const cacheadas = new Set(yaCacheadas)
  const pendientes = [...items]
    .sort(compararPorSecuencia)
    .filter((i) => !cacheadas.has(i.revision_id))
    .map((i) => i.revision_id)
  if (primera) {
    const i = pendientes.indexOf(primera)
    if (i > 0) pendientes.unshift(...pendientes.splice(i, 1))
  }
  return pendientes.slice(0, Math.max(0, limite))
}
