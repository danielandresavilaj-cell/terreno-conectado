/* Hallazgos asignados — TSK-DOM-008 (FR-067).
 *
 * La persona responsable de un hallazgo se entera acá: ve los que le asignaron
 * (también sin señal, desde la última lista que llegó), los empieza y reporta
 * lo que hizo. No los resuelve: supervisión verifica y cierra (FR-064).
 *
 * Empezar y reportar necesitan señal (van directo al servidor, no por la cola
 * de sync). Sin señal, el reporte escrito queda como borrador en el teléfono.
 *
 * MOVIMIENTO: ninguno más allá del del sistema. Es una lista de trabajo que se
 * lee con calma; el detalle se abre a pantalla completa y Atrás lo cierra.
 */

import { useEffect, useRef, useState } from 'react'
import type { HallazgoAsignadoDto } from '@terreno/shared'
import { Boton } from '../components/ui'
import { BadgeSev } from '../components/Badges'
import { FotoEvidencia } from '../components/FotoEvidencia'
import { ApiError } from '../lib/api'
import {
  estadoAsignado,
  guardarBorradorReporte,
  leerBorradorReporte,
  type EstadoAsignado,
} from '../lib/hallazgos-asignados'
import { estadoPlazo, hoyLocal } from '../lib/plazo'
import { useEstado } from '../lib/store'
import type { Severidad } from '../lib/types'
import { useCapaAtras } from '../lib/useCapaAtras'

const SEV: Record<HallazgoAsignadoDto['severity'], Severidad> = {
  low: 'baja',
  medium: 'media',
  high: 'alta',
  critical: 'critica',
}

const ESTADO: Record<EstadoAsignado, { label: string; clase: string }> = {
  nuevo: { label: 'Nuevo', clase: 'bg-beam text-on-beam' },
  pendiente: { label: 'Pendiente', clase: 'bg-s3 text-ink-2' },
  'en-curso': { label: 'En curso', clase: 'bg-syncing/15 text-syncing' },
  listo: { label: 'Listo para revisar', clase: 'bg-synced/15 text-synced' },
  resuelto: { label: 'Resuelto', clase: 'bg-s3 text-ink-2' },
}

const FECHA = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' })
const FECHA_HORA = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** "2026-11-20" → "20 nov" (en hora local, sin correr el día por la zona). */
function fechaDePlazo(plazo: string): string {
  const [a, m, d] = plazo.split('-').map(Number)
  return FECHA.format(new Date(a, m - 1, d))
}

function textoPlazo(h: HallazgoAsignadoDto, hoy: string): { texto: string; urgente: boolean } {
  const estado = estadoPlazo(h.due_date, h.status, hoy)
  if (estado === 'cerrado') {
    return { texto: h.resolved_at ? `Resuelto el ${FECHA.format(new Date(h.resolved_at))}` : 'Resuelto', urgente: false }
  }
  if (estado === 'sin-plazo' || !h.due_date) return { texto: 'Sin plazo', urgente: false }
  if (estado === 'vencido') return { texto: `Venció el ${fechaDePlazo(h.due_date)}`, urgente: true }
  if (estado === 'vence-hoy') return { texto: 'Vence hoy', urgente: true }
  return { texto: `Plazo: ${fechaDePlazo(h.due_date)}`, urgente: false }
}

function ChipEstado({ estado }: { estado: EstadoAsignado }) {
  const m = ESTADO[estado]
  return (
    <span className={['inline-flex items-center rounded-md px-2 py-1 text-[12px] font-semibold whitespace-nowrap', m.clase].join(' ')}>
      {m.label}
    </span>
  )
}

export function MisHallazgos() {
  const { asignados, vistosAsignados, recargarAsignados, marcarAsignadoVisto, online } = useEstado()
  const [abiertoId, setAbiertoId] = useState<string | null>(null)
  const [actualizando, setActualizando] = useState(false)
  const hoy = hoyLocal()
  const abierto = asignados.find((h) => h.id === abiertoId) ?? null
  const activos = asignados.filter((h) => h.status !== 'resolved')
  const resueltos = asignados.filter((h) => h.status === 'resolved')

  const actualizar = async () => {
    setActualizando(true)
    try {
      await recargarAsignados()
    } finally {
      setActualizando(false)
    }
  }

  const abrir = (h: HallazgoAsignadoDto) => {
    setAbiertoId(h.id)
    void marcarAsignadoVisto(h)
  }

  const fila = (h: HallazgoAsignadoDto) => {
    const plazo = textoPlazo(h, hoy)
    return (
      <li key={h.id}>
        <button
          type="button"
          onClick={() => abrir(h)}
          className="w-full text-left rounded-xl border border-line-soft bg-s1 px-4 py-3.5 min-h-11 cursor-pointer hover:border-line-strong transition-colors duration-150"
        >
          <div className="flex flex-wrap items-center gap-2">
            <BadgeSev sev={SEV[h.severity]} />
            <ChipEstado estado={estadoAsignado(h, vistosAsignados)} />
          </div>
          <p className="mt-2 text-[15px] font-medium leading-snug line-clamp-2">{h.description}</p>
          <p className="mt-1.5 text-[13px] text-ink-2">
            {[h.faena, h.formulario].filter(Boolean).join(' · ') || 'Hallazgo general'}
          </p>
          <p className={['mt-1 text-[13px]', plazo.urgente ? 'font-semibold text-sev-critica' : 'text-ink-2'].join(' ')}>
            {plazo.texto}
          </p>
        </button>
      </li>
    )
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-inst">Hallazgos</p>
          <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
            Lo que te asignaron
          </h1>
          <p className="mt-1.5 text-[14px] text-ink-2 max-w-[62ch] leading-relaxed">
            Empieza cada hallazgo y cuenta lo que hiciste. Supervisión lo revisa y lo cierra.
          </p>
        </div>
        <Boton variante="secundaria" onClick={() => void actualizar()} disabled={!online || actualizando}>
          {actualizando ? 'Actualizando…' : 'Actualizar'}
        </Boton>
      </header>

      {!online && (
        <p className="panel p-3.5 text-[13px] text-ink-2" role="status">
          Sin señal: ves la última lista que llegó a este teléfono.
        </p>
      )}

      {asignados.length === 0 ? (
        <section className="panel p-6 text-center">
          <p className="text-[15px] font-medium">No tienes hallazgos asignados</p>
          <p className="mt-1.5 text-[13px] text-ink-2">Cuando supervisión te asigne uno, aparece aquí.</p>
        </section>
      ) : (
        <>
          {activos.length > 0 && (
            <section aria-labelledby="titulo-activos" className="space-y-2.5">
              <h2 id="titulo-activos" className="label-inst">
                Por hacer · {activos.length}
              </h2>
              <ul className="space-y-2.5">{activos.map(fila)}</ul>
            </section>
          )}
          {resueltos.length > 0 && (
            <section aria-labelledby="titulo-resueltos" className="space-y-2.5">
              <h2 id="titulo-resueltos" className="label-inst">
                Resueltos los últimos 14 días · {resueltos.length}
              </h2>
              <ul className="space-y-2.5">{resueltos.map(fila)}</ul>
            </section>
          )}
        </>
      )}

      {abierto && <DetalleHallazgo hallazgo={abierto} hoy={hoy} alCerrar={() => setAbiertoId(null)} />}
    </div>
  )
}

function DetalleHallazgo({
  hallazgo: h,
  hoy,
  alCerrar,
}: {
  hallazgo: HallazgoAsignadoDto
  hoy: string
  alCerrar: () => void
}) {
  const { usuario, online, vistosAsignados, avanzarHallazgo, recargarAsignados } = useEstado()
  const titulo = useRef<HTMLHeadingElement>(null)
  const [nota, setNota] = useState('')
  const [cargado, setCargado] = useState(false)
  const [enviando, setEnviando] = useState<'iniciar' | 'reportar' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const estado = estadoAsignado(h, vistosAsignados)
  const plazo = textoPlazo(h, hoy)
  const ambito = usuario ? { tenantId: usuario.tenantId, id: usuario.id } : null

  // TSK-OFF-008: Atrás cierra el detalle, no cambia de pantalla.
  useCapaAtras(true, alCerrar)

  useEffect(() => {
    titulo.current?.focus()
  }, [])

  // El borrador del reporte sobrevive a cerrar la app sin señal.
  useEffect(() => {
    if (!ambito) return
    let vivo = true
    void leerBorradorReporte(ambito, h.id).then((texto) => {
      if (!vivo) return
      setNota(texto || h.progress_note || '')
      setCargado(true)
    })
    return () => {
      vivo = false
    }
    // Sólo al abrir este hallazgo.
  }, [h.id])

  const escribir = (texto: string) => {
    setNota(texto)
    if (ambito && cargado) void guardarBorradorReporte(ambito, h.id, texto)
  }

  const avanzar = async (accion: 'iniciar' | 'reportar') => {
    setEnviando(accion)
    setError(null)
    setAviso(null)
    try {
      await avanzarHallazgo(h.id, accion === 'iniciar' ? { accion } : { accion, nota: nota.trim() })
      if (accion === 'reportar') {
        if (ambito) await guardarBorradorReporte(ambito, h.id, '')
        setAviso('Listo. Supervisión verá tu reporte y cerrará el hallazgo.')
      } else {
        setAviso('Marcado como en curso.')
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError('Este hallazgo ya no está a tu cargo o ya se resolvió.')
        void recargarAsignados()
      } else if (err instanceof ApiError && err.status === 0) {
        setError('Sin conexión con el servidor. Tu reporte quedó guardado en este teléfono.')
      } else {
        setError(err instanceof ApiError ? err.detalle : 'No se pudo enviar. Intenta de nuevo.')
      }
    } finally {
      setEnviando(null)
    }
  }

  const resuelto = h.status === 'resolved'

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="detalle-hallazgo-titulo"
      className="fixed inset-0 z-50 overflow-y-auto bg-s0"
    >
      <div className="mx-auto max-w-2xl px-4 pb-10 pt-safe">
        <div className="sticky top-0 z-10 -mx-4 flex items-center gap-2 bg-s0/95 px-2 py-2 backdrop-blur-md">
          <button
            type="button"
            onClick={alCerrar}
            className="min-h-11 px-3 rounded-[10px] text-[15px] font-medium text-ink-2 hover:text-ink cursor-pointer"
          >
            ‹ Volver
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <BadgeSev sev={SEV[h.severity]} />
          <ChipEstado estado={estado} />
        </div>
        <h2
          id="detalle-hallazgo-titulo"
          ref={titulo}
          tabIndex={-1}
          className="mt-3 text-[22px] font-semibold leading-snug tracking-[-0.02em] outline-none"
        >
          {h.description}
        </h2>
        <p className={['mt-2 text-[14px]', plazo.urgente ? 'font-semibold text-sev-critica' : 'text-ink-2'].join(' ')}>
          {plazo.texto}
        </p>

        <dl className="mt-5 grid gap-3 rounded-xl border border-line-soft bg-s1 p-4 text-[14px]">
          {h.pregunta && (
            <div>
              <dt className="label-inst">Pregunta</dt>
              <dd className="mt-0.5">{h.pregunta}</dd>
            </div>
          )}
          <div>
            <dt className="label-inst">Formulario y faena</dt>
            <dd className="mt-0.5">{[h.formulario, h.faena].filter(Boolean).join(' · ') || '—'}</dd>
          </div>
          <div>
            <dt className="label-inst">Registrado por</dt>
            <dd className="mt-0.5">
              {h.autor ?? '—'}
              {h.inspeccion_at ? ` · ${FECHA_HORA.format(new Date(h.inspeccion_at))}` : ''}
            </dd>
          </div>
          <div>
            <dt className="label-inst">Te lo asignaron</dt>
            <dd className="mt-0.5">{h.assigned_at ? FECHA_HORA.format(new Date(h.assigned_at)) : '—'}</dd>
          </div>
        </dl>

        {h.fotos_ids.length > 0 && (
          <div className="mt-5">
            <p className="label-inst">Fotos · {h.fotos_ids.length}</p>
            {online ? (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {h.fotos_ids.map((id, i) => (
                  <FotoEvidencia key={id} id={id} etiqueta={`Foto ${i + 1} del hallazgo`} />
                ))}
              </div>
            ) : (
              <p className="mt-1.5 text-[13px] text-ink-2">Las fotos se ven cuando hay señal.</p>
            )}
          </div>
        )}

        {resuelto ? (
          <div className="mt-6 rounded-xl border border-line-soft bg-s1 p-4">
            <p className="label-inst">Cierre de supervisión</p>
            <p className="mt-1 text-[14px] leading-relaxed">{h.resolution_note || 'Resuelto sin nota.'}</p>
            {h.progress_note && (
              <>
                <p className="label-inst mt-3">Lo que reportaste</p>
                <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{h.progress_note}</p>
              </>
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {h.status === 'open' && (
              <Boton
                variante="secundaria"
                bloqueCompleto
                disabled={!online || enviando !== null}
                onClick={() => void avanzar('iniciar')}
              >
                {enviando === 'iniciar' ? 'Marcando…' : 'Empezar'}
              </Boton>
            )}

            {h.reported_at && (
              <p className="rounded-xl bg-synced/10 px-3.5 py-3 text-[14px] leading-relaxed">
                Lo reportaste el {FECHA_HORA.format(new Date(h.reported_at))}. Supervisión lo revisa; si hace falta algo
                más, puedes actualizar tu reporte.
              </p>
            )}

            <label className="block">
              <span className="text-[15px] font-semibold">¿Qué hiciste?</span>
              <textarea
                value={nota}
                onChange={(e) => escribir(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="Por ejemplo: se reinstaló la barrera y se ancló al piso."
                className="mt-2 block w-full rounded-[10px] border border-campo bg-s1 px-3.5 py-3 text-[15px] leading-relaxed"
              />
            </label>

            <Boton
              variante="primaria"
              bloqueCompleto
              disabled={!online || enviando !== null || !nota.trim()}
              onClick={() => void avanzar('reportar')}
            >
              {enviando === 'reportar' ? 'Enviando…' : h.reported_at ? 'Actualizar reporte' : 'Reportar lo que hice'}
            </Boton>

            {!online && (
              <p className="text-[13px] text-ink-2" role="status">
                Necesitas señal para enviar tu reporte. Lo que escribas queda guardado en este teléfono.
              </p>
            )}
          </div>
        )}

        {aviso && (
          <p className="mt-4 text-[14px] text-synced" role="status">
            {aviso}
          </p>
        )}
        {error && (
          <p className="mt-4 text-[14px] text-sev-critica" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
