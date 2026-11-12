/* Runner de `npm run e2e` — issue #10.
 *
 * Levanta el stack (frontend/e2e/stack.mjs), compila el frontend contra la
 * API temporal, corre Playwright y lo apaga
 * pase lo que pase. Vive en su propio archivo (y no en un script de npm con
 * `&&`) para que el teardown corra también cuando Playwright falla: sin eso
 * el contenedor de Postgres queda huérfano y el siguiente `npm run e2e`
 * choca contra un puerto ocupado.
 */

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apagar, levantar, log } from './stack.mjs'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Argumentos que el usuario pase a `npm run e2e -- <args>` van a Playwright. */
const argsPlaywright = process.argv.slice(2)

function correrPlaywright({ webUrl, apiUrl }) {
  return new Promise((ok) => {
    const playwright = resolve(RAIZ, 'node_modules', '@playwright', 'test', 'cli.js')
    const proc = spawn(process.execPath, [playwright, 'test', ...argsPlaywright], {
      cwd: RAIZ,
      // El stack puede usar puertos alternativos cuando una corrida anterior
      // dejó conexiones en TIME_WAIT. Entregamos las URLs que acaba de crear
      // directamente a Playwright: no depende de leer un archivo temporal ni
      // de un valor heredado de otra ejecución.
      env: { ...process.env, E2E_WEB_URL: webUrl, E2E_API_URL: apiUrl },
      stdio: 'inherit',
    })
    proc.on('exit', (code) => ok(code ?? 1))
    proc.on('error', (err) => {
      process.stderr.write(`[e2e] no se pudo lanzar Playwright: ${err.message}\n`)
      ok(1)
    })
  })
}

let salida = 1
try {
  log('=== E2E: arrancando stack ===')
  const stack = await levantar()
  log('=== E2E: corriendo specs ===')
  salida = await correrPlaywright({ webUrl: stack.webUrl, apiUrl: stack.apiUrl })
  log(salida === 0 ? '=== E2E: verde ===' : '=== E2E: rojo ===')
} catch (err) {
  process.stderr.write(`[e2e] ERROR: ${err?.stack ?? err}\n`)
} finally {
  await apagar()
}

process.exit(salida)
