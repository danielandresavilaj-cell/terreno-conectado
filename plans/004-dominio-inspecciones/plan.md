# PLAN — Módulo 004: Dominio inspecciones

**Versión:** 0.1.0 · **Fecha:** 2026-10-13 · **Autor:** Daniel Ávila
**Derivado de:** `specs/000-master/spec.md` §3.2 · **Spec:** `specs/004-dominio-inspecciones/spec.md` (0.3.0)
**Tareas:** `tasks/004-dominio-inspecciones/tasks.md` (TSK-DOM-001…) · **Issue:** #6

> **Qué es este módulo:** las entidades de dominio (plantilla/revisión, inspección, hallazgo, bitácora, adjunto) y sus reglas. Se **escriben** por el motor de sincronización (spec 003), se **leen** por el dashboard (spec 005) y sólo exponen CRUD propio en el editor de plantillas (`tenant_admin`).

## 1. Objetivo

Dejar el spec 004 en COMPLETO y verificar que el dominio está implementado y probado. La auditoría del 2026-10-13 confirma **FR-030…FR-039 implementados**; el ciclo es de **documentación y evidencia** (Art. II, Art. VIII), sin construcción nueva.

## 2. Estado de partida (auditado)

| Pieza | Dónde vive | Estado |
| :--- | :--- | :--- |
| Plantilla + revisión (draft/published/archived) | `backend/src/templates/templates.service.ts` | Implementado |
| 8 tipos de respuesta + `props` | `shared/src/templates.ts` (`RESPONSE_TYPES`, `FIELD_PROPS_SCHEMA`) | Implementado |
| Validación de `value_json` (FR-039) | `shared/src/templates.ts` (`validarRespuesta`) | Implementado |
| Inspección/hallazgo/bitácora/adjunto | `backend/src/sync/sync.service.ts` (tablas de dominio) | Implementado |
| Versión congelada (FR-038) | `frontend/src/lib/store.tsx`, `frontend/src/lib/plantillas.ts` | Implementado |
| Hallazgos urgentes (FR-035) | `backend/src/dashboard/dashboard.service.ts` | Implementado (superficie de lectura, spec 005) |

## 3. Orden

```
TSK-DOM-001 spec 004 completo ──► TSK-DOM-002 plan técnico ──► TSK-DOM-003 verificación (matriz + evidencia)
```

## 4. Riesgos y mitigaciones

| Riesgo | Prob. | Mitigación |
| :--- | :--- | :--- |
| Documentar como "hecho" algo no verificado por prueba | Media | §2 del spec cita archivo de evidencia por FR; TSK-DOM-003 revisa la matriz §3 |
| Deriva entre dispositivo y servidor en la validación de `value_json` | Baja | Un solo validador compartido (`shared/src/templates.ts`, `adr/001`) |

## 5. Definición de "hecho"

- Spec 004 COMPLETO y mergeado.
- Modelo de dominio documentado (plantilla/revisión, inspección, hallazgo, bitácora, adjunto).
- Filas FR-031/032 de la matriz §3 con estado correcto y evidencia.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-10-13 | Plan técnico inicial del ciclo del módulo 004 | Daniel Ávila |
