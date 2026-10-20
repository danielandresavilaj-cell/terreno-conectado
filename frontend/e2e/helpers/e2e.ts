/* Utilidades compartidas por los specs E2E — issue #10.
 *
 * Tres piezas y ninguna más:
 *
 * 1. `credenciales()` — la password demo NUNCA se hardcodea (Constitución
 *    Art. IX): viene de `DEMO_PASSWORD`, la misma variable que siembra el
 *    backend. Si el operador no la exportó, el E2E falla con un mensaje
 *    explícito en vez de autenticarse contra una password inventada.
 *
 * 2. `conectarDb()` — los caos no se prueban mirando la UI: se prueban
 *    contando FILAS. La UI puede mentir (un contador que animate, un badge
 *    que dice "sincronizado" antes de que el servidor confirme). La verdad
 *    del invariante "0 pérdidas ∧ 0 duplicados" está en `inspection`,
 *    `response`, `finding`, `attachment` y `conflict_record`.
 *
 * 3. helpers de sesión/cola — encapsulan el login real (POST /auth/login) y
 *    la espera por vaciado de la cola, que es la señal observable de que el
 *    sync terminó (no hay evento de "sync finished" en el frontend: el worker
 *    escribe el estado en Dexie y la UI lo refleja).
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/* --------------------------------------------------------------- estado */

interface Stack {
  apiUrl: string
  webUrl: string
  ownerUrl: string
  appUrl: string
  startedAt: string
}

export function leerStack(): Stack {
  const ruta = resolve(RAIZ, 'frontend', 'e2e', '.stack', 'stack.json')
  if (!existsSync(ruta)) {
    throw new Error(
      'no existe frontend/e2e/.stack/stack.json.\n' +
        '    El E2E se corre con `npm run e2e` (levanta el stack completo); ' +
        '`npx playwright test` solo no alcanza.',
    )
  }
  return JSON.parse(readFileSync(ruta, 'utf8')) as Stack
}

/* ----------------------------------------------------------- credenciales */

/** Password de las cuentas demo. Viene del entorno; nunca del fuente. */
export function passwordDemo(): string {
  const p = process.env.DEMO_PASSWORD
  if (!p) {
    throw new Error(
      'DEMO_PASSWORD no está definida.\n' +
        '    Es la misma variable que usa backend/db/seed.ts para sembrar las cuentas; ' +
        'el harness no puede tener una password por omisión (Constitución Art. IX).',
    )
  }
  return p
}

/** Ítems estables de la plantilla publicada del tenant A (`backend/db/seed.ts`). */
export const ITEMS_FIXTURE_A = {
  barriers: '01890000-0000-7000-8000-00000000f101',
  senalizacion: '01890000-0000-7000-8000-00000000f102',
  temperatura: '01890000-0000-7000-8000-00000000f103',
  foto: '01890000-0000-7000-8000-00000000f109',
} as const

/**
 * Click en una opción OK/NOK/NA de un ítem.
 *
 * Se usa `exact` porque `getByRole('radio', { name: 'OK' })` también matchea
 * "N/A" (Playwright hace substring, no palabra completa) y "NOK" empieza con
 * "N"... el resultado eran 2 nodos y un strict-mode violation.
 */
export async function responderOkNokNa(page: Page, itemId: string, opcion: 'OK' | 'NOK' | 'N/A') {
  const grupo = page.getByTestId(`template-item-${itemId}`).getByRole('radiogroup')
  /* En el viewport móvil (Pixel 5) el formulario es largo: los ítems de las
   * secciones siguientes están fuera de pantalla y `motion/react` los anima al
   * aparecer. Sin traerlos a la vista, el click falla con "element is not
   * stable" o agota el timeout. */
  await grupo.scrollIntoViewIfNeeded()
  await grupo
    .getByRole('radio', { name: opcion, exact: true })
    .click()
}

/**
 * Línea de base de inspecciones del tenant, una vez que cualquier sync de
 * arranque haya terminado. Los specs generan sus propios registros y miden
 * deltas, sin depender de filas locales de demostración.
 */
export async function baseDeInspecciones(page: Page, tenantId: string): Promise<number> {
  await forzarFlush(page)
  await esperarColaVacia(page, { timeout: 60_000, permitirFallidas: true })
  const db = await conectarDb()
  return db.contar('SELECT count(*)::int AS n FROM inspection WHERE tenant_id = $1', [tenantId])
}

/**
 * Borra las respuestas locales de un ítem concreto.
 *
 * El test limpia el ítem antes de escribir para que su aserción mida sólo el
 * valor creado durante ese escenario.
 */
export async function limpiarItem(page: Page, templateItemId: string): Promise<number> {
  return page.evaluate(
    (item) =>
      new Promise<number>((ok, no) => {
        const req = indexedDB.open('terreno-conectado')
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('responses')) {
            db.close()
            return ok(0)
          }
          const tx = db.transaction('responses', 'readwrite')
          const idx = tx.objectStore('responses').index('templateItemId')
          const req2 = idx.openCursor(IDBKeyRange.only(item))
          let n = 0
          req2.onsuccess = () => {
            const cur = req2.result
            if (cur) {
              cur.delete()
              n++
              cur.continue()
            }
          }
          tx.oncomplete = () => {
            db.close()
            ok(n)
          }
          tx.onerror = () => {
            db.close()
            no(tx.error)
          }
        }
        req.onerror = () => no(req.error)
      }),
    templateItemId,
  )
}

/**
 * Dispara un flush por el camino REAL del usuario: el toggle de señal del Shell.
 *
 * Los caos que inyectan filas directamente en el outbox (caos 5) no pueden
 * esperar al evento `online` del navegador: en una página que ya está "online"
 * ese evento no vuelve a dispararse y la cola se queda en `pending` para
 * siempre. El toggle sí es un camino de producción (es el control de señal del
 * demo) y llama a la misma función de cola, así que no falsea el escenario.
 */
export async function forzarFlush(page: Page): Promise<void> {
  const interruptor = page.getByTestId('signal-toggle')
  await interruptor.scrollIntoViewIfNeeded()
  if ((await interruptor.getAttribute('aria-checked')) !== 'true') {
    await interruptor.click()
    await expect(interruptor).toHaveAttribute('aria-checked', 'true')
  }
  await interruptor.click()
  await expect(interruptor).toHaveAttribute('aria-checked', 'false')
  await page.waitForTimeout(400)
  await interruptor.click()
  await expect(interruptor).toHaveAttribute('aria-checked', 'true')
}

/** El campo numérico del ítem, ya a la vista en el viewport móvil. */
export async function campoNumerico(page: Page, itemId = ITEMS_FIXTURE_A.temperatura): Promise<Locator> {
  const campo = page.getByTestId(`template-item-${itemId}`).locator('input[inputmode="decimal"]')
  await campo.scrollIntoViewIfNeeded()
  return campo
}

/** Completa el único obligatorio no automático del fixture: temperatura (-10 a 45 °C). */
export async function responderTemperaturaValida(page: Page): Promise<void> {
  const campo = await campoNumerico(page)
  await campo.fill('18')
  await campo.blur()
  await expect(campo).toHaveValue('18')
}

/**
 * Pulsa "Enviar inspección" y espera a que el outbox reciba el lote.
 *
 * El botón vive al final del formulario largo y `motion/react` anima el
 * bloque, así que sin `scrollIntoViewIfNeeded` el click falla por inestabilidad.
 * Después del click se espera a que aparezcan filas: el encolado es
 * asíncrono y sin esta espera el assert siguiente corre contra un outbox vacío.
 */
export async function enviarInspeccion(page: Page): Promise<void> {
  const boton = page.getByRole('button', { name: 'Enviar inspección' })
  await boton.scrollIntoViewIfNeeded()
  await boton.click()
  await expect
    .poll(async () => (await leerCola(page)).total, {
      timeout: 15_000,
      message: 'el click en "Enviar inspección" no encoló nada',
    })
    .toBeGreaterThan(0)
}

export const CUENTAS = {
  trabajadorA: 'trabajador@minera.cl',
  supervisorA: 'supervisor@minera.cl',
  adminA: 'admin@minera.cl',
  trabajadorB: 'trabajador@andes.cl',
  supervisorB: 'supervisor@andes.cl',
  plataforma: 'admin@terreno.local',
} as const

export const TENANTS = {
  A: '01890000-0000-7000-8000-0000000000a1',
  B: '01890000-0000-7000-8000-0000000000b1',
} as const

export const SITES = {
  A: '01890000-0000-7000-8000-0000000000a2',
  B: '01890000-0000-7000-8000-0000000000b2',
} as const

/* ------------------------------------------------------------------ API */

/** `POST /auth/login` contra la API real → token para el `request` de Playwright. */
export async function autenticar(
  request: APIRequestContext,
  email: string,
): Promise<{ token: string; userId: string; tenantId: string | null; role: string }> {
  const { apiUrl } = leerStack()
  const resp = await request.post(`${apiUrl}/auth/login`, {
    data: { email, password: passwordDemo() },
  })
  if (!resp.ok()) {
    throw new Error(`login de ${email} falló: HTTP ${resp.status()} ${await resp.text()}`)
  }
  const body = (await resp.json()) as {
    access_token: string
    user: { id: string; tenant_id: string | null; role: string }
  }
  return {
    token: body.access_token,
    userId: body.user.id,
    tenantId: body.user.tenant_id,
    role: body.user.role,
  }
}

/** Login dentro de la app (UI) — el camino que un usuario de terreno recorre. */
export async function loginEnApp(page: Page, email: string): Promise<void> {
  /* La app puede arrancar de dos formas: restaurando la sesión desde la caché
   * Dexie (FR-006, el caso de reabrir la pestaña) o mostrando el login. Se
   * espera a que se decida una de las dos antes de tocar nada: consultar antes
   * de que termine de hidrataría un falso "no hay sesión" y después no
   * habría formulario sobre el que trabajar. */
  await page.goto('/')
  /* La señal de "ya adentro" es que el FORMULARIO de login no aparezca, no que
   * la barra de navegación exista: durante la hidratación el Shell todavía no
   * está montado y una espera por la nav expira sin decir nada. */
  const login = page.getByRole('heading', { name: 'Iniciar sesión' })
  const hayLogin = await login
    .waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false)
  if (hayLogin) {
    const pass = passwordDemo()
    await page.getByRole('button', { name: new RegExp(correoANombre(email).split(' ')[0]) }).click()
    await page.getByRole('textbox', { name: 'Correo' }).fill(email)
  /* El campo de contraseña se busca por SU TIPO, no por etiqueta: en
   * `screens/Login.tsx` el `<label>` envuelve un `<span>` "Contraseña" y el
   * `<input>`, así que `getByLabel` resuelve a dos nodos y Playwright se niega
   * a adivinar. Además el botón "Mostrar contraseña" matchea el mismo texto. */
    await page.locator('input[type="password"]').fill(pass)
    await page.getByRole('button', { name: 'Entrar' }).click()
  /* La pantalla posterior al login depende del rol: el trabajador llega a la
   * selección de formularios y los perfiles de gestión a sus vistas. Lo que no
   * puede seguir visible es el propio formulario de login. */
    try {
      await page.getByRole('heading', { name: 'Iniciar sesión' }).waitFor({ state: 'detached' })
    } catch (e) {
      console.log('DIAG login body:', (await page.locator('body').innerText()).slice(0, 300).replace(/\n+/g, ' | '))
      throw e
    }
  }
  /* "Iniciar sesión" es el `<h1>` del formulario (`Login.tsx`), NO un botón:
   * esperarlo por rol button nunca se cumplía. Y sólo con eso no alcanza:
   * durante la hidratación la pantalla de login sigue montada mientras
   * `arrancarSesión` siembra Dexie y pide las plantillas, así que además se
   * espera a que aparezca la barra de navegación del Shell. */
  await page.locator('nav button').first().waitFor({ state: 'visible' })
  if (email === CUENTAS.trabajadorA || email === CUENTAS.trabajadorB) {
    await abrirFormularioAsignado(page)
  }
}

/** Recorre la selección explícita de un formulario antes de capturarlo. */
async function abrirFormularioAsignado(page: Page): Promise<void> {
  const enviar = page.getByRole('button', { name: 'Enviar inspección' })
  if (await enviar.isVisible({ timeout: 500 }).catch(() => false)) return

  await page.getByRole('heading', { name: 'Elegí qué vas a inspeccionar' }).waitFor({ state: 'visible' })
  const abrir = page
    .getByRole('button', { name: /^(Usar este formulario|Abrir formulario|Continuar formulario)$/ })
    .first()
  await expect(abrir).toBeVisible()
  await abrir.click()
  await expect(enviar).toBeVisible()
}

function correoANombre(correo: string): string {
  const tabla: Record<string, string> = {
    [CUENTAS.trabajadorA]: 'Pedro Trabajador',
    [CUENTAS.supervisorA]: 'Sofía Supervisora',
    [CUENTAS.adminA]: 'Andrés Admin',
    [CUENTAS.trabajadorB]: 'Bárbara Trabajadora',
    [CUENTAS.supervisorB]: 'Bruno Supervisor',
    [CUENTAS.plataforma]: 'Operación Plataforma',
  }
  return tabla[correo] ?? correo
}

/* ------------------------------------------------------------------- DB */

export interface Db {
  contar(sql: string, valores?: unknown[]): Promise<number>
  filas<T = Record<string, unknown>>(sql: string, valores?: unknown[]): Promise<T[]>
  limpiar(sql: string, valores?: unknown[]): Promise<void>
}

/**
 * Conexión **owner** (bypassa RLS): es la única forma de contar filas de los
 * dos tenants a la vez y comprobar que el registro del tenant B NO apareció
 * — que es justamente el invariante del caos 7.
 */
export async function conectarDb(): Promise<Db> {
  const { Pool } = await import('pg')
  const { ownerUrl } = leerStack()
  const pool = new Pool({ connectionString: ownerUrl, max: 4 })
  return {
    async contar(sql, valores) {
      const r = await pool.query(sql, valores)
      return Number(r.rows[0].n)
    },
    async filas<T>(sql: string, valores?: unknown[]) {
      const r = await pool.query(sql, valores)
      return r.rows as T[]
    },
    async limpiar(sql, valores) {
      await pool.query(sql, valores)
    },
  }
}

/* ------------------------------------------------------------- la app */

/**
 * Lee un store de la base local por nombre. Va por IndexedDB crudo (no por
 * `lib/db.ts`) a propósito: el E2E sirve el build de producción, donde ese
 * módulo está empaquetado y no es alcanzable desde el navegador; y leer por
 * debajo de Dexie es lo correcto para un caos, porque no depende de que la app
 * esté cooperando.
 */
const LEER_STORE = (store: string): Promise<unknown[]> =>
  new Promise((ok, no) => {
    const req = indexedDB.open('terreno-conectado')
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(store)) {
        db.close()
        return ok([])
      }
      const r = db.transaction(store, 'readonly').objectStore(store).getAll()
      r.onsuccess = () => {
        db.close()
        ok(r.result as unknown[])
      }
      r.onerror = () => {
        db.close()
        no(r.error)
      }
    }
    req.onerror = () => no(req.error)
  })

/** Filas crudas de un store de la base local. */
export async function leerStore<T>(page: Page, store: string): Promise<T[]> {
  return (await page.evaluate(LEER_STORE, store)) as T[]
}

/** Cuántas filas hay en un store. */
export async function contarStore(page: Page, store: string): Promise<number> {
  const filas = await leerStore<unknown>(page, store)
  return filas.length
}

/** Estado del outbox leído de Dexie (la verdad local, sin pasar por la UI).
 *
 * Se lee con la API de IndexedDB cruda y NO importando `lib/db.ts`: el E2E
 * sirve el build de producción, donde Vite empaquetó ese módulo y no existe
 * una ruta alcanzable desde el navegador. Y leer la base por debajo de Dexie es
 * lo correcto para un caos: no depende de que la app esté cooperando, que es
 * justo lo que un "reinicio hostil" (caos 4) pone a prueba.
 *
 * Esquema: `frontend/src/lib/db.ts` v2 — store `outbox`, columna `status`.
 */
export interface EstadoCola {
  /** Filas en cualquier estado distinto de `synced`. */
  pendientes: number
  fallidas: number
  /** Total de filas, `synced` incluidas. Con red el worker sube el lote casi al
   *  instante, así que "se encoló algo" hay que medirlo acá y no sobre
   *  `pendientes`, que para entonces ya volvió a cero. */
  total: number
  porEstado: Record<string, number>
}

export async function leerCola(page: Page): Promise<EstadoCola> {
  const filas = await leerStore<{ status: string }>(page, 'outbox')
  const porEstado: Record<string, number> = {}
  for (const f of filas) porEstado[f.status] = (porEstado[f.status] ?? 0) + 1
  return {
    pendientes: filas.filter((f) => f.status !== 'synced').length,
    fallidas: filas.filter((f) => f.status === 'failed').length,
    total: filas.length,
    porEstado,
  }
}

/** Filas del outbox crudas (contenido incluido) para inspeccionar el lote. */
export async function filasOutbox(
  page: Page,
): Promise<Array<{ entityType: string; entityId: string; status: string; retries: number }>> {
  return leerStore(page, 'outbox')
}

/**
 * Lee un store de la base local por nombre. Va por IndexedDB crudo (no por
 * `lib/db.ts`) a propósito: el E2E sirve el build de producción, donde ese
 * módulo está empaquetado y no es alcanzable desde el navegador; y leer por
 * debajo de Dexie es lo correcto para un caos, porque no depende de que la app
 * esté cooperando.
 */
/** Adjuntos locales con sus dimensiones ya comprimidas (FR-012). */
export async function leerAdjuntos(
  page: Page,
): Promise<Array<{ id: string; ownerType: string; ancho: number; alto: number; bytes: number }>> {
  return leerStore(page, 'attachments')
}

/** Respuestas locales (para verificar qué se persistió sin pasar por la UI). */
export async function leerRespuestas(
  page: Page,
): Promise<Array<{ id: string; templateItemId: string; valueNumber: number | null }>> {
  return leerStore(page, 'responses')
}

/**
 * Vacía el outbox local antes de cada escenario. La aplicación parte sin
 * registros de prueba: cada spec debe crear únicamente los datos que mide.
 */
export async function vaciarCola(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((ok, no) => {
        const req = indexedDB.open('terreno-conectado')
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('outbox')) {
            db.close()
            return ok(0)
          }
          const tx = db.transaction('outbox', 'readwrite')
          const store = tx.objectStore('outbox')
          const cuenta = store.count()
          store.clear()
          tx.oncomplete = () => {
            db.close()
            ok(cuenta.result)
          }
          tx.onerror = () => {
            db.close()
            no(tx.error)
          }
        }
        req.onerror = () => no(req.error)
      }),
  )
}

/**
 * Espera a que la cola local quede vacía. El signal observable es el estado
 * de las filas: el worker marca `synced` sólo cuando el servidor confirmó
 * (o devolvió `records_unchanged` en un replay).
 */
export async function esperarColaVacia(
  page: Page,
  opciones: { timeout?: number; permitirFallidas?: boolean } = {},
): Promise<EstadoCola> {
  const { timeout = 45_000, permitirFallidas = false } = opciones
  const limite = Date.now() + timeout
  let ultimo: EstadoCola = { pendientes: -1, fallidas: -1, total: -1, porEstado: {} }
  while (Date.now() < limite) {
    ultimo = await leerCola(page)
    /* "Vacía" significa `synced`: nada en `pending`, `failed` NI `syncing`.
     * `syncing` es un estado trampa — si el worker se cuelga a mitad del
     * envío, las filas quedan ahí para siempre y un `fallidas === 0` las
     * daría por buenas (el bug real que encontró este helper). */
    const listo = permitirFallidas
      ? ultimo.pendientes === 0
      : ultimo.pendientes === 0 && (ultimo.porEstado.syncing ?? 0) === 0
    if (listo) return ultimo
    await page.waitForTimeout(300)
  }
  throw new Error(
    `la cola no quedó vacía en ${timeout / 1000}s ` +
      `(último estado: ${JSON.stringify(ultimo.porEstado)}, fallidas: ${ultimo.fallidas})`,
  )
}

/** Deja la app lista para una corrida: base local limpia, sin sesión. */
export async function reiniciarDispositivo(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((ok) => {
        // Primero abre (y cierra) la base: Dexie mantiene un pool abierto y
        // una versión "hot" del esquema que bloquea el borrado si no se
        // cierra antes. Si el store no existe, el borrado es un no-op.
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
