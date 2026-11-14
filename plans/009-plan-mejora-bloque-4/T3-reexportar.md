# T3 — TSK-OFF-017: Reexportar una inspección enviada

**Requisitos:** FR-019 · **Rama:** `feat/tsk-off-017-reexportar` · **Tarea:** `tasks/009-plan-mejora-bloque-4/tasks.md`
**Antes de empezar:** lee `plan.md` §3–§5. Las tareas anteriores deben estar mergeadas en `main`.

## Qué cambia

Cada inspección de la pantalla **Cola** (enviada o no) muestra el botón **"Descargar Excel"**. Genera el libro
con lo que quedó en el teléfono (plantilla congelada, respuestas y fotos). Si falta la plantilla o la planilla
original, muestra el motivo; nunca usa la red.

## Archivos que toca el script (sólo para revisar; no edites otros)

- `frontend/src/lib/exportar.ts` — `exportarInspeccionGuardada` y los mensajes `SIN_INSPECCION_LOCAL`, `SIN_PLANTILLA_LOCAL`.
- `frontend/src/screens/Cola.tsx` — botón en `TarjetaEnvio`; importa `../lib/exportar` **de forma diferida** (`await import(...)`).
- Pruebas: `frontend/test/reexportar.test.ts` (nuevo).

## No cambiar

- No importes `../lib/exportar` de forma estática en `Cola.tsx`: arrastraría ExcelJS (~900 kB) a esa pantalla.
- `frontend/test/cola-accesibilidad.test.ts` exige exactamente tres `<summary>` en `Cola.tsx`: no agregues desplegables.

## Pasos

1. Prepara la rama (plan.md §4, paso 0):

   ```bash
   git checkout main && git pull --ff-only origin main && git checkout -b feat/tsk-off-017-reexportar
   ```

2. Crea el issue y anota su número `<N>`:

   ```bash
   cat > "$TMPDIR/issue.md" <<'MD'
   Ítem 1.7 (pendiente) del plan de mejora: no se puede volver a descargar el Excel de una inspección ya enviada.

   **TSK-OFF-017** (FR-019): "Descargar Excel" en cada inspección de Cola, con lo guardado en el teléfono y sin red.

   Ficha: `plans/009-plan-mejora-bloque-4/T3-reexportar.md`.
   MD
   gh issue create --title "TSK-OFF-017: Reexportar una inspección enviada" --body-file "$TMPDIR/issue.md"
   ```

3. Aplica el código (el script se detiene con `PARA:` si algo no calza):

   ```bash
   python3 plans/009-plan-mejora-bloque-4/herramientas/T3.py
   ```

4. Verifica (todo en verde; si algo falla, plan.md §5):

   ```bash
   npm run lint && npm run typecheck && npm run test --workspace @terreno/frontend && npm run test --workspace @terreno/shared
   ```

5. Commit del código:

   ```bash
   git add backend frontend shared
   git commit -m "feat(cola): descargar el Excel de una inspección ya enviada refs TSK-OFF-017, refs #<N>" -m "Co-Authored-By: <la línea de tu sesión>"
   ```

6. Documentación y su commit:

   ```bash
   python3 plans/009-plan-mejora-bloque-4/herramientas/T3-docs.py
   git add specs tasks test-plan.md data-model.md
   git commit -m "docs(specs): reexportar desde Cola en spec 002 y plan de pruebas refs TSK-OFF-017, refs #<N>" -m "Co-Authored-By: <la línea de tu sesión>"
   ```

7. **E2E:** no hace falta en esta tarea.
8. Push, PR, CI y merge según plan.md §4, pasos 6, 8 y 9. Título del PR: `feat(cola): descargar el Excel de una inspección ya enviada refs TSK-OFF-017 (#<N>)`.
   En "Referencias" del PR: `Closes #<N>`, `TSK-OFF-017`, la ficha `plans/009-plan-mejora-bloque-4/T3-reexportar.md`.

## Criterio de aceptación

El de `TSK-OFF-017` en `tasks/009-plan-mejora-bloque-4/tasks.md`, con CI verde.

## Validación previa

El T3.py y el T3-docs.py se aplicaron en cadena (T1→T6) sobre `main` el 2026-11-14, con lint,
typecheck, build y pruebas del frontend en verde, y las pruebas de backend y el E2E corridas en CI
(PR de validación #224, cerrado sin mergear).
