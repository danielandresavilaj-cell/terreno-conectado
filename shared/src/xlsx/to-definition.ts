/**
 * Propuesta `.xlsx` → definición de plantilla — módulo 007 (TSK-FORM-006, FR-029).
 *
 * Puente puro y determinístico entre el parser (TSK-FORM-005) y el contrato de
 * formularios dinámicos (`templates.ts`): asigna ids UUIDv7 a secciones e ítems,
 * fija `position` por orden de aparición y conserva las `props` ya calculadas
 * por el parser (required/min/max/options/photo_max_kb/max_length).
 *
 * Solo se copian los campos del contrato de definición (`TemplateSection` /
 * `TemplateItem`): los metadatos del parser (`source`, `opcionesConteo`,
 * `muestra`, `filasConDato`) se usan para el preview y NO forman parte de la
 * definición persistida.
 *
 * Invariante FR-036/FR-039: la definición resultante se valida con
 * `templateDefinitionSchema` antes de devolverse, de forma que una propuesta
 * aceptada siempre produce una definición que el backend puede guardar y el
 * dispositivo puede renderizar.
 */
import { templateDefinitionSchema } from '../templates'
import type { TemplateDefinition, TemplateItem, TemplateSection } from '../templates'
import { uuidv7 } from '../id'
import type { TemplateImportProposal } from './types'

export type ResultadoADefinicion =
  | { ok: true; definition: TemplateDefinition }
  | { ok: false; error: string }

/** Ruta legible de un issue Zod (p. ej. `sections.0.items.1.props.required`). */
function rutaDeIssue(path: readonly (string | number)[]): string {
  return path.length > 0 ? path.join('.') : '(raíz)'
}

/**
 * Convierte una `TemplateImportProposal` en una `TemplateDefinition` lista para
 * persistir: genera ids e `position`, descarta metadatos del parser y valida el
 * resultado contra el contrato Zod (FR-036/FR-039).
 */
export function propuestaADefinicion(propuesta: TemplateImportProposal): ResultadoADefinicion {
  if (propuesta.secciones.length === 0) {
    return { ok: false, error: 'La propuesta no tiene secciones' }
  }

  const totalItems = propuesta.secciones.reduce((acc, s) => acc + s.items.length, 0)
  if (totalItems === 0) {
    return { ok: false, error: 'La propuesta no tiene ítems' }
  }

  const sections: TemplateSection[] = propuesta.secciones.map((seccion, indice) => ({
    id: uuidv7(),
    title: seccion.titulo,
    position: indice,
    items: seccion.items.map(
      (item): TemplateItem => ({
        id: uuidv7(),
        prompt: item.prompt,
        response_type: item.response_type,
        props: item.props,
      }),
    ),
  }))

  const check = templateDefinitionSchema.safeParse({ sections })
  if (!check.success) {
    const issue = check.error.issues[0]
    const ruta = rutaDeIssue(issue?.path ?? [])
    return { ok: false, error: `Definición inválida en ${ruta}: ${issue?.message ?? 'error de contrato'}` }
  }

  return { ok: true, definition: check.data }
}
