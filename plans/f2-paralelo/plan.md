# PLAN — F2 en paralelo: módulos 003 (sync) y 006 (admin)

**Versión:** 0.1.0 · **Fecha:** 2026-10-13 · **Autores:** Daniel Ávila y Raúl González
**Derivado de:** `specs/000-master/spec.md` §5.3 (FR-020…029) y §5.6 (FR-050…052) · **Issues:** #6, #9 · **Specs:** 003, 006 (+ 001, 002 por documentar)
**Planos por persona:** `daniel-sync-003.md` · `raul-admin-006.md`

> **Qué es este plan:** el reparto y las reglas para trabajar los dos módulos **en paralelo** sin pisarse. Las tarjetas sitúan el 003 en S5–S8 y el 006 en S9–S12; se paralelizan **a propósito** para cerrar antes los dos huecos de código que quedan en F2. Esa decisión queda registrada en los issues #6 y #9.

## 1. Por qué estos dos

Los seis specs de módulo (001–006) están en **ESQUELETO**. El trabajo real de F2 no es programar desde cero, sino cerrar lo que ya existe. Auditados los tres huecos de código:

| Hueco | Evidencia |
| :--- | :--- |
| No hay descarga incremental de sync | `rg "since\|cursor\|delta"` sobre `backend/src/sync/` → cero |
| No existe backend de administración | no hay `backend/src/admin/`; `tenant.status` y `audit_log` ya están en migraciones |
| No hay exportación CSV | `rg "csv"` sobre `backend/src/` → cero (el "export" actual es XLSX) |

Este plan cubre los dos primeros. El CSV (Módulo 005) queda para el hito siguiente.

## 2. Reparto

| Persona | Tarjeta | Track | Riesgo |
| :--- | :--- | :--- | :--- |
| **Raúl** | #9 — Módulo 006: administración de plataforma | `backend/src/admin/**` (greenfield) + NFR-07 | Bajo |
| **Daniel** | #6 — Módulo 003: motor de sincronización | Descarga incremental sobre código existente | Medio (Art. III) |

**Por qué este reparto.** El 006 exige decidir el bypass de RLS del `platform_admin` y el catálogo de auditoría: decisiones de gobierno de datos que le tocan al autor del spec. El 003 es diseño de protocolo de sincronización sobre código validado por 17 specs de caos; si lo tomara quien no lo escribió, validaría sin contraparte el invariante central del Art. III.

## 3. Hitos

```
HITO 0  Decisión registrada (comentario en #6 y #9)                  [ambos]
HITO 1  Specs completados (docs, cero conflicto)                    [paralelo]
HITO 2  Implementación (backend + frontend + tests)                 [paralelo]
HITO 3  Cierre: matriz test-plan §3 sin 🔴 y nightly 17/17          [ambos]
```

## 4. Reglas de no-colisión

| Zona | Dueño | Regla |
| :--- | :--- | :--- |
| `backend/src/admin/**`, `backend/src/app.module.ts`, `frontend/src/screens/**`, `App.tsx`, `Shell.tsx`, `specs/001`, `specs/006`, migraciones `1730000010000_*` | **Raúl** | Solo él las toca |
| `backend/src/sync/**`, `backend/src/templates/**`, `shared/src/**`, `frontend/src/lib/**`, `specs/002`, `specs/003`, migraciones `1730000011000_*` | **Daniel** | Solo él las toca |
| `test-plan.md`, `README.md` | Compartido | Cada uno edita **solo sus filas**; el mapeo §12 del spec maestro se actualiza al final |
| `frontend/e2e/stack.mjs` | Nadie | No tocar |
| `package.json` / lockfile | Solo Raúl (NFR-07) | Avisar el día que lo mergee para correr `npm ci` |

## 5. Flujo y acuerdo

- **Sin rúbrica de firma.** El acuerdo entre los dos es el **review recíproco del PR** (1 aprobación, regla del repo). Cada uno confía en el otro.
- **Art. II:** el PR del spec se mergea **antes** que el de código; el de código lo referencia.
- **Review con time-box de 24 h.** Si no hay aprobación, el que espera deja la decisión escrita en el PR y avanza; no se bloquea en silencio.
- **Rama:** `<tipo>/<tsk-id>-<desc>`. **Commits firmados**, un cambio lógico por commit, `refs TSK-…`.
- **Squash + rama borrada.** El issue pasa a Done al cerrar su PR.
- **Portabilidad (macOS + Windows):** LF siempre; `sep` de `node:path`; variables en `.env` o `npx cross-env`, nunca `export`. Si algo rompe en Windows, se arregla en el mismo PR (`CONTRIBUTING.md` §9).

## 6. Qué NO entra ahora

- **#84 (dependencias):** actualizar `vitest`/`testcontainers`/`node-pg-migrate`/NestJS v12 mueve el lockfile y toca backend entero; en paralelo rompería la instalación de los dos. Ventanilla dedicada al final.
- **#15 (Fase 3):** depende de que F2 cierre.
- **#7 (inspecciones) y #8 (reportes):** hito siguiente (el hueco de #8 es el CSV).

## 7. Éxito del plan

1. Specs 001, 002, 003 y 006 de ESQUELETO a completos, acordados entre los dos.
2. `backend/src/admin/` con FR-050/051 implementados y auditados.
3. Descarga incremental de sync funcionando (FR-022/023) con el nightly E2E en 17/17.
4. Matriz §3 de `test-plan.md` sin 🔴 (NFR-07 cerrado).

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-10-13 | Plan inicial de paralelización F2 (módulos 003 y 006) | Daniel Ávila |
