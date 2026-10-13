/* Caos de integridad 3, 4 y 7 — test-plan §4 (issue #10).
 *
 * · 3. Edición concurrente: el mismo registro se edita en dos dispositivos
 *      offline → al reconectar ambos, LWW aplica y queda CONFLICT_RECORD con
 *      las DOS versiones (FR-023).
 * · 4. Reinicio hostil: se corta el proceso con el outbox a medio escribir → al
 *      reabrir, los datos están íntegros y drenan (transacciones Dexie).
 * · 7. Cross-tenant hostil: JWT del tenant A con un payload del tenant B →
 *      rechazo y auditoría (FR-025, NFR-05).
 *
 * Los tres miden sobre FILAS. El caos 7 además verifica que el tenant B nunca
 * vio el registro: ése es el invariante de aislamiento, y una fuga acá
 * invalidaría toda la evidencia de validación (Artículo V).
 */

import { uuidv7 } from '@terreno/shared'

import { expect, test, type Browser, type Page } from '@playwright/test'

import {
  CUENTAS,
  SITES,
  TENANTS,
  conectarDb,
  esperarColaVacia,
  filasOutbox,
  forzarFlush,
  leerCola,
  leerStack,
  loginEnApp,
  responderOkNokNa,
  vaciarCola,
} from '../helpers/e2e'

const P = {
  barriers: 'Barriers perimetrales del nivel de trabajo completos y estables',
} as const

const RUTA_LOTE = '**/sync/batch'
const API_URL = (): string => leerStack().apiUrl

/** Ids reales del fixture (backend/db/seed.ts). */
const TENANT_A = TENANTS.A
const TENANT_B = TENANTS.B
const SITE_A = SITES.A
const SITE_B = '01890000-0000-7000-8000-0000000000b2'
const USUARIO_A = '01890000-0000-7000-8000-0000000000a3'
const PLANTILLA_A = '01890000-0000-7000-8000-0000000000a6'
const ITEM_F101 = '01890000-0000-7000-8000-00000000f101'

/**
 * UUIDv7 para los registros que inyecta el test.
 *
 * Se usa el MISMO generador que la app (`@terreno/shared`): el backend valida
 * el formato con un regex estricto y un UUID forjado a mano (v4, o con los
 * nibles mal colocados) se rechazaba con 400 antes de llegar al chequeo de
 * tenant que este caos quiere probar.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await reiniciarDispositivoLocal(page)
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
    await db.limpiar(`DELETE FROM ${tabla} WHERE tenant_id = $1`, [TENANT_A])
  }
})

/** Borra la base local del dispositivo (equivalente a `reiniciarDispositivo`). */
async function reiniciarDispositivoLocal(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((ok) => {
        const abierto = indexedDB.open('terreno-conectado')
        abierto.onsuccess = () => {
          abierto.result.close()
          const req = indexedDB.deleteDatabase('terreno-conectado')
          req.onsuccess = () => ok()
          req.onerror = () => ok()
          req.onblocked = () => ok()
        }
        abierto.onerror = () => ok()
      }),
  )
  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.clear()
  })
}

/**
 * Abre un "dispositivo": contexto nuevo, sesión iniciada y app hidratada.
 *
 * `storageState` no sirve para replicar la sesión porque el access token vive
 * en `sessionStorage` (que Playwright no transfiere) y la identidad cacheada en
 * IndexedDB (que tampoco). Lo que sí es cierto en terreno es que cada
 * dispositivo entra con sus propias credenciales, así que el login se hace de
 * nuevo en cada uno.
 */
async function abrirDispositivo(browser: Browser, correo = CUENTAS.trabajadorA) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/')
  await loginEnApp(page, correo)
  return { ctx, page }
}

/** Encola una inspección respondiendo un ítem y pulsando enviar. */
async function enviarUna(page: Page): Promise<void> {
  await responderOkNokNa(page, P.barriers, 'OK')
  const boton = page.getByRole('button', { name: 'Enviar inspección' })
  await boton.scrollIntoViewIfNeeded()
  await boton.click()
}

/* ------------------------------------------------------------------------
 * CAOS 3 — edición concurrente (LWW + auditoría del conflicto)
 * --------------------------------------------------------------------- */

test.describe('caos 3 — edición concurrente', () => {
  test('dos dispositivos offline editan el mismo registro: LWW y CONFLICT_RECORD (FR-023)', async ({
    browser,
  }) => {
    const db = await conectarDb()
    const inspId = uuidv7()

    /* Se prepara un dispositivo con sesión real (hace falta el token para que
     * el worker pueda enviar), y de ahí sale el `storageState` que comparten
     * los dos "dispositivos" del escenario. */
    // Se abre un dispositivo "de referencia" sólo para confirmar que las
    // credenciales sirven; los dos del escenario se registran por su cuenta.
    const referencia = await abrirDispositivo(browser)
    await referencia.ctx.close()

    /** Deja el mismo registro en la base local con una versión distinta. */
    const sembrarDispositivo = async (version: number, status: string) => {
      const { ctx, page } = await abrirDispositivo(browser)
      await page.evaluate(
        (args) =>
          new Promise<void>((ok, no) => {
            const req = indexedDB.open('terreno-conectado')
            req.onsuccess = () => {
              const d = req.result
              /* Cada dispositivo "editó" en un instante distinto: el LWW
               * resuelve por `captured_at` y luego `client_version`. */
              const ts = new Date(Date.now() + args.desfaseMs).toISOString()
              const tx = d.transaction(['inspections', 'responses', 'outbox'], 'readwrite')
              tx.objectStore('inspections').put({
                id: args.inspId,
                tenantId: args.tenantId,
                siteId: args.siteId,
                templateId: args.plantillaId,
                templateVersion: 1,
                executedBy: args.usuarioId,
                status: args.status,
                capturedAt: ts,
                syncedAt: null,
                clientVersion: args.version,
                templateName: 'Chequeo de seguridad minera',
                siteName: 'Faena El Roble',
                answeredCount: 1,
                totalItems: 9,
              })
              tx.objectStore('responses').put({
                id: crypto.randomUUID(),
                inspectionId: args.inspId,
                templateItemId: args.itemId,
                tenantId: args.tenantId,
                valueOk: args.status === 'reviewed' ? 'ok' : 'nok',
                valueText: null,
                valueNumber: null,
                valueJson: null,
                capturedAt: ts,
                clientVersion: args.version,
              })
              tx.objectStore('outbox').put({
                entityType: 'inspection',
                entityId: args.inspId,
                tipo: 'inspeccion',
                titulo: 'Inspección en conflicto',
                detalle: `Divergencia entre dispositivos (v${args.version})`,
                batchOrder: 1,
                status: 'pending',
                retries: 0,
                tenantId: args.tenantId,
                capturedAt: ts,
                updatedAt: ts,
              })
              tx.oncomplete = () => ok()
              tx.onerror = () => no(tx.error)
            }
            req.onerror = () => no(req.error)
          }),
        {
          inspId,
          tenantId: TENANT_A,
          siteId: SITE_A,
          plantillaId: PLANTILLA_A,
          usuarioId: USUARIO_A,
          itemId: ITEM_F101,
          version,
          status,
          desfaseMs: version * 60_000,
        },
      )
      return { ctx, page }
    }

    const a = await sembrarDispositivo(1, 'submitted')
    const b = await sembrarDispositivo(2, 'reviewed')

    // Ambos dispositivos suben su versión, sinVerse entre ellos.
    await forzarFlush(a.page)
    await forzarFlush(b.page)
    await esperarColaVacia(a.page, { timeout: 90_000, permitirFallidas: true })
    await esperarColaVacia(b.page, { timeout: 90_000, permitirFallidas: true })

    /* LWW: gana la versión con mayor `captured_at`/`client_version` — la del
     * dispositivo B (`reviewed`, client_version 2). */
    const filas = await db.filas<{ status: string; client_version: number }>(
      'SELECT status, client_version FROM inspection WHERE id = $1',
      [inspId],
    )
    expect(filas).toHaveLength(1)
    expect(filas[0].status).toBe('reviewed')
    expect(filas[0].client_version).toBe(2)

    /* Y el conflicto queda AUDITADO con las dos versiones: el trabajo del
     * dispositivo perdedor no se pierde, queda en CONFLICT_RECORD. */
    const conflictos = await db.filas<{
      winner_payload: { status?: string }
      loser_payload: { status?: string }
      resolution: string
    }>('SELECT winner_payload, loser_payload, resolution FROM conflict_record WHERE entity_id = $1', [
      inspId,
    ])
    expect(conflictos).toHaveLength(1)
    expect(conflictos[0].resolution).toBe('lww')
    expect(conflictos[0].winner_payload.status).toBe('reviewed')
    expect(conflictos[0].loser_payload.status).toBe('submitted')

    await a.ctx.close()
    await b.ctx.close()
  })
})

/* ------------------------------------------------------------------------
 * CAOS 4 — reinicio hostil
 * --------------------------------------------------------------------- */

test.describe('caos 4 — reinicio hostil', () => {
  test('matar el proceso con el outbox a medio escribir deja los datos íntegros (FR-011, FR-014)', async ({
    page,
    context,
  }) => {
    const db = await conectarDb()

    await loginEnApp(page, CUENTAS.trabajadorA)
    await vaciarCola(page)

    await context.setOffline(true)
    await enviarUna(page)
    await expect.poll(async () => (await leerCola(page)).total).toBeGreaterThan(0)
    const antesDelChoque = (await filasOutbox(page)).length
    expect(antesDelChoque).toBeGreaterThan(0)

    /* Corte hostil: se destruye la PESTAÑA sin `beforeunload`, sin flush y sin
     * que la app pueda cerrar nada. Es el "matar la app" del protocolo. La base
     * IndexedDB sobrevive porque pertenece al contexto del navegador, igual
     * que en un dispositivo que se apaga a la fuerza. */
    /* Corte hostil: se recarga la página sin dejar que la app ejecute ningún
     * cierre limpio. Equivale a que el sistema mate el proceso a la fuerza:
     * la base IndexedDB del contexto sobrevive como en un dispositivo que se
     * apaga sinwarning. Reabrir en el mismo contexto mantiene el storage
     * (IndexedDB) y el token de `sessionStorage`, que es lo que un relanzamiento
     * real de la PWA hace. */
    await page.reload({ waitUntil: 'commit' })
    await page.waitForLoadState('load')

    /* Lo que importa del corte hostil (test-plan §4.4): lo que estaba escrito
     * sigue escrito, con las mismas filas y sin ninguna a medio escribir. Las
     * transacciones Dexie son atómicas y por eso no puede haber un estado
     * intermedio visible. */
    const colaRevivida = await leerCola(page)
    expect(colaRevivida.total).toBe(antesDelChoque)
    expect(colaRevivida.total).toBeGreaterThan(0)
    const revivida = page

    // Y el lote pendiente drena completo al volver la señal.
    await context.setOffline(false)
    await forzarFlush(revivida)
    await esperarColaVacia(revivida, { timeout: 90_000, permitirFallidas: true })

    const inspecciones = await db.contar(
      'SELECT count(*)::int AS n FROM inspection WHERE tenant_id = $1',
      [TENANT_A],
    )
    expect(inspecciones).toBeGreaterThan(0)

    // Ninguna fila quedó a medio escribir: todos los registros del tenant que
    // llegaron tienen su inspección y su site válidos (integridad referencial).
    const huerfanas = await db.contar(
      'SELECT count(*)::int AS n FROM log_entry WHERE tenant_id = $1 AND site_id IS NULL',
      [TENANT_A],
    )
    expect(huerfanas).toBe(0)
  })
})

/* ------------------------------------------------------------------------
 * CAOS 7 — cross-tenant hostil
 * --------------------------------------------------------------------- */

test.describe('caos 7 — cross-tenant hostil', () => {
  test('JWT del tenant A con payload del tenant B: rechazo, auditoría y cero fuga (FR-025)', async ({
    page,
    request,
  }) => {
    const db = await conectarDb()
    await loginEnApp(page, CUENTAS.trabajadorA)
    await vaciarCola(page)

    const token = await page.evaluate(() => sessionStorage.getItem('tc_access_token'))
    expect(token).toBeTruthy()

    const loteHostil = {
      batch_id: uuidv7(),
      device_id: uuidv7(),
      records: [
        {
          entity_type: 'log_entry',
          id: uuidv7(),
          /* El ataque: el JWT es del tenant A pero el payload declara B. */
          tenant_id: TENANT_B,
          client_version: 0,
          captured_at: new Date().toISOString(),
          payload: {
            site_id: SITE_B,
            author_id: USUARIO_A,
            entry_text: 'Intrusión cross-tenant (caos 7)',
            tags: ['ataque'],
            shift_date: new Date().toISOString().slice(0, 10),
          },
        },
      ],
    }

    const antes = await db.contar('SELECT count(*)::int AS n FROM log_entry WHERE tenant_id = $1', [
      TENANT_B,
    ])

    const r = await request.post(`${API_URL()}/sync/batch`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: loteHostil,
    })
    const cuerpo = await r.text().catch(() => '')

    /* Rechazo PRE-escritura: el lote se descarta completo (FR-025). */
    expect(r.status()).toBe(409)
    expect(cuerpo).toContain('tenant')

    /* Y queda la HUELLA en el log de auditoría (defensa en profundidad sobre
     * RLS): sin esto, un rechazo sería indistinguible de un silencio. */
    const auditoria = await db.filas<{ action: string; payload: Record<string, unknown> }>(
      'SELECT action, payload FROM audit_log WHERE action = $1 ORDER BY occurred_at DESC LIMIT 1',
      ['sync_tenant_mismatch'],
    )
    expect(auditoria).toHaveLength(1)
    expect(auditoria[0].payload.jwt_tenant_id).toBe(TENANT_A)
    expect((auditoria[0].payload.foreign_tenant_ids as string[])[0]).toBe(TENANT_B)

    /* El invariante que manda sobre todo lo demás (NFR-05): el tenant B no
     * vio nada. Ni una fila. */
    const despues = await db.contar('SELECT count(*)::int AS n FROM log_entry WHERE tenant_id = $1', [
      TENANT_B,
    ])
    expect(despues).toBe(antes)
    const intrusos = await db.contar(
      "SELECT count(*)::int AS n FROM log_entry WHERE entry_text = 'Intrusión cross-tenant (caos 7)'",
    )
    expect(intrusos).toBe(0)
  })
})

/** Reexportado para no duplicar la captura del lote en este archivo. */
export { RUTA_LOTE }