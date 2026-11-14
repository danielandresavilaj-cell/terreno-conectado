# T4 — TSK-FORM-024: Archivar, restaurar y duplicar formularios

**Requisitos:** FR-066, FR-049 · **Rama:** `feat/tsk-form-024-archivar-duplicar` · **Tarea:** `tasks/009-plan-mejora-bloque-4/tasks.md`
**Antes de empezar:** lee `plan.md` §3–§5. Las tareas anteriores deben estar mergeadas en `main`.

## Qué cambia

En **Plantillas**, cada formulario publicado suma **"Duplicar"** y **"Archivar"** (con confirmación). Archivado,
deja de llegar a los teléfonos y de listarse, pero conserva revisiones, asignaciones e inspecciones; aparece en
la sección plegable **"Archivados"** con **"Restaurar"**. Duplicar crea "Nombre (copia)" con ids nuevos y lo publica.

## Archivos que toca el script (sólo para revisar; no edites otros)

- `backend/src/templates/templates.service.ts` — `listPublishedRevisions` filtra `t.status = 'active'`; nuevas `cambiarEstadoPlantilla` y `listarArchivadas`.
- `backend/src/templates/templates.controller.ts` — `PATCH /templates/:templateId/estado` y `GET /templates/archivadas` (sólo `tenant_admin`).
- `frontend/src/lib/api.ts` — `cambiarEstadoPlantilla`, `getPlantillasArchivadas`.
- `frontend/src/lib/duplicar-formulario.ts` (nuevo) — `duplicarDefinicion`, `nombreDeCopia`.
- `frontend/src/screens/Plantillas.tsx` — botones, confirmación y sección "Archivados".
- Pruebas: `backend/test/templates-archivar.spec.ts` (nuevo), `frontend/test/duplicar-formulario.test.ts` (nuevo).

## No cambiar

- **Sin migración:** la columna `template.status` ya existe con `active`/`archived`.
- No toques `getRevisionOriginal` ni las exportaciones del panel: una inspección de un formulario archivado debe seguir exportándose.

## Pasos

1. Prepara la rama (plan.md §4, paso 0):

   ```bash
   git checkout main && git pull --ff-only origin main && git checkout -b feat/tsk-form-024-archivar-duplicar
   ```

2. Crea el issue y anota su número `<N>`:

   ```bash
   cat > "$TMPDIR/issue.md" <<'MD'
   Ítem 3.5 (pendiente) del plan de mejora: no se puede archivar ni duplicar un formulario.

   **TSK-FORM-024** (FR-066, Enmienda 008): archivar, restaurar y duplicar formularios; auditado; sin migración.

   Ficha: `plans/009-plan-mejora-bloque-4/T4-archivar-duplicar.md`.
   MD
   gh issue create --title "TSK-FORM-024: Archivar, restaurar y duplicar formularios" --body-file "$TMPDIR/issue.md"
   ```

3. Aplica el código (el script se detiene con `PARA:` si algo no calza):

   ```bash
   python3 plans/009-plan-mejora-bloque-4/herramientas/T4.py
   ```

4. Verifica (todo en verde; si algo falla, plan.md §5):

   ```bash
   npm run lint && npm run typecheck && npm run test --workspace @terreno/frontend && npm run test --workspace @terreno/shared
   ```

5. Commit del código:

   ```bash
   git add backend frontend shared
   git commit -m "feat(plantillas): archivar, restaurar y duplicar formularios refs TSK-FORM-024, refs #<N>" -m "Co-Authored-By: <la línea de tu sesión>"
   ```

6. Documentación y su commit:

   ```bash
   python3 plans/009-plan-mejora-bloque-4/herramientas/T4-docs.py
   git add specs tasks test-plan.md data-model.md
   git commit -m "docs(specs): FR-066 en spec 007, data-model y plan de pruebas refs TSK-FORM-024, refs #<N>" -m "Co-Authored-By: <la línea de tu sesión>"
   ```

7. **E2E:** no hace falta en esta tarea.
8. Push, PR, CI y merge según plan.md §4, pasos 6, 8 y 9. Título del PR: `feat(plantillas): archivar, restaurar y duplicar formularios refs TSK-FORM-024 (#<N>)`.
   En "Referencias" del PR: `Closes #<N>`, `TSK-FORM-024`, la ficha `plans/009-plan-mejora-bloque-4/T4-archivar-duplicar.md`.

## Criterio de aceptación

El de `TSK-FORM-024` en `tasks/009-plan-mejora-bloque-4/tasks.md`, con CI verde.

## Validación previa

El T4.py y el T4-docs.py se aplicaron en cadena (T1→T6) sobre `main` el 2026-11-14, con lint,
typecheck, build y pruebas del frontend en verde, y las pruebas de backend y el E2E corridas en CI
(PR de validación #224, cerrado sin mergear).
