/* TSK-DOM-008 (FR-067) — el responsable de un hallazgo se entera y lo reporta.
 *
 * Supervisión asigna un hallazgo (API real). El trabajador entra a la app, ve el
 * aviso de "nuevo", abre la pestaña Hallazgos, lo empieza y reporta lo que hizo.
 * Supervisión lo ve como listo para revisar (reporte y hora en el listado).
 */

import { uuidv7 } from '@terreno/shared'
import { expect, test } from '@playwright/test'

import { CUENTAS, SITES, TENANTS, autenticar, leerStack, loginEnApp } from '../helpers/e2e'

/** Plantilla sembrada del tenant A (`backend/db/seed.ts`). */
const TEMPLATE_A = '01890000-0000-7000-8000-0000000000a6'

test('supervisión asigna, el trabajador lo ve, lo empieza y lo reporta (FR-067)', async ({ page, request }) => {
  const { apiUrl } = leerStack()
  const trabajador = await autenticar(request, CUENTAS.trabajadorA)
  const supervisor = await autenticar(request, CUENTAS.supervisorA)
  const inspeccion = uuidv7()
  const hallazgo = uuidv7()
  const descripcion = `E2E FR-067 · cable expuesto en tablero ${hallazgo.slice(-6)}`
  const ahora = new Date().toISOString()

  const lote = await request.post(`${apiUrl}/sync/batch`, {
    headers: { Authorization: `Bearer ${trabajador.token}` },
    data: {
      batch_id: uuidv7(),
      device_id: uuidv7(),
      records: [
        {
          entity_type: 'inspection',
          id: inspeccion,
          tenant_id: TENANTS.A,
          client_version: 1,
          captured_at: ahora,
          payload: {
            site_id: SITES.A,
            template_id: TEMPLATE_A,
            template_version: 1,
            executed_by: trabajador.userId,
            status: 'submitted',
            location: null,
            requires_supervisor_signature: false,
          },
        },
        {
          entity_type: 'finding',
          id: hallazgo,
          tenant_id: TENANTS.A,
          client_version: 1,
          captured_at: ahora,
          payload: { inspection_id: inspeccion, response_id: null, severity: 'high', description: descripcion, status: 'open' },
        },
      ],
    },
  })
  expect(lote.ok(), await lote.text()).toBe(true)

  const asignacion = await request.patch(`${apiUrl}/findings/${hallazgo}`, {
    headers: { Authorization: `Bearer ${supervisor.token}` },
    data: { assignee_id: trabajador.userId },
  })
  expect(asignacion.ok(), await asignacion.text()).toBe(true)

  await loginEnApp(page, CUENTAS.trabajadorA)
  // El aviso llega solo al entrar con señal (punto de la pestaña).
  await expect(page.locator('#nav-hallazgos-nuevos')).toHaveText(/nuevo/, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Hallazgos', exact: true }).click()
  await page.getByRole('button', { name: new RegExp(descripcion) }).click()
  await expect(page.getByRole('dialog', { name: descripcion })).toBeVisible()

  await page.getByRole('button', { name: 'Empezar' }).click()
  await expect(page.getByText('Marcado como en curso.')).toBeVisible()

  await page.getByRole('textbox', { name: '¿Qué hiciste?' }).fill('Se aisló el cable y se cerró el tablero')
  await page.getByRole('button', { name: 'Reportar lo que hice' }).click()
  await expect(page.getByText(/Supervisión verá tu reporte/)).toBeVisible()

  const panel = await request.get(`${apiUrl}/dashboard/findings`, {
    headers: { Authorization: `Bearer ${supervisor.token}` },
  })
  expect(panel.ok()).toBe(true)
  const { items } = (await panel.json()) as {
    items: Array<{ id: string; status: string; progress_note: string | null; reported_at: string | null }>
  }
  const fila = items.find((h) => h.id === hallazgo)
  expect(fila).toMatchObject({ status: 'in_progress', progress_note: 'Se aisló el cable y se cerró el tablero' })
  expect(fila?.reported_at).toBeTruthy()
})
