# TASKS — Ajustes desde terreno

**Versión:** 1.2.0 · **Fecha:** 2026-11-15 · **Autor:** Daniel Ávila (con IA)
**Origen:** prueba en terreno con el teléfono (inspección trabada en la cola) · **Requisitos:** FR-005, FR-012, FR-024, FR-056, FR-064, FR-067

> **Regla (Artículo II):** cada task referencia al menos un ID de requisito; cada commit referencia al menos un task.

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-OFF-018 | Firma siempre válida; firma y cámara a pantalla completa; motivo de los envíos rechazados (#239) | FR-056, FR-012, FR-024 | — | La firma sale del teléfono con ≥2 puntos por trazo, ≤32 trazos y ≤1024 puntos, escalada con una sola escala al marco 1000 × 500; las firmas ya encoladas se ajustan al enviar sin cambiar el hash del cierre; firma y cámara ocupan la pantalla completa; el teléfono explica el rechazo sin JSON; `sync_log.error_message` (migración 022) y `GET /api/v1/conflicts/rechazos` muestran el motivo a supervisión con RLS. `frontend/test/firma-cierre.test.ts`, `frontend/test/firma-offline.test.ts` y `backend/test/supervision.spec.ts` verdes | ✅ Hecho (#240) |
| TSK-AUTH-012 | Un bloqueo cumplido reinicia la racha de fallos; el login dice los minutos que faltan | FR-005 | — | Al vencer el bloqueo, un fallo deja el contador en 1 y no vuelve a bloquear; el `423` trae `minutos` y el teléfono los muestra. `backend/test/auth.spec.ts` y `frontend/test/bloqueo.test.ts` verdes | ✅ Hecho (#248) |
| TSK-DOM-008 | "Hallazgos": el responsable ve sus hallazgos, los empieza y reporta lo que hizo; supervisión cierra | FR-067, FR-064 | — | Migración 023; `GET /findings/asignados` (sólo los propios, RLS) y `PATCH /findings/:id/avance` (iniciar o reportar con nota; ajeno o resuelto → 404; auditado); pestaña con aviso de nuevos y aviso en Formularios; lista legible sin señal y borrador del reporte; Gerencia muestra "Listo para revisar". `backend/test/hallazgos-asignados.spec.ts`, `frontend/test/hallazgos-asignados.test.ts` y E2E verdes | En curso |

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-11-15 | Creación con TSK-OFF-018 | Daniel Ávila (con IA) |
| 1.0.1 | 2026-11-15 | TSK-OFF-018 hecha: PR #240 mergeado con CI y E2E verdes, desplegado | Daniel Ávila (con IA) |
| 1.1.0 | 2026-11-15 | Se agrega TSK-AUTH-012 (bloqueo de login) | Daniel Ávila (con IA) |
| 1.2.0 | 2026-11-15 | TSK-AUTH-012 hecha (#248); se agrega TSK-DOM-008 (Hallazgos del responsable) | Daniel Ávila (con IA) |
