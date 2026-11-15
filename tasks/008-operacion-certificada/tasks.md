# TASKS — Operación certificada

**Versión:** 0.1.4 · **Fecha:** 2026-11-12 · actualizado 2026-11-15
**Padre:** `plans/008-operacion-certificada/plan.md` · **Spec:** `specs/004-dominio-inspecciones/spec.md`  
**Issue raíz:** #186 · **Requisitos:** FR-056…061

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-OPS-003-A | Enmienda 007, modelo y plan | FR-056…061 | — | Requisitos, modelo, riesgos, orden y decisiones pendientes versionados; PR aprobado por ambos integrantes | ✅ Hecho (#187, aprobada por Daniel Ávila el 2026-11-12) |
| TSK-OPS-003-B | Firma offline y cofirma | FR-056/057/061 | A | Inspector no puede enviar sin firma; trazo sobrevive offline/recarga y es idempotente; cofirma y RLS se prueban | En revisión (#191): cobertura completa; cierre a decisión de Raúl |
| TSK-OPS-003-C | Activos/lugares y QR | FR-060/061 | A | QR opaco y revocable abre sólo plantilla autorizada; cámara y entrada manual; RLS y casos revocados verdes | 🔄 En curso — tramo 1 de 3 (servidor y pantalla Activos) |
| TSK-OPS-003-D | Programar inspecciones | FR-059/061 | A, C | Puntual/diaria/semanal/mensual, zona IANA, una ocurrencia por clave y terminable offline tras sincronizar | Pendiente |
| TSK-OPS-003-E | Outbox y avisos por correo | FR-058/061 | A, D | Un aviso lógico por evento, reintento/auditoría, sin bloquear captura; proveedor/remitente/destinatarios aprobados y secretos fuera de Git | Bloqueada por decisión |

## Regla de inicio

La Enmienda 007 está aprobada (2026-11-12). No se inicia una tarea de código hasta que la tarjeta incluya owner, estimación, dependencias resueltas y criterio verificable (Definition of Ready). La tarea E requiere además proveedor/remitente y destinatarios definidos por el equipo.

## Estado de TSK-OPS-003-B

La implementación está en revisión en #191: migración 019, cola offline de firma del inspector, validación de cierre, cofirma de supervisión y evidencia en el detalle. El test unitario del pad está verde; la prueba de integración de cofirma quedó incorporada, pero se ejecutará con Docker en CI o en una máquina donde el equipo decida encenderlo. E2E de recarga/sin red y caos de reintento siguen pendientes de esta tarjeta.

**Actualización 2026-11-15 (Daniel Ávila, con IA):** la cobertura pendiente está hecha. `frontend/e2e/specs/e2e-firma-offline.spec.ts` prueba en Chromium móvil la firma sin red con recarga, el caos 12 (la respuesta del lote se corta y el reintento no duplica la firma ni la auditoría) y la cofirma en la UI (sin cofirma no se puede revisar). `backend/test/supervision.spec.ts` suma idempotencia de firma y cofirma, segunda firma del mismo rol, trabajador que intenta cofirmar y cofirma de otra empresa. Todo verde en local (backend) y en el E2E de CI sobre la rama. La tarjeta es de Raúl: él decide el cierre.

## Estado de TSK-OPS-003-C (Daniel Ávila, con IA)

Se construye en tres tramos desplegables:

1. **Servidor y administración (hecho en este PR):** migración 026 (`asset` con RLS), `/api/v1/assets` (crear, listar, regenerar, revocar/reactivar; sólo `tenant_admin`, auditado) y `GET /api/v1/assets/resolver/:hash` (asignación por faena y rol, faenas de la cuenta; todo lo demás 404). Pantalla "Activos" en administración; el código `tc1:…` se muestra una vez para copiarlo. Pruebas: `backend/test/assets.spec.ts` y `shared/src/assets.test.ts`.
2. **Resolución sin señal:** caché de activos de las faenas del teléfono (hash incluido) e `inspection.asset_id`. Un QR revocado sigue abriendo sin señal hasta sincronizar (aceptado por Daniel Ávila, 2026-11-15).
3. **Lector con cámara, entrada manual e impresión del QR:** bibliotecas evaluadas en `research.md` antes de instalarlas (Art. V).
