# SPEC 007 — Formularios dinámicos desde documentos

| | |
| :--- | :--- |
| **Estado** | ESQUELETO (detallar en el ciclo del módulo 007, issues #34–#45) |
| **Autor** | Raúl González (con IA) |
| **Padre** | specs/000-master/spec.md v1.1.0 (Enmienda 002) |
| **Depende de** | 001 (roles/tenant), 004 (dominio inspecciones), ADR-003, data-model.md v1.1.0 |
| **Bloquea a** | 005 (reportes por lote consumen export de plantillas) |

> **Nota de desbloqueo:** este spec detalla FR que ya viven en `main` — la **Enmienda 002 (PR #63)** y toda la documentación del módulo (#62, #64, #65, #67–#70) se mergearon el **2026-10-08**. El plan técnico y las tasks están en `plans/007-formularios-dinamicos/` y `tasks/007-formularios-dinamicos/` (TSK-FORM-001→012; 001/002/003 ya completados vía PRs #79/#71/#74).

## Alcance heredado del spec maestro

Requisitos que este spec detallará: **FR-007–009, 018–019, 027–029, 036–039, 044–049** y las entidades `TEMPLATE_*` de data-model.md v1.1.0.

- Plantillas versionadas e inmutables: `TEMPLATE_REVISION` `draft → published → archived`, aisladas por tenant con RLS (FR-007, FR-049).
- Asignación de plantillas publicadas a combinaciones faena + rol; el worker solo ve las suyas (FR-008, FR-009).
- Caché local de plantillas para captura 100% offline (FR-018) y sincronización por delta `GET /api/v1/templates?since=` (FR-027).
- Congelado de `template_version` por inspección: no re-encuadre ni re-validación al cambiar la plantilla (FR-028, FR-038).
- Importación asistida de `.xlsx` estructurado con revisión humana obligatoria `TEMPLATE_IMPORT` y sincronización idempotente por batch (FR-029).
- Respuestas dinámicas por ítem con `value_json` para los 8 tipos de campo de V1 (FR-036) y validación Zod antes de encolar (FR-039).
- Foto de ítem comprimida (FR-012) asociada a la respuesta vía `ATTACHMENT` (FR-037).
- Exportación del `.xlsx` original rellenado + hoja "Evidencias": en dispositivo (FR-019), en servidor para el supervisor (FR-044) y por lote del período (FR-045, FR-046).
- Auditoría de imports confirmados y exportaciones por lote (FR-047); mapeo IA **solo propuesta** tras flag `ai` off por defecto (FR-048).

## Decisiones rectoras (cerradas en ADR-003 + plan 007; no reabrir sin ADR nuevo)

1. **xlsx-first:** V1 = import/export de `.xlsx` estructurado; OCR/docx/PDF e IA quedan en V2 opcional (Enmienda 002 §10).
2. **Revisión humana obligatoria:** el import nunca publica automático; el `tenant_admin` confirma la propuesta.
3. **Renderer data-driven:** la captura dibuja desde `definition` JSONB; contrato de tipos y `props` validado con **Zod en `shared/`** (única fuente: frontend y backend).
4. **Versionado inmutable:** toda inspección congela `template_revision_id`; cambios requieren nueva revisión.
5. **Escolta de xlsx (ExcelJS vs SheetJS CE):** PENDIENTE — decisión 3.2 del plan 007, cierra antes de TSK-FORM-005/010.

## Secciones a completar en el ciclo del módulo

- [x] Contrato de 8 tipos de campo + `props` + validación Zod (FR-036, FR-039) → TSK-FORM-003 (PR #74)
- [x] `TEMPLATE_REVISION` + estados inmutables + RLS multi-tenant con test de aislamiento (FR-007, FR-049) → TSK-FORM-002 (PR #71)
- [x] Renderer data-driven en la captura (FR-036) → TSK-FORM-001 (PR #79)
- [x] `INSPECTION_RESPONSE` híbrido (`value_*` + `value_json`) + `ATTACHMENT` de respuesta (FR-037, FR-038) → TSK-FORM-004 (PR #80)
- [ ] **Spike escolta xlsx** (ExcelJS vs SheetJS CE; criterios: bundle ≤ ~500 KB, fidelidad de estilos, worker/offline, licencia CE) → cierra 3.2 + enmienda ADR-003
- [ ] Importador `.xlsx`: convención de columnas/secciones/ítems y celda destino, parser → propuesta (FR-029) → TSK-FORM-005
- [ ] UX de importación asistida: preview, edición, confirmación, publicar; flag `ai` propone el mapeo (FR-048) → TSK-FORM-006
- [ ] `TEMPLATE_IMPORT` persistido con documento fuente y auditoría (FR-029, FR-047) → TSK-FORM-007
- [ ] Asignación faena/rol + filtrado y búsqueda en cliente (FR-008, FR-009) → TSK-FORM-008
- [ ] Delta sync + caché local + congelado de versión en inspecciones en curso (FR-018, FR-027, FR-028) → TSK-FORM-009
- [ ] Export en dispositivo y en servidor: `.xlsx` rellenado + hoja "Evidencias"; lote del período (FR-019, FR-044–046) → TSK-FORM-010
- [ ] Criterios de aceptación y pruebas con libros reales y caos — ampliar test-plan.md §3 con FR-036/039/049 → TSK-FORM-011
- [ ] Plan técnico → `plans/007-formularios-dinamicos/plan.md` (✅ subido, PR #67)
- [ ] V2 (fuera de V1): Word/PDF/OCR de formularios de papel, catálogo de plantillas de plataforma, analítica con IA (FR-048)

## Criterios de aceptación del módulo (resumen)

1. Import `.xlsx` → revisión humana → publicación → asignación faena/rol → captura offline → delta sync → export rellenado + Evidencias, en vivo.
2. Aislamiento de plantillas verificado con 2 tenants (FR-007/009).
3. Respuesta inválida rechazada en el dispositivo antes de encolar (FR-039); versión congelada en inspección en curso (FR-028).
4. Reintento de import sincronizado no duplica (FR-029, Artículo III).

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.3 | 2026-10-08 | Checklist: TSK-FORM-004 completado (PR #80): respuesta híbrida `value_json` + ATTACHMENT de respuesta; sección FR-037/FR-038 marcada | Daniel Ávila |
| 0.1.2 | 2026-10-08 | Checklist: TSK-FORM-001 renderer data-driven completado (PR #79); se marcan también 002/003 (PRs #71/#74) | Daniel Ávila |
| 0.1.1 | 2026-10-08 | Nota de desbloqueo actualizada: Enmienda 002 y docs del módulo en `main` (PRs #62–#70); TSK-FORM-002/003 completados (PRs #71/#74) | Daniel Ávila |
| 0.1.0 | 2026-10-08 | Esqueleto inicial del spec 007 desde la Enmienda 002, ADR-003 y data-model v1.1.0; espeja TSK-FORM-001→012 | Raúl González (con IA) |