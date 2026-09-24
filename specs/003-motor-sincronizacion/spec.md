# SPEC 003 — Motor de sincronización

| | |
| :--- | :--- |
| **Estado** | ESQUELETO (detallar en ciclo del módulo, semanas 5–8) |
| **Autor** | Daniel Ávila |
| **Padre** | specs/000-master/spec.md |
| **Depende de** | 001 (JWT/tenant), 002 (outbox local) |
| **Bloquea a** | 005 (el dashboard solo muestra lo sincronizado) |

> **Corazón del proyecto.** Aquí se juega la promesa central: cero pérdida, cero duplicación (Artículo III de la constitución). Es el módulo con mayor carga de pruebas de caos y adversariales.

## Alcance heredado del spec maestro

Requisitos que este spec detallará: **FR-020 → FR-026** y soporte a **NFR-03, NFR-04**.

- Subida por lotes con orden de dependencias (site → inspection → responses → findings → attachments) (FR-020).
- Idempotencia: upsert por UUIDv7 cliente + `client_version` (FR-021).
- Backoff exponencial 1 s → 5 min sin intervención (FR-022).
- Conflictos: LWW por `captured_at`/`client_version`, ambas versiones conservadas en CONFLICT_RECORD, visible al supervisor (FR-023).
- SYNC_LOG auditable + métrica de latencia `captured_at → synced_at` (FR-024).
- Rechazo de lote completo ante cruce de tenant (FR-025).
- Marcado `synced` y actualización de contador (FR-026).

## Secciones a completar en el ciclo del módulo

- [ ] Contratos de API de ingesta: `POST /api/v1/sync/batch` (request/response, códigos de error parciales)
- [ ] Semántica exacta de upsert + condición de versión (SQL) — ver data-model.md §4.1
- [ ] Algoritmo del worker de cola cliente (concurrencia 1, tamaño de lote, reanudación)
- [ ] Definición determinista de LWW ante `captured_at` iguales (relojes desviados — caso adversarial §5 test-plan)
- [ ] Descarga incremental hacia el cliente (plantillas y datos de referencia para offline)
- [ ] Criterios de aceptación = escenarios de caos 1–7 pasando (test-plan.md §4)
- [ ] Plan técnico → `plans/003-motor-sincronizacion/plan.md`

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Daniel Ávila (con IA) |
