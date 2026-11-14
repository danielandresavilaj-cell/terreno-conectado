# TEST PLAN — Plan de pruebas de validación

**Versión:** 1.4.2 · **Fecha:** 2026-09-14 · actualizado 2026-11-15 · **Autor:** Raúl González (validación) · **Relacionado:** spec maestro §5–6, constitución Artículos III/IV/VII
**Evidencia APT:** "Plan de pruebas de validación" (informe §6) y soporte de la competencia "Realizar pruebas de certificación de productos y procesos".

## 1. Principio rector

Cada promesa del spec maestro tiene una prueba que la verifica (NFR-12). Las pruebas validan **comportamiento observable** (¿se pierde el dato? ¿se duplica? ¿cruza tenants?), no implementación. Trazabilidad: cada caso referencia IDs FR/NFR.

## 2. Niveles de prueba y herramientas

| Nivel | Herramienta | Qué cubre | Cuándo corre |
| :--- | :--- | :--- | :--- |
| Unit | Vitest | Lógica de cola de sync, compresión de foto, upsert/conflictos, validaciones | Cada push (CI) |
| Integración API | Vitest + Testcontainers (Postgres real con RLS) | Endpoints, idempotencia, políticas RLS, auth | Cada push (CI) |
| E2E | Playwright (Chromium, perfil **móvil**) | Flujos completos con `context.setOffline(true/false)` | nocturno + `workflow_dispatch` manual (CI) |
| Caos offline | Playwright + scripts de corte aleatorio | Escenarios §4 | Nocturno y antes de la demo |
| Adversarial cross-model | Modelo de IA ≠ implementador + suite guiada por spec | Ataque a invariantes §5 | Al cierre de cada módulo |
| Rendimiento | Lighthouse CI + k6 básico | NFR-07, NFR-03 | Pre-deploy |
| Manual documentado | Protocolo en vivo (demo) | Criterios de aceptación §13 del spec maestro | Fases 2 y 3 |

## 3. Matriz de cobertura requisito → prueba

Estado de la evidencia a 2026-10-14, tras el harness E2E del issue #10 y el cierre de NFR-07.
Cada fila declara **dónde** vive la prueba; "verde" significa que la prueba
existe y pasó en la corrida de referencia (local con el stack completo, y el
nightly en CI). Las filas sin automatismo quedan marcadas como tales, no como
verde.

| Requisito | Prueba | Nivel | Evidencia | Estado |
| :--- | :--- | :--- | :--- | :--- |
| FR-010 | PWA instalada: buscar actualización consulta el service worker; una versión nueva sólo se activa tras confirmación y un navegador sin SW explica el límite | Unit + manual móvil | `frontend/test/actualizacion-pwa.test.ts`; protocolo manual: instalar, publicar una versión, Buscar actualización y confirmar sin perder un borrador/cola | 🟢 verde (unit) · protocolo manual pendiente por dispositivo |
| FR-011/014, NFR-01 | Capturar en modo avión, cerrar/reabrir app, verificar persistencia IndexedDB | E2E | `e2e-captura-offline.spec.ts` → "captura sin red, recarga y el borrador conserva las respuestas" | 🟢 verde |
| FR-012 | Foto de 8 MP → verificar dimensiones ≤1280 px y tamaño comprimido antes de encolar; abrir cámara, tomar foto, cancelar y denegar permiso | Unit + E2E + manual móvil | `shared` (`compresor`) + `e2e-captura-offline.spec.ts` → "la foto de un ítem queda ≤1280 px"; protocolo manual: `CamaraCaptura` abre el lente trasero, detiene el indicador al cerrar y ofrece archivo si no hay permiso | 🟢 verde (compresión) · protocolo manual pendiente por dispositivo |
| FR-016 | Desactivar red → encolar → reactivar: sync inicia sola sin clic | E2E | `e2e-captura-offline.spec.ts` → "reactivar la red drena la cola sin tocar el botón de sincronizar" | 🟢 verde |
| FR-017 | Cuota local supera el 80% → aviso al trabajador y prioriza fotos ya sincronizables | Unit | `frontend/test/cuota.test.ts` (`estimarCuota`/`cuotaEsAlta`; `contadorFotosPendientes`; `sincronizables(true)` sube al frente sólo las fotos cuyo dueño no está en cola, sin romper el orden FR-020) | 🟢 verde |
| FR-013, FR-020, FR-026 | Descartar una inspección o bitácora pendiente/fallida no deja filas locales ni outbox huérfanos; `syncing`/`synced` quedan protegidos. *(TSK-OFF-006)* La cola se muestra por unidad de trabajo: una tarjeta por inspección o bitácora con estado agregado (el peor de sus partes), avance, la pregunta en vez del ID, el motivo del fallo sin UUIDs y "Enviado" limitado a 24 h | Unit | `frontend/test/cola-descartar.test.ts` (cascada completa, bitácora aislada y bloqueo de fila en envío) + `frontend/test/cola-vista.test.ts` (agrupación, estado, textos legibles) | 🟢 verde |
| FR-020 | Batch con dependencias (inspección + respuestas + hallazgo + foto) sube en orden | Unit + Integración | `backend/test/sync.spec.ts` (`batchOrder` y orden de aplicación) | 🟢 verde |
| FR-021, NFR-04 | Reenviar el mismo batch 3 veces → contar filas: cero duplicados | Integración + **caos 2** | `e2e-caos-sync.spec.ts` → "reenviar el mismo lote 3 veces no duplica filas" (`records_unchanged`) | 🟢 verde |
| FR-022 | Fallar red a mitad de subida → backoff observado (1s,2s,4s…), sin intervención | **caos 1** | `e2e-caos-sync.spec.ts` → "al cortar el envío y reconectar…" (`context.route` aborta 2 lotes) | 🟢 verde |
| FR-023 | Editar misma inspección en 2 contextos offline → LWW aplica + CONFLICT_RECORD con ambas versiones; visible a supervisor/tenant_admin y aislado por tenant | Integración + **caos 3** | `backend/test/conflicts.spec.ts` (roles/RLS) + `e2e-caos-integridad.spec.ts` → "dos dispositivos offline editan el mismo registro" | 🟢 verde |
| FR-024 | Tras sync: SYNC_LOG completo y `synced_at - captured_at` registrado | Integración | `backend/test/sync.spec.ts` + `supervision.spec.ts` (lote rechazado → `sync_log` `failed`, TSK-DOM-005; motivo en `error_message` y `GET /conflicts/rechazos` por rol y RLS, TSK-OFF-018) + aserción de `sync_log` en el E2E de FR-016 | 🟢 verde |
| FR-025, NFR-05 | JWT tenant A intenta batch con `tenant_id` B → 4xx + AUDIT_LOG de incidente | Integración + **caos 7** | `e2e-caos-integridad.spec.ts` → "JWT del tenant A con payload del tenant B" | 🟢 verde |
| FR-002, NFR-05 | Usuario tenant A consulta todos los endpoints de lectura → jamás aparece dato B (fixture B sembrada) | Integración (RLS, Testcontainers) | `backend/test/rls.spec.ts` | 🟢 verde |
| FR-005 | 5 logins fallidos → bloqueo temporal 15 min (por cuenta y por IP); el `423` dice los minutos que faltan; al vencer, un solo fallo no vuelve a bloquear (TSK-AUTH-012) | Integración + Unit | `backend/test/auth.spec.ts` → "5 fallos consecutivos bloquean la cuenta 15 min", "el 423 informa los minutos que faltan", "al vencer el bloqueo, un solo fallo nuevo no vuelve a bloquear"; `frontend/test/bloqueo.test.ts` | 🟢 verde |
| FR-001 | Login email/contraseña → JWT HS256 de 15 min con claims `user_id`/`tenant_id`/`rol` + cookies `rt`/`csrf` | Integración | `backend/test/auth.spec.ts` → "emite access token con claims user_id/tenant_id/rol y cookies rt/csrf" | 🟢 verde |
| FR-003 | Matriz rol × recurso × acción (§3 spec 001): `platform_admin` sólo `/admin`; `field_worker` sin dashboard ni admin; `tenant_admin` único que publica plantillas | Integración | `backend/test/admin.spec.ts` (403 a no-`platform_admin`) + guardas por controlador (`dashboard.auth.ts`, `templates.controller.ts`) | 🟢 verde |
| FR-004 | Access token vencido con cola pendiente → la cola NO se pierde y drena al reingresar; el refresh rota `rt` y detecta reuso | Integración + **caos 6** | `backend/test/auth.spec.ts` (rotación/reuso y CSRF) + `e2e-caos-sync.spec.ts` → "caos 6 — token expirado en cola" | 🟢 verde |
| FR-006 | Tenant demo sembrado (A: minera + faena + 3 roles; B: constructora) y login de cada rol | Integración | `backend/db/seed.ts` + `backend/test/auth.spec.ts` (`login (FR-001, FR-006)`) | 🟢 verde |
| FR-031/032 | Ciclo draft→submitted→reviewed; ítem `nok` exige hallazgo; sólo supervisión revisa (un `field_worker` no puede declarar `reviewed` por sync); estado del hallazgo open/in_progress/resolved auditado | Unit + Integración + E2E | `e2e-captura-offline.spec.ts` (submitted, hallazgo desde NOK) + `backend/test/supervision.spec.ts` (revisión, RLS, auditoría) | 🟢 verde |
| FR-056/057/061 | Inspector firma sin red → recarga → sync; reintento del lote deja una firma por rol; cofirma sólo por supervisor/admin del mismo tenant y `reviewed` se rechaza si falta | Unit + Integración + E2E + caos | `frontend/test/firma-cierre.test.ts` y `firma-offline.test.ts` 🟢 (incluye firma siempre válida, escala única y reparación de firmas encoladas, TSK-OFF-018); `backend/test/supervision.spec.ts` (cofirma, pendiente de ejecución con Docker); E2E de recarga y caos de reintento pendientes | 🟡 en revisión (#191: cobertura parcial) |
| FR-059/061 | Crear programación puntual/diaria/semanal/mensual con zona IANA; ejecutar worker dos veces y comprobar una sola ocurrencia; completar una ocurrencia ya sincronizada sin red | Unit + Integración + E2E + caos | Plan: `plans/008-operacion-certificada/plan.md` §2.3/§4 | 🟡 por implementar (Enmienda 007) |
| FR-058/061 | Evento crítico/cierre/programación crea una outbox única; fallo del proveedor reintenta sin cambiar la inspección ni duplicar correo lógico; destinatario cross-tenant no es visible | Unit + Integración + caos | Plan: `plans/008-operacion-certificada/plan.md` §2.3/§4 | 🟡 por implementar (Enmienda 007) |
| FR-034 | *(Enmienda 004: sin geolocalización)* Cada captura queda asociada a una faena del tenant; el envío ya no pide ubicación y el sync sigue aceptando `location` nulo de colas antiguas | Integración + Unit | `backend/test/sync.spec.ts` (location opcional); *(TSK-OFF-010)* `frontend/test/faena.test.ts`: la sesión arranca en la faena del borrador, la última elegida o la primera (pidiendo elegir), y no se cambia de faena con una inspección sin enviar | ⚪ geolocalización fuera de V1 · 🟢 asociación a faena |
| FR-040/043, NFR-03 | Procesamiento del lote ≤ 60 s (`sync_log`) y espera sin señal informada aparte, ambas con un solo reloj (Enmienda 004, TSK-REP-006) | Integración con relojes de dispositivo desfasados | `backend/test/dashboard-supervision.spec.ts` + `frontend/test/supervision-titulares.test.ts` | ✅ |
| FR-041 | Dashboard: filtros de faena, rango de fechas, severidad y autor | Integración | `backend/test/dashboard.spec.ts` (`dashboardFiltrosSchema`, `findingsFiltrosSchema.autor_id`); *(TSK-REP-012)* tendencia semanal por faena y sin recorte de período: `backend/test/dashboard-tendencia.spec.ts` | 🟢 verde |
| FR-042 | Export de la vista de hallazgos a CSV (columnas y escapado) | Unit | `frontend/src/lib/dashboard-csv.ts` (`construirCsvHallazgos`) + `frontend/test/dashboard-csv.test.ts` | 🟢 verde |
| FR-052, NFR-09 | `/health` responde 200 con estado de DB (503 con DB caída); uptime monitor lo consume; logs JSON con `request_id` y `tenant_id` en cada línea | Integración + manual | `backend/test/health.spec.ts` + `backend/test/observability.spec.ts` | 🟢 verde |
| FR-053/054 | `tenant_admin` crea cuentas con clave temporal, desactiva/reactiva, cambia rol, restablece; crea/renombra faenas; otra empresa recibe 404 aunque conozca el id; `field_worker` 403 | Integración | `backend/test/users.spec.ts`; *(TSK-ADM-002)* `frontend/test/alta-masiva.test.ts`: lectura de la planilla, rechazos con motivo y CSV de claves | 🟢 verde |
| FR-055 | Clave temporal: sólo `/me`, `/auth/password`, `/auth/logout` (403 `password_change_required`); cambio de clave revoca otras sesiones; logout revoca el refresh; refresh con empresa suspendida → 401 | Integración + Unit | `backend/test/auth-password.spec.ts`, `frontend/test/sesion-refresh.test.ts` | 🟢 verde |
| Autoría (Enmienda 003) | Inspección/bitácora a nombre de otro usuario se rechaza por registro; cola del dispositivo separada por usuario; sesión expirada pausa la cola sin marcar fallidos | Integración + Unit + **caos 6** | `backend/test/supervision.spec.ts`, `frontend/test/cola-dueno.test.ts`, `e2e-caos-sync.spec.ts` (caos 6) | 🟢 verde |
| NFR-02 | Script: 200 registros + 100 fotos en offline simulado de 72 h (reloj adelantado) → sync completo sin pérdida | **caos 5** | `e2e-caos-sync.spec.ts` → "200 registros pendientes suben íntegros y sin duplicar" | 🟢 verde (200 registros; las 100 fotos se comprueban en el FR-012 unitario, no en el mismo escenario) |
| NFR-07 | Lighthouse CI mobile Performance ≥ 80; interacción de formulario < 200 ms | Rendimiento | `frontend/scripts/check-lighthouse.mjs` (Chrome, perfil móvil, Slow 4G; **Performance 85–89**) + workflow `lighthouse.yml` (nightly/manual). La interacción se aproxima con el Total Blocking Time del mismo reporte (~40–50 ms) | 🟢 verde |
| FR-007, NFR-05 | Plantillas/revisiones de tenant A jamás visibles para B (fixture B sembrada) | Integración (RLS, Testcontainers) | `backend/test/rls.spec.ts`, `backend/test/templates.delta.spec.ts` | 🟢 verde |
| FR-008/009 | Asignación faena+rol: el worker solo ve revisiones publicadas asignadas a su faena y rol | Integración | `backend/test/templates.delta.spec.ts` | 🟢 verde |
| FR-018 | Plantillas en caché local → captura de formulario 100% sin red (Artículo I) | E2E | `e2e-captura-offline.spec.ts` → "con la red apagada tras un arranque con señal, la plantilla se renderiza" | 🟢 verde |
| FR-027/028 | Delta `since=<template_version>` trae solo cambios; inspección en curso conserva su versión congelada | Integración | `backend/test/templates.delta.spec.ts` | 🟢 verde |
| FR-009, FR-032, FR-036/039 | Sesión sin asignación no recibe formulario; inspección con obligatorios vacíos, valor inválido o NOK sin hallazgo no se encola | Unit + E2E | `frontend/test/validar-envio-inspeccion.test.ts`, `frontend/test/plantillas.resolucion.test.ts` y `shared/src/templates.test.ts`; *(TSK-OFF-007)* `frontend/test/hallazgo.test.ts`: corregir un hallazgo conserva su UUID y deja una sola fila por enviar, la foto se conserva o reemplaza sin huérfanos, la severidad es obligatoria y alta/crítica exigen descripción; protocolo E2E de captura; *(TSK-OFF-015)* hallazgo directo: registro aparte, corrección por id sin duplicar y fotos (`frontend/test/hallazgo.test.ts`) | 🟢 verde (unit) · E2E a ejecutar en CI |
| FR-037 + FR-012 | Foto de ítem comprimida y asociada a la respuesta (`ATTACHMENT`) | Unit + E2E | `backend/test/sync.spec.ts` + E2E de FR-012 | 🟢 verde |
| FR-029 | *(Enmienda 003: el import es una acción en línea del `tenant_admin`, no viaja por el batch)* Reintentar la subida del mismo archivo no publica nada: cada subida crea una propuesta nueva que exige revisión humana antes de confirmar | Integración | `backend/test/templates-caos-007.spec.ts` (reintento → propuesta nueva, sin publicar), `import-wizard.spec.ts` | 🟢 verde |
| FR-029/048 (IA) | Con IA, una foto o un PDF escaneado producen una propuesta revisable; reintento con IA sobre un import fallido; salida inválida o error de la API → `failed` sin guardar; tope diario → 429; sin clave → 503 y el asistente sin IA; foto sin IA → 415; auditoría con modelo y tokens (Enmienda 006). La CI usa un analizador falso | Unit + integración | `shared/src/importar/ia.test.ts`, `backend/test/import-ia.spec.ts`, `frontend/test/importar-ia.test.ts` | ✅ |
| FR-029 (Word/PDF) | Importar `.docx` y `.pdf` (texto y rellenable) propone secciones e ítems con su tipo; escaneado → error claro; firma de bytes falsa → 415; tope por formato → 413; confirmar como nueva versión no duplica la plantilla (Enmienda 005) | Unit + integración | `shared/src/importar/docx.test.ts`, `backend/test/importar-pdf.spec.ts`, `backend/test/import-word-pdf.spec.ts` | ✅ |
| FR-019/044 | Export rellenado + hoja "Evidencias" idéntico en dispositivo y en servidor | E2E + Integración | `backend/test/inspection-export.spec.ts`, `shared/src/rellenar.test.ts`, `serializar.test.ts`; *(TSK-OFF-017)* reexportar desde el teléfono sin red: `frontend/test/reexportar.test.ts` | 🟢 verde |
| FR-045/046 | Lote del período con formato de su plantilla + hoja "Evidencias" (adjuntos referenciados/embebidos) | Integración | `backend/test/inspection-export-lote.spec.ts` | 🟢 verde |
| FR-045/046/047 (Enmienda 005) | Excel consolidado (Resumen + hoja por formulario + Hallazgos + Evidencias, columnas unidas entre versiones, plantilla hecha a mano), PDF y Word (un archivo o ZIP), selección por `ids` con RLS, filtros de formulario/estado, tope 413, 404, 400, roles y auditoría. *(TSK-REP-013)* La acción individual manda un único `id` como PDF universal, también para una plantilla creada desde cero. | Unit + integración | `shared/src/exportar/consolidado.test.ts`, `backend/test/inspection-report.spec.ts`, `frontend/test/exportar-inspecciones.test.ts` | ✅ |
| FR-047 + FR-051 | Import confirmado y export por lote registrados en el audit log (autor, timestamp, tenant) | Integración | `backend/test/import-wizard.spec.ts`, `inspection-export-lote.spec.ts` | 🟢 verde |
| FR-062 | *(Enmienda 008)* Supervisión ve en pantalla la foto de una respuesta o de un hallazgo: mismos bytes que subió el dispositivo y tipo de imagen explícito; otra empresa → 404 (RLS), trabajador y plataforma → 403, sin sesión → 401; no sirve el original de un import; archivo ausente → 404 con motivo; el detalle nombra la foto de cada respuesta y hallazgo | Integración + Unit | `backend/test/attachments.spec.ts`; `frontend/test/fotos.test.ts` (caché: una descarga por foto, no recuerda fallos, descarta la menos usada); *(TSK-OFF-016)* `fotos_ids` en el detalle (`attachments.spec.ts`) y varias fotos por hallazgo en el dispositivo (`frontend/test/hallazgo.test.ts`) | 🟢 verde |
| FR-063 | *(Enmienda 008)* El trabajador, la supervisión y la administración leen la bitácora de la empresa, más reciente primero, con autor y faena; filtros por faena y período, paginación; otra empresa no ve entradas (RLS), plataforma → 403, sin sesión → 401, filtro inválido → 400 | Integración | `backend/test/bitacora.spec.ts` | 🟢 verde |
| FR-064 | *(Enmienda 008)* Supervisión asigna responsable y plazo y cierra con nota; auditoría antes→después; responsable de otra empresa → 400; otra empresa → 404 (RLS), trabajador → 403; una corrección por sync no borra la asignación; el dashboard muestra responsable y plazo; plazo vencido / vence hoy / cerrado | Integración + Unit | `backend/test/accion-correctiva.spec.ts`; `frontend/test/plazo.test.ts` | 🟢 verde |
| FR-065 | *(Enmienda 008)* `GET /sites` devuelve a cada cuenta sólo sus faenas asignadas (sin asignación: todas); el admin las asigna con `PUT /users/:id/faenas`; otra empresa → 404, faena ajena → 400, auditoría | Integración | `backend/test/users-faenas.spec.ts` (TSK-ADM-003); `frontend/test/faenas-cuenta.test.ts` | 🟢 verde |
| FR-066 | *(Enmienda 008)* Archivar oculta el formulario a dispositivos y a Plantillas sin borrar revisiones ni asignaciones; restaurar lo devuelve; sólo `tenant_admin`; otra empresa → 404; auditoría. Duplicar genera ids nuevos y quita el origen de planilla | Integración + Unit | `backend/test/templates-archivar.spec.ts`; `frontend/test/duplicar-formulario.test.ts` (TSK-FORM-024) | 🟢 verde |
| FR-067 | *(Enmienda 008)* El responsable ve sólo sus hallazgos (otra empresa → lista vacía; plataforma → 403), con faena, formulario, pregunta y fotos; los empieza y reporta con nota obligatoria; uno ajeno o resuelto → 404; auditoría `finding_progress`; supervisión lo ve listo para revisar; reabrir y reasignar limpian el avance; una corrección por sync no lo borra; el responsable ve las fotos de sus hallazgos y no otras; en el teléfono la lista se lee sin señal, el aviso cuenta los no abiertos y el reporte queda como borrador | Integración + Unit + E2E | `backend/test/hallazgos-asignados.spec.ts`; `frontend/test/hallazgos-asignados.test.ts`; `frontend/e2e/specs/hallazgos-asignados.spec.ts` | 🟢 verde |
| FR-048 | *(Enmienda 006)* La IA (opcional, sólo backend) propone secciones e ítems desde PDF, Word o foto, y la propuesta nunca se publica sin la confirmación explícita del `tenant_admin`. *(TSK-FORM-022)* Un formulario creado desde cero sigue el mismo camino: borrador por `POST /templates` y publicación explícita, con las mismas validaciones de props; sin clave la función queda apagada | Integración + Unit | `backend/test/import-ia.spec.ts` (analizador falso), `import-wizard.spec.ts`, `templates.http.spec.ts`, `frontend/test/editor-formulario.test.ts` | 🟢 verde |
| FR-049 | Revisión publicada inmutable: ítems ya inspeccionados no se modifican; el cambio exige revisión nueva | Integración | `backend/test/templates.http.spec.ts` (409 al editar publicado) | 🟢 verde |
| FR-050 | `platform_admin` crea tenant, le asigna el `tenant_admin` inicial y lo suspende/reactiva; un rol distinto recibe 403 en toda la consola | Integración | `backend/test/admin.spec.ts` | 🟢 verde |
| FR-051 (`admin`) | Cada mutación admin deja exactamente una fila en `audit_log` con `actor_id` y `tenant_id` correctos; `tc_app` no puede UPDATE/DELETE y la API no expone rutas de modificación | Integración | `backend/test/admin.spec.ts` | 🟢 verde |

**Recuento (2026-11-15):** 53 filas · 🟢 49 (92,5%) · 🟡 3 (5,7%) · 🔴 0 · ⚪ 1 (1,9%). FR-056/057/061 está en revisión con una prueba unitaria verde y validación de integración/E2E/caos pendiente; FR-058/059/061 siguen por implementar. De lo ya validado, **49/50 (98,0%) está en verde**.

> La única fila con ⚪ es **FR-034**, y solo por la parte de geolocalización, que la
> Enmienda 004 sacó de V1; su parte vigente (asociación a faena) está en 🟢. FR-048
> pasó a 🟢 con la importación con IA (Enmienda 006), y FR-040/043/NFR-03 se
> verificaron en producción (✅).

**Volumen de pruebas en la corrida de referencia:**
```
E2E + caos (Playwright, manual)           23 tests
Integración backend (Vitest + Testcontainers) 289 tests
Unidad frontend (Vitest)                     223 tests
Unidad shared (Vitest)                        92 tests
                                           ───────────────
                                           627 tests   (v1.4, bloque 4 del plan de mejora, 2026-11-14)
```

> El criterio de salida de Fase 2 (§8) pide "matriz §3 ≥ 90% verde": hoy está en
> 97,7% (43/44), sin contar como verde lo que una enmienda sacó del alcance.

## 4. Pruebas de caos offline-first (protocolo)

Escenarios ejecutados con Playwright (offline automático) y manualmente en la demo (modo avión real del teléfono):

1. **Corte a mitad de sync:** offline aleatorio durante la subida de un batch grande → al reconectar: cero pérdida, cero duplicado (idempotencia).
2. **Doble envío:** forzar reintento de un lote ya procesado (replay de red) → filas idénticas.
3. **Edición concurrente:** mismo registro en dos dispositivos offline → LWW + conflicto visible y auditado.
4. **Reinicio hostil:** matar la pestaña/app con outbox a medio escribir → al reabrir, datos íntegros (transacciones Dexie).
5. **Cola masiva:** escenario NFR-02 (72 h, 200 registros, 100 fotos).
6. **Token expirado en cola:** JWT expira mientras hay pendientes → refresh sin perder cola (FR-004).
7. **Cross-tenant hostil:** JWT A + payload B → rechazo + auditoría (FR-025).

### 4.0 Implementación (issue #10)

Los siete escenarios están automatizados en `frontend/e2e/specs/` y corren en
el workflow manual `.github/workflows/e2e.yml`. Ninguno toca `ci.yml`: la capa
rápida de cada PR sigue igual, y la capa lenta (Postgres + backend + navegador)
no puede bloquear un merge.

Cada spec parte con el dispositivo limpio, selecciona explícitamente el
formulario asignado y crea sólo los registros que comprueba. La cola inicia en
cero: el harness no depende de filas de demostración ni de textos visibles de
una plantilla para localizar sus controles.

| # | Mecanismo en el harness | Spec |
| :-- | :--- | :--- |
| 1 | `context.route` aborta dos envíos seguidos y después deja pasar; la cola debe drenar sola por backoff | `e2e-caos-sync.spec.ts` |
| 2 | Se captura el lote real que arma la app y se reinyecta por API 3 veces | `e2e-caos-sync.spec.ts` |
| 3 | Dos contextos con sesión propia editan el mismo registro con versiones distintas | `e2e-caos-integridad.spec.ts` |
| 4 | Se recarga sin cierre limpio y se verifica el outbox antes y después | `e2e-caos-integridad.spec.ts` |
| 5 | 200 registros inyectados en el outbox (entidad + fila), medidos en `log_entry` | `e2e-caos-sync.spec.ts` |
| 6 | Se sustituye el token por uno vencido y se comprueba que la cola no se pierde | `e2e-caos-sync.spec.ts` |
| 7 | Lote con `tenant_id` del tenant B bajo el JWT del A: 409 + `audit_log` | `e2e-caos-integridad.spec.ts` |

**Criterio de éxito global:** los escenarios 1–7 con `0 pérdidas ∧ 0 duplicados ∧ 0 fugas cross-tenant`. Cualquier fallo bloquea la demo (Artículo III). **Resultado histórico 2026-10-13: los 7 en verde.** La corrida programada que falló el 2026-10-20 se corrigió en TSK-E2E-002 / issue #161 (PR #179): el harness recompila el frontend contra su API temporal y entrega las URLs a Playwright. **Revalidado en CI el 2026-11-12: 23/23 en verde, caos 1–7 incluidos** (runs 43239304685 y 43239310758, sobre las ramas de #178 y #179).

### 4.1 Pruebas de caos del módulo 007 (TSK-FORM-011)

Extienden la sección 4 con los invariantes del módulo (spec 007): libros `.xlsx` reales, versionado inmutable y delta de plantillas.

8. **Corte a mitad de delta de plantillas:** offline durante `GET /api/v1/templates?since=` → reconectar: caché consistente y la inspección en curso conserva su versión congelada (FR-027/028). *El invariante crítico —el cursor no avanza si el delta no se integró completo— está cubierto por unit en el cliente* (`plantillas.delta.test.ts`).
9. **Doble import de plantilla:** reenviar el mismo `.xlsx` (replay de red) → un único `TEMPLATE_IMPORT` confirmado, cero duplicación (FR-029).
10. **Edición concurrente de revisión:** dos `tenant_admin` editan el mismo borrador → se publica una sola versión y queda auditada (FR-047/049).
11. **Versión en vuelo:** inspección iniciada con v1 mientras se publica v2 → la inspección re-exporta con v1 y no se re-valida contra v2 (FR-028/038). *Si la revisión congelada no llega, la captura se bloquea y lo dice, con salida explícita confirmada; nunca reencuadra en silencio.*

**Criterio de éxito del módulo:** escenarios 8–11 con `0 duplicados ∧ 0 versiones inconsistentes ∧ 0 fugas cross-tenant`; import/export probados con libros reales (fixtures del spike xlsx, plan 007 §3).

## 5. Testing adversarial cross-model (red-team)

- **Regla:** el modelo que implementó un módulo **no** es el que lo ataca (Q14/Artículo VII).
- **Insumo del atacante:** spec maestro + spec del módulo (no el código): debe romper las promesas, no buscar bugs de estilo.
- **Prompt base del red-team:** "Dado este spec, diseña y ejecuta la secuencia de acciones de usuario y de red que viole los invariantes: integridad (FR-021/023), aislamiento (FR-002/025), disponibilidad offline (FR-011/016). Prioriza estados frontera: cuotas llenas, timestamps iguales, UUIDs colisionados, lotes parciales, relojes desviados entre dispositivos."
- **Salida esperada:** informe por módulo con hallazgos (severidad, repro, requisito vulnerado) → issues en `tasks/` con fix + test de regresión.
- **Modelos sugeridos (opencode go):** implementa `kimi-k2.7-code` / `qwen3.8-flash` → ataca `qwen3.8-max` o `deepseek-v4-pro` (y viceversa).

### 5.1 Ataque sin los modelos sugeridos: el harness encontró seis defectos

El E2E atacó el sistema sin necesitar los modelos cross-model: al escribir
las pruebas del protocolo §4 contra la app real aparecieron seis defectos.
Todos se corrigieron en el mismo PR que construyó el harness y **cada uno
quedó cubierto por una prueba de regresión**, que es el criterio de salida de
esta sección.

| # | Severidad | Hallazgo | Requisito | Repro | Estado |
| :-- | :--- | :--- | :--- | :--- | :--- |
| H1 | **Crítica** | `await fetch()` dentro de una transacción Dexie → `Transaction committed too early`. **El login completo se caía en el primer arranque de cada dispositivo.** | FR-006 | Cargar la app por primera vez con un usuario sembrado: `/auth/login` y `/sites` responden 200, el token queda en `sessionStorage`, y aun así la pantalla nunca sale del login. | ✅ `frontend/src/lib/db.ts` (el blob se resuelve **antes** de abrir la transacción) + 10 E2E que arrancan por login |
| H2 | **Alta** | El `catch` del worker releía `sincronizables()`, que **excluye** las filas ya marcadas `syncing`. Un corte de red dejaba el lote atrapado en `syncing` para siempre: cero reintentos y el contador de pendientes congelado. | FR-022, Artículo I | Poner la red, encolar y cortar la conexión durante el envío. | ✅ `frontend/src/lib/sync.ts` (se conserva la lista `enVuelo` del intento) + caos 1 |
| H3 | **Alta** | `fetch` sin timeout: una conexión que acepta el socket y nunca responde (portal cautivo, WiFi que captura el WPA) colgaba el worker indefinidamente. | FR-022 | Encolar con una red que acepta la conexión pero no responde. | ✅ `AbortController` a 30 s + caos 1 y 6 |
| H4 | **Alta** | La semilla demo creaba respuestas con `template_item_id = 'i-01'`, que **no es UUID**. El backend rechazaba el lote entero con 400: **el primer sync de todo usuario nuevo estaba roto.** | FR-021 | Arrancar sesión y dejar que la app sincronice sus datos de demo. | ✅ `ITEM_ID_FIJO` con los ids reales del catálogo publicado + caos 2 |
| H5 | **Alta** | `validatePayload` corría **antes** del chequeo de cruce de tenant: un lote con datos de otro tenant moría con un 400 de forma y **no dejaba rastro en `audit_log`**, habilitando tantear el tenant ajeno con peticiones invisibles. | FR-025, NFR-05 | JWT del tenant A + `tenant_id` del B con un `site_id` ajeno. | ✅ `backend/src/sync/sync.service.ts`: el aislamiento se comprueba sobre el sobre, antes de opinar sobre el payload + caos 7 |
| H6 | Media | Al reabrir la app, el outbox quedaba en un limbo observable: nada indicaba si la sesión se había restaurado o había que volver a entrar. | FR-006 | Cerrar la pestaña con cola a medio escribir y reabrirla. | ✅ cubierto por caos 4 (el harness verifica la cola antes de reingresar) |

**Conclusión del red-team:** el nivel de daño de H1 y H4 es que la aplicación
**no arrancaba** para un usuario nuevo, y ninguno era visible leyendo el
código: hacen falta la app real y la base real para verlos. Eso es el argumento
a favor de que §4 exista como protocolo automatizado y no como lista de
comprobaciones manuales. El invariante crítico
(`0 pérdidas ∧ 0 duplicados ∧ 0 fugas`) se sostiene en la corrida de
referencia histórica (**17/17 E2E en verde**) y en la revalidación de
TSK-E2E-002 / issue #161 del 2026-11-12 (**23/23 en verde en CI**). Desde
TSK-OPS-001 (PR #178), el E2E corre cada noche (03:17 UTC) además de a demanda,
y nunca bloquea un PR. Informe por módulo en
[`docs/informe-pruebas-validacion.md`](docs/informe-pruebas-validacion.md).

## 6. Datos de prueba

- Semillas deterministas (`seed:demo`) — tenants A y B de data-model.md §5.
- Generación masiva con faker es-CL para caos y rendimiento.
- Fotos sintéticas de tamaños conocidos (1/5/12 MP) para FR-012.
- Nunca datos reales de empresas (informe APT §3.5: sin acceso a faenas reales).

## 7. Ambientes

| Ambiente | Propósito | Infra |
| :--- | :--- | :--- |
| local | dev + CI, Docker Compose idéntico al deploy | Máquina del integrante |
| CI | unit + integración (Testcontainers) + E2E manual | GitHub Actions (minutos gratis) |
| demo | despliegue en VPS para validación en vivo | ADR-002 (≤ US$7/mes) |

## 8. Criterios de salida por fase (alineado al Gantt APT)

- **Fase 2 (sem. 13–16, "Pruebas de validación"):** matriz §3 ≥ 90% verde en CI; caos 1–7 pasando; informe de resultados por módulo.
- **Módulo 007 (ciclo del módulo, issues #34–#45):** matriz §3 (módulo 007) verde; caos 8–11 (TSK-FORM-011) pasando; spike xlsx cerrado con enmienda a ADR-003.
- **Fase 3:** demo en vivo ejecuta §13 del spec maestro sin fallos; informe final cita resultados de este plan.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 1.4.2 | 2026-11-15 | **TSK-OFF-019:** fila FR-010 para búsqueda manual, confirmación y fallback de actualización PWA; `actualizacion-pwa.test.ts` | Raúl González (con IA) |
| 1.4.1 | 2026-11-15 | **TSK-REP-013:** la fila FR-045/046/047 acredita el contrato de PDF individual universal en `exportar-inspecciones.test.ts` | Raúl González (con IA) |
| 1.4.0 | 2026-11-15 | **TSK-DOM-008:** fila FR-067 (`hallazgos-asignados.spec.ts` backend, `hallazgos-asignados.test.ts` frontend y un E2E); recuento 53 filas (49 🟢) | Daniel Ávila (con IA) |
| 1.3.14 | 2026-11-15 | **TSK-AUTH-012:** FR-005 suma el reinicio del contador tras un bloqueo y los minutos restantes (`auth.spec.ts` +2, `bloqueo.test.ts` 2); sin cambio de recuento de filas | Daniel Ávila (con IA) |
| 1.3.13 | 2026-11-15 | **TSK-OFF-018 (#239):** evidencia de FR-024 (motivo del lote rechazado) y FR-056 (firma siempre válida, reparación de la cola); sin cambio de recuento | Daniel Ávila (con IA) |
| 1.3.12 | 2026-11-14 | Volumen contado en CI tras el bloque 4 (plan 009): backend 289, frontend 223, shared 92 y 23 E2E = 627 | Daniel Ávila (con IA) |
| 1.3.11 | 2026-11-14 | **TSK-ADM-003:** FR-065 a 🟢 (`users-faenas.spec.ts`, `faenas-cuenta.test.ts`); recuento 52 filas (48 🟢) | Daniel Ávila (con IA) |
| 1.3.10 | 2026-11-14 | **TSK-REP-012:** tendencia semanal y filtros en una barra; evidencia en la fila FR-041 (`dashboard-tendencia.spec.ts`) | Daniel Ávila (con IA) |
| 1.3.9 | 2026-11-14 | **TSK-FORM-024:** FR-066 a 🟢 (`templates-archivar.spec.ts`, `duplicar-formulario.test.ts`); recuento 52 filas (47 🟢) | Daniel Ávila (con IA) |
| 1.3.8 | 2026-11-14 | **TSK-OFF-017:** reexportar desde Cola; evidencia en la fila FR-019/044 (`reexportar.test.ts`) | Daniel Ávila (con IA) |
| 1.3.7 | 2026-11-14 | **TSK-OFF-015:** hallazgo directo; evidencia en la fila FR-009/032/036 (`hallazgo.test.ts`) | Daniel Ávila (con IA) |
| 1.3.6 | 2026-11-14 | **TSK-OFF-016:** varias fotos por hallazgo; evidencia en las filas FR-062 (`attachments.spec.ts`, `hallazgo.test.ts`) | Daniel Ávila (con IA) |
| 1.3.5 | 2026-11-14 | Filas FR-065 y FR-066 (Enmienda 008, ampliación) en 🟡 por implementar; recuento 52 filas | Daniel Ávila (con IA) |
| 1.3.4 | 2026-11-14 | Encabezado y volumen al día tras TSK-OFF-014: frontend 208, total 596 | Daniel Ávila (con IA) |
| 1.3.3 | 2026-11-13 | **TSK-OFF-014 (#221):** `cola-accesibilidad.test.ts` asegura que los tres desplegables de Cola mantienen objetivo táctil de 44 px y control nativo; suite frontend 39 archivos, 208 pruebas verdes | Raúl González (con IA) |
| 1.3.2 | 2026-11-13 | Volumen contado en CI tras el plan de mejora (PR #218): backend 273, frontend 207, shared 92 y 23 E2E = 595. Corrige el total de backend estimado en 1.3.1 | Daniel Ávila (con IA) |
| 1.3.1 | 2026-11-13 | **TSK-DOM-007 (Enmienda 008, FR-064):** fila FR-064 con `accion-correctiva.spec.ts` (7) y `plazo.test.ts` (3); recuento 50 filas (46 🟢); volumen 589 tests (backend 271 validados en CI, frontend 203 incluye TSK-OFF-011) | Daniel Ávila (con IA) |
| 1.3.0 | 2026-11-13 | **TSK-REP-009 (Enmienda 008, FR-063):** fila nueva FR-063 con `bitacora.spec.ts` (4); recuento 49 filas (45 🟢); volumen 578 tests (backend 264, validados en CI) | Daniel Ávila (con IA) |
| 1.2.9 | 2026-11-13 | **TSK-OFF-010:** `faena.test.ts` (7) en la fila FR-034; volumen 574 tests (frontend 199) | Daniel Ávila (con IA) |
| 1.2.8 | 2026-11-13 | **TSK-REP-008 (Enmienda 008, FR-062):** fila nueva FR-062 con `attachments.spec.ts` (7) y `fotos.test.ts` (3); recuento 48 filas (44 🟢); volumen 567 tests (backend 260 = 253 documentados + 7 nuevos, validados en CI; frontend 192) | Daniel Ávila (con IA) |
| 1.2.7 | 2026-11-13 | **TSK-OFF-007/008/009 (Fase 0 del plan de mejora):** `hallazgo.test.ts` (11) en la fila FR-009/032/036 y `navegacion.test.ts` (9) para el botón Atrás (FR-010/011); volumen 557 tests (frontend 189, contados en esta corrida; el backend no se re-ejecutó en local) | Daniel Ávila (con IA) |
| 1.2.6 | 2026-11-13 | **TSK-OPS-003-B (#191, PR #193)**, revisado e integrado por Daniel Ávila: firma de inspector offline y cofirma; `signature_required` sólo lo declara el cliente que firma (las colas de la app anterior quedan revisables); la firma no retrocede una inspección ya revisada; firma agrupada en la cola legible; E2E firman con el pad (`firmarYEnviar`); diálogo de firma con foco y Escape | Raúl González / Daniel Ávila (con IA) |
| 1.2.5 | 2026-11-13 | **TSK-FORM-022:** crear formulario desde cero con el mismo editor (agregar, reordenar y quitar preguntas y secciones); evidencia en la fila FR-048 (`editor-formulario.test.ts`); volumen 532 tests (frontend 164) | Daniel Ávila (con IA) |
| 1.2.4 | 2026-11-13 | **TSK-OFF-005/006:** modo claro y oscuro (`tema.test.ts`) y cola legible por unidad de trabajo (`cola-vista.test.ts`, evidencia en la fila FR-013/020/026); volumen 528 tests (frontend 160) | Daniel Ávila (con IA) |
| 1.2.3 | 2026-11-12 | **Enmienda 007 aprobada** (#187, Daniel Ávila): las tres filas FR-056…061 pasan a 🟡 "por implementar"; recuento 47 filas (43 🟢 · 3 🟡 · 1 ⚪), 97,7% de lo implementado | Daniel Ávila (con IA) |
| 1.2.2 | 2026-11-12 | **TSK-OFF-003 (#182) y TSK-OFF-004 (#185)**, revisados por Daniel Ávila: accesibilidad de la captura (controles con su pregunta y error, diálogo de cámara con foco/Escape) e instalación visible de la PWA. E2E 23/23 en ambas ramas (runs 43269750831 y 43324635847); volumen 521 tests (frontend 153) | Daniel Ávila (con IA) |
| 1.2.1 | 2026-11-12 | **TSK-OPS-001 (#178) y TSK-E2E-002 (#179)**, revisados por Daniel Ávila: E2E nocturno + manual (tabla §2); harness E2E aislado (recompila el frontend contra su API temporal y entrega las URLs a Playwright); auditoría de respaldos sin `rclone` simulado; migraciones y seed cargan el `.env` raíz. Revalidación en CI del 2026-11-12: 23/23 E2E con caos 1–7 | Daniel Ávila (con IA) |
| 1.2.0 | 2026-11-11 | **v1.3 (Enmiendas 004–006)**: filas de importar Word/PDF, exportar consolidado/PDF/Word e importar con IA; FR-048 a 🟢; recuento 43/44 (97,7%); volumen 517 tests (253 backend, 149 frontend, 92 shared, 23 E2E) | Daniel Ávila (con IA) |
| 1.1.0 | 2026-11-11 | **v1 (Enmienda 003)**: FR-029 reescrito como acción en línea (la fila anterior afirmaba algo que la prueba no comprobaba); FR-048 pasa a V2; filas nuevas FR-053/054, FR-055 y autoría; FR-024 y FR-031/032 con evidencia de `supervision.spec.ts`; volumen 463 tests (224 backend, 138 frontend, 78 shared, 23 E2E) | Daniel Ávila (con IA) |
| 1.0.10 | 2026-10-14 | **TSK-AUTH-008 / issue #128 resuelto**: FR-023 acredita acceso a conflictos de `supervisor`/`tenant_admin`, denegación a `field_worker`/`platform_admin` y aislamiento RLS en `backend/test/conflicts.spec.ts`; backend actualizado a 188 tests, total 391 con 17 E2E | Daniel Ávila |
| 1.0.9 | 2026-10-14 | **FR-034 implementado** (georreferencia opcional): migración `1730000011000_inspection_location.js` (`location_lat`/`location_lon` NUMERIC), contrato aditivo `SyncInspectionPayload.location`, validación server-side, captura opcional con `navigator.geolocation` al enviar inspección; nueva fila FR-034 en matriz §3 (🟢) sobre la base 1.0.8: recuento a 🟢37/🟡1/⚪1 (37/39 = 94,9%); volumen backend 187 · frontend 109 · total 390 (refs #7) | Daniel Ávila |
| 1.0.8 | 2026-10-14 | **FR-041 + FR-042 implementados y verificados**: filtro por autor (`autor_id` en findings, `autores` en summary, UI) y test del CSV del cliente (`frontend/src/lib/dashboard-csv.ts` + `frontend/test/dashboard-csv.test.ts`); recuento a 🟢36/🟡1/⚪1 (36/38 = 94,7%); volumen backend 184 · frontend 109 · total 387 (refs #8) | Daniel Ávila |
| 1.0.7 | 2026-10-14 | **FR-017 implementado** (dejó de ser simulado): cuota real vía `navigator.storage.estimate()` con aviso al 80% y priorización de fotos ya sincronizables; nueva fila FR-017 en la matriz §3 (🟢); recuento conjunto con el módulo 001: 38 filas · 🟢34/🟡2/⚪2; volumen actualizado (backend 183, frontend 105) (refs #5) | Daniel Ávila |
| 1.0.6 | 2026-10-14 | Cobertura del módulo **001** (autenticación y tenancy): filas **FR-001**, **FR-003**, **FR-004** y **FR-006** en la matriz §3 con evidencia de `backend/test/auth.spec.ts` (login/JWT, rotación y reuso del refresh, bloqueo) y el caos 6 (`e2e-caos-sync.spec.ts`); FR-005 se detalla (por cuenta **y** por IP); recuento a 37 filas (refs #4) | Raúl González |
| 1.0.5 | 2026-10-14 | **NFR-07 cerrado**: harness de rendimiento propio (`frontend/scripts/check-lighthouse.mjs` + workflow `lighthouse.yml`, patrón `check-pwa.mjs`) que mide el build en perfil móvil y exige Performance ≥ 80; se quita ExcelJS del chunk inicial (import profundo `@terreno/shared/xlsx/serializar`) y se difieren las pantallas pesadas; fila NFR-07 de la matriz §3 pasa a 🟢 (refs #9) | Raúl González (con IA) |
| 1.0.4 | 2026-10-13 | Cobertura del módulo **006** (administración de plataforma): filas **FR-050** y **FR-051** (`admin`) en la matriz §3 con evidencia de `backend/test/admin.spec.ts` (16 tests); recuento actualizado a 33 filas y volumen de la corrida de referencia (backend 181, frontend 98, shared 77) (refs #9, #116) | Raúl González (con IA) |
| 1.0.0 | 2026-09-14 | Plan inicial derivado del spec maestro v1.0.0 | Raúl González (con IA) |
| 1.0.1 | 2026-10-08 | Cobertura del módulo 007: matriz §3 (FR-007/008/009, 018/019, 027/028/029, 036/037/038/039, 044–049) y caos 8–11 (TSK-FORM-011) | Raúl González (con IA) |
| 1.0.3 | 2026-10-13 | **Evidencia de validación ejecutada** (closes #10, #12): harness E2E con `@playwright/test` (perfil móvil, `frontend/e2e/` + `playwright.config.ts`, workflow nightly `e2e.yml` que **no** bloquea PRs); matriz §3 reescrita con la evidencia real por fila (26/29 en verde = 89,7%, techo 96,6% dentro del harness); caos **1–7 automatizados y en verde** (el de red-team cerró #12 con seis defectos de la app, dos de ellos impedían el arranque: `Transaction committed too early` en una transacción Dexie y el `template_item_id` no-UUID de la semilla que rompía el primer sync) | Raúl González (con IA) |
| 1.0.2 | 2026-10-12 | Fila explícita **FR-038** (congelado de la versión en la inspección) y alineación de la versión de cabecera con el changelog (refs #98) | Daniel Ávila |
