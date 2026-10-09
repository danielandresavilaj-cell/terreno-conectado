# TASKS — Módulo 007: Formularios dinámicos desde documentos

**Versión:** 0.1.4 · **Fecha:** 2026-10-08 · **Autor:** Raúl González (con IA)
**Padre:** `plans/007-formularios-dinamicos/plan.md` · **Spec de referencia:** `specs/000-master/spec.md` §5 (Enmienda 002, FR-007–009/018–019/027–029/036–039/044–049) · **Board:** issues #34–#45 (TSK-FORM-001→012)

> **Regla (Artículo II):** cada task referencia al menos un ID de requisito; cada commit referencia al menos un task. **Compuerta cerrada:** los PRs de la Enmienda 002 (#63–#66) y el resto de la documentación del módulo (#62, #64, #65, #67–#70) están en `main` desde el 2026-10-08; TSK-FORM-002/003 ya codificaron sobre ella; TSK-FORM-001 (renderer) cerró en el PR #79; TSK-FORM-004 (respuesta híbrida) cerró en el PR #80; TSK-FORM-005 (importador `.xlsx`) cerró en el PR #82.

## Tareas

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-FORM-001 | Motor de render data-driven: la captura dibuja desde la definición de plantilla (`definition` JSONB) | FR-036 | 002, 003 | Una revisión publicada renderiza sus 8 tipos de campo sin HTML hardcodeado; borrador autoguardado por ítem | ✅ Hecho (PR #79) |
| TSK-FORM-002 | Persistencia `TEMPLATE_REVISION` + estados inmutables `draft/published/archived` + RLS | FR-007, FR-049 | — | Migración + test de aislamiento (2 tenants, patrón TSK-WS-002); una revisión publicada no admite UPDATE/DELETE desde `tc_app` | ✅ Hecho (PR #71) |
| TSK-FORM-003 | Catálogo de 8 tipos de campo + validación Zod + `props` JSONB en `TEMPLATE_ITEM` | FR-036, FR-039 | 002 | Schema compartido en `shared/`; respuesta inválida se rechaza en el dispositivo antes de encolar | ✅ Hecho (PR #74) |
| TSK-FORM-004 | `INSPECTION_RESPONSE` híbrido (columnas tipadas + `value_json`) + `ATTACHMENT` de respuesta | FR-036, FR-037 | 003 | Foto de ítem se persiste asociada a la respuesta; `value_json` validado contra `props` | ✅ Hecho (PR #80) |
| TSK-FORM-005 | Importador `.xlsx` — parser, detección de secciones/ítems y celda destino (**incluye spike escolta xlsx**, plan §3.2) | FR-029, ADR-003 | 002, 003 | `.xlsx` estructurado → propuesta `proposed_schema` con secciones/ítems; spike cerrado con elección documentada (enmienda ADR-003) | ✅ Hecho (PR #82) |
| TSK-FORM-006 | UX de importación asistida — preview, edición, confirmación y publicar (`tenant_admin`) | FR-029, FR-048 | 005 | El `tenant_admin` revisa/edita la propuesta y confirma antes de publicar; nunca publica automático; con flag `ai` el backend propone el mapeo | ✅ Hecho (PR #85) |
| TSK-FORM-007 | Entidad `TEMPLATE_IMPORT` + guardar documento fuente (`ATTACHMENT`) + auditoría | FR-029, FR-047 | 005 | Cada import guarda el `.xlsx` fuente y su estado (`uploaded/parsed/proposed/confirmed/failed`); confirmación/export auditadas (FR-051) | ✅ Hecho (PR #86) |
| TSK-FORM-008 | Asignación de plantillas por faena/rol + filtrado y búsqueda en cliente | FR-008, FR-009 | 002 | El `field_worker` solo ve revisiones publicadas asignadas a su faena y rol (FR-009); el `tenant_admin` asigna/desasigna | ⏳ Pendiente |
| TSK-FORM-009 | Sync delta de plantillas publicadas + Excel original para uso offline | FR-018, FR-027 | 001, 002, 008 | `GET /api/v1/templates?since=<template_version>` devuelve solo el delta; caché local permite capturar 100% offline; inspección en curso conserva su versión (FR-028) | ⏳ Pendiente |
| TSK-FORM-010 | Exportación — Excel original rellenado + hoja Evidencias, generado en el dispositivo | FR-019, FR-044, FR-045, FR-046 | 004, 005 | En el dispositivo y desde el dashboard se descarga el `.xlsx` rellenado con hoja Evidencias; lote exportado con formato de plantilla | ⏳ Pendiente |
| TSK-FORM-011 | Pruebas import/export con libros reales, offline, RLS de plantillas y versionado inmutable | FR-029, FR-036–039, FR-049 | 001–010 | Libros reales importan y exportan; caos: corte a mitad de delta, doble import, edición concurrente — cero duplicación (Artículo III) | ⏳ Pendiente |
| TSK-FORM-012 | **[V2 — fuera de corte]** Word/PDF/OCR, catálogo de plantillas de plataforma e IA opcional | FR-048 | 011 | Fuera del alcance del ciclo 007 (Enmienda 002 §10) | ⏳ Pendiente (V2) |

## Criterios de salida del módulo

1. Ciclo completo en vivo: import → revisión → publicación → asignación → captura offline → delta sync → export rellenado + Evidencias (dispositivo y dashboard).
2. Aislamiento de plantillas verificado con 2 tenants (FR-007/009).
3. TSK-FORM-011 verde con libros reales y escenarios de caos; idempotencia sin duplicar (Artículo III).
4. Cada commit referencia su TSK (Artículo II).

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.5 | 2026-10-09 | TSK-FORM-006 → ✅ Hecho (PR #85): UX de importación asistida en 5 pasos (subir → preview → editar con validación Zod en vivo → guardar draft → publicar explícito, nunca automático FR-048), endpoint write de plantillas `POST /templates` (template+draft atómico), `PATCH /templates/revisions/:id` y `POST /templates/revisions/:id/publish` — solo `tenant_admin`, aislamiento RLS; mapper `propuestaADefinicion` en `shared/xlsx` (FR-029/036/039); 19/19 tests shared; issue #39 | Raúl González (con IA) |
| 0.1.4 | 2026-10-08 | TSK-FORM-005 → ✅ Hecho (PR #82): importador `.xlsx` determinístico — escolta ExcelJS normaliza a cuadrícula agnóstica con `ValueType` real (número/fecha/hora/texto) y parser puro propone secciones/ítems con `proposed_schema`, origen hoja+celda (FR-019/044) y autodetección documentada; `npm ci` y 10/10 tests de `shared` verdes; scripts `spike:xlsx` cableados; spike cerrado (enmienda ADR-003, `spike-xlsx-result.md`); issue #38 → revisiones | Raúl González (con IA) |
| 0.1.5 | 2026-10-09 | TSK-FORM-007 → ✅ Hecho (PR #86): API import .xlsx (upload→parse→confirm), TEMPLATE_IMPORT + ATTACHMENT owner_type='template_import', propuesta Zod compartida, parser @terreno/shared/xlsx, migración template_imports + sync ampliado. | Daniel Ávila |
| 0.1.3 | 2026-10-08 | TSK-FORM-004 → ✅ Hecho (PR #80): `INSPECTION_RESPONSE` híbrido `value_json` (JSONB) para date/time/select_single/select_multiple + `ATTACHMENT` de respuesta (`owner_type='response'`); validación server-side (forma 400, tope 16 384 chars); sync wire y frontend (IDB `valueJson`, `guardarFotoRespuesta`/`quitarFotoRespuesta`, migración de fotos legacy); 84/84 tests | Daniel Ávila |
| 0.1.2 | 2026-10-08 | TSK-FORM-001 → ✅ Hecho (PR #79): renderer data-driven en la captura (8 tipos), endpoints de lectura de plantillas con delta `since`, caché Dexie por tenant y seed con definiciones reales; issue #34 cerrado | Daniel Ávila |
| 0.1.1 | 2026-10-08 | Compuerta cerrada: documentación del módulo en `main` (PRs #62–#70) y TSK-FORM-002 → ✅ Hecho (PR #71) · TSK-FORM-003 → ✅ Hecho (PR #74); issues #35/#36 cerrados y tarjetas en Done | Daniel Ávila |
| 0.1.0 | 2026-10-08 | Tasks del módulo 007 (TSK-FORM-001→012) derivadas del plan homónimo y de la Enmienda 002; espejan issues #34–#45 del board | Raúl González (con IA) |