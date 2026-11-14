"""P0 — Lo aplica el PR del plan (no el ejecutor): FR-065 y FR-066 en la Enmienda 008."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editar import agregar_cambio, fijar_version, reemplazar, insertar_despues  # noqa: E402

M = 'specs/000-master/spec.md'
reemplazar(M, '| **Versión** | 1.9.0 · Enmienda 008 (evidencia, bitácora y acción correctiva) |',
           '| **Versión** | 1.10.0 · Enmienda 008 (evidencia, bitácora, acción correctiva, faenas por cuenta y archivo de formularios) |')
# FR nuevos, a continuación de FR-064 (misma lista del módulo 004 donde quedó el bloque 062–069).
t = Path(M).read_text(encoding='utf-8')
i = t.index('- **FR-064** *(Enmienda 008)*')
fin = t.index('\n', i) + 1
t = t[:fin] + (
    '- **FR-065** *(Enmienda 008)* EL SISTEMA DEBERÁ permitir al `tenant_admin` limitar las faenas en que '
    'puede capturar cada cuenta `field_worker` o `supervisor`; una cuenta sin faenas asignadas puede capturar en '
    'todas las faenas de su empresa. La limitación se aplica a la lista de faenas que recibe el dispositivo; la '
    'ingesta de sincronización no rechaza capturas ya hechas (Art. III).\n'
    '- **FR-066** *(Enmienda 008)* EL SISTEMA DEBERÁ permitir al `tenant_admin` archivar y restaurar un formulario '
    '(archivado, deja de entregarse a los dispositivos y de ofrecerse para asignar, y conserva sus revisiones, '
    'asignaciones e inspecciones) y duplicar un formulario publicado como uno nuevo e independiente. Cada archivo '
    'y restauración queda en el audit log.\n'
) + t[fin:]
Path(M).write_text(t, encoding='utf-8', newline='\n')
print('ok  specs/000-master/spec.md (FR-065, FR-066)')
insertar_despues(
    M,
    'la bajada del hallazgo asignado al dispositivo del responsable queda en el plan (2.3).',
    '\n> - **FR-065 y FR-066 (2026-11-14, bloque 4 del plan de mejora):** faenas por cuenta (tabla `user_site`, '
    'migración 021, TSK-ADM-003) y archivo/duplicado de formularios (columna existente `template.status`, '
    'TSK-FORM-024). Se implementan según `plans/009-plan-mejora-bloque-4/`. Las demás tareas del bloque '
    '(varias fotos por hallazgo, hallazgo directo, reexportar, tendencia semanal) son aclaraciones de '
    'FR-012/019/032/040/041 sin cambio de alcance.',
)
agregar_cambio(M, '| 1.10.0 | 2026-11-14 | **Enmienda 008 (ampliación)** — FR-065 (faenas por cuenta) y FR-066 (archivar, restaurar y duplicar formularios), por implementar según `plans/009-plan-mejora-bloque-4/` | Daniel Ávila (con IA) |')

TP = 'test-plan.md'
fijar_version(TP, '1.3.5')
t = Path(TP).read_text(encoding='utf-8')
i = t.index('| FR-064 |')
fin = t.index('\n', i) + 1
t = t[:fin] + (
    '| FR-065 | *(Enmienda 008)* `GET /sites` devuelve a cada cuenta sólo sus faenas asignadas (sin asignación: todas); '
    'el admin las asigna con `PUT /users/:id/faenas`; otra empresa → 404, faena ajena → 400, auditoría | Integración | '
    '`backend/test/users-faenas.spec.ts` (TSK-ADM-003) | 🟡 por implementar |\n'
    '| FR-066 | *(Enmienda 008)* Archivar oculta el formulario a dispositivos y a Plantillas sin borrar revisiones ni '
    'asignaciones; restaurar lo devuelve; sólo `tenant_admin`; otra empresa → 404; auditoría. Duplicar genera ids '
    'nuevos y quita el origen de planilla | Integración + Unit | `backend/test/templates-archivar.spec.ts`; '
    '`frontend/test/duplicar-formulario.test.ts` (TSK-FORM-024) | 🟡 por implementar |\n'
) + t[fin:]
a = '**Recuento (2026-11-13):** 50 filas · 🟢 46 (92,0%) · 🟡 3 (6,0%) · 🔴 0 · ⚪ 1 (2,0%).'
assert t.count(a) == 1, 'PARA: recuento no encontrado'
t = t.replace(a, '**Recuento (2026-11-14):** 52 filas · 🟢 46 (88,5%) · 🟡 5 (9,6%) · 🔴 0 · ⚪ 1 (1,9%).')
Path(TP).write_text(t, encoding='utf-8', newline='\n')
print('ok  test-plan.md (FR-065, FR-066 en 🟡)')
agregar_cambio(TP, '| 1.3.5 | 2026-11-14 | Filas FR-065 y FR-066 (Enmienda 008, ampliación) en 🟡 por implementar; recuento 52 filas | Daniel Ávila (con IA) |')
