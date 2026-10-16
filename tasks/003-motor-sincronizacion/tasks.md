# TASKS — Módulo 003: Motor de sincronización

**Versión:** 0.1.0 · **Fecha:** 2026-10-13 · **Autor:** Daniel Ávila
**Padre:** `plans/003-motor-sincronizacion/plan.md` · **Spec:** `specs/003-motor-sincronizacion/spec.md`
**Issue:** #6 · **Requisitos:** FR-018, FR-020…FR-029 · **NFR:** NFR-03, NFR-04

> **Regla (Artículo II):** cada task referencia al menos un ID de requisito; cada commit referencia al menos un task. Las tareas TSK-WS-007…010 (`tasks/000-walking-skeleton/tasks.md`) cubrieron la ingesta, el worker y el LWW del walking skeleton; estas TSK-SYNC completan el **ciclo del módulo**.

## Contexto

La auditoría del 2026-10-13 sobre `main` muestra **FR-020…FR-029 ya implementados** (ver §2 del spec). Por eso el ciclo del módulo es de **cierre documental y verificación de pruebas**, no de construcción: el spec estaba en ESQUELETO y la descarga incremental, abierta. Al verificar (TSK-SYNC-004/005/006) se confirmó que la evidencia de delta, caos 8 y referencia offline **ya existe** en las suites actuales; el ciclo no requirió escribir pruebas nuevas.

## Tareas

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-SYNC-001 | Detallar el spec 003 de ESQUELETO a completo: contratos, idempotencia, LWW, worker, descarga incremental | FR-020…029 | — | `specs/003-motor-sincronizacion/spec.md` en estado COMPLETO; §2 refleja el estado real con evidencia | ✅ Hecho (0.4.0) |
| TSK-SYNC-002 | Plan técnico del módulo | NFR-11 | 001 | `plans/003-motor-sincronizacion/plan.md` existe y enlaza spec + tasks | ✅ Hecho |
| TSK-SYNC-003 | Documentar el spec 002 (captura offline) — solo docs | FR-010…019 | — | `specs/002-captura-offline/spec.md` de ESQUELETO a COMPLETO, sin cambio de código | ✅ Hecho (0.3.0) |
| TSK-SYNC-004 | Endurecer la prueba del delta de plantillas: cursor `published_seq` **por tenant**, solo cambios, versión congelada | FR-027, FR-028 | 001 | `backend/test/templates.delta.spec.ts` cubre: delta vacío, delta con cambios, dos tenants con cursores distintos, y que una inspección en curso no se reencuadra | ✅ Hecho (cubierto: `backend/test/templates.delta.spec.ts` + `frontend/test/plantillas.delta.test.ts` + `frontend/test/plantillas.resolucion.test.ts`) |
| TSK-SYNC-005 | Prueba de caos del pull: corte a mitad del delta (caos 8) | FR-027, NFR-04 | 004 | Con un corte entre recibir y persistir, el cursor **no avanza** y la siguiente pasada recupera las revisiones sin perder ninguna | ✅ Hecho (`frontend/test/plantillas.delta.test.ts:39` "el cursor NO avanza si el delta no se integró completo (caos #8)") |
| TSK-SYNC-006 | Verificación de datos de referencia offline (faenas) sin red | FR-018, NFR-02 | — | Tras un arranque con señal, con la red apagada la captura puede elegir faena del tenant (decisión §6.4 del spec: snapshot completo) | ✅ Hecho (E2E `frontend/e2e/specs/e2e-captura-offline.spec.ts`: captura con `setOffline(true)` sobre la faena real de la sesión cacheada) |
| TSK-SYNC-007 | Descartar de forma explícita una inspección o bitácora pendiente/fallida, sin dejar datos locales huérfanos | FR-013, FR-020, FR-026 | 001 | Confirmación en Cola; inspección elimina árbol local + outbox en una transacción; bitácora elimina su fila local + outbox; no se permite sobre syncing/synced | ✅ Hecho (#157) |

## Criterios de salida del módulo

1. Spec 003 completo y mergeado (Art. II) — ✅ TSK-SYNC-001.
2. Descarga incremental **cerrada** con decisión registrada (plantillas por cursor; referencia por snapshot) — ✅ spec §6.
3. Caos 1–7 verdes con **cero pérdida ∧ cero duplicación**; caos 8 (TSK-SYNC-005) verificado en `plantillas.delta.test.ts`.
4. Cada commit de la iteración referencia su TSK ID (Art. II).

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.2.0 | 2026-10-13 | TSK-SYNC-003 documentada; TSK-SYNC-004/005/006 verificadas como **cubiertas** por las suites existentes (delta, caos 8, referencia offline) | Daniel Ávila |
| 0.1.0 | 2026-10-13 | Creación: cierre documental del módulo 003 (TSK-SYNC-001…006) | Daniel Ávila |
