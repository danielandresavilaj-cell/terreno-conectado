"""T4 — TSK-FORM-024: documentación (spec 007, data-model, tareas, plan de pruebas)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editar import agregar_cambio, fijar_version, insertar_antes, marcar_tarea, reemplazar  # noqa: E402

S7 = 'specs/007-formularios-dinamicos/spec.md'
insertar_antes(
    S7,
    '### Crear desde cero (TSK-FORM-022)',
    '### Archivar, restaurar y duplicar (TSK-FORM-024, FR-066, Enmienda 008)\n\n'
    '- **Archivar:** `PATCH /api/v1/templates/:templateId/estado` con `{status: "archived"}` (sólo `tenant_admin`). '
    'Usa la columna existente `template.status`; no hay migración. Un formulario archivado deja de aparecer en '
    '`GET /templates` (y por eso en el catálogo de los teléfonos y en Plantillas), pero conserva revisiones, '
    'asignaciones e inspecciones. Queda `template_archived` en `audit_log`.\n'
    '- **Restaurar:** el mismo endpoint con `{status: "active"}` (`template_restored`); vuelve con sus asignaciones.\n'
    '- **Archivados:** `GET /api/v1/templates/archivadas` los lista; Plantillas los muestra plegados con "Restaurar".\n'
    '- **Duplicar:** en el cliente (`lib/duplicar-formulario.ts`): copia la definición con ids nuevos y sin `origen`, '
    'la crea con `POST /templates` como "Nombre (copia)" y la publica. Su contenido ya fue revisado al publicar el '
    'original; la copia no tiene planilla original para exportar.\n\n',
)
agregar_cambio(S7, '| 0.6.0 | 2026-11-14 | TSK-FORM-024 (FR-066): archivar, restaurar y duplicar formularios | Daniel Ávila (con IA) |')

DM = 'data-model.md'
fijar_version(DM, '1.7.1')
reemplazar(
    DM,
    '| status | ENUM(active, archived) | baja lógica (§4.4) |',
    '| status | ENUM(active, archived) | baja lógica (§4.4). *(FR-066)* `archived` lo saca de `GET /templates` y del catálogo de los dispositivos; revisiones, asignaciones e inspecciones se conservan |',
)
agregar_cambio(DM, '| 1.7.1 | 2026-11-14 | **FR-066 (TSK-FORM-024):** uso de `template.status = archived` para archivar formularios; sin migración |')

marcar_tarea('tasks/009-plan-mejora-bloque-4/tasks.md', 'TSK-FORM-024', '✅ Hecho')

TP = 'test-plan.md'
fijar_version(TP, '1.3.9')
reemplazar(
    TP,
    '`frontend/test/duplicar-formulario.test.ts` (TSK-FORM-024) | 🟡 por implementar |',
    '`frontend/test/duplicar-formulario.test.ts` (TSK-FORM-024) | 🟢 verde |',
)
reemplazar(
    TP,
    '**Recuento (2026-11-14):** 52 filas · 🟢 46 (88,5%) · 🟡 5 (9,6%) · 🔴 0 · ⚪ 1 (1,9%).',
    '**Recuento (2026-11-14):** 52 filas · 🟢 47 (90,4%) · 🟡 4 (7,7%) · 🔴 0 · ⚪ 1 (1,9%).',
)
reemplazar(TP, 'De lo ya validado, **46/47 (97,9%) está en verde**.', 'De lo ya validado, **47/48 (97,9%) está en verde**.')
agregar_cambio(TP, '| 1.3.9 | 2026-11-14 | **TSK-FORM-024:** FR-066 a 🟢 (`templates-archivar.spec.ts`, `duplicar-formulario.test.ts`); recuento 52 filas (47 🟢) | Daniel Ávila (con IA) |')
print('T4 documentación lista')
