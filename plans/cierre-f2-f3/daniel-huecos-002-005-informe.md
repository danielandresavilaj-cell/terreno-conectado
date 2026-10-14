# BRIEF — Track B · Daniel: huecos 002/004/005 → cierre de F2 → informe y presentación

**Versión:** 0.1.0 · **Fecha:** 2026-10-14 · **Autor:** Daniel Ávila
**Tarjetas:** #5 (002) · #7 (004) · #8 (005) · #2 (F2) · #15 (F3) · #3/#29 (cierre) · **Plan padre:** `plan.md`
**Riesgo principal:** Art. III (el campo geo de FR-034 entra por el contrato de sync). Puerta de salida: nightly 17/17.

## Objetivo

Cerrar los **huecos de código reales** de los módulos 002/004/005 (hoy maquillados como verdes), llevar la **matriz §3 a ≥ 90%**, cerrar los epics documentales y consolidar la **Fase 3** (informe final + presentación + §12).

## Zona (solo Daniel)

`frontend/src/lib/**` · `frontend/src/screens/**` · `frontend/test/**` · `backend/src/dashboard/**` · `backend/src/sync/**` · `backend/test/dashboard.spec.ts` · `specs/002`, `specs/004`, `specs/005` · `plans/004-*`, `plans/005-*` · `tasks/002-*`, `tasks/004-*`, `tasks/005-*` · `docs-evidencia/**` · `data-model.md` (FR-034) · `specs/000-master/spec.md` §12 · migraciones `1730000011*` · filas 002/004/005 de `test-plan.md` y sección §12 del `README.md`. **No tocar** nada de la zona de Raúl (§Reglas de no-colisión del plan).

## Fase 2 — cierre de huecos

### B1 · FR-017 real (módulo 002) — aviso de cuota
Hoy `CUOTA={usadaPct:83, fotosPendientes:14}` es **fijo** (`frontend/src/lib/seed.ts:200`) y `cuotaAviso` se pone `true` por un **fallo de sync** (`store.tsx:274`), no por cuota.

- Calcular el % real con `navigator.storage.estimate()` (`usage/quota`), con fallback si no está disponible.
- Con **≥ 80%**: activar el aviso al trabajador y **priorizar la subida de fotos ya sincronizables** en el drenado del outbox.
- `frontend/src/screens/Cola.tsx` debe pintar el % **real**, no el seed.
- Corregir `specs/002` §2 (fila FR-017: hoy dice ✅) y **agregar la fila FR-017** a `test-plan.md` §3 (hoy no existe).
- Test unit en `frontend/test/` (Dexie/`fake-indexeddb` + stub de `navigator.storage`).

**Archivos:** `frontend/src/lib/store.tsx`, `frontend/src/lib/seed.ts`, `frontend/src/screens/Cola.tsx`, `frontend/test/**`, `specs/002/**`, `test-plan.md`.

### B2 · FR-041 filtro por autor (módulo 005) — implementar, no diferir
- Backend: extender `backend/src/dashboard/dashboard.contract.ts` y `dashboard.service.ts` (el DTO ya expone `autor`/`full_name`; falta el filtro y su SQL).
- Frontend: filtro por autor en `frontend/src/screens/Dashboard.tsx`.
- Prueba de integración en `backend/test/dashboard.spec.ts`.
- Actualizar `specs/005` §2 (fila FR-041 autor: 🟡→✅) y `plans/005-*` §3.1. Fila de `test-plan.md` §45: 🟡→🟢.

### B3 · FR-042 CSV (módulo 005) — prueba
- Agregar prueba automatizada de la serialización CSV de la vista (`frontend/src/screens/Dashboard.tsx` + `frontend/test/`): columnas, escapado de comillas, `charset=utf-8`.
- Fila `test-plan.md` §46: ⚪→🟢.

### B4 · FR-034 geolocalización opcional (módulo 004) — implementar
Hoy la columna **no existe**: `data-model.md` 1.1.3 retiró `inspection.geo` y la migración inicial la difiere. `specs/004` §2 la marca ✅ con evidencia falsa.

- **Sin PostGIS:** dos columnas numéricas `location_lat`/`location_lon` (NULL) en `inspection` (migración `1730000011000_*`, tu rango).
- **Campo aditivo** `location` opcional en el payload de sync (`shared/src/sync.ts`) y en el upsert de `backend/src/sync/sync.service.ts` (no rompe idempotencia; es solo otra columna).
- Cliente: captura **opcional** con `navigator.geolocation` en `frontend/src/screens/Captura.tsx` (permiso + fallback: si lo rechaza o no está, se captura sin geo). Persistir en el outbox (`frontend/src/lib/db.ts`).
- Corregir `specs/004` §2 (fila FR-034: evidencia real) y `data-model.md` §2.2 (vuelve la columna, como numeric). Test de integración (round-trip por el batch) + unit dcliente.
- **Hazlo el último de los huecos de código** y anúncialo en #10 para re-correr E2E.

### B5 · Cierre documental 004/005
- **TSK-DOM-003** (`tasks/004-*/tasks.md`): verificar FR-031/032 en la matriz §3 y la evidencia de FR-036/038/039 en §2. Cerrar **#7**.
- **TSK-REP-003**: confirmar métrica de latencia (media+p95, `dashboard.service.ts`); **≤ 60 s queda 🟡** (se mide en vivo en la demo). **TSK-REP-004**: queda **absorbido por B2** (se implementa, no se difiere).
- **G3 (issue #8):** decidir el reporte ejecutivo. **Recomendado:** entra en V1 con **alcance mínimo** — reusa los KPIs de FR-040 ya calculados en una vista *read-only* "Resumen ejecutivo"; la redacción por IA queda fuera (spec 005 §7). Documentar la decisión en `specs/005` y cerrar **#8**.
- Cerrar `tasks/` 004 y 005 (marcar TSK-DOM-003 / TSK-REP-003 / TSK-REP-004).

### B6 · Cierre de epics documentales
- **#3** iteración 0 (walking skeleton): marcar criterios cumplidos y cerrar.
- **#5** módulo 002: cerrar tras B1.
- **#29** módulo 007: V1 completa; cerrar (V2 sigue en #45).

### B7 · Matriz §3 ≥ 90%
- Recalcular el recuento de `test-plan.md` §3 tras B1–B4 y actualizar la nota de §8/techo (hoy dice que no se maquilla; ahora **sí** alcanza ≥90%).
- Confirmar CI 3/3 + nightly E2E 17/17.

## Fase 3 — informe y presentación (tras el HITO 2)

### B8 · Informe final
Consolidar en `docs-evidencia/informe-final/` (crear el directorio): specs por módulo, resultados del test-plan §3 (§matriz + caos 1–7), ADRs 001–003.

### B9 · Resultados de validación → presentación
Incorporar los resultados de validación al informe; preparar la **presentación de cierre** (1 semana por fase, informe APT).

### B10 · Mapeo de evidencia
Actualizar la tabla de mapeo **evidencia → artefacto** del `specs/000-master/spec.md` §12 y enlazarla desde el `README.md`.

## Orden de ataque

1. **B4 spec/docs primero** (Art. II): corrige spec 004/002/005 §2 + filas antes de tocar código.
2. **B1, B2, B3** (huecos independientes) → mergear cada uno con su test.
3. **B4** (geo) al final del código + aviso en #10.
4. **B5, B6, B7** (cierres + matriz).
5. **B8–B10** tras la congelación de código (HITO 2), en paralelo con el despliegue de Raúl.

## Definition of Done

- [ ] FR-017, FR-034 y FR-041 implementados con prueba (no mock, no diferido); FR-042 con prueba
- [ ] `specs/002/004/005` §2 sin filas ✅ falsas; `data-model.md` corregido
- [ ] `test-plan.md` §3 con FR-017/041/042 en verde y recuento **≥ 90%**
- [ ] #3, #5, #7, #8, #29 cerrados
- [ ] `docs-evidencia/informe-final/` consolidado + §12 actualizado + README enlazado
- [ ] CI 3/3 y nightly E2E 17/17 tras cada PR

## No tocar

`specs/001/**` · `plans/001-*` · `tasks/001-*` · `infra/**` · `package.json` raíz + `package-lock.json` (raíz; el lockfile del workspace se regenera por npm, no lo edites a mano) · `frontend/scripts/**` · `frontend/e2e/stack.mjs`.
