# ADR-004 — Endurecimiento de dependencias (npm audit, issue #84)

**Estado:** APLICADO en la rama `chore/tsk-84-hardening-deps` (refs #84) — pendiente de revisión de Daniel Ávila
**Fecha:** 2026-10-14 · **Decisores:** Raúl González (Track A / infra)

> **Contexto (Artículo VI):** la auditoría posterior a `68c94fb` reportó 23 vulnerabilidades
> (2 críticas, 8 altas, 12 moderadas, 1 baja). Este ADR registra la actualización en **una sola
> pasada** y, sobre todo, **por qué** el backend no se migró a ESM aunque NestJS 12 sea ESM-only.

## Decisión — versiones

| Paquete | Antes | Después | Motivo |
| :--- | :--- | :--- | :--- |
| `@nestjs/common` / `core` | 10.4.x | **12.1.3** | advisory alta (runtime) |
| `@nestjs/platform-express` | 10.4.15 | **12.1.3** | arrastra Express 5.2.1 |
| `@nestjs/config` | 3.3.0 | **12.0.1** | alineación con el major |
| `@nestjs/testing` | 10.4.22 | **12.1.3** | tests e2e |
| `express` | 4.22.1 | **^5.1.0** (instalado 5.3.0) | requerido por platform-express 12 |
| `@testcontainers/postgresql` | 10.13.2 | **12.2.0** (instalado 12.2.1) | fix `@fastify/busboy` (alta, dev) |
| `node-pg-migrate` | 7.9.1 | **9.0.0** | fix `glob` (alta) — trae `glob@13` |
| `vitest` | 3.0.5 / 3.2.7 | **5.0.4** | fix `tinypool` (crítica, dev) |
| `vite` | 6.3.5 | **^6.4.0** (instalado 6.4.4) | peer de vitest 5 |

Además, `npm audit fix` (no-breaking) resolvió los residuos `glob` (alta) y `qs` (moderada):
`workbox-build@7.4.1 → glob@11.1.0` y `glob@13.0.6` bajo `node-pg-migrate`.

## Cambios de ruptura y pasos de migración

### 1. NestJS 10 → 12 (ESM-only) — el backend **se queda en CommonJS**

NestJS 12 publica **solo** ESM (`"type": "module"`, `exports` sin `require`). Con el backend en
CJS, `tsc` reportaba **90 errores** (`TS1479`/`TS1541`: "imports will produce 'require' calls…
the referenced file is an ECMAScript module").

**La opción obvia era migrar el backend a ESM** (añadir `"type": "module"`, extensiones `.js` en
todos los imports relativos, migraciones a `export`, reemplazar `__dirname`, cambiar el loader de
`start:dev`). **Se descartó** por costo/riesgo innecesarios: el backend es el runtime de
producción y el cambio tocaría ~90 puntos de import más migraciones, sin beneficio funcional.

**Estrategia elegida (mínima):** mantener CJS y apoyarse en `require(esm)`, soportado por Node
**≥ 22.12** (el `engines` del repo ya lo exige y CI usa Node 22). TypeScript 5.8+ habilita
`require(esm)` bajo `--module nodenext`, así que el único cambio fue:

```
backend/tsconfig.json
-   "module": "node16",  "moduleResolution": "node16"
+   "module": "nodenext", "moduleResolution": "nodenext"
```

Resultado: `typecheck` pasa de 90 → **0 errores**; `tsc` sigue emitiendo CJS (`dist/main.js`
empieza con `"use strict"; require("@nestjs/core")`), y Node resuelve NestJS por `require(esm)`.

> Límite de `require(esm)`: no funciona con ESM que tenga *top-level await*. NestJS 12 no lo usa
> (verificado arrancando el proceso).

### 2. vitest 3 → 5 — `@types/node` deja de ser transitivo

vitest 5 ya **no arrastra `@types/node`** al programa de tipos. Los módulos que usan `Buffer` /
`node:fs` dejaron de tipar (18 errores en `shared` y `frontend`). Pasos:

- `shared/tsconfig.json`: `"types": []` → `"types": ["node"]` (coherente con `tsconfig.build.json`,
  que ya usaba `["node"]`).
- `frontend/tsconfig.test.json`: `"types": ["vite/client","vite-plugin-pwa/client","node"]`
  (el programa de la app **no** se toca: conserva su `Buffer` shim de `Importar.tsx`).
- `@types/node@^22.10.5` declarado explícito en `devDependencies` de `shared` y `frontend`
  (antes llegaba solo por hoisting).

### 3. node-pg-migrate 7 → 9 (ESM-only)

- El export `runner` (usado por los 14 specs de Testcontainers) **sigue existiendo**.
- El CLI `-m db/migrations` sigue igual; las migraciones siguen en CJS (`exports.up`), cargadas
  por el `jiti` interno de la herramienta. **No se tocó ninguna migración.**
- `db:seed` usa `node -r ts-node/register`, que sigue funcionando con `nodenext`.

### 4. Express 4 → 5

Viene de `@nestjs/platform-express@12`. `app.setup.ts` usa solo `json`/`urlencoded`/`cookieParser`
y CORS, compatibles con Express 5. El arranque mapea **todas** las rutas sin error (Express 5
rechaza patrones inválidos al registrar, así que el arranque limpio ya valida los patrones).

## Riesgo residual aceptado

- **`uuid@8.3.2` vía `exceljs@4.4.0` (moderada).** El advisory es de v3/v5/v6 **con `buf`
  provisto**; ExcelJS usa `uuid` v4. El fix que propone npm es un **downgrade a `exceljs@3.4.0`**
  (breaking) → **no se aplica**. Se documenta como riesgo aceptado (dev + navegador).
- `glob@11.1.0` aparece "deprecated" por su mantenedor; el *advisory* ya está resuelto. Es un
  aviso de mantenimiento, no una vulnerabilidad.
- `allowScripts`: `protobufjs@7.6.6` y `ssh2@1.17.0` (transitivos de `testcontainers`) tienen
  install scripts **no aprobados a propósito** (no se ejecutan).

## Verificación

- `npm run lint` / `typecheck` / `build`: **exit 0**.
- `shared`: **77/77**; `frontend`: **98/98**.
- Backend: arranque de producción (`node dist/main.js`) → `Nest application successfully started`;
  `start:dev` (ts-node) arranca igual.
- Backend integración (14 specs, Testcontainers): la valida **CI** (requiere Docker).
- `npm audit`: **0 críticas, 0 altas** (antes 2 críticas / 8 altas); quedan **2 moderadas** (`uuid`).
- `npm audit --omit=dev`: **0 críticas / 0 altas**.

## Ventanilla serial (obligatorio)

Este PR toca `package-lock.json`. **Al mergear, todos deben `npm ci`** (no `npm install`) y correr
`npm run typecheck && npm test`. Acordar ventana con Daniel para no pisar PRs abiertos.

## Consecuencias

**Positivas:** se cierran las 2 críticas y las 8 altas; se mantiene el runtime en CJS (riesgo
mínimo); queda un cambio de config de 2 líneas como "magia" explicada; `vitest` y `vite` al día.

**Negativas:** el backend ahora **depende de Node ≥ 22.12** de forma efectiva (el `engines` ya lo
pedía, pero antes podía correr en 20); `require(esm)` fallaría ante cualquier dependencia futura
con top-level await. Queda 1 dependencia moderada sin fix no-breaking (`uuid`/`exceljs`).
