/* Carga el `.env` de la raíz (si existe) antes de importar los tests.
 *
 * `backend/db/seed.ts` exige `DEMO_PASSWORD` al importarse: sin esto hay que
 * exportarla a mano en cada corrida, que en Windows (PowerShell/cmd) es una
 * fricción enorme. En CI no hay `.env` y este bloque queda como no-op: allí las
 * variables llegan por el entorno y `process.loadEnvFile` no pisa lo ya definido.
 *
 * `process.cwd()` es el directorio del workspace (`backend/`) porque npm corre
 * los scripts de workspace con ese cwd; por eso la raíz es `..`.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const envRaiz = resolve(process.cwd(), '..', '.env')

if (existsSync(envRaiz)) {
  process.loadEnvFile(envRaiz)
}
