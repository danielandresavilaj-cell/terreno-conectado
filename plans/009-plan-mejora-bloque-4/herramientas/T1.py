"""T1 — TSK-OFF-016: varias fotos por hallazgo (código y pruebas).

Ejecutar desde la raíz del repo:  python3 plans/009-plan-mejora-bloque-4/herramientas/T1.py
Si alguna línea imprime "PARA:", detente y reporta (plan.md §5).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editar import reemplazar, reemplazar_bloque, insertar_despues  # noqa: E402

FE = 'frontend/src'

# ── 1. Tope de fotos ────────────────────────────────────────────────────────
insertar_despues(
    f'{FE}/lib/hallazgo.ts',
    "export const DESCRIPCION_MINIMA = 5\n",
    "\n/** TSK-OFF-016: máximo de fotos por hallazgo (se impone en la interfaz). */\nexport const MAX_FOTOS_HALLAZGO = 5\n",
)

# ── 2. db.ts: fotos de un hallazgo y guardado con varias fotos ──────────────
reemplazar_bloque(
    f'{FE}/lib/db.ts',
    "/** Hallazgo ligado a una respuesta, con su foto más reciente (o `null`). */",
    "  return { hallazgo, foto: fotos[0] ?? null }\n}\n",
    '''/** Foto guardada de un hallazgo. `enviada` = ya salió del teléfono y no se puede quitar. */
export interface FotoHallazgo {
  id: string
  blob: Blob
  enviada: boolean
}

/** Fotos de un hallazgo, de la más antigua a la más reciente (TSK-OFF-016). */
export async function fotosDeHallazgo(findingId: string): Promise<FotoHallazgo[]> {
  const adjuntos = (await db.attachments.where('ownerId').equals(findingId).toArray())
    .filter((a) => a.ownerType === 'finding')
    .sort((x, y) => (x.capturedAt === y.capturedAt ? x.id.localeCompare(y.id) : x.capturedAt < y.capturedAt ? -1 : 1))
  const fotos: FotoHallazgo[] = []
  for (const a of adjuntos) {
    const filas = await db.outbox.where('[entityType+entityId]').equals(['attachment', a.id]).toArray()
    fotos.push({ id: a.id, blob: a.blob, enviada: filas.some((f) => f.status === 'synced' || f.status === 'syncing') })
  }
  return fotos
}

/** Hallazgo ligado a una respuesta, con todas sus fotos (o `null`). */
export async function hallazgoDeRespuesta(
  inspectionId: string,
  responseId: string,
): Promise<{ hallazgo: FindingRow; fotos: FotoHallazgo[] } | null> {
  const hallazgo = (await hallazgosDeInspeccion(inspectionId)).find((f) => f.responseId === responseId)
  if (!hallazgo) return null
  return { hallazgo, fotos: await fotosDeHallazgo(hallazgo.id) }
}
''',
)

reemplazar(
    f'{FE}/lib/db.ts',
    ''' * `foto: null` significa "sin foto nueva": la que hubiera se conserva. Una foto
 * nueva reemplaza a la anterior sólo si ésta aún no salió del dispositivo; una
 * ya enviada se deja, porque la cola no borra en el servidor.
 */''',
    ''' * Fotos (TSK-OFF-016): `fotosNuevas` se agregan a las que ya tenía y
 * `fotosQuitar` (ids de adjunto) se borran sólo si todavía no salieron del
 * teléfono; una ya enviada se conserva, porque la cola no borra en el servidor.
 */''',
)
reemplazar(
    f'{FE}/lib/db.ts',
    '''  /** FR-012: blob ya comprimido (≤1280 px, q0.7) por `comprimirImagen`. */
  foto: { blob: Blob; ancho: number; alto: number; mime: string } | null
}): Promise<{ id: string; creado: boolean }> {''',
    '''  /** FR-012: blobs ya comprimidos (≤1280 px, q0.7) por `comprimirImagen`. */
  fotosNuevas: Array<{ blob: Blob; ancho: number; alto: number; mime: string }>
  /** Ids de adjunto a quitar; los ya enviados se ignoran. */
  fotosQuitar: string[]
}): Promise<{ id: string; creado: boolean }> {''',
)
reemplazar_bloque(
    f'{FE}/lib/db.ts',
    "    if (params.foto) {\n      if (previo) {",
    "    return { id, creado: !previo }\n",
    '''    for (const attachmentId of params.fotosQuitar) {
      const a = await db.attachments.get(attachmentId)
      if (!a || a.ownerType !== 'finding' || a.ownerId !== id) continue
      const filas = await db.outbox.where('[entityType+entityId]').equals(['attachment', a.id]).toArray()
      if (filas.some((f) => f.status === 'synced' || f.status === 'syncing')) continue
      await db.outbox.bulkDelete(filas.map((f) => f.id as number))
      await db.attachments.delete(a.id)
    }
    // Cada foto recibe un instante estrictamente mayor que el de la anterior:
    // así su orden se conserva aunque varias se guarden en el mismo milisegundo.
    const previas = (await db.attachments.where('ownerId').equals(id).toArray())
      .filter((a) => a.ownerType === 'finding')
      .map((a) => Date.parse(a.capturedAt) + 1)
    let instante = Math.max(Date.parse(ts), ...previas)
    for (const foto of params.fotosNuevas) {
      const attachmentId = uuidv7()
      const capturedAt = new Date(instante++).toISOString()
      await db.attachments.add({
        id: attachmentId,
        tenantId: params.tenantId,
        ownerType: 'finding',
        ownerId: id,
        mime: foto.mime,
        bytes: foto.blob.size,
        blob: foto.blob,
        ancho: foto.ancho,
        alto: foto.alto,
        capturedAt,
        clientVersion: 0,
      })
      await encolar(
        'attachment',
        attachmentId,
        'Evidencia fotográfica',
        `${foto.ancho}×${foto.alto} · ${Math.round(foto.blob.size / 1024)} KB comprimida (FR-012)`,
        params.tenantId,
      )
    }
    return { id, creado: !previo }
''',
)

# ── 3. store.tsx ────────────────────────────────────────────────────────────
ST = f'{FE}/lib/store.tsx'
reemplazar(
    ST,
    '''export interface HallazgoGuardado {
  severidad: Severidad
  descripcion: string
  foto: Blob | null
}''',
    '''export interface HallazgoGuardado {
  severidad: Severidad
  descripcion: string
  /** TSK-OFF-016: todas las fotos, de la más antigua a la más reciente. */
  fotos: Array<{ id: string; blob: Blob; enviada: boolean }>
}''',
)
reemplazar(
    ST,
    "  guardarHallazgo: (itemId: string, sev: Severidad, descripcion: string, foto: File | null) => void\n",
    "  guardarHallazgo: (itemId: string, sev: Severidad, descripcion: string, fotosNuevas: File[], fotosQuitar: string[]) => void\n",
)
reemplazar(
    ST,
    "    (itemId: string, sev: Severidad, descripcion: string, foto: File | null) => {\n      if (!usuario) return",
    "    (itemId: string, sev: Severidad, descripcion: string, fotosNuevas: File[], fotosQuitar: string[]) => {\n      if (!usuario) return",
)
reemplazar_bloque(
    ST,
    "        // FR-012: la foto se comprime ANTES de encolarse (canvas ≤1280 px, q0.7).",
    "          foto: fotoComprimida,\n        })",
    '''        const { id } = await guardarHallazgoDb({
          inspectionId: draft.id,
          responseId,
          tenantId: usuario.tenantId,
          severity: SEV_TO_EN[sev],
          description: descripcion.trim() || 'Sin descripción',
          detalle: detalleDeHallazgo(descripcion),
          fotosNuevas: await comprimirFotos(fotosNuevas),
          fotosQuitar,
        })''',
)
reemplazar(
    ST,
    "      foto: guardado.foto?.blob ?? null,\n    }\n  }, [])",
    "      fotos: guardado.fotos,\n    }\n  }, [])",
)
insertar_despues(
    ST,
    "const StoreCtx = createContext<Ctx | null>(null)\n",
    '''
/**
 * FR-012: cada foto se comprime ANTES de encolarse (canvas ≤1280 px, q0.7).
 * Una que no se pueda comprimir se omite: la captura nunca depende de la
 * evidencia fotográfica.
 */
async function comprimirFotos(
  fotos: File[],
): Promise<Array<{ blob: Blob; ancho: number; alto: number; mime: string }>> {
  const listas: Array<{ blob: Blob; ancho: number; alto: number; mime: string }> = []
  for (const foto of fotos) {
    try {
      const comp = await comprimirImagen(foto)
      listas.push({ blob: comp.blob, ancho: comp.ancho, alto: comp.alto, mime: comp.blob.type || 'image/jpeg' })
    } catch {
      // Se omite esta foto; el hallazgo se guarda igual.
    }
  }
  return listas
}
''',
)

# ── 4. Captura: nueva firma de guardado ─────────────────────────────────────
reemplazar(
    f'{FE}/screens/Captura.tsx',
    "        onGuardar={(sev, desc, foto) => {\n          if (sheetItem) guardarHallazgo(sheetItem.id, sev, desc, foto)",
    "        onGuardar={(sev, desc, fotosNuevas, fotosQuitar) => {\n          if (sheetItem) guardarHallazgo(sheetItem.id, sev, desc, fotosNuevas, fotosQuitar)",
)

# ── 5. Panel de hallazgo con varias fotos (reemplazo completo) ──────────────
Path(f'{FE}/components/SheetHallazgo.tsx').write_text(
    (Path(__file__).parent / 'T1-SheetHallazgo.tsx.txt').read_text(encoding='utf-8'),
    encoding='utf-8',
    newline='\n',
)
print(f'ok  {FE}/components/SheetHallazgo.tsx (reemplazado)')

# ── 6. Contrato: todos los ids de foto ──────────────────────────────────────
reemplazar(
    'shared/src/dashboard.ts',
    "  /** Evidencia fotográfica más reciente (metadata; los bytes se sirven aparte). */\n  foto_id: string | null\n",
    "  /** Evidencia fotográfica más reciente (metadata; los bytes se sirven aparte). */\n  foto_id: string | null\n  /** TSK-OFF-016: todas las fotos del hallazgo, de la más antigua a la más reciente. */\n  fotos_ids: string[]\n",
)
reemplazar(
    'shared/src/dashboard.ts',
    "  status: z.enum(['open', 'in_progress', 'resolved']),\n  foto_id: z.string().uuid().nullable(),\n})",
    "  status: z.enum(['open', 'in_progress', 'resolved']),\n  foto_id: z.string().uuid().nullable(),\n  /** TSK-OFF-016: todas las fotos, de la más antigua a la más reciente. */\n  fotos_ids: z.array(z.string().uuid()),\n})",
)

# ── 7. Backend: listado de hallazgos y detalle de inspección ────────────────
DS = 'backend/src/dashboard/dashboard.service.ts'
reemplazar(DS, "      foto_alto: number | null\n      assignee_id: string | null", "      foto_alto: number | null\n      fotos_ids: string[]\n      assignee_id: string | null")
reemplazar(
    DS,
    "                a.width AS foto_ancho, a.height AS foto_alto,\n",
    "                a.width AS foto_ancho, a.height AS foto_alto,\n"
    "                COALESCE((SELECT array_agg(a3.id ORDER BY a3.captured_at, a3.id) FROM attachment a3\n"
    "                           WHERE a3.owner_type = 'finding' AND a3.owner_id = f.id), '{}') AS fotos_ids,\n",
)
reemplazar(DS, "      foto_alto: r.foto_alto,\n      assignee_id: r.assignee_id,", "      foto_alto: r.foto_alto,\n      fotos_ids: r.fotos_ids ?? [],\n      assignee_id: r.assignee_id,")

IE = 'backend/src/dashboard/inspection-export.service.ts'
reemplazar(IE, "      status: 'open' | 'in_progress' | 'resolved'\n      foto_id: string | null\n    }>(", "      status: 'open' | 'in_progress' | 'resolved'\n      foto_id: string | null\n      fotos_ids: string[]\n    }>(")
reemplazar(
    IE,
    "                ORDER BY a.captured_at DESC, a.id DESC LIMIT 1) AS foto_id\n",
    "                ORDER BY a.captured_at DESC, a.id DESC LIMIT 1) AS foto_id,\n"
    "              COALESCE((SELECT array_agg(a.id ORDER BY a.captured_at, a.id) FROM attachment a\n"
    "                         WHERE a.owner_type = 'finding' AND a.owner_id = f.id), '{}') AS fotos_ids\n",
)
reemplazar(IE, "      hallazgos,\n    }\n  }", "      hallazgos: hallazgos.map((h) => ({ ...h, fotos_ids: h.fotos_ids ?? [] })),\n    }\n  }")

# ── 8. Gerencia: miniaturas de todas las fotos ──────────────────────────────
DB = f'{FE}/screens/Dashboard.tsx'
reemplazar(
    DB,
    "        {h.foto_id && <FotoEvidencia id={h.foto_id} etiqueta={`Foto del hallazgo: ${h.description}`} />}\n        <div className=\"min-w-0 flex-1\">\n          <div className=\"flex items-center gap-2.5 flex-wrap\">",
    "        <FotosHallazgo ids={h.fotos_ids} descripcion={h.description} />\n        <div className=\"min-w-0 flex-1\">\n          <div className=\"flex items-center gap-2.5 flex-wrap\">",
)
reemplazar(DB, "            {!h.foto_id && <span className=\"text-ink-3\">· sin foto</span>}", "            {h.fotos_ids.length === 0 && <span className=\"text-ink-3\">· sin foto</span>}")
reemplazar(
    DB,
    "      {h.foto_id && <FotoEvidencia id={h.foto_id} etiqueta={`Foto del hallazgo: ${h.description}`} />}\n      <div className=\"min-w-0 flex-1\">\n        <div className=\"flex flex-wrap items-center gap-2\">",
    "      <FotosHallazgo ids={h.fotos_ids} descripcion={h.description} />\n      <div className=\"min-w-0 flex-1\">\n        <div className=\"flex flex-wrap items-center gap-2\">",
)
reemplazar(
    DB,
    "/** Hallazgo dentro del detalle de una inspección: severidad, texto y evidencia. */\n",
    '''/** TSK-OFF-016: hasta 3 miniaturas por hallazgo y un contador del resto. */
function FotosHallazgo({ ids, descripcion }: { ids: string[]; descripcion: string }) {
  if (ids.length === 0) return null
  const visibles = ids.slice(0, 3)
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {visibles.map((id, i) => (
        <FotoEvidencia key={id} id={id} etiqueta={`Foto ${i + 1} de ${ids.length} del hallazgo: ${descripcion}`} />
      ))}
      {ids.length > visibles.length && (
        <span className="text-[13px] text-ink-2" aria-label={`${ids.length - visibles.length} fotos más`}>
          +{ids.length - visibles.length}
        </span>
      )}
    </div>
  )
}

/** Hallazgo dentro del detalle de una inspección: severidad, texto y evidencia. */
''',
)

# ── 9. Pruebas ──────────────────────────────────────────────────────────────
reemplazar('frontend/test/dashboard-csv.test.ts', "  foto_alto: null,\n  assignee_id: null,", "  foto_alto: null,\n  fotos_ids: [],\n  assignee_id: null,")
reemplazar(
    'backend/test/attachments.spec.ts',
    "        status: 'open',\n        foto_id: fotoHallazgoId,\n      },\n    ])",
    "        status: 'open',\n        foto_id: fotoHallazgoId,\n        fotos_ids: [fotoHallazgoId],\n      },\n    ])",
)
reemplazar_bloque(
    'frontend/test/hallazgo.test.ts',
    "  it('corregir sin tomar otra foto conserva la que había', async () => {",
    "  it('respuestas distintas tienen hallazgos distintos', async () => {",
    (Path(__file__).parent / 'T1-pruebas-fotos.ts.txt').read_text(encoding='utf-8')
    + "\n  it('respuestas distintas tienen hallazgos distintos', async () => {",
)
reemplazar(
    'frontend/test/hallazgo.test.ts',
    "import { db, guardarHallazgo, hallazgoDeRespuesta, hallazgosDeInspeccion } from '../src/lib/db'",
    "import { db, fotosDeHallazgo, guardarHallazgo, hallazgoDeRespuesta, hallazgosDeInspeccion } from '../src/lib/db'",
)
# Las pruebas existentes pasan `foto: null`; la nueva firma usa dos listas.
_t = Path('frontend/test/hallazgo.test.ts')
_txt = _t.read_text(encoding='utf-8')
_n = _txt.count('foto: null')
if _n == 0:
    raise SystemExit('PARA: frontend/test/hallazgo.test.ts no tiene "foto: null"')
_t.write_text(_txt.replace('foto: null', 'fotosNuevas: [], fotosQuitar: []'), encoding='utf-8', newline='\n')
print(f'ok  frontend/test/hallazgo.test.ts ({_n} llamadas actualizadas)')
print('T1 código listo')
