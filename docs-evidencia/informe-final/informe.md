# Informe final de validación — Terreno Conectado

**Proyecto:** Terreno Conectado — SaaS offline-first para faenas mineras y obras.  
**Equipo:** Daniel Ávila · Raúl González.  
**Fase:** F2 — Diseño y desarrollo iterativo (cierre).  
**Fecha:** 2026-10-14.  
**Repo:** `https://github.com/danielandresavilaj-cell/terreno-conectado`

## 1. Resumen ejecutivo

El **walking skeleton** y los módulos críticos de la Fase 2 están implementados. Los cuatro últimos cierres de requisito están en PRs pendientes de aprobación/merge (#121, #123, #124); al integrarlos, el sistema captura inspecciones sin red, las encola localmente en IndexedDB y las sincroniza con PostgreSQL vía lotes idempotentes cuando vuelve la señal. El dashboard del supervisor visualiza hallazgos, métricas de latencia y exporta la vista a CSV.

Los huecos reales encontrados en la auditoría de cierre fueron cerrados:

| Hueco | Solución | PR |
| :--- | :--- | :--- |
| FR-017 cuota local simulada | Cuota real con `navigator.storage.estimate()`, aviso al 80 % y priorización de fotos | #121 |
| FR-041 filtro por autor | `autor_id` en `dashboard/findings`, `autores` en `summary`, filtro en UI | #123 |
| FR-042 CSV sin test | `frontend/src/lib/dashboard-csv.ts` + tests unitarios | #123 |
| FR-034 geo documentado pero no implementado | Columnas `location_lat`/`location_lon`, contrato sync aditivo, captura opcional con `navigator.geolocation` | #124 |
| TSK-AUTH-008 roles no canónicos en conflictos | `supervisor`/`tenant_admin`, prueba de roles y aislamiento RLS | #129 |

## 2. Alcance V1 cerrado

- **Auth/tenancy (001):** JWT con tenant claim, RLS de Postgres, refresh con rotación, rate-limit, bloqueo por intentos fallidos.
- **Captura offline (002):** PWA instalable, IndexedDB con Dexie, borradores, cámara con compresión, cola de sync.
- **Motor de sincronización (003):** batch idempotente, orden de dependencias, LWW con `captured_at`/`client_version`, log de sync.
- **Dominio inspecciones (004):** plantillas/revisiones, inspecciones con versión congelada, hallazgos, bitácoras, adjuntos, georreferencia opcional.
- **Reportes y gerencia (005):** dashboard con filtros, métricas de latencia (media+p95), export CSV, export `.xlsx`/ZIP.
- **Admin plataforma (006):** creación/suspensión de tenants, asignación de `tenant_admin`, audit log.
- **Formularios dinámicos (007):** importador `.xlsx`, 8 tipos de campo, delta de plantillas por `published_seq`.

## 3. Estado de la matriz de pruebas §3

**Proyección tras mergear #121, #123 y #124:**

- 39 filas · 🟢 37 (94,9 %) · 🟡 1 (2,6 %) · ⚪ 1 (2,6 %) · 🔴 0
- El único 🟡 es **FR-040/043 ≤ 60 s**, que se mide en vivo en la demo (Fase 3), no automatizado.
- El único ⚪ es **NFR-02/100-fotos** del caos 5 (las 100 fotos se verifican en el FR-012 unitario, no en el mismo escenario de 72 h).

Esto cumple el criterio de salida de F2: **matriz §3 ≥ 90 % verde**.

## 4. Resultados de pruebas

| Capa | Cantidad | Estado |
| :--- | :--- | :--- |
| E2E + caos (Playwright) | 17 tests | Verde en el nightly más reciente disponible (14-oct-2026) |
| Integración backend (Vitest + Testcontainers) | 188 tests | 184 tras TSK-AUTH-008 + 4 de PRs #123/#124 |
| Unidad frontend (Vitest) | 109 tests | Verde |
| Unidad shared (Vitest) | 77 tests | Verde |
| **Total** | **391 tests** | Proyección tras mergear #121/#123/#124/#129 |

Invariantes de caos 1–7: 0 pérdidas, 0 duplicados, 0 fugas cross-tenant.

## 5. Decisiones de arquitectura relevantes

- **Aislamiento multi-tenant por RLS de Postgres** (Art. IV), no por filtros en la app.
- **Sincronización offline-first:** la nube consolida, nunca es dependencia para trabajar (Art. I).
- **Idempotencia por UUIDv7 de cliente + `client_version`** (FR-021/023).
- **Acceso a conflictos por roles canónicos:** supervisor y tenant_admin, con aislamiento por RLS (TSK-AUTH-008).
- **Geolocalización sin PostGIS** en V1: columnas NUMERIC para mantener el despliegue mínimo.
- **Resumen ejecutivo V1 read-only** sobre KPIs del dashboard; IA redactada post-V1.

## 6. Huecos y deuda técnica

- FR-040/043 ≤ 60 s: medido en vivo; no automatizado por limitaciones del harness CI.
- NFR-02/100-fotos: el escenario de 72 h no verifica explícitamente las 100 fotos; se cubre unitariamente.
- Dependencias: hardening #84 mergeado en PR #126; quedan 2 moderadas `uuid`→`exceljs`, aceptadas y documentadas en ADR-004 (sin fix no-breaking).
- Despliegue: artefactos same-origin mergeados en #127; provisioning real y secretos/VPS quedan pendientes tras HITO 2.

## 7. Lecciones aprendidas

- Documentar un requisito como "hecho" sin prueba migratoria/contrato real genera huecos (FR-034, FR-041).
- El tablero de tareas y la matriz de pruebas deben actualizarse en el mismo PR que el código (Art. II/VIII).
- Las pruebas con Postgres real (Testcontainers) detectan errores de esquema que las pruebas en memoria no encuentran.

## 8. Enlaces a artefactos

- `specs/000-master/spec.md` — visión, FR/NFR, mapeo de evidencia §12.
- `test-plan.md` — matriz §3, caos §4, defectos §5.
- `data-model.md` — modelo de datos y políticas RLS.
- `adr/002-arquitectura-despliegue.md` — VPS + Caddy + HTTPS ≤ US$7/mes.
- `tasks/` — tareas por módulo.
- PR #119 — plan de cierre de F2 y transición a F3 (pendiente de revisión/merge).

## 9. Próximos pasos (Fase 3)

1. Aprobar y mergear PRs #121, #123, #124 y #129; consolidar `test-plan.md` y los conteos finales.
2. Completar HITO 2, configurar VPS/dominio/secrets y ejecutar deploy manual (#127).
3. Demo final en vivo: modo avión real, ≤ 60 s dashboard, caos 1–7.
4. Entregar informe, presentación y evidencias académicas en el repositorio Capstone.

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-10-14 | Borrador del informe final de F2 | Daniel Ávila |
