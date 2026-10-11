import { defineConfig } from 'vitest/config'

/**
 * Tests del cliente (TSK-FORM-009).
 *
 * `db.ts` no toca globales de navegador a nivel de módulo, así que la capa de
 * caché se prueba en Node con `fake-indexeddb` en lugar de levantar un DOM:
 * menos superficie y tests más rápidos. Lo que sí necesita navegador real
 * (PWA, Service Worker, Safari iOS en faena) queda como E2E manual — está
 * escrito en `test-plan.md` y no lo simula este runner.
 *
 * `environment: 'node'` es deliberado: si un test necesita DOM, es una señal de
 * que la lógica está en el componente y debería bajarse a `lib/plantillas.ts`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
})