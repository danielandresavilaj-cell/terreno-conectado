# ADR-001 — Stack tecnológico y estrategia multi-tenant

**Estado:** ACEPTADO (Daniel Ávila, 2026-09-14 · Raúl González, 2026-09-24)
**Fecha:** 2026-09-14 · **Decisores:** Daniel Ávila, Raúl González
**Relacionado:** research.md (evaluación completa), spec maestro §7–8

## Contexto

Equipo de 2 estudiantes, ~11 semanas efectivas (Fase 2 del Gantt), otras asignaturas en paralelo. El sistema debe: operar 100% offline en terreno, sincronizar sin pérdida ni duplicación, y aislar datos de múltiples empresas cliente (SaaS multi-tenant). Presupuesto de infraestructura ≤ US$7/mes (Artículo VI).

## Decisión

1. **Un solo lenguaje: TypeScript full-stack** (monorepo **npm workspaces** — enmienda 001.1, ver abajo; tipos compartidos frontend/backend).
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

---

## Enmienda 001.1 — Gestor de workspaces: pnpm → npm

**Fecha:** 2026-10-07 · **Estado:** ACEPTADO · **Decisores:** Daniel Ávila, Raúl González · **Task:** TSK-WS-001 (#27)

### Qué cambia

El punto 1 de la decisión decía *"monorepo pnpm workspaces"*. Se cambia a **npm workspaces** (campo `workspaces` del `package.json` raíz + `package-lock.json` único en la raíz).

### Por qué

- El `frontend/` ya venía gestionado con **npm** (`package-lock.json` propio) y el CI reactivado (PR #49) ejecuta `npm ci`. Migrar a pnpm implicaba reescribir lockfile, instalar un gestor extra y reescribir el job de CI **sin beneficio** para el alcance V1.
- npm 7+ soporta **workspaces nativos**, y npm es el gestor por defecto en cualquier entorno (Node incluye npm): **cero instalación adicional** para un equipo de 2 personas con otras asignaturas en paralelo (Art. V, simplicidad).
- La ganancia histórica de pnpm (eficiencia de disco/hoisting estricto) no es un cuello de botella para 3–4 workspaces de este proyecto.

### Costo / consecuencias

- Se pierde el *hoisting* estricto de pnpm (npm hoistea por defecto). No afecta la corrección del proyecto: los workspaces declaran sus dependencias explícitamente.
- Comandos del README (`pnpm install` → `npm install`, `pnpm --filter X` → `npm -w X`) quedan actualizados en la misma enmienda.
- Nada más del stack cambia: TypeScript full-stack, NestJS, React/PWA, PostgreSQL+RLS, Vitest/Playwright/Testcontainers siguen igual.

### Criterio de aceptación

`npm install` resuelve los 4 workspaces (`shared/`, `frontend/`, `backend/`, `infra/`) y `npm run lint` + `npm run typecheck` + `npm run build` pasan en CI (job `verify`).

**Firmas:** Daniel Ávila (2026-10-07) · Raúl González (2026-10-07)
