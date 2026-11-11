/**
 * Crea el PRIMER administrador de plataforma (TSK-ADM-001, v1 sin modo demo).
 *
 * Interactivo a propósito: el correo, el nombre y la clave se escriben en la
 * terminal del operador y nunca pasan por argumentos, variables de entorno ni
 * historial de la shell. Se niega a correr si ya existe un platform_admin: los
 * siguientes se crean desde la app.
 *
 * Uso en el VPS (desde infra/):
 *   docker compose -f docker-compose.prod.yml --profile tools run --rm bootstrap-admin
 * o bien:  node tools/ops.mjs bootstrap-admin
 */
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { hash } from '@node-rs/argon2'

const MIN_CLAVE = 12

function preguntar(texto, { oculto = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (oculto) {
      // No repetir en pantalla lo que se escribe (sólo el texto de la pregunta).
      rl._writeToOutput = (s) => {
        if (s.includes(texto)) process.stdout.write(s)
      }
    }
    rl.question(texto, (respuesta) => {
      rl.close()
      if (oculto) process.stdout.write('\n')
      resolve(respuesta.trim())
    })
  })
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Falta DATABASE_URL')
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const ya = await client.query("SELECT count(*)::int AS n FROM app_user WHERE role = 'platform_admin'")
    if (ya.rows[0].n > 0) {
      throw new Error('Ya existe un administrador de plataforma. Crea los demás desde la app.')
    }

    const email = (await preguntar('Correo del administrador: ')).toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Correo inválido')
    const nombre = await preguntar('Nombre completo: ')
    if (!nombre) throw new Error('El nombre no puede ir vacío')
    const clave = await preguntar(`Contraseña (mínimo ${MIN_CLAVE} caracteres): `, { oculto: true })
    if (clave.length < MIN_CLAVE) throw new Error(`La contraseña debe tener al menos ${MIN_CLAVE} caracteres`)
    const repetir = await preguntar('Repite la contraseña: ', { oculto: true })
    if (clave !== repetir) throw new Error('Las contraseñas no coinciden')

    const id = randomUUID()
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO app_user (id, tenant_id, email, password_hash, role, full_name)
       VALUES ($1, NULL, $2, $3, 'platform_admin', $4)`,
      [id, email, await hash(clave), nombre],
    )
    await client.query(
      `INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
       VALUES ($1, $2, NULL, 'platform_admin_bootstrap', 'app_user', $2, $3)`,
      [randomUUID(), id, JSON.stringify({ email })],
    )
    await client.query('COMMIT')
    console.log(`Listo: ${email} puede ingresar como administrador de plataforma.`)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(`ERROR: ${e.message}`)
  process.exit(1)
})
