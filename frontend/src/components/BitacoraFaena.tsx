/* Bitácora de la faena leída desde el servidor — TSK-REP-009 (FR-033/063).
 *
 * Lo que otras personas escribieron: el relevo del turno anterior para quien
 * entra, y la vista de supervisión. Necesita señal; sin ella lo dice en vez de
 * mostrar una lista vacía que parezca "no pasó nada".
 */
import { useCallback, useEffect, useState } from 'react'
import type { BitacoraEntradaDto } from '@terreno/shared'
import { ApiError, getBitacora } from '../lib/api'
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
  limite = 30,
  mostrarFaena = false,
}: {
  /** `null` = todas las faenas de la empresa. */
  faenaId: string | null
  desde?: string
  hasta?: string
  online: boolean
  limite?: number
  mostrarFaena?: boolean
}) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })

  const cargar = useCallback(async () => {
    if (!online) {
      setEstado({ fase: 'error', mensaje: 'Sin señal: la bitácora de la faena se ve cuando vuelva la conexión.' })
      return
    }
    setEstado({ fase: 'cargando' })
    try {
      const r = await getBitacora({ site_id: faenaId, desde, hasta, limit: limite })
      setEstado({ fase: 'ok', items: r.items, total: r.total })
    } catch (err) {
      setEstado({
        fase: 'error',
        mensaje: err instanceof ApiError ? err.detalle : 'No se pudo leer la bitácora.',
      })
    }
  }, [faenaId, desde, hasta, limite, online])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (estado.fase === 'cargando') {
    return <p className="panel p-5 text-[14px] text-ink-2" role="status">Leyendo la bitácora…</p>
  }
  if (estado.fase === 'error') {
    return (
      <div className="panel p-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-ink-2" role="status">{estado.mensaje}</p>
        {online && (
          <Boton tamano="sm" variante="secundaria" onClick={() => void cargar()}>
            Reintentar
          </Boton>
        )}
      </div>
    )
  }
  if (estado.items.length === 0) {
    return <p className="panel p-5 text-[14px] text-ink-2">Nadie ha escrito en la bitácora en este período.</p>
  }
  return (
    <div className="space-y-2.5">
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
      {estado.total > estado.items.length && (
        <p className="text-[13px] text-ink-3">
          Se muestran las {estado.items.length} más recientes de {estado.total}.
        </p>
      )}
    </div>
  )
}
