import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { runner } from 'node-pg-migrate'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { verify } from '@node-rs/argon2'
import { exportConfig, importConfig, inside } from '../tools/config.mjs'

test('rechaza claves que escapan del volumen en cada plataforma', () => {
  const root = resolve(tmpdir(), 'terreno-test')
  assert.throws(() => inside(root, '../outside'))
  assert.throws(() => inside(root, root))
  assert.throws(() => inside(root, ''))
  assert.equal(inside(root, 'excel/original.xlsx'), join(root, 'excel', 'original.xlsx'))
})

test('export/import conserva configuración y bytes, sin sesiones, hashes ni respuestas', { timeout: 180000 }, async () => {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start()
  const work = await mkdtemp(join(tmpdir(), 'terreno-config-test-'))
  const origin = new pg.Client({ connectionString: container.getConnectionUri() })
  let target
  try {
    await origin.connect()
    const dir = fileURLToPath(new URL('../../backend/db/migrations', import.meta.url))
    const migrate = (databaseUrl) => runner({ databaseUrl, dir, direction: 'up', migrationsTable: 'pgmigrations', log: () => {} })
    await migrate(container.getConnectionUri())
    await origin.query('CREATE DATABASE destination')
    const uri = new URL(container.getConnectionUri()); uri.pathname = '/destination'
    await migrate(uri.href)
    target = new pg.Client({ connectionString: uri.href }); await target.connect()
    const tenant = randomUUID(), user = randomUUID(), site = randomUUID(), template = randomUUID(), revision = randomUUID(), source = randomUUID()
    await origin.query("INSERT INTO tenant(id,name,slug) VALUES($1,'Empresa demo','demo')", [tenant])
    await origin.query("INSERT INTO app_user(id,tenant_id,email,password_hash,role,full_name,failed_login_count,locked_until) VALUES($1,$2,'demo@example.test','HASH-ORIGEN-NO-EXPORTAR','tenant_admin','Demo',4,now())", [user,tenant])
    await origin.query("INSERT INTO site(id,tenant_id,name,kind) VALUES($1,$2,'Obra','construction')", [site,tenant])
    await origin.query("INSERT INTO template(id,tenant_id,name) VALUES($1,$2,'Inspección')", [template,tenant])
    await origin.query("INSERT INTO template_imports(id,tenant_id,uploaded_by,file_key,file_name,status) VALUES($1,$2,$3,'excel/original.xlsx','original.xlsx','confirmed')", [source,tenant,user])
    await origin.query("INSERT INTO template_revision(id,template_id,tenant_id,definition,status,version,published_seq,source_import_id) VALUES($1,$2,$3,'{\"sections\":[]}', 'published',1,41,$4)", [revision,template,tenant,source])
    await origin.query("INSERT INTO template_assignment(id,tenant_id,template_revision_id,site_id,role,assigned_by) VALUES($1,$2,$3,$4,'field_worker',$5)", [randomUUID(),tenant,revision,site,user])
    await origin.query("INSERT INTO auth_session(id,user_id,tenant_id,family_id,token_hash,expires_at) VALUES($1,$2,$3,$4,'TOKEN-NO-EXPORTAR',now())", [randomUUID(),user,tenant,randomUUID()])
    const volume = join(work, 'origin'), dest = join(work, 'dest'), bundle = join(work, 'bundle')
    await mkdir(join(volume,'excel'), { recursive: true })
    await mkdir(dest)
    await writeFile(join(volume,'excel/original.xlsx'), 'bytes-excel-prueba')
    await exportConfig(origin,bundle,volume)
    const json = await readFile(join(bundle,'config.json'),'utf8')
    assert.ok(!json.includes('HASH-ORIGEN') && !json.includes('TOKEN-NO-EXPORTAR') && !json.includes('failed_login_count'))
    const password = `Prueba-${randomUUID()}`
    await importConfig(target,bundle,dest,password)
    const copied = (await target.query('SELECT * FROM app_user')).rows[0]
    assert.equal(copied.failed_login_count,0)
    assert.equal(copied.locked_until,null)
    assert.ok(await verify(copied.password_hash,password))
    assert.equal((await target.query('SELECT * FROM auth_session')).rowCount,0)
    assert.equal((await target.query('SELECT * FROM inspection')).rowCount,0)
    assert.equal((await target.query('SELECT * FROM template_assignment')).rowCount,1)
    assert.ok(Number((await target.query("SELECT nextval('template_revision_published_seq') n")).rows[0].n) > 41)
    assert.equal(await readFile(join(dest,'excel/original.xlsx'),'utf8'),'bytes-excel-prueba')
    await assert.rejects(importConfig(target,bundle,dest,password), /Destino no vacío/)
    await writeFile(join(bundle,'files/excel/original.xlsx'),'corrupto')
    await assert.rejects(importConfig(target,bundle,dest,password), /Adjunto corrupto/)
  } finally {
    await target?.end(); await origin.end(); await container.stop()
    await rm(work,{ recursive: true, force: true })
  }
})
