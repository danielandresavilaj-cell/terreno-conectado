/** Genera secretos nuevos sin imprimirlos ni reutilizar el .env de desarrollo. */
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const [domain, sha, target = 'infra/.env'] = process.argv.slice(2)
if (!domain || !/^[a-z0-9-]+\.duckdns\.org$/.test(domain) || !/^[a-f0-9]{40}$/.test(sha ?? '')) {
  throw new Error('Uso: node infra/tools/init-env.mjs SUBDOMINIO.duckdns.org SHA_COMPLETO [archivo]')
}
const secret = () => randomBytes(32).toString('hex')
const owner = secret(), app = secret()
const prefix = 'ghcr.io/danielandresavilaj-cell/terreno-conectado'
const env = {
  DOMAIN: domain, ALLOWED_ORIGIN: `https://${domain}`,
  POSTGRES_USER: 'postgres', POSTGRES_DB: 'terreno', POSTGRES_PASSWORD: owner, APP_DB_PASSWORD: app,
  DATABASE_URL: `postgres://postgres:${owner}@db:5432/terreno`,
  APP_DATABASE_URL: `postgres://tc_app:${app}@db:5432/terreno`,
  JWT_ACCESS_SECRET: secret(), DEMO_PASSWORD: randomBytes(12).toString('hex'), LOG_LEVEL: 'info',
  IMAGE_BACKEND: `${prefix}-backend:${sha}`, IMAGE_FRONTEND: `${prefix}-frontend:${sha}`,
  IMAGE_BACKEND_TOOLS: `${prefix}-backend-tools:${sha}`,
}
await writeFile(resolve(target), Object.entries(env).map(([k,v]) => `${k}=${v}\n`).join(''), { mode: 0o600, flag: 'wx' })
console.log(`Entorno creado: ${resolve(target)}. Configura VITE_DEMO_PASSWORD en GitHub con DEMO_PASSWORD de este archivo.`)
