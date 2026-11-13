# TASKS — Operación certificada

**Versión:** 0.1.2 · **Fecha:** 2026-11-12
**Padre:** `plans/008-operacion-certificada/plan.md` · **Spec:** `specs/004-dominio-inspecciones/spec.md`  
**Issue raíz:** #186 · **Requisitos:** FR-056…061

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-OPS-003-A | Enmienda 007, modelo y plan | FR-056…061 | — | Requisitos, modelo, riesgos, orden y decisiones pendientes versionados; PR aprobado por ambos integrantes | ✅ Hecho (#187, aprobada por Daniel Ávila el 2026-11-12) |
| TSK-OPS-003-B | Firma offline y cofirma | FR-056/057/061 | A | Inspector no puede enviar sin firma; trazo sobrevive offline/recarga y es idempotente; cofirma y RLS se prueban | En revisión (#191) |
| TSK-OPS-003-C | Activos/lugares y QR | FR-060/061 | A | QR opaco y revocable abre sólo plantilla autorizada; cámara y entrada manual; RLS y casos revocados verdes | Pendiente |
| TSK-OPS-003-D | Programar inspecciones | FR-059/061 | A, C | Puntual/diaria/semanal/mensual, zona IANA, una ocurrencia por clave y terminable offline tras sincronizar | Pendiente |
| TSK-OPS-003-E | Outbox y avisos por correo | FR-058/061 | A, D | Un aviso lógico por evento, reintento/auditoría, sin bloquear captura; proveedor/remitente/destinatarios aprobados y secretos fuera de Git | Bloqueada por decisión |

## Regla de inicio

La Enmienda 007 está aprobada (2026-11-12). No se inicia una tarea de código hasta que la tarjeta incluya owner, estimación, dependencias resueltas y criterio verificable (Definition of Ready). La tarea E requiere además proveedor/remitente y destinatarios definidos por el equipo.

## Estado de TSK-OPS-003-B

La implementación está en revisión en #191: migración 019, cola offline de firma del inspector, validación de cierre, cofirma de supervisión y evidencia en el detalle. El test unitario del pad está verde; la prueba de integración de cofirma quedó incorporada, pero se ejecutará con Docker en CI o en una máquina donde el equipo decida encenderlo. E2E de recarga/sin red y caos de reintento siguen pendientes de esta tarjeta.
