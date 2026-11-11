/**
 * Rate-limit de login por IP (FR-005: bloqueo "por cuenta e IP").
 *
 * Vive en memoria: una sola instancia del backend en la demo. Con varias
 * réplicas hace falta un store compartido (TSK-AUTH-007, ADR-002).
 *
 * Reglas:
 * - Los fallos cuentan dentro de una ventana (`windowMs`) que abre el primer
 *   fallo. Al llegar a `maxFails` la IP queda bloqueada `blockMs`.
 * - Cuando la ventana venció y la IP no está bloqueada, la entrada se descarta:
 *   tras cumplir el bloqueo, un solo fallo nuevo ya no vuelve a bloquear.
 * - El mapa tiene techo (`maxEntries`). Al alcanzarlo se purgan las entradas
 *   vencidas y, si aún no hay espacio, se desalojan las de actividad más
 *   antigua. Así un barrido desde muchas IPs distintas no hace crecer la
 *   memoria del proceso sin límite.
 */
export interface IpRateLimiterOptions {
  maxFails: number
  windowMs: number
  blockMs: number
  maxEntries?: number
  now?: () => number
}

interface IpEntry {
  fails: number
  firstFailAt: number
  blockedUntil: number
}

const DEFAULT_MAX_ENTRIES = 10_000

export class IpRateLimiter {
  private readonly entries = new Map<string, IpEntry>()
  private readonly maxFails: number
  private readonly windowMs: number
  private readonly blockMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: IpRateLimiterOptions) {
    this.maxFails = options.maxFails
    this.windowMs = options.windowMs
    this.blockMs = options.blockMs
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.now = options.now ?? Date.now
  }

  /** Cantidad de IPs con estado en memoria (para pruebas y observabilidad). */
  get size(): number {
    return this.entries.size
  }

  isBlocked(ip: string): boolean {
    const entry = this.entries.get(ip)
    if (!entry) return false
    const now = this.now()
    if (entry.blockedUntil > now) return true
    if (this.isExpired(entry, now)) this.entries.delete(ip)
    return false
  }

  registerFail(ip: string): void {
    const now = this.now()
    let entry = this.entries.get(ip)
    if (!entry || this.isExpired(entry, now)) {
      entry = { fails: 0, firstFailAt: now, blockedUntil: 0 }
    }
    entry.fails += 1
    if (entry.fails >= this.maxFails) {
      entry.blockedUntil = now + this.blockMs
    }
    // Borrar y reinsertar deja la IP al final: el Map conserva el orden de
    // inserción, que así es orden de última actividad (desalojo LRU).
    this.entries.delete(ip)
    if (this.entries.size >= this.maxEntries) this.makeRoom(now)
    this.entries.set(ip, entry)
  }

  /** Login exitoso: la IP vuelve a cero. */
  reset(ip: string): void {
    this.entries.delete(ip)
  }

  private isExpired(entry: IpEntry, now: number): boolean {
    return entry.blockedUntil <= now && now - entry.firstFailAt >= this.windowMs
  }

  private makeRoom(now: number): void {
    for (const [ip, entry] of this.entries) {
      if (this.isExpired(entry, now)) this.entries.delete(ip)
    }
    // Sin vencidas suficientes: se libera de una vez ~10% del techo (las de
    // actividad más antigua) para no recorrer el mapa en cada fallo.
    if (this.entries.size >= this.maxEntries) {
      let toEvict = this.entries.size - this.maxEntries + Math.max(1, Math.floor(this.maxEntries / 10))
      for (const ip of this.entries.keys()) {
        if (toEvict <= 0) break
        this.entries.delete(ip)
        toEvict -= 1
      }
    }
  }
}
