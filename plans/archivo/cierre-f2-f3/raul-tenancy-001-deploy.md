# BRIEF — Track A · Raúl: Módulo 001 (auth/tenancy) → hardening → despliegue y demo

**Versión:** 0.1.0 · **Fecha:** 2026-10-14 · **Para:** Raúl González (o su agente)
**Tarjetas:** #4 (001) · #84 (hardening) · #15 (F3) · **Spec:** `specs/001-auth-tenancy/spec.md` · **Plan padre:** `plan.md`
**Antes de escribir nada:** leer `AGENTS.md` completo y `CONTRIBUTING.md` §4 y §9.

## Contexto

Repo **Terreno Conectado** (SaaS offline-first, monorepo npm workspaces). NestJS + React/Vite/PWA + PostgreSQL 16 con RLS. Tú en Windows nativo (WSL2 para Docker), Daniel en macOS. La repo ya está normalizada (LF, `.env` autoload, `cross-env`); si algo rompería en Windows, lo arreglas en el mismo PR.

**Daniel trabaja al mismo tiempo en el Track B** (huecos FR-017/034/041/042 + informe). Reglas de no-colisión al final. **En este corte tú NO tocas UI** (`frontend/src/screens/**` es de Daniel).

**Sin rúbrica de firma:** el acuerdo es el review recíproco del PR.

---

## TAREA 1 — #4 Módulo 001: autenticación y tenancy (primer tercio)

El código **ya existe y está probado**: `backend/src/auth/**`, `backend/test/auth.spec.ts` (login, rate-limit 5/15 min, rotación+reuso, CSRF), `backend/test/rls.spec.ts` (aislamiento multi-tenant). **No hay que reimplementar nada de código** salvo lo que falte al contrastar contra el spec. El trabajo es **cerrar el ciclo documental** (Art. II): el spec 001 es el **único** que sigue en ESQUELETO.

### Paso 0 — Decisión registrada

Comentario en el issue **#4** registrando: (a) que D5 ya está decidida (spec 001 §Decisión D5) y se ratifica en este PR; (b) que el ciclo 001 se paraleliza con el Track B de Daniel (huecos 002/004/005 + informe).

### Paso 1 — Spec 001 de ESQUELETO a COMPLETO (PR solo de docs)

`specs/001-auth-tenancy/spec.md` tiene 5 casillas abiertas (§"Secciones a completar"). Ciérralas:

- **Matriz rol × recurso × acción** (`field_worker` · `supervisor` · `tenant_admin` · `platform_admin` × endpoints). Verifica contra el guard real de `backend/src/auth/auth.guard.ts` y los roles que exigen cada controller (`dashboard`, `templates`, `admin`): `field_worker` no ve dashboard; supervisores de otro tenant no ven nada (RLS); `platform_admin` solo consola admin. **La matriz debe reflejar el código, no inventar permisos.**
- **Esquema de hash y política de contraseñas:** argon2id (verifica parámetros reales en `auth.service.ts`), requisitos de la contraseña demo, expiración del access (15 min) y del refresh.
- **Contratos de endpoints:** `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `GET /api/v1/me` — request/response, códigos de error (401 sin enumerar causa en login; 401/`token_reuse` en refresh; 403 por rol) y el rate-limit de FR-005 (5 fallos → 15 min, por cuenta e IP).
- **Criterios de aceptación y casos de prueba → `test-plan.md` §3:** agrega las filas **FR-001, FR-003, FR-004, FR-006** (FR-002 y FR-005 **ya están** verdes en la matriz). FR-004 enlázalo a caos 6.
- Deja **D5** como decidida (ya lo está) y anota que **queda ratificada** por este PR.

Mergear el spec **antes** de cualquier otro paso (Art. II).

### Paso 2 — Plan técnico y tareas

- `plans/001-auth-tenancy/plan.md` — enlaza spec 001 ↔ tasks 001 ↔ módulos 002–006. Sigue el formato de `plans/004-*/plan.md` y `plans/005-*/plan.md`.
- `tasks/001-auth-tenancy/tasks.md` — **TSK-AUTH-001…N** con el patrón del repo (`TSK-WS-003` cubrió login/refresh/me en la iteración 0). Como mínimo: TSK-AUTH-001 (spec), -002 (plan), -003 (filas matriz §3 FR-001/003/004/006), -004 (verificación de que `rls.spec.ts` y `auth.spec.ts` cubren FR-001…006 sin huecos).

### Paso 3 — Verificación (no reescritura)

Corre y confirma sin cambiar el comportamiento probado:

```bash
npm run test --workspace @terreno/backend   # auth.spec.ts + rls.spec.ts verdes
```

Si al detallar el spec encuentras un **desajuste real** entre spec y código (p. ej. un rol sin cubrir), ábrelo como task y arréglalo con su prueba. **No toques `backend/src/sync/**`, `backend/src/dashboard/**` ni `frontend/src/**`** (zona de Daniel).

### Paso 4 — Cerrar #4

Actualiza el body de #4 (D5 ya no está pendiente; marca los criterios cumplidos: spec detallado, cross-tenant en CI verde, cero secretos) y ciérralo cuando su PR de cierre mergee.

---

## TAREA 2 — #84 Hardening de dependencias (ventanilla serial, segundo tercio)

**Aviso obligatorio:** esta tarea **mueve el lockfile** y NestJS v12 toca el backend entero. Coordina el día/hora con Daniel (él correrá `npm ci`) y hazla **de una sola pasada**, no en paralelo con trabajo de código.

- `vitest` → **≥ 5.0.3** (crítica, dev/test).
- `@testcontainers/postgresql` → **≥ 12.2.0** (alta, dev/test).
- **NestJS `@nestjs/core` + `@nestjs/platform-express` → v12** (alta, **runtime de producción**). Revisa breaking changes antes de subir.
- `node-pg-migrate` → **≥ 9.0.0** (alta, runtime de migraciones).
- `xlsx` (SheetJS): sin fix disponible, solo en `shared/scripts/spike-xlsx/bench.mjs` → **retíralo** o reemplaza el benchmark por un fixture estático.

Criterios (del propio #84): `npm audit --audit-level=moderate` sin críticas ni altas en runtime; **CI 3/3 verde**; documenta los breaking changes en `tasks/` o `adr/` si aplica.

---

## TAREA 3 — Fase 3: despliegue y demo (tercer tercio, tras el HITO 2)

Depende de la **congelación de código** (HITO 2). `infra/` hoy solo tiene el compose **local**; el despliegue es greenfield.

- **Desplegar** (ADR-002, ≤ US$7/mes): 1 VPS (Hetzner CAX11 o Fly.io shared) + Docker Compose + **Caddy same-origin** (`/` frontend y `/api/*` backend, HTTPS Let's Encrypt, 80→443). Secrets por GitHub Secrets (nunca en el repo, NFR-06). `pg_dump` nocturno por cron. Deja el procedimiento en `infra/**` + una sección nueva del `README.md`.
- **Ensayar el guion §9** completo con **modo avión real** del dispositivo (pasos 1–6).
- **Ejecutar la demo en vivo** ante el docente sin fallos.

Checklist de ADR-002 a cerrar antes de provisionar: proveedor + cuenta, presupuesto confirmado, `pg_dump` + copia fuera del VPS.

---

## Reglas de no-colisión (con Daniel)

**Tu zona (solo tú):** `specs/001/**` · `plans/001-auth-tenancy/**` · `tasks/001-auth-tenancy/**` · `infra/**` (deploy) · `package.json` raíz + `package-lock.json` (#84) · `frontend/scripts/**`.
**Zona de Daniel (no toques):** `frontend/src/**` · `frontend/test/**` · `backend/src/dashboard/**` · `backend/src/sync/**` · `specs/002`, `specs/004`, `specs/005` · `plans/004-*`, `plans/005-*` · `tasks/002-*`, `tasks/004-*`, `tasks/005-*` · `docs-evidencia/**` · `data-model.md` · migraciones `1730000011*`.
**Compartido (regla):** `test-plan.md` y `README.md` → cada quien edita **solo sus filas/secciones** (tú: filas 001 y sección de despliegue). El mapeo §12 del spec maestro lo cierra Daniel.

Si necesitas algo de la zona de Daniel, no lo tomes: abre el PR igual y dilo en el issue, o coordina antes.

## Flujo

Rama propia (`<tipo>/<tsk-id>-<desc>`), un PR por paso lógico, commits firmados, `refs TSK-…`, `Closes #4` en el PR que cierre el módulo. `main` exige 1 aprobación (la de Daniel). Si no hay review en 24 h, deja la decisión escrita y avanza.

**Antes de abrir el PR:**

```bash
npm run lint
npm run typecheck
npm test
```

Los tests de integración usan Testcontainers → **Docker Desktop debe estar corriendo** (WSL2). Sin Docker fallan aunque el código esté bien.

## Qué reportar al terminar cada tercio

1. Qué quedó hecho y en qué commit.
2. Resultado de `npm test` (conteos: backend/frontend/shared).
3. Si el nightly E2E sigue verde tras tus cambios (o por qué no).
4. Qué archivos tocaste (para confirmar que no pisaste la zona de Daniel).
5. Qué quedó a medias, si algo.
