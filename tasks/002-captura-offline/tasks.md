# TASKS — Módulo 002: Captura offline (PWA)

**Versión:** 0.1.10 · **Fecha:** 2026-11-13 · **Autor:** Raúl González (con IA)
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
| TSK-OFF-010 | Elegir la faena al inspeccionar | FR-034, FR-009, FR-018 | 007 | Con más de una faena en la empresa, la persona elige en cuál está: la sesión arranca en la faena de la inspección en curso, o en la última elegida en ese equipo, o en la primera (y entonces pide elegir). Cambiar de faena cambia los formularios disponibles y la faena de la próxima inspección; no se puede con una inspección sin enviar. Los formularios de las otras faenas se guardan en el equipo mientras hay señal, para poder cambiar sin conexión. `frontend/test/faena.test.ts` verde. | ✅ Hecho |
| TSK-OFF-011 | Terreno en el teléfono: navegación al pulgar, foto visible y tema del sistema | FR-010, FR-011, FR-012, NFR-07 | 008, 009 | En el teléfono, con 5 secciones o menos (trabajador), la navegación va abajo y el estado de señal y la cuenta quedan en la barra superior; el ítem foto muestra la miniatura con Repetir y Quitar; sin elección guardada el tema sigue al del sistema. `tema.test.ts` cubre `temaInicial`; E2E de captura sin cambios de flujo. | ✅ Hecho |
| TSK-OFF-012 | Hallazgo opcional en cualquier NOK | FR-032 | 007 | Todo NOK ofrece "Registrar hallazgo (opcional)"; con `require_finding_on_nok` sigue siendo obligatorio y bloquea el envío. Sin cambios de sync ni de servidor. | ✅ Hecho |
| TSK-OFF-013 | Historial propio de envíos (30 días) | FR-013, FR-014 | 006 | Cola muestra, además de lo enviado en 24 h, lo enviado hace 1 a 30 días desde este teléfono, con el mismo detalle por tarjeta. `cola-vista.test.ts` lo cubre. | ✅ Hecho |

## Criterios de salida del módulo

1. Spec 002 completo y mergeado (Art. II).
2. FR-017 con evidencia automatizada (fila en `test-plan.md` §3).
3. La captura opera 100% sin red y la cola drena al reconectar (E2E, sin cambios).

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.10 | 2026-11-13 | TSK-OFF-013: historial de envíos de 30 días en Cola | Daniel Ávila (con IA) |
| 0.1.9 | 2026-11-13 | TSK-OFF-012: hallazgo opcional en cualquier NOK | Daniel Ávila (con IA) |
| 0.1.8 | 2026-11-13 | TSK-OFF-011: navegación inferior en el teléfono, miniatura de la foto del ítem y tema del sistema | Daniel Ávila (con IA) |
| 0.1.7 | 2026-11-13 | TSK-OFF-010: elegir la faena al inspeccionar (antes siempre la primera de la empresa) | Daniel Ávila (con IA) |
| 0.1.6 | 2026-11-13 | TSK-OFF-007/008/009: Fase 0 de `docs/auditoria-y-plan-de-mejora.md` (correcciones de captura, botón Atrás, lenguaje y legibilidad) | Daniel Ávila (con IA) |
| 0.1.5 | 2026-11-13 | TSK-OFF-006: cola legible | Daniel Ávila (con IA) |
| 0.1.4 | 2026-11-13 | TSK-OFF-005: modo claro y oscuro | Daniel Ávila (con IA) |
| 0.1.3 | 2026-11-12 | TSK-OFF-004 (#184): instalación PWA visible y formularios móviles más claros | Raúl González (con IA) |
| 0.1.2 | 2026-11-12 | TSK-OFF-003 (#181): accesibilidad de controles dinámicos, diálogo de cámara y navegación por teclado | Raúl González (con IA) |
| 0.1.1 | 2026-10-16 | TSK-OFF-002 (#150): cámara con `getUserMedia`, foto JPEG local y fallback de archivo en ítems y hallazgos | Raúl González (con IA) |
| 0.1.0 | 2026-10-14 | Creación: implementación real de FR-017 (TSK-OFF-001) | Daniel Ávila |
