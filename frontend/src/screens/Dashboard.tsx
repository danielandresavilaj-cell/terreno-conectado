/* Dashboard de gerencia — FR-040, FR-041, FR-042, FR-043 · NFR-03.
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

import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { BadgeSev, Chip, SEV_META } from '../components/Badges'
import { Barra, CountUp } from '../components/CountUp'
import { Boton, Tarjeta } from '../components/ui'
import { useEstado } from '../lib/store'
import {
  FAENAS,
  HALLAZGOS,
  INSPECCIONES_POR_ESTADO,
  LATENCIA_P50,
  LATENCIA_P95,
  TENANTS,
} from '../lib/seed'
import { EASE } from '../lib/motion'
import type { Hallazgo, InspeccionEstado, Severidad } from '../lib/types'

const PERIODOS = ['24 h', '7 días', '30 días'] as const

const ESTADO_META: Record<InspeccionEstado, { label: string; color: string }> = {
  draft: { label: 'Borrador', color: 'var(--color-pending)' },
  in_progress: { label: 'En curso', color: 'var(--color-syncing)' },
  submitted: { label: 'Enviadas', color: 'var(--color-beam)' },
  reviewed: { label: 'Revisadas', color: 'var(--color-synced)' },
}

export function Dashboard() {
  const { usuario, online } = useEstado()
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]>('7 días')
  const [faena, setFaena] = useState<string>('todas')
  const [sevFiltro, setSevFiltro] = useState<Severidad | 'todas'>('todas')
  const reducir = useReducedMotion()

  const totalInsp = Object.values(INSPECCIONES_POR_ESTADO).reduce((a, b) => a + b, 0)
  const abiertos = HALLAZGOS.filter((h) => h.estado !== 'resolved')
  const porSev = (['critica', 'alta', 'media', 'baja'] as Severidad[]).map((s) => ({
    sev: s,
    n: HALLAZGOS.filter((h) => h.severidad === s).length,
  }))
  const maxInsp = Math.max(...Object.values(INSPECCIONES_POR_ESTADO))

  const hallazgos = HALLAZGOS.filter(
    (h) =>
      (sevFiltro === 'todas' || h.severidad === sevFiltro) &&
      (faena === 'todas' || h.faena === faena),
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-inst">FR-040 · Dashboard por tenant</p>
          <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
            {TENANTS.cobre.nombre}
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-2">
            {usuario?.rol === 'platform_admin'
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

      {/* ── Fila de métricas ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metrica
          etiqueta="Latencia p50"
          valor={LATENCIA_P50}
          sufijo=" s"
          pie="captura → dashboard"
          destacado
        />
        <Metrica etiqueta="Latencia p95" valor={LATENCIA_P95} sufijo=" s" pie="objetivo NFR-03: 60 s" />
        <Metrica etiqueta="Hallazgos abiertos" valor={abiertos.length} pie={`${HALLAZGOS.length} registrados`} />
        <Metrica etiqueta="Inspecciones" valor={totalInsp} pie={`${INSPECCIONES_POR_ESTADO.in_progress} en curso ahora`} />
      </div>

      {/* ── Gráficas ───────────────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-3">
        {/* Inspecciones por estado */}
        <section className="panel p-4">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-[14px] font-semibold tracking-[-0.015em]">Inspecciones por estado</h2>
            <Chip>{periodo}</Chip>
          </div>
          <div className="space-y-3">
            {(Object.keys(INSPECCIONES_POR_ESTADO) as InspeccionEstado[]).map((k, i) => (
              <div key={k}>
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <span className="text-[12px] text-ink-2">{ESTADO_META[k].label}</span>
                  <span className="num-inst text-[13px] text-ink">
                    {INSPECCIONES_POR_ESTADO[k]}
                  </span>
                </div>
                <Barra
                  pct={(INSPECCIONES_POR_ESTADO[k] / maxInsp) * 100}
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
              const maxSev = Math.max(...porSev.map((x) => x.n))
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
                    pct={(n / Math.max(1, maxSev)) * 100}
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

      {/* ── Filtros (FR-041) ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="label-inst">FR-041 · Filtros</h2>
          <div className="flex-1 rule" />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <p className="label-inst">Faena</p>
            {[{ id: 'todas', nombre: 'Todas las faenas', tipo: 'mina' as const, region: '' }, ...FAENAS].map(
              (f) => (
                <Tarjeta key={f.id} activa={faena === f.id} onClick={() => setFaena(f.id)}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-medium truncate">{f.nombre}</span>
                    {f.region && <span className="label-inst shrink-0">{f.region}</span>}
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

      {/* ── Listado de hallazgos: crossfade, sin stagger ──────────────────── */}
      <section className="space-y-2.5">
        <div className="flex items-center gap-3">
          <h2 className="label-inst">
            Hallazgos filtrados · {hallazgos.length}
          </h2>
          <div className="flex-1 rule" />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={`${faena}-${sevFiltro}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: EASE.out }}
            className="space-y-2"
          >
            {hallazgos.length === 0 ? (
              <div className="panel p-8 text-center">
                <p className="text-[13px] text-ink-2">
                  Ningún hallazgo con estos filtros.
                </p>
              </div>
            ) : (
              hallazgos.map((h) => <FilaHallazgo key={h.id} h={h} />)
            )}
          </motion.div>
        </AnimatePresence>
      </section>

      <p className="text-[11px] text-ink-3 leading-relaxed border-t border-line-soft pt-4">
        Datos visibles para {TENANTS.cobre.nombre} únicamente. El usuario del tenant{' '}
        {TENANTS.andes.nombre} no puede leer estas filas: el aislamiento es una política de
        PostgreSQL RLS, no un filtro de la interfaz (NFR-05, Artículo IV).
        {!online && ' · Los datos mostrados son los ya sincronizados; los pendientes están en la cola.'}
      </p>
    </div>
  )
}

/* ── Tarjeta de métrica ──────────────────────────────────────────────────
 * El `destacado` (latencia p50) es la métrica que prueba la propuesta de valor:
 * por eso lleva borde de acento y tipografía mayor. */
function Metrica({
  etiqueta,
  valor,
  sufijo,
  pie,
  destacado,
}: {
  etiqueta: string
  valor: number
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
        <CountUp valor={valor} sufijo={sufijo} />
      </p>
      <p className="mt-2 text-[11px] text-ink-3 leading-snug">{pie}</p>
    </motion.div>
  )
}

function FilaHallazgo({ h }: { h: Hallazgo }) {
  const meta = SEV_META[h.severidad]
  // FR-035: alta y crítica quedan demarcados en el listado.
  const urgente = h.severidad === 'alta' || h.severidad === 'critica'

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
          <BadgeSev sev={h.severidad} destacado={urgente} />
          <p className="text-[13px] font-medium">{h.titulo}</p>
        </div>
        <p className="mt-1.5 text-[12px] text-ink-2 leading-relaxed line-clamp-2">{h.descripcion}</p>
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <span className="label-inst">{h.faena}</span>
          <span className="label-inst">· {h.autor}</span>
          <span className="label-inst">· {h.capturadoEn}</span>
          {h.foto && (
            <span className="label-inst" style={{ color: meta.color }}>
              · foto {h.foto.kb} KB
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="label-inst">Estado</p>
        <p className="mt-1 text-[12px] font-medium capitalize">
          {h.estado === 'open' ? 'Abierto' : h.estado === 'in_progress' ? 'En curso' : 'Resuelto'}
        </p>
      </div>
    </motion.div>
  )
}
