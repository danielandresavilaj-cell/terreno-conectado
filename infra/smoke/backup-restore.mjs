/** Ensayo aislado: Docker, age, rclone, terreno-tools:deploy-test y terreno-api:deploy-test. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
const infra = fileURLToPath(new URL('../', import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'terreno-restore-smoke-'))
const token = randomBytes(4).toString('hex')
const run = (cmd,args,env={}) => {
  const r = spawnSync(cmd,args,{ env: {...process.env,...env}, stdio:['ignore','pipe','pipe'], encoding:'utf8', maxBuffer:16*1024**2 })
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0,3).join(' ')}: ${r.stderr}\n${r.stdout}`)
  return r.stdout.trim()
}
const dc = (side,...args) => run('docker',['compose','-p',`tc-smoke-${token}-${side}`,'--env-file',join(work,side,'.env'),'-f',join(work,side,'docker-compose.prod.yml'),...args])
const sql = (side, query) => dc(side,'exec','-T','db','psql','-U','postgres','-d','terreno','-Atc',query)
const settings = (side) => ({COMPOSE_DIR:join(work,side), COMPOSE_PROJECT_NAME:`tc-smoke-${token}-${side}`})
try {
  mkdirSync(join(work,'remote'))
  writeFileSync(join(work,'rclone.conf'),'')
  run('age-keygen',['-o',join(work,'identity.key')])
  const recipient = run('age-keygen',['-y',join(work,'identity.key')])
  for (const side of ['source','restore']) {
    const root = join(work,side)
    mkdirSync(join(root,'backup'),{recursive:true})
    cpSync(join(infra,'postgres'),join(root,'postgres'),{recursive:true})
    writeFileSync(join(root,'docker-compose.prod.yml'),readFileSync(join(infra,'docker-compose.prod.yml')))
    const env = { DOMAIN:'restore.example.test',ALLOWED_ORIGIN:'https://restore.example.test',POSTGRES_USER:'postgres',POSTGRES_DB:'terreno', POSTGRES_PASSWORD:randomBytes(24).toString('hex'),APP_DB_PASSWORD:randomBytes(24).toString('hex'),JWT_ACCESS_SECRET:randomBytes(32).toString('hex'),DEMO_PASSWORD:`Smoke-${token}-Public` }
    env.DATABASE_URL = `postgres://postgres:${env.POSTGRES_PASSWORD}@db:5432/terreno`
    env.APP_DATABASE_URL = `postgres://tc_app:${env.APP_DB_PASSWORD}@db:5432/terreno`
    env.IMAGE_BACKEND = 'terreno-api:deploy-test'
    env.IMAGE_BACKEND_TOOLS = 'terreno-tools:deploy-test'
    env.IMAGE_FRONTEND = 'nginx:1.27-alpine'
    writeFileSync(join(root,'.env'),Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n'),{mode:0o600})
    writeFileSync(join(root,'backup/backup.conf'),`BACKUP_REMOTE=:local:${join(work,'remote')}\nRCLONE_CONFIG=${join(work,'rclone.conf')}\nAGE_RECIPIENT=${recipient}\nAGE_IDENTITY=${join(work,'identity.key')}\nBACKUP_DIR=${join(work,'backups')}\n`,{mode:0o600})
  }
  dc('source','up','-d','--wait','db')
  dc('source','--profile','tools','run','--rm','migrate')
  dc('source','--profile','tools','run','--rm','seed')
  dc('source','run','--rm','--no-deps','--entrypoint','node','config','-e',"require('fs').writeFileSync('/data/sync/photo-fixture.txt','foto-sentinel')")
  dc('source','run','--rm','--no-deps','--entrypoint','chown','config','-R','1000:1000','/data/sync')
  dc('source','up','-d','--wait','backend')
  const tenants = sql('source','SELECT count(*) FROM tenant')
  const templates = sql('source','SELECT count(*) FROM template_revision')
  run(process.execPath,[join(infra,'tools/ops.mjs'),'backup'],settings('source'))
  assert.match(dc('source','ps','--status','running','--services'),/backend/)
  const archive = readdirSync(join(work,'remote')).find((name)=>name.endsWith('.age'))
  assert.ok(archive)
  run(process.execPath,[join(infra,'tools/ops.mjs'),'restore',resolve(work,'remote',archive),'--confirm-empty-target'],settings('restore'))
  assert.equal(sql('restore','SELECT count(*) FROM tenant'),tenants)
  assert.equal(sql('restore','SELECT count(*) FROM template_revision'),templates)
  assert.equal(sql('restore',"SELECT rolbypassrls FROM pg_roles WHERE rolname='tc_app'"),'f')
  assert.equal(dc('restore','run','--rm','--no-deps','--entrypoint','node','config','-e',"console.log(require('fs').readFileSync('/data/sync/photo-fixture.txt','utf8'))"),'foto-sentinel')
  // No se permite restaurar nuevamente sobre datos existentes.
  assert.throws(()=>run(process.execPath,[join(infra,'tools/ops.mjs'),'restore',resolve(work,'remote',archive),'--confirm-empty-target'],settings('restore')),/Restore requiere/)
  console.log(`OK: backup cifrado + transporte rclone + restore DB/archivos + RLS + rechazo de sobrescritura (${tenants} empresas, ${templates} revisiones)`)
} finally {
  for (const side of ['source','restore']) {
    if (readdirSync(work).includes(side)) {
      try { dc(side,'--profile','tools','down','-v','--remove-orphans') } catch (e) { console.error(e.message) }
    }
  }
  rmSync(work,{recursive:true,force:true})
}
