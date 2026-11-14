# T2 — TSK-OFF-015: Hallazgo directo, sin pregunta

**Requisitos:** FR-032 · **Rama:** `feat/tsk-off-015-hallazgo-directo` · **Tarea:** `tasks/009-plan-mejora-bloque-4/tasks.md`
**Antes de empezar:** lee `plan.md` §3–§5. Las tareas anteriores deben estar mergeadas en `main`.

## Qué cambia

En Inspección aparece el bloque **"Otros hallazgos"** con el botón **"Registrar hallazgo general"**: crea un
hallazgo que no depende de ninguna pregunta (`response_id = null`) dentro del borrador en curso. La lista
muestra los ya registrados con "Corregir", que abre el mismo panel y actualiza el mismo registro.

## Archivos que toca el script (sólo para revisar; no edites otros)

- `frontend/src/lib/db.ts` — `guardarHallazgo` acepta `hallazgoId`; nuevas `hallazgosDirectos` y `hallazgoPorId`.
- `frontend/src/lib/store.tsx` — `guardarHallazgoDirecto`, `leerHallazgoDirecto`, `listarHallazgosDirectos`, tipo `HallazgoDirectoResumen`.
- `frontend/src/screens/Captura.tsx` — bloque "Otros hallazgos"; el panel distingue un hallazgo directo por el prefijo `directo:` en el id del ítem.
- Pruebas: `frontend/test/hallazgo.test.ts`.

## No cambiar

- El botón nuevo dice **"Registrar hallazgo general"**: el E2E usa `getByRole('button', { name: /registrar hallazgo/i }).first()` y funciona porque el bloque nuevo va **después** de las preguntas. No lo muevas arriba del formulario.
- Los hooks nuevos de `Captura` van **antes** de `if (!plantilla) return null` (el script ya lo hace así; no los muevas).

## Pasos

1. Prepara la rama (plan.md §4, paso 0):

   ```bash
   git checkout main && git pull --ff-only origin main && git checkout -b feat/tsk-off-015-hallazgo-directo
   ```

2. Crea el issue y anota su número `<N>`:

   ```bash
   cat > "$TMPDIR/issue.md" <<'MD'
   Ítem 1.5 (pendiente) del plan de mejora: no se puede registrar un hallazgo que no esté ligado a una pregunta.

   **TSK-OFF-015** (FR-032): "Registrar hallazgo general" en Inspección; se corrige sin duplicarse y viaja con la inspección.

   Ficha: `plans/009-plan-mejora-bloque-4/T2-hallazgo-directo.md`.
   MD
   gh issue create --title "TSK-OFF-015: Hallazgo directo, sin pregunta" --body-file "$TMPDIR/issue.md"
   ```

3. Aplica el código (el script se detiene con `PARA:` si algo no calza):

   ```bash
   python3 plans/009-plan-mejora-bloque-4/herramientas/T2.py
   ```

4. Verifica (todo en verde; si algo falla, plan.md §5):

   ```bash
   npm run lint && npm run typecheck && npm run test --workspace @terreno/frontend && npm run test --workspace @terreno/shared
   ```

5. Commit del código:

   ```bash
   git add backend frontend shared
   git commit -m "feat(captura): hallazgo general, no ligado a una pregunta refs TSK-OFF-015, refs #<N>" -m "Co-Authored-By: <la línea de tu sesión>"
   ```

6. Documentación y su commit:

   ```bash
   python3 plans/009-plan-mejora-bloque-4/herramientas/T2-docs.py
   git add specs tasks test-plan.md data-model.md
   git commit -m "docs(specs): hallazgo directo en spec 004 y plan de pruebas refs TSK-OFF-015, refs #<N>" -m "Co-Authored-By: <la línea de tu sesión>"
   ```

7. **E2E (obligatorio en esta tarea):** `gh workflow run e2e.yml --ref feat/tsk-off-015-hallazgo-directo` y espera a que termine en verde antes de mergear (plan.md §4, paso 8).
8. Push, PR, CI y merge según plan.md §4, pasos 6, 8 y 9. Título del PR: `feat(captura): hallazgo general, no ligado a una pregunta refs TSK-OFF-015 (#<N>)`.
   En "Referencias" del PR: `Closes #<N>`, `TSK-OFF-015`, la ficha `plans/009-plan-mejora-bloque-4/T2-hallazgo-directo.md`.

## Criterio de aceptación

El de `TSK-OFF-015` en `tasks/009-plan-mejora-bloque-4/tasks.md`, con CI verde y E2E verde.

## Validación previa

El T2.py y el T2-docs.py se aplicaron en cadena (T1→T6) sobre `main` el 2026-11-14, con lint,
typecheck, build y pruebas del frontend en verde, y las pruebas de backend y el E2E corridas en CI
(PR de validación #224, cerrado sin mergear).
