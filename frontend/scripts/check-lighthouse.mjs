/* TSK-NFR-07 — mide el build del frontend con Lighthouse en perfil móvil y
 * exige Performance ≥ 80 (NFR-07, spec maestro §5 · test-plan §2/§3).
 *
 * Mismo patrón que `check-pwa.mjs`: un script propio invocado desde CI, sin
 * depender de una action externa. Sirve `frontend/dist` en local (sin backend:
 * el shell offline-first no necesita la API para medir el arranque) y corre
 * Lighthouse con la emulación móvil y el throttling simulados por defecto
 * (Android gama media / Slow 4G — lo que pide el NFR).
 *
 * Uso:  npm run perf            (requiere `npm run build` antes)
 *       LIGHTHOUSE_MIN_SCORE=90 node frontend/scripts/check-lighthouse.mjs
 *
 * Chrome se descubre solo (chrome-launcher); en CI se puede forzar con
 * `CHROME_PATH`. El reporte crudo queda en `frontend/lighthouse-report.json`
 * (gitignored) para publicarlo como artefacto.
 */
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, gzipSync } from 'node:zlib'

import { launch } from 'chrome-launcher'
import lighthouse from 'lighthouse'

const RAIZ_FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(RAIZ_FRONT, 'dist')
const REPORTE = join(RAIZ_FRONT, 'lighthouse-report.json')

/** Umbral del NFR-07. Configurable para experimentar sin tocar el código. */
const UMBRAL = Number(process.env.LIGHTHOUSE_MIN_SCORE ?? 80)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

function fallo(porque) {
  console.error(`FAIL: ${porque}`)
  process.exit(1)
}

/** Tipos que la red comprime (todo lo textual; las imágenes ya vienen comprimidas). */
const COMPRIMIBLE = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg)/

/**
 * Servidor estático mínimo con fallback SPA (las rutas del cliente no existen
 * como archivo): lo mismo que hace `vite preview`, pero sin depender de él y
 * con compresión negociada — producir sirve gzip/br y Lighthouse lo cuenta en
 * las métricas simuladas de Slow 4G. Sin comprimir, el arranque medido no
 * representa a producción.
 */
function servirEstatico(dir) {
  const tipos = (archivo) => MIME[extname(archivo).toLowerCase()] ?? 'application/octet-stream'
  const indice = join(dir, 'index.html')

  const comprimir = (cuerpo, tipo, acceptEncoding) => {
    if (!COMPRIMIBLE.test(tipo)) return { cuerpo }
    if (/\bbr\b/.test(acceptEncoding)) return { cuerpo: brotliCompressSync(cuerpo), encoding: 'br' }
    if (/\bgzip\b/.test(acceptEncoding)) return { cuerpo: gzipSync(cuerpo), encoding: 'gzip' }
    return { cuerpo }
  }

  const server = createServer(async (req, res) => {
    try {
      const ruta = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
      const pedido = ruta === '/' ? '/index.html' : ruta
      const archivo = resolve(dir, '.' + pedido)
      if (!archivo.startsWith(dir)) {
        res.writeHead(403).end('prohibido')
        return
      }
      let cuerpo
      let objetivo = archivo
      try {
        cuerpo = await readFile(archivo)
      } catch {
        objetivo = indice // fallback SPA
        cuerpo = await readFile(indice)
      }
      const tipo = tipos(objetivo)
      const { cuerpo: salida, encoding } = comprimir(
        cuerpo,
        tipo,
        String(req.headers['accept-encoding'] ?? ''),
      )
      const headers = {
        'content-type': tipo,
        'content-length': String(salida.length),
        'cache-control': 'no-store',
      }
      if (encoding) headers['content-encoding'] = encoding
      res.writeHead(200, headers)
      res.end(salida)
    } catch (err) {
      res.writeHead(500).end(String(err))
    }
  })

  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => ok({ server, puerto: server.address().port }))
  })
}

/** Imprime los números que justifican el veredicto (no solo el score). */
function reportar(lhr) {
  const a = lhr.audits
  const fila = (etiqueta, id) => `  · ${etiqueta.padEnd(28)} ${a[id]?.displayValue ?? '—'}`
  console.log('NFR-07 · Lighthouse móvil · métricas del arranque:')
  console.log(fila('First Contentful Paint', 'first-contentful-paint'))
  console.log(fila('Largest Contentful Paint', 'largest-contentful-paint'))
  console.log(fila('Total Blocking Time', 'total-blocking-time'))
  console.log(fila('Cumulative Layout Shift', 'cumulative-layout-shift'))
  console.log(fila('Speed Index', 'speed-index'))
}

if (!existsSync(join(DIST, 'index.html'))) {
  fallo(
    'falta frontend/dist/index.html.\n' +
      '        El NFR-07 mide el build real: corré `npm run build` antes de `npm run perf`.',
  )
}

const { server, puerto } = await servirEstatico(DIST)
const url = `http://127.0.0.1:${puerto}/`

let chrome
let salida = 1
try {
  chrome = await launch({
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  })

  const { lhr } = await lighthouse(url, {
    port: chrome.port,
    output: 'json',
    logLevel: 'error',
    onlyCategories: ['performance'],
    formFactor: 'mobile',
    screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 2.625, disabled: false },
  })

  await writeFile(REPORTE, JSON.stringify(lhr, null, 2), 'utf8')

  const score = Math.round((lhr.categories.performance?.score ?? 0) * 100)
  reportar(lhr)

  if (score < UMBRAL) {
    console.error(`FAIL: Performance ${score} < ${UMBRAL} (NFR-07 pide ≥ ${UMBRAL} en móvil).`)
  } else {
    console.log(`NFR-07 OK: Performance ${score} ≥ ${UMBRAL} (móvil) · reporte en frontend/lighthouse-report.json`)
    salida = 0
  }
} catch (err) {
  console.error(`FAIL: Lighthouse no pudo medir: ${err?.stack ?? err}`)
} finally {
  if (chrome) await chrome.kill()
  await new Promise((ok) => server.close(ok))
}

process.exit(salida)
