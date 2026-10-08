# PLAN — Módulo 007: Formularios dinámicos desde documentos

**Versión:** 0.1.0 · **Fecha:** 2026-10-08 · **Autor:** Raúl González (con IA)
**Derivado de:** `specs/000-master/spec.md` §4/§5/§10 (Enmienda 002) · **Relacionado:** ADR-003, `data-model.md` v1.1.0, specs 002/003/004 (0.2.0/0.3.0), spec `007-formularios-dinamicos` (por crear)
**Tareas:** `tasks/007-formularios-dinamicos/tasks.md` (TSK-FORM-001 → 012)
**Arranque:** condicionado al merge de la compuerta (PRs #63–#66); este plan y sus tasks se entregan **antes** de codificar (Artículo II)

> **Qué es este módulo:** transformar documentos `.xlsx` estructurados en **plantillas versionadas con revisión humana obligatoria**, que el `field_worker` captura **offline y data-driven** (8 tipos de campo, FR-036) y puede exportar como **el Excel original rellenado + hoja Evidencias** — tanto en el dispositivo (FR-019) como desde el dashboard del supervisor (FR-044–046). El OCR/docx/PDF/IA queda en V2 opcional (Enmienda 002 §10).

## 1. Objetivo

Dejar operativo el ciclo completo del módulo 007: `tenant_admin` importa un `.xlsx` → revisa la propuesta (`TEMPLATE_IMPORT: uploaded → parsed → proposed → confirmed`) → publica una `TEMPLATE_REVISION` inmutable → la asigna a faena/rol → el worker la descarga por delta en su caché y captura sin red → sincroniza respuestas idempotentes → exporta el `.xlsx` rellenado + Evidencias en el dispositivo, y el supervisor descarga el mismo artefacto por lote desde el dashboard. Con aislamiento por tenant verificado en vivo.

## 2. Orden de construcción (no es el orden de los números — es el orden de dependencias)

```
TSK-FORM-002 persistencia+RLS ──► TSK-FORM-003 tipos+Zod ──► TSK-FORM-001 renderer
        │                                                        │
        └───────────── TSK-FORM-008 asignación faena/rol          │
                                                                  ▼
TSK-FORM-005 import .xlsx (spike escolta) ──► TSK-FORM-006 UX import / TSK-FORM-007 TEMPLATE_IMPORT
        │
        ├────► TSK-FORM-004 responses híbridas + ATTACHMENT de respuesta
        └────► TSK-FORM-010 export rellenado en dispositivo
                                                                  
TSK-FORM-009 delta sync + caché local ◄── TSK-FORM-001/008
                        │
                        ▼
TSK-FORM-011 pruebas integrales (libros reales, caos) · TSK-FORM-012 [V2, fuera de corte]
```

1. **TSK-FORM-002 → TSK-FORM-003** — primero la persistencia (revisiones inmutables con RLS, patrón TSK-WS-002: migración + test de aislamiento desde el día 1) y el contrato de tipos compartido (Zod en `shared/`, ADR-003). Nada de UI antes de saber que los datos están aislados (Artículo IV).
2. **TSK-FORM-001** — el renderer data-driven (ADR-003 d2): la captura dibuja desde `definition` JSONB; cada `response_type` es un componente acotado (8 tipos).
3. **TSK-FORM-004** — las respuestas: `INSPECTION_RESPONSE` híbrido (`value_*` + `value_json`) y foto asociada a la respuesta (FR-037).
4. **TSK-FORM-005 → TSK-FORM-006/007** — el import: primero el **spike de la escolta de xlsx** (decisión 3.2), luego parser → propuesta → UX de revisión → `TEMPLATE_IMPORT` persistido con el documento fuente y auditoría (FR-047).
5. **TSK-FORM-008 y TSK-FORM-009** — la asignación faena/rol y el delta de sync (`GET /api/v1/templates?since=`, FR-027) que llena la caché offline (FR-018).
6. **TSK-FORM-010** — el export en dispositivo (FR-019) reutilizando la escolta decidida en 3.2; el servidor produce el mismo artefacto para supervisor/lotes (FR-044–046).
7. **TSK-FORM-011** — pruebas integrales con libros reales y caos; **TSK-FORM-012** es V2 y queda fuera del corte (FR-048).

## 3. Decisiones técnicas previas (se cierran antes de codificar — Artículo II)

1. **Formato interno y validación:** plantilla = JSON validado con **Zod** en `shared/` (única fuente de verdad, frontend/backend); `props` de cada ítem define opciones/validación (ADR-003 d1/d2).
2. **PENDIENTE — spike escolta de xlsx (ADR-003 d4):** **ExcelJS vs SheetJS CE** — probar ambas con un libro real antes de TSK-FORM-005/010. Criterios: **bundle ≤ ~500 KB**, fidelidad de estilos al rellenar el original, ejecución en worker/offline, licencia CE compatible. Resultado = enmienda a ADR-003 y elección fija para import y export.
3. **Renderer data-driven:** contrato `definition` JSONB ↔ componente por `response_type`; validación Zod **antes de encolar** (FR-039); borrador autoguardado por ítem (patrón TSK-WS-005).
4. **Versionado inmutable:** `TEMPLATE_REVISION` `draft → published → archived` (FR-049); toda inspección congela su `template_revision_id` (FR-028/038); el cliente sincroniza por delta `since=<template_version>` (FR-027).
5. **Revisión humana siempre:** el import nunca publica automático; con flag `ai` activo el backend solo *propone* el mapeo (FR-048), el `tenant_admin` confirma.

## 4. Riesgos y mitigaciones

| Riesgo | Prob. | Mitigación |
| :--- | :---: | :--- |
| Renderer propio = más código a mantener | Media | Acotado a 8 tipos + contrato Zod; componentes por tipo pequeños en `shared/` |
| Fidelidad de estilos del `.xlsx` rellenado limitada | Media | Artefacto válido con estilos mínimos + hoja Evidencias; evolución documentada (ADR-003) |
| Libros reales de cliente inconsistentes rompen el parser | Alta | Convención de columnas documentada en spec 007 + preview + confirmación humana (FR-029); pruebas con libros reales desde TSK-FORM-005 |
| Aislamiento RLS de plantillas roto entre tenants | Baja | Test de aislamiento desde TSK-FORM-002 (patrón TSK-WS-002) |
| Codificar sobre docs sin mergear (gate abierto) | — | **Arranque condicionado**: TSK-FORM-001+ recién tras merge de PRs #63–66 |

## 5. Definición de "hecho" para el módulo

- Ciclo completo en vivo: import `.xlsx` → revisión → publicación → asignación faena/rol → captura offline → delta sync → export rellenado + Evidencias (dispositivo y dashboard).
- Aislamiento de plantillas verificado con 2 tenants (FR-007/009).
- TSK-FORM-011 verde: libros reales, corte a mitad de delta, doble import, edición concurrente de revisión — cero duplicación e idempotencia (Artículo III).
- Toda tarea referencia su FR (Artículo II) y los commits referencian TSK.

## 6. Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-10-08 | Plan inicial del módulo 007 (formularios dinámicos) derivado de la Enmienda 002, ADR-003 y data-model v1.1.0 | Raúl González (con IA) |