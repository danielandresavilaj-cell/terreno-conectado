# TASKS — Módulo 005: Reportes y gerencia

**Versión:** 0.6.1 · **Fecha:** 2026-11-13 · **Autor:** Daniel Ávila
**Padre:** `plans/005-reportes-gerencia/plan.md` · **Spec:** `specs/005-reportes-gerencia/spec.md`
**Issue:** #8 · **Requisitos:** FR-040…FR-047, FR-062, FR-063, NFR-03

> **Regla (Artículo II):** cada task referencia al menos un ID de requisito; cada commit referencia al menos un task.

## Contexto

La auditoría del 2026-10-13 sobre `main` muestra **FR-040/042 implementados** y dos huecos documentados: filtro por autor (FR-041) y automatización del umbral (FR-043). El ciclo es de **cierre documental y verificación**.

## Tareas

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-REP-001 | Detallar el spec 005 de ESQUELETO a completo: métricas, contratos, filtros, export, latencia | FR-040…043 | — | `specs/005-reportes-gerencia/spec.md` en estado COMPLETO; §2 refleja el estado real con evidencia | ✅ Hecho (0.2.0) |
| TSK-REP-002 | Plan técnico del módulo | NFR-11 | 001 | `plans/005-reportes-gerencia/plan.md` existe y enlaza spec + tasks | ✅ Hecho |
| TSK-REP-003 | Verificación de FR-040/043: confirmar métrica latencia (media+p95) y registrar el ≤60 s como medición en vivo | FR-040, FR-043, NFR-03 | 001 | `backend/test/dashboard.spec.ts` verde (`latencia_media_seg`, `latencia_p95_seg`); fila FR-040/043 en `test-plan.md` 🟡 con nota de medición en vivo (demo Fase 3) | ✅ Hecho (0.2.0) |
| TSK-REP-004 | Implementar el filtro por autor (FR-041): `autor_id` en `findings`, `autores` en `summary`, filtro en la UI y test | FR-041 | 001 | `dashboard/findings?autor_id=` filtra por `inspection.executed_by`; `summary.autores` lista autores del período; test verde en `backend/test/dashboard.spec.ts`; FR-041 ✅ | ✅ Hecho (0.2.0) |
| TSK-REP-005 | Verificación de FR-042: test del CSV de hallazgos del cliente | FR-042 | — | `frontend/src/lib/dashboard-csv.ts` + `frontend/test/dashboard-csv.test.ts` verdes; cubre cabecera, filas, escapado de comillas/comas y valores nulos | ✅ Hecho (0.2.0) |
| TSK-REP-006 | Dashboard de supervisión v1.1: hallazgos, revisión, actividad y sincronización con métricas de un solo reloj | FR-040, FR-043, NFR-03 | TSK-AUTH-011 | `backend/test/dashboard-supervision.spec.ts` (incluye reloj de dispositivo desfasado y RLS) y `frontend/test/supervision-titulares.test.ts` verdes; migración 016 | ✅ Hecho (0.3.0) |
| TSK-REP-007 | Exportar inspecciones: Excel consolidado, PDF y Word, con filtros de formulario/estado/autor, meses calendario, rango libre y selección | FR-045, FR-046, FR-047 | TSK-REP-006, TSK-FORM-020 | `consolidado.test.ts`, `inspection-report.spec.ts` y `exportar-inspecciones.test.ts` verdes; suites de export existentes sin regresión | ✅ Hecho (0.4.0) |
| TSK-REP-008 | Evidencia fotográfica visible en supervisión | FR-062 | TSK-REP-006 | `GET /dashboard/attachments/:id` entrega los bytes de la foto con RLS y roles del dashboard (otra empresa → 404, trabajador → 403); el detalle trae `foto_id` por respuesta y `hallazgos`; el listado de hallazgos y el detalle muestran miniatura con visor. `backend/test/attachments.spec.ts` y `frontend/test/fotos.test.ts` verdes | ✅ Hecho (0.5.0) |
| TSK-REP-009 | Bitácora legible por el equipo y la supervisión | FR-033, FR-063 | TSK-REP-008 | `GET /dashboard/bitacora` filtra por faena y período, pagina y respeta RLS (otra empresa no ve nada, plataforma → 403); la pantalla Bitácora muestra "De la faena" y Gerencia "Bitácora del equipo". `backend/test/bitacora.spec.ts` verde | ✅ Hecho (0.6.0) |
| TSK-REP-010 | Gerencia usable en el teléfono: lista de inspecciones apilada | FR-041, FR-044 | TSK-REP-007 | Bajo 1024 px cada inspección es una tarjeta sin desborde horizontal; desde 1024 px, la tabla de siempre con cabecera alineada. Sin cambios de API | ✅ Hecho (0.6.1) |

## Criterios de salida del módulo

1. Spec 005 completo y mergeado (Art. II).
2. Contratos y métrica de latencia documentados.
3. FR-041 autor ✅; FR-043 ≤60 s como 🟡 con decisión registrada.
4. FR-042 con test del CSV del cliente.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.6.1 | 2026-11-13 | Se agrega TSK-REP-010 (lista de inspecciones apilada en el teléfono) | Daniel Ávila (con IA) |
| 0.6.0 | 2026-11-13 | Se agrega TSK-REP-009 (bitácora legible, FR-063) | Daniel Ávila (con IA) |
| 0.5.0 | 2026-11-13 | Se agrega TSK-REP-008 (evidencia fotográfica visible, FR-062, Enmienda 008) | Daniel Ávila (con IA) |
| 0.4.0 | 2026-11-11 | Se agrega TSK-REP-007 (exportación consolidada, PDF y Word) | Daniel Ávila |
| 0.3.0 | 2026-11-11 | Se agrega TSK-REP-006 (dashboard de supervisión v1.1) | Daniel Ávila |
| 0.2.0 | 2026-10-14 | TSK-REP-004 reabierto e implementado (FR-041 filtro por autor); se agrega TSK-REP-005 (test del CSV, FR-042) | Daniel Ávila |
| 0.1.0 | 2026-10-13 | Creación: cierre documental del módulo 005 (TSK-REP-001…004) | Daniel Ávila |
