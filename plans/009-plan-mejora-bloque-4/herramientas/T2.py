"""T2 — TSK-OFF-015: hallazgo directo, no ligado a una pregunta (código y pruebas).

Requiere T1 aplicado y mergeado. Ejecutar desde la raíz del repo:
    python3 plans/009-plan-mejora-bloque-4/herramientas/T2.py
Si alguna línea imprime "PARA:", detente y reporta (plan.md §5).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editar import reemplazar, insertar_antes, insertar_despues  # noqa: E402

FE = 'frontend/src'
DBF = f'{FE}/lib/db.ts'
ST = f'{FE}/lib/store.tsx'
CAP = f'{FE}/screens/Captura.tsx'

# ── 1. db.ts ────────────────────────────────────────────────────────────────
reemplazar(
    DBF,
    "  /** Ids de adjunto a quitar; los ya enviados se ignoran. */\n  fotosQuitar: string[]\n}): Promise<{ id: string; creado: boolean }> {",
    "  /** Ids de adjunto a quitar; los ya enviados se ignoran. */\n  fotosQuitar: string[]\n"
    "  /** TSK-OFF-015: hallazgo directo existente a corregir (sin respuesta asociada). */\n  hallazgoId?: string | null\n"
    "}): Promise<{ id: string; creado: boolean }> {",
)
reemplazar(
    DBF,
    "    const previo = params.responseId\n      ? (await db.findings.where('inspectionId').equals(params.inspectionId).toArray()).find(\n          (f) => f.responseId === params.responseId,\n        )\n      : undefined",
    "    const previo = params.hallazgoId\n      ? await db.findings.get(params.hallazgoId)\n      : params.responseId\n"
    "        ? (await db.findings.where('inspectionId').equals(params.inspectionId).toArray()).find(\n"
    "            (f) => f.responseId === params.responseId,\n          )\n        : undefined",
)
insertar_antes(
    DBF,
    "/** Hallazgo ligado a una respuesta, con todas sus fotos (o `null`). */",
    '''/** TSK-OFF-015: hallazgos directos del borrador (sin respuesta), del más antiguo al más reciente. */
export async function hallazgosDirectos(inspectionId: string): Promise<FindingRow[]> {
  return (await hallazgosDeInspeccion(inspectionId))
    .filter((f) => f.responseId === null)
    .sort((x, y) => (x.capturedAt === y.capturedAt ? x.id.localeCompare(y.id) : x.capturedAt < y.capturedAt ? -1 : 1))
}

/** Un hallazgo por su id, con todas sus fotos (o `null`). */
export async function hallazgoPorId(id: string): Promise<{ hallazgo: FindingRow; fotos: FotoHallazgo[] } | null> {
  const hallazgo = await db.findings.get(id)
  if (!hallazgo) return null
  return { hallazgo, fotos: await fotosDeHallazgo(hallazgo.id) }
}

''',
)

# ── 2. store.tsx ────────────────────────────────────────────────────────────
reemplazar(ST, "  hallazgoDeRespuesta,\n", "  hallazgoDeRespuesta,\n  hallazgoPorId,\n  hallazgosDirectos,\n")
reemplazar(ST, "  hallazgosDeInspeccion,\n", "  hallazgosDeInspeccion,\n  fotosDeHallazgo,\n")
insertar_despues(
    ST,
    "  leerHallazgo: (itemId: string) => Promise<HallazgoGuardado | null>\n",
    '''  /** TSK-OFF-015: crea (`hallazgoId` null) o corrige un hallazgo no ligado a una pregunta. */
  guardarHallazgoDirecto: (
    hallazgoId: string | null,
    sev: Severidad,
    descripcion: string,
    fotosNuevas: File[],
    fotosQuitar: string[],
  ) => Promise<void>
  /** Hallazgo directo guardado, para corregirlo. */
  leerHallazgoDirecto: (hallazgoId: string) => Promise<HallazgoGuardado | null>
  /** Hallazgos directos del borrador en curso. */
  listarHallazgosDirectos: () => Promise<HallazgoDirectoResumen[]>
''',
)
insertar_antes(
    ST,
    "/** Lo que se le confirma a la persona después de firmar y enviar. */",
    '''/** TSK-OFF-015: un hallazgo directo, tal como se lista en la inspección. */
export interface HallazgoDirectoResumen {
  id: string
  severidad: Severidad
  descripcion: string
  fotos: number
}

''',
)
insertar_antes(
    ST,
    "  const prepararCierre = useCallback((): boolean => {",
    '''  /* TSK-OFF-015: hallazgo directo. Va en el borrador en curso (lo crea si hace
   * falta) y viaja con la inspección; corregirlo conserva su UUID. */
  const guardarHallazgoDirecto = useCallback(
    async (hallazgoId: string | null, sev: Severidad, descripcion: string, fotosNuevas: File[], fotosQuitar: string[]) => {
      if (!usuario) return
      const draft = await resolverDraft(usuario)
      await guardarHallazgoDb({
        inspectionId: draft.id,
        responseId: null,
        hallazgoId,
        tenantId: usuario.tenantId,
        severity: SEV_TO_EN[sev],
        description: descripcion.trim() || 'Sin descripción',
        detalle: detalleDeHallazgo(descripcion),
        fotosNuevas: await comprimirFotos(fotosNuevas),
        fotosQuitar,
      })
      setUltimoEnvio(null)
      await refrescar()
    },
    [usuario, refrescar, resolverDraft],
  )

  const leerHallazgoDirecto = useCallback(async (hallazgoId: string): Promise<HallazgoGuardado | null> => {
    const guardado = await hallazgoPorId(hallazgoId)
    if (!guardado) return null
    return {
      severidad: SEV_TO_ES[guardado.hallazgo.severity],
      descripcion: guardado.hallazgo.description === 'Sin descripción' ? '' : guardado.hallazgo.description,
      fotos: guardado.fotos,
    }
  }, [])

  const listarHallazgosDirectos = useCallback(async (): Promise<HallazgoDirectoResumen[]> => {
    const draftId = await getDraftInspectionId()
    if (!draftId) return []
    const filas = await hallazgosDirectos(draftId)
    return Promise.all(
      filas.map(async (h) => ({
        id: h.id,
        severidad: SEV_TO_ES[h.severity],
        descripcion: h.description,
        fotos: (await fotosDeHallazgo(h.id)).length,
      })),
    )
  }, [])

''',
)
reemplazar(ST, "    leerHallazgo,\n    leerFotoItem,\n", "    leerHallazgo,\n    leerFotoItem,\n    guardarHallazgoDirecto,\n    leerHallazgoDirecto,\n    listarHallazgosDirectos,\n")

# ── 3. Captura ──
# Los hooks nuevos van ANTES del `if (!plantilla) return null` (reglas de hooks de React).────────────────────────────────────────────────────────────
reemplazar(CAP, "import { useEffect, useState } from 'react'", "import { useCallback, useEffect, useState } from 'react'")
reemplazar(CAP, "import { Chip } from '../components/Badges'", "import { BadgeSev, Chip } from '../components/Badges'")
reemplazar(CAP, "import { useEstado } from '../lib/store'", "import { useEstado, type HallazgoDirectoResumen } from '../lib/store'")
reemplazar(CAP, "    guardarHallazgo,\n    leerHallazgo,\n", "    guardarHallazgo,\n    leerHallazgo,\n    guardarHallazgoDirecto,\n    leerHallazgoDirecto,\n    listarHallazgosDirectos,\n")
insertar_antes(
    CAP,
    "  if (!plantilla) return null\n",
    '''  /* TSK-OFF-015: hallazgos directos (no ligados a una pregunta). El panel de
   * hallazgo los distingue por el prefijo de su id. */
  const [directos, setDirectos] = useState<HallazgoDirectoResumen[]>([])
  const recargarDirectos = useCallback(() => {
    void listarHallazgosDirectos().then(setDirectos)
  }, [listarHallazgosDirectos])
  useEffect(() => {
    recargarDirectos()
  }, [recargarDirectos, pendientes, ultimoEnvio, revisionId])

  const abrirDirecto = (hallazgoId: string | null) =>
    setSheetItem({
      id: `${PREFIJO_DIRECTO}${hallazgoId ?? 'nuevo'}`,
      texto: 'Hallazgo general',
      seccion: 'No ligado a una pregunta del formulario',
      hallazgoObligatorio: false,
      tipo: 'ok_nok_na',
    })

  const cargarHallazgo = useCallback(
    (itemId: string) => {
      if (!itemId.startsWith(PREFIJO_DIRECTO)) return leerHallazgo(itemId)
      const id = itemId.slice(PREFIJO_DIRECTO.length)
      return id === 'nuevo' ? Promise.resolve(null) : leerHallazgoDirecto(id)
    },
    [leerHallazgo, leerHallazgoDirecto],
  )

''',
)
insertar_antes(
    CAP,
    "/** Fecha de hoy como la dice una persona: \"jueves 13 de noviembre\". */",
    "/** TSK-OFF-015: prefijo del id de ítem con que el panel identifica un hallazgo directo. */\nconst PREFIJO_DIRECTO = 'directo:'\n\n",
)
insertar_antes(
    CAP,
    "      {/* ── Cierre ────",
    '''      {/* ── Otros hallazgos (TSK-OFF-015) ─────────────────────────────────
       *  Algo que se vio en terreno y no corresponde a ninguna pregunta. */}
      {!congeladaAusente && !sinFormularios && (
        <section className="panel p-4 space-y-3" aria-labelledby="titulo-otros-hallazgos">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 id="titulo-otros-hallazgos" className="text-[15px] font-semibold">
                Otros hallazgos
              </h2>
              <p className="mt-0.5 text-[13px] text-ink-2">Algo que viste y no corresponde a ninguna pregunta.</p>
            </div>
            <Boton tamano="sm" variante="secundaria" onClick={() => abrirDirecto(null)}>
              Registrar hallazgo general
            </Boton>
          </div>
          {directos.length > 0 && (
            <ul className="divide-y divide-line-soft rounded-xl border border-line-soft">
              {directos.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                  <BadgeSev sev={h.severidad} />
                  <span className="min-w-0 flex-1 text-[14px] break-words">{h.descripcion}</span>
                  {h.fotos > 0 && (
                    <span className="text-[13px] text-ink-2">
                      {h.fotos} {h.fotos === 1 ? 'foto' : 'fotos'}
                    </span>
                  )}
                  <Boton tamano="sm" variante="fantasma" onClick={() => abrirDirecto(h.id)}>
                    Corregir
                  </Boton>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

''',
)
reemplazar(CAP, "        cargar={leerHallazgo}\n", "        cargar={cargarHallazgo}\n")
reemplazar(
    CAP,
    "          if (sheetItem) guardarHallazgo(sheetItem.id, sev, desc, fotosNuevas, fotosQuitar)",
    "          if (sheetItem?.id.startsWith(PREFIJO_DIRECTO)) {\n"
    "            const id = sheetItem.id.slice(PREFIJO_DIRECTO.length)\n"
    "            void guardarHallazgoDirecto(id === 'nuevo' ? null : id, sev, desc, fotosNuevas, fotosQuitar).then(recargarDirectos)\n"
    "          } else if (sheetItem) {\n"
    "            guardarHallazgo(sheetItem.id, sev, desc, fotosNuevas, fotosQuitar)\n"
    "          }",
)

# ── 4. Pruebas ──────────────────────────────────────────────────────────────
reemplazar(
    'frontend/test/hallazgo.test.ts',
    "import { db, fotosDeHallazgo, guardarHallazgo, hallazgoDeRespuesta, hallazgosDeInspeccion } from '../src/lib/db'",
    "import {\n  db,\n  fotosDeHallazgo,\n  guardarHallazgo,\n  hallazgoDeRespuesta,\n  hallazgoPorId,\n  hallazgosDeInspeccion,\n  hallazgosDirectos,\n} from '../src/lib/db'",
)
_t = Path('frontend/test/hallazgo.test.ts')
_t.write_text(_t.read_text(encoding='utf-8').rstrip('\n') + '''

describe('hallazgo directo, sin pregunta (TSK-OFF-015)', () => {
  const directo = { inspectionId: 'ins-1', responseId: null, tenantId: TENANT_A, detalle: 'resumen' }

  it('cada hallazgo directo nuevo es un registro aparte', async () => {
    const a = await guardarHallazgo({ ...directo, severity: 'low', description: 'Polvo', fotosNuevas: [], fotosQuitar: [] })
    const b = await guardarHallazgo({ ...directo, severity: 'high', description: 'Cable suelto', fotosNuevas: [], fotosQuitar: [] })

    expect(a.creado && b.creado).toBe(true)
    expect((await hallazgosDirectos('ins-1')).map((h) => h.id)).toEqual([a.id, b.id])
  })

  it('corregirlo por su id actualiza el mismo registro', async () => {
    const { id } = await guardarHallazgo({ ...directo, severity: 'low', description: 'Polvo', fotosNuevas: [], fotosQuitar: [] })
    const r = await guardarHallazgo({
      ...directo,
      hallazgoId: id,
      severity: 'medium',
      description: 'Polvo en el tablero',
      fotosNuevas: [],
      fotosQuitar: [],
    })

    expect(r).toEqual({ id, creado: false })
    const lista = await hallazgosDirectos('ins-1')
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({ severity: 'medium', description: 'Polvo en el tablero', clientVersion: 1 })
    expect((await db.outbox.toArray()).filter((f) => f.entityType === 'finding')).toHaveLength(1)
  })

  it('no lista los hallazgos de una respuesta y devuelve sus fotos por id', async () => {
    await guardarHallazgo({ ...directo, responseId: 'resp-1', severity: 'high', description: 'NOK', fotosNuevas: [], fotosQuitar: [] })
    const { id } = await guardarHallazgo({
      ...directo,
      severity: 'low',
      description: 'Polvo',
      fotosNuevas: [{ blob: new Blob(['x'], { type: 'image/jpeg' }), ancho: 1, alto: 1, mime: 'image/jpeg' }],
      fotosQuitar: [],
    })

    expect((await hallazgosDirectos('ins-1')).map((h) => h.id)).toEqual([id])
    expect((await hallazgoPorId(id))?.fotos).toHaveLength(1)
    expect(await hallazgoPorId('no-existe')).toBeNull()
  })
})
''', encoding='utf-8', newline='\n')
print('ok  frontend/test/hallazgo.test.ts (pruebas de hallazgo directo)')
print('T2 código listo')
