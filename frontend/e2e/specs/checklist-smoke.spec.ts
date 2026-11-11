/* Validación manual automatizada — issue #130 (checklist §1 «⭐ Humo»).
 *
 * Recorre H-01…H-10 en UNA sola pasada con un dispositivo (igual que la guía),
 * usando los helpers de `frontend/e2e/helpers/e2e.ts`. Todo se observa por UI y
 * por la IndexedDB local.
 *
 * Entorno: BUILD DE PRODUCCIÓN (PWA) servido con `vite preview` — también sirve
 * el stack ya levantado (API :3000). NO es opcional: el bloque offline
 * (H-02…H-08) no se puede validar contra el server de desarrollo de Vite porque
 * ahí no hay service worker y, sin él, recargar offline no carga ni el documento
 * (`ERR_INTERNET_DISCONNECTED`) ni los chunks perezosos. El SW de `vite-plugin-pwa`
 * precachea `index.html` y todas las pantallas, que es justo lo que hace que
 * offline-first funcione. Requisitos:
 *   npm run build --workspace @terreno/frontend
 *   npx vite preview --port 4173 --strictPort       (en frontend/)
 *   ALLOWED_ORIGIN debe incluir http://localhost:4173 (backend/.env y reinicio)
 *
 * La pasada parte con una cola local limpia y genera su propia evidencia. Así
 * los contadores no dependen de datos de demostración preexistentes.
 */

import { expect, test, type Page } from '@playwright/test'

import {
  CUENTAS,
  ITEMS_FIXTURE_A,
  contarStore,
  enviarInspeccion,
  esperarColaVacia,
  leerAdjuntos,
  leerCola,
  loginEnApp,
  responderOkNokNa,
  responderTemperaturaValida,
  vaciarCola,
} from '../helpers/e2e'

const HALLAZGO = 'Validación #130 · falta señalización en la ruta de evacuación'
const BITACORA = 'Validación #130 · turno cerrado sin novedades'

/** Genera un JPEG grande (3000×2000) para probar la compresión en el device. */
async function adjuntarFoto(page: Page): Promise<void> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 3000
    canvas.height = 2000
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('sin canvas 2D')
    const g = ctx.createLinearGradient(0, 0, 3000, 2000)
    g.addColorStop(0, '#1f2937')
    g.addColorStop(1, '#9ca3af')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 3000, 2000)
    const blob = await new Promise<Blob>((ok, no) => {
      canvas.toBlob((b) => (b ? ok(b) : no(new Error('toBlob'))), 'image/jpeg', 0.92)
    })
    const buf = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (const b of buf) bin += String.fromCharCode(b)
    return btoa(bin)
  })
  await page.getByRole('button', { name: 'Tomar foto', exact: true }).click()
  await page.getByRole('dialog', { name: 'Tomar fotografía' }).locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: 'evidencia.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(base64, 'base64'),
  })
}

async function salir(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Salir' }).click()
  await page.getByRole('heading', { name: 'Iniciar sesión' }).waitFor({ state: 'visible' })
}

test.describe('Checklist §1 — ⭐ Humo H-01…H-10 (issue #130)', () => {
  test('una pasada, un dispositivo', async ({ page, context }) => {
    test.setTimeout(240_000)

    await test.step('H-01 · Iniciar sesión (trabajador A)', async () => {
      await loginEnApp(page, CUENTAS.trabajadorA)
      await expect(page.getByRole('heading', { name: 'Chequeo de seguridad minera' })).toBeVisible()
      await expect(
        page.getByTestId(`template-item-${ITEMS_FIXTURE_A.barriers}`).getByRole('radiogroup'),
      ).toBeVisible()

      const c = await leerCola(page)
      console.log(`[H-01] cola inicial: total=${c.total} pendientes=${c.pendientes} estados=${JSON.stringify(c.porEstado)}`)
    })

    await test.step('Preparación · pre-calentar pantallas y limpiar la cola', async () => {
      // Pre-calentar los chunks perezosos: en la PWA el SW ya los precacheó,
      // pero abrirlos deja además la línea base lista antes de cortar la señal.
      await page.getByRole('button', { name: 'Bitácora', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Nueva entrada' })).toBeVisible()
      await page.getByRole('button', { name: 'Cola', exact: true }).click()
      await expect(page.getByText('FR-013 · Outbox local')).toBeVisible()
      await page.getByRole('button', { name: 'Inspección', exact: true }).click()
      await expect(
        page.getByTestId(`template-item-${ITEMS_FIXTURE_A.barriers}`).getByRole('radiogroup'),
      ).toBeVisible()
      // Línea base: medir sólo lo que captura este recorrido.
      const borradas = await vaciarCola(page)
      console.log(`[setup] filas retiradas del outbox: ${borradas}`)
    })

    await test.step('H-02 · Cortar la señal', async () => {
      const sw = page.getByTestId('signal-toggle')
      await sw.scrollIntoViewIfNeeded()
      if ((await sw.getAttribute('aria-checked')) === 'true') await sw.click()
      await expect(sw).toHaveAttribute('aria-checked', 'false')
      await expect(page.getByText('Sin señal', { exact: true }).first()).toBeVisible()
      await context.setOffline(true) // modo avión real del dispositivo
    })

    await test.step('H-03 · Capturar con hallazgo', async () => {
      await responderOkNokNa(page, ITEMS_FIXTURE_A.barriers, 'OK')
      await responderOkNokNa(page, ITEMS_FIXTURE_A.senalizacion, 'NOK')
      await responderTemperaturaValida(page)
      await page.getByRole('button', { name: /registrar hallazgo/i }).first().click()
      await page.getByRole('button', { name: 'Alta', exact: true }).click()
      await page.locator('textarea').first().fill(HALLAZGO)
      await page.getByRole('button', { name: 'Guardar hallazgo' }).click()
      await expect.poll(() => contarStore(page, 'findings'), { timeout: 15_000 }).toBeGreaterThan(0)
    })

    await test.step('H-04 · Adjuntar foto', async () => {
      const antes = (await leerAdjuntos(page)).length
      await adjuntarFoto(page)
      await expect
        .poll(async () => (await leerAdjuntos(page)).length, { timeout: 20_000 })
        .toBeGreaterThan(antes)
    })

    await test.step('H-05 · Enviar sin señal', async () => {
      await enviarInspeccion(page)
      expect((await leerCola(page)).pendientes).toBeGreaterThan(0)
    })

    await test.step('H-06 · Bitácora de fin de turno', async () => {
      await page.getByRole('button', { name: 'Bitácora', exact: true }).click()
      await page.getByRole('button', { name: 'Nueva entrada' }).click()
      await page.locator('textarea').first().fill(BITACORA)
      await page.getByRole('button', { name: 'Clima', exact: true }).click()
      await page.getByRole('button', { name: 'Guardar entrada' }).click()
      await expect(page.locator('article').filter({ hasText: BITACORA })).toBeVisible()
    })

    await test.step('H-07 · Cerrar y reabrir (persistencia)', async () => {
      const antes = (await leerCola(page)).pendientes
      expect(antes).toBeGreaterThan(0)
      await page.reload()
      await expect
        .poll(async () => (await leerCola(page)).pendientes, { timeout: 20_000 })
        .toBe(antes)
      await page.getByRole('button', { name: 'Bitácora', exact: true }).click()
      await expect(page.locator('article').filter({ hasText: BITACORA })).toBeVisible()
    })

    await test.step('H-08 · Volver la señal (sync automático)', async () => {
      await context.setOffline(false)
      const estado = await esperarColaVacia(page, { timeout: 90_000 })
      expect(estado.pendientes).toBe(0)
      await expect(page.getByText('En línea', { exact: true }).first()).toBeVisible()
    })

    await test.step('H-09 · El supervisor ve el dato', async () => {
      await salir(page)
      await loginEnApp(page, CUENTAS.supervisorA)
      await expect(page.getByRole('heading', { name: 'Inspecciones por estado' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Hallazgos por severidad' })).toBeVisible()
      await expect.soft(page.getByText(HALLAZGO).first()).toBeVisible()
    })

    await test.step('H-10 · Aislamiento (tenant B)', async () => {
      await salir(page)
      await loginEnApp(page, CUENTAS.trabajadorB)
      await expect(page.getByRole('heading', { name: 'Inspección de obra' })).toBeVisible()
      await expect(
        page.getByRole('heading', { name: 'Chequeo de seguridad minera' }),
      ).toHaveCount(0)
    })
  })
})

test.describe('Tabs por perfil (FW-05 / SU / AD-02 / PA-01)', () => {
  const verTabs = async (page: Page, email: string) => {
    await loginEnApp(page, email)
    const nav = page.locator('nav button')
    await expect(nav.first()).toBeVisible()
    return nav.allInnerTexts()
  }

  test('trabajador A · Inspección, Bitácora, Cola', async ({ page }) => {
    const tabs = await verTabs(page, CUENTAS.trabajadorA)
    for (const t of ['Inspección', 'Bitácora', 'Cola']) expect(tabs).toContain(t)
    for (const t of ['Gerencia', 'Conflictos', 'Plantillas', 'Importar']) expect(tabs).not.toContain(t)
  })

  test('supervisor A · + Gerencia y Conflictos', async ({ page }) => {
    const tabs = await verTabs(page, CUENTAS.supervisorA)
    for (const t of ['Inspección', 'Bitácora', 'Cola', 'Gerencia', 'Conflictos']) expect(tabs).toContain(t)
    for (const t of ['Plantillas', 'Importar']) expect(tabs).not.toContain(t)
  })

  test('admin A · + Plantillas e Importar (sin captura)', async ({ page }) => {
    const tabs = await verTabs(page, CUENTAS.adminA)
    for (const t of ['Gerencia', 'Cola', 'Conflictos', 'Plantillas', 'Importar']) expect(tabs).toContain(t)
    for (const t of ['Inspección', 'Bitácora']) expect(tabs).not.toContain(t)
  })

  test('plataforma · solo Gerencia (sin UI de captura ni admin de tenant)', async ({ page }) => {
    const tabs = await verTabs(page, CUENTAS.plataforma)
    expect(tabs).toEqual(['Gerencia'])
    await expect(page.getByRole('heading', { name: 'Operación Plataforma' })).toBeVisible()
  })
})
