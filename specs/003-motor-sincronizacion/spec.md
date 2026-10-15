# SPEC 003 — Motor de sincronización

| | |
| :--- | :--- |
| **Estado** | COMPLETO (ciclo del módulo, F2 · 2026-10-13) |
| **Versión** | 0.4.1 |
| **Autor** | Daniel Ávila |
| **Padre** | specs/000-master/spec.md |
| **Depende de** | 001 (JWT/tenant), 002 (outbox local) |
| **Bloquea a** | 005 (el dashboard solo muestra lo sincronizado) |
| **Plan técnico** | `plans/003-motor-sincronizacion/plan.md` |
| **Tareas** | `tasks/003-motor-sincronizacion/tasks.md` (TSK-SYNC-001…) |

> **Corazón del proyecto.** Aquí se juega la promesa central: cero pérdida, cero duplicación (Artículo III de la constitución). Es el módulo con mayor carga de pruebas de caos y adversariales (`test-plan.md` §4, caos 1–7).

## 1. Alcance

Requisitos que este spec detalla: **FR-020 → FR-029** y soporte a **NFR-03, NFR-04**.

- **FR-020** Subida por lotes con orden de dependencias (`site → template → inspection → responses → findings → log_entries → attachments`).
- **FR-021** Idempotencia: upsert por UUIDv7 de cliente + `client_version`.
- **FR-022** Backoff exponencial 1 s → 5 min sin intervención.
- **FR-023** Conflictos: LWW por `captured_at`/`client_version`, ambas versiones en `CONFLICT_RECORD`, visibles al `supervisor` y `tenant_admin` de su tenant.
- **FR-024** `SYNC_LOG` auditable + métrica de latencia `captured_at → synced_at`.
- **FR-025** Rechazo del lote completo ante cruce de tenant (+ incidente en `AUDIT_LOG`).
- **FR-026** Marcado `synced` y actualización del contador de pendientes.
- **FR-027** Delta de plantillas `GET /api/v1/templates?since=<published_seq>`.
- **FR-028** Versión congelada: una inspección en curso conserva su `template_version`; el delta nunca re-encuadra ni re-valida lo capturado.
- **FR-029** Imports idempotentes: `TEMPLATE_IMPORT` viaja con UUIDv7 de cliente por el mismo motor de batch.

El alcance excede el "walking skeleton": incluye la **descarga incremental hacia el cliente** (FR-027/028/029), que la versión 0.3.0 dejó abierta.

## 2. Estado de implementación

Verificado sobre `main` al 2026-10-14.

| Requisito | Estado | Evidencia |
| :--- | :--- | :--- |
| FR-020 orden de dependencias | ✅ | `backend/src/sync/sync.service.ts`; `backend/test/sync.spec.ts` (`batchOrder`) |
| FR-021 idempotencia (upsert) | ✅ | `sync.service.ts` (`ON CONFLICT … WHERE excluded.client_version >`) |
| FR-022 backoff cliente | ✅ | `frontend/src/lib/sync.ts` (`MAX_BACKOFF_MS`); caos 1 |
| FR-023 LWW + `CONFLICT_RECORD` | ✅ | `sync.service.ts` (`decideLww`, `recordConflict`, `CONFLICT_VIEWER_ROLES`); `backend/test/conflicts.spec.ts` (supervisor/tenant_admin 200, field_worker/platform_admin 403, RLS cross-tenant); caos 3 |
| FR-024 `SYNC_LOG` + latencia | ✅ | `sync.service.ts` (`beginSyncLog`/`finishSyncLog`) |
| FR-025 rechazo cross-tenant + auditoría | ✅ | `sync.service.ts` (`auditTenantMismatch`); caos 7 |
| FR-026 marcado `synced` + contador | ✅ | `frontend/src/lib/sync.ts`, `frontend/src/lib/db.ts` |
| FR-027 delta de plantillas | ✅ | `backend/src/templates/templates.controller.ts` (`?since=`), `frontend/src/lib/plantillas.ts`, cursor en `db.ts` |
| FR-028 versión congelada | ✅ | `frontend/src/lib/store.tsx` (`elegirActiva`, borrador congelado); `data-model.md` §4.6 |
| FR-029 imports idempotentes | ✅ | `backend/src/sync/sync.service.ts` + `template_imports` (`data-model.md` §4.1) |

Criterios de caos 1–7: ver `test-plan.md` §3 (FR-020…025) y §4.

## 3. Contratos de API

Todos bajo el prefijo global `/api/v1` (excepto `/health`), autenticados con Bearer JWT (AuthGuard). El tenant se toma **siempre** de las claims, nunca del cuerpo.

### 3.1 `POST /api/v1/sync/batch` — ingesta

- **Request:** `SyncBatchRequest` (`shared/src/sync.ts`) — `batch_id`, `device_id`, `records[]`; cada `record` lleva `entity_type`, `id` (UUIDv7 cliente), `tenant_id`, `client_version`, `captured_at` y `payload`.
- **Límite:** ≤ `MAX_REGISTROS_LOTE` (500) por lote; por encima se rechaza el request completo.
- **Response 200:** `SyncBatchResponse` — `status` (`ok`|`partial`|`failed`), conteos (`records_total`, `records_ok`, `records_failed`, `records_unchanged`) y hasta 5 `errors[]` para depurar el replay.
- **Códigos:** `200` es el único éxito (el desenlace va en el cuerpo, FR-021); `401` sin sesión válida; `409` sólo para cruce de tenant **previo a escritura** (FR-025).

### 3.2 `GET /api/v1/conflicts` — lectura LWW

Lista de `CONFLICT_RECORD` para `supervisor`/`tenant_admin` (FR-023). Cada registro conserva payload ganador y perdedor.

### 3.3 `GET /api/v1/templates?since=<published_seq>` — delta de plantillas

Delta de revisiones publicadas (FR-027). El cursor es `published_seq` (secuencia **global** de publicación), **no** `version` (que es por plantilla — el defecto documentado bajo FR-027 en el spec maestro). Devuelve `items[]` y `latest_seq` (techo publicado visible, que el cliente guarda como próximo `since`).

## 4. Semántica de idempotencia y resolución de conflictos

1. **Upsert version-condicionado.** `INSERT … ON CONFLICT (id) DO UPDATE … WHERE excluded.client_version > tabla.client_version` (`data-model.md` §4.1). Reenviar un lote ya procesado devuelve `records_unchanged`, jamás duplica (FR-021, NFR-04).
2. **Orden de dependencias.** El servidor agrupa y aplica en el orden fijo `site → template → inspection → responses → findings → log_entries → attachments` (FR-020); un fallo de referencia dentro del tenant aborta esa rama.
3. **LWW determinista** (cerrado 2026-09-24). Ante `captured_at` distintos gana el mayor; si empatan, mayor `client_version`; si aún empatan, mayor UUIDv7 (orden lexicográfico). Resolución **reproducible** ante relojes desviados (caso adversarial §5 del test-plan). Lo perdedor se conserva en `CONFLICT_RECORD` (append-only), visible al supervisor.
4. **Aislamiento (FR-025).** Si el lote contendría un `tenant_id` distinto al del JWT, se rechaza completo **antes** de escribir y se registra el incidente en `AUDIT_LOG`. Es defensa en profundidad: la primaria es RLS (Art. IV).

## 5. Worker de cola cliente

`frontend/src/lib/sync.ts` (FR-016/022/026):

- **Concurrencia 1** — singleton con guard de reentrada: nunca dos lotes volando.
- **Disparo** — el store decide (`evento online` del navegador y flush al terminar una captura); el worker sólo ejecuta.
- **Tamaño de lote** — recorta a `MAX_REGISTROS_LOTE` (misma constante que el servidor: no pueden divergir).
- **Timeout de envío** — 30 s; corta el turno para que un `online` falso no cuelgue la cola.
- **Backoff** — 1 s → 2 s → 4 s … máx. 5 min, auto-reprogramado, sin intervención (FR-022).
- **Desenlace** — marca cada fila `synced` (o `failed` con `lastError` + 1 intento); `records_unchanged` cuenta como éxito; actualiza el contador de pendientes (FR-026).

## 6. Descarga incremental (FR-027/028/029) — cierre del ítem abierto

La versión 0.3.0 dejó "Descarga incremental hacia el cliente" abierta. Se cierra así para V1:

### 6.1 Plantillas — delta curado por cursor

- El cliente persiste **un cursor `published_seq` por tenant** (`db.ts`, prefijo `tc_plantilla_cursor:`). Es **por tenant** y no global porque un dispositivo compartido cambia de sesión y el umbral de una empresa no puede saltar revisiones de otra (bug documentado en `lib/plantillas.ts`).
- El ciclo pide `GET /templates?since=<cursor>` filtrando por faena y rol (FR-009), fusiona el delta en la caché local y **sólo avanza el cursor si la caché aceptó todo lo recibido**: ante un corte a mitad (caos 8), el cursor no avanza y la siguiente pasada repite el delta en vez de perder revisiones.
- Un dispositivo sin cursor guardado recibe el snapshot completo (`since=null`).

### 6.2 Versión congelada (FR-028)

El delta **nunca** re-encuadra un turno en curso: la plantilla activa de un borrador se resuelve contra el `template_version` congelado de la inspección. Si la revisión congelada no está en caché, la UI muestra un estado explícito `no-disponible` (no reencuadra) y ofrece descartar el borrador.

### 6.3 Imports idempotentes (FR-029)

`TEMPLATE_IMPORT` viaja por el mismo motor de batch con UUIDv7 de cliente; reintentar nunca duplica (Art. III).

### 6.4 Datos de referencia para offline (FR-018) — decisión V1

**Decisión: snapshot completo, sin cursor propio.** Las faenas (`site`) y las asignaciones (`template_assignment`) se descargan completas al autenticar y al volver la señal, y se cachean con la sesión del dispositivo. **No** se les da cursor incremental en V1: son de volumen acotado, cambian poco y el presupuesto de simplicidad (Art. V/VI) no justifica un segundo mecanismo de delta. La frescura de las **plantillas** —el dato que sí crece— ya está cubierta por el cursor `published_seq` (§6.1). Cualquier cambio en faenas/asignaciones debe reflejarse con la misma reagrupación de sesión que ya dispara `recargarPlantillas` (evento `online`, FR-027).

> Si en el futuro el volumen de faenas/asignaciones lo exige, el patrón a extender es el mismo cursor por tenant de §6.1 — no un camino nuevo.

## 7. Auditoría y observabilidad

- Cada batch abre un `SYNC_LOG` en dos fases (`pending` → final) y registra la latencia `synced_at − captured_at` por registro (FR-024, `data-model.md` §4.3). Los conflictos se enlazan a su batch por `sync_log_id`.
- Cada conflicto y cada incidente cross-tenant queda en `CONFLICT_RECORD` / `AUDIT_LOG`, append-only.

## 8. Criterios de aceptación

- Escenarios de **caos 1–7** (`test-plan.md` §4) verdes con **cero pérdida ∧ cero duplicación** (invariante Art. III / NFR-04).
- Matriz §3 de `test-plan.md`: filas FR-020…026 verdes (ya registradas) y FR-027/028 verdes.
- Primer lote sincronizado visible en el dashboard en ≤ 60 s (NFR-03, medido en vivo — fila 🟡).
- Descarga incremental cerrada: el delta de plantillas trae solo cambios; una inspección en curso conserva su versión congelada; un import reintentado no duplica.

## 9. Decisiones y puntos cerrados

- ✅ **Tie-breaker LWW determinista** (2026-09-24) — `plans/000-walking-skeleton/plan.md` §3.1.
- ✅ **Orden de dependencias del batch** (fijo) — `data-model.md` §4.2.
- ✅ **Cursor del delta de plantillas = `published_seq`** (global), no `version` (por plantilla) — defecto y corrección en `data-model.md` v1.1.2 y `adr/003` Enmienda 2.
- ✅ **Descarga incremental en V1** (2026-10-13): plantillas por cursor `published_seq`; faenas y asignaciones por snapshot completo (§6). Cierra el ítem abierto de la 0.3.0.

## 10. Referencias

- `specs/000-master/spec.md` §3.1, §5.3, §7 (FR-020…029)
- `data-model.md` §4 (reglas de integridad)
- `test-plan.md` §3 (matriz), §4 (caos 1–8), §5 (defectos H1–H6)
- `plans/000-walking-skeleton/plan.md` §3.1 · `plans/003-motor-sincronizacion/plan.md`
- `adr/001` (contratos compartidos), `adr/003` (formularios dinámicos)

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.4.1 | 2026-10-14 | **FR-023 / TSK-AUTH-008 (#128):** `GET /conflicts` alinea sus roles con el contrato canónico (`supervisor`, `tenant_admin`); `conflicts.spec.ts` verifica denegación a worker/platform y aislamiento RLS | Daniel Ávila |
| 0.4.0 | 2026-10-13 | **Spec completado (F2).** Documenta el estado real de FR-020…029 (todos implementados), cierra la **descarga incremental**: delta de plantillas por cursor `published_seq` y **decisión V1 de datos de referencia por snapshot completo** (§6). Apunta a `plans/003-motor-sincronizacion/plan.md` y a las tasks TSK-SYNC | Daniel Ávila |
| 0.3.0 | 2026-10-07 | **Módulo 007 (Enmienda 002):** alcance +FR-027–029 — delta de plantillas `GET /api/v1/templates?since=`, versión congelada, imports idempotentes (`TEMPLATE_IMPORT`) | Raúl González (con IA) |
| 0.2.0 | 2026-10-07 | TSK-WS-007/008/009 implementados: contrato de ingesta (`SyncBatchRequest/Response`), upsert versión-condicionado e idempotente, LWW determinista + `CONFLICT_RECORD` append-only (worst/winner payload), `sync_log` en dos fases, `GET /api/v1/conflicts` (supervisor/admin), worker de cola cliente | Daniel Ávila |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Daniel Ávila (con IA) |
