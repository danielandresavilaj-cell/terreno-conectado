# PLAN — Cierre de F2 + Fase 3 en paralelo: tenancy+despliegue ∥ huecos 002/004/005 + informe

**Versión:** 0.2.0 · **Fecha:** 2026-10-14 · **Autores:** Daniel Ávila y Raúl González
**Derivado de:** `specs/000-master/spec.md` §5 y §9 · `test-plan.md` §3 y §8
**Issues:** #2 (F2) · #4 (001) · #5 (002) · #7 (004) · #8 (005) · #3 (iteración 0) · #29 (007) · #84 (hardening) · #15 (F3)
**Planos por persona:** `raul-tenancy-001-deploy.md` · `daniel-huecos-002-005-informe.md`

> **Qué es este plan:** el reparto y las reglas para las **dos últimas tandas** — cerrar F2 con honestidad (matriz §3 ≥ 90%) y ejecutar la Fase 3 — trabajadas **en paralelo** por autoría de spec, sin pisarse. Reemplaza a `plans/f2-paralelo/` como plan vigente.

## 1. Por qué este corte

La aplicación **ya está escrita**: los módulos de código (001–007) están implementados. Tras los merges #120, #122, #126 y #127, queda completar el cierre de cuatro requisitos del Track B, revisar sus PRs y ejecutar la parte física de Fase 3:

| Frente | Estado real | Qué falta |
| :--- | :--- | :--- |
| **Módulo 001 (auth)** | Spec/plan/tareas completados y mergeados en #120/#122; código probado | TSK-AUTH-006/007 diferidos explícitamente; TSK-AUTH-008 fix en PR #129 |
| **FR-017** (002) | Implementado y probado en #121; rama actualizada con CI 3/3 | Review/merge de Raúl; añade fila verde a la matriz |
| **FR-041 autor + FR-042 CSV** (005) | Implementados y probados en #123; CI 3/3 | Review/merge de Raúl; matriz pasa a ≥90% |
| **FR-034 geo** (004) | Implementado y probado en #124; CI 3/3 | Review/merge de Raúl; nueva fila verde |
| **TSK-AUTH-008** (003) | Roles canónicos y test RLS en PR #129; suite local completa verde | Review/merge de Raúl |
| **Matriz §3** | En `main`: 37 filas · 🟢33 (89,2%) · 🟡2 · ⚪2 | Tras #121/#123/#124: 39 filas · 🟢37 (94,9%) |
| **#84 hardening** | #126 mergeado: 0 críticas/altas; 2 moderadas `uuid`/`exceljs` aceptadas en ADR-004 | Completado |
| **Fase 3** | Artefactos Docker/Caddy/runbook mergeados en #127; VPS no provisionado | Configurar VPS/dominio/secrets, deploy y demo (§9) |

**El bloqueo:** el criterio de salida de F2 (#2) exige **matriz §3 ≥ 90% verde**. Los PRs de cierre están implementados y con checks verdes, pero necesitan el review recíproco antes de merge. El despliegue se ejecuta después de la congelación HITO 2 y de configurar credenciales/dominio del VPS.

## 2. Reparto

| Persona | Track | Alcance | Riesgo |
| :--- | :--- | :--- | :--- |
| **Raúl** | A | Módulo **001** (autor del spec) → **#84** → **despliegue + demo** | Medio (infra greenfield) |
| **Daniel** | B | Huecos **002/004/005** → cierre de epics → **informe + presentación** | Medio (Art. III en FR-034) |

**Por qué así.** El spec 001 es de Raúl y es la capa de gobierno de datos (Art. IV), igual que 006; el despliegue y #84 son infraestructura, su terreno. Los huecos de código son de los módulos que Daniel escribió (002/004/005), y el informe final es evidencia de su plan de pruebas. **Cero solape de archivos** (ver §4).

## 3. Hitos

```
HITO 0  Acuerdo registrado + D5 ratificada (comentario en #4)                 [completado]
HITO 1  Spec/plan 001 + FR-017/034/041/042 + TSK-AUTH-008                     [PRs listos; review pendiente]
HITO 2  #84 mergeado; congelar tras integrar los PRs de huecos; matriz ≥90%    [parcial]
HITO 3  Artefactos deploy #127 + informe/presentación #125                     [merge/docs pendientes; VPS por provisionar]
HITO 4  Cerrar F2 (#2) y F3 (#15), demo final                                 [pendiente de demo]
```

> El **HITO 2 fue serial a propósito**: #84 movió el lockfile y NestJS v12 toca el backend entero. #84 ya está mergeado; falta integrar los PRs de los huecos para congelar código y confirmar la matriz. El **HITO 3 sigue esperando la congelación de código**: el VPS aún no está provisionado.

## 4. Reglas de no-colisión

| Zona | Dueño | Regla |
| :--- | :--- | :--- |
| `specs/001/**` · `plans/001-auth-tenancy/**` · `tasks/001-auth-tenancy/**` · `infra/**` (deploy) · `package.json` raíz + `package-lock.json` (#84) · `frontend/scripts/**` | **Raúl** | Solo él las toca |
| `frontend/src/lib/**` · `frontend/src/screens/**` · `frontend/test/**` · `backend/src/dashboard/**` · `backend/src/sync/**` · `backend/test/dashboard.spec.ts` · `specs/002` · `specs/004` · `specs/005` · `plans/004-*` · `plans/005-*` · `tasks/002-*` · `tasks/004-*` · `tasks/005-*` · `docs-evidencia/**` · `data-model.md` (FR-034) · migraciones `1730000011*` | **Daniel** | Solo él las toca |
| `test-plan.md` · `README.md` | Compartido | Cada uno edita **solo sus filas** (Raúl: 001; Daniel: 002/004/005). El mapeo §12 del spec maestro lo cierra Daniel |
| `specs/000-master/spec.md` §12 | Daniel | Al final |
| `frontend/e2e/stack.mjs` | Nadie | No tocar |

> **Cambio de zona respecto a `f2-paralelo/`:** `frontend/src/screens/**` pasa a **Daniel** (FR-017 en `Cola.tsx`, FR-041 en `Dashboard.tsx`). En este corte Raúl no toca UI. `backend/src/sync/**` también queda en Daniel para el campo aditivo de FR-034.
>
> **Migraciones:** Daniel agrega `1730000011000_*` (geo FR-034). Raúl **no** agrega migraciones.

## 5. Flujo y acuerdo

- **Sin rúbrica de firma:** el acuerdo es el **review recíproco del PR** (1 aprobación). Review con **time-box de 24 h**; si no llega, el que espera deja la decisión escrita y avanza.
- **Art. II:** los PR de **spec/docs** se mergean **antes** que los de código.
- **Rama** `<tipo>/<tsk-id>-<desc>`; **commits firmados** en español, un cambio lógico por commit, `refs TSK-…`/`refs #…`. **Squash + rama borrada**; el issue pasa a Done al cerrar su PR.
- **Portabilidad (macOS + Windows):** LF siempre; `sep` de `node:path`; variables en `.env` o `npx cross-env`, **nunca** `export`. Si algo rompe en Windows, se arregla en el mismo PR (`CONTRIBUTING.md` §9).
- **D5:** ya decidida (spec 001). La ratificación pendiente de Raúl se cierra en el PR del ciclo 001.

## 6. Qué NO entra

- **#45 (V2 de formularios):** docx/PDF/OCR, catálogo de plantillas de plataforma e IA de extracción — **fuera de V1**, queda en backlog.
- **Analítica con IA (resumen ejecutivo generado por IA):** excluida por spec maestro §10 (NFR-08, privacidad Art. IV).
- **PostGIS / consultas espaciales:** FR-034 se implementa con lat/lon numérico; el índice espacial queda como evolución.

## 7. Éxito del plan

1. `specs/001` COMPLETO y ratificado; issue #4 cerrado.
2. FR-017, FR-034 y FR-041 **implementados** (no mock, no diferido) con prueba; FR-042 con prueba.
3. **Matriz §3 ≥ 90% verde** en CI; caos 1–7 verdes; nightly 17/17.
4. #84 resuelto (sin críticas ni altas en runtime de producción).
5. Prototipo desplegado ≤ US$7/mes con HTTPS; demo §9 corrida en vivo.
6. `docs-evidencia/informe-final/` consolidado y §12 actualizado; presentación de cierre lista.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.2.0 | 2026-10-14 | Actualiza el estado tras #120/#122/#126/#127: hardening y artefactos deploy mergeados; PRs #121/#123/#124/#129 listos; matriz proyectada en 39 filas/94,9%; registra dependencias de review y provisioning | Daniel Ávila |
| 0.1.0 | 2026-10-14 | Plan inicial: cierre de F2 (tenancy + huecos 002/004/005 + hardening) y Fase 3 en dos tracks paralelos | Daniel Ávila |
