"""T5 — TSK-REP-012: documentación."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editar import agregar_cambio, agregar_evidencia, fijar_version, insertar_antes, marcar_tarea  # noqa: E402

S5 = 'specs/005-reportes-gerencia/spec.md'
fijar_version(S5, '0.9.0')
insertar_antes(
    S5,
    '## 5. Export (FR-042)',
    '### 4.5 Tendencia y filtros en una barra (TSK-REP-012, FR-040/041)\n\n'
    '- **Tendencia:** `summary.tendencia_semanal` trae las últimas 8 semanas (lunes a domingo en UTC del servidor, '
    'de la más antigua a la actual) con inspecciones y hallazgos. Se filtra por faena y **no** por el período '
    'elegido, para que la tendencia se lea igual con cualquier filtro. Gerencia la muestra como barras con los '
    'números al lado; la semana en curso se rotula "Esta".\n'
    '- **Filtros:** faena, severidad y autor quedan en una sola barra de selectores sobre las métricas (antes eran '
    'tres columnas de tarjetas a mitad de página). El autor es un solo filtro para hallazgos e inspecciones; '
    'formulario y estado siguen junto a la lista de inspecciones.\n\n',
)
agregar_cambio(S5, '| 0.9.0 | 2026-11-14 | **TSK-REP-012:** `summary.tendencia_semanal` (8 semanas) y filtros de faena, severidad y autor en una barra | Daniel Ávila (con IA) |')

marcar_tarea('tasks/009-plan-mejora-bloque-4/tasks.md', 'TSK-REP-012', '✅ Hecho')

TP = 'test-plan.md'
fijar_version(TP, '1.3.10')
agregar_evidencia(TP, '| FR-041 |', '; *(TSK-REP-012)* tendencia semanal por faena y sin recorte de período: `backend/test/dashboard-tendencia.spec.ts`')
agregar_cambio(TP, '| 1.3.10 | 2026-11-14 | **TSK-REP-012:** tendencia semanal y filtros en una barra; evidencia en la fila FR-041 (`dashboard-tendencia.spec.ts`) | Daniel Ávila (con IA) |')
print('T5 documentación lista')
