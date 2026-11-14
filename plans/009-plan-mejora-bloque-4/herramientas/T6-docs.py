"""T6 — TSK-ADM-003: documentación (data-model, specs 002 y 006, tareas, plan de pruebas)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editar import agregar_cambio, fijar_version, insertar_antes, insertar_despues, marcar_tarea, reemplazar  # noqa: E402

DM = 'data-model.md'
fijar_version(DM, '1.8.0')
insertar_antes(
    DM,
    '**SITE (Faena/Obra)**',
    '**USER_SITE (faenas por cuenta)** *(Enmienda 008, FR-065, migración 021)* — `tenant_id UUID FK→TENANT, '
    'user_id UUID FK→USER, site_id UUID FK→SITE, created_by UUID FK→USER NULL, created_at`; PK `(user_id, site_id)`; '
    'RLS por `tenant_id`. Una cuenta **sin filas puede capturar en todas** las faenas de su empresa. La escribe sólo '
    'el `tenant_admin` (`PUT /users/:id/faenas`, reemplazo completo, auditado como `user_sites_updated`). Restringe '
    '`GET /sites` para `field_worker` y `supervisor`; la ingesta de sync no la consulta (Art. III).\n\n',
)
agregar_cambio(DM, '| 1.8.0 | 2026-11-14 | **Enmienda 008 (FR-065, TSK-ADM-003):** migración 021 — tabla `user_site` con RLS (faenas por cuenta) |')

S2 = 'specs/002-captura-offline/spec.md'
fijar_version(S2, '0.3.12')
reemplazar(
    S2,
    'Queda fuera de esta tarea restringir qué faenas puede elegir cada cuenta: hoy cualquier cuenta de la empresa puede elegir cualquiera de sus faenas, igual que el servidor acepta inspecciones de cualquier faena del tenant.',
    'Desde TSK-ADM-003 (FR-065) el administrador puede limitar las faenas de cada cuenta: `GET /sites` devuelve sólo '
    'las asignadas (sin asignación, todas) y el selector trabaja con esa lista. Una elección guardada o un borrador '
    'de una faena que se le quitó a la cuenta se ignoran al elegir la faena inicial; la ingesta sigue aceptando '
    'capturas de cualquier faena del tenant, para no perder lo hecho sin señal.',
)
agregar_cambio(S2, '| 0.3.12 | 2026-11-14 | TSK-ADM-003 (FR-065): la lista de faenas del teléfono respeta las faenas asignadas a la cuenta | Daniel Ávila (con IA) |')

S6 = 'specs/006-admin-plataforma/spec.md'
insertar_antes(
    S6,
    '## 6. Fuera de alcance de este ciclo',
    '**Faenas por cuenta (TSK-ADM-003, FR-065, Enmienda 008):** en Equipo, cada cuenta de terreno o supervisión '
    'tiene el botón "Faenas: todas / N de M" (sólo si la empresa tiene más de una faena), que abre la elección de '
    'faenas. Se guarda con `PUT /api/v1/users/:id/faenas` `{faena_ids}`: reemplazo completo, `[]` = todas, faenas '
    'repetidas se ignoran, una faena de otra empresa → 400, una cuenta de otra empresa → 404. `GET /api/v1/users` '
    'trae `faena_ids`. El cambio llega al teléfono la próxima vez que abra la app con señal.\n\n',
)
agregar_cambio(S6, '| 1.1.0 | 2026-11-14 | TSK-ADM-003 (FR-065): faenas por cuenta en Equipo y `PUT /users/:id/faenas` | Daniel Ávila (con IA) |')

marcar_tarea('tasks/009-plan-mejora-bloque-4/tasks.md', 'TSK-ADM-003', '✅ Hecho')

TP = 'test-plan.md'
fijar_version(TP, '1.3.11')
reemplazar(
    TP,
    '`backend/test/users-faenas.spec.ts` (TSK-ADM-003) | 🟡 por implementar |',
    '`backend/test/users-faenas.spec.ts` (TSK-ADM-003); `frontend/test/faenas-cuenta.test.ts` | 🟢 verde |',
)
reemplazar(
    TP,
    '**Recuento (2026-11-14):** 52 filas · 🟢 47 (90,4%) · 🟡 4 (7,7%) · 🔴 0 · ⚪ 1 (1,9%).',
    '**Recuento (2026-11-14):** 52 filas · 🟢 48 (92,3%) · 🟡 3 (5,8%) · 🔴 0 · ⚪ 1 (1,9%).',
)
reemplazar(TP, 'De lo ya validado, **47/48 (97,9%) está en verde**.', 'De lo ya validado, **48/49 (98,0%) está en verde**.')
agregar_cambio(TP, '| 1.3.11 | 2026-11-14 | **TSK-ADM-003:** FR-065 a 🟢 (`users-faenas.spec.ts`, `faenas-cuenta.test.ts`); recuento 52 filas (48 🟢) | Daniel Ávila (con IA) |')
print('T6 documentación lista')
