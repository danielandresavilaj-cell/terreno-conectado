"""T3 — TSK-OFF-017: documentación."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editar import agregar_cambio, agregar_evidencia, fijar_version, insertar_antes, marcar_tarea  # noqa: E402

S2 = 'specs/002-captura-offline/spec.md'
fijar_version(S2, '0.3.11')
insertar_antes(
    S2,
    '## 7. Compresión de imagen (FR-012)',
    '**Reexportar desde Cola (TSK-OFF-017):** cada inspección de la Cola, enviada o no, ofrece "Descargar Excel". '
    'El libro se arma con lo que quedó en el teléfono (plantilla congelada, respuestas y fotos) con la misma '
    '`exportarDocumento`; si falta la plantilla o la planilla original se informa el motivo y no se usa la red. '
    'El módulo de exportación se carga recién al pulsar, para no sumar ExcelJS a la pantalla Cola.\n\n',
)
agregar_cambio(S2, '| 0.3.11 | 2026-11-14 | TSK-OFF-017: reexportar una inspección desde Cola, sin red | Daniel Ávila (con IA) |')

marcar_tarea('tasks/009-plan-mejora-bloque-4/tasks.md', 'TSK-OFF-017', '✅ Hecho')

TP = 'test-plan.md'
fijar_version(TP, '1.3.8')
agregar_evidencia(
    TP,
    '| FR-019/044 |',
    '; *(TSK-OFF-017)* reexportar desde el teléfono sin red: `frontend/test/reexportar.test.ts`',
)
agregar_cambio(TP, '| 1.3.8 | 2026-11-14 | **TSK-OFF-017:** reexportar desde Cola; evidencia en la fila FR-019/044 (`reexportar.test.ts`) | Daniel Ávila (con IA) |')
print('T3 documentación lista')
