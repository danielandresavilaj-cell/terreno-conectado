# TASKS — Módulo 001: Autenticación y tenancy

**Versión:** 1.0.0 · **Fecha:** 2026-10-14 · **Autor:** Raúl González
**Padre:** `plans/001-auth-tenancy/plan.md` · **Spec de referencia:** `specs/001-auth-tenancy/spec.md` (v1.0.0)
**Brief:** `plans/cierre-f2-f3/raul-tenancy-001-deploy.md` (Track A, Tarea 1)

> **Regla (Artículo II):** cada task referencia al menos un ID de requisito; cada commit referencia al menos un task. El **código** de este módulo ya existía en `main` (TSK-WS-002/003 de la iteración 0); el trabajo de este ciclo es **cerrar el ciclo documental** y verificar que FR-001…006 no tengan huecos de prueba.

## 1. Tareas del ciclo documental (este PR)

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-AUTH-001 | Completar el spec 001 de ESQUELETO a COMPLETO (matriz de roles, hash/política, contratos, D5, RLS, tenant demo) | FR-001…006 | TSK-WS-003 | `specs/001-auth-tenancy/spec.md` v1.0.0 sin casillas abiertas; la matriz refleja el guard real | ✅ Hecho |
| TSK-AUTH-002 | Plan técnico `plans/001-auth-tenancy/plan.md` (enlaza spec ↔ tasks ↔ módulos 002–006) | FR-001…006 | TSK-AUTH-001 | El plan documenta las decisiones reales y el trabajo diferido | ✅ Hecho |
| TSK-AUTH-003 | Filas **FR-001/003/004/006** en `test-plan.md` §3 (FR-002/FR-005 ya verdes); FR-004 enlazada al caos 6 | FR-001, FR-003, FR-004, FR-006 | TSK-AUTH-001 | Cuatro filas 🟢 con su archivo de evidencia | ✅ Hecho |
| TSK-AUTH-004 | **Verificación**: `rls.spec.ts` + `auth.spec.ts` cubren FR-001…006 sin huecos | FR-001…006 | TSK-AUTH-001 | `npm test --workspace @terreno/backend` verde; cada FR con prueba | ✅ Hecho |
| TSK-AUTH-005 | **Ratificar D5** (y registrar la paralelización 001 ↔ Track B) | D5, FR-004 | — | D5 marcada decidida en el spec y en el comentario de #4 | ✅ Hecho |

## 2. Trazabilidad de la implementación (iteración 0, ya en `main`)

| Requisito | Implementación | Prueba |
| :--- | :--- | :--- |
| FR-001 login + JWT (claims) | `backend/src/auth/auth.service.ts` (`login`, `signAccessToken`) | `backend/test/auth.spec.ts` ("emite access token con claims…") |
| FR-002 RLS por tenant | `backend/src/db/db.service.ts` (`queryAsTenant`) | `backend/test/rls.spec.ts` |
| FR-003 roles + matriz | controladores `dashboard`/`templates`/`admin`/`sync` | `backend/test/admin.spec.ts` (403) + guardas |
| FR-004 refresh sin perder cola | `auth.service.ts` (`refresh`, rotación D5) | `backend/test/auth.spec.ts` + caos 6 (`e2e-caos-sync.spec.ts`) |
| FR-005 bloqueo 5/15 min | `auth.service.ts` (`registerAccountFail`/`registerIpFail`) | `backend/test/auth.spec.ts` |
| FR-006 tenant demo | `backend/db/seed.ts` | `backend/test/auth.spec.ts` (`login (FR-001, FR-006)`) |

## 3. Trabajo diferido (hallazgos de este ciclo)

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-AUTH-006 | **Alinear el almacenamiento del access token con D5**: hoy la PWA usa `sessionStorage` (`tc_access_token`); D5 dice "solo en memoria" | FR-001, D5 | TSK-WS-003 | El token vive sólo en memoria de módulo (re-login en recarga) **o** D5 se enmienda reconociendo `sessionStorage` como "memoria de pestaña" | ⬜ Pendiente (diferido) |
| TSK-AUTH-007 | **Store compartido para el rate-limit por IP** (multi-réplica) | FR-005 | TSK-WS-003 | Con ≥2 réplicas, 5 fallos desde una IP siguen bloqueando 15 min (p. ej. Redis) | ⬜ Pendiente (lo levanta el despliegue, Tarea 3 del brief) |

> Los FR-001…006 quedan ✅ con estas dos deudas menores **declaradas**, no ocultas.
