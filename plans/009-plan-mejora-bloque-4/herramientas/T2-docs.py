"""T2 — TSK-OFF-015: documentación."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editar import agregar_cambio, agregar_evidencia, fijar_version, insertar_despues, marcar_tarea  # noqa: E402

S4 = 'specs/004-dominio-inspecciones/spec.md'
fijar_version(S4, '0.6.2')
insertar_despues(
    S4,
    "Cada foto es un `ATTACHMENT` `owner_type='finding'`.\n",
    '- **Hallazgo directo (TSK-OFF-015):** en Inspección, "Registrar hallazgo general" crea un hallazgo con '
    '`response_id = null` dentro del borrador en curso (lo crea si no existe). Se corrige por su id sin duplicarse '
    'y viaja con la inspección por la misma cola; no cambia el contrato de sincronización.\n',
)
agregar_cambio(S4, '| 0.6.2 | 2026-11-14 | **TSK-OFF-015:** hallazgo directo, no ligado a una pregunta | Daniel Ávila (con IA) |')

marcar_tarea('tasks/009-plan-mejora-bloque-4/tasks.md', 'TSK-OFF-015', '✅ Hecho')

TP = 'test-plan.md'
fijar_version(TP, '1.3.7')
agregar_evidencia(
    TP,
    '| FR-009, FR-032, FR-036/039 |',
    '; *(TSK-OFF-015)* hallazgo directo: registro aparte, corrección por id sin duplicar y fotos (`frontend/test/hallazgo.test.ts`)',
)
agregar_cambio(TP, '| 1.3.7 | 2026-11-14 | **TSK-OFF-015:** hallazgo directo; evidencia en la fila FR-009/032/036 (`hallazgo.test.ts`) | Daniel Ávila (con IA) |')
print('T2 documentación lista')
