/* Captura en terreno — FR-011, FR-012, FR-013, FR-030, FR-031, FR-032.
 *
 * Esta es la pantalla que se usa en modo avión, con guantes y bajo el sol.
 * Todo lo que hay aquí está diseñado para eso: targets grandes, alto contraste,
 * sin depender del hover ni del texto pequeño.
 *
 * MOVIMIENTO (decisiones — esta pantalla es la de mayor frecuencia):
 * · El control ok/nok/na hace pop al seleccionarse (spring 260 ms, bounce 0.22).
 *   Es LA interacción del producto y se repite decenas de veces por turno.
 *   Un pop Spring da la sensación de "el botón respondió a un empujón físico",
 *   que es exactamente lo que un trabajador con guante espera. Pero debe ser
 *   RÁPIDO: si dura 500 ms el turno se siente lento. 260 ms es el techo.
 * · El progreso de la barra se anima en scaleX al responder. Comunica avance.
 * · El sheet de hallazgo entra con transform-origin en el botón que lo abrió.
 *   Es la excepción a "nada aparece de la nada": el origen en el espacio explica
 *   de dónde salió el panel, así que el usuario no pierde el hilo.
 * · Las secciones del checklist entran con stagger de 40 ms al montar, una sola
 *   vez. Nunca al hacer scroll.
 * · NO anima: el focus de los campos de texto, el scroll, el hover de las filas.
 */

import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { BadgeSev, Chip } from '../components/Badges'
import { Boton } from '../components/ui'
import { SheetHallazgo } from '../components/SheetHallazgo'
import { useEstado } from '../lib/store'
import { PLANTILLA } from '../lib/seed'
import { EASE, STAGGER } from '../lib/motion'
import type { ItemPlantilla } from '../lib/types'

const OPCIONES = [
  { v: 'ok' as const, label: 'OK', color: 'var(--color-synced)', desc: 'Conforme' },
  { v: 'nok' as const, label: 'NOK', color: 'var(--color-failed)', desc: 'No conforme' },
  { v: 'na' as const, label: 'N/A', color: 'var(--color-pending)', desc: 'No aplica' },
]

export function Captura() {
  const { respuestas, responder, responderTexto, crearHallazgo, pendientes, enviarInspeccion, online, usuario } =
    useEstado()
  const [sheetItem, setSheetItem] = useState<ItemPlantilla | null>(null)
  const reducir = useReducedMotion()

  const secciones = [...new Set(PLANTILLA.map((i) => i.seccion))]
  const contestados = PLANTILLA.filter((i) => respuestas[i.id]?.valor).length
  const noks = PLANTILLA.filter((i) => respuestas[i.id]?.valor === 'nok').length
  const pct = Math.round((contestados / PLANTILLA.length) * 100)

  return (
    <div className="space-y-6">
      {/* ── Encabezado de la inspección ───────────────────────────────────── */}
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="label-inst">FR-011 · Captura offline</p>
            <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
              Seguridad en rajo
            </h1>
            <p className="mt-1.5 text-[13px] text-ink-2">
              {usuario?.faena} · Turno B · v3 de la plantilla
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip color={online ? 'var(--color-synced)' : 'var(--color-pending)'}>
              {online ? 'Guardado en cola · online' : 'Guardado en dispositivo'}
            </Chip>
          </div>
        </div>

        {/* Progreso: barra que crece en scaleX. Comunica avance sin texto. */}
        <div className="mt-5 panel p-4">
          <div className="flex items-end justify-between gap-4 mb-3">
            <div>
              <p className="label-inst">Progreso de la inspección</p>
              <p className="mt-1 num-inst text-[15px]">
                {contestados} <span className="text-ink-3">de {PLANTILLA.length} ítems</span>
              </p>
            </div>
            <div className="text-right">
              <p className="num-inst text-[22px] font-semibold text-beam">{pct}%</p>
              {noks > 0 && (
                <p className="text-[11px] text-failed font-medium">{noks} con hallazgo</p>
              )}
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-s3 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-beam"
              initial={false}
              animate={{ scaleX: Math.max(0.02, pct / 100) }}
              transition={{ duration: 0.45, ease: EASE.out }}
              style={{ transformOrigin: 'left center' }}
            />
          </div>
          <p className="mt-3 text-[11px] text-ink-3 leading-relaxed">
            El borrador se autoguarda en cada cambio (FR-014). Podés cerrar la app y seguir
            después: el dato no se pierde.
          </p>
        </div>
      </header>

      {/* ── Secciones del checklist ───────────────────────────────────────── */}
      {secciones.map((sec, si) => {
        const items = PLANTILLA.filter((i) => i.seccion === sec)
        return (
          <motion.section
            key={sec}
            initial={reducir ? { opacity: 1 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE.out, delay: si * STAGGER + 0.05 }}
            className="space-y-2.5"
          >
            <div className="flex items-center gap-3 px-0.5">
              <h2 className="text-[13px] font-semibold tracking-[-0.01em]">{sec}</h2>
              <div className="flex-1 rule" />
              <span className="label-inst">
                {items.filter((i) => respuestas[i.id]?.valor).length}/{items.length}
              </span>
            </div>

            {items.map((item) => (
              <FilaItem
                key={item.id}
                item={item}
                valor={respuestas[item.id]?.valor ?? null}
                texto={respuestas[item.id]?.texto ?? ''}
                conHallazgo={!!respuestas[item.id]?.hallazgoId}
                onElegir={(v) => {
                  responder(item.id, v)
                  // FR-032: un nok con hallazgoObligatorio abre el registro.
                  if (v === 'nok' && item.hallazgoObligatorio) setSheetItem(item)
                }}
                onTexto={(t) => responderTexto(item.id, t)}
                onAbrirHallazgo={() => setSheetItem(item)}
              />
            ))}
          </motion.section>
        )
      })}

      {/* ── Pie ───────────────────────────────────────────────────────────── */}
      <div className="panel p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span
            className={[
              'h-2 w-2 rounded-full shrink-0',
              pendientes > 0 ? 'bg-pending' : 'bg-synced',
            ].join(' ')}
          />
          <p className="text-[12px] text-ink-2">
            {pendientes > 0 ? (
              <>
                <span className="num-inst text-ink">{pendientes}</span> registro
                {pendientes > 1 ? 's' : ''} en la cola local
              </>
            ) : (
              'Todo sincronizado'
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Boton tamano="sm" variante="secundaria">
            Guardar borrador
          </Boton>
          <Boton tamano="sm" variante="primaria" onClick={() => void enviarInspeccion()}>
            Enviar inspección
          </Boton>
        </div>
      </div>

      <SheetHallazgo
        item={sheetItem}
        onClose={() => setSheetItem(null)}
        onGuardar={(sev, desc, foto) => {
          if (sheetItem) crearHallazgo(sheetItem.id, sev, desc, foto)
          setSheetItem(null)
        }}
      />
    </div>
  )
}

/* ── Fila de ítem ────────────────────────────────────────────────────────
 * El control ok/nok/na usa un knob deslizante con layout animation en lugar
 * de un simple cambio de color: el usuario ve QUÉ opción está activa antes de
 * leer la etiqueta, y el movimiento del knob guía la mirada.
 */
function FilaItem({
  item,
  valor,
  texto,
  conHallazgo,
  onElegir,
  onTexto,
  onAbrirHallazgo,
}: {
  item: ItemPlantilla
  valor: 'ok' | 'nok' | 'na' | null
  texto: string
  conHallazgo: boolean
  onElegir: (v: 'ok' | 'nok' | 'na') => void
  onTexto: (t: string) => void
  onAbrirHallazgo: () => void
}) {
  const reducir = useReducedMotion()
  const activo = OPCIONES.find((o) => o.v === valor) ?? null
  const idx = Math.max(0, OPCIONES.findIndex((o) => o.v === valor))
  const abierto = !!(valor && item.hallazgoObligatorio && valor === 'nok')

  if (item.tipo !== 'ok_nok_na') {
    return (
      <motion.div
        initial={reducir ? { opacity: 1 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE.out }}
        className="panel p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <div className="min-w-0">
          <p className="text-[14px] leading-snug">{item.texto}</p>
          <p className="label-inst mt-1.5">{item.tipo}</p>
        </div>
        {/* El campo ocupa el ancho completo en móvil: con 190px de ancho fijo
            al lado del texto quedaban ~140px útiles, insuficiente para escribir
            un valor numérico con guante. */}
        <input
          value={texto}
          onChange={(e) => onTexto(e.target.value)}
          placeholder={item.tipo === 'numerico' ? '0,00' : 'Escribir…'}
          inputMode={item.tipo === 'numerico' ? 'decimal' : 'text'}
          className="h-11 w-full sm:w-auto sm:max-w-[190px] px-3 rounded-[10px] bg-s0 border border-line-soft text-[14px] placeholder:text-ink-3 focus:border-beam transition-colors duration-150 shrink-0"
        />
      </motion.div>
    )
  }

  return (
    <motion.div
      layout="position"
      transition={{ duration: 0.28, ease: EASE.out }}
      className={[
        'panel p-3.5 transition-colors duration-250 ease-out',
        abierto ? 'border-failed/35 bg-failed/[0.04]' : '',
      ].join(' ')}
    >
      {/* En pantallas angostas el texto del ítem y el segmentado no caben en una
          sola línea: el segmentado baja debajo y ocupa el ancho completo. Con
          el texto arriba y el control abajo, el pulgar cubre menos superficie
          y los tres targets quedan más anchos que 46px, que es lo que pide
          el uso con guantes. En sm+ vuelve a la fila de una línea. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 sm:pt-0.5">
          <p className="text-[14px] leading-snug">{item.texto}</p>
          {item.hallazgoObligatorio && (
            <p className="label-inst mt-1.5" style={{ color: 'var(--color-sev-alta)' }}>
              Hallazgo obligatorio si es NOK
            </p>
          )}
        </div>

        {/* Segmentado — 3 targets de 48px: pulsables con guante. */}
        <div
          role="radiogroup"
          aria-label={`Respuesta para: ${item.texto}`}
          className="relative shrink-0 flex p-1 rounded-xl bg-s0 border border-line-soft w-full sm:w-auto"
        >
          {/* Knob activo. Se posiciona con `x` en porcentajes del ancho del
              track, no con `left`: es un transform puro, GPU, e interruptible
              si el usuario corrige la respuesta rápido (un keyframe o un
              left animados se reinician y el knob "salta"). */}
          {activo && (
            <motion.span
              aria-hidden
              initial={false}
              animate={{ x: `${idx * 100}%` }}
              transition={
                reducir ? { duration: 0 } : { type: 'spring', duration: 0.34, bounce: 0.22 }
              }
              className="absolute top-1 bottom-1 left-1 rounded-lg"
              style={{
                width: `calc((100% - 8px) / ${OPCIONES.length})`,
                background: `color-mix(in oklab, ${activo.color} 20%, transparent)`,
                border: `1px solid color-mix(in oklab, ${activo.color} 45%, transparent)`,
              }}
            />
          )}

          {OPCIONES.map((o) => {
            const sel = valor === o.v
            return (
              <motion.button
                key={o.v}
                role="radio"
                aria-checked={sel}
                onClick={() => onElegir(o.v)}
                whileTap={reducir ? undefined : { scale: 0.94 }}
                transition={{ duration: 0.14, ease: EASE.out }}
                className="relative z-10 h-12 min-w-[46px] flex-1 grid place-items-center rounded-lg cursor-pointer"
              >
                <motion.span
                  animate={{ color: sel ? o.color : 'var(--color-ink-3)' }}
                  transition={{ duration: 0.18, ease: EASE.out }}
                  className="num-inst text-[13px] font-semibold tracking-[0.04em]"
                >
                  {o.label}
                </motion.span>
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* FR-032: al responder nok con hallazgo obligatorio, aparece la acción
          para registrarlo. Entrada con fade + alto, sin rebote: es una
          exigencia de requisito, no una celebración. */}
      <AnimatePresence>
        {abierto && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.26, ease: EASE.out }}
            className="overflow-hidden"
          >
            <div className="pt-3.5 mt-3.5 border-t border-line-soft">
              {conHallazgo ? (
                <button
                  onClick={onAbrirHallazgo}
                  className="w-full flex items-center justify-between gap-3 text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-failed shrink-0" />
                    <span className="text-[13px] text-ink-2 truncate">
                      Hallazgo registrado · ver y editar
                    </span>
                  </div>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    className="shrink-0 text-ink-3 group-hover:text-ink transition-colors"
                    aria-hidden
                  >
                    <path d="m5 3 5 4-5 4V3Z" fill="currentColor" />
                  </svg>
                </button>
              ) : (
                <Boton tamano="sm" variante="peligro" icono={<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden><path d="M6.5 1.6 12 11.4H1L6.5 1.6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M6.5 5.6v2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="6.5" cy="9.8" r="0.75" fill="currentColor" /></svg>} onClick={onAbrirHallazgo}>
                  Registrar hallazgo
                </Boton>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export { BadgeSev }
