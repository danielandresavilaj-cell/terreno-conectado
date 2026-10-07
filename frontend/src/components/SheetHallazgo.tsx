/* Sheet de hallazgo — FR-032 (severidad obligatoria al nok), FR-012 (foto).
 *
 * MOVIMIENTO:
 * · Entrada con spring (420 ms, bounce 0.16) desde transform-origin en el
 *   botón que la abrió. Spring y no duración fija porque el usuario puede
 *   abrir y cerrar rápido: el spring conserva la velocidad y revierte suave,
 *   una transición de 300 ms se reinicia y se ve el tirón.
 * · El fondo entra con fade a 180 ms — más rápido que el panel, para que la
 *   lectura sea "el panel llega, el fondo solo se atenúa".
 * · El backdrop NO se puede arrastrar para cerrar en este mockup, pero el
 *   spring ya prepara la sensación. El `Escape` cierra sin animación (teclado).
 * · El selector de severidad hace pop al elegir, como el ok/nok/na. Spring
 *   corto: se elige una vez por hallazgo.
 * · SALE más rápido que entra (200 ms ease-out): la salida no debe hacer
 *   esperar al usuario. Entrada lenta = deliberación; salida rápida = respuesta.
 */

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Boton } from './ui'
import { SEV_META } from './Badges'
import { EASE } from '../lib/motion'
import type { ItemPlantilla, Severidad } from '../lib/types'

const SEVS: Severidad[] = ['baja', 'media', 'alta', 'critica']

export function SheetHallazgo({
  item,
  onClose,
  onGuardar,
}: {
  item: ItemPlantilla | null
  onClose: () => void
  onGuardar: (sev: Severidad, descripcion: string, foto: File | null) => void
}) {
  const reducir = useReducedMotion()
  const [sev, setSev] = useState<Severidad>('media')
  const [desc, setDesc] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const inputFoto = useRef<HTMLInputElement | null>(null)
  const origen = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (item) {
      setSev('media')
      setDesc('')
      setFoto(null)
      // Guardamos el disparador para fijar transform-origin: el panel debe
      // crecer desde el botón que lo abrió, no desde el centro de la pantalla.
      origen.current = document.activeElement as HTMLElement
    }
  }, [item])

  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => {
      // Teclado: cierre instantáneo, sin animación. Se repite cientos de veces.
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, onClose])

  /* Posición del disparador → transform-origin. Si no encontramos el botón,
   * el origen por defecto (50% 100%) hace crecer el panel desde abajo, que es
   * el fallback correcto: en móvil el sheet está anclado abajo, y en sm+ el
   * panel centrado crece hacia arriba desde el borde inferior, que es lo
   * más cercano a "nació en el ítem que respondiste NOK". */
  const [origin, setOrigin] = useState('50% 100%')
  useEffect(() => {
    const el = origen.current
    if (!item || !el) return
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    setOrigin(`${x}px ${r.bottom}px`)
  }, [item])

  return (
    <AnimatePresence>
      {item && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE.out }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px]"
          />

          {/* Wrapper flex: el panel queda libre para que Motion controle
              `y`/`scale` sin pelearse con un translate de CSS.
              En móvil el panel se ancla ABAJO (items-end) y no centrado: un
              sheet centrado en un teléfono deja los botones fuera del alcance
              del pulgar y, con el teclado abierto, los deja bajo el teclado.
              En sm+ vuelve a centrado. mb-safe deja los botones sobre el
              indicador de gesto de iOS. */}
          <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center p-0 sm:p-4 pointer-events-none">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Registrar hallazgo"
              initial={reducir ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                reducir
                  ? { opacity: 0 }
                  : { opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.2, ease: EASE.out } }
              }
              transition={reducir ? { duration: 0.15 } : { type: 'spring', duration: 0.42, bounce: 0.16 }}
              style={{ transformOrigin: origin }}
              className="pointer-events-auto w-[min(520px,100%)] max-h-[88dvh] overflow-y-auto panel p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:pb-5 rounded-b-none sm:rounded-b-[14px] shadow-2xl"
            >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="label-inst">FR-032 · Hallazgo obligatorio</p>
                <h2 className="mt-1.5 text-[19px] font-semibold tracking-[-0.025em] leading-snug">
                  {item.texto}
                </h2>
                <p className="mt-1 text-[12px] text-ink-3">{item.seccion}</p>
              </div>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="h-11 w-11 sm:h-8 sm:w-8 shrink-0 grid place-items-center rounded-lg text-ink-3 hover:text-ink hover:bg-s3 transition-colors duration-150 cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                  <path d="m2 2 9 9M11 2l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Severidad — segmentado con pop */}
            <div className="mt-5">
              <p className="label-inst mb-2">Severidad</p>
              <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-s0 border border-line-soft">
                {SEVS.map((s) => {
                  const m = SEV_META[s]
                  const sel = sev === s
                  return (
                    <motion.button
                      key={s}
                      onClick={() => setSev(s)}
                      whileTap={reducir ? undefined : { scale: 0.94 }}
                      animate={{
                        backgroundColor: sel ? m.bg : 'transparent',
                        borderColor: sel ? `color-mix(in oklab, ${m.color} 50%, transparent)` : 'transparent',
                      }}
                      transition={{ duration: 0.2, ease: EASE.out }}
                      className="h-11 rounded-lg border cursor-pointer grid place-items-center"
                    >
                      <motion.span
                        animate={{ color: sel ? m.color : 'var(--color-ink-3)', scale: sel ? 1 : 0.94 }}
                        transition={
                          sel && !reducir
                            ? { type: 'spring', duration: 0.32, bounce: 0.3 }
                            : { duration: 0.18 }
                        }
                        className="num-inst text-[11px] font-semibold uppercase tracking-[0.06em]"
                      >
                        {m.label}
                      </motion.span>
                    </motion.button>
                  )
                })}
              </div>
              <p className="mt-2 text-[11px] text-ink-3 leading-relaxed">
                {sev === 'alta' || sev === 'critica'
                  ? 'Se destaca de inmediato en el dashboard del supervisor al sincronizar (FR-035).'
                  : 'Queda visible en el listado de hallazgos del turno.'}
              </p>
            </div>

            {/* Descripción */}
            <label className="block mt-5">
              <span className="label-inst">Descripción del hallazgo</span>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={4}
                placeholder="Qué se observó, dónde exactamente, y qué se recomienda…"
                className="mt-1.5 w-full px-3 py-2.5 rounded-[10px] bg-s0 border border-line-soft text-[14px] leading-relaxed placeholder:text-ink-3 focus:border-beam transition-colors duration-150 resize-none"
              />
            </label>

            {/* FR-011/012: evidencia fotográfica capturada en el dispositivo.
                Se guarda el blob sin comprimir acá; la compresión (≤1280px q0.7)
                llega con TSK-WS-006. */}
            <input
              ref={inputFoto}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => inputFoto.current?.click()}
              className={[
                'mt-4 w-full flex items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left cursor-pointer',
                'transition-colors duration-200 ease-out',
                foto
                  ? 'border-beam/45 bg-beam/10'
                  : 'border-line-soft bg-s1 hover:border-line',
              ].join(' ')}
            >
              <span
                className={[
                  'h-9 w-9 rounded-lg grid place-items-center shrink-0 transition-colors duration-200',
                  foto ? 'bg-beam/20 text-beam' : 'bg-s3 text-ink-3',
                ].join(' ')}
              >
                <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
                  <path d="M2.5 4.5h3l1.2-1.6h3.6l1.2 1.6h3v9h-12v-9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  <circle cx="8.5" cy="8.8" r="2.3" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">
                  {foto ? foto.name : 'Adjuntar evidencia fotográfica'}
                </p>
                <p className="text-[11px] text-ink-3 mt-0.5 truncate">
                  {foto
                    ? `${Math.round(foto.size / 1024)} KB original · se comprime en el dispositivo`
                    : 'Captura con la cámara; se comprime a 1280 px · q0.7 antes de encolar'}
                </p>
              </div>
              {/* Checkmark del archivo elegido */}
              <motion.span
                animate={{ scale: foto ? 1 : 0.6, opacity: foto ? 1 : 0 }}
                transition={reducir ? { duration: 0 } : { type: 'spring', duration: 0.32, bounce: 0.32 }}
                className="h-5 w-5 rounded-full bg-beam grid place-items-center shrink-0"
              >
                <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden>
                  <path
                    d="M2 5.2 4 7.2 8 3"
                    stroke="var(--color-s0)"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </motion.span>
            </button>

            <div className="mt-6 flex gap-2 justify-end">
              <Boton variante="fantasma" onClick={onClose}>
                Cancelar
              </Boton>
              <Boton variante="primaria" onClick={() => onGuardar(sev, desc, foto)}>
                Guardar hallazgo
              </Boton>
            </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
