/** Comprobación de solo lectura: para cron/Actions, no genera ni borra respaldos. */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BACKUP_PATTERN = /^terreno-\d{8}T\d{6}Z-[a-f0-9]{8}\.tar\.age$/
const MAX_AGE_MS = 26 * 3600_000
const MAX_BYTES = 10 * 1024 ** 3
const MAX_FILES = 7

export function validarBackupsRemotos(entries, ahora = Date.now()) {
  const files = entries.filter((file) => BACKUP_PATTERN.test(file.Name))
  const bytes = files.reduce((sum, file) => sum + file.Size, 0)
  const latest = Math.max(...files.map((file) => Date.parse(file.ModTime)))

  if (!files.length || !Number.isFinite(latest) || ahora - latest > MAX_AGE_MS) {
    throw new Error('No hay backup remoto reciente (máximo 26 h)')
  }
  if (files.length > MAX_FILES || bytes > MAX_BYTES) throw new Error('Retención fuera de límites')

  return { files, bytes }
}

export function listarBackupsRemotos(config, execute = spawnSync) {
  const result = execute('rclone', ['--config', config.RCLONE_CONFIG, 'lsjson', config.BACKUP_REMOTE, '--files-only'], {
    encoding: 'utf8',
    timeout: 90_000,
  })
  if (result.error || result.status !== 0) throw new Error('No se pudo consultar el bucket de backups')
  return JSON.parse(result.stdout)
}

export function auditarBackup(file, execute = spawnSync, ahora = Date.now()) {
  const config = Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
  if (!config.RCLONE_CONFIG || !config.BACKUP_REMOTE) throw new Error('Falta configuración de backup')

  return validarBackupsRemotos(listarBackupsRemotos(config, execute), ahora)
}

function main() {
  const file = process.argv[2] ?? '/opt/terreno/infra/backup/backup.conf'
  const { files, bytes } = auditarBackup(file)
  console.log(`Backup remoto vigente: ${files.length} conjuntos, ${bytes} bytes`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
