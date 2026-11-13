# SPEC 004 — Dominio inspecciones

| | |
| :--- | :--- |
| **Estado** | COMPLETO (base F2) · TSK-OPS-003-B en revisión (#191); Enmienda 007 continúa por tareas |
| **Versión** | 0.6.0 |
| **Autor** | Daniel Ávila |
| **Padre** | specs/000-master/spec.md |
| **Depende de** | 001 (roles/tenant), 003 (ingesta idempotente) |
| **Bloquea a** | 002 (formularios renderizan plantillas), 005 (reportes consumen dominio) |
| **Plan técnico** | `plans/004-dominio-inspecciones/plan.md` |

## 1. Alcance

Requisitos que este spec detalla: **FR-030 → FR-039** y, por Enmienda 007 (aprobada), **FR-056 → FR-061**; entidades de dominio de `data-model.md` §2.2. La entrega vertical de firma (FR-056/057) está en revisión como TSK-OPS-003-B; QR, programación y correo siguen pendientes.

- **FR-030** Plantillas de inspección como `TEMPLATE` + `TEMPLATE_REVISION` (secciones, ítems).
- **FR-031** Ciclo de vida de la inspección: `draft → in_progress → submitted → reviewed`.
- **FR-032** Hallazgos con severidad (baja/media/alta/crítica) y estado (open/in_progress/resolved), con evidencia fotográfica.
- **FR-033** Bitácoras de turno: entradas cronológicas con autor, tags y faena.
- **FR-034** Asociación a faena + geolocalización **opcional**.
- **FR-035** Destacado inmediato de hallazgos altos/críticos al sincronizar.
- **FR-036** Plantillas versionadas e inmutables: `draft → published → archived`; 8 tipos de respuesta V1 + `props` JSONB.
- **FR-037** Foto de ítem asociada a la **respuesta** (`ATTACHMENT.owner_type = response`).
- **FR-038** **Versión congelada** por inspección (`template_revision_id`), conservada en el historial.
- **FR-039** `value_json` validado contra `TEMPLATE_ITEM.props` en el dispositivo antes de encolar.
- **FR-056/057** Cierre certificado: firma de inspector y cofirma opcional de supervisión.
- **FR-058** Avisos de correo durables y no bloqueantes.
- **FR-059** Programación por responsable, faena, activo/lugar y zona horaria.
- **FR-060/061** Activo/lugar con QR opaco, escaneable o introducible manualmente.

> El dominio **se escribe por el motor de sincronización** (spec 003) y **se lee por el dashboard** (spec 005): no hay un CRUD de inspecciones aparte. El único CRUD propio es el de plantillas (`tenant_admin`).

## 2. Estado de implementación

> **Actualización v1 (2026-11-11, TSK-DOM-005).**
> - **FR-031 ✅:** `PATCH /api/v1/inspections/:id/review` (supervisor / tenant_admin) pasa una inspección `submitted` a `reviewed` y lo audita (`inspection_reviewed`); el estado ya no puede declararse desde la cola de un trabajador. UI: "Marcar como revisada" en el detalle del dashboard.
> - **FR-032 ✅:** `PATCH /api/v1/findings/:id` con `status ∈ {open, in_progress, resolved}`, auditado (`finding_status_changed`). UI: selector de estado en cada hallazgo del dashboard.
> - **Conflictos:** `PATCH /api/v1/conflicts/:id/review` guarda `reviewed_at` / `reviewed_by` (migración 014); ambas versiones siguen inmutables.
> - **FR-038 (corrección de texto):** la inspección congela `template_id + template_version` (data-model v1.1.3), no un `template_revision_id`; en el dispositivo se guarda además `templateRevisionId` para resolver la revisión exacta.
> Pruebas: `backend/test/supervision.spec.ts`.

Verificado sobre `main` al 2026-10-13.

| Requisito | Estado | Evidencia |
| :--- | :--- | :--- |
| FR-030 plantilla + revisión | ✅ | `backend/db/migrations/*_template*`; `backend/src/templates/templates.service.ts` |
| FR-031 ciclo de la inspección | ✅ | `shared/src/sync.ts` (`SyncInspectionStatus`); conteo por estado en `dashboard.service.ts:150` |
| FR-032 hallazgos sev/estado + foto | ✅ | `backend/src/sync/sync.service.ts` (`finding`, `attachment`); `shared/src/sync.ts` (`SyncSeverity`, `SyncFindingStatus`) |
| FR-033 bitácora de turno | ✅ | `backend/src/sync/sync.service.ts` (`log_entry`); `frontend/src/screens/Bitacora.tsx` |
| FR-034 faena + geo opcional | ✅ | `inspection.site_id`; migración `1730000011000_inspection_location.js` (`location_lat` / `location_lon` NUMERIC); `shared/src/sync.ts` (`SyncInspectionPayload.location`); `backend/src/sync/sync.service.ts` (validación + persistencia); captura opcional en `frontend/src/lib/store.tsx` (`enviarInspeccion`); tests en `backend/test/sync.spec.ts` |
| FR-035 hallazgos urgentes | ✅ | `dashboard.service.ts:137-147,164` (`hallazgos_urgentes`, high/critical no resueltos) |
| FR-036 revisión inmutable + 8 tipos | ✅ | `templates.service.ts` (nula edición fuera de `draft`); `shared/src/templates.ts` (`RESPONSE_TYPES`, `FIELD_PROPS_SCHEMA` estricto) |
| FR-037 foto por respuesta | ✅ | `sync.service.ts` (`OWNER_TYPES` incluye `response`); `data-model.md` §2.2 |
| FR-038 versión congelada | ✅ | `frontend/src/lib/store.tsx` (borrador congelado), `frontend/src/lib/plantillas.ts`; spec 003 §6.2 |
| FR-039 validación de `value_json` | ✅ | `shared/src/templates.ts` (`validarRespuesta`, FR-039) |

## 3. Modelo de dominio

### 3.1 Plantilla y revisión (FR-030/036)

- `TEMPLATE` es la cabecera; `TEMPLATE_REVISION` es la versión concreta (secciones + ítems). Una revisión publicada es **inmutable**: `templates.service.ts` sólo permite editar revisiones en `draft` (404/409 en cualquier otro estado).
- La numeración visible (`version`) es **por plantilla**; la secuencia del delta (`published_seq`) es **global** (ver spec 003 §6.1 y `data-model.md` §4).
- El versionado llega desde el módulo 007: 8 `response_type` + `props` JSONB validados con Zod `strict()` (una prop desconocida es error). Ver `adr/003` Enmienda 2 y `specs/007`.

### 3.2 Tipos de respuesta (FR-036)

`ok_nok_na · text · numeric · date · time · select_single · select_multiple · photo` (`shared/src/templates.ts:18`).

### 3.3 Inspección (FR-031/034/038)

Estados `draft → in_progress → submitted → reviewed`. Lleva `site_id` (faena), `location` geográfico opcional (FR-034) y `template_revision_id` congelado (FR-038). La captura vive en el outbox offline (spec 002) y entra por `POST /api/v1/sync/batch`.

### 3.4 Hallazgo, bitácora, adjunto (FR-032/033/037)

- `finding`: `severity (low/medium/high/critical)` + `status (open/in_progress/resolved)`, ligado a `inspection` y, si aplica, a `inspection_response`.
- `log_entry`: entrada cronológica de bitácora con autor, tags y faena.
- `attachment`: `owner_type ∈ {inspection, finding, log_entry, response, template_import}`; la **foto de ítem** se cuelga de `response` (FR-037). Los bytes viven en el volumen de adjuntos; el batch viaja sin `data`.

## 4. Validación de respuestas (FR-039)

`validarRespuesta(item, valor)` (`shared/src/templates.ts`) corre **en el dispositivo antes de encolar**: valida el `value_json` contra los `props` del ítem (rango numérico, `max_length` de texto, límites de fecha, `required`, etc.). Una respuesta inválida no entra al outbox. El mismo criterio de `props` valida al **guardar** la revisión (FR-036/039), así que dispositivo y servidor no pueden divergir.

## 5. Reglas de negocio

- **Hallazgo obligatorio en `nok`:** un ítem `ok_nok_na` marcado `NOK` exige hallazgo (`props`/regla de captura, FR-032/036).
- **Un hallazgo por respuesta, corregible (TSK-OFF-007):** la respuesta `NOK` de un ítem tiene un solo hallazgo. Corregirlo en el dispositivo conserva su UUID y sube `client_version`; nunca crea un segundo registro. Un ítem cuenta como "con hallazgo" sólo si ese registro existe (no basta con que la respuesta sea `NOK`).
- **Hallazgo opcional en cualquier NOK (TSK-OFF-012):** todo ítem `ok_nok_na` respondido `NOK` ofrece registrar un hallazgo; sólo es obligatorio (y bloquea el envío) si la plantilla lo exige con `require_finding_on_nok`.
- **Acción correctiva (TSK-DOM-007, FR-064, Enmienda 008):** supervisión asigna responsable (cuenta activa de la empresa), plazo y nota de cierre con `PATCH /api/v1/findings/:id` (`status`, `assignee_id`, `due_date`, `resolution_note`; cualquier combinación, al menos uno; campos desconocidos → 400). Cada cambio de estado deja `finding_status_changed`; los de gestión, `finding_assigned` con `{campo: {de, a}}`. `GET /api/v1/findings/responsables` lista a quién se puede asignar. La interfaz pide la nota al resolver y sugiere un plazo según la severidad (crítica 1 día, alta 3, media 7, baja 14); un hallazgo abierto con plazo pasado se marca "Vencido".
- **Severidad elegida y descripción (TSK-OFF-007):** la severidad no viene preseleccionada; un hallazgo `alta` o `crítica` exige descripción (mínimo 5 caracteres) antes de guardarse. La regla es del dispositivo (`frontend/src/lib/hallazgo.ts`); el servidor sigue aceptando cualquier descripción no vacía.
- **Destacado inmediato (FR-035):** al consolidar un lote, los hallazgos `high`/`critical` no resueltos se cuentan en `hallazgos_urgentes` del resumen, visibles de inmediato para el supervisor.
- **Inmutabilidad de lo publicado (FR-036/049):** no hay edición de revisiones `published`; un cambio es una **nueva** versión. Las inspecciones en vuelo conservan la suya (FR-038).

## 6. Criterios de aceptación

- Matriz §3 de `test-plan.md`: filas **FR-031/032** verdes (`backend/test/dashboard.spec.ts`, integración de sync).
- Un ítem `NOK` sin hallazgo no se puede enviar; con hallazgo, entra al outbox y sincroniza (FR-032).
- Una revisión publicada no se puede editar; intentarlo devuelve 409 y no altera lo capturado (FR-036).
- Una inspección en curso mantiene su `template_revision_id` aunque se publique una revisión nueva (FR-038, spec 003 §6.2).
- Un `value_json` fuera de `props` se rechaza **en el dispositivo** y no llega al outbox (FR-039).

## 7. Referencias

- `specs/000-master/spec.md` §3.2 (FR-030…039), §5.3
- `data-model.md` §2.2 (entidades de dominio), §4 (integridad)
- `test-plan.md` §3 (matriz FR-031/032), §4.1 (caos 9–11 del módulo 007)
- `specs/007-formularios-dinamicos/spec.md`, `adr/003` (formularios dinámicos)
- `plans/004-dominio-inspecciones/plan.md`
- `plans/008-operacion-certificada/plan.md` (Enmienda 007)

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.6.0 | 2026-11-13 | **TSK-DOM-007 (Enmienda 008, FR-064):** hallazgo como acción correctiva — responsable, plazo y nota de cierre, auditados | Daniel Ávila (con IA) |
| 0.5.3 | 2026-11-13 | **TSK-OFF-012:** hallazgo opcional en cualquier NOK; obligatorio sólo si la plantilla lo exige | Daniel Ávila (con IA) |
| 0.5.2 | 2026-11-13 | **TSK-OFF-007:** un hallazgo por respuesta, corregible sin duplicar; severidad sin valor por omisión y descripción obligatoria en alta/crítica | Daniel Ávila (con IA) |
| 0.5.1 | 2026-11-12 | **TSK-OPS-003-B (#191, en revisión):** firma vectorial offline del inspector, cofirma opcional, inmutabilidad y evidencia de firmas en el detalle; validación de integración/E2E pendiente de Docker/CI | Raúl González (con IA) |
| 0.5.0 | 2026-11-12 | **Enmienda 007** (aprobada por Daniel Ávila el 2026-11-12): incorpora FR-056…061 y remite al plan de operación certificada; no declara funcionalidad implementada hasta cerrar sus tareas | Raúl González (con IA) |
| 0.3.1 | 2026-10-14 | **FR-034 geolocalización implementada realmente** (antes estaba documentada como GEOGRAPHY(Point) que no existía en la migración): columnas `location_lat`/`location_lon` NUMERIC, validación server-side, captura opcional con `navigator.geolocation` al enviar inspección, tests de integración. Actualiza evidencia §2 y `data-model.md` §2.2 | Daniel Ávila |
| 0.3.0 | 2026-10-13 | **Spec completado (F2).** Documenta el estado real de FR-030…039 (todos implementados), el modelo de dominio (plantilla/revisión, inspección, hallazgo, bitácora, adjunto) y la validación de `value_json`. Apunta al plan técnico y a `tasks/004` | Daniel Ávila |
| 0.2.0 | 2026-10-07 | **Módulo 007 (Enmienda 002):** alcance +FR-036–039; plantillas por `TEMPLATE_REVISION` inmutable; 8 `response_type` + `props` JSONB; `value_json` validado; foto asociada a la respuesta; versión congelada por inspección | Raúl González (con IA) |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Daniel Ávila (con IA) |
