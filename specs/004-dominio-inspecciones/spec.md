# SPEC 004 — Dominio inspecciones

| | |
| :--- | :--- |
| **Estado** | ESQUELETO (detallar en ciclo del módulo, semanas 5–8) |
| **Autor** | Daniel Ávila |
| **Padre** | specs/000-master/spec.md |
| **Depende de** | 001 (roles/tenant) |
| **Bloquea a** | 002 (formularios renderizan plantillas), 005 (reportes consumen dominio) |

## Alcance heredado del spec maestro

Requisitos que este spec detallará: **FR-030 → FR-035** y las entidades de dominio de data-model.md §2.2.

- Plantillas de inspección versionadas: secciones, ítems, tipos de respuesta (ok/nok/na, texto, numérico, foto), reglas (hallazgo obligatorio en `nok`).
- Ciclo de vida de inspección: `draft → in_progress → submitted → reviewed` (FR-031).
- Hallazgos: severidad (baja/media/alta/crítica), estado (open/in_progress/resolved), evidencia fotográfica (FR-032).
- Bitácoras de turno: entradas cronológicas con autor, tags, faena (FR-033).
- Asociación a faena + geolocalización opcional (FR-034).
- Destacado inmediato de hallazgos altos/críticos al sincronizar (FR-035).

## Secciones a completar en el ciclo del módulo

- [ ] Editor de plantillas (tenant_admin): UX de secciones/ítems y versionado (¿qué pasa con inspecciones en curso al versionar?)
- [ ] Reglas de validación por tipo de respuesta (rangos numéricos, foto obligatoria)
- [ ] Contratos de API de dominio (CRUD plantillas, lectura de inspecciones/hallazgos/bitácoras)
- [ ] Semillas demo realistas (minería + construcción, es-CL) — data-model.md §5
- [ ] Criterios de aceptación y pruebas (test-plan.md §3: FR-031/032)
- [ ] Plan técnico → `plans/004-dominio-inspecciones/plan.md`

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Daniel Ávila (con IA) |
