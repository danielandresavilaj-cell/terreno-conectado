# TASKS — Módulo 005: Reportes y gerencia

**Versión:** 0.2.0 · **Fecha:** 2026-10-14 · **Autor:** Daniel Ávila
**Padre:** `plans/005-reportes-gerencia/plan.md` · **Spec:** `specs/005-reportes-gerencia/spec.md`
**Issue:** #6 · **Requisitos:** FR-040…FR-043, NFR-03

> **Regla (Artículo II):** cada task referencia al menos un ID de requisito; cada commit referencia al menos un task.

## Contexto

La auditoría del 2026-10-13 sobre `main` muestra **FR-040/042 implementados** y dos huecos documentados: filtro por autor (FR-041) y automatización del umbral (FR-043). El ciclo es de **cierre documental y verificación**.

## Tareas

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-REP-001 | Detallar el spec 005 de ESQUELETO a completo: métricas, contratos, filtros, export, latencia | FR-040…043 | — | `specs/005-reportes-gerencia/spec.md` en estado COMPLETO; §2 refleja el estado real con evidencia | ✅ Hecho (0.2.0) |
| TSK-REP-002 | Plan técnico del módulo | NFR-11 | 001 | `plans/005-reportes-gerencia/plan.md` existe y enlaza spec + tasks | ✅ Hecho |
| TSK-REP-003 | Verificación de FR-040/043: confirmar métrica latencia (media+p95) y registrar el ≤60 s como medición en vivo | FR-040, FR-043, NFR-03 | 001 | `backend/test/dashboard.spec.ts` verde; fila FR-040/043 con estado correcto (🟡 por el umbral en vivo) | ⬜ Por hacer |
| TSK-REP-004 | Implementar el filtro por autor (FR-041): `autor_id` en `findings`, `autores` en `summary`, filtro en la UI y test | FR-041 | 001 | `dashboard/findings?autor_id=` filtra por `inspection.executed_by`; `summary.autores` lista autores del período; test verde en `backend/test/dashboard.spec.ts`; FR-041 ✅ | ✅ Hecho (0.2.0) |
| TSK-REP-005 | Verificación de FR-042: test del CSV de hallazgos del cliente | FR-042 | — | `frontend/src/lib/dashboard-csv.ts` + `frontend/test/dashboard-csv.test.ts` verdes; cubre cabecera, filas, escapado de comillas/comas y valores nulos | ✅ Hecho (0.2.0) |

## Criterios de salida del módulo

1. Spec 005 completo y mergeado (Art. II).
2. Contratos y métrica de latencia documentados.
3. FR-041 autor ✅; FR-043 ≤60 s como 🟡 con decisión registrada.
4. FR-042 con test del CSV del cliente.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.2.0 | 2026-10-14 | TSK-REP-004 reabierto e implementado (FR-041 filtro por autor); se agrega TSK-REP-005 (test del CSV, FR-042) | Daniel Ávila |
| 0.1.0 | 2026-10-13 | Creación: cierre documental del módulo 005 (TSK-REP-001…004) | Daniel Ávila |
