# AGENTS.md — Terreno Conectado

Instrucciones operativas para **agentes de IA y personas que tocan este repo**.
No reemplaza a la documentación: la condensa y la hace legible en un solo lugar.

**Lee esto antes de escribir código.** Si algo aquí contradice a la Constitución,
manda la Constitución. Si algo aquí contradice a `CONTRIBUTING.md`, manda
`CONTRIBUTING.md` (este archivo es un índice operativo; la fuente de reglas sigue
siendo la Constitución y el CONTRIBUTING).

- Constitución (10 artículos innegociables): [`constitution.md`](constitution.md)
- Cómo trabajamos (proceso, handoff, sprint): [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Visión y FR/NFR: [`specs/000-master/spec.md`](specs/000-master/spec.md)
- Plan de pruebas y caos: [`test-plan.md`](test-plan.md)

---

## 1. Qué es este proyecto

SaaS **offline-first** de captura de datos operacionales para faenas mineras y
obras. Dos personas, ~11 semanas efectivas, un solo lenguaje (TypeScript).
Captura en terreno con y sin señal; la nube consolida y decide, nunca es
dependencia para trabajar (Art. I).

Monorepo npm workspaces:

| Workspace | Qué es |
| :--- | :--- |
| `backend/` | API NestJS (modular). PostgreSQL 16 con RLS. Puerto 3000. |
| `frontend/` | PWA React + Vite + Dexie (offline). Puerto 5173. |
| `shared/` | Tipos y contratos compartidos, validación Zod (ADR-001). |
| `infra/` | Docker Compose (Postgres local) + script de provisión de roles. |

Módulos de dominio ya implementados: `auth`, `sync`, `templates`, `dashboard`,
`storage`, `health`, `observability`, `db`. Specs en `specs/001..007`, ADRs en
`adr/001..003`.

---

## 2. Comandos

```bash
npm ci                              # instalar (Node >= 22.12)

npm run lint                        # ESLint
npm run typecheck                   # tsc --noEmit en todos los workspaces
npm run build                       # build de todos los workspaces
npm test                            # unit + integración (sweep de workspaces)

npm run dev:backend                 # NestJS -> :3000
npm run dev:frontend                # Vite  -> :5173

# Base local (Docker Desktop / docker desktop engine)
docker compose -f infra/docker-compose.yml up -d
npm run db:migrate --workspace @terreno/backend
npm run db:seed    --workspace @terreno/backend

# E2E + caos (requiere Docker; Spins su propio Postgres en Testcontainers)
npm run e2e                         # stack completo + 17 specs + teardown
npm run e2e -- --grep "caos 7"      # un escenario
```

**Cómo correr un solo workspace** (preferido sobre `npx vitest` directo):

```bash
npm run test --workspace @terreno/backend
npm run typecheck --workspace @terreno/frontend
npm run lint
```

Usa siempre los scripts de npm. `npx vitest --root backend` y otros atajos
saltean el `cwd` del workspace y rompen la carga de `.env` (ver §6).

---

## 3. Variables de entorno

Todas viven en un `.env` en la raíz (copia de `.env.example`). **No se versiona**
(Art. IX). Los runners de tests del backend, el harness E2E y el build/test del
frontend lo cargan solos: no hace falta `export`ar nada. En CI no hay `.env`;
las variables llegan por el entorno del job y por secrets de GitHub.

Claves que importan:

| Variable | Para qué | Nota |
| :--- | :--- | :--- |
| `DATABASE_URL` | conexión owner (migraciones, seed) | bypass de RLS |
| `APP_DATABASE_URL` | conexión de la app (rol `tc_app`) | sujeta a RLS |
| `JWT_ACCESS_SECRET` | firma HS256 de tokens | **>= 32 bytes** |
| `DEMO_PASSWORD` | cuentas demo (seed backend) | también `VITE_DEMO_PASSWORD` |
| `VITE_DEMO_PASSWORD` | build del frontend | **build-time**, ver gotcha §8 |
| `VITE_API_URL` | URL de la API en el bundle | **build-time** |
| `SYNC_VOLUME` | volumen de adjuntos | local `.vol/sync` |

**Nunca hardcodear secretos ni passwords en el código, tests, docs o commits**
(Art. IX). En CI hay escaneo de secretos (gitleaks) que falla el PR.

---

## 4. Git y trazabilidad

La cadena es obligatoria (Art. II):

```
Spec (FR/NFR) → Tarea (TSK-XXX-NNN) → Issue (#N) → Rama → Commits → PR → Board (Done)
```

- **Rama:** `<tipo>/<tsk-id>-<desc>`. Tipos: `feat · fix · chore · docs · test`.
- **Commit:** `tipo(alcance): mensaje` + `refs TSK-…` / `refs #…`.
  Ejemplo: `fix(sync): idempotencia en batch upsert refs TSK-WS-007`.
  Atomicidad: un cambio lógico por commit.
- **Firmas:** los commits se firman con la clave SSH del autor. Configura
  `gpg.format=ssh` + `user.signingkey`. Si no tienes, dilo antes de hacer push.
- **Nunca commit directo a `main`** (la rama está protegida).
- **PR:** plantilla en `.github/pull_request_template.md`. Todo PR pide **1
  aprobación** del otro integrante. Revisar contra el criterio de aceptación del
  issue. Merge por **squash** con `#N` visible, luego borrar la rama.
- **Board:** Project #1. Mover a In Progress al tomar, a Done al cerrar.
  Máximo 2 tarjetas por persona.
- **Handoff:** si una sesión termina con una tarjeta In Progress, deja comentario
  de handoff en el issue (ver CONTRIBUTING §3). Es la regla más importante del
  trabajo asíncrono.

**Antes de abrir un PR o mergear:** `git status` limpio, `npm run lint`,
`npm run typecheck`, `npm test` verdes. Si tocas un behaviour de un spec, actualiza
el spec en el **mismo** PR (Art. II, Art. VIII).

---

## 5. Cómo probar

- **Unit + integración:** `npm test`. Backend usa Testcontainers (Postgres real),
  así que **Docker debe estar corriendo**. Frontend usa `fake-indexeddb`.
- **E2E / caos:** `npm run e2e`, en Docker, es la capa lenta. Corre en el nightly
  (`.github/workflows/e2e.yml`, 03:17 UTC) y **nunca bloquea un PR**.
- **Antes de tocar sync, RLS, auth o el harness**, lee `test-plan.md` §4 (caos
  1–7) y §5.1. Ahí están los invariantes y los defectos ya encontrados; varios
  errores "raros" ya tienen nombre (H1–H6) y causa conocida. Reutilízalos en vez de
  rediagnosticarlos.
- **Resultados de la última validación:** `docs/informe-pruebas-validacion.md`.

Invariantes que no se negocian (Artículos I, III, IV, V): offline 100 %,
sincronización idempotente (0 pérdidas, 0 duplicados), aislamiento multi-tenant por
**RLS de Postgres** (no por filtros en la app), simplicidad como presupuesto.

---

## 6. Portabilidad: macOS **y** Windows

El equipo es Daniel en macOS y Raúl en Windows nativo. **Nada puede asumir un solo
SO.** Detalle en `CONTRIBUTING.md` §9.

- **Fin de línea LF siempre.** Respetar `.gitattributes` + `.editorconfig`. No
  editarlos. Git for Windows trae `core.autocrlf=true` a nivel *system*; esos
  archivos lo neutralizan. **CI falla el PR** si un archivo versionado trae CRLF
  o finales mixtos.
- **Rutas:** usa `sep` de `node:path` (o `path.relative`). **Nunca** compares un
  path contra `'/'` hardcodeado — así se rompió un test sólo en Windows (#107).
- **Variables de entorno:** en `.env`, o `npx cross-env VAR=valor ...` para un
  comando puntual. **Nunca** `export VAR=valor`, **nunca** `VAR=valor comando`:
  es shell Unix y no corre en cmd/PowerShell.
- **Scripts npm y shell:** asume `cmd` como el shell peor caso. Usa Node para
  cualquier cosa no trivial en vez de bash.
- **Al directorio de trabajo:** los scripts de workspace corren con `cwd` en el
  workspace. La raíz es `..` desde ahí.
- **Procesos en E2E:** el harness ya mata el árbol de procesos en Windows
  (`taskkill /T`); no lo "simplifiques" quitando la rama Windows.

Si algo que escribes rompería en Windows, **arreglalo en el mismo PR**.

---

## 7. Guardrails de seguridad

- Aislamiento multi-tenant por **RLS**; los filtros de aplicación son defensa
  adicional, nunca la defensa (Art. IV). Un rechazo cross-tenant debe dejar
  rastro en `audit_log` (bug H5, ya corregido; no lo reintroduzcas).
- Hash de contraseñas con argon2. JWT con expiración y claim de tenant. Refresh
  en cookie `httponly` con rotación y detección de reuso.
- CSRF double-submit en cookies. Secrets fuera del repo (Art. IX).
- El harness E2E **no tiene password de demo por omisión a propósito**: falla
  ruidosamente si faltan las variables. No le pongas un default.

---

## 8. Gotchas conocidos (aprendidos a golpes)

1. **`VITE_*` son build-time.** `seed.ts` lanza si falta `VITE_DEMO_PASSWORD`, y
   `api.ts` hornea `VITE_API_URL` en el bundle. `vite preview` sirve un `dist/`
   ya construido: **cambiar estas variables obliga a rebuildear el frontend**
   (`npm run build`) antes de `npm run e2e`, o el build arranca en blanco (#103).
2. **`envDir: '..'`** en `vite.config.ts` y `vitest.config.ts`: el frontend lee
   el `.env` de la raíz del monorepo, no `frontend/.env`.
3. **El `.env` local puede estar desactualizado.** Si un test falla por una
   variable "que sí está en `.env.example`", compara con `.env.example`; la copia
   local puede ser anterior.
4. **La ruta de health del backend es `/health`, no `/api/v1/health`** — está
   excluida del prefijo global (se usa en el health check del stack E2E).
5. **Los tests de integración necesitan Docker** (Testcontainers). Si Testcontainers
   no levanta, el fallo no es del código.
6. **`.gitignore` ya NO excluye `.github/`** (se cerró #14). Un push que toque
   un workflow necesita un PAT con scope `workflow`.
7. **`Fase 1/` y `docs/mockups-prueba/` están fuera** del alcance de lint/build.
8. **Playwright usa perfil móvil (Pixel 5), un worker.** Los specs E2E asumen
   pantalla angosta; no los rompas con selectores de desktop.

---

## 9. Documentación (dónde vive cada cosa)

| Documento | Para qué |
| :--- | :--- |
| `constitution.md` | 10 artículos innegociables |
| `CONTRIBUTING.md` | proceso, sprint, handoff, **§9 Windows** |
| `specs/000-master/spec.md` | visión, FR/NFR, mapa de evidencia |
| `specs/001..007/` | spec por módulo (congelados por enmienda) |
| `adr/001..003/` | decisiones de arquitectura y despliegue |
| `data-model.md` | entidades, RLS |
| `test-plan.md` | matriz §3, caos §4, defectos §5 |
| `docs/informe-pruebas-validacion.md` | resultados de la Fase 2 |
| `docs/guia-del-tablero.md` | cómo se maneja el board |
| `research.md` | justificación de dependencias (Art. V) |
| `tasks/`, `plans/` | tareas y diseño por iteración |

**Regla de oro:** la documentación es concurrente (Art. VIII). Si cambias
comportamiento, actualiza el spec/informe **en el mismo PR**.
