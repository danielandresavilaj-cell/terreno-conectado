# TASKS — Módulo 004: Dominio inspecciones

**Versión:** 0.2.0 · **Fecha:** 2026-10-14 · **Autor:** Daniel Ávila
**Padre:** `plans/004-dominio-inspecciones/plan.md` · **Spec:** `specs/004-dominio-inspecciones/spec.md`
**Issue:** #7 · **Requisitos:** FR-030…FR-039

> **Regla (Artículo II):** cada task referencia al menos un ID de requisito; cada commit referencia al menos un task.

## Contexto

La auditoría del 2026-10-13 sobre `main` muestra **FR-030…FR-039 ya implementados** con una excepción: **FR-034 geolocalización** estaba documentado como `inspection.location GEOGRAPHY(Point)` pero no existía en la migración ni en el contrato de sincronización. Se implementa en V1 sin PostGIS y se actualizan las evidencias.

## Tareas

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-DOM-001 | Detallar el spec 004 de ESQUELETO a completo: modelo de dominio, tipos de respuesta, validación | FR-030…039 | — | `specs/004-dominio-inspecciones/spec.md` en estado COMPLETO; §2 refleja el estado real con evidencia | ✅ Hecho (0.3.0) |
| TSK-DOM-002 | Plan técnico del módulo | NFR-11 | 001 | `plans/004-dominio-inspecciones/plan.md` existe y enlaza spec + tasks | ✅ Hecho |
| TSK-DOM-003 | Implementar FR-034 (geolocalización opcional): migración DB, contrato sync, validación server-side, captura opcional en cliente, tests | FR-034 | 001 | Migración `1730000011000_inspection_location.js`; `SyncInspectionPayload.location`; `backend/test/sync.spec.ts` verde; captura opcional en `frontend/src/lib/store.tsx` | ✅ Hecho (0.2.0) |
| TSK-DOM-004 | Verificación: actualizar filas FR-031/032/034 de la matriz §3 y evidencias del spec 004 | FR-030…039 | 003 | `test-plan.md` refleja FR-034 implementado; spec 004 §2 con evidencia actualizada | ⬜ Por hacer |

## Criterios de salida del módculo

1. Spec 004 completo y mergeado (Art. II).
2. Modelo de dominio documentado con plantilla/revisión, inspección, hallazgo, bitácora y adjunto.
3. FR-034 implementado y probado.
4. Matriz §3 con FR-031/032/034 verdes.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.2.0 | 2026-10-14 | TSK-DOM-003 reabierto como implementación de FR-034; se agrega TSK-DOM-004 (verificación de matriz §3) | Daniel Ávila |
| 0.1.0 | 2026-10-13 | Creación: cierre documental del módculo 004 (TSK-DOM-001…003) | Daniel Ávila |
