/* QR que abre el formulario sin señal — TSK-OPS-003-C, tramo 2 (FR-060/061).
 *
 * Administración crea un activo (API real) y obtiene su código. El trabajador
 * entra con señal (el teléfono baja los activos de su faena), se queda sin
 * señal, escribe el código y la app abre el formulario del activo desde la
 * caché. Al firmar y volver la señal, la inspección llega con su `asset_id`.
 * Se mide sobre filas de PostgreSQL, no sobre la UI.
 */
import { expect, test } from '@playwright/test'

import {
  CUENTAS,
  ITEMS_FIXTURE_A,
  SITES,
  TENANTS,
  autenticar,
  conectarDb,
  esperarColaVacia,
  firmarYEnviar,
  forzarFlush,
  leerStack,
  leerStore,
  loginEnApp,
  reiniciarDispositivo,
  responderOkNokNa,
  responderTemperaturaValida,
  vaciarCola,
} from '../helpers/e2e'

/** Plantilla publicada y asignada del tenant A (`backend/db/seed.ts`). */
const TEMPLATE_A = '01890000-0000-7000-8000-0000000000a6'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await reiniciarDispositivo(page)
})

test.afterEach(async () => {
  const db = await conectarDb()
  for (const tabla of ['inspection_signature', 'inspection_response', 'attachment', 'finding', 'inspection', 'sync_log', 'asset']) {
    await db.limpiar(`DELETE FROM ${tabla} WHERE tenant_id = $1`, [TENANTS.A])
  }
})

test('con el código de un QR, sin señal, se abre el formulario del activo y la inspección llega con él', async ({
  page,
  context,
  request,
}) => {
  const db = await conectarDb()
  const admin = await autenticar(request, CUENTAS.adminA)
  const creado = await request.post(`${leerStack().apiUrl}/assets`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { name: 'Camioneta CA-12', kind: 'vehicle', site_id: SITES.A, template_id: TEMPLATE_A },
  })
  expect(creado.status()).toBe(201)
  const activo = (await creado.json()) as { id: string; qr: string }

  // Con señal: el teléfono baja los activos de su faena junto a sus formularios.
  await loginEnApp(page, CUENTAS.trabajadorA)
  await vaciarCola(page)
  await expect.poll(async () => (await leerStore<{ id: string }>(page, 'activos')).map((a) => a.id), { timeout: 20_000 }).toContain(activo.id)

  await context.setOffline(true)
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Formularios', exact: true }).click()
  await page.getByRole('textbox', { name: 'Código del QR' }).fill(activo.qr)
  await page.getByRole('button', { name: 'Abrir', exact: true }).click()
  await expect(page.getByText('Abierto por QR · Camioneta CA-12')).toBeVisible()

  // Un código desconocido se explica, sin red y sin abrir nada.
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Formularios', exact: true }).click()
  await page.getByRole('textbox', { name: 'Código del QR' }).fill('tc1:yyyyyyyyyyyyyyyyyyyyyy')
  await page.getByRole('button', { name: 'Abrir', exact: true }).click()
  await expect(page.getByText(/No reconocemos ese código/)).toBeVisible()
  await page.getByRole('textbox', { name: 'Código del QR' }).fill(activo.qr)
  await page.getByRole('button', { name: 'Abrir', exact: true }).click()
  await expect(page.getByText('Abierto por QR · Camioneta CA-12')).toBeVisible()

  await responderOkNokNa(page, ITEMS_FIXTURE_A.barriers, 'OK')
  await responderOkNokNa(page, ITEMS_FIXTURE_A.senalizacion, 'OK')
  await responderTemperaturaValida(page)
  await firmarYEnviar(page)

  await context.setOffline(false)
  await forzarFlush(page)
  await esperarColaVacia(page, { timeout: 90_000 })

  const filas = await db.filas<{ asset_id: string | null; status: string }>(
    'SELECT asset_id, status FROM inspection WHERE tenant_id = $1',
    [TENANTS.A],
  )
  expect(filas).toEqual([{ asset_id: activo.id, status: 'submitted' }])
})
