/* Orquestador del stack E2E — issue #10 (F2, pruebas de validación).
 *
 * Levanta el sistema completo como lo vería un dispositivo de faena:
 *
 *   PostgreSQL 16 real (Testcontainers, RLS incluido)
 *     → migraciones + seed determinista (los tenants A/B de data-model §5)
 *       → backend NestJS (dist/, mismo binario que producción)
 *         → frontend Vite servido (preview del build, con el service worker)
 *           → Playwright corre los specs
 *
 * Por qué este archivo y no el `webServer` de Playwright: el backend necesita
 * la URL de la base que *elige* Testcontainers en runtime, y el frontend
 * necesita la URL del backend para compilar `VITE_API_URL`. Ninguno de los dos
 * valores existe hasta que este script levanta Postgres. Un único proceso
 * dueño de los tres simplifies el arranque determinista.
 *
 * Secretos (Constitución Art. IX — nunca en el fuente):
 *   · `DEMO_PASSWORD`     — contraseña de las cuentas demo (seed + frontend).
 *   · `JWT_ACCESS_SECRET` — secreto HS256 de los access tokens.
 * Se leen del entorno; si faltan, el script falla con un mensaje que dice
 * qué exportar (ver `.env.example`). `e2e` NO tiene default: una contraseña
 * de demo implícita en el harness sería exactamente la clase de secreto que
 * la Constitución prohíbe.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

import { PostgreSqlContainer } from '@testcontainers/postgresql'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIGRATIONS_DIR = resolve(RAIZ, 'backend', 'db', 'migrations')

/* Carga el `.env` de la raíz si existe (mismo origen que el seed del backend),
 * así no hace falta `export`ear a mano —incómodo en Windows—. En CI no hay
 * `.env` y `process.loadEnvFile` no pisa las variables ya definidas. */
const ENV_RAIZ = resolve(RAIZ, '.env')
if (existsSync(ENV_RAIZ)) process.loadEnvFile(ENV_RAIZ)

/** Puerto de la API. El backend lo toma de `PORT` (backend/src/main.ts:7). */
const API_PORT = Number(process.env.E2E_API_PORT ?? 3310)
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4310)

/** Password del rol de aplicación; el seed y las migraciones la dejan NOLOGIN. */
const APP_DB_PASSWORD = process.env.E2E_APP_DB_PASSWORD ?? 'e2e-app-local'

/** Procesos y contenedores vivos (los apaga `apagar()`). */
const hijos = new Set()
const contenedores = new Set()

function log(mensaje) {
  process.stdout.write(`[stack] ${mensaje}\n`)
}

function fallo(mensaje, codigo = 1) {
  process.stderr.write(`[stack] ERROR: ${mensaje}\n`)
  process.exit(codigo)
}

/* ------------------------------------------------------------- secretos */

function leerSecretos() {
  const faltantes = []
  const demo = process.env.DEMO_PASSWORD
  const jwt = process.env.JWT_ACCESS_SECRET
  if (!demo) faltantes.push('DEMO_PASSWORD')
  if (!jwt) faltantes.push('JWT_ACCESS_SECRET')
  if (faltantes.length > 0) {
    fallo(
      `faltan variables de entorno obligatorias: ${faltantes.join(', ')}.\n` +
        '        El harness E2E no tiene contraseña por omisión (Constitución Art. IX).\n' +
        '        Defínelas en tu entorno o en `.env` (mismo origen que el seed del backend).',
    )
  }
  if (Buffer.byteLength(jwt) < 32) {
    fallo('JWT_ACCESS_SECRET debe tener al menos 32 bytes (HS256).')
  }
  return { demo, jwt }
}

/* --------------------------------------------------------------- puertos */

/** ¿Algo ya escuchando en el puerto? (si sí, el arranque fallaría confusamente) */
function puertoLibre(puerto) {
  return new Promise((resolveLibre) => {
    const srv = createServer()
    srv.once('error', () => resolveLibre(false))
    srv.once('listening', () => srv.close(() => resolveLibre(true)))
    srv.listen(puerto, '127.0.0.1')
  })
}

async function exigirPuertosLibres() {
  for (const p of [
    { p: API_PORT, nombre: 'API (E2E_API_PORT)' },
    { p: WEB_PORT, nombre: 'frontend (E2E_WEB_PORT)' },
  ]) {
    if (!(await puertoLibre(p.p))) {
      fallo(
        `el puerto ${p.p} de ${p.nombre} ya está ocupado.\n` +
          '        Liberá el puerto o exportá otra variable (ej. E2E_API_PORT=3410).',
      )
    }
  }
}

/* ------------------------------------------------------------- postgres */

async function levantarBase() {
  log('levantando PostgreSQL 16 (Testcontainers)…')
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('terreno')
    .start()
  contenedores.add(container)

  const ownerUrl = container.getConnectionUri()
  const appUrl = ownerUrl.replace('test:test@', `tc_app:${APP_DB_PASSWORD}@`)

  // El rol `tc_app` nace NOLOGIN en las migraciones (para que el seed y las
  // pruebas no esquiven RLS por omisión): acá se le da LOGIN para que el
  // backend se conecte como la app real de producción, que es lo que RLS
  // debe proteger.
  const { Pool } = await import('pg')
  const owner = new Pool({ connectionString: ownerUrl })
  try {
    const { runner } = await import('node-pg-migrate')
    await runner({
      databaseUrl: ownerUrl,
      dir: MIGRATIONS_DIR,
      direction: 'up',
      migrationsTable: 'pgmigrations',
    })
    await owner.query(`ALTER ROLE tc_app LOGIN PASSWORD '${APP_DB_PASSWORD}'`)
  } finally {
    await owner.end()
  }

  // El seed se delega al script del backend (`db:seed`) en vez de duplicarlo
  // acá: si el harness sembrara su propia copia de los tenants, dejaría de
  // estar probando el seed que la demo y las pruebas de integración usan.
  log('migraciones aplicadas; sembrando tenants A/B con backend/db/seed.ts…')
  await correrSeed(ownerUrl)

  log(`base lista: ${ownerUrl.replace(/:[^:@]+@/, ':***@')}`)
  return { ownerUrl, appUrl }
}

/** Corre `backend/db/seed.ts` con la conexión admin (bypassa RLS, por diseño). */
function correrSeed(ownerUrl) {
  return new Promise((ok, no) => {
    const proc = spawn(
      process.execPath,
      ['-r', 'ts-node/register', resolve(RAIZ, 'backend', 'db', 'seed.ts')],
      {
        cwd: resolve(RAIZ, 'backend'),
        env: { ...process.env, DATABASE_URL: ownerUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let salida = ''
    proc.stdout.on('data', (d) => (salida += String(d)))
    proc.stderr.on('data', (d) => (salida += String(d)))
    proc.on('error', (err) => no(new Error(`no se pudo ejecutar el seed: ${err.message}`)))
    proc.on('exit', (code) => {
      if (code === 0) ok(undefined)
      else no(new Error(`el seed terminó con código ${code}:\n${salida.slice(-800)}`))
    })
  })
}

/* -------------------------------------------------------------- backend */

function lanzarBackend(env) {
  const distMain = resolve(RAIZ, 'backend', 'dist', 'main.js')
  if (!existsSync(distMain)) {
    fallo(
      'falta backend/dist/main.js.\n' +
        '        El E2E arranca el binario de producción: corré `npm run build` antes de `npm run e2e`.',
    )
  }

  const proc = spawn(process.execPath, [distMain], {
    cwd: resolve(RAIZ, 'backend'),
    env: {
      ...process.env,
      ...env,
      PORT: String(API_PORT),
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  hijos.add(proc)
  const eco = (stream, etiqueta) => {
    stream.on('data', (d) => {
      for (const linea of String(d).split('\n')) {
        if (linea.trim()) process.stdout.write(`[api:${etiqueta}] ${linea}\n`)
      }
    })
  }
  eco(proc.stdout, 'out')
  eco(proc.stderr, 'err')
  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`[stack] el backend terminó con código ${code}\n`)
    }
  })
  return proc
}

/* ------------------------------------------------------------- frontend */

/**
 * Sirve el build de producción con `vite preview` (no `vite dev`): el service
 * worker y el manifiesto PWA sólo se emiten al compilar, y el caos 4
 * (reinicio hostil) necesita el bundle real tal como lo baja un dispositivo.
 */
function lanzarFrontend(env) {
  const proc = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: resolve(RAIZ, 'frontend'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    },
  )
  hijos.add(proc)
  const eco = (stream, etiqueta) => {
    stream.on('data', (d) => {
      for (const linea of String(d).split('\n')) {
        if (linea.trim()) process.stdout.write(`[web:${etiqueta}] ${linea}\n`)
      }
    })
  }
  eco(proc.stdout, 'out')
  eco(proc.stderr, 'err')
  return proc
}

/* ---------------------------------------------------------------- espera */

async function esperarHasta(url, etiqueta, ms = 60_000) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    try {
      const resp = await fetch(url)
      if (resp.ok || resp.status === 503) return true
    } catch {
      /* todavía no escucha */
    }
    await dormir(250)
  }
  fallo(`${etiqueta} no respondió en ${ms / 1000}s: ${url}`)
  return false
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/* --------------------------------------------------------------- estado */

/**
 * `e2e/stack.json` lo leen los specs para talkar con la API y la base con la
 * URL real que eligió Testcontainers. Vive en `frontend/e2e/.stack/` y está
 * gitignored junto con las variables derivadas.
 */
async function escribirEstado(datos) {
  const dir = resolve(RAIZ, 'frontend', 'e2e', '.stack')
  await mkdir(dir, { recursive: true })
  const ruta = resolve(dir, 'stack.json')
  await writeFile(ruta, JSON.stringify(datos, null, 2), 'utf8')
  return ruta
}

/**
 * Limpia el estado del stack pero CONSERVA `test-results/`: cuando un spec
 * falla, sus trazas y su `error-context.md` (el DOM real del momento del
 * fallo) son la evidencia para diagnosticarlo. Borrarlos en el teardown
 * obligaba a reproducir el fallo a ciegas.
 */
async function limpiarEstado() {
  const dir = resolve(RAIZ, 'frontend', 'e2e', '.stack')
  const conservar = new Set(['test-results'])
  let entradas = []
  try {
    entradas = await readdir(dir)
  } catch {
    return
  }
  await Promise.all(
    entradas
      .filter((nombre) => !conservar.has(nombre))
      .map((nombre) => rm(resolve(dir, nombre), { recursive: true, force: true })),
  )
}

/* ------------------------------------------------------------- teardown */

async function apagar() {
  log('apagando stack…')
  // En Windows `npx vite preview` deja un nieto (el proceso real de vite)
  // que NO muere con el padre: el puerto queda ocupado y el siguiente
  // `npm run e2e` falla con "el puerto ya está ocupado". `taskkill /T` mata el
  // árbol entero; en Unix alcanza con el grupo de procesos.
  for (const proc of hijos) {
    if (proc.exitCode !== null) continue
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
        continue
      } catch {
        /* cae al kill directo */
      }
    }
    proc.kill('SIGTERM')
  }
  // Un poco de margen para que NestJS cierre el pool de Postgres limpio.
  await dormir(800)
  for (const proc of hijos) {
    if (proc.exitCode === null) proc.kill('SIGKILL')
  }
  hijos.clear()
  for (const c of contenedores) {
    try {
      await c.stop()
    } catch {
      /* el contenedor ya se fue */
    }
  }
  contenedores.clear()
  await limpiarEstado()
  log('stack apagado.')
}

/* ----------------------------------------------------------------- main */

export async function levantar() {
  const { demo, jwt } = leerSecretos()
  await exigirPuertosLibres()

  const { ownerUrl, appUrl } = await levantarBase()

  const apiUrl = `http://127.0.0.1:${API_PORT}/api/v1`
  const webUrl = `http://127.0.0.1:${WEB_PORT}`

  const envComun = {
    DATABASE_URL: ownerUrl,
    APP_DATABASE_URL: appUrl,
    JWT_ACCESS_SECRET: jwt,
    DEMO_PASSWORD: demo,
    ALLOWED_ORIGIN: webUrl,
    SYNC_VOLUME: resolve(RAIZ, 'frontend', 'e2e', '.stack', 'sync'),
  }

  log(`arrancando backend en :${API_PORT}…`)
  lanzarBackend(envComun)
  // `/health` vive FUERA del prefijo `/api/v1` por diseño (FR-052: lo consume un
  // uptime monitor externo sin ruta de API; ver `backend/src/app.setup.ts`).
  await esperarHasta(`http://127.0.0.1:${API_PORT}/health`, 'el backend')

  log(`arrancando frontend en :${WEB_PORT}…`)
  lanzarFrontend({
    ...process.env,
    VITE_API_URL: apiUrl,
    VITE_DEMO_PASSWORD: demo,
  })
  await esperarHasta(webUrl, 'el frontend')

  const ruta = await escribirEstado({
    apiUrl,
    webUrl,
    ownerUrl,
    appUrl,
    startedAt: new Date().toISOString(),
  })
  log(`stack listo → ${ruta}`)
  return { apiUrl, webUrl, ownerUrl, appUrl }
}

export { API_PORT, WEB_PORT, APP_DB_PASSWORD, apagar, log, dormir }

/* Ejecutado como CLI (`node frontend/e2e/stack.mjs up|down`). Playwright NO
 * usa este modo: el arranque lo dispara `npm run e2e` para que los specs no
 * dependan del orden de `globalSetup` de Playwright. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2] ?? 'up'
  if (cmd === 'up') {
    let salida = 0
    try {
      await levantar()
    } catch (err) {
      process.stderr.write(`[stack] falló el arranque: ${err?.stack ?? err}\n`)
      await apagar()
      salida = 1
    }
    // `up` sin `run`: deja el stack vivo para inspección manual y espera Ctrl-C.
    if (salida === 0 && process.env.E2E_KEEP_ALIVE === '1') {
      log('E2E_KEEP_ALIVE=1 → stack en pie; Ctrl-C para apagar.')
      process.on('SIGINT', () => {
        void apagar().then(() => process.exit(0))
      })
    } else if (salida === 0) {
      await apagar()
    }
    process.exit(salida)
  } else if (cmd === 'down') {
    await apagar()
  } else {
    fallo(`comando desconocido: ${cmd} (usá up|down)`)
  }
}