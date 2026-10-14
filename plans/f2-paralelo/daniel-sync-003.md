# PLAN — Track Daniel: Módulo 003 · descarga incremental

**Versión:** 0.1.0 · **Fecha:** 2026-10-13 · **Autor:** Daniel Ávila
**Tarjeta:** #6 · **Spec:** `specs/003-motor-sincronizacion/spec.md` · **Plan padre:** `plan.md`
**Riesgo principal:** Art. III (idempotencia). Puerta de salida: nightly E2E 17/17.

## Objetivo

Cerrar el spec 003 y eliminar el hueco real del módulo: **no existe descarga incremental** (`rg "since|cursor|delta"` sobre `backend/src/sync/` → cero). Hoy el cliente sube lotes pero nunca descarga cambios del servidor. El delta de plantillas por `published_seq` (módulo 007) ya existe y **se reutiliza**; no se inventa un segundo mecanismo.

## Zona (solo Daniel)

`backend/src/sync/**` · `backend/src/templates/**` · `shared/src/**` · `frontend/src/lib/**` · `specs/002` · `specs/003` · `tasks/003-motor-sincronizacion/**` · migraciones `1730000011000_*` · filas propias de `test-plan.md` / `README.md`.

## Tareas (TSK-SYNC-NNN)

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación |
| :--- | :--- | :--- | :--- | :--- |
| TSK-SYNC-001 | Spec 003 completo + contrato del cursor en `shared/` | FR-027, FR-028 | — | Spec de ESQUELETO a completo: semántica de `since`, alcance de entidades, retención; tipo del cursor en `shared/src/sync.ts` |
| TSK-SYNC-002 | Migración `sync_cursor` (por tenant/usuario/dispositivo) | FR-027 | 001 | Migración aplica en Testcontainers; RLS habilitado; aislamiento entre tenants verificado |
| TSK-SYNC-003 | `GET /api/v1/sync/changes?since=` (descarga incremental) | FR-027, FR-028 | 001, 002 | Devuelve solo lo posterior al cursor; delta vacío si no hay cambios; nunca re-encuadra una inspección en curso (versión congelada) |
| TSK-SYNC-004 | Pull en cliente al reconectar + persistencia del cursor | FR-018, FR-027 | 003 | `frontend/src/lib/sync.ts` aplica el pull antes de drenar la cola; cursor persistido en `db.ts`; idempotente |
| TSK-SYNC-005 | Pruebas de delta + caos | FR-021, FR-027 | 003, 004 | `backend/test/sync-delta.spec.ts` (delta vacío/cambios/reset/aislamiento) + nightly 17/17 |
| TSK-SYNC-006 | Documentar spec 002 (captura offline) — solo docs | FR-011…015 | — | Spec 002 de ESQUELETO a completo, sin cambios de código |

## Orden de ataque

1. **TSK-SYNC-001** — PR solo de docs. Cerrar el spec 003 (diseño del cursor, entidades, retención, códigos de error, FR-022…028) y agregar el tipo del cursor en `shared/src/sync.ts`. Mergear **antes** de codificar (Art. II).
2. **TSK-SYNC-002** — migración `1730000011000_sync_cursor.js`. `CREATE TABLE` + RLS, patrón del resto del módulo.
3. **TSK-SYNC-003** — backend. `GET /api/v1/sync/changes?since=`. **No tocar** `POST /sync/batch` (idempotencia validada por caos 1/2/5) ni el orden de chequeo de aislamiento de `sync.service.ts` (fix de H5). Respetar RLS con el `app.tenant_id` de sesión.
4. **TSK-SYNC-004** — frontend. Pull al recuperar conectividad, **antes** de drenar la subida. Cursor en `db.ts` (archivo propio). Revisar bump de versión de Dexie y que `seed.ts` siga funcionando.
5. **TSK-SYNC-005** — `backend/test/sync-delta.spec.ts` + **nightly 17/17**. Anunciar en #10 todo merge que toque el contrato de sync, para que Raúl re-corra `npm run e2e`.
6. **TSK-SYNC-006** — documentar spec 002 (docs, sin código).

## Definition of Done

- [ ] Spec 003 completo y acordado con Raúl (review del PR)
- [ ] `GET /sync/changes` funcionando, cursor persistido y aislado por RLS
- [ ] Tests nuevos verdes + nightly 17/17
- [ ] Spec 002 documentado
- [ ] Filas FR-022…028 de `test-plan.md` actualizadas (solo las propias)
- [ ] PR aprobado por Raúl, squash, issue #6 a Done

## No tocar

`backend/src/app.module.ts` (solo Raúl) · `backend/src/admin/**` · `frontend/src/App.tsx` · `frontend/src/Shell.tsx` · filas ajenas de `test-plan.md` · `package.json` (lo toca Raúl por NFR-07) · `frontend/e2e/stack.mjs`.
