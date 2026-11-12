# TASKS — Operación certificada

**Versión:** 0.1.1 · **Fecha:** 2026-11-12  
**Padre:** `plans/008-operacion-certificada/plan.md` · **Spec:** `specs/004-dominio-inspecciones/spec.md`  
**Issue raíz:** #186 · **Requisitos:** FR-056…061

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-OPS-003-A | Enmienda 007, modelo y plan | FR-056…061 | — | Requisitos, modelo, riesgos, orden y decisiones pendientes versionados; PR aprobado por ambos integrantes | ✅ Hecho (#187, aprobada por Daniel Ávila el 2026-11-12) |
| TSK-OPS-003-B | Firma offline y cofirma | FR-056/057/061 | A | Inspector no puede enviar sin firma; trazo sobrevive offline/recarga y es idempotente; cofirma y RLS se prueban | Pendiente |
| TSK-OPS-003-C | Activos/lugares y QR | FR-060/061 | A | QR opaco y revocable abre sólo plantilla autorizada; cámara y entrada manual; RLS y casos revocados verdes | Pendiente |
| TSK-OPS-003-D | Programar inspecciones | FR-059/061 | A, C | Puntual/diaria/semanal/mensual, zona IANA, una ocurrencia por clave y terminable offline tras sincronizar | Pendiente |
| TSK-OPS-003-E | Outbox y avisos por correo | FR-058/061 | A, D | Un aviso lógico por evento, reintento/auditoría, sin bloquear captura; proveedor/remitente/destinatarios aprobados y secretos fuera de Git | Bloqueada por decisión |

## Regla de inicio

La Enmienda 007 está aprobada (2026-11-12). No se inicia una tarea de código hasta que la tarjeta incluya owner, estimación, dependencias resueltas y criterio verificable (Definition of Ready). La tarea E requiere además proveedor/remitente y destinatarios definidos por el equipo.
