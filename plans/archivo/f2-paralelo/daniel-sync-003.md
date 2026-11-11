# PLAN — Track Daniel: Módulo 003 · descarga incremental

**Versión:** 0.1.0 · **Fecha:** 2026-10-13 · **Autor:** Daniel Ávila
**Tarjeta:** #6 · **Spec:** `specs/003-motor-sincronizacion/spec.md` · **Plan padre:** `plan.md`
**Riesgo principal:** Art. III (idempotencia). Puerta de salida: nightly E2E 17/17.

## Objetivo

Cerrar el spec 003 (ESQUELETO → COMPLETO) y **decidir** la descarga incremental que la 0.3.0 dejó abierta. La auditoría del 2026-10-13 confirma que **FR-020…029 ya están implementados** — incluido el delta de plantillas por `published_seq` (módulo 007) y su cursor por tenant. No es un módulo por construir: es **cierre documental + endurecimiento de pruebas**. La decisión de V1 (spec 003 §6): plantillas por cursor `published_seq`; faenas y asignaciones por snapshot completo (simplicidad, Art. V/VI).

## Zona (solo Daniel)

`backend/src/sync/**` · `backend/src/templates/**` · `shared/src/**` · `frontend/src/lib/**` · `specs/002` · `specs/003` · `plans/003-motor-sincronizacion/**` · `plans/002-captura-offline/**` · `tasks/003-motor-sincronizacion/**` · filas propias de `test-plan.md` / `README.md`. (No hay migración nueva en este ciclo.)

## Tareas (TSK-SYNC-NNN)

Detalle completo en `tasks/003-motor-sincronizacion/tasks.md`.

| ID | Tarea | Requisito(s) | Estado |
| :--- | :--- | :--- | :--- |
| TSK-SYNC-001 | Detallar el spec 003 de ESQUELETO a COMPLETO + decisión de descarga incremental | FR-020…029 | ✅ |
| TSK-SYNC-002 | Plan técnico `plans/003-motor-sincronizacion/plan.md` | NFR-11 | ✅ |
| TSK-SYNC-003 | Documentar el spec 002 (captura offline) — solo docs | FR-010…019 | ⬜ |
| TSK-SYNC-004 | Endurecer la prueba del delta de plantillas (cursor por tenant, solo cambios, congelado) | FR-027, FR-028 | ⬜ |
| TSK-SYNC-005 | Prueba de caos del pull a medias (caos 8): el cursor no avanza | FR-027, NFR-04 | ⬜ |
| TSK-SYNC-006 | Verificación de datos de referencia offline (faenas) sin red | FR-018, NFR-02 | ⬜ |

> Nota de corrección (2026-10-13): una versión previa de este plan proponía un endpoint nuevo `GET /sync/changes` y una migración `sync_cursor`. La auditoría mostró que **no hacen falta**: el delta de plantillas ya existe con cursor por tenant, y la decisión de V1 es snapshot para faenas/asignaciones (spec 003 §6). El ciclo pasa a cierre documental + pruebas.

## Orden de ataque

1. **TSK-SYNC-001/002** — spec 003 completo, plan técnico y tasks (este PR, docs). Mergear **antes** de cualquier código (Art. II).
2. **TSK-SYNC-004/005** — evidencia del delta de plantillas y del pull a medias (caos 8). Reutiliza `backend/test/templates.delta.spec.ts`. **No toca** `sync.service.ts` (el invariante Art. III queda intacto).
3. **TSK-SYNC-003** — documentar spec 002.
4. **TSK-SYNC-006** — verificar faenas disponibles sin red.
5. Anunciar en #10 todo merge que toque el contrato de sync, para que Raúl re-corra `npm run e2e`. El nightly debe seguir 17/17.

## Definition of Done

- [ ] Spec 003 completo y acordado con Raúl (review del PR)
- [ ] `GET /sync/changes` funcionando, cursor persistido y aislado por RLS
- [ ] Tests nuevos verdes + nightly 17/17
- [ ] Spec 002 documentado
- [ ] Filas FR-022…028 de `test-plan.md` actualizadas (solo las propias)
- [ ] PR aprobado por Raúl, squash, issue #6 a Done

## No tocar

`backend/src/app.module.ts` (solo Raúl) · `backend/src/admin/**` · `frontend/src/App.tsx` · `frontend/src/Shell.tsx` · filas ajenas de `test-plan.md` · `package.json` (lo toca Raúl por NFR-07) · `frontend/e2e/stack.mjs`.
