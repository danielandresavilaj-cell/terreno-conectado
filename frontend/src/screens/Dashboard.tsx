/* Dashboard de gerencia — FR-040, FR-041, FR-042, FR-043 · NFR-03.
 *
 * TSK-WS-011: consume `GET /api/v1/dashboard/summary` y `/findings` con la
 * identidad real del tenant (faenas de `/sites`). Auto-refresh cada 30 s +
 * al recobrar el foco o la señal; en vivo la latencia se re-mide sola.
 *
 * La métrica protagonista es la LATENCIA CAPTURA→DISPONIBILIDAD: es lo que
 * demuestra la propuesta de valor del informe APT (spec maestro §1). Si este
 * panel no la muestra en grande, la pantalla está decorativa.
 *
 * MOVIMIENTO (decisiones):
 * · Count-up en todas las cifras grandes: se ve 1 vez por visita → ocasional,
 *   animación estándar permitida. Propósito: EXPLICACIÓN — dice "esto es una
 *   magnitud medida", no un literal escrito a mano.
 * · Las barras crecen en scaleX con stagger de 60 ms por fila: la cascada
 *   permite comparar longitudes en el tiempo que el ojo las recorre. Es
 *   información, no adorno. 620 ms, ease-out.
 * · El dial de latencia hace una sola pasada al entrar. NO hace loop: un dial
 *   girando perpetuamente en un dashboard que se mira fijamente es ruido
 *   visual y compite con los números.
 * · Los filtros cambian el contenido con crossfade de 160 ms. NO hay animación
 *   de "los números cambian": sería un tic constante al cambiar de filtro.
 * · El toggle de periodo mueve un knob con `layout` — acción manual, rara.
 * · La lista de hallazgos NO tiene stagger: es la vista que se desplaza y se
 *   lee en movimiento. Stagger en scroll se siente como retraso.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { BadgeSev, Chip, SEV_META } from '../components/Badges'
import { Barra, CountUp } from '../components/CountUp'
import { Boton, Tarjeta } from '../components/ui'
import { getFindings, getSummary, ApiError, type DashboardFiltros } from '../lib/api'
import { useEstado } from '../lib/store'
import { EASE } from '../lib/motion'
import type { DashboardSummary, FindingDto } from '@terreno/shared'
import type { InspeccionEstado, Severidad } from '../lib/types'

const PERIODOS = ['24 h', '7 días', '30 días'] as const
type Periodo = (typeof PERIODOS)[number]

/* Severidad es (UI) → valore del wire (low…critical). */
const SEV_UI_A_WIRE: Record<Severidad, 'low' | 'medium' | 'high' | 'critical'> = {
  baja: 'low',
  media: 'medium',
  alta: 'high',
  critica: 'critical',
}
const SEV_WIRE_A_UI: Record<FindingDto['severity'], Severidad> = {
  low: 'baja',
  medium: 'media',
  high: 'alta',
  critical: 'critica',
}

const ESTADO_META: Record<InspeccionEstado, { label: string; color: string }> = {
  draft: { label: 'Borrador', color: 'var(--color-pending)' },
  in_progress: { label: 'En curso', color: 'var(--color-syncing)' },
  submitted: { label: 'Enviadas', color: 'var(--color-beam)' },
  reviewed: { label: 'Revisadas', color: 'var(--color-synced)' },
}

function rangoPeriodo(p: Periodo): { desde: string; hasta: string } {
  const hs = p === '24 h' ? 24 : p === '7 días' ? 168 : 720
  return {
    desde: new Date(Date.now() - hs * 3_600_000).toISOString(),
    hasta: new Date().toISOString(),
  }
}

export function Dashboard() {
  const { usuario, identidad, online } = useEstado()
  const [periodo, setPeriodo] = useState<Periodo>('7 días')
  const [faena, setFaena] = useState<string>('todas')
  const [sevFiltro, setSevFiltro] = useState<Severidad | 'todas'>('todas')
  const [datos, setDatos] = useState<{ summary: DashboardSummary; hallazgos: FindingDto[] } | null>(null)
  const [cargando, setCargando] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const reducir = useReducedMotion()

  const esPlataforma = usuario?.rol === 'platform_admin'

  const cargar = useCallback(async () => {
    if (!usuario || esPlataforma) return
    const { desde, hasta } = rangoPeriodo(periodo)
    const f: DashboardFiltros = { site_id: faena === 'todas' ? undefined : faena, desde, hasta }
    const fs = { ...f, severidad: sevFiltro === 'todas' ? undefined : SEV_UI_A_WIRE[sevFiltro] }
    setCargando(true)
    setErrorCarga(null)
    try {
      const [summary, hallazgos] = await Promise.all([getSummary(f), getFindings(fs)])
      setDatos({ summary, hallazgos: hallazgos.items })
    } catch (err) {
      if (err instanceof ApiError && err.status !== 0) {
        setErrorCarga(err.detalle)
      }
    } finally {
      setCargando(false)
    }
  }, [usuario, esPlataforma, periodo, faena, sevFiltro])

  /* FR-043: auto-refresh cada 30 s + al recobrar foco/señal. */
  useEffect(() => {
    void cargar()
    const t = setInterval(() => void cargar(), 30_000)
    const enFoco = () => void cargar()
    const enRed = () => void cargar()
    window.addEventListener('focus', enFoco)
    window.addEventListener('online', enRed)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', enFoco)
      window.removeEventListener('online', enRed)
    }
  }, [cargar])

  const faenas = identidad?.faenas ?? []

  const summary = datos?.summary ?? null
  const hallazgos = datos?.hallazgos ?? []

  const totalInsp = useMemo(
    () => (summary ? Object.values(summary.inspecciones_por_estado).reduce((a, b) => a + b, 0) : 0),
    [summary],
  )
  const enCurso = summary?.inspecciones_por_estado.in_progress ?? 0
  const porSev: Array<{ sev: Severidad; n: number }> = summary
    ? (['critica', 'alta', 'media', 'baja'] as Severidad[]).map((s) => ({
        sev: s,
        n: summary.hallazgos_por_severidad[SEV_UI_A_WIRE[s]] ?? 0,
      }))
    : []
  const maxInsp = Math.max(1, ...(summary ? Object.values(summary.inspecciones_por_estado) : [0]))

  const filtrados = hallazgos.filter(
    (h) =>
      (sevFiltro === 'todas' || SEV_WIRE_A_UI[h.severity] === sevFiltro) &&
      (faena === 'todas' || h.faena_id === faena),
  )

  /* FR-042: export CSV de lo que está filtrado en pantalla. */
  const exportarCsv = () => {
    if (filtrados.length === 0) return
    const filas = [
      ['id', 'severidad', 'estado', 'faena', 'autor', 'capturado_at'],
      ...filtrados.map((h) => [
        h.id,
        h.severity,
        h.status,
        h.faena_nombre ?? '',
        h.autor ?? '',
        h.captured_at,
      ]),
    ]
    const csv = filas.map((r) => r.map((c) => `"${(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hallazgos-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-inst">FR-040 · Dashboard por tenant</p>
          <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
            {esPlataforma ? 'Operación Plataforma' : identidad?.tenantNombre ?? '—'}
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-2">
            {esPlataforma
              ? 'Vista agregada · todos los tenants'
              : 'Consolidado desde la cola de sincronización'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Filtro de periodo: knob con layout. Acción manual y rara. */}
          <div className="flex p-1 rounded-xl bg-s1 border border-line-soft">
            {PERIODOS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={[
                  'relative h-8 px-3 rounded-lg text-[12px] font-mono tracking-[0.04em] cursor-pointer',
                  'transition-colors duration-150 ease-out',
                  periodo === p ? 'text-s0' : 'text-ink-3 hover:text-ink-2',
                ].join(' ')}
              >
                {periodo === p && (
                  <motion.span
                    layoutId="periodo-knob"
                    transition={
                      reducir ? { duration: 0 } : { type: 'spring', duration: 0.38, bounce: 0.2 }
                    }
                    className="absolute inset-0 rounded-lg bg-beam"
                  />
                )}
                <span className="relative z-10">{p}</span>
              </button>
            ))}
          </div>
          {/* FR-042: export CSV. */}
          <Boton
            tamano="sm"
            variante="secundaria"
            onClick={exportarCsv}
            disabled={!summary || filtrados.length === 0}
            icono={
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M7 1.8v7.4M4.2 6.6 7 9.4l2.8-2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2.2 11.4h9.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            }
          >
            CSV
          </Boton>
        </div>
      </header>

      {esPlataforma ? (
        <div className="panel p-8 text-center max-w-[56ch] mx-auto">
          <p className="text-[14px] font-semibold tracking-[-0.01em]">Panel por tenant no disponible</p>
          <p className="mt-2 text-[13px] text-ink-2 leading-relaxed">
            Esta sesión es de plataforma y NO pertenece a ningún tenant ({'\u201C'}Todos los
            tenants{'\u201D'}). El panel ejecutivo se entrega con una cuenta de supervisor o{' '}
            admin de empresa, que sí puede leer su faena (NFR-05, RLS).
          </p>
        </div>
      ) : (
        <>
          {/* Aviso de carga/error — esto es telemetría, no decoración. */}
          <AnimatePresence>
            {errorCarga && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-start gap-2 rounded-lg bg-sev-alta/10 border border-sev-alta/25 px-3 py-2"
              >
                <span className="mt-[3px] h-1.5 w-1.5 rounded-full bg-sev-alta shrink-0" />
                <p className="text-[12px] leading-relaxed text-sev-alta">
                  No se pudo leer el registro: {errorCarga}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Fila de métricas ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metrica
              etiqueta="Latencia media"
              valor={summary?.latencia_media_seg ?? null}
              sufijo=" s"
              pie="captura → dashboard"
              destacado
            />
            <Metrica
              etiqueta="Latencia p95"
              valor={summary?.latencia_p95_seg ?? null}
              sufijo=" s"
              pie="objetivo NFR-03: 60 s"
            />
            <Metrica
              etiqueta="Hallazgos urgentes"
              valor={summary?.hallazgos_urgentes ?? null}
              pie={`${summary?.hallazgos_total ?? 0} hallazgos registrados`}
              destacado={summary?.hallazgos_urgentes ? true : undefined}
            />
            <Metrica etiqueta="Inspecciones" valor={totalInsp} pie={`${enCurso} en curso ahora`} />
          </div>

          {!summary && cargando ? (
            <div className="panel p-8 text-center">
              <p className="text-[13px] text-ink-2">Leyendo del servidor…</p>
            </div>
          ) : (
            <>
              {/* ── Gráficas ───────────────────────────────────────────────── */}
              <div className="grid lg:grid-cols-2 gap-3">
                <section className="panel p-4">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <h2 className="text-[14px] font-semibold tracking-[-0.015em]">Inspecciones por estado</h2>
                    <Chip>{periodo}</Chip>
                  </div>
                  <div className="space-y-3">
                    {(Object.keys(ESTADO_META) as InspeccionEstado[]).map((k, i) => (
                      <div key={k}>
                        <div className="flex items-baseline justify-between gap-3 mb-1.5">
                          <span className="text-[12px] text-ink-2">{ESTADO_META[k].label}</span>
                          <span className="num-inst text-[13px] text-ink">
                            {summary?.inspecciones_por_estado[k] ?? 0}
                          </span>
                        </div>
                        <Barra
                          pct={(summary ? (summary.inspecciones_por_estado[k] ?? 0) / maxInsp : 0) * 100}
                          color={ESTADO_META[k].color}
                          retardo={0.1 + i * 0.06}
                        />
                      </div>
                    ))}
                  </div>
                </section>

                {/* Hallazgos por severidad */}
                <section className="panel p-4">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <h2 className="text-[14px] font-semibold tracking-[-0.015em]">Hallazgos por severidad</h2>
                    <Chip>{periodo}</Chip>
                  </div>
                  <div className="space-y-3">
                    {porSev.map(({ sev, n }, i) => {
                      const m = SEV_META[sev]
                      const total = porSev.reduce((a, x) => a + x.n, 0)
                      const maxSev = Math.max(1, ...porSev.map((x) => x.n))
                      return (
                        <div key={sev}>
                          <div className="flex items-baseline justify-between gap-3 mb-1.5">
                            <div className="flex items-center gap-2">
                              <BadgeSev sev={sev} />
                            </div>
                            <span className="num-inst text-[13px] text-ink">
                              {n}
                              <span className="text-ink-3 ml-1.5 text-[11px]">
                                {total ? Math.round((n / total) * 100) : 0}%
                              </span>
                            </span>
                          </div>
                          <Barra
                            pct={(n / maxSev) * 100}
                            color={m.color}
                            retardo={0.14 + i * 0.06}
                          />
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-4 text-[11px] text-ink-3 leading-relaxed border-t border-line-soft pt-3">
                    Los hallazgos de severidad alta y crítica se destacan de inmediato en este panel al
                    sincronizarse (FR-035).
                  </p>
                </section>
              </div>

              {/* ── Filtros (FR-041) ─────────────────────────────────────── */}
              <section className="space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="label-inst">FR-041 · Filtros</h2>
                  <div className="flex-1 rule" />
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <p className="label-inst">Faena</p>
                    {[{ id: 'todas', nombre: 'Todas las faenas', tipo: 'mina' as const }, ...faenas].map(
                      (f) => (
                        <Tarjeta key={f.id} activa={faena === f.id} onClick={() => setFaena(f.id)}>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[13px] font-medium truncate">{f.nombre}</span>
                          </div>
                        </Tarjeta>
                      ),
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="label-inst">Severidad</p>
                    <Tarjeta activa={sevFiltro === 'todas'} onClick={() => setSevFiltro('todas')}>
                      <span className="text-[13px] font-medium">Todas las severidades</span>
                    </Tarjeta>
                    {(['critica', 'alta', 'media', 'baja'] as Severidad[]).map((s) => (
                      <Tarjeta key={s} activa={sevFiltro === s} onClick={() => setSevFiltro(s)}>
                        <BadgeSev sev={s} />
                      </Tarjeta>
                    ))}
                  </div>
                </div>
              </section>

              {/* ── Listado de hallazgos: crossfade, sin stagger ──────────── */}
              <section className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <h2 className="label-inst">Hallazgos filtrados · {filtrados.length}</h2>
                  <div className="flex-1 rule" />
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={`${faena}-${sevFiltro}-${periodo}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16, ease: EASE.out }}
                    className="space-y-2"
                  >
                    {filtrados.length === 0 ? (
                      <div className="panel p-8 text-center">
                        <p className="text-[13px] text-ink-2">
                          {hallazgos.length === 0 && cargando
                            ? 'Cargando hallazgos…'
                            : 'Ningún hallazgo con estos filtros.'}
                        </p>
                      </div>
                    ) : (
                      filtrados.map((h) => <FilaHallazgo key={h.id} h={h} />)
                    )}
                  </motion.div>
                </AnimatePresence>
              </section>
            </>
          )}

          <p className="text-[11px] text-ink-3 leading-relaxed border-t border-line-soft pt-4">
            Datos visibles para {identidad?.tenantNombre ?? 'tu tenant'} únicamente. El otro tenant
            no puede leer estas filas: el aislamiento es una política de PostgreSQL RLS, no un
            filtro de la interfaz (NFR-05, Artículo IV). Auto-refresh cada 30 s (FR-043).
            {!online && ' · Sin señal: se muestra la última lectura; los pendientes están en la cola.'}
          </p>
        </>
      )}
    </div>
  )
}

/* ── Tarjeta de métrica ──────────────────────────────────────────────────
 * El `destacado` (latencia) es la métrica que prueba la propuesta de valor:
 * por eso lleva borde de acento y tipografía mayor. `null` = sin datos aún. */
function Metrica({
  etiqueta,
  valor,
  sufijo,
  pie,
  destacado,
}: {
  etiqueta: string
  valor: number | null
  sufijo?: string
  pie: string
  destacado?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE.out }}
      className={[
        'panel p-4',
        destacado ? 'border-beam/35 bg-beam/[0.04]' : '',
      ].join(' ')}
    >
      <p className="label-inst">{etiqueta}</p>
      <p className={['mt-2 font-semibold leading-none tracking-[-0.035em]', destacado ? 'text-[32px]' : 'text-[26px]'].join(' ')}>
        {valor === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <CountUp valor={valor} sufijo={sufijo} />
        )}
      </p>
      <p className="mt-2 text-[11px] text-ink-3 leading-snug">{pie}</p>
    </motion.div>
  )
}

function tiempoRelativo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const hs = Math.round(min / 60)
  if (hs < 24) return `hace ${hs} h`
  const d = Math.round(hs / 24)
  return `hace ${d} día${d > 1 ? 's' : ''}`
}

function FilaHallazgo({ h }: { h: FindingDto }) {
  const sev = SEV_WIRE_A_UI[h.severity]
  const meta = SEV_META[sev]
  // FR-035: alta y crítica quedan demarcados en el listado.
  const urgente = sev === 'alta' || sev === 'critica'

  return (
    <motion.div
      layout
      transition={{ duration: 0.3, ease: EASE.out }}
      className={[
        'panel px-4 py-3.5 flex items-start gap-4',
        urgente ? 'border-l-2' : '',
      ].join(' ')}
      style={urgente ? { borderLeftColor: meta.color } : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <BadgeSev sev={sev} destacado={urgente} />
          <p className="text-[13px] font-medium">{h.description}</p>
        </div>
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <span className="label-inst">{h.faena_nombre ?? 'faena sin asignar'}</span>
          <span className="label-inst">· {h.autor ?? 'sin autor'}</span>
          <span className="label-inst">· {tiempoRelativo(h.captured_at)}</span>
          {h.foto_id && h.foto_bytes != null && (
            <span className="label-inst" style={{ color: meta.color }}>
              · foto {h.foto_ancho}×{h.foto_alto} · {Math.round(h.foto_bytes / 1024)} KB
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="label-inst">Estado</p>
        <p className="mt-1 text-[12px] font-medium capitalize">
          {h.status === 'open' ? 'Abierto' : h.status === 'in_progress' ? 'En curso' : 'Resuelto'}
        </p>
      </div>
    </motion.div>
  )
}