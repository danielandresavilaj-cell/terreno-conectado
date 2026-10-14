# SPEC 001 — Autenticación y tenancy

| | |
| :--- | :--- |
| **Estado** | COMPLETO (ciclo del módulo, F2 · 2026-10-14) |
| **Versión** | 1.0.0 |
| **Autor** | Raúl González |
| **Padre** | specs/000-master/spec.md |
| **Depende de** | — (primer módulo: todo lo demás lo consume) |
| **Bloquea a** | 002, 003, 004, 005, 006 |
| **Plan técnico** | `plans/001-auth-tenancy/plan.md` |
| **Tareas** | `tasks/001-auth-tenancy/tasks.md` |

## 1. Alcance

Requisitos que este spec detalla: **FR-001 → FR-006** y soporte a **NFR-05, NFR-06**.

- **FR-001** Autenticar con email y contraseña (hash **argon2id**, §4) y emitir un **JWT de corta duración** (15 min) con claims `user_id` (`sub`), `tenant_id` y `rol`.
- **FR-002** Restringir todo acceso a datos del propio tenant mediante **Row-Level Security** en PostgreSQL (§7). Es el aislamiento primario; el `tenant_id` se toma siempre de las claims, nunca del cuerpo de la petición.
- **FR-003** Soportar los roles `field_worker`, `supervisor`, `tenant_admin`, `platform_admin` con permisos crecientes, definidos en la **matriz §3**.
- **FR-004** Permitir la renovación con refresh token **sin perder la cola de sync local pendiente** (§5.2; escenario caos 6, §9).
- **FR-005** SI 5 credenciales son inválidas consecutivas, ENTONCES bloqueo temporal de 15 minutos **por cuenta y por IP** (§5.1).
- **FR-006** Incluir un tenant demo sembrado (empresas, faenas y usuarios de cada rol) para la demostración académica (§8).

> **NFR-05** (aislamiento verificable en CI) y **NFR-06** (TLS obligatorio, argon2, JWT ≤ 15 min, secretos fuera del repo) se soportan desde este módulo. El bypass de RLS del `platform_admin` y el modelo de sesión son las dos decisiones que este spec fija por escrito.

## 2. Estado de implementación

Verificado sobre `main` al 2026-10-14. Todo el módulo está **implementado y probado**; este spec lo documenta de forma retroactiva (el código precede al spec, ver `plans/f2-paralelo/plan.md` §1).

| Requisito | Estado | Evidencia |
| :--- | :--- | :--- |
| FR-001 login + JWT con claims | ✅ | `backend/src/auth/auth.service.ts` (`login`, `signAccessToken`); `backend/test/auth.spec.ts` → "emite access token con claims user_id/tenant_id/rol y cookies rt/csrf" |
| FR-002 RLS por tenant | ✅ | `backend/src/db/db.service.ts` (`queryAsTenant`, `SET LOCAL app.tenant_id`); `backend/test/rls.spec.ts` |
| FR-003 roles + matriz de permisos | ✅ | matriz §3; `backend/src/admin/admin.controller.ts`, `dashboard/dashboard.auth.ts`, `templates/templates.controller.ts`; `backend/test/admin.spec.ts` (403 a no-`platform_admin`) |
| FR-004 refresh sin perder cola | ✅ | `auth.service.ts` (`refresh`), rotación D5 §6; `frontend/e2e/specs/e2e-caos-sync.spec.ts` → "caos 6 — token expirado en cola" |
| FR-005 bloqueo 5 fallos / 15 min | ✅ | `auth.service.ts` (`registerAccountFail`, `registerIpFail`); `backend/test/auth.spec.ts` → "5 fallos consecutivos bloquean la cuenta 15 min" |
| FR-006 tenant demo sembrado | ✅ | `backend/db/seed.ts`; `backend/test/auth.spec.ts` (`describe('login (FR-001, FR-006)')`) |

## 3. Matriz rol × recurso × acción

El rol viaja en la claim `rol` del access token y **nunca se confía en un parámetro del cliente**. La autorización es una comprobación de rol + pertenencia a un tenant, sin un segundo mecanismo (p. ej. no hay tabla de permisos separada).

Leyenda: ✅ permitido · ⛔ denegado (`403`) · 🌐 público (sin sesión).

| Recurso · acción (endpoint) | `field_worker` | `supervisor` | `tenant_admin` | `platform_admin` |
| :--- | :---: | :---: | :---: | :---: |
| `POST /api/v1/auth/login` | 🌐 | 🌐 | 🌐 | 🌐 |
| `POST /api/v1/auth/refresh` | 🌐 (con cookie `rt` + CSRF) | 🌐 | 🌐 | 🌐 |
| `GET /api/v1/me` | ✅ | ✅ | ✅ | ✅ |
| `GET /api/v1/sites` (faenas del tenant) | ✅ | ✅ | ✅ | ⛔ |
| `POST /api/v1/sync/batch` | ✅ | ✅ | ✅ | ⛔ |
| `GET /api/v1/dashboard/*` (resumen, hallazgos, inspecciones, export) | ⛔ | ✅ | ✅ | ⛔ |
| `GET /api/v1/conflicts` · resolver conflicto | ⛔ | ✅ | ✅ | ⛔ |
| Plantillas: leer las **publicadas y asignadas** a su faena/rol | ✅ | ✅ | ✅ | ⛔ |
| Plantillas: leer **borradores** | ⛔ | ⛔ | ✅ | ⛔ |
| Plantillas: editar · publicar · importar | ⛔ | ⛔ | ✅ | ⛔ |
| `POST/PATCH/GET /api/v1/admin/*` (tenants, admins, audit-log) | ⛔ | ⛔ | ⛔ | ✅ |

Puntos de enforcement en el código:

- **`platform_admin` no tiene tenant** (`tenant_id = NULL`). Por eso cae primero en el `403 "Requerido un tenant"` (`dashboard.auth.ts`) antes que en el de rol: es un rol de plataforma, no de negocio. Su único recurso es `/admin/*`, que bypassa RLS de forma deliberada y auditada (ver spec 006 y §7).
- **`tenant_admin`** es el único que escribe plantillas (`templates.controller.ts:93,220,386,420`).
- **Operativos** (`field_worker`, `supervisor`) ven sólo lo asignado a su rol/faena (`ROLES_OPERATIVOS`, `template_assignment`).
- El dashboard es de `supervisor` y `tenant_admin` (`DASHBOARD_ROLES`, `dashboard.auth.ts:14`); `GET /sites` admite también a `field_worker` (`dashboard.service.ts:62`) para que la PWA arranque con su faena.

> **Observación (fuera de la zona de este módulo):** `backend/src/sync/sync.service.ts:87` define `CONFLICT_VIEWER_ROLES = {supervisor, admin, admin_plataforma}`. Los nombres `admin`/`admin_plataforma` no son los roles canónicos (`tenant_admin`/`platform_admin`), así que en el código actual un `tenant_admin` no coincidiría. La matriz de arriba es la intención canónica; la discrepancia se traslada a quien mantiene el modulo 003.

## 4. Hash y política de contraseñas (FR-001, NFR-06)

- **Algoritmo:** **argon2id** vía `@node-rs/argon2` (v2.2.2). El alta hashea con `hash(password)` **con los parámetros por defecto de la librería**: `m = 19456 KiB (19 MiB)`, `t = 2`, `p = 1`, salida de 32 B. Coinciden con la recomendación OWASP 2024 y no se fijan a mano para no divergir de la librería.
- **Verificación:** `verify(hash, password)` (`auth.service.ts:179`). Un hash corrupto devuelve `false`, nunca una excepción que escape al handler.
- **Política de contraseñas (alta de cuenta):** mínimo **12** caracteres, máximo 200, sin reglas de composición en V1 (`backend/src/admin/contract.ts`, `asignarAdminSchema`). La política se aplica en el **alta** (el `platform_admin` que crea el `tenant_admin`); el login **no** re-valida la política, sólo verifica.
- **Secretos:** `JWT_ACCESS_SECRET` y `DEMO_PASSWORD` vienen del entorno (`.env`, nunca del repo); `DEMO_PASSWORD` es obligatoria y el seed falla si no está (`seed.ts:21`). El scan de secretos (`gitleaks`) corre en CI.

## 5. Contratos de endpoints

Todos bajo el prefijo `/api/v1`. El cuerpo se valida con Zod (admin) o a mano (login); los errores 4xx devuelven un mensaje genérico para **no enumerar** cuentas.

### 5.1 `POST /api/v1/auth/login` (FR-001, FR-005)

**Request body:**

```jsonc
{ "email": "trabajador@minera.cl", "password": "…", "tenant": "minera-el-cobre" }
```

`tenant` (slug) es **opcional**: sólo es obligatorio si el email existe en más de un tenant (el mismo email puede repetirse entre tenants; el índice `app_user_tenant_email_uidx` es sobre `(tenant_id, email)`).

**Respuesta `200`:**

```jsonc
{
  "access_token": "<JWT HS256, 15 min>",
  "user": { "id": "…", "tenant_id": "…", "email": "…", "role": "field_worker", "full_name": "…" }
}
```

Además fija las cookies `rt` (httpOnly) y `csrf` (legible por JS) — ver §6.

**Errores:**

| Código | Cuándo |
| :--- | :--- |
| `400` | Falta `email` o `password` (tipo incorrecto). |
| `401` | Credenciales inválidas. **Misma respuesta** para email inexistente, password errónea, email en dos tenants sin `tenant`, cuenta inactiva o tenant no activo (anti-enumeración). |
| `423 Locked` | Cuenta bloqueada por 5 fallos (`locked_until` vigente). |
| `429 Too Many Requests` | IP bloqueada por 5 fallos. |

**Rate-limit (FR-005) — dos contadores independientes:**

- **Por cuenta:** columnas `app_user.failed_login_count` y `app_user.locked_until`. Al 5.º fallo se fija `locked_until = now() + 15 min` (`registerAccountFail`). Un login correcto resetea el contador a 0.
- **Por IP:** `Map` en memoria del proceso (`registerIpFail`/`isIpBlocked`). Al 5.º fallo la IP queda bloqueada 15 min (`429`). El `ip` sale de `req.ip` con `trust proxy = 1` (`app.setup.ts:32`).
- **Limitación conocida:** el contador por IP es **en memoria de una sola instancia**; con varias réplicas hace falta un store compartido (ADR-002). Documentado en `auth.service.ts:32`.

### 5.2 `POST /api/v1/auth/refresh` (FR-004, D5)

**Request:** sin cuerpo. Requiere la cookie `rt` **y** la cookie `csrf` **y** el header `X-CSRF-Token` igual al valor de la cookie `csrf` (double-submit, §6).

**Respuesta `200`:** `{ "access_token": "…" }` y **rotación** de la cookie `rt` (mismo `family_id`).

**Errores:**

| Código | Cuándo |
| :--- | :--- |
| `401` | Faltan `rt`/`csrf`, el header CSRF no coincide, la sesión no existe o la cuenta está inactiva. |
| `401` | **Reuso** de un refresh ya rotado → se **revoca toda la familia** y se audita `token_reuse` (§6). |
| `401` | Refresh expirado (30 días) → se marca revocado y se limpian las cookies. |

FR-004 se cumple porque el refresh es **transparente para la cola**: la cola vive en IndexedDB (spec 002/003) y un `401` marca las filas como `failed` para reintentar, **nunca** las borra. El cliente reintenta tras re-loguear y el lote drena sin duplicar (idempotencia, spec 003).

### 5.3 `GET /api/v1/me` (FR-001)

**Request:** `Authorization: Bearer <access_token>`.

**Respuesta `200`:** `{ "id", "tenant_id", "email", "role", "full_name" }` (`PublicProfile`).

Lee por RLS como el tenant del token (`queryAsTenant`); para `platform_admin` (sin tenant) lee por el pool *owner*. Sin token o token inválido → `401`.

## 6. Modelo de sesión y decisión D5

**Access token:** JWT **HS256** (secreto `JWT_ACCESS_SECRET`), TTL **15 min** (`jose`, `setExpirationTime('15m')`). Claims: `sub` (user_id), `tenant_id`, `rol`, `full_name`, `iat`, `exp`. El guard (`auth.guard.ts`) verifica firma y algoritmo y deja los claims en `req.user`; cualquier fallo → `401`.

**Refresh token:** 32 bytes aleatorios (`base64url`); de la BD sólo se guarda su `sha256`. Vive 30 días. **Una sesión activa por usuario**: un login nuevo revoca las sesiones previas; las rotaciones conviven dentro de su `family_id`.

**Decision D5 (ratificada el 2026-10-14, ver control de cambios):**

- `rt` en cookie **httpOnly** (`Secure` en producción, `SameSite=Strict`, `Path=/api/v1/auth`).
- **Rotación en cada refresh** + **detección de reuso**: si un `rt` ya rotado se presenta de nuevo, se asume robo → se revoca la familia completa y se escribe `audit_log(action = 'token_reuse')`.
- **CSRF double-submit:** header `X-CSRF-Token` espejo de la cookie `csrf` legible por JS.
- **Access token fuera de la cookie:** no viaja en cookie, va en `Authorization`.

> **Desviación conocida respecto al texto original de D5:** D5 decía "access token **solo en memoria**". La PWA lo guarda en `sessionStorage` (`tc_access_token`): sobrevive recargas de la pestaña y se pierde al cerrarla, pero no es estrictamente "sólo memoria". Es una diferencia de longevidad, no de radio de exposición (mismo origen, sin persistencia en disco). Queda como **TSK-001-012** en `tasks/001-auth-tenancy/tasks.md` para alinear código y decisión.

## 7. Aislamiento por tenant — RLS (FR-002, NFR-05)

- **Aislamiento primario = Row-Level Security** en PostgreSQL. El backend abre la transacción con `SET LOCAL app.tenant_id = <tenant del JWT>` y consulta como el rol de aplicación `tc_app`; las políticas RLS restringen cada fila a su tenant. La prueba vive en `backend/test/rls.spec.ts` (Testcontainers) y la fila FR-002/FR-005 de `test-plan.md` §3 ya está 🟢.
- **El `tenant_id` nunca viene del cliente.** En `POST /sync/batch` el tenant se toma de las claims; un payload con tenant ajeno se rechaza antes de escribir (`409`, FR-025).
- **Bypass deliberado del `platform_admin`:** no tiene tenant y opera por el pool *owner* (`queryOwner`), que no aplica RLS. Es la única vía de cruce de tenants y **toda mutación deja fila en `audit_log`** (spec 006). No existe un segundo mecanismo de autorización.

## 8. Tenant demo (FR-006)

Sembrado por `backend/db/seed.ts`, idempotente (`ON CONFLICT`). La contraseña demo sale de `DEMO_PASSWORD` y se hashea con argon2id.

- **Tenant A** `Minera El Cobre SpA` (`minera-el-cobre`) · faena **Faena El Roble** (`mining`).
  - `trabajador@minera.cl` (`field_worker`), `supervisor@minera.cl` (`supervisor`), `admin@minera.cl` (`tenant_admin`).
- **Tenant B** `Constructora Andes SpA` (`constructora-andes`) · faena **Obra Costanera** (`construction`).
  - `trabajador@andes.cl` (`field_worker`), `supervisor@andes.cl` (`supervisor`).
- **Plataforma:** `admin@terreno.local` (`platform_admin`, `tenant_id = NULL`).

El tenant B existe para probar el aislamiento (FR-002) y el rechazo cross-tenant (FR-025) contra datos reales, no mocks.

## 9. Criterios de aceptación

- **FR-001** Un login válido devuelve `access_token` con `sub`/`tenant_id`/`rol` y las cookies `rt`/`csrf`; una password errónea devuelve `401` **sin** distinguir la causa (`auth.spec.ts`).
- **FR-002** Un usuario del tenant A nunca ve datos del B en ningún endpoint de lectura (`rls.spec.ts`, fila 🟢).
- **FR-003** Cada endpoint respeta la matriz §3: `platform_admin` en `/dashboard` → `403`; `field_worker` en `/admin` → `403`; `tenant_admin` es el único que publica plantillas (`admin.spec.ts` + guardas por controlador).
- **FR-004** Con el access token vencido y la cola con pendientes, un `401` deja las filas en `failed` (no las borra); al re-loguear la cola drena sin duplicar (caos 6, `e2e-caos-sync.spec.ts`).
- **FR-005** 5 fallos consecutivos bloquean la cuenta 15 min (`423`) e independientemente bloquean la IP 15 min (`429`) (`auth.spec.ts`).
- **FR-006** El seed deja el tenant demo listo y cada rol puede entrar; un arranque en frío de la PWA con un usuario sembrado supera el login (test-plan.md §4, H1).
- **D5** El refresh rota `rt` en cada uso, detecta el reuso y exige CSRF double-submit (`auth.spec.ts` → "rota la cookie rt…", "exige CSRF double-submit").

## 10. Referencias

- `specs/000-master/spec.md` §3.1 (FR-001…006), §3.5 (NFR-05/06), §4 (roles), §9 (guion demo)
- `data-model.md` §2.1 (`app_user`, `auth_session`, `tenant`) y §4 (integridad)
- `test-plan.md` §3 (filas FR-001/002/003/004/005/006), §4 (caos 6, H1/H6)
- `specs/006-admin-plataforma/spec.md` (bypass RLS auditado, audit log)
- `plans/001-auth-tenancy/plan.md` · `tasks/001-auth-tenancy/tasks.md`
- `adr/002` (topología de despliegue: same-origin, una instancia / store compartido)

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-10-14 | **Spec completado (F2).** Documenta el estado real de FR-001…006: matriz rol × recurso × acción (§3), argon2id + política de contraseñas (§4), contratos `login`/`refresh`/`me` con rate-limit (§5), modelo de sesión D5 ratificado (§6), RLS (§7) y tenant demo (§8). Registra la desviación `sessionStorage` vs "solo en memoria" (TSK-001-012). Añade filas FR-001/003/004/006 a `test-plan.md` §3 | Raúl González |
| 0.2.0 | 2026-10-06 | **Decisión D5:** refresh en cookie httpOnly con rotación + detección de reuso y CSRF double-submit (issue #11) | Raúl González |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Raúl González (con IA) |
