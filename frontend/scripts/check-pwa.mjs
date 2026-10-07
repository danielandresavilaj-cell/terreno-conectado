// TSK-WS-004 — verifica los artefactos PWA en dist/ tras `vite build`
// (FR-010: manifest + service worker + shell precache sin red).
// Uso: node scripts/check-pwa.mjs
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

function must(name, why) {
  const p = join(dist, name)
  if (!existsSync(p)) {
    console.error(`FAIL: falta ${name} (${why})`)
    process.exit(1)
  }
  return readFileSync(p, 'utf8')
}

const indexHtml = must('index.html', 'shell HTML')
must('sw.js', 'service worker (Workbox)')
must('manifest.webmanifest', 'web app manifest')

const manifest = JSON.parse(must('manifest.webmanifest', 'manifest parseable'))
if (manifest.display !== 'standalone') fail('display no es standalone')
if (![manifest.start_url, manifest.scope].includes('/')) fail('start_url/scope inválidos')
const icons = manifest.icons ?? []
for (const [sizes, purpose] of [
  ['192x192', null],
  ['512x512', 'any'],
  ['512x512', 'maskable'],
]) {
  if (!icons.some((i) => i.sizes === sizes && (i.purpose ?? '') === (purpose ?? ''))) {
    fail(`falta icono ${sizes} ${purpose ?? 'any'}`)
  }
}

const sw = must('sw.js', 'service worker precache')
if (!sw.includes('index.html')) fail('sw.js no usa navigateFallback/precache del shell')
if (!/\.js|\.css/.test(sw)) fail('sw.js no precachea assets js/css')
if (!indexHtml.includes('rel="manifest"')) fail('index.html no enlaza el manifest')

console.log('PWA OK: manifest + sw.js + shell precache presentes y coherentes (FR-010)')

function fail(why) {
  console.error(`FAIL: ${why}`)
  process.exit(1)
}