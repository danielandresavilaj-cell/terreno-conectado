# SPEC 004 — Dominio inspecciones

| | |
| :--- | :--- |
| **Estado** | ESQUELETO (detallar en ciclo del módulo, semanas 5–8) |
| **Autor** | Daniel Ávila |
| **Padre** | specs/000-master/spec.md |
| **Depende de** | 001 (roles/tenant) |
| **Bloquea a** | 002 (formularios renderizan plantillas), 005 (reportes consumen dominio) |

## Alcance heredado del spec maestro

Requisitos que este spec detallará: **FR-030 → FR-039** y las entidades de dominio de data-model.md §2.2.

- Plantillas de inspección **versionadas e inmutables** (`TEMPLATE_REVISION`: draft → published → archived): secciones, ítems con `props` JSONB y **8 tipos de respuesta V1** (ok/nok/na, texto, numérico, fecha, hora, selección única, selección múltiple, foto) + reglas (hallazgo obligatorio en `nok`) — FR-036.
- Ciclo de vida de inspección: `draft → in_progress → submitted → reviewed` (FR-031).
- Hallazgos: severidad (baja/media/alta/crítica), estado (open/in_progress/resolved), evidencia fotográfica (FR-032).
- Bitácoras de turno: entradas cronológicas con autor, tags, faena (FR-033).
- Asociación a faena + geolocalización opcional (FR-034).
- Destacado inmediato de hallazgos altos/críticos al sincronizar (FR-035).
- Respuestas dinámicas por ítem: `value_json` validado contra `TEMPLATE_ITEM.props` en el dispositivo antes de encolar (FR-036/039).
- Foto de ítem asociada a la **respuesta** (`ATTACHMENT.owner_type = response`, FR-037).
- **Versión congelada** por inspección (`template_revision_id`), conservada en historial para reproductibilidad (FR-038).
- Import de plantillas desde `.xlsx` con revisión humana (`TEMPLATE_IMPORT`: uploaded → parsed → proposed → confirmed/failed) y asignación de revisiones publicadas por faena/rol (`TEMPLATE_ASSIGNMENT`) — referencia spec 007, FR-008/009/029.

## Secciones a completar en el ciclo del módulo

- [ ] Editor de plantillas (tenant_admin): UX de secciones/ítems y versionado — respuesta a "¿qué pasa con inspecciones en curso?": versión congelada (FR-028/038), mapeo ítem→respuesta por `template_item_id`
- [ ] Import `.xlsx`: estados `TEMPLATE_IMPORT`, convención de columnas, propuesta de mapeo y revisión humana antes de publicar (solo backend, FR-048) — detalle en spec 007
- [ ] Reglas de validación por tipo de respuesta (rangos numéricos, foto obligatoria)
- [ ] Contratos de API de dominio (CRUD plantillas, lectura de inspecciones/hallazgos/bitácoras)
- [ ] Semillas demo realistas (minería + construcción, es-CL) — data-model.md §5
- [ ] Criterios de aceptación y pruebas (test-plan.md §3: FR-031/032)
- [ ] Plan técnico → `plans/004-dominio-inspecciones/plan.md`

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.2.0 | 2026-10-07 | **Módulo 007 (Enmienda 002):** alcance +FR-036–039; plantillas por `TEMPLATE_REVISION` inmutable; 8 `response_type` + `props` JSONB; `value_json` validado; foto asociada a la respuesta; versión congelada por inspección | Raúl González (con IA) |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Daniel Ávila (con IA) |
