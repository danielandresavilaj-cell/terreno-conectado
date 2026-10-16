/** Operación del VPS Linux. Node 22+, Docker, age y rclone; sin dependencias npm. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, openSync, closeSync, rmSync, copyFileSync, statSync, readdirSync, statfsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

const root = resolve(process.env.COMPOSE_DIR ?? '/opt/terreno/infra')
const envFile = join(root, '.env')
const parseEnv = (file) => Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).filter((s) => /^[A-Z_]+=/.test(s)).map((s) => [s.slice(0,s.indexOf('=')), s.slice(s.indexOf('=')+1)]))
const env = parseEnv(envFile)
const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error || result.status !== 0) throw new Error(`${cmd} falló (${result.status ?? result.error?.code})`)
  return result.stdout?.toString().trim()
}
const capture = (cmd, args) => run(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 16 * 1024 * 1024 })
const dcArgs = ['compose', '--env-file', envFile, '-f', join(root, process.env.COMPOSE_FILE ?? 'docker-compose.prod.yml')]
const dc = (...args) => run('docker', [...dcArgs, ...args])
const dcCapture = (...args) => capture('docker', [...dcArgs, ...args])
const running = (name) => dcCapture('ps', '--status', 'running', '--services').split('\n').includes(name)
const temp = () => mkdtempSync(join(tmpdir(), 'terreno-ops-'))
const namePattern = /^terreno-\d{8}T\d{6}Z-[a-f0-9]{8}\.tar\.age$/
function backupSettings() {
  const config = parseEnv(join(root, 'backup', 'backup.conf'))
  if (!config.BACKUP_REMOTE || !config.AGE_RECIPIENT || !config.RCLONE_CONFIG) throw new Error('Faltan BACKUP_REMOTE, AGE_RECIPIENT o RCLONE_CONFIG en backup/backup.conf')
  return config
}
const rclone = (config, ...args) => capture('rclone', ['--config', config.RCLONE_CONFIG, ...args])
const remoteFiles = (config) => JSON.parse(rclone(config, 'lsjson', config.BACKUP_REMOTE, '--files-only')).filter((f) => namePattern.test(f.Name)).sort((a,b) => a.Name.localeCompare(b.Name))
function backup() {
  const config = backupSettings()
  remoteFiles(config) // Verificar acceso remoto antes de interrumpir escrituras.
  const staging = temp(), resume = running('backend')
  const local = resolve(config.BACKUP_DIR ?? join(root, 'backups'))
  mkdirSync(local, { recursive: true, mode: 0o700 })
  const disk = statfsSync(local)
  if (disk.bavail * disk.bsize < 1024 ** 3) throw new Error('Menos de 1 GiB libre para respaldos')
  const name = `terreno-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(4).toString('hex')}.tar.age`
  const encrypted = join(local, name)
  try {
    if (resume) dc('stop', 'backend')
    try {
      const fd = openSync(join(staging, 'database.dump'), 'wx', 0o600)
      try { run('docker', [...dcArgs, 'exec', '-T', 'db', 'pg_dump', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '-Fc'], { stdio: ['ignore', fd, 'inherit'] }) }
      finally { closeSync(fd) }
      dc('run', '--rm', '--no-deps', '-T', '-v', `${staging}:/backup`, '--entrypoint', 'tar', 'config', '-czf', '/backup/files.tar.gz', '-C', '/data/sync', '.')
      const revision = existsSync(join(root, '.release')) ? readFileSync(join(root, '.release'), 'utf8').trim() : null
      writeFileSync(join(staging, 'manifest.json'), JSON.stringify({ format: 1, created_at: new Date().toISOString(), revision, images: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('IMAGE_'))) }), { mode: 0o600 })
    } finally { if (resume) dc('start', 'backend') }
    run('tar', ['-cf', join(staging, 'bundle.tar'), '-C', staging, 'database.dump', 'files.tar.gz', 'manifest.json'])
    run('age', ['-r', config.AGE_RECIPIENT, '-o', encrypted, join(staging, 'bundle.tar')])
    const size = statSync(encrypted).size, limit = 10 * 1024 ** 3
    let files = remoteFiles(config)
    if (size > limit) throw new Error('Respaldo supera 10 GiB; conservado localmente sin subir')
    while (files.length > 1 && (files.length >= 7 || files.reduce((n,f) => n + f.Size, 0) + size > limit)) {
      rclone(config, 'deletefile', `${config.BACKUP_REMOTE}/${files.shift().Name}`)
    }
    if (files.reduce((n,f) => n + f.Size, 0) + size > limit) throw new Error('Sin cuota para subir conservando el último respaldo remoto')
    rclone(config, 'copyto', encrypted, `${config.BACKUP_REMOTE}/${name}`)
    const uploaded = remoteFiles(config).find((f) => f.Name === name)
    if (!uploaded || uploaded.Size !== size) throw new Error('No se pudo verificar respaldo remoto')
    console.log(`Respaldo verificado: ${name} (${size} bytes)`)
    const retained = new Set(remoteFiles(config).map((f) => f.Name))
    for (const file of readdirSync(local)) if (namePattern.test(file) && !retained.has(file)) rmSync(join(local, file))
  } finally { rmSync(staging, { recursive: true, force: true }) }
}
async function healthy() {
  for (let attempt = 0; attempt < 36; attempt++) {
    try {
      if (dcCapture('exec', '-T', 'backend', 'node', '-e', "fetch('http://127.0.0.1:3000/health').then(async r=>{if(!r.ok)process.exit(1); console.log((await r.json()).db)})") === 'up') return
    } catch { /* iniciando */ }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('API sin health satisfactorio después de 72 segundos')
}
async function deploy() {
  const sha = process.argv[3]
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Commit completo requerido')
  const previous = readFileSync(envFile, 'utf8'), released = existsSync(join(root, '.release'))
  if (released) backup()
  const migrations = () => dcCapture('exec', '-T', 'db', 'psql', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '-Atc', 'SELECT count(*) FROM pgmigrations')
  const before = released ? migrations() : null
  const next = previous.replace(/^(IMAGE_[A-Z_]+=.*:)[^:\n]+$/gm, `$1${sha}`)
  try {
    writeFileSync(envFile, next, { mode: 0o600 })
    dc('--profile', 'tools', 'pull')
    dc('up', '-d', '--wait', 'db')
    if (released) dc('stop', 'backend')
    dc('--profile', 'tools', 'run', '--rm', 'migrate')
    if (!released && !existsSync(join(root, '.config-imported'))) {
      // Antes de exponer la API: exige paquete completo y destino sin datos.
      dc('--profile', 'tools', 'run', '--rm', 'config')
      dc('run', '--rm', '--no-deps', '-T', '--entrypoint', 'chown', 'config', '-R', '1000:1000', '/data/sync')
      writeFileSync(join(root, '.config-imported'), new Date().toISOString(), { mode: 0o600 })
    }
    dc('up', '-d', '--wait', 'backend', 'frontend', 'caddy')
    await healthy()
    // El primer certificado puede tardar después de que Caddy figure "running".
    let publicReady = false
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const response = await fetch(`https://${env.DOMAIN}/health`, { signal: AbortSignal.timeout(5000) })
        if (!response.ok || (await response.json()).db !== 'up') throw new Error('API pública no disponible')
        const page = await fetch(`https://${env.DOMAIN}/`, { signal: AbortSignal.timeout(5000) })
        if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) throw new Error('Página pública no disponible')
        publicReady = true
        break
      } catch { await new Promise((r) => setTimeout(r, 2000)) }
    }
    if (!publicReady) throw new Error('El borde HTTPS no quedó disponible; revisar DNS, TLS y Caddy')
    if (released) {
      writeFileSync(join(root, '.env.previous'), previous, { mode: 0o600 })
      copyFileSync(join(root, '.release'), join(root, '.release.previous'))
    }
    writeFileSync(join(root, '.release'), `${sha}\n`, { mode: 0o600 })
    console.log(`Publicado ${sha}: https://${env.DOMAIN}`)
  } catch (e) {
    if (released && before === migrations()) {
      writeFileSync(envFile, previous, { mode: 0o600 })
      dc('up', '-d', '--wait', 'backend', 'frontend', 'caddy')
      console.error('Restauradas imágenes anteriores: no cambió el esquema')
    } else {
      dc('stop', 'backend')
      console.error('Requiere restaurar respaldo y versión anterior; consultar runbook')
    }
    throw e
  }
}
async function restore() {
  if (process.argv[4] !== '--confirm-empty-target') throw new Error('Restore sólo en stack vacío: ARCHIVO --confirm-empty-target')
  const config = backupSettings(), staging = temp()
  if (!config.AGE_IDENTITY) throw new Error('Falta AGE_IDENTITY para descifrar')
  try {
    run('age', ['-d', '-i', config.AGE_IDENTITY, '-o', join(staging, 'bundle.tar'), resolve(process.argv[3])])
    const entries = capture('tar', ['-tf', join(staging, 'bundle.tar')]).split('\n').sort()
    if (entries.join(',') !== 'database.dump,files.tar.gz,manifest.json') throw new Error('Contenido de respaldo inválido')
    run('tar', ['-xf', join(staging, 'bundle.tar'), '-C', staging])
    const manifest = JSON.parse(readFileSync(join(staging, 'manifest.json'), 'utf8'))
    if (manifest.format !== 1) throw new Error('Versión de respaldo desconocida')
    dc('up', '-d', '--wait', 'db')
    const tables = dcCapture('exec', '-T', 'db', 'psql', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '-Atc', "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
    if (tables !== '0' || running('backend')) throw new Error('Restore requiere base nueva y API apagada; no borra datos existentes')
    dc('run', '--rm', '--no-deps', '-T', '--entrypoint', 'node', 'config', '-e', "if(require('fs').readdirSync('/data/sync').length) process.exit(1)")
    const fd = openSync(join(staging, 'database.dump'), 'r')
    try { run('docker', [...dcArgs, 'exec', '-T', 'db', 'pg_restore', '--exit-on-error', '--single-transaction', '--no-owner', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB], { stdio: [fd, 'inherit', 'inherit'] }) }
    finally { closeSync(fd) }
    dc('run', '--rm', '--no-deps', '-T', '-v', `${staging}:/backup:ro`, '--entrypoint', 'tar', 'config', '-xzf', '/backup/files.tar.gz', '-C', '/data/sync')
    dc('run', '--rm', '--no-deps', '-T', '--entrypoint', 'chown', 'config', '-R', '1000:1000', '/data/sync')
    const text = readFileSync(envFile, 'utf8').replace(/^(IMAGE_[A-Z_]+)=.*$/gm, (_, key) => `${key}=${manifest.images[key]}`)
    writeFileSync(envFile, text, { mode: 0o600 })
    if (manifest.revision) writeFileSync(join(root, '.release'), `${manifest.revision}\n`, { mode: 0o600 })
    dc('up', '-d', '--wait', 'backend', 'frontend')
    await healthy()
    console.log('Restore completado. Verificar usuarios, documentos y fotos antes de cambiar DNS.')
  } finally { rmSync(staging, { recursive: true, force: true }) }
}

const lock = join(root, '.operations.lock')
let locked = false
try {
  mkdirSync(lock); locked = true
  if (process.argv[2] === 'backup') backup()
  else if (process.argv[2] === 'deploy') await deploy()
  else if (process.argv[2] === 'restore') await restore()
  else throw new Error('Uso: ops.mjs backup|deploy SHA|restore ARCHIVO --confirm-empty-target')
} catch (e) {
  console.error(`ERROR operaciones: ${e.message}`)
  // Alertas optativas: endpoint privado del equipo. Nunca incluir credenciales.
  try {
    const config = backupSettings()
    if (config.ALERT_WEBHOOK) await fetch(config.ALERT_WEBHOOK, {
      method: 'POST', body: `Terreno: falló ${process.argv[2]}. Revisar journal del servidor.`,
      signal: AbortSignal.timeout(10000),
    })
  } catch { console.error('Revisar registro de operaciones y configuración de alertas') }
  process.exitCode = 1
} finally { if (locked) rmSync(lock, { recursive: true }) }
