# PLAN — Cierre de F2 + Fase 3 en paralelo: tenancy+despliegue ∥ huecos 002/004/005 + informe

**Versión:** 0.1.0 · **Fecha:** 2026-10-14 · **Autores:** Daniel Ávila y Raúl González
**Derivado de:** `specs/000-master/spec.md` §5 y §9 · `test-plan.md` §3 y §8
**Issues:** #2 (F2) · #4 (001) · #5 (002) · #7 (004) · #8 (005) · #3 (iteración 0) · #29 (007) · #84 (hardening) · #15 (F3)
**Planos por persona:** `raul-tenancy-001-deploy.md` · `daniel-huecos-002-005-informe.md`

> **Qué es este plan:** el reparto y las reglas para las **dos últimas tandas** — cerrar F2 con honestidad (matriz §3 ≥ 90%) y ejecutar la Fase 3 — trabajadas **en paralelo** por autoría de spec, sin pisarse. Reemplaza a `plans/f2-paralelo/` como plan vigente.

## 1. Por qué este corte

La aplicación **ya está escrita**: los seis módulos de código (001–006) y el 007 están implementados. Una auditoría al `main` @ `fbc2888` (2026-10-14) halló que lo que falta no es construir, es **cerrar bien**:

| Frente | Estado real | Qué falta |
| :--- | :--- | :--- |
| **Módulo 001 (auth)** | Código completo y probado (`auth.spec.ts`, `rls.spec.ts`) | **Spec aún en ESQUELETO** (5 secciones abiertas). Único ciclo de módulo sin cerrar |
| **FR-017** (002) | `CUOTA={usadaPct:83}` **fijo en `seed.ts`**; `Cola.tsx` lo pinta. No hay `navigator.storage.estimate()` en el repo | **Implementar de verdad** el aviso ≥80% + priorización. Spec 002 §2 lo marca ✅ (falso) |
| **FR-041 autor** (005) | Diferido (🟡) | **Implementar el filtro por autor** (no diferir) → 🟡→🟢 |
| **FR-042 CSV** (005) | Implementado, **sin prueba** (⚪) | Prueba automatizada → ⚪→🟢 |
| **FR-034 geo** (004) | La columna **no existe**: `data-model.md` 1.1.3 retiró `inspection.geo`; migración inicial lo difiere. Spec 004 §2 lo marca ✅ (falso) | **Implementar geo opcional** (lat/lon numérico, campo aditivo en el sync) |
| **Matriz §3** | **33 filas · 🟢29 (87,9%)** · techo declarado `<90%` | Cerrar huecos → **≥90%** (lo exige #2) |
| **#84 hardening** | 2 críticas + 8 altas (NestJS v12 es **runtime**) | Ventanilla dedicada (toca lockfile) |
| **Fase 3** | Nada provisionado (`infra/` solo tiene el compose local) | Despliegue (ADR-002), demo, informe final, presentación, §12 |

**El bloqueo:** el criterio de salida de F2 (#2) exige **matriz §3 ≥ 90% verde**. Con FR-041 y FR-042 abiertos no cierra. Por eso este corte primero cierra los huecos, y recién entonces se despliega y se documenta.

## 2. Reparto

| Persona | Track | Alcance | Riesgo |
| :--- | :--- | :--- | :--- |
| **Raúl** | A | Módulo **001** (autor del spec) → **#84** → **despliegue + demo** | Medio (infra greenfield) |
| **Daniel** | B | Huecos **002/004/005** → cierre de epics → **informe + presentación** | Medio (Art. III en FR-034) |

**Por qué así.** El spec 001 es de Raúl y es la capa de gobierno de datos (Art. IV), igual que 006; el despliegue y #84 son infraestructura, su terreno. Los huecos de código son de los módulos que Daniel escribió (002/004/005), y el informe final es evidencia de su plan de pruebas. **Cero solape de archivos** (ver §4).

## 3. Hitos

```
HITO 0  Acuerdo registrado + D5 ratificada (comentario en #4)            [ambos]
HITO 1  A1-A3 (spec 001)   ∥   B1-B6 (cierres 002/004/005)              [paralelo]
HITO 2  #84 deps + CI 3/3 · congelar código · matriz §3 ≥ 90% (B7)      [serial]
HITO 3  A5-A6 (deploy VPS + demo)   ∥   B8-B10 (informe + presentación) [paralelo]
HITO 4  Cerrar F2 (#2) y F3 (#15) · presentación final                  [ambos]
```

> El **HITO 2 es serial a propósito**: #84 mueve el lockfile y NestJS v12 toca el backend entero; correrlo en paralelo rompería la instalación de los dos. Y el **HITO 3 espera la congelación de código** del HITO 2: no se despliega sobre cambios de FR-017/034/041.

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
| 0.1.0 | 2026-10-14 | Plan inicial: cierre de F2 (tenancy + huecos 002/004/005 + hardening) y Fase 3 en dos tracks paralelos | Daniel Ávila |
