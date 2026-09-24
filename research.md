# RESEARCH — Evaluación de stack y alternativas

**Versión:** 1.0.0 · **Fecha:** 2026-09-14 · **Relacionado:** ADR-001, spec maestro §8
**Propósito:** justificar por escrito cada decisión de tecnología (Artículo V de la constitución). Este documento es además evidencia académica del proceso de decisión ("ofreciendo alternativas para la toma de decisiones", competencia del perfil de egreso).

## 0. Criterios de evaluación (ponderados por nuestro contexto)

| Criterio | Peso | Por qué importa aquí |
| :--- | :---: | :--- |
| Curva de aprendizaje para 2 estudiantes en ~11 semanas efectivas | 30% | Restricción dominante (informe APT §3.5) |
| Un solo lenguaje en el equipo | 15% | Dos personas no pueden mantener dos ecosistemas |
| Soporte offline-first real (almacenamiento local + sync) | 20% | Es la promesa central del proyecto |
| Multi-tenancy con aislamiento fuerte | 15% | Requisito SaaS del informe |
| Costo de infraestructura (≤ US$7/mes) | 10% | Artículo VI constitución |
| Valor como aprendizaje/evidencia profesional | 10% | Capstone: el proceso también se evalúa |

## 1. Frontend — cliente offline-first

| Opción | Evaluación | Veredicto |
| :--- | :--- | :--- |
| **PWA React + Vite + TS + Dexie (IndexedDB) + Workbox** | Mismo lenguaje que el backend; Dexie madura para cola offline; Workbox estándar para cache/SW; instalable en Android gama media | ✅ **ELEGIDA** |
| Vue 3 + TS + Pinia + idb | Técnicamente equivalente; decisión de familiaridad del equipo | ❌ Equipo con más exposición previa a React |
| React Native / Expo (app nativa) | Mejor acceso a hardware, pero: stores fuera de alcance, build nativo consume semanas, demo del docente más compleja | ❌ Viola NFR-11 y límites §10 |
| Formularios server-rendered (HTMX/Blade) | Simples, pero sin almacenamiento offline robusto: rompen el Artículo I | ❌ Incompatible con offline-first |

## 2. Sincronización — el corazón del proyecto

| Opción | Evaluación | Veredicto |
| :--- | :--- | :--- |
| **Cola propia en Dexie + endpoints REST idempotentes por lotes + LWW auditado** | ~1-2 semanas de trabajo; fuerza a entender idempotencia, conflictos y backoff (objetivo de aprendizaje de Daniel); cero vendor lock-in; costo $0 | ✅ **ELEGIDA** |
| PowerSync | Resuelve sync+offline de forma robusta, pero: SaaS de pago para producción, SDK acota el aprendizaje, y el corazón del proyecto quedaría delegado a un tercero | ❌ Quita el núcleo del valor académico; costo |
| ElectricSQL | Open source, sync Postgres ↔ local; pero complejidad operacional alta para 11 semanas y proyecto en transición de licencias/modelo | ❌ Riesgo de calendario |
| CRDTs (Yjs/Automerge) | Corrección teórica elegante para conflictos; complejidad desproporcionada para inspecciones (el informe no pide colaboración en tiempo real) | ❌ Over-engineering; documentado como evolución posible |
| Sync manual "botón subir" | Simple, pero traiciona FR-016 (automática al recuperar señal) | ❌ Viola el spec |

## 3. Backend

| Opción | Evaluación | Veredicto |
| :--- | :--- | :--- |
| **NestJS (TypeScript)** | Un lenguaje con el frontend (tipos compartidos: DTOs de sync); estructura modular tipo enterprise que ordena a un equipo chico; documentación excelente | ✅ **ELEGIDA** |
| FastAPI (Python) | Excelente y más simple; pero segundo lenguaje → dos toolchains, dos CI, tipos no compartidos. Habría sido la elección si el equipo fuera Python-first | ❌ Criterio "un lenguaje" (15%) |
| Express puro | Más ligero pero sin DI/módulos/validación estructurada; en un equipo de 2 la estructura importa más, no menos | ❌ |
| Supabase (BaaS: Postgres+RLS+Auth listos) | RLS nativo tentador y gratis al inicio; pero: dependemos de un cloud externo (latencia CL, límites free-tier), el backend "no existe" como aprendizaje, y el lock-in complica la demo offline | ❌ Viola criterio de aprendizaje; se documenta como alternativa productiva real |

## 4. Base de datos

| Opción | Evaluación | Veredicto |
| :--- | :--- | :--- |
| **PostgreSQL 16 + RLS** | Aislamiento multi-tenant a nivel de motor (no de aplicación); maduro; gratis; mismo motor que usaría un despliegue productivo real | ✅ **ELEGIDA** |
| MongoDB | Documentos encajan con formularios variables, pero aislamiento multi-tenant más débil (por colección/db → más caro de operar) y sin RLS equivalente | ❌ NFR-05 |
| MySQL | Sin RLS nativo equivalente; el aislamiento dependería 100% de la aplicación | ❌ NFR-05 |
| SQLite por tenant | Aislamiento físico total y simple; pero N tenants = N archivos, migraciones multiplicadas, y no escala al caso SaaS real que describe el informe | ❌ Operación |

## 5. Infraestructura de demo

| Opción | Evaluación | Veredicto |
| :--- | :--- | :--- |
| **1 VPS (Hetzner CAX11 o Fly.io) + Docker Compose + Caddy** | ~US$4–6/mes todo incluido; Caddy da TLS automático (Let's Encrypt); compose = misma definición que un despliegue real a pequeña escala; aprendizaje directo de redes/Linux/DNS | ✅ **ELEGIDA** (detalles y costos en ADR-001/ADR-002) |
| AWS/GCP/Azure (VPC + RDS + ECS) | El diseño "real" que menciona el informe; pero RDS alone ≥ US$15/mes y la complejidad (IAM, VPC, subredes) se come semanas. Se documenta como ADR educativo sin provisionar | ❌ Presupuesto; ✅ como ejercicio de diseño |
| Free-tier PaaS (Render/Railway/Fly free) | $0; pero spin-down por inactividad arruina la demo en vivo y los límites de horas/conexiones son frágiles para 72 h offline + subida | ⚠️ Plan B si el presupuesto no se aprueba |
| Kubernetes | Overkill absoluto para 2 personas y 1 demo | ❌ |

## 6. Decisiones secundarias

| Tema | Decisión | Motivo |
| :--- | :--- | :--- |
| IDs | UUIDv7 generados en cliente | Orden temporal + creación offline sin servidor (FR-015) |
| Fotos V1 | Disco del VPS vía volume Docker | $0; evolución a S3-compatible (MinIO/B2) documentada en ADR |
| Auth | JWT propio (access 15 min + refresh) | Simple, claims de tenant; Auth0/Clerk = costo/lock-in |
| Monorepo | pnpm workspaces | Tipos compartidos frontend/backend, un solo CI |
| E2E | Playwright | Simulación de offline de primera clase (`context.setOffline`) |
| Unit | Vitest | Velocidad + nativo en ecosistema Vite |
| Monitoreo | Uptime Kuma self-hosted o betterstack free | $0; cubre NFR-09 |

## 7. Resultado

Stack elegido: **TypeScript full-stack — PWA React/Vite/Dexie + NestJS + PostgreSQL 16 RLS + Docker Compose + Caddy en 1 VPS (~US$5/mes) + GitHub Actions**. Formalizado en **ADR-001**.
