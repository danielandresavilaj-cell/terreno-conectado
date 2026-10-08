import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let cached: string | undefined

/**
 * Version del backend, leida desde backend/package.json (unica fuente de
 * verdad). Se cachea en el primer acceso. En dev (ts-node, __dirname=src) y en
 * build (dist) el package.json queda un nivel arriba; si no existe, cae a
 * process.cwd() y por ultimo a 'unknown'.
 */
export function appVersion(): string {
  if (cached) return cached

  const candidates = [
    resolve(__dirname, '..', 'package.json'),
    resolve(process.cwd(), 'package.json'),
  ]

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string }
      cached = pkg.version ?? 'unknown'
      return cached
    } catch {
      // archivo ilegible: probar el siguiente candidato
    }
  }

  cached = 'unknown'
  return cached
}