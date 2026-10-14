# PLAN — Módulo 001: Autenticación y tenancy

| | |
| :--- | :--- |
| **Versión** | 1.0.0 · **Fecha:** 2026-10-14 · **Autor:** Raúl González |
| **Derivado de** | `specs/001-auth-tenancy/spec.md` (v1.0.0) · `specs/000-master/spec.md` §3.1, §4 |
| **Relacionado** | `data-model.md` §2.1/§4 · `test-plan.md` §3 · `adr/002` |
| **Tareas** | `tasks/001-auth-tenancy/tasks.md` (TSK-AUTH-001 → 008) |

> **Qué es este plan:** el *cómo* del primer módulo, que gobierna a todos los demás. El código ya existía cuando este spec se completó (F2); el plan documenta las decisiones reales, no un diseño hipotético, y anota el trabajo diferido (TSK-AUTH-006/007/008) para que el cierre no oculte huecos.

## 1. Objetivo

Dejar de una vez y para siempre la pregunta **"¿quién puede tocar qué datos?"** (constitución, Artículo IV): login, JWT de 15 min con claim de tenant, cuatro roles con permisos crecientes, aislamiento por RLS y un tenant demo listo para la demo. Nada de dominio antes de que esta capa esté probada.

## 2. Orden de construcción (dependencias reales, no numeración)

```
TSK-WS-002  esquema de tenancy: `tenant`/`app_user` + RLS (`tc_app`) + seed A/B +
            índice único `(tenant_id, email)` (FR-002, FR-006, NFR-05)
   └──► TSK-WS-003  auth:
            ├─ POST /auth/login (JWT 15 min, claims) (FR-001)
            ├─ GET /me + AuthGuard HS256
            ├─ rate-limit cuenta+IP 5/15 min (FR-005)
            ├─ refresh con rotación + reuso → CSRF double-submit (FR-004, D5)
            └─ matriz de roles en los controladores (FR-003)
          └──► TSK-AUTH-001…005  ciclo documental de este PR (spec, plan, filas §3, verificación, D5)
                 └──► TSK-AUTH-006/007/008  trabajo diferido (ver §5)
```

## 3. Decisiones técnicas

- **Aislamiento primario = RLS.** El backend consulta como el rol de aplicación `tc_app` y fija `SET LOCAL app.tenant_id` por transacción. El `tenant_id` se lee **siempre** de las claims, nunca del cuerpo de la petición.
- **Bypass del `platform_admin`.** No tiene tenant; opera por el pool *owner* (sin RLS). Es la única vía de cruce de tenants y toda mutación deja fila en `audit_log` (spec 006). Sin un segundo mecanismo de autorización (no hay tabla de permisos).
- **argon2id** con los parámetros por defecto de `@node-rs/argon2` v2 (`m=19456 KiB`, `t=2`, `p=1`) — alineados a OWASP 2024 — y **política de alta** mínimo 12 caracteres (se aplica al crear cuentas; el login sólo verifica).
- **JWT HS256 de 15 min** (`sub`/`tenant_id`/`rol`) fuera de cookie, en `Authorization: Bearer`.
- **Sesión (D5):** refresh de 32 B en cookie **httpOnly** con **rotación** y **detección de reuso** (revoca la familia), más **CSRF double-submit**. Una sola sesión activa por usuario.
- **Rate-limit (FR-005):** por cuenta (`app_user.failed_login_count`/`locked_until`, 5 → 15 min, `423`) **y** por IP (`Map` en memoria, 5 → 15 min, `429`). El contador por IP es de una sola instancia (ver TSK-AUTH-007).
- **Anti-enumeración:** email inexistente, password errónea, cuenta inactiva y tenant no activo devuelven el mismo `401`.

## 4. Riesgos y mitigaciones

| Riesgo | Mitigación |
| :--- | :--- |
| Fuego cruzado entre tenants por un `tenant_id` de confianza | RLS + `tenant_id` sólo de claims; `rls.spec.ts` en CI (FR-002/025) |
| Robo de refresh token | Rotación + detección de reuso → revoca familia + `audit_log('token_reuse')` (D5) |
| Fuerza bruta | Rate-limit cuenta+IP (FR-005) |
| Multi-instancia rompe el rate-limit por IP | TSK-AUTH-007 (store compartido, ADR-002) — **relevante al desplegar (A5)** |
| Divergencia entre D5 ("solo memoria") y el `sessionStorage` real | TSK-AUTH-006 (alinear) |
| `CONFLICT_VIEWER_ROLES` usa roles no canónicos → `tenant_admin` no ve conflictos (FR-003, FR-023) | TSK-AUTH-008 (issue #128, módulo 003/sync) |
| Enumeración de cuentas | Respuesta `401` uniforme |

## 5. Trabajo diferido (no bloquea la demo)

- **TSK-AUTH-006** — Alinear el almacenamiento del access token con D5: hoy la PWA lo guarda en `sessionStorage` (`tc_access_token`); D5 dice "solo en memoria". Decidir entre (a) mover a memoria de módulo con re-login en recarga, o (b) enmendar D5 para reconocer `sessionStorage` como "memoria de pestaña". (Toca `frontend/src/**`, zona de Daniel en este corte.)
- **TSK-AUTH-007** — Store compartido (p. ej. Redis) para el rate-limit por IP cuando el backend corra en más de una réplica (ADR-002, A5).
- **TSK-AUTH-008** — Alinear `CONFLICT_VIEWER_ROLES` (módulo 003/sync) con los roles canónicos: hoy `{supervisor, admin, admin_plataforma}` deja fuera a `tenant_admin`, que sí puede ver conflictos según la matriz §3 del spec 001 (issue #128). Zona de Daniel; incluye su prueba de rol (`200`/`403`).

## 6. Referencias

- `specs/001-auth-tenancy/spec.md` · `specs/000-master/spec.md` §3.1/§4
- `data-model.md` §2.1/§4 · `test-plan.md` §3 (FR-001…006), §4 (caos 6)
- `backend/src/auth/**`, `backend/src/db/db.service.ts`, `backend/db/seed.ts`
- `specs/006-admin-plataforma/spec.md` · `adr/002`
- **Módulos que consumen 001:** 002 (captura offline), 003 (sync), 004 (dominio), 005 (reportes), 006 (admin) — todos dependen del claim `tenant_id`, la matriz de roles y el aislamiento RLS.
