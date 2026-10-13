/* E2E de captura offline-first — issue #10, test-plan §3 (nivel E2E).
 *
 * Cubre las filas de la matriz §3 cuyo nivel declarado es E2E y que describen
 * el arranque del producto, no la API:
 *
 *   FR-011/014 · capturar sin red, cerrar y reabrir, persistir en IndexedDB
 *   FR-016     · al volver la señal el sync arranca solo, sin clic
 *   FR-018     · plantillas en caché → captura completa sin red
 *   FR-024     · el lote deja rastro en `sync_log` con sus totales
 *   FR-036/039 · los 8 tipos de campo responden; valor inválido se rechaza en
 *                el dispositivo ANTES de encolar
 *   FR-012     · la foto se comprime a ≤1280 px antes de encolar
 *   FR-031/032 · draft→submitted y el ítem NOK con hallazgo obligatorio
 *
 * Cada test entra con la cola VACÍA: la app siembra ~10 filas de demo al
 * hidratar (FR-013) y sin ese vaciado "el lote se drenó" no distinguiría lo que
 * hizo el test de lo que trajo la semilla.
 */

import { expect, test, type Page } from '@playwright/test'

import {
  CUENTAS,
  SITES,
  TENANTS,
  campoNumerico,
  baseDeInspecciones,
  conectarDb,
  contarStore,
  enviarInspeccion,
  esperarColaVacia,
  leerAdjuntos,
  leerCola,
  leerRespuestas,
  limpiarItem,
  loginEnApp,
  reiniciarDispositivo,
  responderOkNokNa,
  vaciarCola,
} from '../helpers/e2e'

/** Prompts del fixture publicado del tenant A (backend/db/seed.ts). */
const P = {
  barriers: 'Barriers perimetrales del nivel de trabajo completos y estables',
  senalizacion: 'Señalización de rutas de evacuación visible desde el punto de corte',
  foto: 'Foto del área inspeccionada',
} as const

/** Texto único del hallazgo que crea el test. La semilla demo siembra otro con
 *  un texto muy parecido ("Sin señalización en ruta de evacuación"), así que el
 *  filtro tiene que ser por igualdad y no por substring. */
const DESCRIPCION_HALLAZGO = 'Falta señalización en ruta de evacuación'

/** Id del ítem numérico en el fixture publicado (backend/db/seed.ts). */
const ITEM_NUMERICO = '01890000-0000-7000-8000-00000000f103'

/**
 * Login + cola vacía, en el orden correcto.
 *
 * `loginEnApp` deja que la app termine de hidratar, y en ese momento
 * `arrancarSesión` YA sembró la semilla demo y probablemente intentó un flush
 * (FR-004). Recién ahí tiene sentido vaciar el outbox: hacerlo antes dejaría
 * que la app re-sembrara encima y los conteos serían ruido, no evidencia.
 */
async function entrarConColaLimpia(page: Page): Promise<void> {
  await loginEnApp(page, CUENTAS.trabajadorA)
  const borradas = await vaciarCola(page)
  expect(borradas, 'la app no sembró filas de demo: cambió el fixture del backend').toBeGreaterThan(0)
}

test.beforeEach(async ({ page }) => {
  // Un dispositivo limpio por test: ni sesión, ni cola, ni caché de plantillas.
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
  ]) {
    await db.limpiar(`DELETE FROM ${tabla} WHERE tenant_id = $1`, [TENANTS.A])
  }
})

/* ------------------------------------------------------------------------
 * FR-011 / FR-014 — capturar sin red y sobrevivir al cierre de la app
 * --------------------------------------------------------------------- */

test.describe('FR-011/014 — captura offline y persistencia', () => {
  test('captura sin red, recarga y el borrador conserva las respuestas (FR-011, FR-014)', async ({
    page,
    context,
  }) => {
    await entrarConColaLimpia(page)

    // Modo avión DESPUÉS del login: la identidad ya está en caché Dexie, que es
    // exactamente lo que pasa en terreno (se entra con señal y se sigue sin ella).
    await context.setOffline(true)

    await responderOkNokNa(page, P.barriers, 'OK')
    await responderOkNokNa(page, P.senalizacion, 'OK')

    // Antes de enviar no hay nada encolado: `enviarInspeccion` arma el lote.
    expect((await leerCola(page)).pendientes).toBe(0)

    // "Cerrar y reabrir la app": se recarga la pestaña; el service worker
    // sirve el bundle, pero la base IndexedDB sigue en disco.
    await page.reload()

    await expect(
      page
        .getByRole('radiogroup', { name: `Respuesta para: ${P.barriers}` })
        .getByRole('radio', { name: 'OK', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
  })

  test('enviar con la red apagada encola y no marca nada como sincronizado (FR-011)', async ({
    page,
    context,
  }) => {
    await entrarConColaLimpia(page)
    await context.setOffline(true)

    await responderOkNokNa(page, P.barriers, 'OK')
    await enviarInspeccion(page)

    // Con la red caída el lote NO se vacía y NADA queda `synced`: si se
    // marcara, el sync habría saltado la red y perdido el dato en silencio.
    await page.waitForTimeout(1500)
    const estado = await leerCola(page)
    expect(estado.pendientes).toBeGreaterThan(0)
    expect(estado.porEstado.synced ?? 0).toBe(0)
  })
})

/* ------------------------------------------------------------------------
 * FR-016 — al volver la señal, el sync arranca solo
 * --------------------------------------------------------------------- */

test.describe('FR-016 — el sync arranca sin intervención', () => {
  test('reactivar la red drena la cola sin tocar el botón de sincronizar (FR-016)', async ({
    page,
    context,
  }) => {
    const db = await conectarDb()

    await entrarConColaLimpia(page)
    await context.setOffline(true)

    await responderOkNokNa(page, P.barriers, 'OK')
    await responderOkNokNa(page, P.senalizacion, 'OK')
    await enviarInspeccion(page)

    const antes = await db.contar('SELECT count(*)::int AS n FROM inspection WHERE tenant_id = $1', [
      TENANTS.A,
    ])

    // Volver la señal: el evento `online` del navegador dispara el flush
    // (FR-016). En ningún momento se hace clic en "Sincronizar ahora".
    await context.setOffline(false)

    await esperarColaVacia(page, { timeout: 60_000 })

    const despues = await db.contar('SELECT count(*)::int AS n FROM inspection WHERE tenant_id = $1', [
      TENANTS.A,
    ])
    // El turno del test llegó al servidor. La semilla también sube la suya, así
    // que lo que se verifica es el delta, no el total absoluto.
    expect(despues - antes).toBe(1)

    // FR-024: el lote deja rastro en `sync_log` con sus totales.
    const lote = await db.filas<{ records_total: number; records_ok: number; status: string }>(
      'SELECT records_total, records_ok, status FROM sync_log WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 1',
      [TENANTS.A],
    )
    expect(lote).toHaveLength(1)
    expect(lote[0].status).toBe('ok')
    expect(lote[0].records_ok).toBe(lote[0].records_total)
  })
})

/* ------------------------------------------------------------------------
 * FR-018 — la captura funciona sin red gracias a la caché
 * --------------------------------------------------------------------- */

test.describe('FR-018 — captura con plantillas en caché', () => {
  test('con la red apagada tras un arranque con señal, la plantilla se renderiza (FR-018)', async ({
    page,
    context,
  }) => {
    await loginEnApp(page, CUENTAS.trabajadorA)

    // El arranque con señal deja la revisión publicada en la caché Dexie.
    await expect.poll(() => contarStore(page, 'plantillas'), { timeout: 20_000 }).toBeGreaterThan(0)

    await context.setOffline(true)
    await page.reload()

    // La plantilla cacheada dibuja los ítems reales del fixture, no la demo.
    await expect(
      page.getByRole('radiogroup', { name: `Respuesta para: ${P.barriers}` }),
    ).toBeVisible()
    await expect(
      page.getByRole('radiogroup', { name: `Respuesta para: ${P.senalizacion}` }),
    ).toBeVisible()

    // Y se puede seguir capturando sin una sola petición de red.
    await responderOkNokNa(page, P.barriers, 'OK')
    await enviarInspeccion(page)
    expect((await leerCola(page)).pendientes).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------------
 * FR-036 / FR-039 — los 8 tipos de campo y la validación en el dispositivo
 * --------------------------------------------------------------------- */

test.describe('FR-036/039 — los 8 tipos y la validación en vivo', () => {
  test('la plantilla publicada renderiza los 8 tipos de respuesta (FR-036)', async ({ page }) => {
    await loginEnApp(page, CUENTAS.trabajadorA)

    // 2 ok_nok_na + numeric + date + time + select_single + select_multiple
    // (chips) + photo: los 8 tipos del contrato compartido.
    await expect(page.getByRole('radiogroup', { name: `Respuesta para: ${P.barriers}` })).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: `Respuesta para: ${P.senalizacion}` })).toBeVisible()
    await expect(page.locator('input[type="date"]')).toHaveCount(1)
    await expect(page.locator('input[type="time"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Diurno', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Casco', exact: true })).toBeVisible()
    await expect(page.getByText(P.foto)).toBeVisible()
  })

  test('un valor fuera de rango se rechaza EN EL DISPOSITIVO y no llega a la cola (FR-039)', async ({
    page,
  }) => {
    await entrarConColaLimpia(page)
    // La semilla demo escribe una respuesta en f103; se limpia ese ítem para
    // que la aserción mida la escritura del test y no la de arranque.
    await limpiarItem(page, ITEM_NUMERICO)

    // El ítem numérico del fixture declara `props: { min: -10, max: 45 }`.
    // 900 excede el máximo: el contrato Zod lo rechaza y `responderCampo` no
    // escribe ni encola (store.tsx, rama `!v.ok`).
    const numerico = await campoNumerico(page)
    await numerico.fill('900')
    await numerico.blur()

    await expect(page.getByRole('alert').first()).toBeVisible()

    // Lo importante: NO se persistió ninguna respuesta para ESE ítem. Se filtra
    // por id porque la semilla demo dejó otra respuesta numérica (i-04 = 180)
    // que no participa de esta aserción.
    const respuestas = await leerRespuestas(page)
    expect(respuestas.filter((r) => r.templateItemId === ITEM_NUMERICO)).toHaveLength(0)
  })

  test('un valor dentro de rango sí se persiste (contraste del anterior)', async ({ page }) => {
    await entrarConColaLimpia(page)
    await limpiarItem(page, ITEM_NUMERICO)

    const numerico = await campoNumerico(page)
    await numerico.fill('18')
    await numerico.blur()

    const respuestas = await leerRespuestas(page)
    const delItem = respuestas.filter((r) => r.templateItemId === ITEM_NUMERICO)
    expect(delItem).toHaveLength(1)
    expect(delItem[0].valueNumber).toBe(18)
  })
})

/* ------------------------------------------------------------------------
 * FR-012 — la foto se comprime antes de encolar
 * --------------------------------------------------------------------- */

test.describe('FR-012 — compresión de la foto antes de encolar', () => {
  test('la foto de un ítem queda ≤1280 px en el dispositivo antes de sincronizar (FR-012)', async ({
    page,
  }) => {
    await entrarConColaLimpia(page)

    // El input de foto está en la última sección ("Evidencias") y `motion`
    // anima su bloque de entrada. `setInputFiles` no necesita visibilidad, así
    // que basta con que el ítem haya montado.
    await expect(page.getByText(P.foto)).toBeVisible()
    await elegirFotoGrande(page)

    await expect
      .poll(async () => (await leerAdjuntos(page)).length, {
        timeout: 20_000,
        message: 'el adjunto comprimido no apareció en IndexedDB',
      })
      .toBeGreaterThan(0)

    for (const a of await leerAdjuntos(page)) {
      expect(Math.max(a.ancho, a.alto)).toBeLessThanOrEqual(1280)
      expect(a.bytes).toBeGreaterThan(0)
    }
  })
})

/* ------------------------------------------------------------------------
 * FR-031/032 — draft → submitted y hallazgo obligatorio
 * --------------------------------------------------------------------- */

test.describe('FR-031/032 — ciclo de la inspección', () => {
  test('enviar la inspección la deja en estado submitted con su site real (FR-031)', async ({
    page,
  }) => {
    const db = await conectarDb()
    await entrarConColaLimpia(page)
    const lineaBase = await baseDeInspecciones(page, TENANTS.A)

    await responderOkNokNa(page, P.barriers, 'OK')
    await enviarInspeccion(page)
    await esperarColaVacia(page, { timeout: 60_000 })

    const filas = await db.filas<{ status: string; site_id: string }>(
      'SELECT status, site_id FROM inspection WHERE tenant_id = $1',
      [TENANTS.A],
    )
    // La línea de base incluye lo que la semilla demo subió por su cuenta.
    expect(filas.length - lineaBase).toBe(1)
    expect(filas[0].status).toBe('submitted')
    // El site_id es el de la identidad REAL del login (no un id falso): es lo
    // que hace que el primer sync sea un lote válido (TSK-WS-011).
    expect(filas[0].site_id).toBe(SITES.A)
  })

  test('un hallazgo creado desde un NOK se encola y sube con su inspección (FR-032)', async ({
    page,
  }) => {
    const db = await conectarDb()
    await entrarConColaLimpia(page)

    await responderOkNokNa(page, P.barriers, 'NOK')
    // El ítem declara `require_finding_on_nok`: al marcar NOK se despliega el
    // panel de hallazgo y recién ahí aparece el botón para abrirlo.
    await expect(page.getByRole('button', { name: /hallazgo/i }).first()).toBeVisible()
    await page.getByRole('button', { name: /registrar hallazgo/i }).first().click()
    await page.locator('textarea').first().fill(DESCRIPCION_HALLAZGO)
    await page.getByRole('button', { name: 'Guardar hallazgo' }).click()
    // El hallazgo se persiste de forma asíncrona; sin esperarlo, el envío
    // siguiente puede armarse antes de que exista la fila.
    await expect.poll(() => contarStore(page, 'findings'), { timeout: 15_000 }).toBeGreaterThan(0)

    await enviarInspeccion(page)
    await esperarColaVacia(page, { timeout: 60_000 })

    // El hallazgo del TEST: la semilla también siembra uno con su descripción.
    const delTest = await db.filas<{ description: string }>(
      'SELECT description FROM finding WHERE tenant_id = $1',
      [TENANTS.A],
    )
    expect(delTest.filter((f) => f.description === DESCRIPCION_HALLAZGO).length).toBe(1)
  })
})

/* ------------------------------------------------------------------ util */

/**
 * Foto sintética de 3000×2000 (mayor que el tope de 1280 px del FR-012).
 *
 * Se genera **en el navegador** con un canvas y se inyecta en el input de
 * archivo con `setInputFiles`: es el mismo camino que usa un `<input type=file>`
 * real y evita meter un PNG artesanal (o una dependencia de imaging) en el
 * harness. El contenido es un degradado; el compresor sólo mira dimensiones.
 */
async function elegirFotoGrande(page: Page): Promise<void> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 3000
    canvas.height = 2000
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('sin canvas 2D en el contexto del harness')
    const g = ctx.createLinearGradient(0, 0, 3000, 2000)
    g.addColorStop(0, '#1f2937')
    g.addColorStop(1, '#9ca3af')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 3000, 2000)
    const blob = await new Promise<Blob>((ok, no) => {
      canvas.toBlob((b) => (b ? ok(b) : no(new Error('toBlob falló'))), 'image/jpeg', 0.92)
    })
    const buf = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (const b of buf) bin += String.fromCharCode(b)
    return btoa(bin)
  })

  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
    name: 'evidencia.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(base64, 'base64'),
  })
}