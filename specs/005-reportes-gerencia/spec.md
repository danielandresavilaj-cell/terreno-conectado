# SPEC 005 — Reportes y gerencia

| | |
| :--- | :--- |
| **Estado** | COMPLETO (ciclo del módulo, F2 · 2026-10-13) |
| **Versión** | 0.9.0 |
| **Autor** | Daniel Ávila |
| **Padre** | specs/000-master/spec.md |
| **Depende de** | 003 (datos sincronizados + `SYNC_LOG`), 004 (dominio) |
| **Bloquea a** | Demo final (el dashboard es la prueba de la promesa: datos al día en ≤ 60 s tras reconexión) |
| **Plan técnico** | `plans/005-reportes-gerencia/plan.md` |

> El dashboard es la cara leída del sistema: **read-only** sobre lo sincronizado, con RLS por tenant (Art. IV) y latencia medida como `synced_at − captured_at` (FR-040/NFR-03).

## 1. Alcance

Requisitos que este spec detalla: **FR-040 → FR-043** y soporte a **NFR-03**.

- **FR-040** Dashboard por tenant: inspecciones del período por estado, hallazgos por severidad, pendientes de sync, conflictos pendientes y **latencia media captura→disponibilidad**.
- **FR-041** Filtros: faena, rango de fechas, severidad, autor.
- **FR-042** Export de vistas y listados (CSV de la tabla de hallazgos en pantalla + documentos `.xlsx` del período).
- **FR-043** Visibilidad ≤ 60 s tras sincronización.

## 2. Estado de implementación

> **Actualización v1 (2026-11-11, Enmienda 003).**
> - **FR-040:** "pendientes de sincronización conocidos" se reemplaza por **conflictos sin revisar** (`conflictos_pendientes` cuenta `reviewed_at IS NULL`).
> - **FR-042:** la exportación es XLSX (documento rellenado, individual y por lote ZIP) + CSV de hallazgos; no hay CSV de inspecciones (Enmienda 003).
> - **Contrato faltante en §3:** `GET /api/v1/dashboard/inspections/:id` devuelve el detalle auditable de una inspección (respuestas por sección, autor, estado).
> - Sin red, el dashboard lo dice explícitamente y muestra la última lectura.

Verificado sobre `main` al 2026-10-13.

| Requisito | Estado | Evidencia |
| :--- | :--- | :--- |
| FR-040 métricas del período | ✅ | `dashboard.service.ts:82-171` (estados, severidad, latencia, syncs, conflictos, urgentes) |
| FR-041 filtros faena/fecha | ✅ | `dashboard.contract.ts` (`dashboardFiltrosSchema`: `site_id`/`desde`/`hasta`) |
| FR-041 sev/estado | ✅ | `dashboard.service.ts` (`FindingsFiltros`: `severidad`/`estado`) + paginación |
| FR-041 filtro por **autor** | ✅ | `dashboard.contract.ts` (`findingsFiltrosSchema.autor_id`), `dashboard.service.ts` (filtra `inspection.executed_by`, agrega `autor_id` al DTO y `autores` al `summary`), `frontend/src/screens/Dashboard.tsx` (filtro por autor); `backend/test/dashboard.spec.ts` |
| FR-042 CSV de la vista | ✅ | `frontend/src/lib/dashboard-csv.ts` (`construirCsvHallazgos`: cabecera, escapado de comillas/comas, valores nulos) + `frontend/test/dashboard-csv.test.ts` |
| FR-042 documentos del período | ✅ | `dashboard.controller.ts` (`/inspections/:id/export` `.xlsx`, `/inspections/export-lote` ZIP) |
| FR-043 latencia ≤ 60 s | 🟡 | `dashboard.service.ts` mide media+p95 (FR-040); el número **se valida en vivo**, no automatizado (`test-plan.md` §3) |
| NFR-03 métrica de latencia | ✅ | media + `p95` por lote (`percentile_cont(0.95)`, `dashboard.service.ts:109-120`) |

## 3. Contratos de API

Todos bajo `/api/v1`, con Bearer JWT y roles `supervisor`/`tenant_admin` (`field_worker` no ve el dashboard). El tenant sale siempre de las claims; RLS por `tenant_id`.

| Endpoint | Verbo | Para qué |
| :--- | :--- | :--- |
| `dashboard/summary` | GET | FR-040: conteos por estado/severidad, latencia media+p95, syncs, conflictos, urgentes |
| `dashboard/findings` | GET | FR-041: listado paginado de hallazgos (`site_id`/`desde`/`hasta`/`severidad`/`estado`/`autor_id`) |
| `dashboard/inspections` | GET | FR-041/FR-044: lista de inspecciones del período |
| `sites` | GET | Faenas del tenant + nombre del tenant (bootstrapea el filtro y la captura offline) |
| `dashboard/inspections/:id/export` | GET | FR-042/FR-044: `.xlsx` rellenado + hoja de evidencias |
| `dashboard/inspections/export-lote` | POST | FR-045/FR-046: ZIP del período + manifiesto (filtro en el body) |
| `dashboard/inspections/:id` | GET | Detalle para revisión: respuestas con la definición congelada, firmas y, desde TSK-REP-008, `foto_id` por respuesta y la lista `hallazgos` (severidad, estado, ítem de origen y `foto_id`) |
| `dashboard/bitacora` | GET | FR-063: entradas de bitácora de la empresa, más recientes primero, con autor y faena (`site_id`/`desde`/`hasta`, `limit` ≤ 100, `offset`). Roles: `field_worker`, `supervisor`, `tenant_admin` |
| `dashboard/attachments/:id` | GET | FR-062: bytes de una foto de respuesta o de hallazgo (`image/jpeg`, `image/png` o `image/webp`), con `nosniff` y caché privada de 1 h. Otra empresa o id inexistente → 404; archivo ausente en el volumen → 404 con el motivo |
| `conflicts` | GET | Registro LWW visible al `supervisor` y `tenant_admin` de su tenant (FR-023 consume aquí; RLS limita el tenant) |

### 3.1 Validación de filtros

`dashboardFiltrosSchema` (Zod) es el **único** validador de `site_id`/`desde`/`hasta` del módulo: `site_id` debe ser UUID, las fechas deben parsear. Un filtro mal escrito devuelve 400 con el mismo mensaje en **todos** los endpoints (no sólo el primero), y nunca degrada a "sin rango" (lo que devolvería todo el período).

### 3.2 Firmas del resumen (`DashboardSummary`)

`inspecciones_por_estado` (`draft`/`in_progress`/`submitted`/`reviewed`), `hallazgos_por_severidad` (`low`/`medium`/`high`/`critical`), `hallazgos_urgentes` (`high`+`critical` no resueltos, FR-035), `hallazgos_total`, `latencia_media_seg`, `latencia_p95_seg`, `conflictos_pendientes`, `sincronizaciones`, `faenas`.

## 4. Dashboard de supervisión v1.1 (TSK-REP-006, Enmienda 004)

La métrica anterior `synced_at − captured_at` se **retira**: mezclaba el tiempo sin señal con el de sincronización y restaba dos relojes distintos (dispositivo y servidor). Toda duración se calcula ahora con **un solo reloj**.

`GET /api/v1/dashboard/supervision?site_id=&desde=&hasta=` (supervisor y `tenant_admin`, con RLS) devuelve `DashboardSupervision` (`shared/src/dashboard.ts`) en 4 bloques:

| Bloque | Métrica | Fórmula |
| :--- | :--- | :--- |
| Hallazgos | Abiertos por antigüedad (≤1 d, 1–7 d, >7 d) | `now() − finding.captured_at` de los no resueltos (backlog actual, sin filtro de período) |
| | Críticos/altos abiertos | top 10 por antigüedad |
| | Tiempo de cierre (media, p50) | `finding.resolved_at − captured_at`, resueltos en el período |
| | Top 5 ítems "No OK" | `inspection_response.value_ok = 'nok'` por `template_item_id` |
| Revisión | Pendientes, más antigua, mediana | inspecciones `submitted`; días desde `COALESCE(synced_at, captured_at)` |
| Actividad | Por día, por faena, por trabajador | serie diaria en `America/Santiago` con días en cero; faenas con 0 = sin actividad |
| Sincronización | Espera sin señal (p50, p95) | `inspection.client_sent_at − queued_at` (reloj del dispositivo) |
| | Procesamiento p95 (NFR-03 ≤ 60 s) | `sync_log.finished_at − started_at` (reloj del servidor) |
| | % lotes con error | `failed`/`partial` sobre lotes del período |
| | Equipos inactivos | último `sync_log` por `device_id` (30 días) con ≥ 24 h sin sincronizar |

Sin muestras se informa "sin datos suficientes". La espera sin señal solo existe para inspecciones enviadas por clientes v1.1 (`SyncRecord.queued_at`, `SyncBatchRequest.sent_at`, migración 016).

### 4.1 Evidencia visible (TSK-REP-008, FR-062, Enmienda 008)

El listado de hallazgos muestra la **miniatura** de la foto en vez de su tamaño en KB, y el detalle de una inspección muestra la foto de cada respuesta y cada hallazgo junto al ítem que lo originó (los hallazgos sin ítem van en "Otros hallazgos"). Tocar la miniatura abre la foto a tamaño completo; se cierra con el botón, Escape o el botón Atrás del teléfono.

- **Carga:** la miniatura se baja sólo cuando entra en pantalla y queda en una caché en memoria (40 fotos, se descarta la menos usada), para que el refresco de 30 s no vuelva a pedirlas. Un fallo no se recuerda: se ofrece reintentar.
- **Seguridad:** la sesión viaja en la cabecera `Authorization`, así que la imagen no es un enlace que se pueda compartir; el servidor responde con el tipo de imagen explícito y `X-Content-Type-Options: nosniff`.
- **Varias fotos (TSK-OFF-016):** el listado de hallazgos y el detalle muestran hasta 3 miniaturas por hallazgo y un contador del resto. El contrato trae `fotos_ids` (todas, de la más antigua a la más reciente) además de `foto_id` (la más reciente). De cada respuesta de tipo foto se sigue mostrando la más reciente.

### 4.2 Bitácora legible (TSK-REP-009, FR-063, Enmienda 008)

La bitácora se escribía en el dispositivo y se sincronizaba, pero ninguna pantalla la mostraba a otra persona. Ahora:

- **Bitácora → "De la faena":** quien entra al turno lee lo que escribió el equipo en su faena los últimos 7 días. "Mis entradas" sigue siendo lo escrito en ese teléfono y funciona sin señal; "De la faena" necesita conexión y lo dice si no la hay.
- **Gerencia → "Bitácora del equipo":** las 20 entradas más recientes con el mismo período y faena del panel; con "Todas las faenas" cada entrada muestra la suya.
- El período móvil se congela entre refrescos del panel para no volver a pedir la bitácora en cada render.

### 4.3 Gerencia en el teléfono (TSK-REP-010)

La lista de inspecciones del período se apila como tarjetas en pantallas angostas (casilla a la izquierda; formulario, faena, autor, estado, respuestas, fecha y acciones en una columna) y vuelve a la tabla desde 1024 px. Antes tenía 870 px mínimos y se desbordaba en el teléfono.

### 4.4 Métricas que piden una decisión (TSK-REP-011, FR-040/064)

La fila principal de Gerencia muestra: **Por revisar** (inspecciones enviadas sin revisar y la más antigua), **Hallazgos urgentes** (alta o crítica sin resolver), **Plazos vencidos** (acciones correctivas abiertas con plazo pasado; `summary.hallazgos_vencidos`, sin recorte de período porque es deuda abierta, sí por faena) e **Inspecciones**. La latencia de procesamiento sigue en el bloque de sincronización. El listado de hallazgos tiene el atajo "Sólo vencidos".

### 4.5 Tendencia y filtros en una barra (TSK-REP-012, FR-040/041)

- **Tendencia:** `summary.tendencia_semanal` trae las últimas 8 semanas (lunes a domingo en UTC del servidor, de la más antigua a la actual) con inspecciones y hallazgos. Se filtra por faena y **no** por el período elegido, para que la tendencia se lea igual con cualquier filtro. Gerencia la muestra como barras con los números al lado; la semana en curso se rotula "Esta".
- **Filtros:** faena, severidad y autor quedan en una sola barra de selectores sobre las métricas (antes eran tres columnas de tarjetas a mitad de página). El autor es un solo filtro para hallazgos e inspecciones; formulario y estado siguen junto a la lista de inspecciones.

## 5. Export (FR-042)

- **CSV de la vista:** en el cliente, `frontend/src/lib/dashboard-csv.ts` serializa **exactamente lo filtrado en pantalla** (columnas `id, severidad, estado, faena, autor, capturado_at`, `text/csv;charset=utf-8`, escapado de comillas).
- **Documentos `.xlsx`:** en el servidor, la exportación de una inspección usa la **versión congelada** de su plantilla (FR-028) para mapear ítem→respuesta, no la última publicada; el lote del período viaja como ZIP con `manifesto.json` (filtros, pedidas/exportadas/fallidas y motivo por fallo).

- **Exportar inspecciones (TSK-REP-007, Enmienda 005):** `POST /api/v1/dashboard/inspections/exportar` con el filtro de la lista (`site_id`, `desde`, `hasta`, `template_id`, `status`, `autor_id`) o la selección (`ids`, siempre dentro de RLS) y un `formato`:

  | Formato | Resultado | Tope |
  | :--- | :--- | :--- |
  | `xlsx_consolidado` | Un `.xlsx`: hoja **Resumen** (una fila por inspección, enlazada a su detalle), **una hoja por formulario** (filas = inspecciones, columnas = preguntas por sección, unidas por id de ítem entre versiones; No OK destacado), **Hallazgos** y **Evidencias** (≤ 512 kB incrustada). Funciona con cualquier plantilla. | 500 |
  | `pdf` / `docx` | Informe con portada (filtro y resumen) y una inspección por página (respuestas, hallazgos, fotos). `agrupar`: `un_archivo` o `zip` (uno por inspección). | 100 |
  | `xlsx_original` | El ZIP de originales rellenados (sólo plantillas importadas desde `.xlsx`). | 50 |

  Sobre el tope → 413 con el motivo; filtro vacío → 404; una inspección ilegible se omite y se cuenta (`X-Export-Fallidas`); si fallan todas → 422. Cada exportación queda en `audit_log` (`inspection_export`, FR-047). La lista acepta los mismos filtros y el dashboard suma los períodos "Este mes", "Mes anterior" y un rango libre, casillas para elegir y un panel de formato.

## 6. Criterios de aceptación

- Matriz §3 de `test-plan.md`: filas **FR-040/043** con `backend/test/dashboard.spec.ts`; la latencia ≤ 60 s se mide en vivo (🟡).
- Un `field_worker` recibe 403 en todo endpoint del dashboard; un `supervisor` de otro tenant no ve nada del ajeno (RLS, Art. IV).
- Un filtro inválido (`site_id` no-UUID, fecha no parseable) devuelve 400 con el mismo motivo en `summary`, `findings` e `inspections`.
- El CSV exporta la tabla con los filtros aplicados; el `.xlsx` de una inspección respeta su versión congelada.
- `latencia_media_seg`/`latencia_p95_seg` son `null` cuando no hay datos, nunca `0` inventado.

## 7. Resumen ejecutivo (G3)

El alcance V1 del **resumen ejecutivo** es **read-only** y se apoya en las métricas que ya expone el dashboard (FR-040): inspecciones por estado, hallazgos por severidad, hallazgos urgentes, latencia media+p95 y conflictos pendientes. No se agrega una pantalla nueva: el supervisor usa el dashboard como el resumen operativo de la faena.

- **V1 (dentro del alcance):** KPIs derivados de `DashboardSummary` (§3.2) y el listado de hallazgos filtrado; export CSV de la vista (FR-042) para compartir con gerencia.
- **Post-V1 (fuera del alcance):** resumen redactado por IA a partir de los mismos datos. Queda registrado como evolución futura (spec maestro §10 excluye "Analítica con IA" en V1).
- **Por qué no entra en V1:** costo de API de LLM (choca con NFR-08, ≤ US$7/mes), privacidad multi-tenant (datos de un cliente saliendo hacia un proveedor externo — a evaluar contra Artículo IV/NFR-06) y carga de trabajo del equipo (Artículo V).
- **Cuándo reabrirlo:** si el equipo lo decide, como enmienda al spec maestro (Artículo X) después de cerrar el walking skeleton, con costos y privacidad resueltos.

> Nota: la IA sí participa en V1 como **probador adversarial** (red-team cross-model, `test-plan.md` §5, Artículo VII).

## 8. Referencias

- `specs/000-master/spec.md` §3.3 (FR-040…043), §7 (NFR-03)
- `data-model.md` §2.2, §4 (integridad), §4.3 (`SYNC_LOG`)
- `test-plan.md` §3 (matriz FR-040/043), §4 (caos 1–7)
- `frontend/src/screens/Dashboard.tsx`, `frontend/src/screens/Conflictos.tsx`
- `plans/005-reportes-gerencia/plan.md`

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.9.0 | 2026-11-14 | **TSK-REP-012:** `summary.tendencia_semanal` (8 semanas) y filtros de faena, severidad y autor en una barra | Daniel Ávila (con IA) |
| 0.8.1 | 2026-11-14 | **TSK-OFF-016:** `fotos_ids` en hallazgos del listado y del detalle; hasta 3 miniaturas por hallazgo | Daniel Ávila (con IA) |
| 0.8.0 | 2026-11-13 | **TSK-REP-011:** "Plazos vencidos" reemplaza a la latencia en la fila principal; `summary.hallazgos_vencidos`; filtro "Sólo vencidos" | Daniel Ávila (con IA) |
| 0.7.1 | 2026-11-13 | **TSK-REP-010:** lista de inspecciones apilada en pantallas angostas | Daniel Ávila (con IA) |
| 0.7.0 | 2026-11-13 | **TSK-REP-009 (Enmienda 008, FR-063):** bitácora legible en Bitácora ("De la faena") y en Gerencia; contrato `dashboard/bitacora` | Daniel Ávila (con IA) |
| 0.6.0 | 2026-11-13 | **TSK-REP-008 (Enmienda 008, FR-062):** la evidencia fotográfica se ve en el listado de hallazgos y en el detalle de la inspección; contratos `dashboard/attachments/:id` y detalle con `foto_id`/`hallazgos` | Daniel Ávila (con IA) |
| 0.5.0 | 2026-11-11 | **TSK-REP-007:** exportación en Excel consolidado, PDF y Word con filtros ampliados y selección (§5, Enmienda 005) | Daniel Ávila (con IA) |
| 0.4.0 | 2026-11-11 | **TSK-REP-006:** dashboard de supervisión en 4 bloques (§4); se retira la latencia captura→disponible y NFR-03 pasa a medir el procesamiento del lote (Enmienda 004) | Daniel Ávila (con IA) |
| 0.3.2 | 2026-10-14 | Precisa el contrato de `GET /conflicts`: supervisor y `tenant_admin` del tenant, con aislamiento RLS (TSK-AUTH-008, issue #128) | Daniel Ávila |
| 0.3.1 | 2026-10-14 | **G3 (resumen ejecutivo) y cierre TSK-REP-003:** §7 define el resumen ejecutivo V1 como read-only sobre KPIs del dashboard; TSK-REP-003 verificado (métrica de latencia media+p95 en `backend/test/dashboard.spec.ts`, umbral ≤60 s medido en vivo). Actualiza referencia del CSV a `frontend/src/lib/dashboard-csv.ts` (refs #8) | Daniel Ávila |
| 0.3.0 | 2026-10-14 | **FR-041 filtro por autor implementado y FR-042 CSV testeado.** `dashboard/findings?autor_id=` filtra por `inspection.executed_by`; `summary.autores` publica los autores con actividad del período para poblar el filtro; `FindingDto.autor_id`; UI con filtro por autor; CSV de hallazgos extraído a `frontend/src/lib/dashboard-csv.ts` con tests unitarios. Pasa de 🟡 a ✅ (FR-041) y de ⚪ a ✅ (FR-042). Ver `tasks/005-reportes-gerencia/tasks.md` TSK-REP-004 / TSK-REP-005 | Daniel Ávila |
| 0.2.0 | 2026-10-13 | **Spec completado (F2).** Documenta el estado real de FR-040…043 y NFR-03: métricas, contratos del dashboard, validación única de filtros, métrica de latencia (media+p95) y export (CSV cliente + `.xlsx` servidor). Registra FR-041 autor y FR-043 ≤60 s como 🟡 (parcial / medido en vivo). Apunta al plan técnico | Daniel Ávila |
| 0.1.1 | 2026-09-24 | Se documenta "resumen ejecutivo generado por IA" como evolución post-V1 (fuera de alcance, decisión del equipo) | Raúl González (con IA) |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Daniel Ávila (con IA) |
