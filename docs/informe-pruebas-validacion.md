# Informe de resultados de validación — Fase 2

**Issue:** #10 (pruebas de validación) · **Cierra también:** #12 (red-team, test-plan §5)
**Fecha:** 2026-10-13 · **Alcance:** módulo 007 y el walking skeleton (TSK-WS-001→012)
**Relacionado:** [`test-plan.md`](../test-plan.md) §3 (matriz) y §4 (caos 1–7)

---

## 1. Resumen ejecutivo

Se montó el harness E2E que el proyecto no tenía y con él se ejecutó el
protocolo de caos de `test-plan.md` §4 contra la aplicación real. El resultado
tiene dos mitades:

1. **La evidencia de validación existe y es reproducible**: 17 E2E + 245 tests
   en total, la matriz §3 con el 89,7% de filas en verde y los 7 escenarios de
   caos pasando.
2. **El protocolo encontró seis defectos en la aplicación**, dos de ellos lo
   suficientemente graves como para que **la app no arrancara para un usuario
   nuevo**. Ninguno era visible leyendo el código: aparecieron al ejecutarla.

El segundo punto es el que más pesa para la entrega de Fase 3. El plan de
pruebas no era un trámite: encontró dos fallas que habrían llegado a la demo.

## 2. Qué se construyó

| Pieza | Ruta | Qué hace |
| :--- | :--- | :--- |
| Configuración | `playwright.config.ts` | Perfil **móvil** (Pixel 5), un worker, traza y vídeo en fallo |
| Orquestador | `frontend/e2e/stack.mjs` | PostgreSQL 16 (Testcontainers) → migraciones → seed → backend `dist/` → `vite preview` |
| Runner | `frontend/e2e/run.mjs` | Levanta el stack, corre Playwright y **apaga todo pase lo que pase** |
| Helpers | `frontend/e2e/helpers/e2e.ts` | Login por la UI, acceso a la base, lectura del outbox, flush |
| Specs | `frontend/e2e/specs/*.spec.ts` | 17 tests: captura offline + caos 1–7 |
| CI | `.github/workflows/e2e.yml` | **Nightly 03:17 UTC** + `workflow_dispatch`. Nunca en `pull_request` |
| Comando | `npm run e2e` | Todo lo anterior en un paso |

**Decisión de diseño que conviene conocer:** el job E2E **no** corre en los PRs.
`.github/workflows/ci.yml` no se tocó. La capa rápida (lint, typecheck, build,
tests de integración) sigue igual para todos; la capa lenta (Postgres +
backend + navegador) vive aparte y avisa por su cuenta. Un rojo de E2E no
bloquea un merge cuyo CI normal está verde, que es lo que se pidió.

**Secretos (Constitución Art. IX):** `DEMO_PASSWORD` y `JWT_ACCESS_SECRET`
llegan por variables de entorno y el harness **falla ruidosamente** si faltan.
No hay contraseña por omisión en ningún archivo.

## 3. Resultados por módulo

### 3.1 Walking skeleton — captura offline (TSK-WS-001→012)

| Requisito | Prueba | Estado |
| :--- | :--- | :--- |
| FR-011/014 | Captura sin red, recarga, el borrador conserva las respuestas | 🟢 |
| FR-016 | Al volver la señal la cola drena **sin** tocar el botón de sincronizar | 🟢 |
| FR-018 | Con la red apagada la plantilla cacheada sigue renderizando | 🟢 |
| FR-024 | El lote deja rastro en `sync_log` con totales que cuadran | 🟢 |
| FR-031/032 | `submitted` con el `site_id` real; el hallazgo de un NOK sube con su inspección | 🟢 |
| FR-036 | La plantilla publicada renderiza los **8** tipos de campo | 🟢 |
| FR-039 | Un valor fuera de rango se rechaza **en el dispositivo** y no llega a la cola | 🟢 |
| FR-012 | La foto se comprime a ≤1280 px antes de encolar | 🟢 |

### 3.2 Motor de sincronización — caos §4

| # | Escenario | Resultado |
| :-- | :--- | :--- |
| 1 | Corte a mitad de envío → reconexión sola | 🟢 cero pérdidas, cero duplicados |
| 2 | Replay del mismo lote 3 veces | 🟢 `records_unchanged`, conteo de filas idéntico |
| 5 | 200 registros pendientes (NFR-02) | 🟢 los 200 llegan íntegros |
| 6 | Token expirado con cola pendiente | 🟢 la cola no se pierde y drena al reingresar |
| 3 | Edición concurrente en dos dispositivos | 🟢 gana el LWW y queda `CONFLICT_RECORD` con **ambas** versiones |
| 4 | Reinicio hostil con el outbox a medio escribir | 🟢 las filas siguen íntegras y drenan |
| 7 | JWT de A con payload de B | 🟢 409 + `audit_log`, y el tenant B no vio nada |

**Criterio global de §4 (`0 pérdidas ∧ 0 duplicados ∧ 0 fugas cross-tenant`):
cumplido en los siete escenarios.**

### 3.3 Módulo 007 — formularios dinámicos

Las filas de FR-018/019/027/028/029/036/037/044–049 que la matriz §3 declara en
verde están cubiertas por la suite de integración existente
(`templates.delta.spec.ts`, `templates.http.spec.ts`, `import-wizard.spec.ts`,
`inspection-export*.spec.ts`) y por la unidad de `shared`. El harness E2E de este
issue no las re-verifica: su alcance fueron los caos del motor de sincronización
y el arranque offline, que es donde estaban los huecos.

## 4. Matriz §3 en números

```
29 filas  ·  🟢 26 (89,7%)  ·  🟡 1  ·  🔴 1  ·  ⚪ 1
```

| Estado | Filas | Qué significa |
| :--- | :--- | :--- |
| 🟢 | 26 | Prueba automatizada existente y en verde |
| 🟡 | 1 | FR-040/043: la corrección numérica ≤60 s se mide en la demo en vivo, no en automatizado |
| 🔴 | 1 | NFR-07 (Lighthouse CI + k6): requiere tooling externo al harness |
| ⚪ | 1 | Automatizable sólo con herramientas de terceros |

**Sobre el umbral de Fase 2** (`§8`: "matriz §3 ≥ 90% verde"): el techo
alcanzable dentro de este harness es **96,6%**, porque la única fila que queda
fuera (NFR-07) necesita Lighthouse y k6, que no son parte del Playwright. Si se
cuenta esa fila como pendiente real, el número es 89,7%. Se declara el número
real y no uno redondeado a favor.

## 5. Defectos encontrados por el protocolo (issue #12)

Detalle completo en [`test-plan.md`](../test-plan.md) §5.1. Resumen:

| # | Severidad | Efecto |
| :-- | :--- | :--- |
| H1 | Crítica | El **login completo se caía** en el primer arranque de cada dispositivo |
| H2 | Alta | Un corte de red dejaba el lote atrapado en `syncing` para siempre |
| H3 | Alta | Una red que acepta pero no responde colgaba el worker indefinidamente |
| H4 | Alta | El **primer sync de todo usuario nuevo** era rechazado con 400 |
| H5 | Alta | El ataque cross-tenant podía hacerse **sin dejar rastro** en la auditoría |
| H6 | Media | Al reabrir, nada indicaba si la sesión se había restaurado |

Todos corregidos en este mismo PR, **cada uno con su prueba de regresión** en el
harness. H5 es el que más importa para el Artículo V: no era un fallo de
aislamiento (RLS seguía protegiendo los datos) sino un fallo de **rastro**: el
rechazo nunca llegaba a `audit_log`, así que un atacante podía tantear el tenant
ajeno con peticiones invisibles.

## 6. Cobertura de los tiempos

| Capa | Tests | Dónde corre |
| :--- | :--- | :--- |
| E2E + caos | 17 | Nightly + `workflow_dispatch` |
| Integración backend | 159 | CI en cada push (Testcontainers) |
| Unidad `shared` | 69 | CI en cada push |
| **Total** | **245** | |

## 7. Qué falta para cerrar Fase 2

1. **NFR-07** — Lighthouse CI (móvil ≥ 80) y la medición de interacción de
   formulario < 200 ms. Es tooling aparte; este harness no lo cubre.
2. **FR-040/043** — la latencia ≤60 s del primer lote se verifica en la demo en
   vivo, no en automatizado.

El **nightly ya corrió en GitHub** (2026-10-13). La primera corrida destapó un
defecto de wiring del propio workflow: el paso `npm run build` no inyectaba
`VITE_DEMO_PASSWORD` ni `VITE_API_URL` (variables de build de Vite, ver §8), así
que el bundle arrancaba en blanco y los 17 specs fallaban. Corregido en #103; con
el fix el workflow queda **17/17 en verde** en `main`.

## 8. Cómo reproducir

```bash
# Requisitos: Docker corriendo y las variables de entorno defined
export DEMO_PASSWORD='...'
export JWT_ACCESS_SECRET='...'   # 32 bytes o más
# El bundle de Vite incrusta estas dos en tiempo de BUILD (seed.ts lanza sin
# VITE_DEMO_PASSWORD); `vite preview` no las lee. Sin ellas el build arranca en blanco.
export VITE_DEMO_PASSWORD="$DEMO_PASSWORD"
export VITE_API_URL='http://127.0.0.1:3310/api/v1'

npm ci
npm run build                   # backend/dist + bundle de Vite (con las VITE_* de arriba)
npm run e2e
```

En CI el mismo `npm run e2e` corre en el workflow nightly, con los secretos
desde `Settings → Secrets → Actions` (`E2E_DEMO_PASSWORD`, `E2E_JWT_SECRET`).

Un solo test:

```bash
npm run e2e -- --grep "caos 7"
```

Trazas, vídeo y `error-context.md` (el DOM real del momento del fallo) quedan en
`frontend/e2e/.stack/test-results/` y se publican como artefacto cuando el
nightly falla.

---

## 9. Validación manual V1 — checklist #130 (⭐ H-01…H-10)

> Ejecutada el **2026-10-15** sobre `main` (`c7f616b`), automatizando el bloque
> **⭐ Humo (H-01…H-10)** y la **matriz rol × pantalla (§4)** del
> [`checklist-validacion-manual.md`](./checklist-validacion-manual.md) (issue
> #130). El recorrido vive en
> `frontend/e2e/specs/checklist-smoke.spec.ts` (5 tests, reejecutable).

### 9.1 Entorno

- API `:3000` (build de `c7f616b`) + Postgres 16 (Docker) + **build de
  producción** de la PWA servido con `vite preview :4173`.
- **Offline real** (`context.setOffline`), no el interruptor mock. Es la única
  forma de ejercitar de verdad FR-011/014/016/017 en el reload: sólo el service
  worker de `vite-plugin-pwa` puede servir `index.html` sin red (ver F-02).
- Cómo repetirlo:

  ```bash
  npm run build --workspace @terreno/frontend
  npx vite preview --port 4173 --strictPort   # en frontend/
  # backend/.env: ALLOWED_ORIGIN=http://localhost:5173,http://localhost:4173
  E2E_WEB_URL=http://localhost:4173 E2E_API_URL=http://localhost:3000/api/v1 \
    npx playwright test checklist-smoke --project=mobile-chromium
  ```

### 9.2 Resultados

**⭐ H-01…H-10 — 10/10 OK.**

| Caso | Resultado | Notas |
| :-- | :--: | :-- |
| H-01 Iniciar sesión | ✅ | Cae en **Inspección** ("Chequeo de seguridad minera", plantilla A). |
| H-02 Cortar la señal | ✅ | Chip → "Sin señal"; la app sigue usable. |
| H-03 Capturar con hallazgo | ✅ | NOK "Señalización…" → hallazgo **Alta** + descripción; "Guardado en dispositivo". |
| H-04 Adjuntar foto | ✅ | JPEG 3000×2000 comprimido en el device; sube el adjunto. |
| H-05 Enviar (sin señal) | ✅ | Inspección a la cola; "Pendientes" sube. |
| H-06 Bitácora | ✅ | Entrada con tag + faena; aparece en la línea de tiempo. |
| H-07 Persistencia (F5) | ✅ | Tras recargar offline persisten borrador, pendientes y bitácora. |
| H-08 Reconectar | ✅ | La cola drena **sola**; "Pendientes" → 0; "En línea". |
| H-09 Supervisor ve el dato | ✅ | Gerencia: métricas + el hallazgo del recorrido. |
| H-10 Aislamiento (tenant B) | ✅ | "Inspección de obra"; **nunca** la plantilla ni los datos de A. |

**§4 Matriz rol × pantalla — OK.** Pestañas observadas por perfil: `field_worker`
{Inspección, Bitácora, Cola}; `supervisor` + {Gerencia, Conflictos};
`tenant_admin` + {Plantillas, Importar} (sin Inspección/Bitácora);
`platform_admin` sólo {Gerencia} ("Operación Plataforma").

**Casos de API (§2.4-B, §2.5, §3) — OK** (curl; mismo stack):

| Caso | Resultado | Notas |
| :-- | :--: | :-- |
| X-06 Health | ✅ | `{"status":"ok","db":"up"}` (incluye `version`, `uptime_s`). |
| PA-05 Token plataforma | ✅ | `user.role = platform_admin` (ver N-01). |
| PA-06 Audit log | ✅ | `200 { items, limit, offset }`. |
| PA-07 Crear tenant | ✅ | `201`, `status:"active"`. |
| PA-08 Asignar admin | ✅ | usuario `tenant_admin`. |
| PA-09/10 Suspender / reactivar | ✅ | `suspended` → `active`. |
| PA-11 Validación slug | ✅ | `400` con detalle legible. |
| PA-12 403 a rol no-plataforma | ✅ | `403` con `supervisor@minera.cl`. |
| PA-13 Rastro de auditoría | ✅ | 4 entradas con `action`/`entity`/`actor_id`/`tenant_id`. |
| TB-04/05 Aislamiento B | ✅ | `summary` y `templates` sólo de B ("Obra Costanera", "Inspección de obra"). |
| X-05 RLS transversal | ✅ | Sin fugas de A en `/sites`, `/dashboard/findings`, `/conflicts`. |

### 9.3 Hallazgos

**F-01 — Alta · el seed demo local deja registros con UUID fijo.**
`COLA_INICIAL` (`frontend/src/lib/seed.ts`) siembra filas de outbox con UUID
**fijos**; p. ej. la inspección `0198c2f0-a41d-7b2e-9f10-4c7e5a1b0031`. En cuanto
un dispositivo la sincroniza, la fila existe en el servidor; cualquier
dispositivo **nuevo** re-encola el mismo id y el batch se rechaza con
`duplicate key value violates unique constraint "inspection_pkey"`. Resultado:
las filas quedan `failed` de forma permanente y **"Pendientes" nunca vuelve a 0**
en un dispositivo nuevo (contradice el cierre de H-08/FR-016 en ese escenario).

- **Pasos:** iniciar sesión en un dispositivo nuevo (IndexedDB vacía) con datos
  demo → esperar el sync automático → abrir **Cola**.
- **Esperado:** "Pendientes" → 0 (todo sincronizado).
- **Obtenido:** 5 filas `failed` con `duplicate key`; el contador no baja de 5.
- **Evidencia:** logs del backend, repetidos en cada sesión:
  `registro rechazado inspection:0198c2f0-…-0031 — duplicate key value violates unique constraint "inspection_pkey"`.
- **Sospecha / FR:** datos demo (seed del frontend); refuerza la decisión de
  **retirar los datos sembrados** por defecto. *En corrección (ver §10).*

**F-02 — Media · el checklist describe el offline con el interruptor mock, que
no sirve para H-07.**
§0.4 propone validar 📴 con el interruptor "Sin señal". Pero `online` **no se
persiste**: al montar, `frontend/src/lib/store.tsx` hace
`setOnline(navigator.onLine)`. Con el interruptor, un F5 vuelve a poner la app
en línea y **drena** la cola, así que H-07 ("sigue todo: pendientes…") no se
puede cumplir con el mock. H-07 exige **offline real** (modo avión / DevTools
Offline)… y en el server de **desarrollo** de Vite no hay service worker, por lo
que sin red ni siquiera carga el documento
(`net::ERR_INTERNET_DISCONNECTED`). Conclusión: **H-02…H-08 sólo se pueden
validar contra el build de producción (PWA)**, no contra `vite` dev.
- **Sugerencia:** en §0.1/§0.4, indicar el build de producción para el bloque
  offline (el checklist ya lo pide para 📲 PWA en §3, X-07).

**N-01 — Baja · nit de documentación.** El checklist (PA-05) espera
`user.rol = platform_admin`, pero `/auth/login` devuelve **`user.role`**. El
resultado del caso es correcto; sólo el nombre del campo está desactualizado.