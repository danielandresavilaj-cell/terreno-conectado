"""T1 — TSK-OFF-016: documentación (spec 004, spec 005, tareas, plan de pruebas)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editar import agregar_cambio, agregar_evidencia, fijar_version, insertar_despues, marcar_tarea, reemplazar  # noqa: E402

S4 = 'specs/004-dominio-inspecciones/spec.md'
fijar_version(S4, '0.6.1')
insertar_despues(
    S4,
    'nunca crea un segundo registro. Un ítem cuenta como "con hallazgo" sólo si ese registro existe (no basta con que la respuesta sea `NOK`).\n',
    '- **Varias fotos por hallazgo (TSK-OFF-016):** hasta 5 fotos por hallazgo, impuesto en la interfaz. '
    'Corregir un hallazgo agrega fotos nuevas y puede quitar las que aún no salieron del teléfono; una foto ya '
    'enviada se conserva (la cola no borra en el servidor). Cada foto es un `ATTACHMENT` `owner_type=\'finding\'`.\n',
)
agregar_cambio(S4, '| 0.6.1 | 2026-11-14 | **TSK-OFF-016:** varias fotos por hallazgo (hasta 5) | Daniel Ávila (con IA) |')

S5 = 'specs/005-reportes-gerencia/spec.md'
fijar_version(S5, '0.8.1')
reemplazar(
    S5,
    '- **Límite conocido:** se muestra la foto más reciente de cada respuesta o hallazgo. El dispositivo sólo captura una por elemento; varias fotos por hallazgo es una mejora posterior del plan.',
    '- **Varias fotos (TSK-OFF-016):** el listado de hallazgos y el detalle muestran hasta 3 miniaturas por hallazgo y un contador del resto. '
    'El contrato trae `fotos_ids` (todas, de la más antigua a la más reciente) además de `foto_id` (la más reciente). '
    'De cada respuesta de tipo foto se sigue mostrando la más reciente.',
)
agregar_cambio(S5, '| 0.8.1 | 2026-11-14 | **TSK-OFF-016:** `fotos_ids` en hallazgos del listado y del detalle; hasta 3 miniaturas por hallazgo | Daniel Ávila (con IA) |')

T = 'tasks/009-plan-mejora-bloque-4/tasks.md'
marcar_tarea(T, 'TSK-OFF-016', '✅ Hecho')

TP = 'test-plan.md'
fijar_version(TP, '1.3.6')
agregar_evidencia(
    TP,
    '| FR-062 |',
    '; *(TSK-OFF-016)* `fotos_ids` en el detalle (`attachments.spec.ts`) y varias fotos por hallazgo en el dispositivo (`frontend/test/hallazgo.test.ts`)',
)
agregar_cambio(TP, '| 1.3.6 | 2026-11-14 | **TSK-OFF-016:** varias fotos por hallazgo; evidencia en las filas FR-062 (`attachments.spec.ts`, `hallazgo.test.ts`) | Daniel Ávila (con IA) |')
print('T1 documentación lista')
