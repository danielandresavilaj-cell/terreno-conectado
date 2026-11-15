/* Abrir un formulario con un QR, también sin señal — TSK-OPS-003-C (tramo 2).
 *
 * El QR contiene `tc1:<token>`. El teléfono calcula el SHA-256 del contenido
 * (WebCrypto) y lo busca entre los activos que bajó de sus faenas; el
 * formulario sale del catálogo asignado que ya tiene guardado, que el servidor
 * filtró por faena y rol. No hace falta red: con señal la caché ya está al día,
 * y sin ella vale lo último sincronizado (un QR revocado sigue abriendo hasta
 * la próxima sincronización, desfase aceptado en la Enmienda 007).
 */
import { normalizarQr, type TemplatePublicadaDto } from '@terreno/shared'
import { activoPorHash, type ActivoRow } from './db'

/** SHA-256 hex de un texto (mismo cálculo que el servidor). */
export async function hashQr(qr: string): Promise<string> {
  const datos = new TextEncoder().encode(qr)
  const digest = await crypto.subtle.digest('SHA-256', datos)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type ResultadoQr =
  | { estado: 'ok'; activo: ActivoRow; revision: TemplatePublicadaDto }
  /** El texto no parece un QR de la app. */
  | { estado: 'invalido' }
  /** No es un activo de las faenas de la cuenta (o se revocó y ya se sincronizó). */
  | { estado: 'desconocido' }
  /** Es de otra faena de la cuenta: hay que cambiarse de faena primero. */
  | { estado: 'otra-faena'; activo: ActivoRow }
  /** El activo existe, pero su formulario no está asignado a esta faena y rol. */
  | { estado: 'sin-formulario'; activo: ActivoRow }

/**
 * Resuelve lo leído o escrito contra la caché local. `formularios` es el
 * catálogo asignado de la sesión (faena actual); si hay varias revisiones del
 * mismo formulario, gana la de mayor versión.
 */
export async function resolverQr(params: {
  texto: string
  tenantId: string
  faenaId: string
  formularios: readonly TemplatePublicadaDto[]
}): Promise<ResultadoQr> {
  const qr = normalizarQr(params.texto)
  if (!qr) return { estado: 'invalido' }
  const activo = await activoPorHash(params.tenantId, await hashQr(qr))
  if (!activo) return { estado: 'desconocido' }
  if (activo.siteId !== params.faenaId) return { estado: 'otra-faena', activo }
  const revision = params.formularios
    .filter((f) => f.template_id === activo.templateId && f.tenant_id === params.tenantId)
    .sort((a, b) => b.version - a.version)[0]
  if (!revision) return { estado: 'sin-formulario', activo }
  return { estado: 'ok', activo, revision }
}

/** Mensaje para la persona, en el idioma de la app (TSK-OFF-009). */
export function mensajeQr(r: ResultadoQr, nombreFaena?: (siteId: string) => string | undefined): string | null {
  switch (r.estado) {
    case 'ok':
      return null
    case 'invalido':
      return 'Ese código no es de Terreno Conectado. Revisa que lo escribiste completo.'
    case 'desconocido':
      return 'No reconocemos ese código en tus faenas. Si es nuevo o lo cambiaron, conéctate para actualizar y vuelve a intentarlo.'
    case 'otra-faena': {
      const faena = nombreFaena?.(r.activo.siteId)
      return `«${r.activo.name}» es de ${faena ? `la faena ${faena}` : 'otra faena'}. Cámbiate a esa faena para abrir su formulario.`
    }
    case 'sin-formulario':
      return `«${r.activo.name}» abre un formulario que no tienes asignado en esta faena. Pídele a tu administrador que te lo asigne.`
  }
}
