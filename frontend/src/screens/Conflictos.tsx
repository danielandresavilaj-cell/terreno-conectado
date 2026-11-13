/* Conflictos de sincronización — FR-023, FR-051, Artículo III.
 *
 * TSK-WS-011: consume `GET /api/v1/conflicts` (registro real de la ingesta
 * LWW del sync). "Marcar como revisado" se guarda en el servidor
 * (`PATCH /conflicts/:id/review`, TSK-DOM-005): quién y cuándo, auditado.
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
import { ApiError, getConflicts, revisarConflicto } from '../lib/api'
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
  inspection_signature: 'firma de cierre',
}

/** Nombres legibles de los campos del contrato de sync. */
const CAMPO_LABEL: Record<string, string> = {
  status: 'Estado',
  description: 'Descripción',
  severity: 'Severidad',
  entry_text: 'Texto',
  tags: 'Etiquetas',
  shift_date: 'Turno',
  value_ok: 'Resultado',
  value_text: 'Texto',
  value_number: 'Número',
  value_date: 'Fecha',
  value_json: 'Valor',
  comment: 'Comentario',
  site_id: 'Faena',
  template_version: 'Versión de plantilla',
  executed_by: 'Ejecutada por',
  author_id: 'Autor',
}
const VALOR_LABEL: Record<string, string> = {
  ok: 'OK', nok: 'No OK', na: 'N/A', submitted: 'Enviada', reviewed: 'Revisada',
  in_progress: 'En curso', draft: 'Borrador', open: 'Abierto', resolved: 'Resuelto',
  low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica',
}
/** Campos técnicos que no ayudan a comparar las versiones. */
const OCULTOS = new Set(['tenant_id', 'inspection_id', 'response_id', 'template_id', 'template_item_id', 'owner_id', 'data', 'location'])

/** Payload wire → texto legible de la versión (la comparación es el contenido). */
function formatoPayload(p: Record<string, unknown>): string {
  return Object.entries(p)
    .filter(([k]) => !OCULTOS.has(k))
    .map(([k, v]) => {
      const etiqueta = CAMPO_LABEL[k] ?? k
      if (v === null || v === undefined || v === '') return `${etiqueta}: —`
      if (Array.isArray(v)) return `${etiqueta}: ${v.join(', ')}`
      if (typeof v === 'object') return `${etiqueta}: ${JSON.stringify(v)}`
      return `${etiqueta}: ${VALOR_LABEL[String(v)] ?? String(v)}`
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
        autor: 'servidor',
        valor: formatoPayload(c.winner_payload),
        ts: new Date(c.resolved_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
      {
        device: 'Versión descartada',
        autor: 'servidor',
        valor: formatoPayload(c.loser_payload),
        ts: new Date(c.resolved_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
    ],
    ganador: 'A',
    resuelto: !!c.reviewed_at,
  }
}

export function Conflictos() {
  const { usuario } = useEstado()
  const [items, setItems] = useState<Conflicto[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resueltos, setResueltos] = useState<Record<string, boolean>>({})
  const [errorRevision, setErrorRevision] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const r = await getConflicts()
      const lista = r.items.map(mapaConflicto)
      setItems(lista)
      setResueltos(Object.fromEntries(lista.filter((c) => c.resuelto).map((c) => [c.id, true])))
    } catch {
      setError('No se pudo leer el registro de conflictos.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /* TSK-DOM-005: la revisión se guarda en el servidor (quién y cuándo) y
   * sobrevive a recargar; antes era sólo un estado de la pantalla. */
  const resolver = (id: string) => {
    setErrorRevision(null)
    void revisarConflicto(id)
      .then(() => setResueltos((r) => ({ ...r, [id]: true })))
      .catch((err: unknown) =>
        setErrorRevision(err instanceof ApiError && err.status === 0 ? 'Necesitas señal para marcarlo como revisado.' : 'No se pudo guardar la revisión.'),
      )
  }
  const abiertos = items.filter((c) => !resueltos[c.id]).length

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-inst">Gana la versión más reciente</p>
          <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
            Registro de conflictos
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-2 max-w-[62ch] leading-relaxed">
            Cuando dos dispositivos editan el mismo registro sin conexión, se aplica la versión
            <span className="text-ink"> capturada más recientemente</span> y{' '}
            se <span className="text-ink">conservan ambas versiones</span>. Nada se sobrescribe en
            silencio.
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

      {errorRevision && (
        <p role="alert" className="text-[13px] text-sev-alta">
          {errorRevision}
        </p>
      )}
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
       . La cola de sincronización nunca descarta una versión: se archiva como
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
            Se aplicó la versión más reciente. Revisa la descartada antes de cerrarla: queda en el
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
