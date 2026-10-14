# Presentación final — Terreno Conectado

> SaaS offline-first para faenas mineras y obras.

---

## 1. La promesa

**"Datos al día donde no hay señal"**

- Captura en terreno **sin red**.
- Sincronización automática al reconectar.
- Dashboard del supervisor con hallazgos y métricas en ≤ 60 s.

---

## 2. Problema

- Las faenas mineras y obras carecen de conectividad estable.
- Los sistemas actuales dependen de la nube para capturar.
- Pérdida de datos, duplicados y retrasos en la toma de decisiones.

---

## 3. Solución: Terreno Conectado

| Capa | Tecnología | Rol |
| :--- | :--- | :--- |
| Cliente | PWA React + Dexie + Workbox | Captura offline, cola local |
| API | NestJS + PostgreSQL 16 + RLS | Ingesta idempotente, aislamiento multi-tenant |
| Shared | TypeScript + Zod | Contratos y validación única |
| Deploy | VPS + Docker + Caddy | HTTPS ≤ US$7/mes |

---

## 4. Arquitectura clave

- **Offline-first:** IndexedDB como fuente de verdad local.
- **Sync idempotente:** UUIDv7 de cliente + `client_version`.
- **LWW determinista:** `captured_at` → `client_version` → UUID mayor.
- **Seguridad:** RLS de Postgres por `tenant_id`, no filtros en app.

---

## 5. Demo en vivo (guion)

1. Iniciar inspección con la red apagada.
2. Responder ítems, adjuntar foto comprimida, crear hallazgo.
3. Apagar/reducir red, reanudar sin pérdida.
4. Reconectar: sync automático, dashboard actualizado.
5. Exportar CSV de hallazgos.

---

## 6. Validación

- **390 tests** unitarios + integración tras mergear los PRs de cierre pendientes.
- **17 escenarios E2E/caos** (Playwright).
- Caos 1–7: **0 pérdidas, 0 duplicados, 0 fugas cross-tenant**.
- Matriz §3: **94,9 % verde** proyectado tras integrar FR-017/041/042/034.

---

## 7. Huecos cerrados en F2

| Hueco | Solución |
| :--- | :--- |
| FR-017 cuota simulada | `navigator.storage.estimate()` + priorización de fotos |
| FR-041 filtro por autor | `autor_id` en findings + `summary.autores` |
| FR-042 CSV sin test | `dashboard-csv.ts` + tests unitarios |
| FR-034 geo no implementado | `location_lat`/`location_lon` + captura opcional |

---

## 8. Decisiones de arquitectura

- Geolocalización **sin PostGIS** en V1.
- Resumen ejecutivo V1 **read-only** sobre KPIs del dashboard.
- Delta de plantillas por `published_seq` global.
- Deploy mínimo con Caddy + Let's Encrypt.

---

## 9. Próximos pasos

1. Revisar y mergear PRs #121, #123 y #124; consolidar matriz y conteos.
2. Configurar VPS/dominio/secrets y ejecutar el deploy manual (#127, ADR-002).
3. Demo final ante el docente.
4. Entregar evidencias académicas en Capstone.

---

## 10. Cierre

**Terreno Conectado — captura donde no hay señal, decide con datos al día.**

- Repo: `github.com/danielandresavilaj-cell/terreno-conectado`
- Equipo: Daniel Ávila · Raúl González
