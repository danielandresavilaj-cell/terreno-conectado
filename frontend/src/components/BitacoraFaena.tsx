/* Bitácora de la faena leída desde el servidor — TSK-REP-009 (FR-033/063).
 *
 * Lo que otras personas escribieron: el relevo del turno anterior para quien
 * entra, y la vista de supervisión. Necesita señal; sin ella lo dice en vez de
 * mostrar una lista vacía que parezca "no pasó nada".
 *
 * TSK-REP-019: con `conFiltros`, Gerencia filtra por etiqueta (Relevo, Clima,
 * Incidencia…) y por autor. Las opciones las entrega el servidor según el
 * período y la faena, y filtrar cambia el total y la paginación en el servidor.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { BitacoraEntradaDto, BitacoraResponse } from '@terreno/shared'
import { ApiError, getBitacora } from '../lib/api'
import { TANDA_LISTADO } from '../lib/listas-progresivas'
import { ControlesListado } from './ControlesListado'
import { Boton } from './ui'

const FECHA = new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })
const HORA = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' })

type Estado =
  | { fase: 'cargando' }
  | { fase: 'error'; mensaje: string }
  | { fase: 'ok'; items: BitacoraEntradaDto[]; total: number }

export function BitacoraFaena({
  faenaId,
  desde,
  hasta,
  online,
  limite = TANDA_LISTADO,
  mostrarFaena = false,
  conFiltros = false,
}: {
  /** `null` = todas las faenas de la empresa. */
  faenaId: string | null
  desde?: string
  hasta?: string
  online: boolean
  limite?: number
  mostrarFaena?: boolean
  conFiltros?: boolean
}) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })
  const [etiqueta, setEtiqueta] = useState('')
  const [autor, setAutor] = useState('')
  const [opciones, setOpciones] = useState<Pick<BitacoraResponse, 'etiquetas' | 'autores'>>({ etiquetas: [], autores: [] })
  const filtros = { site_id: faenaId, desde, hasta, etiqueta: etiqueta || null, autor_id: autor || null }
  const [cargandoMas, setCargandoMas] = useState(false)
  const [errorMas, setErrorMas] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!online) {
      setEstado({ fase: 'error', mensaje: 'Sin señal: la bitácora de la faena se ve cuando vuelva la conexión.' })
      return
    }
    setCargandoMas(false)
    setErrorMas(null)
    setEstado({ fase: 'cargando' })
    try {
      const r = await getBitacora({ site_id: faenaId, desde, hasta, etiqueta: etiqueta || null, autor_id: autor || null, limit: limite })
      setEstado({ fase: 'ok', items: r.items, total: r.total })
      setOpciones({ etiquetas: r.etiquetas ?? [], autores: r.autores ?? [] })
    } catch (err) {
      setEstado({
        fase: 'error',
        mensaje: err instanceof ApiError ? err.detalle : 'No se pudo leer la bitácora.',
      })
    }
  }, [faenaId, desde, hasta, etiqueta, autor, limite, online])

  /* Si cambia el período o la faena y la etiqueta o el autor elegidos ya no
   * existen ahí, se vuelve a "todas" para no dejar un filtro invisible. */
  useEffect(() => {
    if (etiqueta && !opciones.etiquetas.some((e) => e.etiqueta === etiqueta)) setEtiqueta('')
    if (autor && !opciones.autores.some((a) => a.id === autor)) setAutor('')
  }, [opciones, etiqueta, autor])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cargarMas = useCallback(async () => {
    if (estado.fase !== 'ok' || cargandoMas || estado.items.length >= estado.total) return
    setCargandoMas(true)
    setErrorMas(null)
    try {
      const r = await getBitacora({ ...filtros, limit: limite, offset: estado.items.length })
      setEstado((prev) => {
        if (prev.fase !== 'ok') return prev
        const existentes = new Set(prev.items.map((item) => item.id))
        return {
          fase: 'ok',
          items: [...prev.items, ...r.items.filter((item) => !existentes.has(item.id))],
          total: r.total,
        }
      })
    } catch (err) {
      setErrorMas(err instanceof ApiError ? err.detalle : 'No se pudieron cargar más entradas.')
    } finally {
      setCargandoMas(false)
    }
    // `filtros` se arma con estos mismos valores en cada render.
  }, [cargandoMas, estado, faenaId, desde, hasta, etiqueta, autor, limite])

  const mostrarMenos = () => {
    setEstado((prev) =>
      prev.fase === 'ok' ? { ...prev, items: prev.items.slice(0, limite) } : prev,
    )
    setErrorMas(null)
  }

  const hayFiltro = Boolean(etiqueta || autor)
  const barra =
    conFiltros && (opciones.etiquetas.length > 0 || opciones.autores.length > 1 || hayFiltro) ? (
      <FiltrosBitacora
        etiquetas={opciones.etiquetas}
        autores={opciones.autores}
        etiqueta={etiqueta}
        autor={autor}
        onEtiqueta={setEtiqueta}
        onAutor={setAutor}
      />
    ) : null
  const conBarra = (contenido: ReactNode) =>
    barra ? (
      <div className="space-y-2.5">
        {barra}
        {contenido}
      </div>
    ) : (
      contenido
    )

  if (estado.fase === 'cargando') {
    return conBarra(<p className="panel p-5 text-[14px] text-ink-2" role="status">Leyendo la bitácora…</p>)
  }
  if (estado.fase === 'error') {
    return conBarra(
      <div className="panel p-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-ink-2" role="status">{estado.mensaje}</p>
        {online && (
          <Boton tamano="sm" variante="secundaria" onClick={() => void cargar()}>
            Reintentar
          </Boton>
        )}
      </div>,
    )
  }
  if (estado.items.length === 0) {
    return conBarra(
      <p className="panel p-5 text-[14px] text-ink-2">
        {hayFiltro ? 'Ninguna entrada con estos filtros en el período.' : 'Nadie ha escrito en la bitácora en este período.'}
      </p>,
    )
  }
  return (
    <div className="space-y-2.5">
      {barra}
      {estado.items.map((e) => {
        const fecha = new Date(e.captured_at)
        return (
          <article key={e.id} className="panel p-4 flex gap-4">
            <div className="shrink-0 w-[64px] text-right">
              <p className="num-inst text-[15px] font-semibold">{HORA.format(fecha)}</p>
              <p className="mt-0.5 text-[12px] text-ink-3">{FECHA.format(fecha)}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-relaxed whitespace-pre-line break-words">{e.texto}</p>
              {e.tags.length > 0 && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {e.tags.map((t) => (
                    <span
                      key={t}
                      className="h-6 px-2 rounded-md bg-s3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2 grid place-items-center"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-2.5 text-[13px] text-ink-2">
                {e.autor}
                {mostrarFaena && ` · ${e.faena_nombre}`}
              </p>
            </div>
          </article>
        )
      })}
      <ControlesListado
        mostrados={estado.items.length}
        total={estado.total}
        paso={limite}
        cargando={cargandoMas}
        onVerMas={() => void cargarMas()}
        onMostrarMenos={mostrarMenos}
      />
      {errorMas && <p role="alert" className="text-[12px] text-sev-alta">{errorMas}</p>}
    </div>
  )
}

/** TSK-REP-019: etiquetas como botones (con su cantidad) y autor como selector. */
function FiltrosBitacora({
  etiquetas,
  autores,
  etiqueta,
  autor,
  onEtiqueta,
  onAutor,
}: {
  etiquetas: BitacoraResponse['etiquetas']
  autores: BitacoraResponse['autores']
  etiqueta: string
  autor: string
  onEtiqueta: (v: string) => void
  onAutor: (v: string) => void
}) {
  const boton = (valor: string, texto: string, n?: number) => {
    const activo = etiqueta === valor
    return (
      <button
        key={valor || 'todas'}
        type="button"
        aria-pressed={activo}
        onClick={() => onEtiqueta(valor)}
        className={[
          'min-h-11 px-3 rounded-lg border text-[13px] font-medium cursor-pointer whitespace-nowrap transition-colors',
          activo ? 'border-beam bg-beam/10 text-beam' : 'border-line text-ink-2 hover:text-ink hover:bg-s3',
        ].join(' ')}
      >
        {texto}
        {n !== undefined && <span className="ml-1.5 num-inst text-[12px] opacity-70">{n}</span>}
      </button>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros de la bitácora">
      {etiquetas.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Etiqueta">
          {boton('', 'Todas')}
          {etiquetas.map((e) => boton(e.etiqueta, e.etiqueta, e.n))}
        </div>
      )}
      {autores.length > 1 && (
        <select
          aria-label="Autor de la bitácora"
          value={autor}
          onChange={(e) => onAutor(e.target.value)}
          className="h-11 px-2 rounded-lg bg-s1 border border-line-soft text-[13px] max-w-[220px]"
        >
          <option value="">Todos los autores</option>
          {autores.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre} ({a.n})
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
