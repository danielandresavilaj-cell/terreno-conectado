import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listarBackupsRemotos, validarBackupsRemotos } from '../tools/check-backup.mjs'

test('auditoría read-only detecta backup ausente, viejo, excedido y fallo remoto', () => {
  const now = Date.now()
  const current = { Name: 'terreno-20261016T030000Z-1234abcd.tar.age', Size: 1024, ModTime: new Date(now).toISOString() }

  assert.deepEqual(validarBackupsRemotos([current], now), { files: [current], bytes: 1024 })
  assert.throws(() => validarBackupsRemotos([], now), /No hay backup remoto reciente/)
  assert.throws(() => validarBackupsRemotos([{ ...current, ModTime: new Date(now - 27 * 3600_000).toISOString() }], now), /No hay backup remoto reciente/)
  assert.throws(() => validarBackupsRemotos([{ ...current, ModTime: 'invalid' }], now), /No hay backup remoto reciente/)
  assert.throws(() => validarBackupsRemotos([{ ...current, Size: 11 * 1024 ** 3 }], now), /Retención fuera de límites/)
  assert.throws(() => validarBackupsRemotos(Array.from({ length: 8 }, () => current), now), /Retención fuera de límites/)
  assert.throws(() => validarBackupsRemotos([{ ...current, Name: 'unrelated-file.txt' }], now), /No hay backup remoto reciente/)

  const config = { RCLONE_CONFIG: '/unused', BACKUP_REMOTE: 'oci:demo/test' }
  const failedCommand = () => ({ status: 1, stdout: '' })
  assert.throws(() => listarBackupsRemotos(config, failedCommand), /No se pudo consultar el bucket de backups/)
})
