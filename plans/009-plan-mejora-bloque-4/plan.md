# PLAN — Plan de mejora, bloque 4 (pendientes chicos)

**Versión:** 1.0.0 · **Fecha:** 2026-11-14 · **Autor:** Daniel Ávila (con IA)
**Origen:** `docs/auditoria-y-plan-de-mejora.md` §4 y §6 · **Tareas:** `tasks/009-plan-mejora-bloque-4/tasks.md`
**Requisitos:** FR-012, FR-019, FR-032, FR-040, FR-041, FR-065 y FR-066 (los dos últimos entran con la Enmienda 008, ya escrita en el spec maestro)

> **Para quien ejecuta (modelo Haiku u otra sesión):** este directorio es autocontenido. Lee
> este archivo entero una vez y después **sólo la ficha de la tarea en curso**. No explores el
> repo por tu cuenta ni escribas código a mano: **cada tarea se aplica con un script ya validado**
> (`herramientas/T<n>.py` para el código y `herramientas/T<n>-docs.py` para la documentación),
> que edita por textos ancla exactos y se detiene con `PARA:` si algo no calza. Tu trabajo es
> correr los scripts, verificar, y llevar cada tarea por issue → PR → CI → merge. Si algo falla,
> aplica §5 (Cuándo parar) en vez de improvisar.

## 1. Qué se entrega

Seis mejoras independientes en valor pero **secuenciales en ejecución**, porque comparten
archivos (`db.ts`, `store.tsx`, `Dashboard.tsx` y los documentos de tareas y pruebas):

| Orden | Ficha | Tarea | Qué cambia | Capas |
| :---: | :--- | :--- | :--- | :--- |
| 1 | `T1-varias-fotos.md` | TSK-OFF-016 | Hasta 5 fotos por hallazgo; se ven todas en Gerencia | frontend + backend (sin migración) |
| 2 | `T2-hallazgo-directo.md` | TSK-OFF-015 | Hallazgo general, no ligado a una pregunta | frontend |
| 3 | `T3-reexportar.md` | TSK-OFF-017 | Descargar el Excel de una inspección ya enviada, desde Cola | frontend |
| 4 | `T4-archivar-duplicar.md` | TSK-FORM-024 | Archivar, restaurar y duplicar formularios (FR-066) | backend + frontend |
| 5 | `T5-tendencia-filtros.md` | TSK-REP-012 | Tendencia de 8 semanas y filtros de Gerencia en una barra | backend + frontend |
| 6 | `T6-faenas-por-cuenta.md` | TSK-ADM-003 | Limitar las faenas de cada cuenta (FR-065, migración 021) | backend + frontend |
| 7 | `T7-cierre.md` | — | Conteo de pruebas, plan de mejora, despliegue y reporte | docs + despliegue |

T1 va antes que T2 porque T2 reutiliza la API de fotos múltiples que deja T1.

## 2. Decisiones de diseño (ya tomadas; no se reabren)

1. **Varias fotos (T1).** Máximo 5 por hallazgo, impuesto en la interfaz. Una foto que ya salió
   del teléfono (`synced`/`syncing`) no se puede quitar: la cola no borra en el servidor. El
   servidor ya acepta varios adjuntos por hallazgo; sólo cambia lo que devuelve (`fotos_ids`).
2. **Hallazgo directo (T2).** Es un hallazgo con `response_id = null` dentro del borrador en
   curso. Usa el mismo panel y la misma función de guardado. No cambia el contrato de sync
   (el servidor ya acepta `response_id` nulo).
3. **Reexportar (T3).** Sólo funciona si el teléfono todavía tiene la plantilla y su planilla
   original en caché. Sin red no se descarga nada (Art. I); se informa el motivo. El módulo de
   exportación se importa de forma diferida para no inflar la pantalla Cola (ExcelJS pesa ~900 kB).
4. **Archivar (T4).** Usa la columna existente `template.status` (`active`/`archived`); no hay
   migración. Un formulario archivado deja de entregarse a los dispositivos y de listarse para
   asignar, pero conserva revisiones, asignaciones e inspecciones; restaurarlo lo devuelve tal cual.
   **Duplicar** crea un formulario nuevo con ids nuevos, sin `origen` de planilla, y lo publica:
   su contenido ya fue revisado por una persona al publicar el original.
5. **Tendencia (T5).** Últimas 8 semanas (lunes a domingo, en UTC del servidor), filtrada por
   faena e independiente del período elegido. El filtro de autor pasa a ser uno solo para
   hallazgos e inspecciones.
6. **Faenas por cuenta (T6).** Tabla `user_site`. Una cuenta **sin filas = todas las faenas**
   (compatible con lo actual). La restricción se aplica a `GET /sites`, que es la lista que usa el
   teléfono para elegir faena. **La ingesta de sync no rechaza** capturas de una faena no asignada:
   rechazar una captura ya hecha sin señal sería perder datos (Art. III). El panel de Gerencia no se
   restringe (FR-065 limita la captura, no la supervisión).

## 3. Reglas del repositorio que el ejecutor debe cumplir

Resumen de `AGENTS.md`, `constitution.md` y `CONTRIBUTING.md`. Son obligatorias.

- **Trazabilidad (Art. II):** cada tarea tiene issue, rama, commits y PR. La rama es
  `<tipo>/<tsk-id-en-minúsculas>-<desc>`; el commit, `tipo(alcance): mensaje refs TSK-XXX-NNN, refs #N`.
  El spec, las tareas y el plan de pruebas se actualizan **en el mismo PR** que el código.
- **Idioma (NFR-10):** interfaz en español de Chile con tuteo ("Registra", "Elige"; nunca
  "Registrá"). Los identificadores siguen el estilo existente del repo (nombres en español:
  `guardarHallazgo`, `fotosNuevas`). Los mensajes de commit pueden ir en español, como el historial.
- **Seguridad (Art. IV, IX):** toda consulta de datos de empresa va por `this.db.queryAsTenant` o
  `this.db.withTenantTransaction` (RLS). Nunca `queryOwner` para datos de empresa. Sin secretos
  en el código.
- **Simplicidad (Art. V):** **ninguna dependencia nueva.** Nada de `npm install <paquete>`.
- **Portabilidad (AGENTS.md §6):** fin de línea LF; no edites `.gitattributes` ni `.editorconfig`;
  rutas con `node:path`; nada de `export VAR=...` en scripts.
- **Diseño (TSK-OFF-009):** objetivos táctiles de al menos 44 px (`h-11`/`min-h-11`), texto
  secundario de al menos 12 px, bordes de controles con `border-campo`, colores sólo con tokens
  (`text-ink-2`, `bg-s1`, `text-failed`…), nunca hexadecimales.
- **Atrás del teléfono:** todo panel o diálogo nuevo llama `useCapaAtras(abierto, cerrar)`
  (`frontend/src/lib/useCapaAtras.ts`).
- **Pruebas:** frontend con Vitest en Node (`frontend/test/*.test.ts`, sin DOM; la lógica va en
  `frontend/src/lib/`). Backend con Testcontainers (`backend/test/*.spec.ts`): **no corren en
  local sin Docker**; los valida el CI del PR.

## 4. Flujo por tarea (idéntico en T1–T6)

Ejecuta los pasos en orden. Sustituye `<ID>`, `<rama>`, `<N>` y los textos que da cada ficha.

```bash
# 0. Partir de main al día
cd /Users/danielavila/dev/terreno-conectado
git checkout main && git pull --ff-only origin main
git status --short          # debe salir vacío (salvo .claude/, que está ignorado)
git checkout -b <rama>
```

1. **Issue:** crea el issue con el título y cuerpo que da la ficha (`gh issue create --title ... --body-file <archivo>`).
   Anota el número `<N>`.
2. **Código:** `python3 plans/009-plan-mejora-bloque-4/herramientas/T<n>.py`. Cada línea `ok …`
   es una edición aplicada; una línea `PARA: …` detiene el script y significa ir a §5.
3. **Verificación local** (todo debe pasar antes de seguir):

   ```bash
   npm run lint
   npm run typecheck
   npm run test --workspace @terreno/frontend
   npm run test --workspace @terreno/shared
   ```

4. **Documentación:** `python3 plans/009-plan-mejora-bloque-4/herramientas/T<n>-docs.py`
   (va **después** del commit de código, ver paso 5).
5. **Commits** (dos, firmados automáticamente por la configuración del repo): primero el de código
   (después del paso 3) y luego, tras el paso 4, el de documentación:

   ```bash
   git add backend frontend shared
   git commit -m "<mensaje de código de la ficha>" -m "Co-Authored-By: <línea de tu sesión>"
   python3 plans/009-plan-mejora-bloque-4/herramientas/T<n>-docs.py
   git add specs tasks test-plan.md data-model.md
   git commit -m "<mensaje de documentación de la ficha>" -m "Co-Authored-By: <línea de tu sesión>"
   ```

6. **Push y PR:**

   ```bash
   git push origin <rama>
   gh pr create --base main --head <rama> --title "<título de la ficha>" --body-file <archivo>
   ```

   El cuerpo del PR lleva: "Qué hace" (2–4 líneas), "Referencias" (`Closes #<N>`, la tarea, el
   spec tocado), "Verificación" (lo que corriste) y al final la línea de atribución de tu sesión.
7. **E2E** (sólo si la ficha lo pide): `gh workflow run e2e.yml --ref <rama>`.
8. **Esperar CI:** `gh pr checks <PR> --watch --interval 20`. Si la ficha pidió E2E, espera también
   ese run (`gh run list --workflow e2e.yml --branch <rama> --limit 1` y `gh run watch <id> --exit-status`).
9. **Merge** cuando todo esté verde (el acuerdo de revisión con Raúl está resuelto; se mergea con
   permisos de administrador):

   ```bash
   gh pr merge <PR> --squash --admin --delete-branch --subject "<título de la ficha> (#<PR>)"
   git checkout main && git pull --ff-only origin main
   git branch -D <rama> 2>/dev/null; git fetch --prune origin
   ```

**Comandos de red:** `gh` y `git push` necesitan los dominios `github.com` y `api.github.com`.
Para leer el log de un CI fallido, `gh run view <id> --log` falla en este sandbox por la caché;
usa `XDG_CACHE_HOME="$TMPDIR/xdg" gh run view <id> --log-failed`.

## 5. Cuándo parar y reportar (no improvisar)

Para y escribe un reporte corto (qué tarea, qué paso, qué viste) si ocurre cualquiera de estas cosas:

- Un **texto ancla no aparece** en el archivo. Antes de parar, haz **una** búsqueda con `grep -n`
  de una parte distintiva del ancla; si el código está pero con otro formato, adapta sólo el
  formato. Si el código no está, para.
- Un comando de verificación falla y **la causa no está en los archivos que tocaste**.
- El CI falla dos veces seguidas en la misma tarea después de corregir.
- La ficha pide algo que contradice §2 o §3.
- Sientes la necesidad de agregar una dependencia, tocar el contrato de sync
  (`backend/src/sync/`, `shared/src/sync.ts`) o un archivo no listado en la ficha.

Una tarea a medias no se mergea. Si paras, deja la rama subida y el PR en borrador
(`gh pr ready --undo <PR>`), con el reporte como comentario.

## 6. Validación previa del plan

Los scripts `herramientas/T1.py` … `T6.py` y sus `-docs.py` se aplicaron **en cadena** sobre `main`
(`e6f297d`) el 2026-11-14, en una rama temporal:

- lint, typecheck (incluye las pruebas nuevas del backend), build del frontend y pruebas del frontend: verdes
  tras cada tarea (frontend: 223 pruebas al final);
- CI completo en el PR de validación #224 (cerrado sin mergear): unitarias e integración de shared, frontend y
  backend en verde, incluidas `attachments`, `templates-archivar`, `dashboard-tendencia` y `users-faenas`;
- E2E completo (23 pruebas, con los 7 escenarios de caos) en verde sobre esa misma rama.

Si `main` no cambió desde entonces, cada script debería aplicar sin un solo `PARA:`.
Si cambió y un ancla ya no calza, aplica §5.

## 7. Riesgos conocidos

| Riesgo | Mitigación en la ficha |
| :--- | :--- |
| Romper el E2E de captura (perfil móvil, textos exactos de botones) | T1 y T2 piden E2E; las fichas indican los textos de botones que **no** se deben cambiar |
| `Dashboard.tsx` tiene ~1300 líneas y varias tareas lo tocan | Anclas cortas y únicas; T5 es la única que reordena su contenido |
| Pruebas de backend escritas sin poder correrlas en local | Se copian del patrón de `backend/test/bitacora.spec.ts`, que ya pasa en CI |
| Contadores de pruebas en README y plan de pruebas | Sólo se actualizan en T7, con los números del CI |

## 8. Contenido del directorio

| Archivo | Para qué |
| :--- | :--- |
| `plan.md` | Este documento: decisiones, reglas y flujo |
| `T1-…md` a `T6-…md` | Una ficha por tarea: qué cambia, qué no tocar, pasos, textos de issue, commit y PR |
| `T7-cierre.md` | Conteo de pruebas, plan de mejora, despliegue y reporte final |
| `herramientas/editar.py` | Ediciones por ancla exacta; las usan todos los scripts |
| `herramientas/T<n>.py` | Código y pruebas de la tarea n |
| `herramientas/T<n>-docs.py` | Specs, tareas y plan de pruebas de la tarea n |
| `herramientas/*.txt` | Archivos completos que copian los scripts (componentes, pruebas, migración). Tienen extensión `.txt` para que el lint del repo no los trate como código del producto |
| `herramientas/P0.py` | **Ya aplicado** en el PR que creó este plan (FR-065/066 en el spec maestro). **No lo ejecutes** |

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-11-14 | Plan del bloque 4 con fichas por tarea para ejecución con Haiku | Daniel Ávila (con IA) |
