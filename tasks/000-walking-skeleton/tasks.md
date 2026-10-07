# TASKS — Iteración 0: Walking skeleton (MVP vertical)

**Versión:** 0.1.8 · **Fecha:** 2026-10-07 · **Autor:** Raúl González
**Padre:** `plans/000-walking-skeleton/plan.md` · **Spec de referencia:** `specs/000-master/spec.md` §9 (MVP)

> **Regla (Artículo II):** cada task referencia al menos un ID de requisito; cada commit referencia al menos un task. Estado de iteración: los criterios de aceptación de la demo (§13 spec maestro) dependen de que esta iteración complete el guion §9.

## Tareas

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-WS-001 | Bootstrap monorepo **npm workspaces**: `shared/` · `frontend/` · `backend/` · `infra/` + toolchain TS + lint | NFR-11, ADR-001 | — | `npm install` resuelve los workspaces; `npm run lint` + `typecheck` + `build` pasan en CI | ✅ Hecho |
| TSK-WS-002 | PostgreSQL 16 + migraciones + seed tenants A/B con RLS habilitado | FR-002, FR-006, NFR-05 | 001 | Migraciones aplican en Testcontainers; consulta autenticada como tenant A no devuelve filas del B (rechazo a nivel DB) | ✅ Hecho |
| TSK-WS-003 | Auth: `POST /auth/login`, `POST /auth/refresh`, `GET /me` — JWT con claims, roles, rate-limit | FR-001, FR-003, FR-004, FR-005 | 002 | Login emite JWT 15 min + refresh con `user_id/tenant_id/rol`; 5 fallos → bloqueo 15 min; refresh no pierde cola local | ✅ Hecho |
| TSK-WS-004 | PWA mínima instalable: manifest + service worker (Workbox) + shell precache | FR-010, NFR-01 | 001 | Instalable y funcional sin red tras primera carga | ✅ Hecho |
| TSK-WS-005 | Captura offline en Dexie: inspección mínima + hallazgo + bitácora, UUIDv7 en cliente | FR-011, FR-013, FR-014, FR-015 | 004 | Crear un registro en modo avión; sobrevive cerrar/reabrir; IDs UUIDv7 cliente; estados del outbox visibles | ✅ Hecho |
| TSK-WS-006 | Compresión de foto en cliente (canvas ≤ 1280 px, q 0.7) y blob en IndexedDB | FR-012 | 005 | Foto 8 MP → ≤ 1280 px lado mayor, q 0.7, antes de encolar | ✅ Hecho |
| TSK-WS-007 | Ingesta idempotente `POST /api/v1/sync/batch`: upsert por UUID cliente + orden de dependencias + SYNC_LOG | FR-020, FR-021, FR-024 | 003, 005 | Replay del mismo batch → cero duplicados; batch respeta orden site→inspection→responses→findings→attachments; `synced_at − captured_at` registrado | ✅ Hecho |
| TSK-WS-008 | Worker de cola cliente: disparo en `online`, backoff exponencial, marcado `synced` | FR-016, FR-022, FR-026 | 007 | Al reconectar inicia sola sin clic; backoff 1 s→5 min; contador de pendientes actualizado | ✅ Hecho |
| TSK-WS-009 | Resolución LWW + `CONFLICT_RECORD` (tie-breaker determinista) | FR-023 | 007, 008 | Dos dispositivos editan el mismo registro offline → gana mayor `client_version`; ambas versiones conservadas y visibles al supervisor | ⏳ Pendiente |
| TSK-WS-010 | Rechazo de lote cross-tenant + incidente en AUDIT_LOG | FR-025, FR-051 | 007 | JWT tenant A + payload tenant B → 4xx, lote completo rechazado, incidente auditado (defensa en profundidad sobre RLS) | ✅ Hecho (en 007) |
| TSK-WS-011 | Dashboard mínimo: hallazgo alto/crítico visible tras sincronizar | FR-035, FR-040, FR-043 | 008, 009 | Tras sync, hallazgo `alta/crítica` destacado en el dashboard del supervisor en ≤ 60 s | ⏳ Pendiente |
| TSK-WS-012 | `/health` (uptime, versión, estado DB) + logs estructurados | FR-052, NFR-09 | 002 | `/health` responde 200 con estado DB; logs JSON con `tenant_id` y `request_id` | ⏳ Pendiente |

## Criterios de salida de la iteración

1. El guion del spec maestro §9 (pasos 1–6) corre completo sin intervención manual sobre la red.
2. Escenarios de caos 1–3 (corte a mitad de sync, doble envío, edición concurrente) pasan con **cero pérdida ∧ cero duplicación** (test-plan.md §4).
3. Cada commit de la iteración referencia su TSK ID (Artículo II).

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.8 | 2026-10-07 | TSK-WS-008 completo: worker de cola en `frontend/src/lib/sync.ts` — arma `SyncBatchRequest` desde el outbox (concurrencia 1, lotes ≤500, orden FR-020), mapa `aSyncRecord`+base64 de foto, backoff 1 s→5 min auto-reprogramado (FR-022), marcado `synced/failed` con `lastError` y contadores (FR-026); disparo por evento `online` real + flush al entrar/encolar (FR-016/FR-004); `VITE_API_URL` configurable | Daniel Ávila |
| 0.1.7 | 2026-10-07 | TSK-WS-007 completo: migración `sync` (6 tablas + RLS), `POST /api/v1/sync/batch` con upsert `ON CONFLICT` (idempotencia FR-021), orden de dependencias FR-020, `sync_log` (FR-024), validación de referencias dentro del tenant, bytes de adjunto a `SYNC_VOLUME`; **incluye TSK-WS-010** (rechazo cross-tenant 409 previo a escritura + incidente `sync_tenant_mismatch` en `audit_log`); contrato cliente en `shared/src/sync.ts` | Daniel Ávila |
| 0.1.6 | 2026-10-07 | TSK-WS-006 completo: compresión de foto en cliente (canvas ≤1280 px, q0.7, JPEG, `imageSmoothingQuality: high`) ANTES de encolar; `ATTACHMENT` guarda ancho/alto; hallazgo no depende de la foto (fallback sin imagen) | Daniel Ávila |
| 0.1.5 | 2026-10-07 | TSK-WS-005 completo: esquema Dexie/IndexedDB (`outbox/inspections/responses/findings/logEntries/attachments/meta`), `uuidv7` RFC 9562 isomórfico en `shared`, autoguardado del borrador por ítem (restaura al reabrir), outbox real con orden FR-020, foto `File` en hallazgo persistida como blob | Daniel Ávila |
| 0.1.4 | 2026-10-07 | TSK-WS-004 completo: PWA instalable — manifest (iconos 192/512 + maskable), SW Workbox con precache del shell y `navigateFallback`, cache runtime de fuentes; verificación de artefactos en CI | Daniel Ávila |
| 0.1.3 | 2026-10-07 | TSK-WS-003 completo: login/refresh/me (JWT HS256 15 min + refresh 30 d), argon2id, cookies D5 (rotation + reuse detection), rate-limit 5 fallos → 423, auditoría `auth_log`; Node 22 (engines/.nvmrc/CI) | Daniel Ávila |
| 0.1.2 | 2026-10-07 | TSK-WS-002 completo: PostgreSQL 16 + migraciones (node-pg-migrate) + RLS con rol `tc_app` + seed A/B; test de aislamiento en Testcontainers | Daniel Ávila |
| 0.1.1 | 2026-10-07 | TSK-WS-001: pnpm → npm workspaces (enmienda ADR-001 001.1); incluye `shared/` como 4º workspace | Daniel Ávila |
| 0.1.0 | 2026-09-24 | Iteración 0 inicial: tareas del walking skeleton derivadas del plan homónimo y del spec maestro §9 | Raúl González (con IA) |