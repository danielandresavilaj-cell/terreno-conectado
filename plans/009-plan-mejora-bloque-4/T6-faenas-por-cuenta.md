# T6 — TSK-ADM-003: Limitar las faenas de cada cuenta

**Requisitos:** FR-065, FR-034 · **Rama:** `feat/tsk-adm-003-faenas-por-cuenta` · **Tarea:** `tasks/009-plan-mejora-bloque-4/tasks.md`
**Antes de empezar:** lee `plan.md` §3–§5. Las tareas anteriores deben estar mergeadas en `main`.

## Qué cambia

En **Equipo**, cada cuenta de terreno o supervisión tiene el botón **"Faenas: todas"** (o "Faenas: 2 de 5") que
abre la elección de faenas. La cuenta recibe en su teléfono sólo esas faenas (`GET /sites`); sin asignación, todas.
Lleva la **migración 021** (`user_site`, con RLS).

## Archivos que toca el script (sólo para revisar; no edites otros)

- `backend/db/migrations/1730000021000_user_site.js` (nuevo).
- `backend/src/users/contract.ts`, `users.service.ts`, `users.controller.ts` — `asignarFaenasSchema`, `asignarFaenas`, `PUT /users/:id/faenas`, `faena_ids` en el listado.
- `backend/src/dashboard/dashboard.service.ts` y `dashboard.controller.ts` — `listSites(u, soloAsignadas)`; `GET /sites` restringe, el resumen no.
- `frontend/src/lib/api.ts` — `faena_ids` en `UsuarioEmpresa`, `asignarFaenasUsuario`.
- `frontend/src/screens/Administracion.tsx` — botón por cuenta, `EditorFaenas`, `resumenFaenas`.
- Pruebas: `backend/test/users-faenas.spec.ts` (nuevo), `frontend/test/faenas-cuenta.test.ts` (nuevo).

## No cambiar

- **No toques la ingesta de sync** (`backend/src/sync/`): no debe rechazar capturas de faenas no asignadas (Art. III).
- La migración se aplica sola al desplegar (`infra/tools/ops.mjs deploy` corre `migrate`); no la corras a mano contra producción.

## Pasos

1. Prepara la rama (plan.md §4, paso 0):

   ```bash
   git checkout main && git pull --ff-only origin main && git checkout -b feat/tsk-adm-003-faenas-por-cuenta
   ```

2. Crea el issue y anota su número `<N>`:

   ```bash
   cat > "$TMPDIR/issue.md" <<'MD'
   Ítem 1.1 (pendiente) del plan de mejora: el administrador no puede limitar en qué faenas captura cada cuenta.

   **TSK-ADM-003** (FR-065, Enmienda 008): migración 021 (`user_site`), `PUT /users/:id/faenas`, `GET /sites` restringido y elección en Equipo.

   Ficha: `plans/009-plan-mejora-bloque-4/T6-faenas-por-cuenta.md`.
   MD
   gh issue create --title "TSK-ADM-003: Limitar las faenas de cada cuenta" --body-file "$TMPDIR/issue.md"
   ```

3. Aplica el código (el script se detiene con `PARA:` si algo no calza):

   ```bash
   python3 plans/009-plan-mejora-bloque-4/herramientas/T6.py
   ```

4. Verifica (todo en verde; si algo falla, plan.md §5):

   ```bash
   npm run lint && npm run typecheck && npm run test --workspace @terreno/frontend && npm run test --workspace @terreno/shared
   ```

5. Commit del código:

   ```bash
   git add backend frontend shared
   git commit -m "feat(equipo): limitar las faenas en que captura cada cuenta refs TSK-ADM-003, refs #<N>" -m "Co-Authored-By: <la línea de tu sesión>"
   ```

6. Documentación y su commit:

   ```bash
   python3 plans/009-plan-mejora-bloque-4/herramientas/T6-docs.py
   git add specs tasks test-plan.md data-model.md
   git commit -m "docs(specs): FR-065 en data-model, specs 002/006 y plan de pruebas refs TSK-ADM-003, refs #<N>" -m "Co-Authored-By: <la línea de tu sesión>"
   ```

7. **E2E (obligatorio en esta tarea):** `gh workflow run e2e.yml --ref feat/tsk-adm-003-faenas-por-cuenta` y espera a que termine en verde antes de mergear (plan.md §4, paso 8).
8. Push, PR, CI y merge según plan.md §4, pasos 6, 8 y 9. Título del PR: `feat(equipo): limitar las faenas en que captura cada cuenta refs TSK-ADM-003 (#<N>)`.
   En "Referencias" del PR: `Closes #<N>`, `TSK-ADM-003`, la ficha `plans/009-plan-mejora-bloque-4/T6-faenas-por-cuenta.md`.

## Criterio de aceptación

El de `TSK-ADM-003` en `tasks/009-plan-mejora-bloque-4/tasks.md`, con CI verde y E2E verde.

## Validación previa

El T6.py y el T6-docs.py se aplicaron en cadena (T1→T6) sobre `main` el 2026-11-14, con lint,
typecheck, build y pruebas del frontend en verde, y las pruebas de backend y el E2E corridas en CI
(PR de validación #224, cerrado sin mergear).
