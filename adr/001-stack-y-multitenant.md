# ADR-001 — Stack tecnológico y estrategia multi-tenant

**Estado:** ACEPTADO (Daniel, 2026-09-14 — pendiente contraparte Raúl)
**Fecha:** 2026-09-14 · **Decisores:** Daniel Ávila, Raúl González
**Relacionado:** research.md (evaluación completa), spec maestro §7–8

## Contexto

Equipo de 2 estudiantes, ~11 semanas efectivas (Fase 2 del Gantt), otras asignaturas en paralelo. El sistema debe: operar 100% offline en terreno, sincronizar sin pérdida ni duplicación, y aislar datos de múltiples empresas cliente (SaaS multi-tenant). Presupuesto de infraestructura ≤ US$7/mes (Artículo VI).

## Decisión

1. **Un solo lenguaje: TypeScript full-stack** (monorepo pnpm workspaces, tipos compartidos frontend/backend).
2. **Frontend:** PWA React 18 + Vite + Dexie (IndexedDB) + Workbox. Cola de sync propia en el cliente.
3. **Backend:** monolito modular **NestJS** + REST. Endpoints de ingesta por lotes idempotentes.
4. **Base de datos:** **PostgreSQL 16** con **Row-Level Security** como mecanismo primario de aislamiento multi-tenant (`tenant_id` + `SET LOCAL app.tenant_id` por transacción; ver data-model.md §3).
5. **Sincronización:** implementación propia (cola Dexie + upsert por UUIDv7 cliente + LWW auditado con CONFLICT_RECORD). Sin BaaS de sync (PowerSync/ElectricSQL descartados).
6. **Fotos:** compresión en cliente; almacenamiento V1 en volumen Docker del VPS.
7. **Testing:** Vitest + Playwright + Testcontainers (detalle en test-plan.md).

## Alternativas consideradas

FastAPI (segundo lenguaje), Supabase (lock-in + pierde aprendizaje de backend), MongoDB/MySQL (sin RLS equivalente), PowerSync/ElectricSQL/CRDTs (delegan u over-engineering del núcleo), apps nativas (fuera de alcance). Evaluación ponderada completa en **research.md**.

## Consecuencias

**Positivas:** un toolchain/CI; el equipo aprende el problema central (sync) en vez de delegarlo; RLS da aislamiento verificable en CI; costo $0 en software.
**Negativas/riesgos:** la sync propia es la parte más difícil del proyecto → se mitiga empezando por el walking skeleton (spec maestro §9) y pruebas de caos desde la primera iteración; NestJS tiene ceremonia inicial (DI/módulos) → plantilla base en la primera task.
**Neutral:** si el proyecto escalara a producción real, la evolución natural (S3 para fotos, workers de cola, DB gestionada) está documentada y no requiere reescribir el dominio.
