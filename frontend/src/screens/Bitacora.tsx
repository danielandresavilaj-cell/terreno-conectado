/* Bitácora de turno — FR-033, FR-034.
 *
 * MOVIMIENTO:
 * · Añadir una entrada: la nueva aparece con stagger respecto a las anteriores
 *   solo si es la primera del turno. Las siguientes ya no se staggorean: la
 *   lista está anclada arriba y el usuario lee de arriba abajo.
 * · El chip de tag se selecciona con pop (spring corto) — misma interacción
 *   que el resto de los controles segmentados del sistema, consistencia de
 *   sensación.
 * · El botón "Agregar" es un input que se despliega. La expansión usa
 *   `height: auto` animado, que SÍ provoca layout — es la excepción consciente:
 *   en un formulario corto el costo es despreciable y la alternativa
 *   (transform: scaleY) deformaría el textarea. Documentado a propósito.
 */

import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Boton } from '../components/ui'
import { BadgeSync } from '../components/Badges'
import { CountUp } from '../components/CountUp'
import { useEstado } from '../lib/store'
import { EASE } from '../lib/motion'

const TAGS = ['Relevo', 'Seguridad', 'Clima', 'Transporte', 'Incidencia']

const HOY_LARGO = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
const DIA_CORTO = new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })

/** Día de una entrada, para no mostrar "08:15" de ayer como si fuera de hoy. */
function diaDe(iso: string, hoy: Date): string {
  const d = new Date(iso)
  return d.toDateString() === hoy.toDateString() ? 'Hoy' : DIA_CORTO.format(d)
}

export function Bitacora() {
  const { entradasBitacora, agregarBitacora, identidad, cola, usuario } = useEstado()
  const hoy = new Date()
  const faenas = identidad?.faenas ?? []
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [tags, setTags] = useState<string[]>([])
  // TSK-OFF-010: parte en la faena de la sesión, no en la primera de la empresa.
  const [faena, setFaena] = useState<string>(usuario?.faenaId || faenas[0]?.id || '')
  const reducir = useReducedMotion()

  const agregar = () => {
    if (!texto.trim() || !faena) return
    agregarBitacora(texto.trim(), tags, faena)
    setTexto('')
    setTags([])
    setAbierto(false)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-inst">Bitácora</p>
          <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1] first-letter:uppercase">
            {HOY_LARGO.format(hoy)}
          </h1>
          <p className="mt-1.5 text-[14px] text-ink-2">
            {faenas.find((f) => f.id === faena)?.nombre ?? '—'}
          </p>
        </div>
        <Boton variante="primaria" onClick={() => setAbierto((v) => !v)}>
          {abierto ? 'Cancelar' : 'Nueva entrada'}
        </Boton>
      </header>

      {/* ── Formulario desplegable ────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {abierto && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: EASE.out }}
            className="overflow-hidden"
          >
            <div className="panel p-4 space-y-4">
              <label className="block">
                <span className="label-inst">Qué pasó</span>
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={4}
                  name="bitacora-texto"
                  placeholder="Qué pasó, qué quedó pendiente y qué debe saber quien sigue…"
                  className="mt-1.5 w-full px-3 py-2.5 rounded-[10px] bg-s0 border border-line-soft text-[14px] leading-relaxed placeholder:text-ink-3 focus:border-beam transition-colors duration-150 resize-none"
                />
              </label>

              <div>
                <p className="label-inst mb-2">Etiquetas</p>
                <div className="flex flex-wrap gap-1.5">
                  {TAGS.map((t) => {
                    const sel = tags.includes(t)
                    return (
                      <motion.button
                        key={t}
                        type="button"
                        aria-pressed={sel}
                        onClick={() =>
                          setTags((s) => (sel ? s.filter((x) => x !== t) : [...s, t]))
                        }
                        whileTap={reducir ? undefined : { scale: 0.94 }}
                        animate={{
                          backgroundColor: sel ? 'var(--color-beam-glow)' : 'var(--color-s2)',
                          borderColor: sel ? 'var(--color-beam)' : 'var(--color-campo)',
                        }}
                        transition={{ duration: 0.18, ease: EASE.out }}
                        className="h-11 px-3.5 rounded-lg border text-[14px] cursor-pointer"
                        style={{ color: sel ? 'var(--color-beam)' : 'var(--color-ink-2)' }}
                      >
                        {t}
                      </motion.button>
                    )
                  })}
                </div>
              </div>

              {/* FR-034: cada captura se asocia a una faena u obra del tenant. */}
              <div>
                <p className="label-inst mb-2">Faena u obra</p>
                <div className="flex flex-wrap gap-1.5">
                  {faenas.length === 0 && (
                    <p className="text-[13px] text-ink-2">Tu empresa aún no tiene faenas creadas.</p>
                  )}
                  {faenas.map((f) => {
                    const sel = faena === f.id
                    return (
                      <motion.button
                        key={f.id}
                        type="button"
                        aria-pressed={sel}
                        onClick={() => setFaena(f.id)}
                        whileTap={reducir ? undefined : { scale: 0.94 }}
                        animate={{
                          backgroundColor: sel ? 'var(--color-beam-glow)' : 'var(--color-s2)',
                          borderColor: sel ? 'var(--color-beam)' : 'var(--color-campo)',
                        }}
                        transition={{ duration: 0.18, ease: EASE.out }}
                        className="h-11 px-3.5 rounded-lg border text-[14px] cursor-pointer"
                        style={{ color: sel ? 'var(--color-beam)' : 'var(--color-ink-2)' }}
                      >
                        {f.nombre}
                      </motion.button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-[13px] text-ink-2 leading-relaxed max-w-[46ch]">
                  Se guarda en este teléfono aunque no haya señal y se envía sola al volver la conexión.
                </p>
                <Boton variante="primaria" onClick={agregar} disabled={!texto.trim()}>
                  Guardar entrada
                </Boton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Línea de tiempo ───────────────────────────────────────────────── */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-3 px-0.5">
          <h2 className="label-inst">
            <CountUp valor={entradasBitacora.length} className="text-ink-3" />{' '}
            {entradasBitacora.length === 1 ? 'entrada' : 'entradas'}
          </h2>
          <div className="flex-1 rule" />
        </div>

        {entradasBitacora.map((e, i) => (
          <motion.article
            key={e.id}
            initial={reducir ? { opacity: 1 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE.out }}
            layout
            className="panel p-4 flex gap-4"
          >
            {/* Marca de tiempo en la línea vertical */}
            <div className="shrink-0 w-[64px] text-right">
              <p className="num-inst text-[15px] font-semibold">{e.hora}</p>
              <p className="mt-0.5 text-[12px] text-ink-3">{diaDe(e.capturadaEn, hoy)}</p>
              <div className="mt-2 flex items-center justify-end gap-0">
                {i < entradasBitacora.length - 1 && (
                  <span className="w-px h-full bg-line-soft -mr-[9px]" aria-hidden />
                )}
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-relaxed">{e.texto}</p>
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
              <div className="mt-2.5 flex items-center gap-3 flex-wrap">
                <span className="text-[13px] text-ink-2">{e.autor}</span>
                {/* TSK-OFF-007: el estado es el real de la cola. Si la fila ya
                    no está en la cola, la entrada se envió hace más de un día. */}
                <BadgeSync estado={cola.find((r) => r.id === `log_entry:${e.id}`)?.estado ?? 'synced'} />
              </div>
            </div>
          </motion.article>
        ))}
      </div>
    </div>
  )
}
