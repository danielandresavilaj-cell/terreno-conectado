/* Activos y QR — TSK-OPS-003-C (FR-060/061, Enmienda 007).
 *
 * Un activo (vehículo, equipo o lugar) pertenece a una faena y abre un
 * formulario. Su QR contiene `tc1:<token>`; el servidor guarda sólo el SHA-256
 * (hex) de ese texto completo, y el teléfono puede calcular el mismo hash sin
 * señal para encontrar el activo en su caché (tramo 2).
 */

export const ASSET_KINDS = ['vehicle', 'equipment', 'location'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  vehicle: 'Vehículo',
  equipment: 'Equipo',
  location: 'Lugar',
}

/** Prefijo de versión del contenido del QR. */
export const QR_PREFIJO = 'tc1:'

export interface AssetDto {
  id: string
  name: string
  kind: AssetKind
  site_id: string
  faena_nombre: string
  template_id: string
  template_nombre: string
  status: 'active' | 'revoked'
  created_at: string
  updated_at: string
}

export interface AssetsResponse {
  items: AssetDto[]
}

/** Respuesta de crear o regenerar: el contenido del QR se muestra UNA vez. */
export interface AssetConQrDto extends AssetDto {
  qr: string
}

export interface CrearAssetBody {
  name: string
  kind: AssetKind
  site_id: string
  template_id: string
}

/** `GET /assets/resolver/:hash` — lo que abre un QR válido para quien escanea. */
export interface AssetResueltoDto {
  asset_id: string
  name: string
  kind: AssetKind
  site_id: string
  faena_nombre: string
  template_id: string
  revision_id: string
  template_nombre: string
}

/**
 * `GET /assets/catalogo` — activos activos de las faenas de la cuenta, para
 * resolver un QR sin señal (tramo 2). Trae el hash, nunca el token.
 */
export interface AssetCatalogoDto {
  id: string
  name: string
  kind: AssetKind
  site_id: string
  template_id: string
  qr_token_hash: string
}

export interface AssetsCatalogoResponse {
  items: AssetCatalogoDto[]
}

/**
 * Normaliza lo que leyó la cámara o se escribió a mano: quita espacios y
 * acepta el token sin prefijo. Devuelve `null` si no parece un QR de la app.
 */
export function normalizarQr(texto: string): string | null {
  const limpio = texto.trim().replace(/\s+/g, '')
  if (!limpio) return null
  const token = limpio.toLowerCase().startsWith(QR_PREFIJO) ? limpio.slice(QR_PREFIJO.length) : limpio
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null
  return `${QR_PREFIJO}${token}`
}
