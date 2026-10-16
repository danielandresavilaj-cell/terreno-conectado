# TEST PLAN — Plan de pruebas de validación

**Versión:** 1.0.11 · **Fecha:** 2026-09-14 · actualizado 2026-10-16 · **Autor:** Raúl González (validación) · **Relacionado:** spec maestro §5–6, constitución Artículos III/IV/VII
**Evidencia APT:** "Plan de pruebas de validación" (informe §6) y soporte de la competencia "Realizar pruebas de certificación de productos y procesos".

## 1. Principio rector

Cada promesa del spec maestro tiene una prueba que la verifica (NFR-12). Las pruebas validan **comportamiento observable** (¿se pierde el dato? ¿se duplica? ¿cruza tenants?), no implementación. Trazabilidad: cada caso referencia IDs FR/NFR.

## 2. Niveles de prueba y herramientas

| Nivel | Herramienta | Qué cubre | Cuándo corre |
| :--- | :--- | :--- | :--- |
| Unit | Vitest | Lógica de cola de sync, compresión de foto, upsert/conflictos, validaciones | Cada push (CI) |
| Integración API | Vitest + Testcontainers (Postgres real con RLS) | Endpoints, idempotencia, políticas RLS, auth | Cada push (CI) |
| E2E | Playwright (Chromium, perfil **móvil**) | Flujos completos con `context.setOffline(true/false)` | **Nightly** + `workflow_dispatch` (CI) |
| Caos offline | Playwright + scripts de corte aleatorio | Escenarios §4 | Semanal y antes de la demo |
| Adversarial cross-model | Modelo de IA ≠ implementador + suite guiada por spec | Ataque a invariantes §5 | Al cierre de cada módulo |
| Rendimiento | Lighthouse CI + k6 básico | NFR-07, NFR-03 | Pre-deploy |
| Manual documentado | Protocolo en vivo (demo) | Criterios de aceptación §13 del spec maestro | Fases 2 y 3 |

## 3. Matriz de cobertura requisito → prueba

Estado de la evidencia a 2026-10-14, tras el harness E2E del issue #10 y el cierre de NFR-07.
Cada fila declara **dónde** vive la prueba; "verde" significa que la prueba
existe y pasó en la corrida de referencia (local con el stack completo, y el
nightly en CI). Las filas sin automatismo quedan marcadas como tales, no como
verde.

| Requisito | Prueba | Nivel | Evidencia | Estado |
| :--- | :--- | :--- | :--- | :--- |
| FR-011/014, NFR-01 | Capturar en modo avión, cerrar/reabrir app, verificar persistencia IndexedDB | E2E | `e2e-captura-offline.spec.ts` → "captura sin red, recarga y el borrador conserva las respuestas" | 🟢 verde |
| FR-012 | Foto de 8 MP → verificar dimensiones ≤1280 px y tamaño comprimido antes de encolar; abrir cámara, tomar foto, cancelar y denegar permiso | Unit + E2E + manual móvil | `shared` (`compresor`) + `e2e-captura-offline.spec.ts` → "la foto de un ítem queda ≤1280 px"; protocolo manual: `CamaraCaptura` abre el lente trasero, detiene el indicador al cerrar y ofrece archivo si no hay permiso | 🟢 verde (compresión) · protocolo manual pendiente por dispositivo |
| FR-016 | Desactivar red → encolar → reactivar: sync inicia sola sin clic | E2E | `e2e-captura-offline.spec.ts` → "reactivar la red drena la cola sin tocar el botón de sincronizar" | 🟢 verde |
| FR-017 | Cuota local supera el 80% → aviso al trabajador y prioriza fotos ya sincronizables | Unit | `frontend/test/cuota.test.ts` (`estimarCuota`/`cuotaEsAlta`; `contadorFotosPendientes`; `sincronizables(true)` sube al frente sólo las fotos cuyo dueño no está en cola, sin romper el orden FR-020) | 🟢 verde |
| FR-013, FR-020, FR-026 | Descartar una inspección o bitácora pendiente/fallida no deja filas locales ni outbox huérfanos; `syncing`/`synced` quedan protegidos | Unit | `frontend/test/cola-descartar.test.ts` (cascada completa, bitácora aislada y bloqueo de fila en envío) | 🟢 verde |
| FR-020 | Batch con dependencias (inspección + respuestas + hallazgo + foto) sube en orden | Unit + Integración | `backend/test/sync.spec.ts` (`batchOrder` y orden de aplicación) | 🟢 verde |
| FR-021, NFR-04 | Reenviar el mismo batch 3 veces → contar filas: cero duplicados | Integración + **caos 2** | `e2e-caos-sync.spec.ts` → "reenviar el mismo lote 3 veces no duplica filas" (`records_unchanged`) | 🟢 verde |
| FR-022 | Fallar red a mitad de subida → backoff observado (1s,2s,4s…), sin intervención | **caos 1** | `e2e-caos-sync.spec.ts` → "al cortar el envío y reconectar…" (`context.route` aborta 2 lotes) | 🟢 verde |
| FR-023 | Editar misma inspección en 2 contextos offline → LWW aplica + CONFLICT_RECORD con ambas versiones; visible a supervisor/tenant_admin y aislado por tenant | Integración + **caos 3** | `backend/test/conflicts.spec.ts` (roles/RLS) + `e2e-caos-integridad.spec.ts` → "dos dispositivos offline editan el mismo registro" | 🟢 verde |
| FR-024 | Tras sync: SYNC_LOG completo y `synced_at - captured_at` registrado | Integración | `backend/test/sync.spec.ts` + aserción de `sync_log` en el E2E de FR-016 | 🟢 verde |
| FR-025, NFR-05 | JWT tenant A intenta batch con `tenant_id` B → 4xx + AUDIT_LOG de incidente | Integración + **caos 7** | `e2e-caos-integridad.spec.ts` → "JWT del tenant A con payload del tenant B" | 🟢 verde |
| FR-002, NFR-05 | Usuario tenant A consulta todos los endpoints de lectura → jamás aparece dato B (fixture B sembrada) | Integración (RLS, Testcontainers) | `backend/test/rls.spec.ts` | 🟢 verde |
| FR-005 | 5 logins fallidos → bloqueo temporal 15 min (por cuenta y por IP) | Integración | `backend/test/auth.spec.ts` → "5 fallos consecutivos bloquean la cuenta 15 min" | 🟢 verde |
| FR-001 | Login email/contraseña → JWT HS256 de 15 min con claims `user_id`/`tenant_id`/`rol` + cookies `rt`/`csrf` | Integración | `backend/test/auth.spec.ts` → "emite access token con claims user_id/tenant_id/rol y cookies rt/csrf" | 🟢 verde |
| FR-003 | Matriz rol × recurso × acción (§3 spec 001): `platform_admin` sólo `/admin`; `field_worker` sin dashboard ni admin; `tenant_admin` único que publica plantillas | Integración | `backend/test/admin.spec.ts` (403 a no-`platform_admin`) + guardas por controlador (`dashboard.auth.ts`, `templates.controller.ts`) | 🟢 verde |
| FR-004 | Access token vencido con cola pendiente → la cola NO se pierde y drena al reingresar; el refresh rota `rt` y detecta reuso | Integración + **caos 6** | `backend/test/auth.spec.ts` (rotación/reuso y CSRF) + `e2e-caos-sync.spec.ts` → "caos 6 — token expirado en cola" | 🟢 verde |
| FR-006 | Tenant demo sembrado (A: minera + faena + 3 roles; B: constructora) y login de cada rol | Integración | `backend/db/seed.ts` + `backend/test/auth.spec.ts` (`login (FR-001, FR-006)`) | 🟢 verde |
| FR-031/032 | Ciclo draft→submitted; ítem `nok` exige hallazgo cuando la plantilla lo configura | Unit + E2E | `e2e-captura-offline.spec.ts` → "estado submitted con su site real" y "un hallazgo creado desde un NOK…" | 🟢 verde |
| FR-034 | Georreferencia opcional de la inspección (lat/lon) capturada al enviar y persistida por sync | Integración | `backend/test/sync.spec.ts` (location_lat/lon + rechazo de rangos inválidos) + `frontend/src/lib/store.tsx` (`navigator.geolocation`) | 🟢 verde |
| FR-040/043, NFR-03 | Sync de dato → visible en dashboard; medir delta ≤ 60 s (primer lote) | E2E + cronometrado manual en demo | `backend/test/dashboard.spec.ts` + medición manual en la demo (Fase 3) | 🟡 parcial: la corrección numérica ≤60 s se mide en vivo, no en automatizado |
| FR-041 | Dashboard: filtros de faena, rango de fechas, severidad y autor | Integración | `backend/test/dashboard.spec.ts` (`dashboardFiltrosSchema`, `findingsFiltrosSchema.autor_id`) | 🟢 verde |
| FR-042 | Export de la vista de hallazgos a CSV (columnas y escapado) | Unit | `frontend/src/lib/dashboard-csv.ts` (`construirCsvHallazgos`) + `frontend/test/dashboard-csv.test.ts` | 🟢 verde |
| FR-052, NFR-09 | `/health` responde 200 con estado de DB (503 con DB caída); uptime monitor lo consume; logs JSON con `request_id` y `tenant_id` en cada línea | Integración + manual | `backend/test/health.spec.ts` + `backend/test/observability.spec.ts` | 🟢 verde |
| NFR-02 | Script: 200 registros + 100 fotos en offline simulado de 72 h (reloj adelantado) → sync completo sin pérdida | **caos 5** | `e2e-caos-sync.spec.ts` → "200 registros pendientes suben íntegros y sin duplicar" | 🟢 verde (200 registros; las 100 fotos se comprueban en el FR-012 unitario, no en el mismo escenario) |
| NFR-07 | Lighthouse CI mobile Performance ≥ 80; interacción de formulario < 200 ms | Rendimiento | `frontend/scripts/check-lighthouse.mjs` (Chrome, perfil móvil, Slow 4G; **Performance 85–89**) + workflow `lighthouse.yml` (nightly/manual). La interacción se aproxima con el Total Blocking Time del mismo reporte (~40–50 ms) | 🟢 verde |
| FR-007, NFR-05 | Plantillas/revisiones de tenant A jamás visibles para B (fixture B sembrada) | Integración (RLS, Testcontainers) | `backend/test/rls.spec.ts`, `backend/test/templates.delta.spec.ts` | 🟢 verde |
| FR-008/009 | Asignación faena+rol: el worker solo ve revisiones publicadas asignadas a su faena y rol | Integración | `backend/test/templates.delta.spec.ts` | 🟢 verde |
| FR-018 | Plantillas en caché local → captura de formulario 100% sin red (Artículo I) | E2E | `e2e-captura-offline.spec.ts` → "con la red apagada tras un arranque con señal, la plantilla se renderiza" | 🟢 verde |
| FR-027/028 | Delta `since=<template_version>` trae solo cambios; inspección en curso conserva su versión congelada | Integración | `backend/test/templates.delta.spec.ts` | 🟢 verde |
| FR-009, FR-032, FR-036/039 | Sesión sin asignación no recibe formulario; inspección con obligatorios vacíos, valor inválido o NOK sin hallazgo no se encola | Unit + E2E | `frontend/test/validar-envio-inspeccion.test.ts`, `frontend/test/plantillas.resolucion.test.ts` y `shared/src/templates.test.ts`; protocolo E2E de captura | 🟢 verde (unit) · E2E a ejecutar en CI |
| FR-037 + FR-012 | Foto de ítem comprimida y asociada a la respuesta (`ATTACHMENT`) | Unit + E2E | `backend/test/sync.spec.ts` + E2E de FR-012 | 🟢 verde |
| FR-029 | Reintentar un import sincronizado 3 veces → cero duplicados (idempotencia del motor batch) | Integración | `backend/test/import-wizard.spec.ts` | 🟢 verde |
| FR-019/044 | Export rellenado + hoja "Evidencias" idéntico en dispositivo y en servidor | E2E + Integración | `backend/test/inspection-export.spec.ts`, `shared/src/rellenar.test.ts`, `serializar.test.ts` | 🟢 verde |
| FR-045/046 | Lote del período con formato de su plantilla + hoja "Evidencias" (adjuntos referenciados/embebidos) | Integración | `backend/test/inspection-export-lote.spec.ts` | 🟢 verde |
| FR-047 + FR-051 | Import confirmado y export por lote registrados en el audit log (autor, timestamp, tenant) | Integración | `backend/test/import-wizard.spec.ts`, `inspection-export-lote.spec.ts` | 🟢 verde |
| FR-048 | Flag `ai` OFF: el mapeo propuesto por IA no aplica cambios sin la confirmación del `tenant_admin` | Integración | `backend/test/import-wizard.spec.ts`, `templates.http.spec.ts` | 🟢 verde |
| FR-049 | Revisión publicada inmutable: ítems ya inspeccionados no se modifican; el cambio exige revisión nueva | Integración | `backend/test/templates.http.spec.ts` (409 al editar publicado) | 🟢 verde |
| FR-050 | `platform_admin` crea tenant, le asigna el `tenant_admin` inicial y lo suspende/reactiva; un rol distinto recibe 403 en toda la consola | Integración | `backend/test/admin.spec.ts` | 🟢 verde |
| FR-051 (`admin`) | Cada mutación admin deja exactamente una fila en `audit_log` con `actor_id` y `tenant_id` correctos; `tc_app` no puede UPDATE/DELETE y la API no expone rutas de modificación | Integración | `backend/test/admin.spec.ts` | 🟢 verde |

**Recuento:** 39 filas · 🟢 37 (94,9%) · 🟡 1 (2,6%) · 🔴 0 ·
⚪ 1 (2,6%, automatizable sólo con tooling externo o sin prueba todavía).

> La única fila restante en ⚪ es **NFR-02/100-fotos**: las 100 fotos se
> comprueban en el FR-012 unitario, no en el escenario de 72 h del caos 5. FR-034
> (geolocalización), FR-041 (autor) y FR-042 (CSV del cliente) pasaron a 🟢.

**Volumen de pruebas en la corrida de referencia:**
```
E2E + caos (Playwright, nightly)          17 tests
Integración backend (Vitest + Testcontainers) 188 tests
Unidad frontend (Vitest)                     109 tests
Unidad shared (Vitest)                        77 tests
                                           ───────────────
                                           391 tests
```

> El criterio de salida de Fase 2 (§8) pide "matriz §3 ≥ 90% verde". Con FR-034,
> FR-041 y FR-042 implementados y verificados (🟢 37/39 = 94,9%) el umbral se
> cumple sin maquillar los huecos restantes (FR-040/043 ≤60 s 🟡; NFR-02/100-fotos ⚪).

## 4. Pruebas de caos offline-first (protocolo)

Escenarios ejecutados con Playwright (offline automático) y manualmente en la demo (modo avión real del teléfono):

1. **Corte a mitad de sync:** offline aleatorio durante la subida de un batch grande → al reconectar: cero pérdida, cero duplicado (idempotencia).
2. **Doble envío:** forzar reintento de un lote ya procesado (replay de red) → filas idénticas.
3. **Edición concurrente:** mismo registro en dos dispositivos offline → LWW + conflicto visible y auditado.
4. **Reinicio hostil:** matar la pestaña/app con outbox a medio escribir → al reabrir, datos íntegros (transacciones Dexie).
5. **Cola masiva:** escenario NFR-02 (72 h, 200 registros, 100 fotos).
6. **Token expirado en cola:** JWT expira mientras hay pendientes → refresh sin perder cola (FR-004).
7. **Cross-tenant hostil:** JWT A + payload B → rechazo + auditoría (FR-025).

### 4.0 Implementación (issue #10)

Los siete escenarios están automatizados en `frontend/e2e/specs/` y corren en
el workflow nightly `.github/workflows/e2e.yml`. Ninguno toca `ci.yml`: la capa
rápida de cada PR sigue igual, y la capa lenta (Postgres + backend + navegador)
no puede bloquear un merge.

| # | Mecanismo en el harness | Spec |
| :-- | :--- | :--- |
| 1 | `context.route` aborta dos envíos seguidos y después deja pasar; la cola debe drenar sola por backoff | `e2e-caos-sync.spec.ts` |
| 2 | Se captura el lote real que arma la app y se reinyecta por API 3 veces | `e2e-caos-sync.spec.ts` |
| 3 | Dos contextos con sesión propia editan el mismo registro con versiones distintas | `e2e-caos-integridad.spec.ts` |
| 4 | Se recarga sin cierre limpio y se verifica el outbox antes y después | `e2e-caos-integridad.spec.ts` |
| 5 | 200 registros inyectados en el outbox (entidad + fila), medidos en `log_entry` | `e2e-caos-sync.spec.ts` |
| 6 | Se sustituye el token por uno vencido y se comprueba que la cola no se pierde | `e2e-caos-sync.spec.ts` |
| 7 | Lote con `tenant_id` del tenant B bajo el JWT del A: 409 + `audit_log` | `e2e-caos-integridad.spec.ts` |

**Criterio de éxito global:** los escenarios 1–7 con `0 pérdidas ∧ 0 duplicados ∧ 0 fugas cross-tenant`. Cualquier fallo bloquea la demo (Artículo III). **Resultado 2026-10-13: los 7 en verde.**

### 4.1 Pruebas de caos del módulo 007 (TSK-FORM-011)

Extienden la sección 4 con los invariantes del módulo (spec 007): libros `.xlsx` reales, versionado inmutable y delta de plantillas.

8. **Corte a mitad de delta de plantillas:** offline durante `GET /api/v1/templates?since=` → reconectar: caché consistente y la inspección en curso conserva su versión congelada (FR-027/028). *El invariante crítico —el cursor no avanza si el delta no se integró completo— está cubierto por unit en el cliente* (`plantillas.delta.test.ts`).
9. **Doble import de plantilla:** reenviar el mismo `.xlsx` (replay de red) → un único `TEMPLATE_IMPORT` confirmado, cero duplicación (FR-029).
10. **Edición concurrente de revisión:** dos `tenant_admin` editan el mismo borrador → se publica una sola versión y queda auditada (FR-047/049).
11. **Versión en vuelo:** inspección iniciada con v1 mientras se publica v2 → la inspección re-exporta con v1 y no se re-valida contra v2 (FR-028/038). *Si la revisión congelada no llega, la captura se bloquea y lo dice, con salida explícita confirmada; nunca reencuadra en silencio.*

**Criterio de éxito del módulo:** escenarios 8–11 con `0 duplicados ∧ 0 versiones inconsistentes ∧ 0 fugas cross-tenant`; import/export probados con libros reales (fixtures del spike xlsx, plan 007 §3).

## 5. Testing adversarial cross-model (red-team)

- **Regla:** el modelo que implementó un módulo **no** es el que lo ataca (Q14/Artículo VII).
- **Insumo del atacante:** spec maestro + spec del módulo (no el código): debe romper las promesas, no buscar bugs de estilo.
- **Prompt base del red-team:** "Dado este spec, diseña y ejecuta la secuencia de acciones de usuario y de red que viole los invariantes: integridad (FR-021/023), aislamiento (FR-002/025), disponibilidad offline (FR-011/016). Prioriza estados frontera: cuotas llenas, timestamps iguales, UUIDs colisionados, lotes parciales, relojes desviados entre dispositivos."
- **Salida esperada:** informe por módulo con hallazgos (severidad, repro, requisito vulnerado) → issues en `tasks/` con fix + test de regresión.
- **Modelos sugeridos (opencode go):** implementa `kimi-k2.7-code` / `qwen3.8-flash` → ataca `qwen3.8-max` o `deepseek-v4-pro` (y viceversa).

### 5.1 Ataque sin los modelos sugeridos: el harness encontró seis defectos

El E2E atacó el sistema sin necesitar los modelos cross-model: al escribir
las pruebas del protocolo §4 contra la app real aparecieron seis defectos.
Todos se corrigieron en el mismo PR que construyó el harness y **cada uno
quedó cubierto por una prueba de regresión**, que es el criterio de salida de
esta sección.

| # | Severidad | Hallazgo | Requisito | Repro | Estado |
| :-- | :--- | :--- | :--- | :--- | :--- |
| H1 | **Crítica** | `await fetch()` dentro de una transacción Dexie → `Transaction committed too early`. **El login completo se caía en el primer arranque de cada dispositivo.** | FR-006 | Cargar la app por primera vez con un usuario sembrado: `/auth/login` y `/sites` responden 200, el token queda en `sessionStorage`, y aun así la pantalla nunca sale del login. | ✅ `frontend/src/lib/db.ts` (el blob se resuelve **antes** de abrir la transacción) + 10 E2E que arrancan por login |
| H2 | **Alta** | El `catch` del worker releía `sincronizables()`, que **excluye** las filas ya marcadas `syncing`. Un corte de red dejaba el lote atrapado en `syncing` para siempre: cero reintentos y el contador de pendientes congelado. | FR-022, Artículo I | Poner la red, encolar y cortar la conexión durante el envío. | ✅ `frontend/src/lib/sync.ts` (se conserva la lista `enVuelo` del intento) + caos 1 |
| H3 | **Alta** | `fetch` sin timeout: una conexión que acepta el socket y nunca responde (portal cautivo, WiFi que captura el WPA) colgaba el worker indefinidamente. | FR-022 | Encolar con una red que acepta la conexión pero no responde. | ✅ `AbortController` a 30 s + caos 1 y 6 |
| H4 | **Alta** | La semilla demo creaba respuestas con `template_item_id = 'i-01'`, que **no es UUID**. El backend rechazaba el lote entero con 400: **el primer sync de todo usuario nuevo estaba roto.** | FR-021 | Arrancar sesión y dejar que la app sincronice sus datos de demo. | ✅ `ITEM_ID_FIJO` con los ids reales del catálogo publicado + caos 2 |
| H5 | **Alta** | `validatePayload` corría **antes** del chequeo de cruce de tenant: un lote con datos de otro tenant moría con un 400 de forma y **no dejaba rastro en `audit_log`**, habilitando tantear el tenant ajeno con peticiones invisibles. | FR-025, NFR-05 | JWT del tenant A + `tenant_id` del B con un `site_id` ajeno. | ✅ `backend/src/sync/sync.service.ts`: el aislamiento se comprueba sobre el sobre, antes de opinar sobre el payload + caos 7 |
| H6 | Media | Al reabrir la app, el outbox quedaba en un limbo observable: nada indicaba si la sesión se había restaurado o había que volver a entrar. | FR-006 | Cerrar la pestaña con cola a medio escribir y reabrirla. | ✅ cubierto por caos 4 (el harness verifica la cola antes de reingresar) |

**Conclusión del red-team:** el nivel de daño de H1 y H4 es que la aplicación
**no arrancaba** para un usuario nuevo, y ninguno era visible leyendo el
código: hacen falta la app real y la base real para verlos. Eso es el argumento
a favor de que §4 exista como protocolo automatizado y no como lista de
comprobaciones manuales. El invariante crítico
(`0 pérdidas ∧ 0 duplicados ∧ 0 fugas`) se sostiene en la corrida de
referencia: **17/17 E2E en verde**. Informe por módulo en
[`docs/informe-pruebas-validacion.md`](docs/informe-pruebas-validacion.md).

## 6. Datos de prueba

- Semillas deterministas (`seed:demo`) — tenants A y B de data-model.md §5.
- Generación masiva con faker es-CL para caos y rendimiento.
- Fotos sintéticas de tamaños conocidos (1/5/12 MP) para FR-012.
- Nunca datos reales de empresas (informe APT §3.5: sin acceso a faenas reales).

## 7. Ambientes

| Ambiente | Propósito | Infra |
| :--- | :--- | :--- |
| local | dev + CI, Docker Compose idéntico al deploy | Máquina del integrante |
| CI | unit + integración (Testcontainers) + E2E nightly | GitHub Actions (minutos gratis) |
| demo | despliegue en VPS para validación en vivo | ADR-002 (≤ US$7/mes) |

## 8. Criterios de salida por fase (alineado al Gantt APT)

- **Fase 2 (sem. 13–16, "Pruebas de validación"):** matriz §3 ≥ 90% verde en CI; caos 1–7 pasando; informe de resultados por módulo.
- **Módulo 007 (ciclo del módulo, issues #34–#45):** matriz §3 (módulo 007) verde; caos 8–11 (TSK-FORM-011) pasando; spike xlsx cerrado con enmienda a ADR-003.
- **Fase 3:** demo en vivo ejecuta §13 del spec maestro sin fallos; informe final cita resultados de este plan.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 1.0.10 | 2026-10-14 | **TSK-AUTH-008 / issue #128 resuelto**: FR-023 acredita acceso a conflictos de `supervisor`/`tenant_admin`, denegación a `field_worker`/`platform_admin` y aislamiento RLS en `backend/test/conflicts.spec.ts`; backend actualizado a 188 tests, total 391 con 17 E2E | Daniel Ávila |
| 1.0.9 | 2026-10-14 | **FR-034 implementado** (georreferencia opcional): migración `1730000011000_inspection_location.js` (`location_lat`/`location_lon` NUMERIC), contrato aditivo `SyncInspectionPayload.location`, validación server-side, captura opcional con `navigator.geolocation` al enviar inspección; nueva fila FR-034 en matriz §3 (🟢) sobre la base 1.0.8: recuento a 🟢37/🟡1/⚪1 (37/39 = 94,9%); volumen backend 187 · frontend 109 · total 390 (refs #7) | Daniel Ávila |
| 1.0.8 | 2026-10-14 | **FR-041 + FR-042 implementados y verificados**: filtro por autor (`autor_id` en findings, `autores` en summary, UI) y test del CSV del cliente (`frontend/src/lib/dashboard-csv.ts` + `frontend/test/dashboard-csv.test.ts`); recuento a 🟢36/🟡1/⚪1 (36/38 = 94,7%); volumen backend 184 · frontend 109 · total 387 (refs #8) | Daniel Ávila |
| 1.0.7 | 2026-10-14 | **FR-017 implementado** (dejó de ser simulado): cuota real vía `navigator.storage.estimate()` con aviso al 80% y priorización de fotos ya sincronizables; nueva fila FR-017 en la matriz §3 (🟢); recuento conjunto con el módulo 001: 38 filas · 🟢34/🟡2/⚪2; volumen actualizado (backend 183, frontend 105) (refs #5) | Daniel Ávila |
| 1.0.6 | 2026-10-14 | Cobertura del módulo **001** (autenticación y tenancy): filas **FR-001**, **FR-003**, **FR-004** y **FR-006** en la matriz §3 con evidencia de `backend/test/auth.spec.ts` (login/JWT, rotación y reuso del refresh, bloqueo) y el caos 6 (`e2e-caos-sync.spec.ts`); FR-005 se detalla (por cuenta **y** por IP); recuento a 37 filas (refs #4) | Raúl González |
| 1.0.5 | 2026-10-14 | **NFR-07 cerrado**: harness de rendimiento propio (`frontend/scripts/check-lighthouse.mjs` + workflow `lighthouse.yml`, patrón `check-pwa.mjs`) que mide el build en perfil móvil y exige Performance ≥ 80; se quita ExcelJS del chunk inicial (import profundo `@terreno/shared/xlsx/serializar`) y se difieren las pantallas pesadas; fila NFR-07 de la matriz §3 pasa a 🟢 (refs #9) | Raúl González (con IA) |
| 1.0.4 | 2026-10-13 | Cobertura del módulo **006** (administración de plataforma): filas **FR-050** y **FR-051** (`admin`) en la matriz §3 con evidencia de `backend/test/admin.spec.ts` (16 tests); recuento actualizado a 33 filas y volumen de la corrida de referencia (backend 181, frontend 98, shared 77) (refs #9, #116) | Raúl González (con IA) |
| 1.0.0 | 2026-09-14 | Plan inicial derivado del spec maestro v1.0.0 | Raúl González (con IA) |
| 1.0.1 | 2026-10-08 | Cobertura del módulo 007: matriz §3 (FR-007/008/009, 018/019, 027/028/029, 036/037/038/039, 044–049) y caos 8–11 (TSK-FORM-011) | Raúl González (con IA) |
| 1.0.3 | 2026-10-13 | **Evidencia de validación ejecutada** (closes #10, #12): harness E2E con `@playwright/test` (perfil móvil, `frontend/e2e/` + `playwright.config.ts`, workflow nightly `e2e.yml` que **no** bloquea PRs); matriz §3 reescrita con la evidencia real por fila (26/29 en verde = 89,7%, techo 96,6% dentro del harness); caos **1–7 automatizados y en verde** (el de red-team cerró #12 con seis defectos de la app, dos de ellos impedían el arranque: `Transaction committed too early` en una transacción Dexie y el `template_item_id` no-UUID de la semilla que rompía el primer sync) | Raúl González (con IA) |
| 1.0.2 | 2026-10-12 | Fila explícita **FR-038** (congelado de la versión en la inspección) y alineación de la versión de cabecera con el changelog (refs #98) | Daniel Ávila |
