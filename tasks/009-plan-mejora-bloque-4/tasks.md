# TASKS — Plan de mejora, bloque 4

**Versión:** 1.0.0 · **Fecha:** 2026-11-14 · **Autor:** Daniel Ávila (con IA)
**Padre:** `plans/009-plan-mejora-bloque-4/plan.md` · **Origen:** `docs/auditoria-y-plan-de-mejora.md` §6
**Requisitos:** FR-012, FR-019, FR-032, FR-040, FR-041, FR-065, FR-066

> **Regla (Artículo II):** cada task referencia al menos un ID de requisito; cada commit referencia al menos un task.
> Las tareas se ejecutan **en este orden**, una a la vez, cada una con su ficha en `plans/009-plan-mejora-bloque-4/`.

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-OFF-016 | Varias fotos por hallazgo (ficha T1) | FR-012, FR-032, FR-062 | — | Hasta 5 fotos por hallazgo; las no enviadas se pueden quitar y las enviadas no; Gerencia y el detalle muestran todas (`fotos_ids`). `frontend/test/hallazgo.test.ts` verde; E2E de captura verde | Pendiente |
| TSK-OFF-015 | Hallazgo directo, sin pregunta (ficha T2) | FR-032 | TSK-OFF-016 | "Registrar hallazgo general" en Inspección crea un hallazgo con `response_id` nulo, que se puede corregir sin duplicarse y viaja con la inspección. `frontend/test/hallazgo.test.ts` verde; E2E de captura verde | Pendiente |
| TSK-OFF-017 | Reexportar una inspección enviada (ficha T3) | FR-019 | — | En Cola, una inspección enviada ofrece "Descargar Excel" si el teléfono tiene su plantilla y planilla original; si no, dice por qué, sin usar la red. `frontend/test/reexportar.test.ts` verde | Pendiente |
| TSK-FORM-024 | Archivar, restaurar y duplicar formularios (ficha T4) | FR-066, FR-049 | — | Archivar oculta el formulario a los dispositivos y a Plantillas sin borrar nada; restaurar lo devuelve; duplicar crea un formulario nuevo con ids nuevos. Auditado. `backend/test/templates-archivar.spec.ts` y `frontend/test/duplicar-formulario.test.ts` verdes | Pendiente |
| TSK-REP-012 | Tendencia semanal y filtros en una barra (ficha T5) | FR-040, FR-041 | TSK-OFF-016 | `summary.tendencia_semanal` con 8 semanas por faena; Gerencia la grafica; faena, severidad y autor en una sola barra y un solo filtro de autor. `backend/test/dashboard-tendencia.spec.ts` verde | Pendiente |
| TSK-ADM-003 | Limitar las faenas de cada cuenta (ficha T6) | FR-065, FR-034 | — | Migración 021 (`user_site`); `PUT /users/:id/faenas`; `GET /sites` devuelve sólo las faenas asignadas a la cuenta (sin asignación: todas); Equipo permite elegirlas. Auditado y con RLS. `backend/test/users-faenas.spec.ts` verde; E2E verde | Pendiente |

## Criterios de salida del bloque

1. Las seis tareas en ✅, cada una con su PR mergeado y CI verde.
2. FR-065 y FR-066 en 🟢 en `test-plan.md` §3.
3. `docs/auditoria-y-plan-de-mejora.md` §6 al día y producción desplegada (ficha T7).

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-11-14 | Creación con las seis tareas del bloque 4 | Daniel Ávila (con IA) |
