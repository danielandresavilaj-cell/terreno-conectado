# Cómo trabajamos — línea de trabajo del equipo

**Equipo:** Daniel Ávila (@danielandresavilaj-cell) y Raúl González (@ev6rlasting).
**Modalidad:** asíncrona. Este documento es la referencia operativa: si tienes duda de "cómo se hace algo aquí", la respuesta está aquí, no en una conversación.

**Fuente de verdad del trabajo:** los issues de este repo, organizados en el board [Terreno Conectado — Sprint Board](https://github.com/users/danielandresavilaj-cell/projects/1).

---

## 1. La cadena de trazabilidad (por qué todo es auditable)

```
Spec (FR/NFR) → Tarea (TSK-XXX-NNN) → Issue (#N) → Rama → Commits → PR → Board (Done)
```

Cada eslabón referencia al anterior. La constitución lo exige (Art. II): *toda tarea referencia al menos un requisito; todo commit referencia al menos una tarea*. Si sigues esta cadena, cualquiera puede entrar por cualquier eslabón y reconstruir el contexto completo: qué se hizo, por qué, dónde está el código y qué falta.

**Nunca** trabajes en algo que no exista como tarjeta en el board con su FR/NFR Ref. Si surge trabajo nuevo, primero se crea el issue, después se codifica.

---

## 2. El ciclo diario (tomar una tarea y llevarla a Done)

### 1. Elige tarjeta
Board → vista **Kanban** o **Por Owner**. Solo tarjetas que cumplan la *Definition of Ready* (§5). Prioriza: P0 > P1 > P2, y dentro, lo que desbloquee más trabajo.

### 2. Toma posesión
- Asígnate el issue en GitHub.
- Mueve la tarjeta a **In Progress**. **Máximo 2 por persona** (límite WIP).

### 3. Crea la rama con el ID de la tarea

```bash
git checkout main && git pull
git checkout -b feat/tsk-ws-001-bootstrap
# formato: <tipo>/<tsk-id>-<descripción-corta>
# tipos: feat · fix · chore · docs · test
```

El `tsk-id` en el nombre conecta la rama con la tarjeta: es como tu compañero encontrará tu trabajo.

### 4. Codifica con commits atómicos referenciados

```bash
git commit -m "chore(repo): bootstrap npm workspaces (frontend/backend/infra/shared)

refs TSK-WS-001, refs #27"
```

Formato: [Conventional Commits](https://www.conventionalcommits.org/) + `refs TSK-…` + `refs #…`. Commits chicos, uno por cambio lógico.

### 5. Abre el PR temprano, como Draft

Aunque no esté listo. El PR draft es la señal de "estoy trabajando en esto, así va":

```bash
gh pr create --draft --title "TSK-WS-001: Bootstrap monorepo workspaces" --reviewer ev6rlasting
```

La plantilla de PR te pedirá `Closes #N` (cierra el issue automáticamente al mergear) y el criterio de aceptación.

### 6. Review cruzado
`main` está protegido: **todo PR requiere 1 aprobación del otro integrante**. El reviewer valida contra el criterio de aceptación del issue, no contra su gusto. Si tocas un área con code owner, GitHub lo asigna solo (ver `.github/CODEOWNERS`).

### 7. Mergea y cierra
- **Squash merge** → un commit limpio en `main` con el `#N` visible.
- Borra la rama. La tarjeta pasa a **Done**.

### 8. Handoff al cerrar tu sesión (obligatorio si la tarjeta sigue In Progress)

Ver §3. Es la regla más importante del trabajo asíncrono.

---

## 3. Handoff — la regla de oro del trabajo asíncrono

> **Ninguna sesión termina con una tarjeta In Progress sin dejar handoff.** Sin excepciones.

Deja un comentario en el issue con este formato exacto:

```
## Handoff 2026-10-06 (Daniel)
Hecho: workspaces creados, typecheck ok en frontend.
Falta: backend workspace + script de lint.
Bloqueo: decidir eslint vs biome (ver comentario arriba).
Rama: feat/tsk-ws-001-bootstrap (PR #46, draft)
```

**Para retomar el trabajo del otro** (playbook):

1. Board → tarjeta **In Progress** → abre el issue.
2. Lee el criterio de aceptación y el **último Handoff**.
3. `git fetch && git checkout <rama-del-handoff>` y revisa el PR draft.
4. Continúa. Al cerrar tu sesión, dejas tu propio handoff.

Con esto, el contexto nunca vive en la cabeza de nadie: vive en el issue.

---

## 4. Convenciones rápidas

| Cosa | Convención | Ejemplo |
| :--- | :--- | :--- |
| Rama | `<tipo>/<tsk-id>-<desc>` | `feat/tsk-form-005-importador-xlsx` |
| Commit | `tipo(alcance): msg` + `refs TSK-…, refs #…` | `feat(sync): batch upsert idempotente … refs TSK-WS-007` |
| PR | `TSK-XXX-NNN: título` | `TSK-WS-007: Ingesta idempotente sync/batch` |
| Issue tarea | `TSK-XXX-NNN: título` | `TSK-WS-001: Bootstrap monorepo…` |
| Granularidad | 1 tarjeta = 1 rama = 1 PR | — |

**Commits directos a `main`: prohibidos** (la protección de rama lo impide).

---

## 5. Definition of Ready / Definition of Done

**Ready** (entra al sprint solo si): FR/NFR Ref · Owner · Story Points · dependencias en Done · criterio de aceptación escrito.

**Done** (se cierra solo si): código + tests · CI verde (pendiente mientras #14 esté abierto) · spec actualizado si cambió comportamiento · commits con referencia · PR aprobado por el otro.

---

## 6. Ritmo asíncrono

| Cuándo | Qué | Dónde |
| :--- | :--- | :--- |
| **Cada sesión** | Al empezar: leer handoffs de tus tarjetas. Al terminar: dejar tu handoff | Comentarios del issue |
| **Diario (async)** | Check breve: qué hice / qué me bloquea / qué sigo | Comentario en tu tarjeta In Progress |
| **Lunes** | Planificación: mover de Backlog al sprint, re-estimar | Board, vista Backlog |
| **Viernes** | Revisión: qué quedó Done, qué aprendimos | Board, vista Kanban |

Las tarjetas con `Owner: Pair` (ej. TSK-WS-007, el corazón del sync) se hacen juntos en una sesión agendada: es la forma de que ambos entiendan el código crítico.

---

## 7. Sprint inicial (M0 — Walking Skeleton)

Orden según dependencias de `tasks/000-walking-skeleton/tasks.md`:

```
TSK-WS-001 bootstrap (Raúl)
 ├─► TSK-WS-002 postgres+RLS (Raúl) ─► TSK-WS-003 auth (Raúl) [bloqueada por decisión #11]
 └─► TSK-WS-004 PWA shell (Daniel) ─► TSK-WS-005 captura Dexie (Daniel)
                                       + TSK-FORM-001 render data-driven (integrado aquí)
                                       ─► TSK-WS-006 foto (Daniel)
TSK-WS-007 sync/batch (PAIR) ─► TSK-WS-008 worker ─► TSK-WS-009 LWW ─► TSK-WS-010 cross-tenant
TSK-WS-011 dashboard (Daniel) · TSK-WS-012 /health (Raúl)
```

**Bloqueos a resolver antes de codificar:** #14 (CI — requiere PAT con scope `workflow`), #13 (firmas de Daniel), #11 (decisión refresh token).

---

## 8. Notas operativas

- **Automatización del board:** activar en el Project → *Workflows*: *"Item closed → Status: Done"* y *"Auto-add: issues del repo → board"*. La API no lo permite; es un clic único en la UI.
- **CI:** los workflows están parqueados en la rama local `ci/workflow-parkada` hasta resolver #14 (el PAT actual no tiene scope `workflow`).
- **Referencias clave:** `constitution.md` (reglas innegociables) · `specs/000-master/spec.md` (visión y FR/NFR) · `tasks/` (tareas por iteración) · `plans/` (diseño) · `data-model.md` (entidades y RLS) · `test-plan.md` (matriz y caos).
