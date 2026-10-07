/* Conflictos de sincronización — FR-023, FR-051, Artículo III.
 *
 * TSK-WS-011: consume `GET /api/v1/conflicts` (registro real de la ingesta
 * LWW del sync). El "marcar como revisado" es local a la sesión: el registro
 * del servidor es append-only y no tiene campo de revisión en el walking
 * skeleton — la auditoría de quién revisó queda para TSK-WS-014.
 *
 * Esta pantalla existe para responder una pregunta incómoda: ¿qué pasa cuando
 * dos dispositivos editan lo mismo sin señal? La respuesta del proyecto es LWW
 * por marca de tiempo + registro auditable de ambas versiones. Nunca
 * sobreescritura silenciosa.
 *
 * MOVIMIENTO:
 * · Las dos versiones del conflicto se muestran lado a lado. Al resolver, la
 *   perdedora baja a opacidad 0.45 y la ganadora queda demarcada: el usuario
 *   VE qué se perdió, que es el objetivo de la auditoría (Artículo III).
 * · El sello de "ganador" entra con pop de escala. Es un evento raro y
 *   significativo: el supervisor acaba de tomar una decisión sobre qué dato
 *   sobrevive. Se permite delicia.
 * · NO hay animación de "intercambio" entre las dos versiones: la política LWW
 *   no es una revisión del usuario, es determinista. Animar un swap sugeriría
 *   que se puede intervenir la decisión, y no se puede.
 */

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { BadgeSev } from '../components/Badges'
import { Boton } from '../components/ui'
import { getConflicts } from '../lib/api'
import { useEstado } from '../lib/store'
import { EASE } from '../lib/motion'
import type { Conflicto } from '../lib/types'
import type { ConflictRecordDto } from '@terreno/shared'

const ENTIDAD_LABEL: Record<ConflictRecordDto['entity_type'], string> = {
  inspection: 'inspección',
  response: 'respuesta',
  finding: 'hallazgo',
  log_entry: 'bitácora',
  attachment: 'evidencia',
}

/** Payload wire → texto legible de la versión (la comparación es el contenido). */
function formatoPayload(p: Record<string, unknown>): string {
  return Object.entries(p)
    .map(([k, v]) => {
      if (v === null) return `${k}: null`
      if (typeof v === 'object') return `${k}: ${JSON.stringify(v)}`
      return `${k}: ${String(v)}`
    })
    .join('\n')
}

function mapaConflicto(c: ConflictRecordDto): Conflicto {
  return {
    id: c.id,
    registro: `${ENTIDAD_LABEL[c.entity_type]} · ${c.entity_id.slice(0, 8)}…`,
    faena: ENTIDAD_LABEL[c.entity_type],
    devices: [
      {
        device: 'Versión ganadora',
        autor: 'servidor · LWW',
        valor: formatoPayload(c.winner_payload),
        ts: new Date(c.resolved_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
      {
        device: 'Versión descartada',
        autor: 'servidor · LWW',
        valor: formatoPayload(c.loser_payload),
        ts: new Date(c.resolved_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
    ],
    ganador: 'A',
    resuelto: false,
  }
}

export function Conflictos() {
  const { usuario } = useEstado()
  const [items, setItems] = useState<Conflicto[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resueltos, setResueltos] = useState<Record<string, boolean>>({})

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const r = await getConflicts()
      setItems(r.items.map(mapaConflicto))
    } catch {
      setError('No se pudo leer el registro de conflictos.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const resolver = (id: string) => setResueltos((r) => ({ ...r, [id]: true }))
  const abiertos = items.filter((c) => !resueltos[c.id]).length

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-inst">FR-023 · Last-Write-Wins</p>
          <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
            Registro de conflictos
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-2 max-w-[62ch] leading-relaxed">
            Cuando dos dispositivos editan el mismo registro sin conexión, el motor aplica LWW por
            <span className="text-ink"> captured_at</span> más reciente y{' '}
            <span className="text-ink">conserva ambas versiones</span>. Nada se sobrescribe en
            silencio (Artículo III).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Boton tamano="sm" variante="secundaria" onClick={() => void cargar()}>
            Refrescar
          </Boton>
          <div className="panel px-4 py-3 shrink-0">
            <p className="label-inst">Por revisar</p>
            <p className="num-inst mt-1 text-[26px] font-semibold leading-none text-beam">
              {abiertos}
            </p>
          </div>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-sev-alta/10 border border-sev-alta/25 px-3 py-2">
          <span className="mt-[3px] h-1.5 w-1.5 rounded-full bg-sev-alta shrink-0" />
          <p className="text-[12px] leading-relaxed text-sev-alta">{error}</p>
        </div>
      )}

      {cargando && items.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="text-[13px] text-ink-2">Leyendo del servidor…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="text-[13px] text-ink-2">
            Sin conflictos registrados en este tenant. El registro se pobla cuando dos dispositivos
            editan el mismo registro offline.
          </p>
        </div>
      ) : (
        /* FR-051: el conflicto queda auditado con las dos versiones. */
        <div className="space-y-3">
          {items.map((c) => (
            <CardConflicto
              key={c.id}
              c={c}
              resuelto={!!resueltos[c.id]}
              onResolver={() => resolver(c.id)}
            />
          ))}
        </div>
      )}

      <p className="text-[11px] text-ink-3 leading-relaxed border-t border-line-soft pt-4">
        Cada resolución queda en el audit log append-only junto con el usuario que la decidió
        (FR-051). La cola de sincronización nunca descarta una versión: se archiva como
        conflicto para que el supervisor pueda auditar. Sesión: {usuario?.email ?? '—'}.
      </p>
    </div>
  )
}

function CardConflicto({
  c,
  resuelto,
  onResolver,
}: {
  c: Conflicto
  resuelto: boolean
  onResolver: () => void
}) {
  const reducir = useReducedMotion()
  const sinMovimiento = !!reducir

  return (
    <motion.section
      layout
      transition={{ duration: 0.3, ease: EASE.out }}
      className={[
        'panel overflow-hidden',
        resuelto ? 'opacity-70' : 'border-sev-media/30',
      ].join(' ')}
    >
      <header className="px-4 py-3.5 flex items-center justify-between gap-3 border-b border-line-soft">
        <div className="min-w-0">
          <p className="text-[13px] font-medium truncate">{c.registro}</p>
          <p className="label-inst mt-1">Registro {c.faena} · 2 versiones</p>
        </div>
        <AnimatePresence>
          {resuelto ? (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', duration: 0.34, bounce: 0.24 }}
              className="shrink-0 h-6 px-2.5 rounded-full bg-synced/15 text-synced font-mono text-[10px] uppercase tracking-[0.1em] grid place-items-center"
            >
              Revisado
            </motion.span>
          ) : (
            <BadgeSev sev="media" />
          )}
        </AnimatePresence>
      </header>

      {/* Las dos versiones lado a lado: la comparación es el contenido. */}
      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line-soft">
        {c.devices.map((d, i) => {
          const gana = c.ganador === (i === 0 ? 'A' : 'B')
          return (
            <div
              key={d.device}
              className={[
                'p-4 transition-opacity duration-300 ease-out relative',
                resuelto && !gana ? 'opacity-45' : '',
              ].join(' ')}
            >
              {gana && (
                <span
                  className="absolute left-0 top-0 bottom-0 w-[2px]"
                  style={{ background: 'var(--color-synced)' }}
                  aria-hidden
                />
              )}

              <div className="flex items-start justify-between gap-3 mb-2.5">
                <div className="min-w-0">
                  <p className="num-inst text-[13px] font-semibold truncate">{d.device}</p>
                  <p className="label-inst mt-0.5">{d.autor}</p>
                </div>

                {/* Sello de ganador: pop de escala, evento raro y significativo. */}
                <AnimatePresence>
                  {gana && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.6, rotate: -8 }}
                      animate={{ opacity: 1, scale: 1, rotate: 0 }}
                      transition={
                        sinMovimiento
                          ? { duration: 0 }
                          : { type: 'spring', duration: 0.4, bounce: 0.32 }
                      }
                      className="shrink-0 h-6 px-2 rounded-md bg-synced/15 text-synced font-mono text-[9px] uppercase tracking-[0.1em] grid place-items-center"
                    >
                      Vigente
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              <pre className="text-[12px] leading-relaxed text-ink-2 whitespace-pre-wrap font-mono">
                {d.valor}
              </pre>

              <div className="mt-3 flex items-center gap-2">
                <span className="label-inst">Resuelto</span>
                <span className="num-inst text-[12px] text-ink-2">{d.ts}</span>
                {gana && (
                  <span className="label-inst" style={{ color: 'var(--color-synced)' }}>
                    · más reciente
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {!resuelto && (
        <footer className="px-4 py-3 border-t border-line-soft flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-ink-3 leading-relaxed max-w-[52ch]">
            Se aplicó la versión más reciente. Revisá la descartada antes de cerrarla: queda en el
            audit log de forma permanente.
          </p>
          <Boton tamano="sm" variante="secundaria" onClick={onResolver}>
            Marcar como revisado
          </Boton>
        </footer>
      )}
    </motion.section>
  )
}