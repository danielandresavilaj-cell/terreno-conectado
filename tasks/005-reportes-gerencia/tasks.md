# TASKS — Módulo 005: Reportes y gerencia

**Versión:** 0.1.0 · **Fecha:** 2026-10-13 · **Autor:** Daniel Ávila
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
| TSK-REP-004 | Decisión sobre el filtro por autor (FR-041): documentar deferimiento | FR-041 | 001 | FR-041 registrado como 🟡 con la decisión de no construir en V1 (plan §3.1) | ⬜ Por hacer |

## Criterios de salida del módulo

1. Spec 005 completo y mergeado (Art. II).
2. Contratos y métrica de latencia documentados.
3. FR-041 autor y FR-043 ≤60 s como 🟡 con decisión registrada.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-10-13 | Creación: cierre documental del módulo 005 (TSK-REP-001…004) | Daniel Ávila |
