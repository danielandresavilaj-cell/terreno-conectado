# SPEC 005 — Reportes y gerencia

| | |
| :--- | :--- |
| **Estado** | COMPLETO (ciclo del módulo, F2 · 2026-10-13) |
| **Versión** | 0.3.1 |
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
| `conflicts` | GET | Registro LWW visible al supervisor (FR-023 consume aquí) |

### 3.1 Validación de filtros

`dashboardFiltrosSchema` (Zod) es el **único** validador de `site_id`/`desde`/`hasta` del módulo: `site_id` debe ser UUID, las fechas deben parsear. Un filtro mal escrito devuelve 400 con el mismo mensaje en **todos** los endpoints (no sólo el primero), y nunca degrada a "sin rango" (lo que devolvería todo el período).

### 3.2 Firmas del resumen (`DashboardSummary`)

`inspecciones_por_estado` (`draft`/`in_progress`/`submitted`/`reviewed`), `hallazgos_por_severidad` (`low`/`medium`/`high`/`critical`), `hallazgos_urgentes` (`high`+`critical` no resueltos, FR-035), `hallazgos_total`, `latencia_media_seg`, `latencia_p95_seg`, `conflictos_pendientes`, `sincronizaciones`, `faenas`.

## 4. Métrica de latencia (FR-040 / NFR-03)

`latencia = inspection.synced_at − inspection.captured_at`, donde el servidor fija `synced_at = now()` al **aplicar** la ingesta (`sync.service`). Se reporta **media** y **percentil 95** sobre las inspecciones con `synced_at IS NOT NULL`, respetando los filtros. Es la métrica que demuestra la propuesta de valor del informe APT (captura→disponibilidad).

> El p95 es la definición contractual para el informe final; la medición manual contra el umbral ≤ 60 s (FR-043) se registra en la demo (Fase 3) y queda como fila 🟡 en `test-plan.md` §3.

## 5. Export (FR-042)

- **CSV de la vista:** en el cliente, `frontend/src/lib/dashboard-csv.ts` serializa **exactamente lo filtrado en pantalla** (columnas `id, severidad, estado, faena, autor, capturado_at`, `text/csv;charset=utf-8`, escapado de comillas).
- **Documentos `.xlsx`:** en el servidor, la exportación de una inspección usa la **versión congelada** de su plantilla (FR-028) para mapear ítem→respuesta, no la última publicada; el lote del período viaja como ZIP con `manifesto.json` (filtros, pedidas/exportadas/fallidas y motivo por fallo).

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
| 0.3.1 | 2026-10-14 | **G3 (resumen ejecutivo) y cierre TSK-REP-003:** §7 define el resumen ejecutivo V1 como read-only sobre KPIs del dashboard; TSK-REP-003 verificado (métrica de latencia media+p95 en `backend/test/dashboard.spec.ts`, umbral ≤60 s medido en vivo). Actualiza referencia del CSV a `frontend/src/lib/dashboard-csv.ts` (refs #8) | Daniel Ávila |
| 0.3.0 | 2026-10-14 | **FR-041 filtro por autor implementado y FR-042 CSV testeado.** `dashboard/findings?autor_id=` filtra por `inspection.executed_by`; `summary.autores` publica los autores con actividad del período para poblar el filtro; `FindingDto.autor_id`; UI con filtro por autor; CSV de hallazgos extraído a `frontend/src/lib/dashboard-csv.ts` con tests unitarios. Pasa de 🟡 a ✅ (FR-041) y de ⚪ a ✅ (FR-042). Ver `tasks/005-reportes-gerencia/tasks.md` TSK-REP-004 / TSK-REP-005 | Daniel Ávila |
| 0.2.0 | 2026-10-13 | **Spec completado (F2).** Documenta el estado real de FR-040…043 y NFR-03: métricas, contratos del dashboard, validación única de filtros, métrica de latencia (media+p95) y export (CSV cliente + `.xlsx` servidor). Registra FR-041 autor y FR-043 ≤60 s como 🟡 (parcial / medido en vivo). Apunta al plan técnico | Daniel Ávila |
| 0.1.1 | 2026-09-24 | Se documenta "resumen ejecutivo generado por IA" como evolución post-V1 (fuera de alcance, decisión del equipo) | Raúl González (con IA) |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Daniel Ávila (con IA) |
