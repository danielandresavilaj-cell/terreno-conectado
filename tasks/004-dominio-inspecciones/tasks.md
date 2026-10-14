# TASKS — Módulo 004: Dominio inspecciones

**Versión:** 0.1.0 · **Fecha:** 2026-10-13 · **Autor:** Daniel Ávila
**Padre:** `plans/004-dominio-inspecciones/plan.md` · **Spec:** `specs/004-dominio-inspecciones/spec.md`
**Issue:** #6 · **Requisitos:** FR-030…FR-039

> **Regla (Artículo II):** cada task referencia al menos un ID de requisito; cada commit referencia al menos un task.

## Contexto

La auditoría del 2026-10-13 sobre `main` muestra **FR-030…FR-039 ya implementados** (ver §2 del spec). El ciclo del módulo es de **cierre documental y verificación**, no de construcción.

## Tareas

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-DOM-001 | Detallar el spec 004 de ESQUELETO a completo: modelo de dominio, tipos de respuesta, validación | FR-030…039 | — | `specs/004-dominio-inspecciones/spec.md` en estado COMPLETO; §2 refleja el estado real con evidencia | ✅ Hecho (0.3.0) |
| TSK-DOM-002 | Plan técnico del módulo | NFR-11 | 001 | `plans/004-dominio-inspecciones/plan.md` existe y enlaza spec + tasks | ✅ Hecho |
| TSK-DOM-003 | Verificación: revisar el estado de las filas FR-031/032 de la matriz §3 y la evidencia de FR-036/038/039 | FR-030…039 | 001 | Cada FR con estado y archivo/prueba citado en §2 del spec; sin 🔴 nuevos | ⬜ Por hacer |

## Criterios de salida del módulo

1. Spec 004 completo y mergeado (Art. II).
2. Modelo de dominio documentado con plantilla/revisión, inspección, hallazgo, bitácora y adjunto.
3. Matriz §3 con FR-031/032 verdes.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-10-13 | Creación: cierre documental del módulo 004 (TSK-DOM-001…003) | Daniel Ávila |
