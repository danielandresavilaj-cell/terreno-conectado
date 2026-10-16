# SPEC 002 — Captura offline (PWA)

| | |
| :--- | :--- |
| **Estado** | COMPLETO (ciclo del módulo, F2 · 2026-10-13) |
| **Versión** | 0.3.1 |
| **Autor** | Daniel Ávila |
| **Padre** | specs/000-master/spec.md |
| **Depende de** | 001 (sesión/tenant), 004 (plantillas a renderizar offline) |
| **Bloquea a** | 003 (sin outbox local no hay sync) |
| **Plan técnico** | `plans/002-captura-offline/plan.md` |

## 1. Alcance

Requisitos que este spec detalla: **FR-010 → FR-019** y soporte a **NFR-01, NFR-02, NFR-07**.

- **FR-010** PWA instalable (manifest + service worker), operativa sin red tras la primera carga.
- **FR-011** Crear/editar inspecciones, respuestas de checklist, hallazgos (texto + foto) y bitácora offline, en IndexedDB (Dexie).
- **FR-012** Compresión de foto en cliente (≤1280 px lado mayor, q0.7) antes de encolar; feature flag `photos`. La evidencia se toma desde la cámara del dispositivo cuando está disponible; elegir un archivo es la alternativa explícita ante permisos denegados o falta de cámara.
- **FR-013** Estado por registro: `pending`, `syncing`, `synced`, `failed`, con contador de pendientes.
- **FR-014** Persistencia al cerrar/reabrir/reiniciar el dispositivo.
- **FR-015** UUIDv7 generados en el cliente.
- **FR-016** Sync automática al recuperar conectividad (evento `online`), sin acción del usuario.
- **FR-017** Aviso al superar el 80% de la cuota de almacenamiento; priorizar la subida de fotos sincronizables.
- **FR-018** Caché local de plantillas publicadas/asignadas → render y captura 100% offline.
- **FR-019** Export en el dispositivo del `.xlsx` original rellenado + hoja "Evidencias", sin depender del servidor.

## 2. Estado de implementación

Verificado sobre `main` al 2026-10-13.

| Requisito | Estado | Evidencia |
| :--- | :--- | :--- |
| FR-010 PWA instalable + SW | ✅ | `frontend/vite.config.ts` (`VitePWA`, `registerType: autoUpdate`, Workbox); `frontend/scripts/check-pwa.mjs` |
| FR-011 captura offline | ✅ | `frontend/src/lib/db.ts`, `frontend/src/screens/`; `e2e-captura-offline.spec.ts` |
| FR-012 compresión de foto | ✅ | `frontend/src/lib/compresor.ts`; `shared` (unit) + E2E |
| FR-013 estados + contador | ✅ | `db.ts` (`SyncEstado`), `store.tsx` (`pendientes`, `fallidos`) |
| FR-014 persistencia | ✅ | IndexedDB; E2E "cerrar/reabrir conserva el borrador" |
| FR-015 UUIDv7 cliente | ✅ | `shared` (`uuidv7`), `db.ts` (`getDeviceId`) |
| FR-016 disparo en `online` | ✅ | `store.tsx` (efecto sobre `online`); E2E "reactivar la red drena la cola" |
| FR-017 aviso de cuota | ✅ | `frontend/src/lib/cuota.ts` (`estimarCuota` con `navigator.storage.estimate()`, `cuotaEsAlta`, umbral 80%), `store.tsx` (`cuota`, `cuotaAviso`), `db.ts` (`contadorFotosPendientes`, `sincronizables(priorizarFotos)`), `sync.ts` (`setPriorizarFotos`); `frontend/test/cuota.test.ts` |
| FR-018 caché de plantillas | ✅ | `db.ts` (`plantillas`, `plantillaOriginales`, cursor en `meta`); E2E "con la red apagada la plantilla se renderiza" |
| FR-019 export en dispositivo | ✅ | `frontend/src/lib/exportar.ts` + `shared` (`rellenar`, `serializar`); E2E + unit |

## 3. Esquema local (Dexie)

Evolución por versiones (`frontend/src/lib/db.ts`), alineada con `data-model.md` §2.4:

| Versión | Stores | Para qué |
| :--- | :--- | :--- |
| v1 | `outbox`, `inspections`, `responses`, `findings`, `logEntries`, `attachments`, `meta` | captura y cola de subida (FR-011/013) |
| v2 | `plantillas` (`revision_id, template_id, version`) | caché de revisiones publicadas para render offline (FR-018) |
| v3 | `plantillaOriginales` (`revision_id, tenant_id, cached_at`) | documento original para exportar sin conexión (FR-019/044) |

- **Estados del outbox** (`SyncEstado`): `pending → syncing → synced`/`failed` (FR-013).
- **Cursor de plantillas**: en `meta`, clave `tc_plantilla_cursor:<tenantId>` — **por tenant**, porque un dispositivo compartido cambia de sesión (FR-007/027).
- **Sesión offline**: la identidad y el perfil se cachean para restaurar la sesión sin red (FR-006/014).

## 4. UX de captura en terreno

Targets táctiles amplios, alto contraste para luz solar, y **autoguardado de borrador** por ítem: una captura a medias sobrevive cerrar/reabrir (FR-014). Los errores de validación de tipo (FR-039) se muestran **antes de encolar**, en el dispositivo.

## 5. Cache del service worker (Workbox)

`vite-plugin-pwa` con `registerType: 'autoUpdate'`:

- **Precache del shell**: `globPatterns` de `js/css/html/svg/png/woff2`; `navigateFallback` a `index.html`.
- **Exclusión de la API**: `navigateFallbackDenylist` cubre `/api/**` — la navegación nunca se resuelve contra la API, que se consume por `fetch` autenticado.
- **Fuentes**: `StaleWhileRevalidate` para Google Fonts.
- **Verificación**: `frontend/scripts/check-pwa.mjs` (invocado desde CI) valida el artefacto.

Las **plantillas** no dependen de la caché HTTP del SW: viven en Dexie (FR-018), cache-first a nivel de aplicación.

## 6. Caché de plantillas y export offline (FR-018/019, módulo 007)

1. **Descarga**: al autenticar y al reconectar, el cliente pide el delta `GET /templates?since=` (FR-027) y guarda las revisiones en la caché `plantillas`; los originales `.xlsx` se bajan de a poco (presupuesto) a `plantillaOriginales`.
2. **Render**: la captura dibuja desde la `definition` de la revisión **congelada** del borrador (FR-028); nunca reencuadra un turno en curso.
3. **Export**: `exportar.ts` rellena el original cacheado con las respuestas y agrega la hoja "Evidencias" **en el dispositivo**, con el mismo generador compartido que el servidor (ADR-003, decisión 5).

## 7. Compresión de imagen (FR-012)

Canvas en cliente: lado mayor ≤ 1280 px, calidad 0.7, `imageSmoothingQuality: high`, salida JPEG, **antes** de encolar. El blob comprimido vive en IndexedDB (`attachments`). El hallazgo no depende de la foto (fallback sin imagen).

La toma usa `getUserMedia` y prefiere la cámara trasera. El stream se detiene al capturar, cancelar o cerrar el diálogo. Si el navegador no expone una cámara o el permiso se deniega, el diálogo informa la causa y ofrece elegir un archivo sin interrumpir la captura offline.

## 8. Criterios de aceptación y pruebas

- **Caos asociados** (`test-plan.md` §4): FR-011/014/NFR-01 (captura en modo avión), FR-012 (dimensiones ≤1280 px), FR-016 (drenado automático al reconectar), FR-018 (render sin red), NFR-02 (72 h offline).
- Matriz §3 de `test-plan.md`: filas FR-011…019 verdes (registradas).
- NFR-07 (Lighthouse mobile ≥ 80): pendiente (herramienta externa) — track 006.

## 9. Referencias

- `specs/000-master/spec.md` §5.2 (FR-010…019), §6 (NFR-01/02/07)
- `data-model.md` §2.4 (esquema local), §4 (integridad)
- `test-plan.md` §3, §4 · `adr/003` (export compartido)

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.3.1 | 2026-10-16 | TSK-OFF-002 (#150): cámara del dispositivo para fotos de ítems y hallazgos; fallback explícito de archivo y apagado del stream | Raúl González (con IA) |
| 0.3.0 | 2026-10-13 | **Spec completado (F2).** Documenta el estado real de FR-010…019 con evidencia: esquema Dexie por versiones, caché de plantillas + cursor por tenant, Workbox, compresión y export offline | Daniel Ávila |
| 0.2.0 | 2026-10-07 | **Módulo 007 (Enmienda 002):** alcance +FR-018 (caché de plantillas publicadas asignadas) y +FR-019 (export `.xlsx` rellenado + hoja Evidencias en el dispositivo) | Raúl González (con IA) |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Daniel Ávila (con IA) |
