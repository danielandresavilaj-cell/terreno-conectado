# SPEC 002 — Captura offline (PWA)

| | |
| :--- | :--- |
| **Estado** | ESQUELETO (detallar en ciclo del módulo, semanas 5–8) |
| **Autor** | Daniel Ávila |
| **Padre** | specs/000-master/spec.md |
| **Depende de** | 001 (sesión/tenant), 004 (plantillas a renderizar offline) |
| **Bloquea a** | 003 (sin outbox local no hay sync) |

## Alcance heredado del spec maestro

Requisitos que este spec detallará: **FR-010 → FR-019** y soporte a **NFR-01, NFR-02, NFR-07**.

- PWA instalable (manifest + Workbox): precache del shell, funcionamiento total sin red tras primera carga.
- Formularios offline de inspección/hallazgo/bitácora → Dexie (IndexedDB), transaccional.
- Fotos comprimidas en cliente (≤1280 px, q0.7) con feature flag (FR-012).
- Estados del outbox visibles: pending/syncing/synced/failed + contador (FR-013).
- Persistencia a cerrar/reabrir/reiniciar (FR-014); UUIDv7 cliente (FR-015).
- Disparo automático en evento `online` (FR-016); aviso de cuota al 80% (FR-017).
- Caché local de plantillas **publicadas y asignadas** al trabajador (`templates_cache`, revisiones versionadas): render y captura 100% offline (FR-018, módulo 007).
- Export en el dispositivo del `.xlsx` original rellenado + hoja "Evidencias" con los adjuntos, sin depender del servidor (FR-019, módulo 007 — generador compartido con el backend, ADR-003).

## Secciones a completar en el ciclo del módulo

- [ ] Diseño del esquema Dexie (stores, claves, índices) — alineado con data-model.md §2.4
- [ ] UX de captura con guantes/luz solar: targets táctiles, contraste, autoguardado de borrador
- [ ] Estrategia de cache Workbox (shell precache, plantillas cache-first, API network-first)
- [ ] Diseño de `templates_cache` (revisiones publicadas asignadas por faena/rol, ordenadas por `template_version` para el delta — FR-018/027; data-model.md §2.4)
- [ ] Export `.xlsx` en dispositivo: rellenar el original + hoja Evidencias, módulo compartido (ADR-003, decisión 5)
- [ ] Compresión de imagen (canvas) y almacenamiento de blobs en IndexedDB
- [ ] Criterios de aceptación y pruebas de caos asociadas (test-plan.md §4.1/4.4)
- [ ] Plan técnico → `plans/002-captura-offline/plan.md`

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.2.0 | 2026-10-07 | **Módulo 007 (Enmienda 002):** alcance +FR-018 (caché de plantillas publicadas asignadas) y +FR-019 (export `.xlsx` rellenado + hoja Evidencias en el dispositivo) | Raúl González (con IA) |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Daniel Ávila (con IA) |
