# BRIEF — Track Raúl: Módulo 006 · administración de plataforma (+ NFR-07)

**Versión:** 0.1.0 · **Fecha:** 2026-10-13 · **Para:** Raúl González (o su agente)
**Tarjeta:** #9 · **Spec:** `specs/006-admin-plataforma/spec.md` · **Plan padre:** `plan.md`
**Antes de escribir nada:** leer `AGENTS.md` completo y `CONTRIBUTING.md` §4 y §9.

## Contexto

Repo **Terreno Conectado** (SaaS offline-first, monorepo npm workspaces: `shared/`, `frontend/`, `backend/`, `infra/`). NestJS + React/Vite/PWA + PostgreSQL 16 con RLS. El equipo es Daniel en macOS y tú en Windows nativo. La repo ya está normalizada (LF, `.env` autoload, `cross-env`); si algo que escribas rompería en Windows, lo arreglas en el mismo PR.

**Hay otra persona trabajando al mismo tiempo en el módulo de sincronización (#6).** Reglas de no-colisión al final.

**Sin rúbrica de firma:** el acuerdo entre los dos es el review recíproco del PR.

---

## TAREA 1 — #9 Módulo 006: administración de plataforma

No existe `backend/src/admin/`. Es greenfield total y tú eres el autor del spec 006. No depende del trabajo de Daniel.

### Paso 0 — Decisión registrada

Comentario en el issue #9 registrando que se paraleliza con #6 y este reparto.

### Paso 1 — Spec 006 (PR solo de docs)

`specs/006-admin-plataforma/spec.md` está en ESQUELETO (34 líneas). Cerrar:

- **Modelo del bypass de RLS de `platform_admin`.** La tabla `app_user` ya permite `tenant_id NULL` y la política `audit_log` ya acepta `NULL`.
- **Catálogo de acciones de `audit_log`**, con payload: creación de tenant, asignación de `tenant_admin`, cambios de rol, suspensión/reactivación, conflictos de sync, intentos cross-tenant.
- **Endpoints y códigos de error**, criterios de aceptación de FR-050/051/052.

Mergear el spec **antes** de codificar (Art. II).

### Paso 2 — Migración `1730000010000_audit_admin.js`

- Índice `audit_log (tenant_id, occurred_at DESC)` para lecturas filtradas (hoy solo hay uno por `occurred_at`).
- **No** hace falta columna nueva: `tenant.status` ya es `CHECK IN ('active','suspended')`.
- `audit_log` es **append-only**. No expongas endpoints de update/delete y déjalo escrito en el spec.

### Paso 3 — Backend `backend/src/admin/{module,controller,service,contract}.ts`

| Método | Ruta |
| :--- | :--- |
| POST | `/api/v1/admin/tenants` |
| PATCH | `/api/v1/admin/tenants/:id` (suspender/reactivar) |
| POST | `/api/v1/admin/tenants/:id/admins` (asignar `tenant_admin`) |
| GET | `/api/v1/admin/audit-log?tenant=&action=&desde=&hasta=` |

- **Toda** operación escribe en `audit_log`, incluido el bypass de RLS (Art. IV).
- Reutiliza el guard y el patrón de roles de `backend/src/auth/`. No inventes un segundo mecanismo de autorización.
- Registra `AdminModule` en `backend/src/app.module.ts` — **ese archivo es tuyo**.

### Paso 4 — Tests `backend/test/admin.spec.ts` (Testcontainers)

- Tenant suspendido pierde acceso a sus datos.
- El bypass de `platform_admin` queda registrado en `audit_log`.
- Audit log append-only: no hay ruta para modificarlo.
- `platform_admin` no puede actuar sobre un tenant como si fuera suyo sin dejar rastro.

### Paso 5 — UI (corte antes si aprieta el tiempo)

Pantalla de administración en `frontend/src/screens/`, restringida por rol. `App.tsx` y `Shell.tsx` son tuyos. **`frontend/src/lib/db.ts` NO** (es de Daniel).

### Paso 6 — `test-plan.md` §3

Cerrar las filas FR-050/051/052. **Solo las tuyas.**

---

## TAREA 2 — NFR-07: Lighthouse CI (~1 día, al final)

Es el único 🔴 de la matriz §3 y hoy no tiene dueño. Alcance mínimo: medir el build del frontend con Lighthouse en perfil móvil y exigir Performance ≥ 80. Precedente en el repo: el check de PWA es un script propio (`frontend/scripts/check-pwa.mjs`) invocado desde `ci.yml`, no una action externa — prefiere ese patrón.

**Aviso:** esta tarea **sí** toca `package.json` (agrega una devDependency). Avisa al canal del equipo el día que lo mergees para que Daniel corra `npm ci`.

---

## Reglas de no-colisión (con Daniel)

**Tu zona (solo tú):** `backend/src/admin/**` · `backend/src/app.module.ts` · `frontend/src/screens/**` · `App.tsx` · `Shell.tsx` · migraciones `1730000010000_*` · `specs/001` y `specs/006`.
**Zona de Daniel (no toques):** `backend/src/sync/**` · `backend/src/templates/**` · `shared/src/**` · `frontend/src/lib/**` · `specs/002` y `specs/003` · migraciones `1730000011*`.
**Compartido (regla):** `test-plan.md` y `README.md` → cada quien edita **solo sus filas**. El mapeo §12 del spec maestro se actualiza al final.

Si necesitas algo de su zona, no lo tomes: abre el PR igual y dilo en el issue, o coordina antes.

## Flujo

Rama propia (`<tipo>/<tsk-id>-<desc>`), un PR por paso lógico, commits firmados, `refs TSK-…`, `Closes #9` en el PR que cierre el módulo. `main` exige 1 aprobación (la de Daniel). Si no hay review en 24 h, deja la decisión escrita y avanza.

**Antes de abrir el PR:**

```bash
npm run lint
npm run typecheck
npm test
```

Los tests de integración usan Testcontainers → **Docker Desktop debe estar corriendo** (backend WSL2). Sin Docker fallan aunque el código esté bien.

## Qué reportar al terminar

1. Qué quedó implementado y en qué commit.
2. Resultado de `npm test` (conteos).
3. Si el nightly E2E sigue verde tras tus cambios (o por qué no).
4. Qué archivos tocaste (para confirmar que no pisaste la zona de Daniel).
5. Qué quedó a medias, si algo.
