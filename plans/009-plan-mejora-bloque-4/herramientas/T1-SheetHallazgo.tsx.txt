/* Sheet de hallazgo — FR-032 (severidad obligatoria al nok), FR-012 (foto).
 *
 * TSK-OFF-007: el mismo panel registra y CORRIGE. Si el ítem ya tiene hallazgo
 * se abre con lo guardado (severidad, descripción y foto) y guardar actualiza
 * ese registro; antes se abría vacío y guardar creaba un duplicado. La
 * severidad no viene preseleccionada y un hallazgo alta/crítica exige
 * descripción (`lib/hallazgo.ts`).
 *
 * TSK-OFF-016: hasta MAX_FOTOS_HALLAZGO fotos. Las que ya salieron del teléfono
 * se muestran pero no se pueden quitar (la cola no borra en el servidor).
 *
 * MOVIMIENTO:
 * · Entrada con spring (420 ms, bounce 0.16) desde transform-origin en el
 *   botón que la abrió. Spring y no duración fija porque el usuario puede
 *   abrir y cerrar rápido: el spring conserva la velocidad y revierte suave,
 *   una transición de 300 ms se reinicia y se ve el tirón.
 * · El fondo entra con fade a 180 ms — más rápido que el panel, para que la
 *   lectura sea "el panel llega, el fondo solo se atenúa".
 * · El `Escape` y el botón Atrás del teléfono cierran sin animación.
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
import type { HallazgoGuardado } from '../lib/store'
import { MAX_FOTOS_HALLAZGO, erroresDeHallazgo, exigeDescripcion, type ErroresHallazgo } from '../lib/hallazgo'
import { useCapaAtras } from '../lib/useCapaAtras'
import { CamaraCaptura } from './CamaraCaptura'

const SEVS: Severidad[] = ['baja', 'media', 'alta', 'critica']

export function SheetHallazgo({
  item,
  onClose,
  onGuardar,
  cargar,
}: {
  item: ItemPlantilla | null
  onClose: () => void
  /** `fotosNuevas`: tomadas en esta apertura; `fotosQuitar`: ids de fotos guardadas que se quitan. */
  onGuardar: (sev: Severidad, descripcion: string, fotosNuevas: File[], fotosQuitar: string[]) => void
  /** Hallazgo ya guardado para el ítem (`null` si es nuevo). */
  cargar: (itemId: string) => Promise<HallazgoGuardado | null>
}) {
  const reducir = useReducedMotion()
  const [sev, setSev] = useState<Severidad | null>(null)
  const [desc, setDesc] = useState('')
  /** Fotos tomadas en esta apertura. */
  const [nuevas, setNuevas] = useState<File[]>([])
  /** Fotos que el hallazgo ya tenía guardadas. */
  const [previas, setPrevias] = useState<HallazgoGuardado['fotos']>([])
  /** Ids de fotos guardadas que la persona quitó en esta apertura. */
  const [quitar, setQuitar] = useState<string[]>([])
  const [editando, setEditando] = useState(false)
  const [errores, setErrores] = useState<ErroresHallazgo>({})
  const [camaraAbierta, setCamaraAbierta] = useState(false)
  const origen = useRef<HTMLElement | null>(null)
  const itemId = item?.id ?? null

  useCapaAtras(item !== null, onClose)

  useEffect(() => {
    if (!itemId) return
    setSev(null)
    setDesc('')
    setNuevas([])
    setPrevias([])
    setQuitar([])
    setEditando(false)
    setErrores({})
    // Guardamos el disparador para fijar transform-origin: el panel debe
    // crecer desde el botón que lo abrió, no desde el centro de la pantalla.
    origen.current = document.activeElement as HTMLElement
    let vivo = true
    void cargar(itemId).then((guardado) => {
      if (!vivo || !guardado) return
      setEditando(true)
      setSev(guardado.severidad)
      setDesc(guardado.descripcion)
      setPrevias(guardado.fotos)
    })
    return () => {
      vivo = false
    }
  }, [itemId, cargar])

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

  const conservadas = previas.filter((f) => !quitar.includes(f.id))
  const total = conservadas.length + nuevas.length
  const lleno = total >= MAX_FOTOS_HALLAZGO

  const guardar = () => {
    const e = erroresDeHallazgo(sev, desc)
    setErrores(e)
    if (!sev || e.severidad || e.descripcion) return
    onGuardar(sev, desc, nuevas, quitar)
  }

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
              aria-label={editando ? 'Editar hallazgo' : 'Registrar hallazgo'}
              initial={reducir ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                reducir
                  ? { opacity: 0 }
                  : { opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.2, ease: EASE.out } }
              }
              transition={reducir ? { duration: 0.15 } : { type: 'spring', duration: 0.42, bounce: 0.16 }}
              style={{ transformOrigin: origin }}
              className="pointer-events-auto w-[min(520px,100%)] max-h-[88dvh] overflow-y-auto overscroll-contain panel p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:pb-5 rounded-b-none sm:rounded-b-[14px] shadow-2xl"
            >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="label-inst">
                  {editando ? 'Editar hallazgo' : item.hallazgoObligatorio ? 'Hallazgo obligatorio' : 'Nuevo hallazgo'}
                </p>
                <h2 className="mt-1.5 text-[19px] font-semibold tracking-[-0.025em] leading-snug">
                  {item.texto}
                </h2>
                <p className="mt-1 text-[13px] text-ink-2">{item.seccion}</p>
              </div>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="h-11 w-11 shrink-0 grid place-items-center rounded-lg text-ink-2 hover:text-ink hover:bg-s3 transition-colors duration-150 cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                  <path d="m2 2 9 9M11 2l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Severidad — segmentado con pop. Sin valor por omisión: la elige
                quien vio el problema. */}
            <div className="mt-5">
              <p className="label-inst mb-2" id="hallazgo-severidad">Severidad</p>
              <div
                role="group"
                aria-labelledby="hallazgo-severidad"
                aria-describedby={errores.severidad ? 'hallazgo-error-severidad' : undefined}
                className={[
                  'grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-s0 border',
                  errores.severidad ? 'border-failed' : 'border-campo',
                ].join(' ')}
              >
                {SEVS.map((s) => {
                  const m = SEV_META[s]
                  const sel = sev === s
                  return (
                    <motion.button
                      key={s}
                      type="button"
                      aria-pressed={sel}
                      onClick={() => {
                        setSev(s)
                        setErrores((e) => ({ ...e, severidad: undefined }))
                      }}
                      whileTap={reducir ? undefined : { scale: 0.94 }}
                      animate={{
                        backgroundColor: sel ? m.bg : 'transparent',
                        borderColor: sel ? `color-mix(in oklab, ${m.color} 50%, transparent)` : 'transparent',
                      }}
                      transition={{ duration: 0.2, ease: EASE.out }}
                      className="h-12 rounded-lg border cursor-pointer grid place-items-center"
                    >
                      <motion.span
                        animate={{ color: sel ? m.color : 'var(--color-ink-2)', scale: sel ? 1 : 0.94 }}
                        transition={
                          sel && !reducir
                            ? { type: 'spring', duration: 0.32, bounce: 0.3 }
                            : { duration: 0.18 }
                        }
                        className="num-inst text-[12px] font-semibold uppercase tracking-[0.04em]"
                      >
                        {m.label}
                      </motion.span>
                    </motion.button>
                  )
                })}
              </div>
              {errores.severidad ? (
                <p id="hallazgo-error-severidad" role="alert" className="mt-2 text-[13px] font-medium text-failed">
                  {errores.severidad}
                </p>
              ) : (
                sev && (
                  <p className="mt-2 text-[13px] text-ink-2 leading-relaxed">
                    {exigeDescripcion(sev)
                      ? 'Supervisión lo verá destacado apenas se envíe.'
                      : 'Queda en el listado de hallazgos de la inspección.'}
                  </p>
                )
              )}
            </div>

            {/* Descripción */}
            <label className="block mt-5">
              <span className="label-inst">
                Descripción{exigeDescripcion(sev) ? ' (obligatoria)' : ''}
              </span>
              <textarea
                value={desc}
                onChange={(e) => {
                  setDesc(e.target.value)
                  setErrores((x) => ({ ...x, descripcion: undefined }))
                }}
                rows={4}
                name="hallazgo-descripcion"
                aria-invalid={errores.descripcion ? true : undefined}
                aria-describedby={errores.descripcion ? 'hallazgo-error-descripcion' : undefined}
                placeholder="Qué observaste, dónde exactamente y qué recomiendas…"
                className={[
                  'mt-1.5 w-full px-3 py-2.5 rounded-[10px] bg-s0 border text-[14px] leading-relaxed placeholder:text-ink-3 transition-colors duration-150 resize-none',
                  errores.descripcion ? 'border-failed' : 'border-campo',
                ].join(' ')}
              />
            </label>
            {errores.descripcion && (
              <p id="hallazgo-error-descripcion" role="alert" className="mt-2 text-[13px] font-medium text-failed">
                {errores.descripcion}
              </p>
            )}

            {/* FR-011/012 + TSK-OFF-016: evidencia fotográfica, varias fotos. */}
            <CamaraCaptura
              abierta={camaraAbierta}
              alCerrar={() => setCamaraAbierta(false)}
              alCapturar={(f) => setNuevas((n) => [...n, f])}
            />
            <div className="mt-5">
              <p className="label-inst mb-2">
                Fotos ({total} de {MAX_FOTOS_HALLAZGO})
              </p>
              {total > 0 && (
                <ul className="mb-3 flex flex-wrap gap-2">
                  {conservadas.map((f, i) => (
                    <li key={f.id}>
                      <MiniaturaFoto
                        blob={f.blob}
                        etiqueta={`Foto ${i + 1}`}
                        enviada={f.enviada}
                        onQuitar={f.enviada ? undefined : () => setQuitar((q) => [...q, f.id])}
                      />
                    </li>
                  ))}
                  {nuevas.map((f, i) => (
                    <li key={`nueva-${i}`}>
                      <MiniaturaFoto
                        blob={f}
                        etiqueta={`Foto ${conservadas.length + i + 1}`}
                        enviada={false}
                        onQuitar={() => setNuevas((n) => n.filter((_, k) => k !== i))}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                disabled={lleno}
                onClick={() => setCamaraAbierta(true)}
                className="w-full min-h-11 flex items-center justify-center gap-2 rounded-[10px] border border-campo bg-s1 px-3.5 text-[14px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg width="18" height="18" viewBox="0 0 17 17" fill="none" aria-hidden>
                  <path d="M2.5 4.5h3l1.2-1.6h3.6l1.2 1.6h3v9h-12v-9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  <circle cx="8.5" cy="8.8" r="2.3" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                {lleno ? 'Máximo de fotos alcanzado' : total === 0 ? 'Agregar foto (opcional)' : 'Agregar otra foto'}
              </button>
            </div>

            <div className="mt-6 flex gap-2 justify-end">
              <Boton variante="fantasma" onClick={onClose}>
                Cancelar
              </Boton>
              <Boton variante="primaria" onClick={guardar}>
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

/** Miniatura de una foto del hallazgo, con su botón para quitarla si aún no salió del teléfono. */
function MiniaturaFoto({
  blob,
  etiqueta,
  enviada,
  onQuitar,
}: {
  blob: Blob
  etiqueta: string
  enviada: boolean
  onQuitar?: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return (
    <div className="flex flex-col items-center gap-1">
      {url ? (
        <img src={url} alt={etiqueta} width={64} height={64} className="h-16 w-16 rounded-lg object-cover border border-line" />
      ) : (
        <span className="h-16 w-16 rounded-lg bg-s3" aria-hidden />
      )}
      {onQuitar ? (
        <button
          type="button"
          onClick={onQuitar}
          aria-label={`Quitar ${etiqueta.toLowerCase()}`}
          className="min-h-11 px-2 text-[13px] text-ink-2 underline underline-offset-2 cursor-pointer"
        >
          Quitar
        </button>
      ) : (
        <span className="min-h-11 grid place-items-center text-[12px] text-ink-3">{enviada ? 'Enviada' : ''}</span>
      )}
    </div>
  )
}
