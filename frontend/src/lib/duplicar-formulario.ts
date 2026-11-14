/* Duplicar un formulario — TSK-FORM-024 (FR-066).
 *
 * La copia es un formulario nuevo e independiente: ids nuevos para secciones e
 * ítems (las respuestas se guardan por id de ítem, así que dos formularios no
 * deben compartirlos) y sin `origen`, porque la copia no tiene planilla
 * original que rellenar. Lógica pura: se prueba en `test/duplicar-formulario.test.ts`.
 */
import type { TemplateDefinition } from '@terreno/shared'

export function duplicarDefinicion(
  def: TemplateDefinition,
  nuevoId: () => string = () => crypto.randomUUID(),
): TemplateDefinition {
  return {
    ...def,
    ...(def.closing ? { closing: { ...def.closing } } : {}),
    sections: def.sections.map((s) => ({
      ...s,
      ...(s.id ? { id: nuevoId() } : {}),
      items: s.items.map(({ origen: _origen, ...item }) => ({
        ...item,
        id: nuevoId(),
        ...(item.props ? { props: structuredClone(item.props) } : {}),
      })),
    })),
  }
}

/** "Nombre (copia)", o "(copia 2)", "(copia 3)"… si ya existe. */
export function nombreDeCopia(nombre: string, existentes: readonly string[]): string {
  const base = `${nombre} (copia)`
  if (!existentes.includes(base)) return base
  let n = 2
  while (existentes.includes(`${nombre} (copia ${n})`)) n += 1
  return `${nombre} (copia ${n})`
}
