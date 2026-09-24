# PLAN — Iteración 0: Walking skeleton (MVP vertical)

**Versión:** 0.1.0 · **Fecha:** 2026-09-24 · **Autor:** Raúl González (infra/validación)
**Derivado de:** `specs/000-master/spec.md` §9 (MVP) · **Relacionado:** ADR-001, ADR-002, `data-model.md`, `test-plan.md`
**Tareas:** `tasks/000-walking-skeleton/tasks.md` (TSK-WS-001 → 012)

> **Qué es este plan:** el *cómo* del primer corte vertical del sistema. No describe todo el producto — describe lo mínimo que atraviesa todas las capas (dispositivo → sync → backend → dashboard) y demuestra la promesa de punta a punta (Artículo III).

## 1. Objetivo

Dejar operativo, en una sola iteración, el bucle completo del spec maestro §9: un `field_worker` captura una inspección + hallazgo + bitácora **en modo avión**, la cola sincroniza sola al recuperar señal, y el supervisor ve el hallazgo crítico destacado en el dashboard en **≤ 60 s**. Con aislamiento multi-tenant demostrado en vivo (paso 5 del §9) y conflicto LWW auditado (paso 6).

## 2. Orden de construcción (no es el orden de los números — es el orden de dependencias)

```
TSK-001 monorepo ──► TSK-002 Postgres+RLS ──► TSK-003 auth
                                      │
TSK-004 PWA shell ────────────────────┴──────────► TSK-005 captura offline ──► TSK-006 fotos
                                                                                      │
TSK-007 ingest batch (backend) ◄────────── TSK-008 worker cola (cliente)              │
      │                                              │                                │
      ├────► TSK-009 LWW+conflictos                   │                                │
      └────► TSK-010 cross-tenant                      │
                                                       ▼
                                   TSK-011 dashboard  ◄──  TSK-008/009
                                   TSK-012 /health (transversal, con TSK-002/003)
```

1. **TSK-001** — el monorepo es el suelo de todo.
2. **TSK-002 → TSK-003** — primero la base de datos con RLS y las semillas (data-model §5), luego quien puede tocar qué datos (auth). Nada de código de dominio antes de saber que los datos están aislados (Artículo IV).
3. **TSK-004 → TSK-005 → TSK-006** — el cliente offline: primero el shell que aguanta sin red, luego los formularios que escriben en Dexie, luego las fotos comprimidas (FR-012).
4. **TSK-007 y TSK-008 juntos** — el corazón (spec 003): el backend acepta lotes idempotentes y el cliente los manda solos. Estas dos tareas se desarrollan y prueban como una sola unidad; son las que cargan con más pruebas de caos.
5. **TSK-009 y TSK-010** — los invariantes difíciles: qué pasa cuando dos dispositivos chocan (LWW determinista) y cómo rechazamos al que no pertenece al tenant (FR-025).
6. **TSK-011** — el dashboard demuestra la promesa; **TSK-012** es transversal y barato (lo hace cualquiera).

## 3. Decisiones técnicas previas (se cierran aquí, antes de codificar — Artículo II)

1. **Tie-breaker LWW determinista (TSK-009):** ante `captured_at` iguales, gana el mayor `client_version`; si también empatan, mayor UUIDv7 (orden lexicográfico). Esto hace la resolución **reproducible** ante relojes desviados (test-plan §5, caso adversarial). Queda documentado como criterio en el spec 003 cuando se detalle.
2. **Refresh token en PWA (TSK-003):** decisión pendiente de elegir — las opciones (cookie httpOnly + CSRF vs storage cifrado vs SW-only) se documentarán en el spec 001 antes de implementar; esta iteración puede comenzar con access-token en memoria + refresh en storage temporal, marcado explícito en el plan.
3. **Solo un idioma y toolchain (TSK-001):** pnpm workspaces, TypeScript en ambos extremos, DTOs compartidos en un paquete `shared/` — coherente con ADR-001.
4. **El orden de dependencias del batch (TSK-007):** `site → inspection → responses → findings → attachments` fijo (data-model.md §4.2, FR-020).

## 4. Riesgos y mitigaciones

| Riesgo | Prob. | Mitigación |
| :--- | :---: | :--- |
| Sync es la parte más difícil (spec 003 es el corazón) | Alta | Se desarrolla junto (TSK-007+008) y se prueba con caos desde el primer día (test-plan §4), no al final |
| Bootstrap NestJS consume tiempo de ceremonia (DI/módulos) | Media | Plantilla base lista en TSK-001; se documenta en ADR-001 consecuencias |
| Relojes de dispositivo desviados rompen LWW | Media | Tie-breaker determinista (decisión 3.1) + prueba adversarial desde el inicio |
| PWA no sobrevive el cierre hostil de la app | Media | Transacciones Dexie atómicas en TSK-005; caos escenario 4 |
| Push directo a `main` sin CI → regresión silenciosa | Alta | **Pendiente no técnico:** regenerar token con scope `workflow` y reactivar `.github/` (hoy excluido, .gitignore) |

## 5. Definición de "hecho" para la iteración

- Guion §9 del spec maestro completo en vivo (6 pasos).
- Caos 1–3 verdes con 0 pérdida ∧ 0 duplicación; aislamiento en vivo (paso 5).
- Todos los commits referencian TSK (Artículo II) y toda tarea completa referencia su FR/NFR.

## 6. Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-09-24 | Plan inicial de la iteración 0 (walking skeleton) derivado del spec maestro §9 | Raúl González (con IA) |