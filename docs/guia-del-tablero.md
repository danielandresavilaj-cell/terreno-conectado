# GUÍA DEL TABLERO — Cómo navegar, leer, estudiar y trabajar con el board

**Versión:** 1.0.0 · **Fecha:** 2026-09-25 · **Autor:** Daniel Ávila (con IA)
**Relacionado:** `constitution.md` (Artículos II, VIII, X) · `specs/000-master/spec.md` §9/§12 · `tasks/000-walking-skeleton/tasks.md` · `plans/000-walking-skeleton/plan.md`
**Tablero:** <https://github.com/users/danielandresavilaj-cell/projects/1>

> Esta guía existe para que **cualquiera de los dos integrantes** pueda abrir el tablero en frío y saber exactamente qué mirar, qué significa cada cosa y qué hacer a continuación. Léela una vez completa; después úsala como referencia.

---

## 1. Las tres capas del sistema de trabajo

Lo primero que hay que entender es que **no hay un solo lugar donde vive el trabajo**. Hay tres capas conectadas, y cada una tiene un rol distinto:

```
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 1 — EL REPO (la verdad escrita)                           │
│  specs/ · plans/ · tasks/ · adr/ · constitution.md              │
│                                                                 │
│  Aquí vive el QUÉ y el POR QUÉ. Los requisitos FR/NFR, las      │
│  decisiones arquitectónicas, los criterios de aceptación.       │
│  Cambia lento y solo por PR.                                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ cada requirement se convierte en…
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 2 — LOS ISSUES (la verdad ejecutable)                     │
│  github.com/danielandresavilaj-cell/terreno-conectado/issues    │
│                                                                 │
│  Aquí vive el trabajo concreto. Cada issue es una unidad que    │
│  se puede asignar, comentar, cerrar y referenciar desde un      │
│  commit. Es la capa que git entiende.                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ los issues se organizan en…
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 3 — EL BOARD (la verdad visual)                           │
│  github.com/users/danielandresavilaj-cell/projects/1            │
│                                                                 │
│  Aquí vive el CUÁNDO y el QUIÉN. No crea contenido nuevo:       │
│  ordena, agrupa y muestra el estado de los issues de la capa 2. │
│  Cambia todos los días.                                         │
└─────────────────────────────────────────────────────────────────┘
```

**Regla mental:** el board nunca contradice al repo. Si el board dice que una tarea está `Done` pero el spec no refleja el cambio de comportamiento, **el board está mal**, no el spec.

### Por qué importa esta separación

Un cambio en cada capa tiene un costo distinto:

| Capa | Cambiar algo cuesta | Quién aprueba |
| :--- | :--- | :--- |
| Repo (spec congelado) | Un PR de enmienda numerada + justificación | Ambos integrantes (Artículo X) |
| Issues | Editar el issue, comentar | El owner de la tarjeta |
| Board | Arrastrar una tarjeta | Cualquiera de los dos |

---

## 2. Anatomía de una tarjeta

Abramos un issue real para aprender a leerlo. Ejemplo: **[#19 — TSK-WS-005](https://github.com/danielandresavilaj-cell/terreno-conectado/issues/19)**.

```
┌──────────────────────────────────────────────────────────────────┐
│ TSK-WS-005: Captura offline en Dexie — inspección + hallazgo…    │  ← TÍTULO
│ #19  Abierto  ·  danielandresavilaj-cell abrió hace 2 días       │  ← NÚMERO (el que citas en commits)
├──────────────────────────────────────────────────────────────────┤
│  🔵 module:000-ws  🔵 module:002-offline  🔵 type:task           │  ← LABELS (visibles en todo GitHub)
│  🔴 priority:P0  🔵 phase:F2                                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  | Campo | Valor |                     ← TABLA DE METADATOS      │
│  | Épica padre | #3 |                                            │
│  | Módulo | 000-ws · 002-offline |                               │
│  | Prioridad | 🔴 P0 — Vital |                                   │
│  | Responsable | @danielandresavilaj-cell |                      │
│  | Story points | 8 |                                            │
│  | Depende de | TSK-WS-004 |           ← qué debe estar Done     │
│  | Bloquea a | TSK-WS-006, TSK-WS-007 | ← qué espera por esta    │
│                                                                  │
│  ## Requisito(s) que cumple            ← TRAZABILIDAD (Art. II)  │
│  FR-011 · FR-013 · FR-014 · FR-015                               │
│                                                                  │
│  ## Qué hay que hacer                  ← EL TRABAJO              │
│  - Dexie con los stores de data-model.md §2.4                    │
│  - Formularios mínimos…                                          │
│                                                                  │
│  ## Criterio de aceptación             ← CÓMO SÉ QUE TERMINÉ     │
│  - [ ] Crear un registro en modo avión funciona                  │
│  - [ ] El registro sobrevive cerrar y reabrir la app             │
│  - [ ] IDs UUIDv7 generados en el cliente                        │
│                                                                  │
│  ## Contexto técnico                   ← POR QUÉ ES ASÍ          │
│  > Cita al Artículo I de la constitución…                        │
│                                                                  │
│  ## Referencias                        ← DÓNDE PROFUNDIZAR       │
│  - data-model.md §2.4                                            │
│  - test-plan.md §4 escenario 4                                   │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  Barra lateral derecha:                                          │
│    Assignees: @danielandresavilaj-cell                           │
│    Labels: (los 5 de arriba)                                     │
│    Milestone: M0 — Walking Skeleton (S5–S8)                      │
│    Projects: Terreno Conectado — Sprint Board  ← con sus campos  │
│    Sub-issues: (ninguno, es hoja)                                │
│    Development: (PRs vinculados aparecerán acá)                  │
└──────────────────────────────────────────────────────────────────┘
```

### El orden en que hay que leer una tarjeta

No se lee de arriba hacia abajo sin más. Se lee en este orden:

1. **Depende de** → ¿puedo empezarla hoy, o estoy bloqueado?
2. **Criterio de aceptación** → ¿qué significa "terminado"? Léelo *antes* de escribir código, no después.
3. **Requisito(s) que cumple** → ¿qué promesa del spec estoy implementando?
4. **Referencias** → abrir el spec/plan/data-model citado y leer esa sección.
5. **Qué hay que hacer** → recién ahora, la lista de pasos.
6. **Contexto técnico** → las trampas conocidas y las decisiones ya tomadas.

> **Error común:** empezar por "Qué hay que hacer" y codificar de inmediato. Eso produce código que funciona pero no cumple el criterio de aceptación, porque nunca lo leíste.

---

## 3. Las 6 vistas y cuándo usar cada una

El board tiene seis vistas guardadas. Están arriba, como pestañas.

| # | Vista | Layout | Para qué sirve | Cuándo la abres |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Kanban** | Board | Ver el flujo del día: `Todo → In Progress → Done` | Al empezar cada sesión de trabajo |
| 2 | **Por Módulo** | Board | Ver el avance de cada spec (001-auth, 003-sync…) | Al cerrar un módulo, o para saber qué spec va atrasado |
| 3 | **Por Owner** | Board | Ver qué tiene cada uno y detectar desbalance | En el daily de 15 min |
| 4 | **Backlog** | Table | Todo lo pendiente, con puntos y referencias FR/NFR | En la planificación del lunes |
| 5 | **Sprint M0** | Table | Solo el milestone actual, sin ruido | Cuando necesitas foco |
| 6 | **Roadmap de épicas** | Roadmap | Línea de tiempo de fases y módulos | Para explicar el semestre al docente |

### Configurar el agrupamiento (una sola vez, pendiente)

La API de GitHub **no permite** setear el "agrupar por" de una vista. Hay que hacerlo a mano:

1. Abre la vista (ej. **Kanban**)
2. Arriba a la derecha, botón **Group** (o el ícono de columnas)
3. Elige el campo:
   - Kanban → **Status**
   - Por Módulo → **Módulo**
   - Por Owner → **Owner**
4. GitHub guarda la configuración automáticamente

Lo mismo con **Sort** (ordenar): en Kanban, ordena por **Prioridad** descendente para que las P0 queden arriba.

### Filtrar dentro de una vista

En la barra superior de cualquier vista, clic en **Filters**. Sintaxis útil:

```
status:"In Progress"              solo lo que está en curso
-priority:P3                      todo menos prioridad baja
module:003-sync                   solo el motor de sincronización
owner:Daniel                      solo mis tarjetas
milestone:"M0 — Walking Skeleton" solo el sprint actual
is:issue is:open                  abiertos
```

Los filtros se pueden combinar y **guardar** en la vista (menú `•••` → Save view).

---

## 4. El flujo de trabajo diario

### Al empezar a trabajar (5 min)

1. Abre la vista **Por Owner**
2. Busca tu columna
3. Elige **una** tarjeta de `Todo` cuyas dependencias estén en `Done`
4. Arrástrala a `In Progress`

> **Límite de WIP: máximo 2 tarjetas en `In Progress` por persona.** Si ya tienes 2, termina una antes de empezar otra. Esta regla existe porque el `plan.md` §4 identifica como riesgo alto que el walking skeleton se estanque con 6 frentes abiertos a medio hacer.

### Mientras trabajas

- Cada commit referencia el issue: `Closes #19` o `refs TSK-WS-005`
- Si descubres algo que cambia el criterio de aceptación → **comenta en el issue**, no te lo guardes
- Si te bloqueas → etiqueta el issue con `blocks` y avisa en el daily

### Al terminar

Una tarjeta se mueve a `Done` **solo si** se cumple la Definition of Done (§6). No antes.

### El daily de 15 minutos

Ambos abren la vista **Por Owner** y cada uno responde tres preguntas:

1. ¿Qué terminé ayer? (mover a `Done`)
2. ¿Qué hago hoy? (mover a `In Progress`)
3. ¿Qué me bloquea? (señalar la dependencia o el issue de tipo `Decision`)

---

## 5. Cómo estudiar el proyecto a través del board

Esta sección es para **aprender el proyecto**, no para trabajar en él. Úsala cuando quieras entender de qué se trata Terreno Conectado o cuando necesites explicárselo al docente.

### Ruta de lectura recomendada

```
PASO 1 — Entender las reglas del juego (20 min)
  constitution.md
  → Los 10 artículos. Lee especialmente el I (offline-first),
    el III (integridad) y el IV (aislamiento multi-tenant).
    Son las tres promesas que el proyecto no puede romper.

PASO 2 — Entender qué se va a construir (40 min)
  specs/000-master/spec.md
  → §1 Problema · §2 Actores · §3 Visión (con el diagrama mermaid)
  → §5 Requisitos funcionales (FR-001 a FR-052)
  → §6 Requisitos no funcionales (NFR-01 a NFR-12)
  → §9 El MVP: el guion de 6 pasos de la demo
  → §13 Criterios de aceptación de la demo final

PASO 3 — Ver el trabajo concreto (15 min)
  Abre el board → vista "Roadmap de épicas"
  → Mira la línea de tiempo de las fases
  Luego abre la vista "Sprint M0"
  → Ahí están las 12 tareas que hacen funcionar el MVP

PASO 4 — Entender el orden de construcción (20 min)
  plans/000-walking-skeleton/plan.md
  → §2 El grafo de dependencias (por qué TSK-007 y TSK-008 van juntos)
  → §3 Las decisiones técnicas ya cerradas
  → §4 Los riesgos y cómo se mitigan

PASO 5 — Profundizar en el corazón del proyecto (30 min)
  specs/003-motor-sincronizacion/spec.md
  data-model.md §4 (reglas de integridad)
  test-plan.md §4 (los 7 escenarios de caos)
  → Este es el módulo donde se juega la nota. El board lo marca
    en rojo (module:003-sync) a propósito.

PASO 6 — Recién ahora, mirar código (cuando exista)
  frontend/ · backend/ · infra/
  → Hoy están vacíos (solo .gitkeep). Se llenan en la iteración 0.
```

### Ejercicio de estudio con el board

Para verificar que entendiste, haz esto:

1. Abre la vista **Por Módulo**
2. Cuenta cuántas tarjetas P0 hay en `003-sync`
3. Abre cada una y anota qué FR del spec cumple
4. Ahora abre `specs/000-master/spec.md` §5.3 y verifica que todos los FR-020 a FR-026 estén cubiertos
5. Si falta alguno → hay un hueco en el plan, y eso es un hallazgo valioso

Ese ejercicio es exactamente lo que exige el **NFR-12** (trazabilidad SDD: 100% de tasks referencian FR/NFR).

### El board como evidencia académica

El spec maestro §12 mapea cada evidencia que pide la asignatura con un artefacto del repo. El board agrega una más:

| Evidencia APT | Dónde está |
| :--- | :--- |
| Plan de trabajo / Carta Gantt | Los **milestones** M0–M3 con sus rangos de semanas |
| Avance SDD | El **historial del board** + historial git (cada commit cita un issue) |
| Trazabilidad requisito → código | El campo **FR/NFR Ref** de cada tarjeta |

---

## 6. Las reglas del tablero

### Definition of Ready — antes de empezar una tarjeta

- [ ] Tiene **FR/NFR Ref** (referencia a un requisito del spec)
- [ ] Tiene **Owner** asignado
- [ ] Tiene **Story Points** estimados
- [ ] Sus dependencias están en `Done`
- [ ] El criterio de aceptación está escrito en el cuerpo del issue

Si falta algo, la tarjeta **no está lista** y no se mueve a `In Progress`.

### Definition of Done — antes de cerrarla

- [ ] Código + tests (unit e integración) escritos
- [ ] **CI verde**
- [ ] Spec actualizado si cambió comportamiento referenciado (Artículo II)
- [ ] El commit referencia el issue (`Closes #NN`)
- [ ] PR aprobado por el otro integrante
- [ ] Todos los checkboxes del "Criterio de aceptación" marcados

### La regla de trazabilidad (Artículo II de la constitución)

> *"Cada task en `tasks/` referencia al menos un ID de requisito; cada commit referencia al menos un task."*

En la práctica, cada commit se ve así:

```bash
git commit -m "feat(offline): atomic Dexie transactions for outbox writes

Implements FR-011, FR-014
Closes #19"
```

El `#19` es `TSK-WS-005`. Así quedan conectados: **historial git ↔ board ↔ issues ↔ specs**.

### Convención de mensajes de commit

Según NFR-10: commits en **inglés**, formato conventional commits:

| Prefijo | Cuándo |
| :--- | :--- |
| `feat:` | Funcionalidad nueva |
| `fix:` | Corrección de un bug |
| `test:` | Solo tests |
| `docs:` | Solo documentación |
| `refactor:` | Sin cambio de comportamiento |
| `chore:` | Tooling, dependencias, CI |
| `perf:` | Mejora de rendimiento |

Y el ámbito entre paréntesis = el módulo: `feat(sync):`, `fix(auth):`, `test(offline):`.

---

## 7. Los 6 campos, en detalle

| Campo | Tipo | ¿Qué responde? | Valores |
| :--- | :--- | :--- | :--- |
| **Módulo** | Selección única | ¿A qué área del sistema va? | `000-ws` `001-auth` `002-offline` `003-sync` `004-domain` `005-reports` `006-admin` `infra` `docs` |
| **Tipo** | Selección única | ¿Qué clase de trabajo es? | `Task` `Bug` `Spike` `Doc` `Decision` `Amendment` |
| **FR/NFR Ref** | Texto | ¿Qué regla del spec cumple? | Ej: `FR-011, FR-014, NFR-01` |
| **Owner** | Selección única | ¿De quién es? | `Daniel` `Raúl` `Pair` |
| **Prioridad** | Selección única | ¿Qué tan urgente? | `P0-Crítica` `P1-Alta` `P2-Media` `P3-Baja` |
| **Story Points** | Número | ¿Qué tan grande? | Fibonacci: 1 · 2 · 3 · 5 · 8 · 13 |

### Los 9 módulos

| Valor | Spec | Autor | De qué se trata |
| :--- | :--- | :--- | :--- |
| `000-ws` | maestro §9 | ambos | El walking skeleton: el corte vertical mínimo |
| `001-auth` | 001 | Raúl | Login, JWT, roles, aislamiento RLS |
| `002-offline` | 002 | Daniel | La PWA que funciona sin internet |
| `003-sync` | 003 | Daniel | **El corazón**: subir datos sin perder ni duplicar |
| `004-domain` | 004 | Daniel | Inspecciones, hallazgos, bitácoras, plantillas |
| `005-reports` | 005 | Daniel | Dashboards y reportes para gerencia |
| `006-admin` | 006 | Raúl | Gestión de tenants, auditoría, health |
| `infra` | ADR-002 | Raúl | VPS, Docker, Caddy, CI/CD |
| `docs` | — | ambos | Documentación y evidencias APT |

### Los 6 tipos

| Valor | Cuándo usarlo | Ejemplo real |
| :--- | :--- | :--- |
| `Task` | Trabajo de construcción normal | #19 Captura offline en Dexie |
| `Bug` | Algo se rompió | (aún no hay ninguno) |
| `Spike` | Hay que investigar antes de poder decidir | "Probar 2 formas de guardar blobs y elegir" |
| `Doc` | Escribir documentación | #13 Firmas pendientes |
| `Decision` | Decisión abierta que **bloquea** avance | #11 Elegir estrategia de refresh token |
| `Amendment` | Cambio a un spec ya congelado | Requiere PR numerado + firma de ambos |

### Las 4 prioridades

| Valor | Significado | Regla práctica |
| :--- | :--- | :--- |
| `P0-Crítica` | Sin esto, **la demo ante el docente falla** | Se hace sí o sí en el sprint actual |
| `P1-Alta` | Debe estar pronto, pero la demo sobrevive sin ello | Planificar para el sprint siguiente |
| `P2-Media` | Deseable | Backlog |
| `P3-Baja` | Algún día | Backlog, y probablemente nunca |

### Cómo estimar story points

No son horas. Son **tamaño relativo**, y el cerebro humano compara mejor de lo que estima tiempo absoluto.

| Puntos | Referencia | Ejemplo del walking skeleton |
| :--- | :--- | :--- |
| **1** | Cambio trivial, sin riesgo | Ajustar un texto |
| **2** | Pequeño y conocido | TSK-012: endpoint `/health` + logs |
| **3** | Mediano, sin incógnitas | TSK-001: bootstrap del monorepo |
| **5** | Grande, o mediano con una incógnita | TSK-003: auth completo con rate-limit |
| **8** | Muy grande, con riesgo técnico real | TSK-005: Dexie + formularios offline |
| **13** | **Señal de alerta: partir la tarea** | Ninguno debería llegar acá |

**Técnica para estimar en pareja:** cada uno piensa su número en secreto, los dicen a la vez. Si coinciden, listo. Si difieren mucho, el que dijo más alto explica qué ve que el otro no ve, y se vuelve a votar. Dos rondas bastan.

---

## 8. Estructura de issues del proyecto

```
#1   [F1] Fase 1 — Definición del proyecto                 CERRADO
#2   [F2] Fase 2 — Diseño y desarrollo iterativo           ← épica paraguas
│
├── #3   Iteración 0 — Walking skeleton (MVP vertical)     ← MILESTONE M0
│   ├── #27  TSK-WS-001  Bootstrap monorepo pnpm           Raúl   3 pts
│   ├── #16  TSK-WS-002  PostgreSQL 16 + RLS               Raúl   5 pts
│   ├── #17  TSK-WS-003  Auth (login/refresh/me)           Raúl   5 pts  ⚠ bloqueado por #11
│   ├── #18  TSK-WS-004  PWA shell + service worker        Daniel 3 pts
│   ├── #19  TSK-WS-005  Captura offline en Dexie          Daniel 8 pts
│   ├── #20  TSK-WS-006  Compresión de foto                Daniel 3 pts
│   ├── #21  TSK-WS-007  Ingesta idempotente /sync/batch   PAIR   8 pts  🔥 corazón
│   ├── #22  TSK-WS-008  Worker de cola cliente            Daniel 5 pts
│   ├── #23  TSK-WS-009  LWW + CONFLICT_RECORD             Daniel 5 pts
│   ├── #24  TSK-WS-010  Rechazo cross-tenant + audit      Raúl   3 pts
│   ├── #25  TSK-WS-011  Dashboard mínimo (≤60s)           Daniel 5 pts
│   └── #26  TSK-WS-012  /health + logs JSON               Raúl   2 pts
│                                                           ─────
│                                                           55 pts
│
├── #4   Módulo 001 — Autenticación y tenancy              ← MILESTONE M1
├── #5   Módulo 002 — Captura offline (PWA)
├── #6   Módulo 003 — Motor de sincronización
├── #7   Módulo 004 — Dominio de inspecciones
├── #8   Módulo 005 — Reportes y gerencia
├── #9   Módulo 006 — Administración de plataforma
├── #10  Pruebas de validación (matriz §3 + caos 1–7)       ← MILESTONE M2
│
├── #11  D5 — Decidir estrategia de refresh token           ⚠ BLOQUEA TSK-WS-003
├── #12  D2 — Cerrar modelos de red-team
├── #13  Firmas pendientes de Daniel                        ⚠ TE TOCA A TI
├── #14  CI/CD — Reactivar .github/workflows                ⚠ BLOQUEA LA SEGURIDAD
│
└── #15  [F3] Fase 3 — Cierre, informe final y presentación ← MILESTONE M3
```

Las 12 tareas son **sub-issues** de #3. GitHub muestra una barra de progreso automática en la barra lateral del épico: si 4 de 12 están `Done`, dice 33%.

---

## 9. Operaciones comunes

### Desde la interfaz web

| Quiero… | Cómo |
| :--- | :--- |
| Mover una tarjeta | Arrastrarla entre columnas |
| Cambiar un campo | Clic en el valor del campo, elegir otro |
| Asignar a alguien | Clic en **Assignees** → buscar el usuario |
| Ver el progreso de una épica | Abrir la épica → barra lateral → **Sub-issues progress** |
| Filtrar | Barra superior → **Filters** |
| Guardar un filtro | Menú `•••` → **Save view** |
| Agregar un issue existente al board | Botón **+ Add item** → pegar la URL o el número |
| Crear un issue nuevo desde el board | **+ Add item** → escribir título → clic en el `+` verde para convertirlo en issue |
| Ver el README del board | Ícono de libro arriba a la derecha |

### Desde la terminal con `gh`

```bash
# Listar mis tareas abiertas
gh issue list --repo danielandresavilaj-cell/terreno-conectado \
  --assignee @me --state open

# Ver una tarea completa
gh issue view 19 --repo danielandresavilaj-cell/terreno-conectado

# Comentar en una tarea (útil en el daily)
gh issue comment 19 --repo danielandresavilaj-cell/terreno-conectado \
  --body "Bloqueado: Dexie no persiste blobs >5MB en Safari. Investigando."

# Ver el board desde la terminal
gh project item-list 1 --owner danielandresavilaj-cell \
  --format json | jq '.items[] | {title, status: .status, owner: .Owner}'

# Ver el progreso del milestone actual
gh api /repos/danielandresavilaj-cell/terreno-conectado/milestones/1 \
  --jq '"\(.title): \(.closed_issues)/\(.open_issues + .closed_issues) cerrados"'

# Ver qué issues bloquean a otros
gh issue list --repo danielandresavilaj-cell/terreno-conectado \
  --label blocks --state open
```

### Atajos de teclado en GitHub Projects

| Tecla | Acción |
| :--- | :--- |
| `/` | Enfocar el buscador de filtros |
| `n` | Nuevo item |
| `↑` `↓` | Navegar entre tarjetas |
| `Enter` | Abrir la tarjeta seleccionada |
| `Esc` | Cerrar el panel lateral |
| `?` | Ver todos los atajos |

---

## 10. Cómo agregar una tarea nueva

Paso a paso completo. Ejemplo: hay que agregar "Descarga incremental de plantillas para offline" al módulo 003.

### 1. Determinar el ID de tarea

La convención es `TSK-<MÓDULO>-NNN`:

| Módulo | Prefijo | Ejemplo |
| :--- | :--- | :--- |
| Walking skeleton | `TSK-WS-` | TSK-WS-013 |
| Spec 001 | `TSK-AT-` | TSK-AT-001 |
| Spec 002 | `TSK-CO-` | TSK-CO-001 |
| Spec 003 | `TSK-MS-` | TSK-MS-001 |
| Spec 004 | `TSK-DI-` | TSK-DI-001 |
| Spec 005 | `TSK-RG-` | TSK-RG-001 |
| Spec 006 | `TSK-AP-` | TSK-AP-001 |

### 2. Verificar que exista el requisito

Abrir el spec correspondiente y encontrar el FR/NFR. **Si no existe el requisito, la tarea no va** (Artículo II): primero se enmienda el spec, después se crea la tarea.

En este ejemplo: `specs/003-motor-sincronizacion/spec.md` tiene pendiente *"Descarga incremental hacia el cliente (plantillas y datos de referencia para offline)"*. Hay requisito, procede.

### 3. Crear el issue

Título: `TSK-MS-001: Descarga incremental de plantillas para operar offline`

Cuerpo — copiar esta plantilla:

```markdown
| Campo | Valor |
| :--- | :--- |
| **Épica padre** | #6 — Módulo 003 |
| **Fase** | F2 — Diseño y desarrollo iterativo |
| **Módulo** | `003-sync` |
| **Tipo** | Task |
| **Prioridad** | 🟠 P1 — Importante |
| **Responsable** | @danielandresavilaj-cell |
| **Story points** | 5 |
| **Depende de** | TSK-WS-007 |
| **Bloquea a** | — |

## Requisito(s) que cumple

`FR-0XX` (descripción corta del requisito)

## Qué hay que hacer

- Paso concreto 1
- Paso concreto 2

## Criterio de aceptación

- [ ] Cosa observable que demuestra que funciona
- [ ] Test que lo cubre

## Contexto técnico

Notas, decisiones ya tomadas, trampas conocidas.

## Referencias

- `specs/003-motor-sincronizacion/spec.md` §X
- `data-model.md` §X
- `test-plan.md` §X

---

> **Regla (Artículo II):** cada commit de esta tarea debe referenciar este issue.
```

### 4. Aplicar labels

```bash
gh issue create --repo danielandresavilaj-cell/terreno-conectado \
  --title "TSK-MS-001: Descarga incremental de plantillas para operar offline" \
  --body-file ./nueva-tarea.md \
  --label "module:003-sync" --label "type:task" \
  --label "priority:P1" --label "phase:F2" \
  --assignee danielandresavilaj-cell \
  --milestone "M1 — Módulos 001–006 (S5–S12)"
```

### 5. Vincular como sub-issue de la épica

En la web: abrir la épica (#6) → barra lateral → **Sub-issues** → `+` → buscar el issue nuevo.

Por terminal:

```bash
PARENT=$(gh api /repos/danielandresavilaj-cell/terreno-conectado/issues/6 --jq '.node_id')
CHILD=$(gh api /repos/danielandresavilaj-cell/terreno-conectado/issues/NN --jq '.node_id')
gh api graphql -f query='mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}' \
  -f p="$PARENT" -f c="$CHILD"
```

### 6. Agregar al board y rellenar los campos

En la web: board → **+ Add item** → pegar el número del issue. Después rellenar los 6 campos clicando cada uno.

### 7. Actualizar `tasks/` en el repo

Si la tarea pertenece a una iteración, agregarla a la tabla de `tasks/<iteración>/tasks.md`. El board y el archivo deben coincidir.

---

## 11. Resolución de problemas

| Problema | Causa probable | Solución |
| :--- | :--- | :--- |
| No veo el board | No fui agregado como colaborador | Pedir a Daniel: board → `•••` → Settings → Manage access |
| Las vistas muestran todo mezclado | Falta configurar el "Group by" | Ver §3 — es un clic por vista, una sola vez |
| Moví una tarjeta y se devolvió | El issue se cerró o se reabrió desde otro lado | El Status del board y el estado del issue están sincronizados; revisar el issue |
| No encuentro una tarea | Está filtrada | Limpiar filtros: clic en la `×` de cada filtro activo |
| Quiero cambiar un spec congelado | — | PR titulado `AMENDMENT-NNN: resumen` + justificación + firma de ambos (Artículo X) |
| El board y `tasks.md` difieren | Alguien editó uno solo | El repo manda. Actualizar el board para que coincida |
| No puedo crear workflows de CI | `.gitignore` excluye `.github/` | Ver §12 |

---

## 12. Pendientes conocidos del tablero (al 2026-09-25)

### 12.1 El CI está apagado

`.gitignore` contiene esta línea:

```
# Temporal: el token OAuth no tiene scope 'workflow' (ver gh auth refresh -s workflow)
.github/
```

**Esto ya se puede resolver.** El token OAuth actual tiene los scopes `gist`, `project`, `read:org`, `repo`, `workflow` — el scope `workflow` se agregó el 2026-09-25 al ejecutar `gh auth refresh -h github.com -s project`.

Pasos para reactivarlo (issue **#14**):

1. Quitar la línea `.github/` de `.gitignore`
2. Crear los workflows en `.github/workflows/`
3. `git add .github/ && git commit && git push`

**Por qué es urgente:** sin CI, un push directo a `main` puede romper el offline-first (Artículo I) sin que nadie se entere hasta la demo. `plans/000-walking-skeleton/plan.md` §4 lo lista como riesgo de probabilidad **Alta**.

### 12.2 Firmas pendientes

Issue **#13**. La constitución v1.0.1, el spec maestro v1.0.1 y el ADR-002 están firmados por Raúl pero **no por Daniel**. Sin ambas firmas, los documentos no están ratificados (procedimiento de enmienda de la constitución).

### 12.3 Decisión D5 abierta

Issue **#11**. La estrategia de refresh token en la PWA no está decidida. `plans/000-walking-skeleton/plan.md` §3.2 lista tres opciones:

1. Cookie httpOnly + CSRF
2. Storage cifrado
3. Service-worker-only

**Bloquea TSK-WS-003** (Auth). Hay un plan de contingencia aceptado: empezar con access-token en memoria + refresh en storage temporal, marcado explícito en el plan.

### 12.4 Desbalance de carga

| Owner | Tareas del M0 | Puntos |
| :--- | :--- | :--- |
| **Raúl** | TSK-001, 002, 003, 010, 012 | 18 |
| **Daniel** | TSK-004, 005, 006, 008, 009, 011 | 29 |
| **Pair** | TSK-007 | 8 |

Daniel carga ~1,6× los puntos de Raúl. Refleja la división de módulos del spec maestro §4, pero conviene revisarlo en la planificación del lunes. Opciones:

- Mover TSK-011 (dashboard) a `Pair`
- Que Raúl tome parte de TSK-005 (la más grande, 8 pts)
- Aceptar el desbalance conscientemente y compensar en el milestone M1

---

## 13. Glosario del tablero

| Término | Qué significa acá |
| :--- | :--- |
| **Board / Project** | El tablero visual (capa 3). GitHub lo llama "Project v2". |
| **Item** | Cualquier cosa que vive en el board: un issue, un PR o una nota suelta (draft issue). |
| **Épica** | Un issue grande que agrupa otros. Acá son las fases y los módulos (#2–#15). |
| **Sub-issue** | Issue hijo vinculado a una épica. GitHub muestra el progreso agregado. |
| **Milestone** | Hito con fecha y barra de progreso. Acá: M0–M3 según el Gantt de la asignatura. |
| **Vista** | Una forma guardada de mirar los mismos items (kanban, tabla, roadmap). |
| **Campo custom** | Columna extra que agregamos nosotros (Módulo, Owner, Prioridad…). |
| **WIP** | Work In Progress. Límite de tarjetas en curso por persona. |
| **DoR / DoD** | Definition of Ready / Definition of Done. Cuándo se puede empezar / cuándo se puede cerrar. |
| **Backlog** | Todo lo que aún no se hace. |
| **Sprint** | El conjunto de trabajo de un período corto. Acá coincide con un milestone. |
| **Story point** | Medida de tamaño relativo, no de horas. Escala Fibonacci. |
| **Spike** | Tarea de investigación cuyo resultado es una decisión, no código. |
| **Pair** | Tarea que se hace en programación en pareja (los dos juntos). |
| **TSK-WS-NNN** | Identificador de tarea del walking skeleton. Equivale a un issue. |

---

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 1.0.0 | 2026-09-25 | Guía inicial: las 3 capas, anatomía de tarjeta, 6 vistas, flujo diario, ruta de estudio, DoR/DoD, referencia de campos, estructura de issues, operaciones web y `gh`, cómo agregar tareas, troubleshooting y pendientes conocidos | Daniel Ávila (con IA) |
