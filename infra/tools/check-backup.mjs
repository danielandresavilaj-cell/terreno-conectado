/** Comprobación de solo lectura: para cron/Actions, no genera ni borra respaldos. */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const file = process.argv[2] ?? '/opt/terreno/infra/backup/backup.conf'
const config = Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
  .filter((line) => /^[A-Z_]+=/.test(line))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
if (!config.RCLONE_CONFIG || !config.BACKUP_REMOTE) throw new Error('Falta configuración de backup')
const result = spawnSync('rclone', ['--config', config.RCLONE_CONFIG, 'lsjson', config.BACKUP_REMOTE, '--files-only'], { encoding: 'utf8', timeout: 90_000 })
if (result.error || result.status !== 0) throw new Error('No se pudo consultar el bucket de backups')
const files = JSON.parse(result.stdout).filter((f) => /^terreno-\d{8}T\d{6}Z-[a-f0-9]{8}\.tar\.age$/.test(f.Name))
const bytes = files.reduce((sum, f) => sum + f.Size, 0)
const latest = Math.max(...files.map((f) => Date.parse(f.ModTime)))
if (!files.length || !Number.isFinite(latest) || Date.now() - latest > 26 * 3600_000) throw new Error('No hay backup remoto reciente (máximo 26 h)')
if (files.length > 7 || bytes > 10 * 1024 ** 3) throw new Error('Retención fuera de límites')
console.log(`Backup remoto vigente: ${files.length} conjuntos, ${bytes} bytes`)
