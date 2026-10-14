# PLAN — Módulo 003: Motor de sincronización

**Versión:** 0.1.0 · **Fecha:** 2026-10-13 · **Autor:** Daniel Ávila
**Derivado de:** `specs/000-master/spec.md` §5.3 · **Spec:** `specs/003-motor-sincronizacion/spec.md` (0.4.0)
**Tareas:** `tasks/003-motor-sincronizacion/tasks.md` (TSK-SYNC-001…006) · **Issue:** #6

> **Qué es este módulo:** el ciclo que mueve datos entre el dispositivo (offline-first) y la nube sin perder ni duplicar un registro (Art. III), con subida idempotente por lotes, descarga incremental y conflictos resueltos de forma determinista y auditable.

## 1. Objetivo

Dejar cerrado el módulo 003: spec completo (de ESQUELETO a COMPLETO), decisión de descarga incremental registrada, y endurecimiento de las pruebas de delta. **No hay construcción nueva de comportamiento**: la auditoría del 2026-10-13 confirma FR-020…029 implementados. El trabajo del ciclo es de **documentación y evidencia** (Art. II, Art. VIII).

## 2. Estado de partida (auditado)

| Pieza | Dónde vive | Estado |
| :--- | :--- | :--- |
| Ingesta idempotente `POST /sync/batch` | `backend/src/sync/sync.service.ts` | Implementado |
| Contrato wire | `shared/src/sync.ts` | Implementado |
| Worker de cola cliente | `frontend/src/lib/sync.ts` | Implementado |
| LWW + `CONFLICT_RECORD` | `sync.service.ts` (`decideLww`) | Implementado |
| Delta de plantillas | `backend/src/templates/templates.controller.ts`, `frontend/src/lib/plantillas.ts` | Implementado (TSK-FORM-009) |
| Cursor `published_seq` por tenant | `frontend/src/lib/db.ts` (`tc_plantilla_cursor:`) | Implementado |

## 3. Orden de construcción

```
TSK-SYNC-001 spec 003 completo ──► TSK-SYNC-002 plan técnico
        │
        ├──► TSK-SYNC-004 prueba del delta ──► TSK-SYNC-005 caos 8 (pull a medias)
        │
        └──► TSK-SYNC-003 spec 002 (docs)
                                          TSK-SYNC-006 referencia offline (verificación)
```

1. **TSK-SYNC-001/002** — spec y plan (este documento). Cierra el ítem abierto de la descarga incremental con una **decisión registrada** (§6 del spec).
2. **TSK-SYNC-004/005** — evidencia: el delta de plantillas (cursor por tenant, solo cambios, versión congelada) y el corte a mitad del pull (caos 8). Reutiliza el patrón de `backend/test/templates.delta.spec.ts`.
3. **TSK-SYNC-003** — documentar el spec 002 sin tocar código.
4. **TSK-SYNC-006** — verificar que las faenas quedan disponibles sin red tras un arranque con señal (decisión §6.4: snapshot).

## 4. Decisiones previas (cerradas)

1. **Cursor de plantillas = `published_seq`** (secuencia global de publicación), **por tenant**. No `version` (por plantilla) — el defecto y su corrección están en `data-model.md` v1.1.2 y `adr/003` Enmienda 2.
2. **Descarga incremental V1:** plantillas por cursor; **faenas y asignaciones por snapshot completo** al autenticar/reconectar (volumen acotado; simplicidad como presupuesto). Cualquier delta futuro extiende el mismo patrón de cursor por tenant, no un camino nuevo.
3. **Versión congelada** (FR-028): el delta nunca re-encuadra un turno en curso; el borrador conserva su `template_version`.
4. **El cursor sólo avanza si la caché acepta todo el delta** (evita perder revisiones ante un corte a mitad).

## 5. Riesgos y mitigaciones

| Riesgo | Prob. | Mitigación |
| :--- | :--- | :--- |
| Regresión del invariante Art. III al tocar sync | Media | Caos 1–7 + nightly E2E como puerta; el ciclo es docs/tests, no toca `sync.service.ts` |
| El delta de plantillas pierde revisiones (cursor mal avanzado) | Media | TSK-SYNC-004/005: cursor por tenant + caos 8 (no avanzar ante corte) |
| Datos de referencia desactualizados offline | Baja | Snapshot al reconectar (evento `online`); decisión registrada §6.4 |
| Documentar como "hecho" algo no verificado | Media | §2 del spec cita la evidencia (archivo + prueba) de cada FR |

## 6. Definición de "hecho" para el módulo

- Spec 003 COMPLETO y mergeado; descarga incremental cerrada con decisión registrada.
- Spec 002 documentado.
- Delta de plantillas cubierto por prueba (cursor por tenant, solo cambios, congelado).
- Caos 1–7 verdes; caos 8 (pull a medias) incorporado.
- Matriz §3 de `test-plan.md` con FR-020…028 verdes.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-10-13 | Plan técnico inicial del ciclo del módulo 003 | Daniel Ávila |
