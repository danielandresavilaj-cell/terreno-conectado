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
import { CountUp } from '../components/CountUp'
import { FAENAS } from '../lib/seed'
import { useEstado } from '../lib/store'
import { EASE } from '../lib/motion'

const TAGS = ['Turno B', 'Relevo', 'Clima', 'Transporte', 'Incidencia']

export function Bitacora() {
  const { entradasBitacora, agregarBitacora } = useEstado()
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [tags, setTags] = useState<string[]>(['Turno B'])
  const [faena, setFaena] = useState(FAENAS[0].id)
  const reducir = useReducedMotion()

  const agregar = () => {
    if (!texto.trim()) return
    agregarBitacora(texto.trim(), tags, faena)
    setTexto('')
    setAbierto(false)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-inst">FR-033 · Bitácora de turno</p>
          <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
            Turno B · hoy
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-2">
            {FAENAS.find((f) => f.id === faena)?.nombre} · geolocalización opcional (FR-034)
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
                <span className="label-inst">Entrada de bitácora</span>
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder="Qué pasó en el turno, qué se dejó pendiente, qué hay que saber del turno siguiente…"
                  className="mt-1.5 w-full px-3 py-2.5 rounded-[10px] bg-s0 border border-line-soft text-[14px] leading-relaxed placeholder:text-ink-3 focus:border-beam transition-colors duration-150 resize-none"
                />
              </label>

              <div>
                <p className="label-inst mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {TAGS.map((t) => {
                    const sel = tags.includes(t)
                    return (
                      <motion.button
                        key={t}
                        onClick={() =>
                          setTags((s) => (sel ? s.filter((x) => x !== t) : [...s, t]))
                        }
                        whileTap={reducir ? undefined : { scale: 0.94 }}
                        animate={{
                          backgroundColor: sel ? 'var(--color-beam-glow)' : 'var(--color-s2)',
                          borderColor: sel ? 'var(--color-beam-dim)' : 'var(--color-line-soft)',
                        }}
                        transition={{ duration: 0.18, ease: EASE.out }}
                        className="h-8 px-3 rounded-lg border font-mono text-[11px] tracking-[0.06em] cursor-pointer"
                        style={{ color: sel ? 'var(--color-beam)' : 'var(--color-ink-3)' }}
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
                  {FAENAS.map((f) => {
                    const sel = faena === f.id
                    return (
                      <motion.button
                        key={f.id}
                        onClick={() => setFaena(f.id)}
                        whileTap={reducir ? undefined : { scale: 0.94 }}
                        animate={{
                          backgroundColor: sel ? 'var(--color-beam-glow)' : 'var(--color-s2)',
                          borderColor: sel ? 'var(--color-beam-dim)' : 'var(--color-line-soft)',
                        }}
                        transition={{ duration: 0.18, ease: EASE.out }}
                        className="h-8 px-3 rounded-lg border text-[12px] cursor-pointer"
                        style={{ color: sel ? 'var(--color-beam)' : 'var(--color-ink-3)' }}
                      >
                        {f.nombre}
                      </motion.button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-[11px] text-ink-3 leading-relaxed max-w-[46ch]">
                  Se guarda en el dispositivo aunque no haya señal y entra a la cola de sync como
                  registro <span className="text-ink-2">bitácora</span>.
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
            <CountUp valor={entradasBitacora.length} className="text-ink-3" /> entradas cronológicas
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
            <div className="shrink-0 w-[52px] text-right">
              <p className="num-inst text-[15px] font-semibold">{e.hora}</p>
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
                    className="h-6 px-2 rounded-md bg-s3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-2 grid place-items-center"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <div className="mt-2.5 flex items-center gap-3 flex-wrap">
                <span className="label-inst">{e.autor}</span>
                <span className="label-inst">· {e.geo}</span>
              </div>
            </div>
          </motion.article>
        ))}
      </div>
    </div>
  )
}
