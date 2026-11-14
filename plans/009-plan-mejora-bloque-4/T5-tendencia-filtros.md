# T5 — TSK-REP-012: Tendencia semanal y filtros en una barra

**Requisitos:** FR-040, FR-041 · **Rama:** `feat/tsk-rep-012-tendencia-filtros` · **Tarea:** `tasks/009-plan-mejora-bloque-4/tasks.md`
**Antes de empezar:** lee `plan.md` §3–§5. Las tareas anteriores deben estar mergeadas en `main`.

## Qué cambia

Gerencia muestra **"Últimas 8 semanas"** (inspecciones y hallazgos por semana) y reúne los filtros de faena,
severidad y autor en **una barra de selectores** sobre las métricas. Desaparecen las tres columnas de tarjetas de
filtro y el segundo selector de autor de la lista de inspecciones (el autor es un solo filtro).

## Archivos que toca el script (sólo para revisar; no edites otros)

- `backend/src/dashboard/dashboard.service.ts` — `summary.tendencia_semanal` (consulta con `generate_series`).
- `shared/src/dashboard.ts` — campo `tendencia_semanal` en `DashboardSummary`.
- `frontend/src/components/dashboard/TendenciaSemanal.tsx` (nuevo).
- `frontend/src/screens/Dashboard.tsx` — barra de filtros, un solo `autor`, tendencia, sin `Tarjeta`.
- Pruebas: `backend/test/dashboard-tendencia.spec.ts` (nuevo).

## No cambiar

- No agregues una librería de gráficos (Art. V): la tendencia usa el componente `Barra` existente.
- La tendencia **no** se recorta por el período elegido; sí por faena (así lo prueba el spec de backend).

## Pasos

1. Prepara la rama (plan.md §4, paso 0):

   ```bash
   git checkout main && git pull --ff-only origin main && git checkout -b feat/tsk-rep-012-tendencia-filtros
   ```

2. Crea el issue y anota su número `<N>`:

   ```bash
   cat > "$TMPDIR/issue.md" <<'MD'
   Ítem 2.5 (pendiente) del plan de mejora: Gerencia no muestra tendencia y sus filtros están repartidos en tres lugares.

   **TSK-REP-012** (FR-040, FR-041): `summary.tendencia_semanal` (8 semanas) y filtros en una barra con un solo filtro de autor.

   Ficha: `plans/009-plan-mejora-bloque-4/T5-tendencia-filtros.md`.
   MD
   gh issue create --title "TSK-REP-012: Tendencia semanal y filtros en una barra" --body-file "$TMPDIR/issue.md"
   ```

3. Aplica el código (el script se detiene con `PARA:` si algo no calza):

   ```bash
   python3 plans/009-plan-mejora-bloque-4/herramientas/T5.py
   ```

4. Verifica (todo en verde; si algo falla, plan.md §5):

   ```bash
   npm run lint && npm run typecheck && npm run test --workspace @terreno/frontend && npm run test --workspace @terreno/shared
   ```

5. Commit del código:

   ```bash
   git add backend frontend shared
   git commit -m "feat(dashboard): tendencia de 8 semanas y filtros en una barra refs TSK-REP-012, refs #<N>" -m "Co-Authored-By: <la línea de tu sesión>"
   ```

6. Documentación y su commit:

   ```bash
   python3 plans/009-plan-mejora-bloque-4/herramientas/T5-docs.py
   git add specs tasks test-plan.md data-model.md
   git commit -m "docs(specs): tendencia y filtros en spec 005 y plan de pruebas refs TSK-REP-012, refs #<N>" -m "Co-Authored-By: <la línea de tu sesión>"
   ```

7. **E2E:** no hace falta en esta tarea.
8. Push, PR, CI y merge según plan.md §4, pasos 6, 8 y 9. Título del PR: `feat(dashboard): tendencia de 8 semanas y filtros en una barra refs TSK-REP-012 (#<N>)`.
   En "Referencias" del PR: `Closes #<N>`, `TSK-REP-012`, la ficha `plans/009-plan-mejora-bloque-4/T5-tendencia-filtros.md`.

## Criterio de aceptación

El de `TSK-REP-012` en `tasks/009-plan-mejora-bloque-4/tasks.md`, con CI verde.

## Validación previa

El T5.py y el T5-docs.py se aplicaron en cadena (T1→T6) sobre `main` el 2026-11-14, con lint,
typecheck, build y pruebas del frontend en verde, y las pruebas de backend y el E2E corridas en CI
(PR de validación #224, cerrado sin mergear).
