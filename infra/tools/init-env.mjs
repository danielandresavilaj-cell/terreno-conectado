/** Genera secretos nuevos sin imprimirlos ni reutilizar el .env de desarrollo. */
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const [dominios, sha, target = 'infra/.env'] = process.argv.slice(2)
// Uno o varios dominios separados por coma; el primero es el principal.
// Ej.: terrenoconectado.cl,www.terrenoconectado.cl (el DNS debe apuntar a la VM).
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/
const hosts = (dominios ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
if (!hosts.length || !hosts.every((h) => HOST.test(h)) || !/^[a-f0-9]{40}$/.test(sha ?? '')) {
  throw new Error('Uso: node infra/tools/init-env.mjs DOMINIO[,OTRO_DOMINIO] SHA_COMPLETO [archivo]')
}
const secret = () => randomBytes(32).toString('hex')
const owner = secret(), app = secret()
const prefix = 'ghcr.io/danielandresavilaj-cell/terreno-conectado'
const env = {
  // Caddy acepta varias direcciones separadas por coma en un mismo bloque.
  DOMAIN: hosts.join(', '), ALLOWED_ORIGIN: hosts.map((h) => `https://${h}`).join(','),
  POSTGRES_USER: 'postgres', POSTGRES_DB: 'terreno', POSTGRES_PASSWORD: owner, APP_DB_PASSWORD: app,
  DATABASE_URL: `postgres://postgres:${owner}@db:5432/terreno`,
  APP_DATABASE_URL: `postgres://tc_app:${app}@db:5432/terreno`,
  JWT_ACCESS_SECRET: secret(), LOG_LEVEL: 'info',
  IMAGE_BACKEND: `${prefix}-backend:${sha}`, IMAGE_FRONTEND: `${prefix}-frontend:${sha}`,
  IMAGE_BACKEND_TOOLS: `${prefix}-backend-tools:${sha}`,
}
await writeFile(resolve(target), Object.entries(env).map(([k,v]) => `${k}=${v}\n`).join(''), { mode: 0o600, flag: 'wx' })
console.log(`Entorno creado: ${resolve(target)}. Después del primer despliegue, crea el primer administrador con: node tools/ops.mjs bootstrap-admin`)
