# PLAN — Módulo 002: Captura offline (PWA)

**Versión:** 0.1.0 · **Fecha:** 2026-10-13 · **Autor:** Daniel Ávila
**Derivado de:** `specs/000-master/spec.md` §5.2 · **Spec:** `specs/002-captura-offline/spec.md` (0.3.0)
**Issue:** #5 · **Requisitos:** FR-010…FR-019 · **NFR:** NFR-01, NFR-02, NFR-07

> **Qué es este módulo:** la PWA que permite capturar en terreno sin señal (Art. I de la constitución). Formularios data-driven, fotos comprimidas, cola de subida local y export del documento en el propio dispositivo.

## 1. Objetivo

Dejar documentado y verificado el módulo 002: spec de ESQUELETO a COMPLETO y evidencia de que la captura opera 100% sin red. **La auditoría del 2026-10-13 confirma FR-010…019 implementados** (walking skeleton + módulo 007); el ciclo es de **cierre documental**, no de construcción.

## 2. Orden

1. **Spec 002 completo** — esquema Dexie, UX de captura, cache Workbox, caché de plantillas y export offline.
2. **Evidencia** (ya en `test-plan.md` §3): captura en modo avión, compresión de foto, render sin red, drenado automático al reconectar.
3. **NFR-07** queda fuera de este plan (herramienta externa; track 006).

## 3. Decisiones registradas

1. **Esquema local por versiones** (Dexie v1→v3): outbox/captura → caché de plantillas → originales `.xlsx`.
2. **Cursor de plantillas por tenant** en `meta` (no global): un dispositivo compartido cambia de sesión.
3. **Originales con presupuesto**: se bajan de a poco y se purgan por presupuesto, priorizando la revisión congelada del borrador (FR-018/019).
4. **Export compartido** con el backend (ADR-003): mismo generador de `.xlsx` rellenado + hoja Evidencias.

## 4. Riesgos

| Riesgo | Prob. | Mitigación |
| :--- | :--- | :--- |
| Cuota de IndexedDB llena con fotos | Media | Aviso al 80% (FR-017) + purga por presupuesto (FR-018) |
| Render offline con plantilla desactualizada | Baja | Versión congelada del borrador (FR-028) |
| Cache del SW sirviendo navegación de API | Baja | `navigateFallbackDenylist` cubre `/api/**`; verificación `check-pwa.mjs` |

## 5. Definición de "hecho"

- Spec 002 COMPLETO y mergeado.
- Matriz §3 de `test-plan.md` con FR-010…019 verdes.
- Captura, persistencia y render offline demostrados en el E2E.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-10-13 | Plan técnico inicial del ciclo del módulo 002 | Daniel Ávila |
