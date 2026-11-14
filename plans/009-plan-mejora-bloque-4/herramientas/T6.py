"""T6 — TSK-ADM-003: limitar las faenas de cada cuenta (FR-065). Código, migración y pruebas.

Ejecutar desde la raíz del repo:  python3 plans/009-plan-mejora-bloque-4/herramientas/T6.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editar import reemplazar, insertar_antes, insertar_despues  # noqa: E402

AQUI = Path(__file__).parent
US = 'backend/src/users/users.service.ts'
UC = 'backend/src/users/users.controller.ts'
CON = 'backend/src/users/contract.ts'
DS = 'backend/src/dashboard/dashboard.service.ts'
DC = 'backend/src/dashboard/dashboard.controller.ts'
API = 'frontend/src/lib/api.ts'
ADM = 'frontend/src/screens/Administracion.tsx'

# ── 1. Migración 021 ────────────────────────────────────────────────────────
Path('backend/db/migrations/1730000021000_user_site.js').write_text(
    (AQUI / 'T6-migracion-user_site.js.txt').read_text(encoding='utf-8'), encoding='utf-8', newline='\n'
)
print('ok  backend/db/migrations/1730000021000_user_site.js (nuevo)')

# ── 2. Contrato y servicio de cuentas ───────────────────────────────────────
insertar_antes(
    CON,
    "export const resetClaveSchema = z.object({ password: claveTemporal })",
    "/** TSK-ADM-003 (FR-065): faenas en que puede capturar una cuenta; vacío = todas. */\n"
    "export const asignarFaenasSchema = z\n"
    "  .object({ faena_ids: z.array(z.string().uuid('faena inválida')).max(200, 'demasiadas faenas') })\n"
    "  .strict()\n\n",
)
reemplazar(
    CON,
    "  must_change_password: boolean\n  created_at: string\n}",
    "  must_change_password: boolean\n  created_at: string\n  /** TSK-ADM-003 (FR-065): faenas asignadas; vacío = todas. Sólo lo trae el listado. */\n  faena_ids?: string[]\n}",
)
reemplazar(
    US,
    "      `SELECT ${COLUMNAS_USUARIO} FROM app_user ORDER BY is_active DESC, full_name`,",
    "      `SELECT ${COLUMNAS_USUARIO},\n"
    "              COALESCE((SELECT array_agg(us.site_id ORDER BY us.site_id) FROM user_site us\n"
    "                         WHERE us.user_id = app_user.id), '{}') AS faena_ids\n"
    "         FROM app_user ORDER BY is_active DESC, full_name`,",
)
insertar_antes(
    US,
    "  async resetearClave(",
    '''  /**
   * TSK-ADM-003 (FR-065): reemplaza las faenas en que puede capturar una cuenta.
   * Lista vacía = todas las faenas de la empresa. Todo con la conexión del
   * tenant (RLS): una cuenta o faena de otra empresa no existe para esta
   * consulta. Queda `user_sites_updated` en audit_log con antes y después.
   */
  async asignarFaenas(
    tenantId: string,
    actorId: string,
    id: string,
    faenaIds: string[],
  ): Promise<{ id: string; faena_ids: string[] }> {
    const unicas = [...new Set(faenaIds)].sort()
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const [cuenta] = await run<{ id: string }>('SELECT id FROM app_user WHERE id = $1 FOR UPDATE', [id])
      if (!cuenta) throw new NotFoundException('Usuario no encontrado')
      if (unicas.length > 0) {
        const [existen] = await run<{ n: number }>('SELECT count(*)::int AS n FROM site WHERE id = ANY($1::uuid[])', [
          unicas,
        ])
        if ((existen?.n ?? 0) !== unicas.length) throw new BadRequestException('Alguna faena no existe en tu empresa')
      }
      const antes = (
        await run<{ site_id: string }>('SELECT site_id FROM user_site WHERE user_id = $1 ORDER BY site_id', [id])
      ).map((r) => r.site_id)
      await run('DELETE FROM user_site WHERE user_id = $1', [id])
      for (const siteId of unicas) {
        await run('INSERT INTO user_site (tenant_id, user_id, site_id, created_by) VALUES ($1, $2, $3, $4)', [
          tenantId,
          id,
          siteId,
          actorId,
        ])
      }
      await auditar(run, actorId, tenantId, 'user_sites_updated', 'app_user', id, { antes, despues: unicas })
      return { id, faena_ids: unicas }
    })
  }

''',
)
reemplazar(UC, "  Patch,\n  Post,\n  Req,\n", "  Patch,\n  Post,\n  Put,\n  Req,\n")
reemplazar(UC, "  actualizarUsuarioSchema,\n", "  actualizarUsuarioSchema,\n  asignarFaenasSchema,\n")
insertar_antes(
    UC,
    "  @Post('users/:id/reset-password')",
    '''  /** TSK-ADM-003 (FR-065): faenas en que puede capturar la cuenta; `[]` = todas. */
  @Put('users/:id/faenas')
  asignarFaenas(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ id: string; faena_ids: string[] }> {
    const { tenantId, actorId } = exigirAdminEmpresa(req)
    return this.users.asignarFaenas(tenantId, actorId, exigirUuid(id), parsear(asignarFaenasSchema, body).faena_ids)
  }

''',
)
insertar_despues(
    UC,
    " *  - POST  /api/v1/users/:id/reset-password    (nueva clave temporal)\n",
    " *  - PUT   /api/v1/users/:id/faenas            (faenas en que captura; [] = todas, FR-065)\n",
)

# ── 3. GET /sites: sólo las faenas asignadas a la cuenta ────────────────────
reemplazar(
    DS,
    "  async listSites(u: JwtClaims): Promise<SitesResponse> {\n    this.exigir(u, ['field_worker', 'supervisor', 'tenant_admin'])\n    const rows = await this.db.queryAsTenant<SiteDto>(\n      u.tenant_id as string,\n      `SELECT id, name AS nombre,\n              CASE kind WHEN 'mining' THEN 'mina' ELSE 'obra' END AS tipo\n         FROM site ORDER BY name`,\n    )",
    '''  async listSites(u: JwtClaims, soloAsignadas = false): Promise<SitesResponse> {
    this.exigir(u, ['field_worker', 'supervisor', 'tenant_admin'])
    // TSK-ADM-003 (FR-065): para capturar, una cuenta de terreno o supervisión
    // ve sólo sus faenas asignadas; sin asignación, todas. El resumen del panel
    // pide la lista completa (`soloAsignadas = false`): FR-065 no limita la supervisión.
    const restringir = soloAsignadas && (u.rol === 'field_worker' || u.rol === 'supervisor')
    const rows = await this.db.queryAsTenant<SiteDto>(
      u.tenant_id as string,
      `SELECT s.id, s.name AS nombre,
              CASE s.kind WHEN 'mining' THEN 'mina' ELSE 'obra' END AS tipo
         FROM site s
        WHERE NOT $1::boolean
           OR NOT EXISTS (SELECT 1 FROM user_site us WHERE us.user_id = $2)
           OR EXISTS (SELECT 1 FROM user_site us WHERE us.user_id = $2 AND us.site_id = s.id)
        ORDER BY s.name`,
      [restringir, u.sub],
    )''',
)
reemplazar(
    DC,
    "  sites(@Req() req: AuthedRequest): Promise<SitesResponse> {\n    return this.dashboard.listSites(req.user as JwtClaims)\n  }",
    "  sites(@Req() req: AuthedRequest): Promise<SitesResponse> {\n    // TSK-ADM-003: esta es la lista con que el teléfono elige faena.\n    return this.dashboard.listSites(req.user as JwtClaims, true)\n  }",
)

# ── 4. Cliente y pantalla Equipo ────────────────────────────────────────────
reemplazar(
    API,
    "  must_change_password: boolean\n  created_at: string\n}\n",
    "  must_change_password: boolean\n  created_at: string\n  /** TSK-ADM-003: faenas asignadas; vacío o ausente = todas. */\n  faena_ids?: string[]\n}\n",
)
insertar_antes(
    API,
    "export function resetearClaveUsuario(",
    '''/** TSK-ADM-003 (FR-065): faenas en que puede capturar una cuenta; `[]` = todas. */
export function asignarFaenasUsuario(id: string, faenaIds: string[]): Promise<{ id: string; faena_ids: string[] }> {
  return apiFetch(`/users/${encodeURIComponent(id)}/faenas`, { method: 'PUT', body: { faena_ids: faenaIds } })
}

''',
)
reemplazar(ADM, "  actualizarUsuario,\n", "  actualizarUsuario,\n  asignarFaenasUsuario,\n")
reemplazar(
    ADM,
    "  const cargar = useCallback(async () => {\n    try {\n      setUsuarios(await listarUsuarios())\n      setError(null)",
    "  const cargar = useCallback(async () => {\n    try {\n      const [cuentas, sitios] = await Promise.all([listarUsuarios(), getSites()])\n"
    "      setUsuarios(cuentas)\n      setFaenasEmpresa(sitios.items.map((s) => ({ id: s.id, nombre: s.nombre })))\n      setError(null)",
)
reemplazar(
    ADM,
    "  const [enviando, setEnviando] = useState(false)\n\n  const cargar",
    "  const [enviando, setEnviando] = useState(false)\n"
    "  /* TSK-ADM-003: faenas de la empresa y cuenta cuyas faenas se están editando. */\n"
    "  const [faenasEmpresa, setFaenasEmpresa] = useState<Array<{ id: string; nombre: string }>>([])\n"
    "  const [editandoFaenas, setEditandoFaenas] = useState<string | null>(null)\n\n  const cargar",
)
reemplazar(
    ADM,
    "              {u.is_active && (\n                <Boton tamano=\"sm\" onClick={() => void resetear(u)}>\n                  Restablecer clave\n                </Boton>\n              )}\n",
    "              {u.is_active && u.role !== 'tenant_admin' && faenasEmpresa.length > 1 && (\n"
    "                <Boton\n"
    "                  tamano=\"sm\"\n"
    "                  variante=\"fantasma\"\n"
    "                  aria-expanded={editandoFaenas === u.id}\n"
    "                  onClick={() => setEditandoFaenas(editandoFaenas === u.id ? null : u.id)}\n"
    "                >\n"
    "                  {resumenFaenas(u.faena_ids ?? [], faenasEmpresa.length)}\n"
    "                </Boton>\n"
    "              )}\n"
    "              {u.is_active && (\n                <Boton tamano=\"sm\" onClick={() => void resetear(u)}>\n                  Restablecer clave\n                </Boton>\n              )}\n",
)
reemplazar(
    ADM,
    "                  {u.is_active ? 'Desactivar' : 'Reactivar'}\n                </Boton>\n              )}\n            </div>",
    "                  {u.is_active ? 'Desactivar' : 'Reactivar'}\n                </Boton>\n              )}\n"
    "              {editandoFaenas === u.id && (\n"
    "                <EditorFaenas\n"
    "                  nombre={u.full_name}\n"
    "                  faenas={faenasEmpresa}\n"
    "                  inicial={u.faena_ids ?? []}\n"
    "                  alCancelar={() => setEditandoFaenas(null)}\n"
    "                  alGuardar={(ids) =>\n"
    "                    void accion(async () => {\n"
    "                      await asignarFaenasUsuario(u.id, ids)\n"
    "                      setEditandoFaenas(null)\n"
    "                    })\n"
    "                  }\n"
    "                />\n"
    "              )}\n"
    "            </div>",
)
insertar_antes(
    ADM,
    "/**\n * TSK-ADM-002 (FR-053): alta de varias cuentas desde una planilla.",
    (AQUI / 'T6-EditorFaenas.tsx.txt').read_text(encoding='utf-8'),
)

# ── 5. Pruebas ──────────────────────────────────────────────────────────────
Path('backend/test/users-faenas.spec.ts').write_text(
    (AQUI / 'T6-users-faenas.spec.ts.txt').read_text(encoding='utf-8'), encoding='utf-8', newline='\n'
)
print('ok  backend/test/users-faenas.spec.ts (nuevo)')
Path('frontend/test/faenas-cuenta.test.ts').write_text(
    (AQUI / 'T6-faenas-cuenta.test.ts.txt').read_text(encoding='utf-8'), encoding='utf-8', newline='\n'
)
print('ok  frontend/test/faenas-cuenta.test.ts (nuevo)')
print('T6 código listo')
