# T1 — TSK-OFF-016: Varias fotos por hallazgo

**Requisitos:** FR-012, FR-032, FR-062 · **Rama:** `feat/tsk-off-016-varias-fotos` · **Tarea:** `tasks/009-plan-mejora-bloque-4/tasks.md`
**Antes de empezar:** lee `plan.md` §3–§5. Las tareas anteriores deben estar mergeadas en `main`.

## Qué cambia

Un hallazgo admite hasta **5 fotos** (antes, una). En el panel de hallazgo se ven todas como miniaturas;
las que aún no salieron del teléfono se pueden quitar y las ya enviadas no. Gerencia y el detalle de una
inspección muestran hasta 3 miniaturas por hallazgo y un contador del resto.

## Archivos que toca el script (sólo para revisar; no edites otros)

- `frontend/src/lib/hallazgo.ts` — constante `MAX_FOTOS_HALLAZGO`.
- `frontend/src/lib/db.ts` — `FotoHallazgo`, `fotosDeHallazgo`, `hallazgoDeRespuesta` devuelve `fotos`; `guardarHallazgo` recibe `fotosNuevas` y `fotosQuitar`.
- `frontend/src/lib/store.tsx` — `HallazgoGuardado.fotos`, `comprimirFotos`, nueva firma de `guardarHallazgo`.
- `frontend/src/components/SheetHallazgo.tsx` — reemplazo completo (lista de fotos, agregar y quitar).
- `frontend/src/screens/Captura.tsx` — llamada con la nueva firma.
- `shared/src/dashboard.ts` — `fotos_ids` en `FindingDto` y en los hallazgos del detalle.
- `backend/src/dashboard/dashboard.service.ts` y `inspection-export.service.ts` — devuelven `fotos_ids`.
- `frontend/src/screens/Dashboard.tsx` — componente `FotosHallazgo` (hasta 3 miniaturas).
- Pruebas: `frontend/test/hallazgo.test.ts`, `frontend/test/dashboard-csv.test.ts`, `backend/test/attachments.spec.ts`.

## No cambiar

- Los textos de botón **"Guardar hallazgo"**, **"Registrar hallazgo"**, **"Media"**, **"Alta"** y **"Tomar foto"**: el E2E los busca por nombre exacto.
- El contrato de sync (`shared/src/sync.ts`, `backend/src/sync/`): no cambia; el servidor ya acepta varios adjuntos por hallazgo.

## Pasos

1. Prepara la rama (plan.md §4, paso 0):

   ```bash
   git checkout main && git pull --ff-only origin main && git checkout -b feat/tsk-off-016-varias-fotos
   ```

2. Crea el issue y anota su número `<N>`:

   ```bash
   cat > "$TMPDIR/issue.md" <<'MD'
   Ítem 1.2 del plan de mejora (`docs/auditoria-y-plan-de-mejora.md`): un hallazgo sólo admite una foto.

   **TSK-OFF-016** (FR-012, FR-032, FR-062): hasta 5 fotos por hallazgo; las no enviadas se pueden quitar; Gerencia y el detalle muestran todas (`fotos_ids`).

   Ficha: `plans/009-plan-mejora-bloque-4/T1-varias-fotos.md`.
   MD
   gh issue create --title "TSK-OFF-016: Varias fotos por hallazgo" --body-file "$TMPDIR/issue.md"
   ```

3. Aplica el código (el script se detiene con `PARA:` si algo no calza):

   ```bash
   python3 plans/009-plan-mejora-bloque-4/herramientas/T1.py
   ```

4. Verifica (todo en verde; si algo falla, plan.md §5):

   ```bash
   npm run lint && npm run typecheck && npm run test --workspace @terreno/frontend && npm run test --workspace @terreno/shared
   ```

5. Commit del código:

   ```bash
   git add backend frontend shared
   git commit -m "feat(hallazgos): hasta 5 fotos por hallazgo refs TSK-OFF-016, refs #<N>" -m "Co-Authored-By: <la línea de tu sesión>"
   ```

6. Documentación y su commit:

   ```bash
   python3 plans/009-plan-mejora-bloque-4/herramientas/T1-docs.py
   git add specs tasks test-plan.md data-model.md
   git commit -m "docs(specs): varias fotos por hallazgo en specs 004/005 y plan de pruebas refs TSK-OFF-016, refs #<N>" -m "Co-Authored-By: <la línea de tu sesión>"
   ```

7. **E2E (obligatorio en esta tarea):** `gh workflow run e2e.yml --ref feat/tsk-off-016-varias-fotos` y espera a que termine en verde antes de mergear (plan.md §4, paso 8).
8. Push, PR, CI y merge según plan.md §4, pasos 6, 8 y 9. Título del PR: `feat(hallazgos): hasta 5 fotos por hallazgo refs TSK-OFF-016 (#<N>)`.
   En "Referencias" del PR: `Closes #<N>`, `TSK-OFF-016`, la ficha `plans/009-plan-mejora-bloque-4/T1-varias-fotos.md`.

## Criterio de aceptación

El de `TSK-OFF-016` en `tasks/009-plan-mejora-bloque-4/tasks.md`, con CI verde y E2E verde.

## Validación previa

El T1.py y el T1-docs.py se aplicaron en cadena (T1→T6) sobre `main` el 2026-11-14, con lint,
typecheck, build y pruebas del frontend en verde, y las pruebas de backend y el E2E corridas en CI
(PR de validación #224, cerrado sin mergear).
