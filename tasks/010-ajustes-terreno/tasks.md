# TASKS — Ajustes desde terreno

**Versión:** 1.0.0 · **Fecha:** 2026-11-15 · **Autor:** Daniel Ávila (con IA)
**Origen:** prueba en terreno con el teléfono (inspección trabada en la cola) · **Requisitos:** FR-012, FR-024, FR-056

> **Regla (Artículo II):** cada task referencia al menos un ID de requisito; cada commit referencia al menos un task.

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-OFF-018 | Firma siempre válida; firma y cámara a pantalla completa; motivo de los envíos rechazados (#239) | FR-056, FR-012, FR-024 | — | La firma sale del teléfono con ≥2 puntos por trazo, ≤32 trazos y ≤1024 puntos, escalada con una sola escala al marco 1000 × 500; las firmas ya encoladas se ajustan al enviar sin cambiar el hash del cierre; firma y cámara ocupan la pantalla completa; el teléfono explica el rechazo sin JSON; `sync_log.error_message` (migración 022) y `GET /api/v1/conflicts/rechazos` muestran el motivo a supervisión con RLS. `frontend/test/firma-cierre.test.ts`, `frontend/test/firma-offline.test.ts` y `backend/test/supervision.spec.ts` verdes | 🟡 En revisión |

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-11-15 | Creación con TSK-OFF-018 | Daniel Ávila (con IA) |
