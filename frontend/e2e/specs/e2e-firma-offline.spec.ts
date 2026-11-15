/* Firma offline y cofirma — TSK-OPS-003-B (FR-056, FR-057, FR-061), test-plan §4.
 *
 * El invariante es el mismo de §4 (0 pérdidas ∧ 0 duplicados) aplicado a la
 * firma, y se mide sobre filas de PostgreSQL:
 *
 *  · a. Firmar sin señal y recargar: la firma sigue en el teléfono (Dexie y
 *       cola) y, al volver la señal, llega exactamente una firma `inspector` y
 *       la inspección queda `submitted`.
 *  · b. Caos 12 — la respuesta del lote se corta: el servidor aplicó la firma
 *       pero el teléfono no se enteró y reintenta. Sigue habiendo una firma por
 *       rol y un solo `inspection_signed` en la auditoría.
 *  · c. Cofirma: con una plantilla que la exige, supervisión no puede marcar la
 *       inspección como revisada antes de cofirmar; después sí.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test'

import {
  CUENTAS,
  ITEMS_FIXTURE_A,
  TENANTS,
  conectarDb,
  esperarColaVacia,
  filasOutbox,
  firmarYEnviar,
  forzarFlush,
  leerCola,
  leerStore,
  loginEnApp,
  reiniciarDispositivo,
  responderOkNokNa,
  responderTemperaturaValida,
  vaciarCola,
} from '../helpers/e2e'

const RUTA_LOTE = '**/sync/batch'
/** Revisión publicada de la plantilla del tenant A (`backend/db/seed.ts`). */
const REVISION_PUBLICADA_A = '01890000-0000-7000-8000-0000000000a8'

const FIRMAS_DE = `SELECT s.signer_role, count(*)::int AS n
                     FROM inspection_signature s JOIN inspection i ON i.id = s.inspection_id
                    WHERE i.tenant_id = $1 GROUP BY s.signer_role`

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await reiniciarDispositivo(page)
})

test.afterEach(async () => {
  const db = await conectarDb()
  // La plantilla vuelve a no exigir cofirma, aunque el escenario c falle a mitad.
  await db.limpiar("UPDATE template_revision SET definition = definition - 'closing' WHERE id = $1", [REVISION_PUBLICADA_A])
  await db.limpiar("DELETE FROM audit_log WHERE tenant_id = $1 AND action = 'inspection_signed'", [TENANTS.A])
  for (const tabla of [
    'inspection_signature',
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

/** Responde los obligatorios del fixture, firma y envía. */
async function capturarYFirmar(page: Page): Promise<void> {
  await responderOkNokNa(page, ITEMS_FIXTURE_A.barriers, 'OK')
  await responderOkNokNa(page, ITEMS_FIXTURE_A.senalizacion, 'OK')
  await responderTemperaturaValida(page)
  await firmarYEnviar(page)
}

async function firmasPorRol(): Promise<Record<string, number>> {
  const db = await conectarDb()
  const filas = await db.filas<{ signer_role: string; n: number }>(FIRMAS_DE, [TENANTS.A])
  return Object.fromEntries(filas.map((f) => [f.signer_role, f.n]))
}

/** Cierra la sesión del todo (cookie de refresco incluida) para entrar con otra cuenta. */
async function cambiarDeCuenta(page: Page, context: BrowserContext, email: string): Promise<void> {
  await context.clearCookies()
  await reiniciarDispositivo(page)
  await loginEnApp(page, email)
}

test.describe('firma offline (FR-056)', () => {
  test('a · firmar sin señal y recargar: la firma sobrevive y llega una sola vez', async ({ page, context }) => {
    const db = await conectarDb()
    await loginEnApp(page, CUENTAS.trabajadorA)
    await vaciarCola(page)

    await context.setOffline(true)
    await capturarYFirmar(page)
    await expect
      .poll(async () => (await filasOutbox(page)).filter((f) => f.entityType === 'inspection_signature').length)
      .toBe(1)

    // Relanzar la app sin red: la firma y su envío pendiente siguen ahí.
    await page.reload({ waitUntil: 'commit' })
    await page.waitForLoadState('load')
    const firmasLocales = await leerStore<{ signerRole: string; strokes: unknown[] }>(page, 'signatures')
    expect(firmasLocales).toHaveLength(1)
    expect(firmasLocales[0].signerRole).toBe('inspector')
    expect(firmasLocales[0].strokes.length).toBeGreaterThan(0)
    const pendiente = (await filasOutbox(page)).find((f) => f.entityType === 'inspection_signature')
    expect(pendiente?.status).not.toBe('synced')
    expect(await db.contar('SELECT count(*)::int AS n FROM inspection_signature WHERE tenant_id = $1', [TENANTS.A])).toBe(0)

    await context.setOffline(false)
    await forzarFlush(page)
    await esperarColaVacia(page, { timeout: 90_000 })

    expect(await firmasPorRol()).toEqual({ inspector: 1 })
    const estados = await db.filas<{ status: string }>('SELECT status FROM inspection WHERE tenant_id = $1', [TENANTS.A])
    expect(estados.map((e) => e.status)).toEqual(['submitted'])
  })

  test('b · caos 12: la respuesta del lote se corta y el reintento no duplica la firma', async ({ page, context }) => {
    const db = await conectarDb()
    await loginEnApp(page, CUENTAS.trabajadorA)
    await vaciarCola(page)

    /* El lote con la firma LLEGA al servidor (route.fetch) pero el teléfono no
     * recibe la respuesta (abort): el peor caso para la idempotencia, porque
     * el cliente no sabe si se aplicó y reintenta con el mismo id. */
    let cortadas = 0
    await context.route(RUTA_LOTE, async (route) => {
      const cuerpo = route.request().postDataJSON() as { records?: Array<{ entity_type: string }> } | null
      const llevaFirma = cuerpo?.records?.some((r) => r.entity_type === 'inspection_signature') ?? false
      if (llevaFirma && cortadas === 0) {
        cortadas++
        await route.fetch()
        await route.abort('connectionreset')
        return
      }
      await route.continue()
    })

    await capturarYFirmar(page)
    await expect.poll(() => cortadas, { timeout: 30_000, message: 'el corte de la respuesta no llegó a provocarse' }).toBe(1)
    // El servidor ya tiene la firma aunque el teléfono no lo sepa.
    await expect.poll(async () => (await firmasPorRol()).inspector ?? 0, { timeout: 15_000 }).toBe(1)

    await forzarFlush(page)
    await esperarColaVacia(page, { timeout: 90_000 })

    expect(await firmasPorRol()).toEqual({ inspector: 1 })
    expect(
      await db.contar("SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND action = 'inspection_signed'", [
        TENANTS.A,
      ]),
    ).toBe(1)
    expect(await db.contar('SELECT count(*)::int AS n FROM inspection WHERE tenant_id = $1', [TENANTS.A])).toBe(1)
  })
})

test.describe('cofirma de supervisión (FR-057)', () => {
  test('c · sin cofirma no se puede revisar; con cofirma sí', async ({ page, context }) => {
    const db = await conectarDb()
    // La regla se congela en la inspección al capturar: se activa antes de entrar.
    await db.limpiar(
      `UPDATE template_revision
          SET definition = jsonb_set(definition, '{closing}', '{"require_supervisor_signature": true}'::jsonb)
        WHERE id = $1`,
      [REVISION_PUBLICADA_A],
    )

    await loginEnApp(page, CUENTAS.trabajadorA)
    await vaciarCola(page)
    await capturarYFirmar(page)
    await forzarFlush(page)
    await esperarColaVacia(page, { timeout: 90_000 })
    const [inspeccion] = await db.filas<{ id: string; requires_supervisor_signature: boolean }>(
      'SELECT id, requires_supervisor_signature FROM inspection WHERE tenant_id = $1',
      [TENANTS.A],
    )
    expect(inspeccion.requires_supervisor_signature).toBe(true)

    await cambiarDeCuenta(page, context, CUENTAS.supervisorA)
    const revisar = page.getByRole('button', { name: 'Revisar', exact: true }).first()
    await revisar.scrollIntoViewIfNeeded()
    await revisar.click()

    // Antes de cofirmar, marcar como revisada lo rechaza el servidor (409).
    await page.getByRole('button', { name: 'Marcar como revisada' }).click()
    await expect(page.getByRole('alert').filter({ hasText: /cofirma/i })).toBeVisible()

    await page.getByRole('button', { name: 'Cofirmar', exact: true }).click()
    const dialogo = page.getByRole('dialog', { name: /cofirma con tu dedo/i })
    await dialogo.waitFor({ state: 'visible' })
    const pad = dialogo.getByRole('img', { name: 'Área para dibujar la firma' })
    const caja = await pad.boundingBox()
    if (!caja) throw new Error('el pad de cofirma no tiene tamaño')
    await page.mouse.move(caja.x + caja.width * 0.2, caja.y + caja.height * 0.5)
    await page.mouse.down()
    for (const [fx, fy] of [[0.4, 0.3], [0.6, 0.7], [0.8, 0.4]]) {
      await page.mouse.move(caja.x + caja.width * fx, caja.y + caja.height * fy, { steps: 4 })
    }
    await page.mouse.up()
    await dialogo.getByRole('button', { name: 'Cofirmar inspección' }).click()
    await dialogo.waitFor({ state: 'hidden' })

    await page.getByRole('button', { name: 'Marcar como revisada' }).click()
    await expect(page.getByText('Revisada', { exact: true })).toBeVisible()

    expect(await firmasPorRol()).toEqual({ inspector: 1, supervisor: 1 })
    const [estado] = await db.filas<{ status: string }>('SELECT status FROM inspection WHERE id = $1', [inspeccion.id])
    expect(estado.status).toBe('reviewed')
    expect((await leerCola(page)).fallidas).toBe(0)
  })
})
