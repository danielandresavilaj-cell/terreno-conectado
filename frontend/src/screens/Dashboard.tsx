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
import {
  getFindings,
  getDetalleInspeccion,
  revisarInspeccion,
  cofirmarInspeccion,
  cambiarEstadoHallazgo,
  getInspecciones,
  getSummary,
  getSupervision,
  descargarInspeccion,
  ApiError,
  type DashboardFiltros,
} from '../lib/api'
import { descargarLibro } from '../lib/exportar'
import { construirCsvHallazgos } from '../lib/dashboard-csv'
import { useEstado } from '../lib/store'
import { duracion } from '../lib/supervision'
import { BloquesSupervision } from '../components/dashboard/BloquesSupervision'
import { PanelExportar } from '../components/dashboard/PanelExportar'
import { FirmaCierre } from '../components/FirmaCierre'
import { PERIODOS, rangoPeriodo, type Periodo, type RangoFechas } from '../lib/periodos'
import { EASE } from '../lib/motion'
import type { DashboardSummary, DashboardSupervision, FindingDto, InspectionDetalle, InspectionListaItem } from '@terreno/shared'
import type { InspeccionEstado, Severidad } from '../lib/types'


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

/**
 * Los filtros de período+faena, en la forma que los espera el backend.
 *
 * Existe como función y no como `useMemo` por una razón concreta: la ventana
 * "últimas 7 días" tiene que SEGUIR corriendo mientras la pantalla esté abierta
 * (el auto-refresh de FR-043 la recalcula cada 30 s), así que el rango se
 * calcula en cada uso y no se congela al cambiar de filtro. Lo único que no se
 * recalcula es la traducción `faena === 'todas' → sin site_id`.
 *
 * Es la MISMA función la que usa el listado (FR-044) y la que usa el lote
 * (FR-045): el ZIP tiene que ser exactamente el período que hay en pantalla, y
 * dos construcciones del filtro son dos maneras de que dejen de coincidir.
 */
function filtrosDe(periodo: Periodo, faena: string, rango?: RangoFechas): DashboardFiltros {
  const { desde, hasta } = rangoPeriodo(periodo, rango)
  return { site_id: faena === 'todas' ? undefined : faena, desde, hasta }
}

type DetalleInspeccion =
  | { fase: 'inactivo' }
  | { fase: 'cargando'; id: string }
  | { fase: 'error'; id: string; mensaje: string }
  | { fase: 'ok'; detalle: InspectionDetalle }


/**
 * Motivo real de un fallo, para poder mostrarlo en pantalla. Un `ApiError` trae
 * el `message` del backend (p. ej. el 404 "el documento original de la revisión
 * no está en el volumen de sync"), que es exactamente lo que el supervisor
 * necesita leer para decidir qué hacer; cualquier otro error no tiene un motivo
 * que valga la pena mostrar y se dice sin inventar uno.
 */
function motivoDe(err: unknown): string {
  return err instanceof ApiError ? err.detalle : 'No se pudo completar la operación'
}

/**
 * Fecha corta y estable: `dd/mm hh:mm`, sin `toLocaleString`. El supervisor
 * contrasta esta columna contra la fecha del libro que descarga, y dos máquinas
 * con locales distintos no pueden decir la misma hora de dos formas.
 */
function fechaCorta(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function Dashboard() {
  const { usuario, identidad, online } = useEstado()
  const [periodo, setPeriodo] = useState<Periodo>('7 días')
  const [faena, setFaena] = useState<string>('todas')
  const [sevFiltro, setSevFiltro] = useState<Severidad | 'todas'>('todas')
  const [autor, setAutor] = useState<string>('todos')
  /* TSK-REP-007: rango libre, filtros propios de la lista y selección para exportar. */
  const [rango, setRango] = useState<RangoFechas>({ desde: '', hasta: '' })
  const [formularioFiltro, setFormularioFiltro] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [autorInsp, setAutorInsp] = useState('')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [formularios, setFormularios] = useState<Map<string, string>>(new Map())
  const [datos, setDatos] = useState<{ summary: DashboardSummary; hallazgos: FindingDto[] } | null>(null)
  const [cargando, setCargando] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  /* FR-044: la lista de inspecciones del período y el error de su descarga
   * llevan estado propio. El listado se lee y se descarga fila a fila, así que
   * su error no puede ser el mismo aviso que tapa el panel entero. */
  const [inspecciones, setInspecciones] = useState<InspectionListaItem[]>([])
  /* TSK-REP-006: los bloques de supervisión van en su propia rama: si fallan, no tapan el resto. */
  const [supervision, setSupervision] = useState<DashboardSupervision | null>(null)
  const [errorInspecciones, setErrorInspecciones] = useState<string | null>(null)
  const [descargandoId, setDescargandoId] = useState<string | null>(null)
  const [errorDescarga, setErrorDescarga] = useState<{ id: string; mensaje: string } | null>(null)
  const [detalleInspeccion, setDetalleInspeccion] = useState<DetalleInspeccion>({ fase: 'inactivo' })
  const reducir = useReducedMotion()

  const esPlataforma = usuario?.rol === 'platform_admin'

  const cargar = useCallback(async () => {
    if (!usuario || esPlataforma) return
    const f = filtrosDe(periodo, faena, rango)
    const fs = {
      ...f,
      severidad: sevFiltro === 'todas' ? undefined : SEV_UI_A_WIRE[sevFiltro],
      autor_id: autor === 'todos' ? undefined : autor,
    }
    setCargando(true)
    setErrorCarga(null)
    /* Las inspecciones van en su propia rama del `Promise.all`: que esta ruta
     * falle no puede tapar las métricas que sí se pudieron leer, y su motivo se
     * dice en su propio bloque. Es un `then` con manejador de rechazo en vez de
     * un `.catch`: así la promesa nunca rechaza y el `Promise.all` siempre
     * resuelve con las métricas. */
    const lista = getInspecciones(f, {
      template_id: formularioFiltro || undefined,
      status: estadoFiltro || undefined,
      autor_id: autorInsp || undefined,
    }).then(
      (r) => {
        setInspecciones(r.items)
        // Los formularios vistos alimentan el filtro (se acumulan: filtrar por uno no borra los demás).
        setFormularios((prev) => {
          const m = new Map(prev)
          for (const i of r.items) if (i.template_nombre) m.set(i.template_id, i.template_nombre)
          return m.size === prev.size ? prev : m
        })
        setErrorInspecciones(null)
      },
      (err: unknown) => {
        setInspecciones([])
        setErrorInspecciones(motivoDe(err))
      },
    )
    const bloques = getSupervision(f).then(setSupervision, () => setSupervision(null))
    try {
      const [summary, hallazgos] = await Promise.all([getSummary(f), getFindings(fs), lista, bloques])
      setDatos({ summary, hallazgos: hallazgos.items })
    } catch (err) {
      if (err instanceof ApiError) {
        // Sin red se dice explícitamente: las métricas en pantalla pueden ser
        // de la última lectura y el supervisor tiene que saberlo.
        setErrorCarga(
          err.status === 0
            ? 'sin conexión con el servidor. Lo que ves es la última lectura; se actualiza al volver la señal.'
            : err.detalle,
        )
      }
    } finally {
      setCargando(false)
    }
  }, [usuario, esPlataforma, periodo, faena, sevFiltro, autor, rango, formularioFiltro, estadoFiltro, autorInsp])

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

  /* Cómo se llama en pantalla el filtro de faena activo. Se calcula una vez y lo
   * usan el `Chip` del bloque y el `alcance` del lote, para que el rótulo del
   * resultado sea el mismo criterio que el del filtro. */
  const nombreFaena =
    faena === 'todas'
      ? 'Todas las faenas'
      : (faenas.find((f) => f.id === faena)?.nombre ?? '1 faena')

  const summary = datos?.summary ?? null
  const hallazgos = datos?.hallazgos ?? []
  /* FR-041: autores con actividad en el período, para el filtro por autor. */
  const autores = summary?.autores ?? []

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
      (faena === 'todas' || h.faena_id === faena) &&
      (autor === 'todos' || h.autor_id === autor),
  )

  /* FR-042: export CSV de lo que está filtrado en pantalla. */
  const exportarCsv = () => {
    if (filtrados.length === 0) return
    const csv = construirCsvHallazgos(filtrados)
    descargarLibro(
      new TextEncoder().encode(csv),
      `hallazgos-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv;charset=utf-8',
    )
  }

  /**
   * FR-044: el supervisor descarga el `.xlsx` que el `tenant_admin` subió, con
   * las respuestas de la inspección y la hoja "Evidencias".
   *
   * El estado de descarga es UN id, no un flag: bloquear toda la tabla mientras
   * se arma un libro de varios MB sería castigar al resto de filas por una
   * acción que es de una sola. Y el error va anclado a la fila que falló, con el
   * motivo REAL del servidor: un 404 acá no es una caída, es "esta inspección no
   * tiene documento original" (una plantilla creada a mano no viene de un
   * import), y ese es el motivo por el que no se puede descargar.
   */
  const descargar = async (i: InspectionListaItem) => {
    setDescargandoId(i.id)
    setErrorDescarga(null)
    try {
      const { bytes, fileName } = await descargarInspeccion(i.id)
      descargarLibro(bytes, fileName)
    } catch (err) {
      setErrorDescarga({ id: i.id, mensaje: motivoDe(err) })
    } finally {
      setDescargandoId(null)
    }
  }

  const revisar = async (i: Pick<InspectionListaItem, 'id'>) => {
    setDetalleInspeccion({ fase: 'cargando', id: i.id })
    try {
      setDetalleInspeccion({ fase: 'ok', detalle: await getDetalleInspeccion(i.id) })
    } catch (err) {
      setDetalleInspeccion({ fase: 'error', id: i.id, mensaje: motivoDe(err) })
    }
  }

  /* La selección se limpia al cambiar el filtro: elegir y luego filtrar otra
   * cosa exportaría inspecciones que ya no están en pantalla. */
  useEffect(() => {
    setSeleccion(new Set())
  }, [periodo, faena, rango, formularioFiltro, estadoFiltro, autorInsp])

  const alternar = (id: string) =>
    setSeleccion((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const todasMarcadas = inspecciones.length > 0 && inspecciones.every((i) => seleccion.has(i.id))
  const filtrosExport = {
    ...filtrosDe(periodo, faena, rango),
    template_id: formularioFiltro || undefined,
    status: (estadoFiltro || undefined) as 'submitted' | 'reviewed' | 'in_progress' | 'draft' | undefined,
    autor_id: autorInsp || undefined,
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-inst">Gerencia</p>
          <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
            {esPlataforma ? 'Operación Plataforma' : identidad?.tenantNombre ?? '—'}
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-2">
            {esPlataforma
              ? 'Todas las empresas'
              : 'Lo que tu equipo ha enviado desde terreno'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro de periodo: knob con layout. Acción manual y rara. */}
          <div className="flex flex-wrap p-1 rounded-xl bg-s1 border border-line-soft">
            {PERIODOS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={[
                  'relative h-8 px-3 rounded-lg text-[12px] font-mono tracking-[0.04em] cursor-pointer',
                  'transition-colors duration-150 ease-out',
                  periodo === p ? 'text-on-beam' : 'text-ink-3 hover:text-ink-2',
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
          {periodo === 'Rango' && (
            <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
              <input
                type="date"
                aria-label="Desde"
                value={rango.desde}
                max={rango.hasta || undefined}
                onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))}
                className="h-9 px-2 rounded-lg bg-s1 border border-line-soft text-[12px] text-ink"
              />
              a
              <input
                type="date"
                aria-label="Hasta"
                value={rango.hasta}
                min={rango.desde || undefined}
                onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))}
                className="h-9 px-2 rounded-lg bg-s1 border border-line-soft text-[12px] text-ink"
              />
            </div>
          )}
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
          <p className="text-[14px] font-semibold tracking-[-0.01em]">Este panel es de cada empresa</p>
          <p className="mt-2 text-[13px] text-ink-2 leading-relaxed">
            Tu cuenta administra la plataforma y no pertenece a ninguna empresa, así que no hay
            datos de terreno que mostrar. Ingresa con una cuenta de supervisión o de administración
            de una empresa para ver su panel.
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
                  No se pudieron actualizar los datos: {errorCarga}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Fila de métricas ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metrica
              etiqueta="Por revisar"
              valor={supervision?.revision.pendientes ?? null}
              pie={
                supervision?.revision.dias_mas_antigua != null
                  ? `la más antigua: ${Math.floor(supervision.revision.dias_mas_antigua)} d`
                  : 'inspecciones enviadas'
              }
              destacado
            />
            <Metrica
              etiqueta="Procesamiento p95"
              valor={supervision?.sincronizacion.procesamiento_p95_seg != null ? Math.round(supervision.sincronizacion.procesamiento_p95_seg) : null}
              sufijo=" s"
              pie={
                supervision?.sincronizacion.muestras_espera
                  ? `espera sin señal p95: ${duracion(supervision.sincronizacion.espera_sin_senal_p95_seg)}`
                  : 'objetivo: 60 s por lote'
              }
            />
            <Metrica
              etiqueta="Hallazgos urgentes"
              valor={summary?.hallazgos_urgentes ?? null}
              pie={`${summary?.hallazgos_total ?? 0} hallazgos registrados`}
              destacado={summary?.hallazgos_urgentes ? true : undefined}
            />
            <Metrica etiqueta="Inspecciones" valor={totalInsp} pie={`${enCurso} en curso ahora`} />
          </div>

          {supervision && (
            <BloquesSupervision datos={supervision} onRevisar={(id) => void revisar({ id })} />
          )}

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
                    sincronizarse.
                  </p>
                </section>
              </div>

              {/* ── Filtros (FR-041) ─────────────────────────────────────── */}
              <section className="space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="label-inst">Filtros</h2>
                  <div className="flex-1 rule" />
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
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

                  {/* FR-041: filtro por autor. Sólo se ofrecen los autores con
                      actividad en el período filtrado: una lista con todos los
                      usuarios del tenant llenaría de opciones que no traen nada. */}
                  <div className="space-y-2">
                    <p className="label-inst">Autor</p>
                    <Tarjeta activa={autor === 'todos'} onClick={() => setAutor('todos')}>
                      <span className="text-[13px] font-medium">Todos los autores</span>
                    </Tarjeta>
                    {autores.map((a) => (
                      <Tarjeta key={a.id} activa={autor === a.id} onClick={() => setAutor(a.id)}>
                        <span className="text-[13px] font-medium truncate">{a.nombre}</span>
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
                    key={`${faena}-${sevFiltro}-${autor}-${periodo}`}
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
                      filtrados.map((h) => <FilaHallazgo key={h.id} h={h} onCambio={() => void cargar()} />)
                    )}
                  </motion.div>
                </AnimatePresence>
              </section>

              {/* ── Inspecciones del período (FR-044) ──────────────────────
               *  Usa los MISMOS filtros de período y faena que el resto del
               *  panel: lo que descarga el supervisor es el período que está
               *  mirando, no un rango nuevo. No lleva filtro por severidad
               *  porque la severidad es de los hallazgos, no de la inspección.
               *  La descarga la genera el SERVIDOR (mismo módulo que el
               *  dispositivo, ADR-003): acá no se reescribe ningún `.xlsx`. */}
              <section className="space-y-2.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="label-inst">
                    Inspecciones del período · {inspecciones.length}
                  </h2>
                  <div className="flex-1 rule" />
                  <Chip>{nombreFaena}</Chip>
                  <Chip>{periodo}</Chip>
                </div>

                {/* TSK-REP-007: filtros propios de la lista (además de período y faena). */}
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <select aria-label="Formulario" value={formularioFiltro} onChange={(e) => setFormularioFiltro(e.target.value)} className={SELECT_FILTRO}>
                    <option value="">Todos los formularios</option>
                    {[...formularios].sort((a, b) => a[1].localeCompare(b[1], 'es')).map(([id, nombre]) => (
                      <option key={id} value={id}>{nombre}</option>
                    ))}
                  </select>
                  <select aria-label="Estado" value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)} className={SELECT_FILTRO}>
                    <option value="">Todos los estados</option>
                    <option value="submitted">Enviadas</option>
                    <option value="reviewed">Revisadas</option>
                    <option value="in_progress">En curso</option>
                  </select>
                  <select aria-label="Autor" value={autorInsp} onChange={(e) => setAutorInsp(e.target.value)} className={SELECT_FILTRO}>
                    <option value="">Todos los autores</option>
                    {autores.map((a) => (
                      <option key={a.id} value={a.id}>{a.nombre}</option>
                    ))}
                  </select>
                </div>

                <PanelExportar
                  filtros={filtrosExport}
                  seleccion={[...seleccion]}
                  totalFiltrado={inspecciones.length}
                  alcance={`${periodo} · ${nombreFaena}`}
                  onLimpiarSeleccion={() => setSeleccion(new Set())}
                />

                {errorInspecciones ? (
                  <div
                    role="alert"
                    className="panel px-4 py-3.5 border-sev-alta/25 bg-sev-alta/10"
                  >
                    <p className="text-[12px] leading-relaxed text-sev-alta">
                      No se pudo leer el listado de inspecciones: {errorInspecciones}
                    </p>
                  </div>
                ) : inspecciones.length === 0 ? (
                  <div className="panel p-8 text-center">
                    <p className="text-[13px] text-ink-2">
                      {cargando
                        ? 'Cargando inspecciones…'
                        : 'Ninguna inspección capturada en este período.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Cabecera y filas comparten `GRID_INSPECCION`: si divergieran,
                        los rótulos dejarían de calzar con las columnas. */}
                    <div className="overflow-x-auto">
                      <div className={GRID_INSPECCION}>
                        <input
                          type="checkbox"
                          aria-label="Elegir todas las de la lista"
                          checked={todasMarcadas}
                          onChange={() => setSeleccion(todasMarcadas ? new Set() : new Set(inspecciones.map((i) => i.id)))}
                        />
                        {['Faena', 'Plantilla', 'Ejecutado por', 'Estado', 'Resp.', 'Fecha', ''].map(
                          (h) => (
                            <span key={h} className="label-inst">
                              {h}
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                    {inspecciones.map((i) => (
                      <FilaInspeccion
                        key={i.id}
                        i={i}
                        descargando={descargandoId === i.id}
                        error={errorDescarga?.id === i.id ? errorDescarga.mensaje : null}
                        onDescargar={descargar}
                        revisando={detalleInspeccion.fase === 'cargando' && detalleInspeccion.id === i.id}
                        onRevisar={revisar}
                        seleccionada={seleccion.has(i.id)}
                        onSeleccionar={() => alternar(i.id)}
                      />
                    ))}
                  </div>
                )}
                {detalleInspeccion.fase !== 'inactivo' && (
                  <PanelDetalleInspeccion
                    estado={detalleInspeccion}
                    puedeCofirmar={usuario?.rol === 'supervisor' || usuario?.rol === 'tenant_admin'}
                    onCerrar={() => setDetalleInspeccion({ fase: 'inactivo' })}
                    onRevisada={() => {
                      if (detalleInspeccion.fase === 'ok') {
                        setDetalleInspeccion({
                          fase: 'ok',
                          detalle: { ...detalleInspeccion.detalle, status: 'reviewed' },
                        })
                      }
                      void cargar()
                    }}
                    onCofirmada={() => void cargar()}
                  />
                )}
              </section>
            </>
          )}

          <p className="text-[13px] text-ink-3 leading-relaxed border-t border-line-soft pt-4">
            Sólo {identidad?.tenantNombre ?? 'tu empresa'} puede ver estos datos. Se actualizan
            solos cada 30 segundos.
            {!online && ' Sin señal: estás viendo la última lectura.'}
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

/**
 * Columnas de la tabla de inspecciones: cabecera y filas usan esta misma
 * plantilla. Es una sola línea declarativa justamente para que no puedan
 * desalinearse — el rótulo "Resp." tiene que caer sobre el número.
 *
 * El `min-w` con scroll horizontal es a propósito: es una vista de supervisor
 * (pantalla ancha, uso de escritorio) y apilar la fila en móvil convertiría
 * seis datos en una pared de etiquetas repetidas.
 */
const SELECT_FILTRO = 'h-9 px-2 rounded-lg bg-s1 border border-line-soft text-[12px] max-w-[220px]'

const GRID_INSPECCION = [
  'grid items-center gap-3 min-w-[870px]',
  'grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_7rem_4.5rem_6rem_auto]',
].join(' ')

/**
 * Fila de una inspección con su acción de descarga.
 *
 * El estado de la descarga vive en la fila (y no en la tabla) porque la acción
 * es de una sola inspección: mientras se arma un libro, las demás filas siguen
 * siendo utilizables. El motivo del fallo se muestra AQUÍ y no en un aviso
 * general, porque un 404 aquí significa algo concreto —"este registro no tiene
 * documento original que rellenar"— y sólo la fila lo sabe.
 */
function FilaInspeccion({
  i,
  descargando,
  error,
  onDescargar,
  revisando,
  onRevisar,
  seleccionada,
  onSeleccionar,
}: {
  i: InspectionListaItem
  descargando: boolean
  error: string | null
  onDescargar: (i: InspectionListaItem) => void
  revisando: boolean
  onRevisar: (i: InspectionListaItem) => void
  seleccionada: boolean
  onSeleccionar: () => void
}) {
  const meta = ESTADO_META[i.status]
  /* `template_nombre` a `null` = la plantilla se borró. El registro se conserva
   * para auditoría, pero no hay revisión ni original desde los que reconstruir
   * un .xlsx. Dejar la acción activa garantiza un 404 evitable y parece un
   * fallo operativo, por eso se explica y se deshabilita desde el listado. */
  const sinPlantilla = i.template_nombre === null

  return (
    <div className="panel px-4 py-3">
      <div className={GRID_INSPECCION}>
        <input type="checkbox" aria-label={`Elegir inspección de ${i.faena_nombre}`} checked={seleccionada} onChange={onSeleccionar} />
        <span className="text-[13px] truncate">{i.faena_nombre}</span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium truncate">
            {i.template_nombre ?? 'Plantilla no disponible'}
          </p>
          <p className="label-inst">
            versión {i.template_version}
            {i.respuestas === 0 && ' · sin respuestas'}
          </p>
        </div>
        <span className="text-[13px] truncate">{i.ejecutado_por}</span>
        <span>
          <Chip color={meta.color}>{meta.label}</Chip>
        </span>
        <span className="num-inst text-[13px]">{i.respuestas}</span>
        <span className="num-inst text-[13px] text-ink-2">{fechaCorta(i.captured_at)}</span>
        <div className="flex items-center justify-end gap-2">
          <Boton tamano="sm" variante="fantasma" disabled={revisando} aria-busy={revisando} onClick={() => onRevisar(i)}>
            {revisando ? 'Abriendo…' : 'Revisar'}
          </Boton>
          <Boton
            tamano="sm"
            variante="secundaria"
            disabled={sinPlantilla || descargando}
            aria-busy={descargando}
            aria-describedby={sinPlantilla ? `inspeccion-${i.id}-sin-plantilla` : undefined}
            onClick={() => onDescargar(i)}
            icono={
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M7 1.8v7.4M4.2 6.6 7 9.4l2.8-2.8"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M2.2 11.4h9.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            }
          >
            {sinPlantilla ? 'No disponible' : descargando ? 'Generando…' : 'Descargar'}
          </Boton>
        </div>
      </div>

      {sinPlantilla && (
        <p id={`inspeccion-${i.id}-sin-plantilla`} className="mt-2 text-[11px] text-ink-3 leading-relaxed">
          El formulario de esta inspección ya no existe, así que no hay planilla original que
          rellenar. La inspección se conserva y se puede exportar desde el panel de exportación.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12px] font-medium text-failed leading-relaxed">
          No se pudo descargar: {error}
        </p>
      )}
    </div>
  )
}

function textoRespuesta(valor: InspectionDetalle['secciones'][number]['respuestas'][number]['value']): string {
  if (valor === null) return 'Sin respuesta'
  if (Array.isArray(valor)) return valor.join(' · ')
  if (valor === 'capturada') return 'Foto capturada'
  if (valor === 'ok' || valor === 'nok' || valor === 'na') return valor.toUpperCase()
  return String(valor)
}

function PanelDetalleInspeccion({
  estado,
  puedeCofirmar,
  onCerrar,
  onRevisada,
  onCofirmada,
}: {
  estado: Exclude<DetalleInspeccion, { fase: 'inactivo' }>
  puedeCofirmar: boolean
  onCerrar: () => void
  onRevisada: () => void
  onCofirmada: () => void
}) {
  const detalle = estado.fase === 'ok' ? estado.detalle : null
  const [revisando, setRevisando] = useState(false)
  const [errorRevision, setErrorRevision] = useState<string | null>(null)
  const [firmando, setFirmando] = useState(false)
  const [cofirmando, setCofirmando] = useState(false)
  /* FR-031 (TSK-DOM-005): la supervisión cierra el ciclo de la inspección. */
  const revisar = async () => {
    if (!detalle) return
    setRevisando(true)
    setErrorRevision(null)
    try {
      await revisarInspeccion(detalle.id)
      onRevisada()
    } catch (err) {
      setErrorRevision(motivoDe(err))
    } finally {
      setRevisando(false)
    }
  }
  const cofirmar = async (strokes: Array<{ points: Array<{ x: number; y: number }> }>) => {
    if (!detalle) return
    setCofirmando(true)
    setErrorRevision(null)
    try {
      await cofirmarInspeccion(detalle.id, strokes)
      setFirmando(false)
      onCofirmada()
    } catch (err) {
      setErrorRevision(motivoDe(err))
    } finally {
      setCofirmando(false)
    }
  }
  const tieneFirma = (rol: 'inspector' | 'supervisor') => detalle?.signatures.some((firma) => firma.signer_role === rol) ?? false
  return (
    <section className="mt-4 panel p-5" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-inst">Revisión de respuestas</p>
          <h3 className="mt-1 text-[17px] font-semibold">
            {detalle?.template_nombre ?? 'Inspección seleccionada'}
          </h3>
          {detalle && (
            <p className="mt-1 text-[13px] text-ink-2">
              Respondida por <strong className="text-ink">{detalle.ejecutado_por}</strong> · {detalle.faena_nombre} · {fechaCorta(detalle.captured_at)}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {detalle?.status === 'submitted' && detalle.requires_supervisor_signature && !tieneFirma('supervisor') && puedeCofirmar && (
            <Boton tamano="sm" variante="secundaria" disabled={cofirmando} onClick={() => setFirmando(true)}>
              {cofirmando ? 'Guardando…' : 'Cofirmar'}
            </Boton>
          )}
          {detalle?.status === 'submitted' && (
            <Boton tamano="sm" variante="primaria" disabled={revisando} onClick={() => void revisar()}>
              {revisando ? 'Guardando…' : 'Marcar como revisada'}
            </Boton>
          )}
          {detalle?.status === 'reviewed' && <span className="self-center text-[13px] text-synced">Revisada</span>}
          <Boton tamano="sm" variante="fantasma" onClick={onCerrar}>Cerrar</Boton>
        </div>
      </div>
      {errorRevision && <p role="alert" className="mt-3 text-[13px] text-failed">{errorRevision}</p>}

      {detalle && (
        <div className="mt-4 rounded-xl border border-line-soft bg-s0 px-3.5 py-3">
          <p className="label-inst">Firmas de cierre</p>
          {detalle.signatures.length === 0 ? (
            <p className="mt-1 text-[12px] text-ink-3">Aún no hay firmas sincronizadas.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {detalle.signatures.map((firma) => (
                <p key={firma.signer_role} className="text-[12px] text-ink-2">
                  <span className="font-medium text-ink">{firma.signer_role === 'inspector' ? 'Inspector' : 'Supervisor'}:</span>{' '}
                  {firma.signer_name} · {fechaCorta(firma.signed_at)} · hash {firma.content_hash.slice(0, 12)}…
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {estado.fase === 'cargando' && <p className="mt-4 text-[13px] text-ink-2">Cargando respuestas…</p>}
      {estado.fase === 'error' && <p role="alert" className="mt-4 text-[13px] text-failed">No se pudo abrir: {estado.mensaje}</p>}
      {detalle && (
        <div className="mt-5 space-y-4">
          {detalle.secciones.map((seccion) => (
            <div key={seccion.title}>
              <p className="label-inst mb-2">{seccion.title}</p>
              <div className="divide-y divide-line-soft rounded-xl border border-line-soft bg-s0">
                {seccion.respuestas.map((respuesta) => (
                  <div key={respuesta.id} className="flex flex-wrap items-start justify-between gap-3 px-3.5 py-3">
                    <span className="text-[13px] text-ink-2 max-w-[62ch]">{respuesta.prompt}</span>
                    <span className={['text-[13px] font-medium', respuesta.value === null ? 'text-ink-3' : 'text-ink'].join(' ')}>
                      {textoRespuesta(respuesta.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {firmando && (
        <FirmaCierre
          modo="supervisor"
          onCancelar={() => setFirmando(false)}
          onConfirmar={(strokes) => void cofirmar(strokes)}
        />
      )}
    </section>
  )
}

function FilaHallazgo({ h, onCambio }: { h: FindingDto; onCambio: () => void }) {
  const [estado, setEstado] = useState(h.status)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setEstado(h.status), [h.status])
  /* FR-032 (TSK-DOM-005): la supervisión mueve el hallazgo por su ciclo. */
  const cambiar = async (nuevo: FindingDto['status']) => {
    const previo = estado
    setEstado(nuevo)
    setError(null)
    try {
      await cambiarEstadoHallazgo(h.id, nuevo)
      onCambio()
    } catch (err) {
      setEstado(previo)
      setError(motivoDe(err))
    }
  }
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
        <label className="label-inst block" htmlFor={`estado-${h.id}`}>
          Estado
        </label>
        <select
          id={`estado-${h.id}`}
          value={estado}
          onChange={(e) => void cambiar(e.target.value as FindingDto['status'])}
          className="mt-1 h-11 px-2 rounded-[10px] bg-s1 border border-line-soft text-[13px]"
        >
          <option value="open">Abierto</option>
          <option value="in_progress">En curso</option>
          <option value="resolved">Resuelto</option>
        </select>
        {error && <p role="alert" className="mt-1 text-[12px] text-failed max-w-[20ch]">{error}</p>}
      </div>
    </motion.div>
  )
}
