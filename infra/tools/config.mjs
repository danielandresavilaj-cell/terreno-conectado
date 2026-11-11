/** Copia de configuración demo, nunca respuestas ni credenciales del origen. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile, realpath, stat, unlink } from 'node:fs/promises'
import { resolve, dirname, sep, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { hash } from '@node-rs/argon2'

export const TABLES = ['tenant', 'app_user', 'site', 'template', 'template_imports',
  'template_revision', 'template_section', 'template_item', 'template_assignment', 'attachment']
const EMPTY = ['inspection', 'inspection_response', 'finding', 'log_entry', 'sync_log',
  'conflict_record', 'auth_session', 'audit_log']
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
export function inside(root, key) {
  if (typeof key !== 'string' || !key) throw new Error('file_key vacío')
  const path = resolve(root, key)
  if (!path.startsWith(resolve(root) + sep)) throw new Error('file_key fuera del volumen')
  return path
}
async function safeFile(root, key) {
  const base = await realpath(root)
  const path = await realpath(inside(base, key))
  if (!path.startsWith(base + sep) || !(await stat(path)).isFile()) throw new Error('Adjunto fuera del volumen o no regular')
  return path
}

export async function exportConfig(client, directory, volume) {
  await mkdir(directory, { recursive: false, mode: 0o700 })
  const data = { format: 1, created_at: new Date().toISOString(), tables: {}, files: [] }
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    for (const table of TABLES) {
      const filter = table === 'attachment' ? " WHERE owner_type = 'template_import' AND owner_id IN (SELECT id FROM template_imports)" : ''
      // Columnas explícitas: nunca exportar hashes, bloqueos ni contadores de login.
      const columns = table === 'app_user' ? 'id, tenant_id, email, role, full_name, is_active, created_at, updated_at' : '*'
      data.tables[table] = (await client.query(`SELECT ${columns} FROM ${table}${filter} ORDER BY id`)).rows
    }
    const keys = new Set([...data.tables.template_imports, ...data.tables.attachment].map((r) => r.file_key))
    for (const key of keys) {
      const source = await safeFile(volume, key)
      const bytes = await readFile(source)
      const target = inside(join(directory, 'files'), key)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await copyFile(source, target)
      data.files.push({ key, sha256: digest(bytes), size: bytes.length })
    }
    await client.query('COMMIT')
    await writeFile(join(directory, 'config.json'), JSON.stringify(data, null, 2), { mode: 0o600 })
    return Object.fromEntries(TABLES.map((t) => [t, data.tables[t].length]))
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  }
}

export async function importConfig(client, directory, volume, password) {
  if (!password || password.length < 12) throw new Error('DEMO_PASSWORD de destino requerido (mínimo 12 caracteres)')
  const data = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'))
  if (data.format !== 1 || !TABLES.every((t) => Array.isArray(data.tables?.[t])) || !Array.isArray(data.files)) throw new Error('Paquete de configuración inválido')
  if (data.tables.attachment.some((r) => r.owner_type !== 'template_import')) throw new Error('El paquete contiene fotos operacionales')
  const keys = new Set([...data.tables.template_imports, ...data.tables.attachment].map((r) => r.file_key))
  if (data.files.length !== keys.size || new Set(data.files.map((f) => f.key)).size !== keys.size || data.files.some((f) => !keys.has(f.key))) throw new Error('Manifiesto de archivos incompleto')
  const checked = []
  for (const file of data.files) {
    const source = await safeFile(join(directory, 'files'), file.key)
    const bytes = await readFile(source)
    if (bytes.length !== file.size || digest(bytes) !== file.sha256) throw new Error(`Adjunto corrupto: ${file.key}`)
    checked.push({ source, target: inside(volume, file.key) })
  }
  const passwordHash = await hash(password)
  const copied = []
  await client.query('BEGIN')
  try {
    await client.query(`LOCK TABLE ${[...TABLES, ...EMPTY].join(', ')} IN ACCESS EXCLUSIVE MODE`)
    for (const table of [...TABLES, ...EMPTY]) {
      if ((await client.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount) throw new Error('Destino no vacío; no se sobrescriben datos')
    }
    for (const table of TABLES) {
      for (const source of data.tables[table]) {
        const row = { ...source }
        if (table === 'app_user') {
          row.password_hash = passwordHash
          row.failed_login_count = 0
          row.locked_until = null
        }
        // Validar contra columnas del esquema, nunca interpolar identificadores del paquete.
        const columns = (await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position', ['public', table])).rows.map((r) => r.column_name)
        if (Object.keys(row).some((k) => !columns.includes(k))) throw new Error(`Columnas desconocidas: ${table}`)
        const selected = columns.filter((c) => Object.hasOwn(row, c))
        await client.query(`INSERT INTO ${table} (${selected.map((c) => `"${c}"`).join(',')}) VALUES (${selected.map((_, i) => `$${i + 1}`).join(',')})`, selected.map((c) => row[c]))
      }
    }
    // Copiar antes de confirmar: si falta disco no quedan filas que apunten a archivos ausentes.
    for (const { source, target } of checked) {
      await mkdir(dirname(target), { recursive: true })
      await copyFile(source, target, 1) // COPYFILE_EXCL: nunca sobreescribir bytes existentes.
      copied.push(target)
    }
    await client.query("SELECT setval('template_revision_published_seq', GREATEST(COALESCE((SELECT MAX(published_seq) FROM template_revision), 0), 1))")
    await client.query('COMMIT')
    return Object.fromEntries(TABLES.map((t) => [t, data.tables[t].length]))
  } catch (e) {
    await client.query('ROLLBACK')
    await Promise.all(copied.map((file) => unlink(file)))
    throw e
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, directory] = process.argv.slice(2)
  if (!['export', 'import'].includes(operation) || !directory || !process.env.DATABASE_URL || !process.env.SYNC_VOLUME) {
    throw new Error('Uso: node config.mjs export|import DIRECTORIO; DATABASE_URL y SYNC_VOLUME requeridos')
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const counts = operation === 'export'
      ? await exportConfig(client, resolve(directory), resolve(process.env.SYNC_VOLUME))
      : await importConfig(client, resolve(directory), resolve(process.env.SYNC_VOLUME), process.env.DEMO_PASSWORD)
    console.log(JSON.stringify({ operation, counts }))
  } finally { await client.end() }
}
