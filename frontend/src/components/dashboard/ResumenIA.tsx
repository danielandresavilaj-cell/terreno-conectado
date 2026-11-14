/* Resumen de Gerencia con IA — TSK-REP-014 (FR-068, Enmienda 009).
 *
 * Al abrir Gerencia se consulta el último resumen GUARDADO del filtro actual
 * (faena + período): si existe, se muestra al instante y sin gastar. El botón
 * aparece sólo cuando aporta:
 *   · "Resumir con IA" si todavía no hay resumen para ese filtro;
 *   · "Actualizar resumen" si llegaron datos nuevos desde que se redactó.
 * La IA sólo recibe cifras agregadas (ADR-005, Enmienda 1) y el texto va
 * marcado "generado con IA". Debajo, "Resúmenes anteriores" lista los
 * guardados (se cargan al abrirlo).
 *
 * · Sin IA en el servidor se ven los guardados, pero no se piden nuevos.
 * · Sin red, el botón queda deshabilitado y lo dice: el resto del panel sigue.
 * · Al cambiar el filtro, Gerencia vuelve a montar el bloque (prop `key`).
 */
import { useEffect, useState } from 'react'
import type { EstadoResumenIA, ResumenIA as ResumenIADto } from '@terreno/shared'
import { ApiError, consultarResumenIA, getHistorialResumenIA, pedirResumenIA, type DashboardFiltros } from '../../lib/api'
import { cuandoSeGenero, etiquetaPeriodo, pieResumenIA, restantesTras, vistaResumenIA } from '../../lib/resumen-ia'
import { Boton } from '../ui'

function Contenido({ r }: { r: ResumenIADto }) {
  return (
    <>
      <ul className="space-y-1.5">
        {r.puntos.map((p, i) => (
          <li key={i} className="flex gap-2 text-[14px] leading-relaxed text-ink-2">
            <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-beam" aria-hidden />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      {r.atencion && (
        <p className="rounded-lg border border-beam/35 bg-beam-glow px-3 py-2 text-[14px] leading-relaxed">
          <span className="font-semibold">Atención: </span>
          {r.atencion}
        </p>
      )}
    </>
  )
}

export function ResumenIA({ filtros, online, alcance }: { filtros: DashboardFiltros; online: boolean; alcance: string }) {
  const [estado, setEstado] = useState<EstadoResumenIA | null>(null)
  const [resumen, setResumen] = useState<ResumenIADto | null>(null)
  const [pidiendo, setPidiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historial, setHistorial] = useState<ResumenIADto[] | null>(null)

  useEffect(() => {
    if (!online) return
    let vivo = true
    consultarResumenIA(filtros).then(
      ({ guardado, ...e }) => {
        if (!vivo) return
        setEstado(e)
        setResumen(guardado)
      },
      () => vivo && setEstado(null),
    )
    return () => {
      vivo = false
    }
    // Se consulta al montar (y al volver la señal): un filtro nuevo llega con
    // otra `key` desde Gerencia, así que `filtros` no es dependencia.
  }, [online])

  const vista = vistaResumenIA(estado, resumen, online, pidiendo)
  if (!vista.visible || !estado) return null

  const pedir = async () => {
    setPidiendo(true)
    setError(null)
    try {
      const r = await pedirResumenIA(filtros)
      setResumen(r)
      setEstado((e) => (e ? restantesTras(e, r) : e))
      // Si el historial ya estaba cargado (abierto), se recarga para sumar el
      // resumen anterior; si no, se pedirá al abrirlo.
      if (historial !== null) {
        getHistorialResumenIA(filtros.site_id).then(
          (h) => setHistorial(h.items),
          () => setHistorial([]),
        )
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 0 ? 'Sin conexión con el servidor. Vuelve a intentarlo con señal.' : err.detalle)
        if (err.status === 429) setEstado((e) => (e ? { ...e, restantes_hoy: 0 } : e))
      } else {
        setError('No se pudo pedir el resumen. Vuelve a intentarlo.')
      }
    } finally {
      setPidiendo(false)
    }
  }

  const abrirHistorial = (abierto: boolean) => {
    if (!abierto || historial !== null || !online) return
    getHistorialResumenIA(filtros.site_id).then(
      (h) => setHistorial(h.items),
      () => setHistorial([]),
    )
  }

  const anteriores = (historial ?? []).filter((h) => h.id !== resumen?.id)

  return (
    <section className="panel p-4" aria-labelledby="titulo-resumen-ia" aria-busy={pidiendo}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="titulo-resumen-ia" className="text-[14px] font-semibold tracking-[-0.015em]">
            Resumen del período
          </h2>
          <p className="text-[13px] text-ink-2">{alcance}</p>
        </div>
        {vista.accion && (
          <Boton
            variante={vista.accion === 'actualizar' ? 'fantasma' : 'secundaria'}
            tamano="sm"
            onClick={() => void pedir()}
            disabled={!vista.puedePedir}
            icono={
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8l5.1-1.4L8 1.5Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            }
          >
            {pidiendo ? 'Redactando…' : vista.accion === 'actualizar' ? 'Actualizar resumen' : 'Resumir con IA'}
          </Boton>
        )}
      </div>

      {vista.motivo && <p className="mt-3 text-[13px] text-ink-2">{vista.motivo}</p>}

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-failed/35 bg-failed/10 px-3 py-2 text-[13px] text-failed">
          {error}
        </p>
      )}

      {resumen && (
        <div className="mt-4 space-y-3" aria-live="polite">
          {resumen.desactualizado && (
            <p className="text-[13px] text-sev-media">
              Llegaron datos nuevos desde este resumen. Las cifras del panel ya están al día; el texto, no.
            </p>
          )}
          <p className="text-[16px] font-semibold leading-snug tracking-[-0.015em]">{resumen.titular}</p>
          <Contenido r={resumen} />
          <p className="text-[12px] leading-relaxed text-ink-3">
            {pieResumenIA(resumen, estado.disponible ? estado.restantes_hoy : null)}
          </p>
        </div>
      )}

      <details className="mt-4 border-t border-line-soft pt-3" onToggle={(e) => abrirHistorial(e.currentTarget.open)}>
        <summary className="cursor-pointer text-[13px] font-medium text-ink-2 hover:text-ink min-h-11 flex items-center">
          Resúmenes anteriores
        </summary>
        {historial === null ? (
          <p className="text-[13px] text-ink-3">{online ? 'Cargando…' : 'El historial necesita conexión.'}</p>
        ) : anteriores.length === 0 ? (
          <p className="text-[13px] text-ink-3">Todavía no hay otros resúmenes guardados.</p>
        ) : (
          <ul className="space-y-2">
            {anteriores.map((h) => (
              <li key={h.id}>
                <details className="rounded-lg border border-line-soft bg-s2 px-3 py-2">
                  <summary className="cursor-pointer list-none">
                    <span className="block text-[12px] text-ink-3">
                      {etiquetaPeriodo(h.desde, h.hasta)} · {h.faena} · {cuandoSeGenero(h.generado_en)}
                    </span>
                    <span className="block text-[14px] font-medium leading-snug">{h.titular}</span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    <Contenido r={h} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  )
}
