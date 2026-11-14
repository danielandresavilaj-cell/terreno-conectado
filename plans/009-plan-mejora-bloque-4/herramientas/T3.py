"""T3 — TSK-OFF-017: reexportar una inspección ya enviada (código y pruebas).

Ejecutar desde la raíz del repo:  python3 plans/009-plan-mejora-bloque-4/herramientas/T3.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editar import reemplazar, insertar_antes, insertar_despues  # noqa: E402

EX = 'frontend/src/lib/exportar.ts'
COLA = 'frontend/src/screens/Cola.tsx'

# ── 1. exportar.ts: generar el Excel con lo guardado en el teléfono ─────────
reemplazar(EX, "import { itemsDe } from './valores'", "import { itemsDe, valorDesdeColumnas } from './valores'")
insertar_antes(
    EX,
    "export const ZIP_MIME = 'application/zip'",
    '''/** TSK-OFF-017: motivos por los que no se puede reexportar desde el teléfono. */
export const SIN_INSPECCION_LOCAL = 'Esta inspección ya no está guardada en este teléfono.'
export const SIN_PLANTILLA_LOCAL =
  'El formulario de esta inspección ya no está en este teléfono. Se vuelve a descargar con señal si sigue asignado a tu faena.'

/**
 * TSK-OFF-017 (FR-019): vuelve a generar el Excel de una inspección ya enviada
 * con lo que quedó guardado en este teléfono: su plantilla congelada, sus
 * respuestas y sus fotos. No usa la red (Art. I): si falta la plantilla o la
 * planilla original, devuelve el motivo.
 */
export async function exportarInspeccionGuardada(inspectionId: string, hoy?: Date): Promise<ResultadoExportar> {
  const ins = await db.inspections.get(inspectionId)
  if (!ins) return { ok: false, error: SIN_INSPECCION_LOCAL }
  const revisionId = ins.templateRevisionId ?? null
  if (!revisionId) return { ok: false, error: SIN_REVISION }
  const plantilla = await db.plantillas.get(revisionId)
  if (!plantilla) return { ok: false, error: SIN_PLANTILLA_LOCAL }
  const filas = await db.responses.where('inspectionId').equals(inspectionId).toArray()
  const porItem = new Map(filas.map((r) => [r.templateItemId, r]))
  const respuestas: Record<string, RespuestaExportable> = {}
  for (const item of itemsDe(plantilla.definition)) {
    const fila = porItem.get(item.id)
    respuestas[item.id] = { campo: fila ? valorDesdeColumnas(item, fila) : null }
  }
  return exportarDocumento({
    revisionId,
    templateName: ins.templateName,
    definition: plantilla.definition,
    respuestas,
    inspectionId,
    hoy,
  })
}

''',
)

# ── 2. Cola: botón "Descargar Excel" en cada inspección ─────────────────────
insertar_despues(
    COLA,
    "  const [abierta, setAbierta] = useState(false)\n",
    '''  /* TSK-OFF-017: reexportar. El módulo de exportación (ExcelJS, ~900 kB) se
   * carga recién al pulsar, para no inflar la pantalla Cola. */
  const [exportando, setExportando] = useState(false)
  const [errorExport, setErrorExport] = useState<string | null>(null)
  const descargarExcel = async () => {
    setExportando(true)
    setErrorExport(null)
    try {
      const { exportarInspeccionGuardada, descargarLibro } = await import('../lib/exportar')
      const r = await exportarInspeccionGuardada(g.clave.slice('inspeccion:'.length))
      if (r.ok) descargarLibro(r.libro, r.fileName)
      else setErrorExport(r.error)
    } catch {
      setErrorExport('No se pudo generar el Excel en este teléfono.')
    } finally {
      setExportando(false)
    }
  }
''',
)
reemplazar(
    COLA,
    "        <span className=\"flex-1\" />\n        {g.estado === 'failed' && (",
    "        {g.tipo === 'inspeccion' && (\n"
    "          <Boton tamano=\"sm\" variante=\"fantasma\" disabled={exportando} aria-busy={exportando} onClick={() => void descargarExcel()}>\n"
    "            {exportando ? 'Generando…' : 'Descargar Excel'}\n"
    "          </Boton>\n"
    "        )}\n"
    "        <span className=\"flex-1\" />\n        {g.estado === 'failed' && (",
)
insertar_antes(
    COLA,
    "      {confirmacion && (\n",
    "      {errorExport && (\n"
    "        <p role=\"alert\" className=\"mt-2 text-[13px] text-failed leading-relaxed\">\n"
    "          {errorExport}\n"
    "        </p>\n"
    "      )}\n\n",
)

# ── 3. Pruebas ──────────────────────────────────────────────────────────────
Path('frontend/test/reexportar.test.ts').write_text('''import { beforeEach, describe, expect, it } from 'vitest'
import { db, guardarPlantillasCache } from '../src/lib/db'
import { SIN_INSPECCION_LOCAL, SIN_PLANTILLA_LOCAL, exportarInspeccionGuardada } from '../src/lib/exportar'
import { TENANT_A, publicada, uuid } from './fixtures'

/* TSK-OFF-017: reexportar una inspección ya enviada sin usar la red. Las rutas
 * felices (libro rellenado y evidencias) las cubre exportar.test.ts, que usa la
 * misma `exportarDocumento`; aquí se prueba que se arma con lo guardado. */

const ts = '2026-11-10T10:00:00.000Z'

async function inspeccion(revisionId: string | null) {
  await db.inspections.add({
    id: 'ins-enviada',
    tenantId: TENANT_A,
    siteId: uuid(30),
    templateId: uuid(10),
    templateVersion: 1,
    templateRevisionId: revisionId,
    executedBy: uuid(20),
    status: 'submitted',
    capturedAt: ts,
    syncedAt: ts,
    clientVersion: 1,
    templateName: 'Chequeo de seguridad minera',
    siteName: 'Faena Norte',
    answeredCount: 1,
    totalItems: 1,
  })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('exportarInspeccionGuardada (TSK-OFF-017)', () => {
  it('sin la inspección en el teléfono lo dice', async () => {
    expect(await exportarInspeccionGuardada('no-existe')).toEqual({ ok: false, error: SIN_INSPECCION_LOCAL })
  })

  it('sin revisión publicada no hay planilla que rellenar', async () => {
    await inspeccion(null)
    const r = await exportarInspeccionGuardada('ins-enviada')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no viene de una revisión publicada/)
  })

  it('sin la plantilla en caché lo dice, sin intentar la red', async () => {
    await inspeccion(uuid(11))
    expect(await exportarInspeccionGuardada('ins-enviada')).toEqual({ ok: false, error: SIN_PLANTILLA_LOCAL })
  })

  it('con la plantilla pero sin la planilla original, explica que falta el original', async () => {
    await guardarPlantillasCache([publicada()])
    await inspeccion(uuid(11))
    const r = await exportarInspeccionGuardada('ins-enviada')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/documento original/)
  })
})
''', encoding='utf-8', newline='\n')
print('ok  frontend/test/reexportar.test.ts (nuevo)')
print('T3 código listo')
