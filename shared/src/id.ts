/**
 * UUIDv7 (RFC 9562) — timestamp de 48 bits + entropía, ordenable por creación.
 *
 * FR-015: los IDs de los registros se generan en el CLIENTE (offline-first),
 * de modo que la sincronización posterior no depende de IDs del servidor.
 *
 * Isomórfico: usa `crypto.getRandomValues` global (Navegador y Node ≥ 19).
 */
export function uuidv7(): string {
  const rnd = crypto.getRandomValues(new Uint8Array(10))
  const ts = Date.now()
  const b = new Uint8Array(16)
  b[0] = (ts / 2 ** 40) & 0xff
  b[1] = (ts / 2 ** 32) & 0xff
  b[2] = (ts / 2 ** 24) & 0xff
  b[3] = (ts / 2 ** 16) & 0xff
  b[4] = (ts / 2 ** 8) & 0xff
  b[5] = ts & 0xff
  b[6] = 0x70 | (rnd[0] & 0x0f) // versión 7
  b[7] = rnd[1]
  b[8] = 0x80 | (rnd[2] & 0x3f) // variante RFC 4122
  b[9] = rnd[3]
  b[10] = rnd[4]
  b[11] = rnd[5]
  b[12] = rnd[6]
  b[13] = rnd[7]
  b[14] = rnd[8]
  b[15] = rnd[9]

  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}