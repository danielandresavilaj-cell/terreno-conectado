/* Clave temporal para cuentas nuevas o restablecidas (TSK-ADM-001).
 * Sin caracteres ambiguos (0/O, 1/l/I) porque se dicta o se copia a mano. */
const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generarClaveTemporal(largo = 12): string {
  const bytes = new Uint32Array(largo)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('')
}
