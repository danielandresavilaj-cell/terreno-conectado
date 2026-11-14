# SPEC 006 — Administración de plataforma

| | |
| :--- | :--- |
| **Estado** | ACTIVO — v1.0.0 (detallado en el ciclo del módulo, S9–S12) |
| **Autor** | Raúl González (con IA) |
| **Padre** | specs/000-master/spec.md v1.1.1 §5.6 · data-model.md v1.1.3 |
| **Depende de** | 001 (roles, `platform_admin`, `audit_log`) |
| **Bloquea a** | cierre de F2 (matriz `test-plan.md` §3 sin 🔴), auditoría de la demo |

## Alcance heredado del spec maestro

Requisitos que este spec detalla: **FR-050, FR-051, FR-052** y soporte a **NFR-09**.

- **FR-050** — gestión de tenants por `platform_admin`: crear, asignar `tenant_admin` inicial y habilitar/suspender.
- **FR-051** — audit log **inmutable (append-only)** de las operaciones críticas: creación de tenant, cambios de rol, conflictos de sync e intentos cross-tenant.
- **FR-052** — `GET /health` (uptime, versión, estado de DB) consumible por el monitoreo de QA. **Ya implementado en TSK-WS-012** (`backend/test/health.spec.ts`); este módulo no lo altera.
- **NFR-09** — observabilidad: logs estructurados JSON con `tenant_id` y `request_id` en cada línea.

> **Nota de alcance.** La gestión de usuarios del tenant por un `tenant_admin` (alta/baja, cambio de rol, reset de contraseña) queda **diferida**: no la exige FR-050/051/052 y se decide en el ciclo del módulo 001 (matriz rol × recurso × acción, hoy pendiente en `specs/001`). Este ciclo solo crea el `tenant_admin` inicial.

## Decisiones rectoras (cerradas en este spec; no reabrir sin ADR)

1. **Bypass de RLS del `platform_admin`, explícito y auditado.** El `platform_admin` tiene `app_user.tenant_id = NULL` y opera contra tablas de tenant por la conexión *owner* (`DATABASE_URL`, dueña del esquema), no por `tc_app` + `SET LOCAL app.tenant_id`. Es el único rol que puede ver y mutar datos de cualquier tenant, y **cada mutación suya deja una fila en `audit_log`**. No se toca el guard ni se crea un segundo mecanismo de autorización (constitución Art. IV; `specs/000-master` §7).
2. **`audit_log` es append-only.** `tc_app` tiene `SELECT`/`INSERT` pero no `UPDATE`/`DELETE` (migración `1730000001000_auth.js`). La API admin **no expone** endpoints de update/delete y no los expondrá: la inmutabilidad es una propiedad de la base, no una convención.
3. **Catálogo de acciones con nombre canónico.** Las acciones ya emitidas por otros módulos se documentan aquí y no se renombran (renombrarlas rompería la trazabilidad histórica del log).
4. **Suspensión de tenant = corte de acceso con la menor superficie de cambio.** Suspender marca `tenant.status = 'suspended'` y **revoca todas las sesiones activas del tenant** (`auth_session.revoked_at`); el login y el refresh quedan rechazados de inmediato y el *access token* vigente caduca en ≤15 min (NFR-06). No se añade un chequeo de estado por request en el guard: sería una segunda ruta de autorización sobre un archivo compartido, y el efecto ya es inmediato para toda operación que renueve credenciales.
5. **Sin ruta de amplificación del log.** Leer `audit_log` no produce una fila nueva. El rastro lo garantizan las mutaciones; loguear las lecturas solo crecería el log sin valor forense.

## 1. Modelo del bypass de RLS de `platform_admin`

La cadena de aislamiento del proyecto (constitución Art. IV) es:

```
login → JWT con tenant_id → tc_app + SET LOCAL app.tenant_id → política RLS por tenant
```

El `platform_admin` se sale de esa cadena **de forma deliberada y con rastro**:

| Aspecto | Cómo queda |
| :--- | :--- |
| Identidad | `app_user.tenant_id = NULL`, `role = 'platform_admin'`. La política RLS de `app_user` (`tenant_id = current_setting('app.tenant_id')::uuid`) con `NULL` no lo hace visible a ningún tenant. |
| Conexión | El módulo admin usa **`DbService.queryOwner`** (rol dueño del esquema), no `queryAsTenant`. El owner no está sujeto a las políticas RLS de tenant. |
| Autorización | `AuthGuard` (JWT HS256) + chequeo de rol `platform_admin` en el controlador. **No** hay un guard nuevo. |
| Trazabilidad | Cada mutación escribe una fila en `audit_log` con `actor_id = platform_admin` y `tenant_id = tenant objetivo` (para una acción cross-tenant, `tenant_id = NULL`, como ya hace `sync_tenant_mismatch`). Esa fila es el registro del bypass. |
| Alcance | Solo los endpoints `/api/v1/admin/**`. El resto de la API sigue usando la conexión `tc_app` sujeta a RLS. |

El `platform_admin` **no puede actuar «como si fuera suyo»** un tenant: no obtiene un JWT con el `tenant_id` ajeno ni pasa por la cadena RLS. Cada acto suyo sobre un tenant es una operación de plataforma con su propia fila de auditoría.

## 2. Catálogo de acciones de `audit_log`

Columnas de `audit_log`: `id, actor_id, tenant_id, action, entity_type, entity_id, payload, occurred_at`. `action` es texto libre; este catálogo fija los nombres canónicos.

### 2.1 Acciones de este módulo (nuevas)

| `action` | Emisor | `entity_type` | `entity_id` | `payload` |
| :--- | :--- | :--- | :--- | :--- |
| `tenant_created` | admin | `tenant` | `tenant.id` | `{ name, slug }` |
| `tenant_suspended` | admin | `tenant` | `tenant.id` | `{ status: "suspended", revoked_sessions }` |
| `tenant_reactivated` | admin | `tenant` | `tenant.id` | `{ status: "active" }` |
| `tenant_admin_assigned` | admin | `app_user` | `user.id` | `{ tenant_id, email, rol: "tenant_admin" }` |
| `role_changed` | admin | `app_user` | `user.id` | `{ tenant_id, from, to }` |

### 2.2 Acciones ya emitidas por otros módulos (se documentan, no se tocan)

| `action` | Emisor | Cuándo | `payload` |
| :--- | :--- | :--- | :--- |
| `sync_tenant_mismatch` | sync | Lote con datos de otro tenant (FR-025) | `{ jwt_tenant_id, foreign_tenant_ids, device_id }` |
| `template_import_confirmed` | templates | Confirmación de un import `.xlsx` (FR-047) | `{ template_id, revision_id, archivo, definicion_revisada, publicado }` |
| `inspection_export_lote` | dashboard | Export por lote del período (FR-047) | `{ lote_id, filtros, pedidas, exportadas, fallidas, inspecciones_exportadas, fallos }` |
| `token_reuse` | auth | Reuso de un refresh token ya rotado (D5, NFR-06) | `{ user_id }` |

### 2.3 Conflictos de sync (FR-051): dónde viven

FR-051 pide registrar «conflictos de sync». En la implementación vigente **no** van a `audit_log` sino a **`conflict_record`** (spec 003, TSK-WS-009), que conserva ambas versiones por conflicto LWW, con RLS por tenant y `REVOKE DELETE` para `tc_app` (append-only de facto: no hay ruta de `UPDATE`). Este spec declara esa tabla como parte de la **superficie de auditoría** del sistema y mantiene `audit_log` para las acciones operativas de la tabla §2.1/§2.2. No se duplica el conflicto en `audit_log` para no crear dos fuentes de verdad.

## 3. Contratos HTTP

Todos los endpoints van bajo el prefijo global `/api/v1` (el mismo de `app.setup.ts`) y exigen `Authorization: Bearer <access_token>`. El rol exigido es `platform_admin`; cualquier otro rol recibe `403`. Los cuerpos se validan con **Zod** (`backend/src/admin/contract.ts`) y un fallo responde `400`.

### 3.1 `POST /api/v1/admin/tenants`

Crea un tenant en estado `active`.

**Body**
```jsonc
{ "name": "Minera El Cobre SpA", "slug": "minera-el-cobre" }
```
- `name`: string, 1–120 caracteres.
- `slug`: string, 3–50, minúsculas y guiones (`^[a-z0-9]+(?:-[a-z0-9]+)*$`).

**Respuesta `201`**
```jsonc
{ "id": "uuid", "name": "...", "slug": "...", "status": "active", "created_at": "ISO-8601" }
```
**Efecto de auditoría:** `tenant_created`.

| Código | Cuándo |
| :--- | :--- |
| `400` | Body inválido (Zod) |
| `401` | Sin token, o token inválido/expirado |
| `403` | Rol distinto de `platform_admin` |
| `409` | `slug` ya existe (restricción `UNIQUE`) |

### 3.2 `PATCH /api/v1/admin/tenants/:id`

Habilita o suspende un tenant. `:id` debe ser UUID (`400` si no lo es).

**Body**
```jsonc
{ "status": "suspended" }
```
- `status`: `"active"` | `"suspended"`.

**Respuesta `200`**
```jsonc
{ "id": "uuid", "name": "...", "slug": "...", "status": "suspended" }
```
**Efecto de auditoría:** `tenant_suspended` o `tenant_reactivated` (solo si el estado cambia; fijar el mismo estado responde `200` sin fila nueva).

**Efecto de negocio al suspender:** se revoca toda `auth_session` activa del tenant (`revoked_at = now()`), de modo que el refresh y el login quedan rechazados de inmediato; el access token vigente caduca en ≤15 min. Al reactivar no se restauran sesiones: el usuario vuelve a hacer login.

| Código | Cuándo |
| :--- | :--- |
| `400` | `:id` no es UUID, o body inválido |
| `401` | Sin token, o token inválido/expirado |
| `403` | Rol distinto de `platform_admin` |
| `404` | El tenant no existe |

### 3.3 `POST /api/v1/admin/tenants/:id/admins`

Asigna el `tenant_admin` inicial (FR-050). Si el email ya existe en ese tenant con otro rol, lo **promueve** (y audita `role_changed`); si ya es `tenant_admin`, la operación es idempotente.

**Body**
```jsonc
{ "email": "admin@mina.cl", "full_name": "Andrés Admin", "password": "…" }
```
- `email`: email válido (se normaliza a minúsculas).
- `full_name`: string, 1–120.
- `password`: string, mínimo 12 caracteres. Se hashea con **argon2** (`@node-rs/argon2`), el mismo algoritmo del login. Nunca se guarda en claro ni se devuelve.

**Respuesta `201`** (creado) / **`200`** (promovido o idempotente)
```jsonc
{ "id": "uuid", "tenant_id": "uuid", "email": "...", "full_name": "...", "role": "tenant_admin", "is_active": true }
```
**Efecto de auditoría:** `tenant_admin_assigned` (alta) o `role_changed` (promoción).

| Código | Cuándo |
| :--- | :--- |
| `400` | `:id` no es UUID, o body inválido (email, largo de password) |
| `401` | Sin token, o token inválido/expirado |
| `403` | Rol distinto de `platform_admin` |
| `404` | El tenant no existe |

### 3.4 `GET /api/v1/admin/audit-log`

Lectura filtrada del audit log, más reciente primero (`occurred_at DESC`).

**Query**
| Parámetro | Tipo | Notas |
| :--- | :--- | :--- |
| `tenant` | UUID | Filtra por `tenant_id` |
| `action` | string | Igualdad exacta sobre `action` |
| `desde` | ISO-8601 | `occurred_at >= desde` |
| `hasta` | ISO-8601 | `occurred_at <= hasta` |
| `limit` | entero 1–200 | Por omisión 50 |
| `offset` | entero ≥0 | Por omisión 0 |

**Respuesta `200`**
```jsonc
{
  "items": [
    { "id": "uuid", "occurred_at": "ISO-8601", "actor_id": "uuid|null", "tenant_id": "uuid|null",
      "action": "tenant_created", "entity_type": "tenant", "entity_id": "uuid", "payload": { } }
  ],
  "limit": 50,
  "offset": 0
}
```
**Sin efecto de auditoría** (una lectura no genera fila; decisión 5).

| Código | Cuándo |
| :--- | :--- |
| `400` | UUID/fecha/`limit`/`offset` inválidos |
| `401` | Sin token, o token inválido/expirado |
| `403` | Rol distinto de `platform_admin` |

### 3.5 Errores transversales

Formato estándar de NestJS: `{ "statusCode": number, "message": string | string[], "error": string }`.

- **401** — sin `Authorization: Bearer`, o token inválido/expirado (lo emite `AuthGuard`).
- **403** — token válido con rol ≠ `platform_admin`.
- **400** — validación Zod o UUID mal formado.
- **404 / 409** — según el endpoint (§3.1–3.3).

## 4. Criterios de aceptación

**FR-050 — gestión de tenants**
1. `platform_admin` crea un tenant → `201`, fila en `tenant` con `status = 'active'`, y una fila `tenant_created` en `audit_log`.
2. Asigna el `tenant_admin` inicial → usuario con `role = 'tenant_admin'` en ese tenant, y fila `tenant_admin_assigned`.
3. Suspende el tenant → `tenant.status = 'suspended'`, sesiones del tenant revocadas (`auth_session.revoked_at`), login y refresh rechazados (`401`), y fila `tenant_suspended`.
4. Reactiva el tenant → `tenant.status = 'active'`, el login vuelve a funcionar, y fila `tenant_reactivated`.
5. Un token de rol ≠ `platform_admin` recibe `403` en todos los endpoints admin.

**FR-051 — audit log inmutable**
6. Cada mutación admin deja **exactamente una** fila en `audit_log`, con `actor_id` = id del `platform_admin` y `tenant_id` = tenant objetivo.
7. `audit_log` es append-only: `tc_app` no tiene `UPDATE`/`DELETE`, y la API admin no expone rutas para modificarlo ni borrarlo.
8. El catálogo de acciones (§2.1) se respeta de forma literal en `action`.

**FR-052 — salud**
9. `GET /health` sigue respondiendo `200/503` como en TSK-WS-012; este módulo no lo modifica (regresión cubierta por `backend/test/health.spec.ts`).

## 5. Pruebas (→ `test-plan.md` §3)

| Requisito | Prueba | Nivel | Evidencia |
| :--- | :--- | :--- | :--- |
| FR-050 | Crear tenant, asignar `tenant_admin`, suspender/reactivar; rol ajeno → 403 | Integración (Testcontainers) | `backend/test/admin.spec.ts` |
| FR-051 | Cada mutación deja una fila con `actor_id`/`tenant_id` correctos; no hay ruta de update/delete | Integración | `backend/test/admin.spec.ts` |
| FR-052 | `/health` 200 con DB verificada y 503 con DB caída | Integración | `backend/test/health.spec.ts` (existente) |

## 5b. Enmienda 003 — cuentas reales v1 (2026-11-11, TSK-ADM-001)

Cierra lo que este spec dejaba fuera (§6) para operar con clientes reales:

| Requisito | Contrato | UI |
| :--- | :--- | :--- |
| Listar empresas (FR-050) | `GET /api/v1/admin/tenants` (con cuentas activas y admins) | Pantalla **Empresas** (`platform_admin`) |
| Admin inicial con clave temporal (FR-050, FR-055) | `POST /api/v1/admin/tenants/:id/admins` crea con `must_change_password = true` | Empresas → "Crear administrador" |
| Cuentas de la empresa (FR-053) | `GET/POST /api/v1/users`, `PATCH /api/v1/users/:id`, `POST /api/v1/users/:id/reset-password` (sólo `tenant_admin`, con RLS) | Pantalla **Equipo** |
| Faenas (FR-054) | `POST /api/v1/sites`, `PATCH /api/v1/sites/:id` (sólo `tenant_admin`) | Equipo → pestaña Faenas |
| Primer `platform_admin` | `infra/tools/bootstrap-admin.mjs` (interactivo, se niega si ya existe uno) | — |

Reglas: nadie puede desactivarse a sí mismo ni dejar la empresa sin `tenant_admin` activo; desactivar, cambiar rol o restablecer la clave revoca las sesiones del usuario; cada cambio va a `audit_log` (`user_created`, `user_updated`, `password_reset`, `site_created`, `site_updated`). Pruebas: `backend/test/users.spec.ts`. Tareas: `tasks/006-admin-plataforma/tasks.md`.

**Alta masiva (TSK-ADM-002, FR-053):** en Equipo, "Agregar varias cuentas" acepta filas pegadas desde Excel o un `.csv` (`nombre; correo; rol`, separador coma, punto y coma o tabulación; rol en español y opcional, por omisión trabajador). La app muestra antes cuántas cuentas creará y qué filas rechaza y por qué (nombre vacío, correo inválido, rol desconocido, correo repetido o ya existente). Crea cada cuenta con la misma API del alta individual (cada una con su clave temporal y su registro de auditoría) y al terminar ofrece descargar un `.csv` con las claves temporales, que no se vuelven a mostrar. Sin cambios de API.

**Faenas por cuenta (TSK-ADM-003, FR-065, Enmienda 008):** en Equipo, cada cuenta de terreno o supervisión tiene el botón "Faenas: todas / N de M" (sólo si la empresa tiene más de una faena), que abre la elección de faenas. Se guarda con `PUT /api/v1/users/:id/faenas` `{faena_ids}`: reemplazo completo, `[]` = todas, faenas repetidas se ignoran, una faena de otra empresa → 400, una cuenta de otra empresa → 404. `GET /api/v1/users` trae `faena_ids`. El cambio llega al teléfono la próxima vez que abra la app con señal.

## 6. Fuera de alcance de este ciclo

- **UI del panel admin** — el tipo `Pantalla` y la navegación viven en `frontend/src/lib/store.tsx`, zona de Daniel; se coordina aparte.
- **Gestión de usuarios del tenant por `tenant_admin`** (alta/baja, cambio de rol, reset) — hito del módulo 001.
- **Export CSV** (módulo 005) y **NFR-07/Lighthouse** (tarea propia del hito).

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 1.1.0 | 2026-11-14 | TSK-ADM-003 (FR-065): faenas por cuenta en Equipo y `PUT /users/:id/faenas` | Daniel Ávila (con IA) |
| 1.0.1 | 2026-11-13 | TSK-ADM-002: alta masiva de cuentas desde una planilla (sólo interfaz, misma API) | Daniel Ávila (con IA) |
| 1.0.0 | 2026-10-13 | Spec detallado: modelo del bypass de RLS, catálogo de acciones de auditoría, contratos HTTP y criterios de aceptación de FR-050/051/052 (issue #9) | Raúl González (con IA) |
| 0.1.1 | 2026-10-08 | Contrato `/health` detallado e implementado en TSK-WS-012 (200/503, shape, logs JSON NFR-09) | Daniel Ávila |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Raúl González (con IA) |
