# PLAN — Módulo 005: Reportes y gerencia

**Versión:** 0.2.0 · **Fecha:** 2026-10-14 · **Autor:** Daniel Ávila
**Derivado de:** `specs/000-master/spec.md` §3.3 · **Spec:** `specs/005-reportes-gerencia/spec.md` (0.3.0)
**Tareas:** `tasks/005-reportes-gerencia/tasks.md` (TSK-REP-001…) · **Issue:** #6

> **Qué es este módulo:** la cara de lectura del sistema. El dashboard del supervisor prueba la promesa de valor: dato capturado → visible en la nube en ≤ 60 s, con métricas y export.

## 1. Objetivo

Dejar el spec 005 en COMPLETO, verificar FR-040/042 (verdes) y **registrar como 🟡** los dos huecos reales: filtro por **autor** (FR-041) y automatización del **≤ 60 s** (FR-043). El ciclo es de **documentación y evidencia**, no de construcción nueva.

## 2. Estado de partida (auditado)

| Pieza | Dónde vive | Estado |
| :--- | :--- | :--- |
| Resumen del período (métricas + latencia) | `backend/src/dashboard/dashboard.service.ts` | Implementado |
| Validación única de filtros | `backend/src/dashboard/dashboard.contract.ts` | Implementado |
| CSV de la vista | `frontend/src/screens/Dashboard.tsx` | Implementado (FR-042) |
| `.xlsx` por inspección + ZIP del lote | `backend/src/dashboard/{inspection-export,lote-export}.service.ts` | Implementado (FR-044/045/046) |
| Registro de conflictos | `frontend/src/screens/Conflictos.tsx` + `GET /conflicts` | Implementado (FR-023) |

## 3. Decisiones del ciclo

1. **FR-041 autor — implementado (rev. 0.2.0).** Decisión original del ciclo 0.1.0: registrar como 🟡 y no agregarlo en V1. **Reabierto como enmienda menor** al cierre de F2 para llevar la matriz §3 a ≥ 90 %: `dashboard/findings?autor_id=` filtra por `inspection.executed_by`, `summary.autores` publica los autores con actividad del período y la UI agrega el filtro. Superficie acotada (un campo UUID en `findingsFiltrosSchema`), justificada por Art. V.
2. **FR-042 CSV — se agrega test unitario (rev. 0.2.0).** El CSV de hallazgos ya estaba implementado en `Dashboard.tsx`; para cerrar el hueco ⚪ se extrae la lógica a `frontend/src/lib/dashboard-csv.ts` (función pura, escapado de comillas/comas, valores nulos) y se cubre con `frontend/test/dashboard-csv.test.ts`.
3. **FR-043 ≤ 60 s — medido en vivo.** La métrica de latencia media+p95 (FR-040) sí está implementada; el umbral absoluto se valida cronometrado en la demo (Fase 3), no en CI. Fila 🟡 aceptada (coincide con `test-plan.md` §3).

## 4. Definición de "hecho"

- Spec 005 COMPLETO y mergeado.
- Contratos del dashboard y métrica de latencia documentados.
- FR-041 autor implementado y ✅; FR-042 CSV testeado y ✅ (rev. 0.2.0); FR-043 ≤60 s registrado 🟡 con su decisión.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.2.0 | 2026-10-14 | **FR-041 filtro por autor implementado + FR-042 CSV testeado** (reabre la decisión de deferir de 0.1.0) para alcanzar el ≥ 90 % de la matriz §3. Ver `tasks/005-reportes-gerencia/tasks.md` TSK-REP-004 / TSK-REP-005 | Daniel Ávila |
| 0.1.0 | 2026-10-13 | Plan técnico inicial del ciclo del módulo 005 | Daniel Ávila |
