"""T4 — TSK-FORM-024: archivar, restaurar y duplicar formularios (FR-066). Código y pruebas.

Ejecutar desde la raíz del repo:  python3 plans/009-plan-mejora-bloque-4/herramientas/T4.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editar import reemplazar, insertar_antes, insertar_despues  # noqa: E402

SV = 'backend/src/templates/templates.service.ts'
CT = 'backend/src/templates/templates.controller.ts'
API = 'frontend/src/lib/api.ts'
PL = 'frontend/src/screens/Plantillas.tsx'
AQUI = Path(__file__).parent

# ── 1. Servicio: un formulario archivado no se entrega; archivar/restaurar ──
reemplazar(
    SV,
    "          WHERE r.status = 'published'\n            AND ($1::bigint IS NULL OR r.published_seq > $1)\n",
    "          WHERE r.status = 'published'\n            AND t.status = 'active'\n            AND ($1::bigint IS NULL OR r.published_seq > $1)\n",
)
reemplazar(
    SV,
    "        `SELECT MAX(r.published_seq) AS max\n           FROM template_revision r\n          WHERE r.status = 'published'\n",
    "        `SELECT MAX(r.published_seq) AS max\n           FROM template_revision r\n           JOIN template t ON t.id = r.template_id\n          WHERE r.status = 'published'\n            AND t.status = 'active'\n",
)
insertar_antes(
    SV,
    "  /* ── Documento original .xlsx (TSK-FORM-009, FR-018/019) ───────────────── */",
    '''  /* ── Archivo de formularios (TSK-FORM-024, FR-066) ──────────────────────── */

  /**
   * Archiva (`archived`) o restaura (`active`) un formulario. Archivado, deja de
   * entregarse a los dispositivos y de listarse para asignar; sus revisiones,
   * asignaciones e inspecciones se conservan. Cada cambio queda en audit_log.
   * Otra empresa no ve el formulario (RLS): responde 404.
   */
  async cambiarEstadoPlantilla(
    tenantId: string,
    actorId: string,
    templateId: string,
    status: 'active' | 'archived',
  ): Promise<{ template_id: string; name: string; status: 'active' | 'archived' }> {
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const [actual] = await run<{ status: string; name: string }>(
        'SELECT status, name FROM template WHERE id = $1 FOR UPDATE',
        [templateId],
      )
      if (!actual) throw new NotFoundException('Formulario no encontrado')
      if (actual.status !== status) {
        await run('UPDATE template SET status = $2, updated_at = now() WHERE id = $1', [templateId, status])
        await run(
          `INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
           VALUES ($1, $2, $3, $4, 'template', $5, $6)`,
          [
            randomUUID(),
            actorId,
            tenantId,
            status === 'archived' ? 'template_archived' : 'template_restored',
            templateId,
            JSON.stringify({ name: actual.name }),
          ],
        )
      }
      return { template_id: templateId, name: actual.name, status }
    })
  }

  /** Formularios archivados del tenant, del más reciente al más antiguo. */
  async listarArchivadas(
    tenantId: string,
  ): Promise<{ items: Array<{ template_id: string; name: string; archivada_at: string }> }> {
    const rows = await this.db.queryAsTenant<{ template_id: string; name: string; archivada_ms: number }>(
      tenantId,
      `SELECT id AS template_id, name, (extract(epoch FROM updated_at) * 1000)::float8 AS archivada_ms
         FROM template WHERE status = 'archived' ORDER BY updated_at DESC`,
    )
    return {
      items: rows.map((r) => ({
        template_id: r.template_id,
        name: r.name,
        archivada_at: new Date(r.archivada_ms).toISOString(),
      })),
    }
  }

''',
)

# ── 2. Controlador ──────────────────────────────────────────────────────────
insertar_despues(
    CT,
    " *  · `POST /api/v1/templates/revisions/:id/publish` — publica draft explícitamente (solo `tenant_admin`); nunca publica automático (FR-048)\n",
    " *  · `PATCH /api/v1/templates/:templateId/estado` — archiva o restaura un formulario (solo `tenant_admin`, FR-066)\n"
    " *  · `GET /api/v1/templates/archivadas`         — formularios archivados (solo `tenant_admin`, FR-066)\n",
)
insertar_antes(
    CT,
    "  @UseGuards(AuthGuard)\n  @Get('revisions/:revisionId')\n",
    '''  /** TSK-FORM-024 (FR-066): formularios archivados del tenant. */
  @UseGuards(AuthGuard)
  @Get('archivadas')
  archivadas(@Req() req: AuthedRequest) {
    requireTenantAdmin(req)
    return this.templates.listarArchivadas(tenantDe(req))
  }

  /** TSK-FORM-024 (FR-066): archivar (`archived`) o restaurar (`active`) un formulario. */
  @UseGuards(AuthGuard)
  @Patch(':templateId/estado')
  cambiarEstado(@Req() req: AuthedRequest, @Param('templateId') templateId: string, @Body() body: unknown) {
    requireTenantAdmin(req)
    if (!z.string().uuid().safeParse(templateId).success) throw new BadRequestException('templateId inválido')
    const parsed = EstadoPlantillaSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException("status debe ser 'archived' o 'active'")
    return this.templates.cambiarEstadoPlantilla(
      tenantDe(req),
      (req.user as JwtClaims).sub,
      templateId,
      parsed.data.status,
    )
  }

''',
)
insertar_antes(
    CT,
    "const CreateTemplateSchema = z.object({",
    "/** TSK-FORM-024 (FR-066): archivar o restaurar. */\nconst EstadoPlantillaSchema = z.object({ status: z.enum(['archived', 'active']) }).strict()\n\n",
)

# ── 3. Cliente ──────────────────────────────────────────────────────────────
insertar_antes(
    API,
    "/** Publica una revisión ya guardada: acción explícita del admin (FR-048). */",
    '''/** TSK-FORM-024 (FR-066): archiva o restaura un formulario. */
export function cambiarEstadoPlantilla(
  templateId: string,
  status: 'archived' | 'active',
): Promise<{ template_id: string; name: string; status: 'archived' | 'active' }> {
  return apiFetch(`/templates/${encodeURIComponent(templateId)}/estado`, { method: 'PATCH', body: { status } })
}

/** TSK-FORM-024 (FR-066): formularios archivados del tenant. */
export function getPlantillasArchivadas(): Promise<{
  items: Array<{ template_id: string; name: string; archivada_at: string }>
}> {
  return apiFetch('/templates/archivadas')
}

''',
)
Path('frontend/src/lib/duplicar-formulario.ts').write_text(
    (AQUI / 'T4-duplicar-formulario.ts.txt').read_text(encoding='utf-8'), encoding='utf-8', newline='\n'
)
print('ok  frontend/src/lib/duplicar-formulario.ts (nuevo)')

# ── 4. Pantalla Plantillas ──────────────────────────────────────────────────
reemplazar(
    PL,
    "import {\n  ApiError,\n  crearAsignacion,\n  eliminarAsignacion,\n  getAsignaciones,\n  getPlantillas,\n  getSites,\n} from '../lib/api'",
    "import {\n  ApiError,\n  cambiarEstadoPlantilla,\n  crearAsignacion,\n  crearPlantilla,\n  eliminarAsignacion,\n  getAsignaciones,\n  getPlantillas,\n  getPlantillasArchivadas,\n  getSites,\n  publicarRevision,\n} from '../lib/api'\nimport { duplicarDefinicion, nombreDeCopia } from '../lib/duplicar-formulario'",
)
insertar_despues(
    PL,
    "  const [previa, setPrevia] = useState<TemplatePublicadaDto | null>(null)\n",
    '''  /* TSK-FORM-024 (FR-066): archivo y duplicado. */
  const [archivadas, setArchivadas] = useState<Array<{ template_id: string; name: string; archivada_at: string }>>([])
  const [aArchivar, setAArchivar] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
''',
)
reemplazar(
    PL,
    "      const [pub, asignacionesResp, sites] = await Promise.all([\n        getPlantillas(),\n        getAsignaciones(),\n        getSites(),\n      ])\n      setPlantillas(pub.items)",
    "      const [pub, asignacionesResp, sites, arch] = await Promise.all([\n        getPlantillas(),\n        getAsignaciones(),\n        getSites(),\n        getPlantillasArchivadas(),\n      ])\n      setPlantillas(pub.items)\n      setArchivadas(arch.items)",
)
insertar_antes(
    PL,
    "  /* Búsqueda + filtros de cliente sobre el catálogo ya traído. */",
    '''  /* TSK-FORM-024: archivar/restaurar y duplicar. Tras cada acción se recarga
   * todo desde el servidor (nada optimista). */
  const cambiarEstado = useCallback(
    async (templateId: string, status: 'archived' | 'active') => {
      setOcupado(templateId)
      setError(null)
      try {
        await cambiarEstadoPlantilla(templateId, status)
        setAArchivar(null)
        await cargar()
      } catch (e) {
        setError(e instanceof ApiError ? e.detalle : 'No se pudo cambiar el formulario')
      } finally {
        setOcupado(null)
      }
    },
    [cargar],
  )

  const duplicar = useCallback(
    async (p: TemplatePublicadaDto) => {
      setOcupado(p.template_id)
      setError(null)
      try {
        const nombre = nombreDeCopia(p.name, [...plantillas.map((x) => x.name), ...archivadas.map((x) => x.name)])
        const borrador = await crearPlantilla({ name: nombre, definition: duplicarDefinicion(p.definition) })
        await publicarRevision(borrador.id)
        await cargar()
      } catch (e) {
        setError(e instanceof ApiError ? e.detalle : 'No se pudo duplicar el formulario')
      } finally {
        setOcupado(null)
      }
    },
    [plantillas, archivadas, cargar],
  )

''',
)
reemplazar(
    PL,
    "                  <Boton tamano=\"sm\" variante=\"fantasma\" onClick={() => setPrevia(p)}>\n                    Vista previa\n                  </Boton>\n                </div>\n              </div>\n",
    "                  <Boton tamano=\"sm\" variante=\"fantasma\" onClick={() => setPrevia(p)}>\n                    Vista previa\n                  </Boton>\n"
    "                  <Boton tamano=\"sm\" variante=\"fantasma\" disabled={ocupado !== null} onClick={() => void duplicar(p)}>\n"
    "                    {ocupado === p.template_id && aArchivar !== p.template_id ? 'Duplicando…' : 'Duplicar'}\n"
    "                  </Boton>\n"
    "                  <Boton tamano=\"sm\" variante=\"fantasma\" disabled={ocupado !== null} onClick={() => setAArchivar(p.template_id)}>\n"
    "                    Archivar\n"
    "                  </Boton>\n"
    "                </div>\n              </div>\n"
    "              {aArchivar === p.template_id && (\n"
    "                <div role=\"alert\" className=\"rounded-xl border border-sev-media/40 bg-sev-media/10 p-3 space-y-2\">\n"
    "                  <p className=\"text-[14px]\">\n"
    "                    ¿Archivar «{p.name}»? Deja de llegar a los teléfonos y de aparecer aquí. Sus inspecciones y asignaciones\n"
    "                    se conservan y puedes restaurarlo cuando quieras.\n"
    "                  </p>\n"
    "                  <div className=\"flex flex-wrap gap-2\">\n"
    "                    <Boton tamano=\"sm\" variante=\"peligro\" disabled={ocupado !== null} onClick={() => void cambiarEstado(p.template_id, 'archived')}>\n"
    "                      {ocupado === p.template_id ? 'Archivando…' : 'Sí, archivar'}\n"
    "                    </Boton>\n"
    "                    <Boton tamano=\"sm\" variante=\"fantasma\" onClick={() => setAArchivar(null)}>\n"
    "                      Cancelar\n"
    "                    </Boton>\n"
    "                  </div>\n"
    "                </div>\n"
    "              )}\n",
)
insertar_antes(
    PL,
    "      {previa && (\n",
    '''      {/* TSK-FORM-024: formularios archivados, para restaurarlos. */}
      {archivadas.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 items-center gap-3 px-0.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <h2 className="label-inst">Archivados ({archivadas.length})</h2>
            <div className="flex-1 rule" />
            <span className="label-inst group-open:rotate-180 transition-transform duration-150">▾</span>
          </summary>
          <ul className="mt-2 space-y-2">
            {archivadas.map((a) => (
              <li key={a.template_id} className="panel px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium break-words">{a.name}</p>
                  <p className="text-[13px] text-ink-2">
                    Archivado el {new Date(a.archivada_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <Boton tamano="sm" variante="secundaria" disabled={ocupado !== null} onClick={() => void cambiarEstado(a.template_id, 'active')}>
                  {ocupado === a.template_id ? 'Restaurando…' : 'Restaurar'}
                </Boton>
              </li>
            ))}
          </ul>
        </details>
      )}

''',
)

# ── 5. Pruebas ──────────────────────────────────────────────────────────────
for nombre in ('duplicar-formulario.test.ts',):
    Path(f'frontend/test/{nombre}').write_text((AQUI / f'T4-{nombre}.txt').read_text(encoding='utf-8'), encoding='utf-8', newline='\n')
    print(f'ok  frontend/test/{nombre} (nuevo)')
Path('backend/test/templates-archivar.spec.ts').write_text(
    (AQUI / 'T4-templates-archivar.spec.ts.txt').read_text(encoding='utf-8'), encoding='utf-8', newline='\n'
)
print('ok  backend/test/templates-archivar.spec.ts (nuevo)')
print('T4 código listo')
