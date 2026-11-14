/**
 * Resumen de Gerencia con IA — TSK-REP-014 (FR-068, Enmienda 009).
 *
 * De punta a punta por la API real, con un redactor FALSO inyectado en lugar
 * de Claude: la CI nunca llama a la API ni gasta crédito. Se prueban roles,
 * IA apagada, el guardado y su reutilización (mismas cifras = sin llamar),
 * "desactualizado" y actualización, historial, períodos cerrados, tope diario,
 * aislamiento por empresa (RLS) y el error de la API. Las piezas puras están
 * en `resumen-ia-datos.spec.ts`.
 */
import 'reflect-metadata'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Pool } from 'pg'
import { poolDePrueba } from './helpers/pool'
import { runner } from 'node-pg-migrate'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { REDACTOR_RESUMEN, type RedactorResumen, type ResultadoRedaccion } from '../src/dashboard/resumen-ia'
import type { DatosResumen } from '../src/dashboard/resumen-ia.datos'
import { DEMO_PASSWORD, seedDatabase } from '../db/seed'

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations')

/** Redactor falso: guarda lo que recibe y responde lo que el test fije. */
class RedactorFalso implements RedactorResumen {
  activo = true
  llamadas: DatosResumen[] = []
  respuesta: () => ResultadoRedaccion = () => ({
    ok: true,
    salida: { titular: 'Semana tranquila en la faena.', puntos: ['Sin hallazgos críticos.', 'Inspecciones al día.'], atencion: null },
    modelo: 'claude-haiku-5-5',
    tokens_entrada: 900,
    tokens_salida: 120,
  })
  disponible() {
    return this.activo
  }
  async redactar(datos: DatosResumen) {
    this.llamadas.push(datos)
    return this.respuesta()
  }
}

let container: StartedPostgreSqlContainer
let pool: Pool
let app: INestApplication
const tokens: Record<string, string> = {}
const redactor = new RedactorFalso()
const server = () => request(app.getHttpServer())
const auth = (quien: string) => ({ Authorization: `Bearer ${tokens[quien]}` })

/** Cada `dia` distinto es otro filtro (otra clave). Termina en el futuro: período abierto. */
const periodo = (dia: number) => ({ desde: `2026-10-${String(dia).padStart(2, '0')}`, hasta: '2099-12-31' })
/** Un período que ya terminó. */
const septiembre = { desde: '2026-09-01T04:00:00.000Z', hasta: '2026-10-01T02:59:59.999Z' }

async function filasResumen(tenantEmail: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM resumen_ia r JOIN app_user u ON u.tenant_id = r.tenant_id WHERE u.email = $1`,
    [tenantEmail],
  )
  return rows[0].n
}

async function usos(tenantEmail: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM audit_log a JOIN app_user u ON u.tenant_id = a.tenant_id
      WHERE u.email = $1 AND a.action = 'dashboard_resumen_ia'`,
    [tenantEmail],
  )
  return rows[0].n
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withDatabase('terreno').start()
  const url = container.getConnectionUri()
  await runner({ databaseUrl: url, dir: MIGRATIONS_DIR, direction: 'up', migrationsTable: 'pgmigrations', log: () => {} })
  pool = poolDePrueba(url)
  await seedDatabase(pool)
  await pool.query("ALTER ROLE tc_app LOGIN PASSWORD 'test'")
  process.env.DATABASE_URL = url
  process.env.APP_DATABASE_URL = url.replace('test:test@', 'tc_app:test@')
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32bytes-long!!!!!'
  process.env.SYNC_VOLUME = await mkdtemp(join(tmpdir(), 'terreno-resumen-ia-'))
  process.env.NODE_ENV = 'test'
  process.env.IA_TOPE_RESUMEN_DIARIO = '100'
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDACTOR_RESUMEN)
    .useValue(redactor)
    .compile()
  app = configureApp(moduleRef.createNestApplication())
  await app.init()
  for (const email of ['supervisor@minera.cl', 'admin@minera.cl', 'trabajador@minera.cl', 'supervisor@andes.cl']) {
    const r = await server().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD })
    expect(r.status).toBe(200)
    tokens[email] = r.body.access_token as string
  }
}, 180_000)

afterEach(() => {
  redactor.activo = true
  process.env.IA_TOPE_RESUMEN_DIARIO = '100'
})

afterAll(async () => {
  delete process.env.IA_TOPE_RESUMEN_DIARIO
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe('resumen de Gerencia con IA (TSK-REP-014)', () => {
  const sup = 'supervisor@minera.cl'

  it('trabajador de terreno: 403 en las tres rutas', async () => {
    await server().get('/api/v1/dashboard/resumen-ia').set(auth('trabajador@minera.cl')).expect(403)
    await server().get('/api/v1/dashboard/resumen-ia/historial').set(auth('trabajador@minera.cl')).expect(403)
    await server().post('/api/v1/dashboard/resumen-ia').set(auth('trabajador@minera.cl')).send({}).expect(403)
    expect(redactor.llamadas).toHaveLength(0)
  })

  it('sin IA: la consulta lo dice y pedir responde 503 sin llamar ni guardar', async () => {
    redactor.activo = false
    const c = await server().get('/api/v1/dashboard/resumen-ia').query(periodo(1)).set(auth(sup))
    expect(c.status).toBe(200)
    expect(c.body).toEqual({ disponible: false, restantes_hoy: 0, tope_diario: 100, guardado: null })
    const r = await server().post('/api/v1/dashboard/resumen-ia').set(auth(sup)).send(periodo(1))
    expect(r.status).toBe(503)
    expect(redactor.llamadas).toHaveLength(0)
    expect(await usos(sup)).toBe(0)
    expect(await filasResumen(sup)).toBe(0)
  })

  it('redacta con sólo cifras agregadas, lo guarda y lo deja en audit_log', async () => {
    const r = await server().post('/api/v1/dashboard/resumen-ia').set(auth(sup)).send(periodo(2))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      titular: 'Semana tranquila en la faena.',
      puntos: ['Sin hallazgos críticos.', 'Inspecciones al día.'],
      atencion: null,
      modelo: 'claude-haiku-5-5',
      faena: 'Todas las faenas',
      cerrado: false,
      desde_cache: false,
      desactualizado: false,
    })
    expect(Date.parse(r.body.generado_en)).not.toBeNaN()

    const enviado = redactor.llamadas.at(-1)!
    expect(enviado).toMatchObject({ faena: 'todas las faenas', periodo: { desde: '2026-10-01', hasta: '2099-12-30' } })
    expect(enviado.tendencia_semanal).toBeDefined()
    expect(JSON.stringify(enviado)).not.toMatch(/autor|@|[0-9a-f]{8}-[0-9a-f]{4}-/)

    const { rows: guardado } = await pool.query('SELECT alcance, cerrado, contenido, generado_por FROM resumen_ia WHERE id = $1', [r.body.id])
    expect(guardado[0]).toMatchObject({ alcance: 'todas|2026-10-01|2099-12-30', cerrado: false })
    expect(guardado[0].contenido.titular).toBe('Semana tranquila en la faena.')
    const { rows: autor } = await pool.query('SELECT email FROM app_user WHERE id = $1', [guardado[0].generado_por])
    expect(autor[0].email).toBe(sup)

    const { rows: audit } = await pool.query(`SELECT entity_id, payload FROM audit_log WHERE action = 'dashboard_resumen_ia' ORDER BY occurred_at DESC LIMIT 1`)
    expect(audit[0].entity_id).toBe(r.body.id)
    expect(audit[0].payload).toMatchObject({ modelo: 'claude-haiku-5-5', tokens_entrada: 900, tokens_salida: 120, ok: true })
  })

  it('otra persona de la empresa lo ve al consultar y pedirlo no vuelve a llamar ni cuenta', async () => {
    const antes = { llamadas: redactor.llamadas.length, usos: await usos('admin@minera.cl'), filas: await filasResumen('admin@minera.cl') }
    const c = await server().get('/api/v1/dashboard/resumen-ia').query(periodo(2)).set(auth('admin@minera.cl'))
    expect(c.body.guardado).toMatchObject({ titular: 'Semana tranquila en la faena.', desactualizado: false })
    const r = await server().post('/api/v1/dashboard/resumen-ia').set(auth('admin@minera.cl')).send(periodo(2))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: c.body.guardado.id, desde_cache: true })
    expect(redactor.llamadas).toHaveLength(antes.llamadas)
    expect(await usos('admin@minera.cl')).toBe(antes.usos)
    expect(await filasResumen('admin@minera.cl')).toBe(antes.filas)
  })

  it('si las cifras cambian queda desactualizado; actualizar agrega otro y ambos quedan en el historial', async () => {
    const c = await server().get('/api/v1/dashboard/resumen-ia').query(periodo(2)).set(auth(sup))
    // Simula datos sincronizados después del resumen: la huella guardada ya no coincide.
    await pool.query('UPDATE resumen_ia SET cifras_hash = $1 WHERE id = $2', ['0'.repeat(64), c.body.guardado.id])
    const viejo = await server().get('/api/v1/dashboard/resumen-ia').query(periodo(2)).set(auth(sup))
    expect(viejo.body.guardado).toMatchObject({ id: c.body.guardado.id, desactualizado: true })

    const antes = redactor.llamadas.length
    const nuevo = await server().post('/api/v1/dashboard/resumen-ia').set(auth(sup)).send(periodo(2))
    expect(nuevo.status).toBe(200)
    expect(nuevo.body.id).not.toBe(c.body.guardado.id)
    expect(nuevo.body.desde_cache).toBe(false)
    expect(redactor.llamadas).toHaveLength(antes + 1)

    const h = await server().get('/api/v1/dashboard/resumen-ia/historial').set(auth(sup))
    expect(h.status).toBe(200)
    const ids = h.body.items.map((i: { id: string }) => i.id)
    expect(ids.slice(0, 2)).toEqual([nuevo.body.id, c.body.guardado.id])
  })

  it('período cerrado: se marca así y no envía lo que se mide a hoy', async () => {
    const r = await server().post('/api/v1/dashboard/resumen-ia').set(auth(sup)).send(septiembre)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ cerrado: true, desde: septiembre.desde, hasta: septiembre.hasta })
    const enviado = redactor.llamadas.at(-1)!
    expect(enviado.periodo).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
    expect(enviado).not.toHaveProperty('tendencia_semanal')
    expect(enviado).not.toHaveProperty('acciones_con_plazo_vencido')
  })

  it('otra faena es otro resumen, con su nombre, y el historial se puede filtrar por faena', async () => {
    const sitios = await server().get('/api/v1/sites').set(auth(sup))
    const faena = sitios.body.items[0] as { id: string; nombre: string }
    const r = await server().post('/api/v1/dashboard/resumen-ia').set(auth(sup)).send({ ...periodo(2), site_id: faena.id })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ faena: faena.nombre, desde_cache: false })
    expect(redactor.llamadas.at(-1)?.faena).toBe(faena.nombre)

    const h = await server().get('/api/v1/dashboard/resumen-ia/historial').query({ site_id: faena.id }).set(auth(sup))
    expect(h.body.items.map((i: { faena: string }) => i.faena)).toEqual([faena.nombre])
  })

  it('filtros inválidos: 400 sin llamar a la IA', async () => {
    const antes = redactor.llamadas.length
    await server().post('/api/v1/dashboard/resumen-ia').set(auth(sup)).send({ site_id: 'no-es-uuid' }).expect(400)
    await server().get('/api/v1/dashboard/resumen-ia/historial').query({ site_id: 'x' }).set(auth(sup)).expect(400)
    expect(redactor.llamadas).toHaveLength(antes)
  })

  it('tope diario por empresa: 429 al alcanzarlo; otra empresa no ve nada ajeno y tiene su cupo', async () => {
    const usados = await usos(sup)
    process.env.IA_TOPE_RESUMEN_DIARIO = String(usados)
    const c = await server().get('/api/v1/dashboard/resumen-ia').query(periodo(3)).set(auth(sup))
    expect(c.body).toMatchObject({ disponible: true, restantes_hoy: 0, tope_diario: usados, guardado: null })
    const antes = redactor.llamadas.length
    const r = await server().post('/api/v1/dashboard/resumen-ia').set(auth(sup)).send(periodo(3))
    expect(r.status).toBe(429)
    expect(r.body.message).toMatch(/máximo de \d+ resúmenes/)
    expect(redactor.llamadas).toHaveLength(antes)

    // Andes: mismo filtro, pero los resúmenes de Minera no existen para ella (RLS).
    const andes = await server().get('/api/v1/dashboard/resumen-ia').query(periodo(2)).set(auth('supervisor@andes.cl'))
    expect(andes.body).toMatchObject({ disponible: true, restantes_hoy: usados, guardado: null })
    const hAndes = await server().get('/api/v1/dashboard/resumen-ia/historial').set(auth('supervisor@andes.cl'))
    expect(hAndes.body.items).toEqual([])
  })

  it('error de la API: 502 con el motivo, auditado como fallido y sin guardar nada', async () => {
    const filas = await filasResumen('supervisor@andes.cl')
    redactor.respuesta = () => ({ ok: false, error: 'Se acabó el crédito de IA. Avisa al administrador.', modelo: 'claude-haiku-5-5', tokens_entrada: 0, tokens_salida: 0 })
    const r = await server().post('/api/v1/dashboard/resumen-ia').set(auth('supervisor@andes.cl')).send(periodo(4))
    expect(r.status).toBe(502)
    expect(r.body.message).toContain('crédito')
    const { rows } = await pool.query(`SELECT entity_id, payload FROM audit_log WHERE action = 'dashboard_resumen_ia' ORDER BY occurred_at DESC LIMIT 1`)
    expect(rows[0]).toMatchObject({ entity_id: null, payload: { ok: false } })
    expect(await filasResumen('supervisor@andes.cl')).toBe(filas)
  })
})
