/* Configuración de Playwright — E2E de validación (issue #10, test-plan §2/§4).
 *
 * Decisiones que no son obvias:
 *
 * · **Perfil móvil (Pixel 5).** El producto se usa en terreno, de pie, con
 *   guantes: el layout responsive, el `viewport-fit=cover` y la barra inferior
 *   fija cambian el comportamiento de la captura. Un E2E en desktop pasaría
 *   flujos que en el dispositivo real se rompen.
 *
 * · **Un solo worker.** Los caos miden invariantes globales (`0 pérdidas ∧ 0
 *   duplicados ∧ 0 fugas cross-tenant`) contados sobre UNA base compartida.
 *   Con workers en paralelo dos specs cuentan filas del mismo lote y cada
 *   uno ve una parte del trabajo del otro: los invariantes dejan de tener
 *   sentido. Además el backend serializa los lotes por diseño (FR-016).
 *
 * · **El stack NO lo levanta Playwright.** El backend necesita la URL de la
 *   base que elige Testcontainers en runtime y el frontend necesita la URL
 *   del backend para compilar `VITE_API_URL`; ninguno existe antes del
 *   arranque. `frontend/e2e/run.mjs` levanta los tres y luego invoca a
 *   Playwright, así que acá sólo se declara cómo se ejecutan los specs.
 *
 * · **Traza en fallo.** Un caos que falla a mitad de camino es el más caro de
 *   reproducir a mano: la traza queda como artefacto del nightly.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

const RAIZ = dirname(fileURLToPath(import.meta.url))

/**
 * `frontend/e2e/.stack/stack.json` lo escribe `stack.mjs` con las URLs reales
 * que eligió Testcontainers en esta corrida. Es la única fuente de verdad: si
 * el archivo falta, el stack no arrancó y el error tiene que ser obvio acá y
 * no un `ECONNREFUSED` a mitad de un caos.
 */
function leerStack() {
  const ruta = resolve(RAIZ, 'frontend', 'e2e', '.stack', 'stack.json')
  if (!existsSync(ruta)) return null
  return JSON.parse(readFileSync(ruta, 'utf8'))
}

const stack = leerStack()

const WEB_URL = process.env.E2E_WEB_URL ?? stack?.webUrl ?? 'http://127.0.0.1:4310'
const API_URL = process.env.E2E_API_URL ?? stack?.apiUrl ?? 'http://127.0.0.1:3310/api/v1'

export default defineConfig({
  testDir: './frontend/e2e/specs',
  /* Falla rápido: un caos que colgó 30 s esperando cola ya está roto. */
  timeout: 120_000,
  expect: { timeout: 15_000 },
  /* Un reintento en nightly es ruido: un caos que falló una vez es un
   * hallazgo (a veces de verdad, a veces timing). El reporte va con el
   * detalle del fallo, no con una flecha verde de un segundo intento. */
  retries: 0,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: './frontend/e2e/.stack/test-results',

  use: {
    baseURL: WEB_URL,
    /* Fotos de evidencia y cámara: el E2E no abre archivos reales, pero el
     * permiso declarado debe existir para no diferir del dispositivo. */
    permissions: [],
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    /* El producto anima con `motion/react` (entradas escalonadas, knob del
     * toggle, count-up). Animado, Playwright espera "element stable" y en el
     * formulario largo del perfil móvil eso agota el timeout sin que nada esté
     * roto. `reducedMotion` deja el layout idéntico pero sin transiciones: es
     * justo lo que el propio producto respeta vía `useReducedMotion`. */
    reducedMotion: 'reduce',
  },

  metadata: { apiUrl: API_URL },

  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],
})