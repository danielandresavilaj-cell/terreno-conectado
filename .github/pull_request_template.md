## Qué cambia

<!-- Una o dos líneas. Si es ISSUEFIX o feat/FR-xxx, cita el ID. -->

## Tarea / requisito

<!-- TSK-xxx o FR/NFR del spec maestro. Sin esto el PR no es revisable. -->

Closes #

## Qué revisa el otro integrante

<!-- La pregunta que quieres que se haga al leer el diff. Ej: "¿esta decisión de
     LWW coincide con el spec §?" -->

## Verificación

<!-- Qué corriste y qué salió. Si algo no se pudo correr, dilo. -->

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm test` (cuando exista la suite)
- [ ] Probado en modo avión (si toca captura o cola)

## Checklist de constitution

- [ ] No rompe el offline-first (Art. I)
- [ ] Cada requisito tocado está actualizado en el spec, en este mismo PR (Art. II)
- [ ] Sin sobreescritura silenciosa ni pérdida en conflictos (Art. III)
- [ ] Aislamiento por `tenant_id` / RLS, no solo un filtro de aplicación (Art. IV)
- [ ] Toda dependencia nueva está justificada en `docs/research.md` (Art. V)
- [ ] Ningún secreto en el diff; `.env` nunca se versiona (Art. IX)

## Capturas

<!-- Si toca UI: captura antes/después. El diseño se lee mejor viéndose. -->