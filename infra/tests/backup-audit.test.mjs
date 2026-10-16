import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('auditoría read-only detecta backup ausente, viejo, excedido y fallo remoto', () => {
  const dir = mkdtempSync(join(tmpdir(), 'terreno-audit-'))
  const script = fileURLToPath(new URL('../tools/check-backup.mjs', import.meta.url))
  try {
    writeFileSync(join(dir, 'rclone'), '#!/usr/bin/env node\nprocess.stdout.write(process.env.TEST_REMOTE);process.exit(Number(process.env.TEST_EXIT||0))\n', { mode: 0o700 })
    writeFileSync(join(dir, 'backup.conf'), 'RCLONE_CONFIG=/unused\nBACKUP_REMOTE=oci:demo/test\n')
    const run = (files, code = 0) => spawnSync(process.execPath, [script, join(dir, 'backup.conf')], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_REMOTE: JSON.stringify(files), TEST_EXIT: String(code) },
    })
    const current = { Name: 'terreno-20261016T030000Z-1234abcd.tar.age', Size: 1024, ModTime: new Date().toISOString() }
    assert.equal(run([current]).status, 0)
    assert.notEqual(run([]).status, 0)
    assert.notEqual(run([{ ...current, ModTime: new Date(Date.now() - 27 * 3600_000).toISOString() }]).status, 0)
    assert.notEqual(run([{ ...current, ModTime: 'invalid' }]).status, 0)
    assert.notEqual(run([{ ...current, Size: 11 * 1024 ** 3 }]).status, 0)
    assert.notEqual(run(Array.from({ length: 8 }, () => current)).status, 0)
    assert.notEqual(run([current], 1).status, 0)
    assert.notEqual(run([{ ...current, Name: 'unrelated-file.txt' }]).status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
