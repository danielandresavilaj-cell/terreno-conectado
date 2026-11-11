import { validateValorCampo, type CampoValor, type TemplateDefinition } from '@terreno/shared'
import { itemsDe } from './valores'

export type RespuestaParaEnvio = { campo: CampoValor | null; hallazgoId?: string }

/**
 * Revalida el borrador completo justo antes de encolarlo. Validar al editar
 * evita guardar valores malos; esta segunda barrera evita enviar vacíos.
 */
export function erroresDeEnvio(
  definition: TemplateDefinition,
  respuestas: Readonly<Record<string, RespuestaParaEnvio | undefined>>,
  erroresEdicion: Readonly<Record<string, string>> = {},
): Record<string, string> {
  // Un texto numérico inválido no reemplaza el último valor persistido. No
  // permitir que ese valor viejo oculte el error que el usuario ve al editar.
  const errores: Record<string, string> = { ...erroresEdicion }
  for (const item of itemsDe(definition)) {
    const respuesta = respuestas[item.id]
    const validacion = validateValorCampo(item, respuesta?.campo ?? null)
    if (!validacion.ok) {
      errores[item.id] = validacion.error
      continue
    }
    if (item.require_finding_on_nok && respuesta?.campo === 'nok' && !respuesta.hallazgoId) {
      errores[item.id] = 'Debés registrar el hallazgo requerido para una respuesta NOK'
    }
  }
  return errores
}
