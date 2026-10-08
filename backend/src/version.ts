import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Versión de la app leída del package.json en runtime (funciona tanto desde
 * `src/` con ts-node como desde `dist/`). Se usa en `/health` (FR-052).
 */
export const APP_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
})()