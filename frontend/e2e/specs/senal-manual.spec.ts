import { expect, test } from '@playwright/test'
import { CUENTAS, loginEnApp } from '../helpers/e2e'

/* v1 (TSK-DEMO-001): el estado de señal es el de la red real; ya no existe
 * interruptor manual. La barra inferior (perfil móvil) lo muestra. */
test('la desconexión y recuperación reales se detectan sin intervención manual', async ({ page, context }) => {
  await loginEnApp(page, CUENTAS.trabajadorA)
  // Primer arranque con red hasta que la PWA termine de cachear sus pantallas.
  // Cortar antes prueba una descarga inicial incompleta, no la captura offline.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => null))
  await page.reload()
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)

  const estado = page.getByRole('status').filter({ hasText: /En línea|Sin señal/ }).last()
  await expect(estado).toContainText('En línea')
  await context.setOffline(true)
  await expect(estado).toContainText('Sin señal')
  await context.setOffline(false)
  await expect(estado).toContainText('En línea')
})
