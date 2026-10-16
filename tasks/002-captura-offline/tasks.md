# TASKS — Módulo 002: Captura offline (PWA)

**Versión:** 0.1.0 · **Fecha:** 2026-10-14 · **Autor:** Daniel Ávila
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

## Criterios de salida del módulo

1. Spec 002 completo y mergeado (Art. II).
2. FR-017 con evidencia automatizada (fila en `test-plan.md` §3).
3. La captura opera 100% sin red y la cola drena al reconectar (E2E, sin cambios).

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.1 | 2026-10-16 | TSK-OFF-002 (#150): cámara con `getUserMedia`, foto JPEG local y fallback de archivo en ítems y hallazgos | Raúl González (con IA) |
| 0.1.0 | 2026-10-14 | Creación: implementación real de FR-017 (TSK-OFF-001) | Daniel Ávila |
