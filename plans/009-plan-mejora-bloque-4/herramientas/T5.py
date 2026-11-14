"""T5 — TSK-REP-012: tendencia de 8 semanas y filtros de Gerencia en una barra (código y pruebas).

Requiere T1–T4 aplicados. Ejecutar desde la raíz del repo:
    python3 plans/009-plan-mejora-bloque-4/herramientas/T5.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editar import reemplazar, reemplazar_bloque, insertar_antes, insertar_despues  # noqa: E402

DS = 'backend/src/dashboard/dashboard.service.ts'
DB = 'frontend/src/screens/Dashboard.tsx'
AQUI = Path(__file__).parent

# ── 1. Backend: summary.tendencia_semanal ───────────────────────────────────
reemplazar(
    DS,
    "    const [estados, porSev, sincronizaciones, conflictos, urgentes, autores, vencidos] = await Promise.all([",
    "    const [estados, porSev, sincronizaciones, conflictos, urgentes, autores, vencidos, tendencia] = await Promise.all([",
)
reemplazar(
    DS,
    "            AND ($1::uuid IS NULL OR i.site_id = $1)`,\n        [siteId],\n      ),\n    ])",
    '''            AND ($1::uuid IS NULL OR i.site_id = $1)`,
        [siteId],
      ),
      // TSK-REP-012 (FR-040): inspecciones y hallazgos por semana (lunes a
      // domingo, UTC del servidor) de las últimas 8, por faena y sin recorte
      // de período: la tendencia se lee igual cualquiera sea el filtro elegido.
      this.db.queryAsTenant<{ semana: string; inspecciones: number; hallazgos: number }>(
        tenantId,
        `SELECT to_char(s.semana, 'YYYY-MM-DD') AS semana,
                (SELECT count(*)::int FROM inspection i
                  WHERE i.captured_at >= s.semana AND i.captured_at < s.semana + interval '7 days'
                    AND ($1::uuid IS NULL OR i.site_id = $1)) AS inspecciones,
                (SELECT count(*)::int FROM finding f
                   LEFT JOIN inspection i ON i.id = f.inspection_id
                  WHERE f.captured_at >= s.semana AND f.captured_at < s.semana + interval '7 days'
                    AND ($1::uuid IS NULL OR i.site_id = $1)) AS hallazgos
           FROM generate_series(
                  date_trunc('week', now()) - interval '7 weeks',
                  date_trunc('week', now()),
                  interval '1 week'
                ) AS s(semana)
          ORDER BY s.semana`,
        [siteId],
      ),
    ])''',
)
reemplazar(
    DS,
    "      hallazgos_vencidos: vencidos[0]?.n ?? 0,",
    "      hallazgos_vencidos: vencidos[0]?.n ?? 0,\n      tendencia_semanal: tendencia,",
)
reemplazar(
    'shared/src/dashboard.ts',
    "  hallazgos_vencidos: number\n",
    "  hallazgos_vencidos: number\n"
    "  /** TSK-REP-012 (FR-040): últimas 8 semanas (lunes, AAAA-MM-DD), de la más antigua a la actual. */\n"
    "  tendencia_semanal: Array<{ semana: string; inspecciones: number; hallazgos: number }>\n",
)

# ── 2. Componente de tendencia ──────────────────────────────────────────────
Path('frontend/src/components/dashboard/TendenciaSemanal.tsx').write_text(
    (AQUI / 'T5-TendenciaSemanal.tsx.txt').read_text(encoding='utf-8'), encoding='utf-8', newline='\n'
)
print('ok  frontend/src/components/dashboard/TendenciaSemanal.tsx (nuevo)')

# ── 3. Gerencia: un solo filtro de autor ────────────────────────────────────
reemplazar(DB, "  const [autorInsp, setAutorInsp] = useState('')\n", "")
reemplazar(
    DB,
    "      status: estadoFiltro || undefined,\n      autor_id: autorInsp || undefined,\n    }).then(",
    "      status: estadoFiltro || undefined,\n      autor_id: autor === 'todos' ? undefined : autor,\n    }).then(",
)
reemplazar(
    DB,
    "  }, [usuario, esPlataforma, periodo, faena, sevFiltro, autor, rango, formularioFiltro, estadoFiltro, autorInsp])",
    "  }, [usuario, esPlataforma, periodo, faena, sevFiltro, autor, rango, formularioFiltro, estadoFiltro])",
)
reemplazar(
    DB,
    "  }, [periodo, faena, rango, formularioFiltro, estadoFiltro, autorInsp])",
    "  }, [periodo, faena, rango, formularioFiltro, estadoFiltro, autor])",
)
reemplazar(
    DB,
    "    status: (estadoFiltro || undefined) as 'submitted' | 'reviewed' | 'in_progress' | 'draft' | undefined,\n    autor_id: autorInsp || undefined,\n  }",
    "    status: (estadoFiltro || undefined) as 'submitted' | 'reviewed' | 'in_progress' | 'draft' | undefined,\n    autor_id: autor === 'todos' ? undefined : autor,\n  }",
)
reemplazar_bloque(
    DB,
    "                  <select aria-label=\"Autor\" value={autorInsp} onChange={(e) => setAutorInsp(e.target.value)} className={SELECT_FILTRO}>",
    "                  </select>\n",
    "",
)

# ── 4. Gerencia: filtros en una barra y tendencia ───────────────────────────
reemplazar_bloque(
    DB,
    "              {/* ── Filtros (FR-041) ─",
    "              </section>\n\n              {/* ── Listado de hallazgos: crossfade, sin stagger ──────────── */}",
    "              {/* ── Listado de hallazgos: crossfade, sin stagger ──────────── */}",
)
insertar_antes(
    DB,
    "          {/* ── Fila de métricas ──",
    '''          {/* ── Filtros (FR-041, TSK-REP-012): una sola barra para todo el panel ── */}
          <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filtros del panel">
            <label className="block">
              <span className="label-inst">Faena</span>
              <select value={faena} onChange={(e) => setFaena(e.target.value)} className={`mt-1 block ${SELECT_BARRA}`}>
                <option value="todas">Todas las faenas</option>
                {faenas.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label-inst">Severidad</span>
              <select
                value={sevFiltro}
                onChange={(e) => setSevFiltro(e.target.value as Severidad | 'todas')}
                className={`mt-1 block ${SELECT_BARRA}`}
              >
                <option value="todas">Todas</option>
                {(['critica', 'alta', 'media', 'baja'] as Severidad[]).map((s) => (
                  <option key={s} value={s}>
                    {SEV_META[s].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label-inst">Autor</span>
              <select value={autor} onChange={(e) => setAutor(e.target.value)} className={`mt-1 block ${SELECT_BARRA}`}>
                <option value="todos">Todos los autores</option>
                {autores.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>

''',
)
insertar_antes(
    DB,
    "          {supervision && (\n",
    "          {summary && summary.tendencia_semanal.length > 0 && <TendenciaSemanal semanas={summary.tendencia_semanal} />}\n\n",
)
reemplazar(
    DB,
    "const SELECT_FILTRO = 'h-9 px-2 rounded-lg bg-s1 border border-line-soft text-[12px] max-w-[220px]'",
    "const SELECT_FILTRO = 'h-11 px-2 rounded-lg bg-s1 border border-line-soft text-[13px] max-w-[220px]'\n"
    "/** TSK-REP-012: selectores de la barra de filtros del panel. */\n"
    "const SELECT_BARRA = 'h-11 px-2 rounded-[10px] bg-s1 border border-line-soft text-[14px] min-w-[160px] max-w-[240px]'",
)
# Las tarjetas de filtro ya no se usan en Gerencia.
reemplazar(DB, "import { Boton, Tarjeta } from '../components/ui'", "import { Boton } from '../components/ui'")
reemplazar(
    DB,
    "import { BitacoraFaena } from '../components/BitacoraFaena'\n",
    "import { BitacoraFaena } from '../components/BitacoraFaena'\nimport { TendenciaSemanal } from '../components/dashboard/TendenciaSemanal'\n",
)

# ── 5. Pruebas ──────────────────────────────────────────────────────────────
Path('backend/test/dashboard-tendencia.spec.ts').write_text(
    (AQUI / 'T5-dashboard-tendencia.spec.ts.txt').read_text(encoding='utf-8'), encoding='utf-8', newline='\n'
)
print('ok  backend/test/dashboard-tendencia.spec.ts (nuevo)')
print('T5 código listo')
