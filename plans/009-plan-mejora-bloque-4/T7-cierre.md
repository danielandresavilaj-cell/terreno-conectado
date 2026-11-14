# T7 — Cierre del bloque 4

**Antes de empezar:** T1–T6 mergeadas en `main`, con CI verde. Esta ficha no cambia código.

## Pasos

1. Rama e issue no hacen falta: es una actualización de documentación del bloque. Rama:

   ```bash
   git checkout main && git pull --ff-only origin main && git checkout -b docs/plan-009-cierre
   ```

2. **Conteo de pruebas.** Corre en local el frontend y shared y anota los totales:

   ```bash
   npm run test --workspace @terreno/frontend 2>&1 | grep "Tests "
   npm run test --workspace @terreno/shared 2>&1 | grep "Tests "
   ```

   El total del backend se lee del último CI de `main` (no corre en local sin Docker):

   ```bash
   RUN=$(gh run list --workflow ci.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
   XDG_CACHE_HOME="$TMPDIR/xdg" gh run view "$RUN" --log | grep -E "Tests +[0-9]+ passed" | sed 's/.*Tests/Tests/'
   ```

   Aparecen tres líneas, en este orden: shared, frontend, backend. El E2E sigue en 23.

3. Actualiza con esos números (TOTAL = backend + frontend + shared + 23):
   - `README.md`, línea que empieza con `- **Pruebas**:` → `TOTAL automatizadas: BACKEND de integración del backend, FRONTEND unitarias del frontend, 92 de` (deja el resto de la línea igual).
   - `test-plan.md`, bloque "Volumen de pruebas": las líneas `Integración backend`, `Unidad frontend`, `Unidad shared` y la del total, con la etiqueta `(v1.4, bloque 4 del plan de mejora, <fecha>)`.
   - `test-plan.md`: sube la versión del encabezado en un PATCH y agrega la fila de cambios
     `| <versión> | <fecha> | Volumen contado en CI tras el bloque 4 (plan 009) | <tu nombre o "Daniel Ávila (con IA)"> |`.

4. **Plan de mejora.** En `docs/auditoria-y-plan-de-mejora.md` §6, en la tabla de avance, agrega estas filas al final:

   ```text
   | 1.2 Varias fotos por hallazgo | TSK-OFF-016 | #<PR T1> | ✅ |
   | 1.5 Hallazgo directo | TSK-OFF-015 | #<PR T2> | ✅ |
   | 1.7 Reexportar desde el teléfono | TSK-OFF-017 | #<PR T3> | ✅ |
   | 3.5 Archivar y duplicar formularios | TSK-FORM-024 (FR-066) | #<PR T4> | ✅ |
   | 2.5 Tendencia y filtros en una barra | TSK-REP-012 | #<PR T5> | ✅ |
   | 1.1 Faenas por cuenta | TSK-ADM-003 (FR-065) | #<PR T6> | ✅ |
   ```

   Y en las filas existentes de 1.1, 1.2, 1.5, 1.7, 2.5 y 3.5 de esa misma tabla, cambia 🟡 por ✅ y borra
   el texto "pendiente …" que ya quedó resuelto.

5. Verifica, haz commit, PR y merge (plan.md §4, pasos 3, 5, 6, 8 y 9). Mensaje:
   `docs: cierre del bloque 4 del plan de mejora y volumen de pruebas` (+ tu línea `Co-Authored-By:`).

6. **Despliegue a producción** (hay una migración nueva, la 021; el despliegue la aplica sola):

   ```bash
   RUN=$(gh workflow run deploy.yml --ref main -f ref=main -f publish_only=false 2>&1 | tail -1 | sed 's#.*/##')
   gh run watch "$RUN" --exit-status --interval 30
   curl -sS https://terrenoconectado.cl/health
   ```

   Debe responder `{"status":"ok", ... ,"db":"up"}`. Comprueba además que las rutas nuevas existen (deben
   responder **401**, porque piden sesión; un 404 indica que el despliegue no tomó la versión nueva):

   ```bash
   for r in templates/archivadas users/00000000-0000-7000-8000-000000000000/faenas; do
     printf "%s " "$r"; curl -s -o /dev/null -w "%{http_code}\n" "https://terrenoconectado.cl/api/v1/$r"
   done
   ```

   (`gh` necesita `github.com` y `api.github.com`; `curl`, `terrenoconectado.cl`.) Si el despliegue falla,
   **no reintentes a ciegas**: lee el log (`XDG_CACHE_HOME="$TMPDIR/xdg" gh run view "$RUN" --log-failed`) y reporta.

7. **Reporte final** al usuario, en español y breve: qué PR quedó por cada tarea, resultado del CI y del E2E,
   resultado del despliegue y de las comprobaciones, y cualquier cosa que no se pudo verificar (por ejemplo,
   que nadie probó las pantallas nuevas con sesión iniciada en un teléfono real).
