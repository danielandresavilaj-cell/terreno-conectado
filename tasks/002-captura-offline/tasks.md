# TASKS — Módulo 002: Captura offline (PWA)

**Versión:** 0.1.6 · **Fecha:** 2026-11-13 · **Autor:** Raúl González (con IA)
**Padre:** `plans/002-captura-offline/plan.md` · **Spec:** `specs/002-captura-offline/spec.md`
**Issue:** #5 · **Requisitos:** FR-010…FR-019, NFR-01, NFR-02, NFR-07

> **Regla (Artículo II):** cada task referencia al menos un ID de requisito; cada commit referencia al menos un task.

## Contexto

La auditoría del 2026-10-14 sobre `main` encontró que **FR-017 estaba simulado**: `store.tsx` sólo levantaba `cuotaAviso` ante un fallo de sync y la UI pintaba una cuota fija (`seed.ts` → `CUOTA = { usadaPct: 83, fotosPendientes: 14 }`); no existía `navigator.storage.estimate()` en el repo. Este corte lo implementa de verdad (aviso por cuota real + priorización de fotos sincronizables) y lo cubre con pruebas.

## Tareas

| ID | Tarea | Requisito(s) | Depende de | Criterio de aceptación | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| TSK-OFF-001 | Cuota real de almacenamiento: aviso al superar el 80% y priorización de fotos ya sincronizables | FR-017 | — | `estimarCuota` con `navigator.storage.estimate()` (degrada sin dato); `contadorFotosPendientes`; `sincronizables(priorizarFotos)` sube al frente sólo las fotos cuyo dueño no está en cola; `Cola.tsx`/`Shell.tsx` usan el valor real; `frontend/test/cuota.test.ts` verde; spec 002 §2 corregido | ✅ Hecho |
| TSK-OFF-002 | Cámara del dispositivo para evidencia | FR-011, FR-012, FR-037 | — | `Tomar foto` abre `getUserMedia` con cámara trasera preferida, captura un JPEG local y detiene el stream al terminar; selector de archivo sólo como fallback explícito. Cubre fotos de ítems y hallazgos. Issue #150. | ✅ Hecho |
| TSK-OFF-003 | Accesibilidad operable en captura móvil | FR-011, FR-012, FR-036, FR-037, FR-039 | 001, 002 | Los controles dinámicos anuncian su pregunta y estado; el diálogo de cámara gestiona foco, Escape y retorno al activador; la navegación permite saltar al contenido principal, sin red ni dependencias nuevas. Issue #181. | ✅ Hecho |
| TSK-OFF-004 | Instalación PWA y formularios móviles más claros | FR-010, FR-011, NFR-07 | 001, 002 | Acción explícita para instalar cuando exista prompt nativo, ruta manual si no existe; formularios habilitan su validación y no abren teclado al entrar; sin red ni dependencias nuevas. Issue #184. | ✅ Hecho |
| TSK-OFF-005 | Modo claro y oscuro consistente | FR-010, FR-011, NFR-07 | 001, 002 | Botón en barra superior e ingreso; todos los colores desde tokens CSS; contraste AA en ambos temas; sin destello al cargar; elección recordada por dispositivo y funcional offline; sin dependencias nuevas | ✅ Hecho |
| TSK-OFF-006 | Cola de sincronización legible | FR-013, FR-022, FR-024 | 002, 003 | Una tarjeta por inspección/bitácora con estado agregado, avance, resumen, pregunta en vez de ID, motivo del fallo sin UUIDs y acciones; secciones Con problemas / Esperando / Enviado 24 h; contadores en envíos; lista técnica sólo para supervisión/admin; la cola no cambia | ✅ Hecho |
| TSK-OFF-007 | Correcciones de captura (Fase 0 del plan de mejora) | FR-011, FR-013, FR-032, FR-033 | 002, 006 | Un hallazgo se **corrige** conservando su UUID (no se duplica) y un ítem sólo "tiene hallazgo" si el hallazgo existe; la severidad se elige (sin valor por omisión) y alta/crítica exigen descripción; enviar muestra una **confirmación** con el resumen; sin turno escrito a mano en captura ni bitácora, y la bitácora muestra el estado real de envío. `frontend/test/hallazgo.test.ts` verde. | ✅ Hecho |
| TSK-OFF-008 | Botón Atrás del teléfono | FR-010, FR-011 | 004 | Cada cambio de pantalla deja una entrada en el historial (`#pantalla`); Atrás vuelve a la anterior, cierra el panel abierto (hallazgo, cámara, firma) sin cambiar de pantalla y en la primera pantalla avisa antes de salir. Sin dependencias nuevas; funciona sin red. `frontend/test/navegacion.test.ts` verde. | ✅ Hecho |
| TSK-OFF-009 | Lenguaje y legibilidad en terreno | FR-010, FR-011, NFR-07, NFR-10 | 005 | Sin jerga interna en las pantallas de terreno y gerencia; texto secundario ≥ 12 px con contraste ≥ 4,5:1 en ambos temas; borde de campos ≥ 3:1; objetivos táctiles ≥ 44 px en captura, bitácora y navegación; nombre y faena visibles en el teléfono. | ✅ Hecho |

## Criterios de salida del módulo

1. Spec 002 completo y mergeado (Art. II).
2. FR-017 con evidencia automatizada (fila en `test-plan.md` §3).
3. La captura opera 100% sin red y la cola drena al reconectar (E2E, sin cambios).

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.6 | 2026-11-13 | TSK-OFF-007/008/009: Fase 0 de `docs/auditoria-y-plan-de-mejora.md` (correcciones de captura, botón Atrás, lenguaje y legibilidad) | Daniel Ávila (con IA) |
| 0.1.5 | 2026-11-13 | TSK-OFF-006: cola legible | Daniel Ávila (con IA) |
| 0.1.4 | 2026-11-13 | TSK-OFF-005: modo claro y oscuro | Daniel Ávila (con IA) |
| 0.1.3 | 2026-11-12 | TSK-OFF-004 (#184): instalación PWA visible y formularios móviles más claros | Raúl González (con IA) |
| 0.1.2 | 2026-11-12 | TSK-OFF-003 (#181): accesibilidad de controles dinámicos, diálogo de cámara y navegación por teclado | Raúl González (con IA) |
| 0.1.1 | 2026-10-16 | TSK-OFF-002 (#150): cámara con `getUserMedia`, foto JPEG local y fallback de archivo en ítems y hallazgos | Raúl González (con IA) |
| 0.1.0 | 2026-10-14 | Creación: implementación real de FR-017 (TSK-OFF-001) | Daniel Ávila |
