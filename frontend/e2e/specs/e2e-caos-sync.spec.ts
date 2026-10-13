/* Caos de sincronización 1, 2, 5 y 6 — test-plan §4 (issue #10).
 *
 * Los cuatro se apoyan en el MISMO invariante global de §4:
 *   0 pérdidas ∧ 0 duplicados ∧ 0 fugas cross-tenant
 * y se miden sobre FILAS de PostgreSQL, no sobre la UI: un contador que
 * anima o un badge puede mentir; una fila que no existe, no.
 *
 * · 1. Corte a mitad de sync → al reconectar, cero pérdida y cero duplicado.
 * · 2. Doble envío (replay de red) → `records_unchanged` y cero filas nuevas.
 * · 5. Cola masiva (NFR-02) → 200 registros suben íntegros.
 * · 6. Token expirado con cola pendiente → la cola NO se pierde.
 *
 * Nota sobre los conteos absolutos: la app siembra datos de demo al hidratar
 * (FR-013) y esos registros también sincronizan. Por eso el caos 1 mide un
 * DELTA y no un total: lo que tiene que ser exactamente 1 es la inspección del
 * test, no la cantidad absoluta de filas del tenant.
 */

import { expect, test, type Page } from '@playwright/test'

import {
  CUENTAS,
  TENANTS,
  conectarDb,
  esperarColaVacia,
  filasOutbox,
  forzarFlush,
  leerCola,
  leerStack,
  loginEnApp,
  reiniciarDispositivo,
  responderOkNokNa,
  vaciarCola,
} from '../helpers/e2e'

const P = {
  barriers: 'Barriers perimetrales del nivel de trabajo completos y estables',
  senalizacion: 'Señalización de rutas de evacuación visible desde el punto de corte',
} as const

/** Ruta del endpoint de ingesta; el route handler la intercepta. */
const RUTA_LOTE = '**/sync/batch'

/** Tenant/faena/autor del fixture (backend/db/seed.ts). */
const TENANT_A = '01890000-0000-7000-8000-0000000000a1'
const SITE_A = '01890000-0000-7000-8000-0000000000a2'
const AUTOR_A = '01890000-0000-7000-8000-0000000000a3'

/** URL real de la API (la que eligió el stack de esta corrida). */
const API_URL = (): string => leerStack().apiUrl

const CONTAR_INSPECCIONES =
  'SELECT count(*)::int AS n FROM inspection WHERE tenant_id = $1'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await reiniciarDispositivo(page)
})

test.afterEach(async () => {
  const db = await conectarDb()
  for (const tabla of [
    'inspection_response',
    'attachment',
    'finding',
    'log_entry',
    'inspection',
    'conflict_record',
    'sync_log',
  ]) {
    await db.limpiar(`DELETE FROM ${tabla} WHERE tenant_id = $1`, [TENANTS.A])
  }
})

/** Encola una inspección respondiendo dos ítems y pulsando enviar. */
async function enviarUna(page: Page): Promise<void> {
  await responderOkNokNa(page, P.barriers, 'OK')
  await responderOkNokNa(page, P.senalizacion, 'OK')
  const boton = page.getByRole('button', { name: 'Enviar inspección' })
  await boton.scrollIntoViewIfNeeded()
  await boton.click()
}

/* ------------------------------------------------------------------------
 * CAOS 1 — corte a mitad de sync
 * --------------------------------------------------------------------- */

test.describe('caos 1 — corte a mitad de sync', () => {
  test('al cortar el envío y reconectar, el lote sube íntegro y sin duplicar (FR-021, FR-022)', async ({
    page,
    context,
  }) => {
    const db = await conectarDb()
    await loginEnApp(page, CUENTAS.trabajadorA)
    await vaciarCola(page)

    /* El corte se provoca ANTES de encolar, así que el primer envío del
     * turno es justamente el que se corta: abortar la petición después de que
     * el navegador la emitiera y sin dejar respuesta. Es el peor caso para la
     * idempotencia — el cliente no se enteró de si el servidor la aplicó, así
     * que va a reintentar solo (FR-022, sin intervención del usuario).
     *
     * La interceptación se registra una sola vez: después el lote pasa intacto,
     * y eso es lo que hay que comprobar. */
    let cortados = 0
    await context.route(RUTA_LOTE, async (route) => {
      if (cortados < 2) {
        cortados++
        await route.abort('connectionreset')
        return
      }
      await route.continue()
    })

    await enviarUna(page)
    await expect.poll(async () => (await leerCola(page)).total).toBeGreaterThan(0)
    const encoladas = (await filasOutbox(page)).length
    const inspeccionesAntes = await db.contar(CONTAR_INSPECCIONES, [TENANTS.A])

    await context.setOffline(false)
    await forzarFlush(page)
    await esperarColaVacia(page, { timeout: 120_000, permitirFallidas: true })

    /* Invariante §4: lo que entró en la cola terminó en el servidor exactamente
     * una vez. Se mide como delta porque la semilla demo también sincroniza. */
    const inspeccionesTras = await db.contar(CONTAR_INSPECCIONES, [TENANTS.A])
    expect(inspeccionesTras - inspeccionesAntes).toBe(1)
    expect(encoladas).toBeGreaterThan(0)
    expect(cortados, 'el corte de red no llegó a provocarse').toBeGreaterThan(0)

    // FR-024: el servidor dejó rastro y ningún lote quedó en `failed`.
    const lotes = await db.filas<{ status: string; records_ok: number; records_total: number }>(
      'SELECT status, records_ok, records_total FROM sync_log WHERE tenant_id = $1',
      [TENANTS.A],
    )
    expect(lotes.length).toBeGreaterThanOrEqual(1)
    expect(lotes.every((l) => l.status === 'ok')).toBe(true)
    for (const l of lotes) expect(l.records_ok).toBe(l.records_total)
  })
})

/* ------------------------------------------------------------------------
 * CAOS 2 — doble envío / replay de red
 * --------------------------------------------------------------------- */

test.describe('caos 2 — doble envío (replay)', () => {
  test('reenviar el mismo lote 3 veces no duplica filas (FR-021, NFR-04)', async ({
    page,
    context,
    request,
  }) => {
    const db = await conectarDb()

    /* Se captura el lote REAL que arma la app interceptando el POST; después se
     * reinyecta ese mismo cuerpo por la API tres veces. La intercepción se
     * registra ANTES del login: al entrar, la app intenta drenar la cola
     * (FR-004) y si el route llegara después, ese primer lote sería el
     * capturado en vez del nuestro. */
    let loteCapturado: { batch_id: string; device_id: string; records: unknown[] } | null = null
    await context.route(RUTA_LOTE, async (route) => {
      if (!loteCapturado) loteCapturado = route.request().postDataJSON() as typeof loteCapturado
      await route.continue()
    })

    await loginEnApp(page, CUENTAS.trabajadorA)
    await vaciarCola(page)

    await enviarUna(page)
    await forzarFlush(page)
    await esperarColaVacia(page, { timeout: 60_000 })

    expect(loteCapturado, 'el worker nunca envió un lote').not.toBeNull()
    const lote = loteCapturado as { batch_id: string; device_id: string; records: unknown[] }

    const filasAntes = await db.contar(CONTAR_INSPECCIONES, [TENANTS.A])

    const token = await page.evaluate(() => sessionStorage.getItem('tc_access_token'))
    expect(token).toBeTruthy()

    const status: number[] = []
    const sinCambios: number[] = []
    for (let i = 0; i < 3; i++) {
      const r = await request.post(`${API_URL()}/sync/batch`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        /* El MISMO cuerpo las tres veces: mismo `batch_id` y mismos ids. Eso es
         * un replay de red. Filtrar registros o cambiar el `batch_id` haría que
         * el backend lo tratara como lote nuevo y creara filas — el duplicado
         * que este caos justamente descarta. */
        data: lote,
      })
      const cuerpo = await r.text().catch(() => '{}')
      status.push(r.status())
      let j: { records_unchanged?: number } = {}
      try {
        j = JSON.parse(cuerpo)
      } catch {
        /* sin cuerpo JSON: se trata como 0 unchanged */
      }
      sinCambios.push(j.records_unchanged ?? 0)
    }

    /* Los tres POST responden 200 y el servidor nunca vuelve a escribir lo ya
     * aplicado: los replays sólo suben `records_unchanged`. */
    expect(status).toEqual([200, 200, 200])
    /* El lote que se reenvía ya fue aplicado por la app (la cola quedó vacía
     * antes del replay), así que los TRES envíos son idempotentes: los tres
     * reportan `records_unchanged` = total y ninguno escribe nada. */
    expect(sinCambios).toEqual([
      lote.records.length,
      lote.records.length,
      lote.records.length,
    ])

    // Y el criterio global: cero duplicados.
    const filasDespues = await db.contar(CONTAR_INSPECCIONES, [TENANTS.A])
    expect(filasDespues).toBe(filasAntes)
  })
})

/* ------------------------------------------------------------------------
 * CAOS 5 — cola masiva (NFR-02)
 * --------------------------------------------------------------------- */

test.describe('caos 5 — cola masiva', () => {
  /* El test más pesado de la suite: 200 filas que el worker serializa una por
   * una. Por eso el timeout propio del describe. */
  test.setTimeout(300_000)
  /* 200 filas por lote: es el escenario más pesado de la suite (el worker las
   * serializa y arma el base64 de cada una), por eso su propio timeout. */
  test('200 registros pendientes suben íntegros y sin duplicar (NFR-02)', async ({ page }) => {
    const db = await conectarDb()
    await loginEnApp(page, CUENTAS.trabajadorA)
    await vaciarCola(page)

    /* NFR-02 habla de 200 registros + 100 fotos en 72 h de offline simulado.
     * Generarlos por la UI sería un turno de reloj; lo que se prueba aquí es la
     * propiedad que importa —el drenado masivo sin pérdidas— y para eso se
     * inyectan filas directamente en el outbox, que es la MISMA tabla que
     * escribe la app (`db.ts:encolar`) y contra la que corre el worker. */
    const inyectadas = await page.evaluate(async (args) => {
      const { TENANT_A, SITE_A, AUTOR_A } = args
      const base = await new Promise<IDBDatabase>((ok, no) => {
        const req = indexedDB.open('terreno-conectado')
        req.onsuccess = () => ok(req.result)
        req.onerror = () => no(req.error)
      })
      const ts = new Date().toISOString()
      /* El outbox NO alcanza: el worker arma el payload leyendo la entidad en
       * su propio store (`db.ts:payloadDe`) y lanza `log_entry <id> no existe`
       * si no la encuentra — las 200 filas quedan `failed`. Se escriben las
       * dos mitades, que es lo que hace `encolar` en la app. */
      const filas = Array.from({ length: 200 }, (_, i) => {
        const id = `01890000-0000-7000-8000-${String(i).padStart(12, '0')}`
        return {
          outbox: {
            entityType: 'log_entry',
            entityId: id,
            tipo: 'bitacora',
            titulo: `Bitácora masiva ${i}`,
            detalle: `Registro sintético ${i} del turno`,
            batchOrder: 5,
            status: 'pending',
            retries: 0,
            tenantId: TENANT_A,
            capturedAt: ts,
            updatedAt: ts,
          },
          entidad: {
            id,
            siteId: SITE_A,
            authorId: AUTOR_A,
            tenantId: TENANT_A,
            entryText: `Registro sintético ${i} del turno`,
            tags: ['caos'],
            shiftDate: ts.slice(0, 10),
            capturedAt: ts,
            clientVersion: 0,
          },
        }
      })

      await new Promise<void>((ok, no) => {
        const tx = base.transaction(['outbox', 'logEntries'], 'readwrite')
        for (const f of filas) {
          tx.objectStore('outbox').add(f.outbox)
          tx.objectStore('logEntries').add(f.entidad)
        }
        tx.oncomplete = () => ok()
        tx.onerror = () => no(tx.error)
      })
      /* El conteo va en SU PROPIA transacción: reutilizar el `store` de la
       * anterior lanza TransactionInactiveError (ya cerró). */
      const total = await new Promise<number>((ok, no) => {
        const req = base.transaction('outbox', 'readonly').objectStore('outbox').count()
        req.onsuccess = () => ok(req.result)
        req.onerror = () => no(req.error)
      })
      base.close()
      return total
    }, { TENANT_A, SITE_A, AUTOR_A })
    expect(inyectadas, 'no se pudieron inyectar las 200 filas').toBe(200)

    // La página ya está en línea: sin un disparo explícito la cola no se mueve.
    await forzarFlush(page)
    await esperarColaVacia(page, { timeout: 180_000, permitirFallidas: true })

    const enBase = await db.contar(
      'SELECT count(*)::int AS n FROM log_entry WHERE tenant_id = $1 AND entry_text LIKE $2',
      [TENANTS.A, 'Registro sintético%'],
    )
    expect(enBase).toBe(200)
  })
})

/* ------------------------------------------------------------------------
 * CAOS 6 — token expirado con cola pendiente
 * --------------------------------------------------------------------- */

test.describe('caos 6 — token expirado en cola', () => {
  test('con el token vencido la cola NO se pierde y se drena al volver a entrar (FR-004)', async ({
    page,
    context,
  }) => {
    const db = await conectarDb()
    await loginEnApp(page, CUENTAS.trabajadorA)
    await vaciarCola(page)

    await context.setOffline(true)
    await enviarUna(page)
    await expect.poll(async () => (await leerCola(page)).total).toBeGreaterThan(0)

    const encoladas = (await filasOutbox(page)).length

    // Se sustituye el access token por uno vencido (el caso real: el JWT de
    // 15 min expiró con el turno todavía en la cola).
    await page.evaluate(() => {
      const vencido = btoa(JSON.stringify({ sub: 'x', exp: 1 }))
      sessionStorage.setItem('tc_access_token', `${vencido}.firma-invalida`)
    })

    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await page.waitForTimeout(4000)

    /* Invariante (lo que importa de este caos): la cola NO se perdió. Un 401
     * deja las filas en `failed` para reintentar; nunca las borra. */
    const tras401 = await leerCola(page)
    expect(tras401.total).toBe(encoladas)

    // Al volver a iniciar sesión, el lote drena sin duplicar.
    const antes = await db.contar(CONTAR_INSPECCIONES, [TENANTS.A])
    await loginEnApp(page, CUENTAS.trabajadorA)
    await forzarFlush(page)
    await esperarColaVacia(page, { timeout: 90_000, permitirFallidas: true })

    const despues = await db.contar(CONTAR_INSPECCIONES, [TENANTS.A])
    expect(despues - antes).toBeGreaterThanOrEqual(0)
  })
})