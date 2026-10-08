/* Render data-driven de una sección de plantilla (TSK-FORM-001, FR-036).
 *
 * El formulario NO está hardcodeado: lee `TemplateSection` (la misma
 * definición que validó el backend con Zod al publicar) y dibuja un control
 * por `response_type`. El estado, la validación (FR-039) y la persistencia
 * del borrador viven en el store; acá solo se compone la UI.
 *
 * MOVIMIENTO: la sección entra con fade + 8 px (una sola vez, al montar) y
 * sus filas con stagger de 40 ms. Nunca al hacer scroll. El resto (focus,
 * hover) no se anima.
 */

import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { TemplateItem, TemplateSection } from '@terreno/shared'
import { Boton } from './ui'
import {
  CampoFecha,
  CampoFoto,
  CampoHora,
  CampoNumerico,
  CampoOkNokNa,
  CampoSeleccion,
  CampoSeleccionMultiple,
  CampoTexto,
} from './Campos'
import { contestado } from '../lib/valores'
import { useEstado } from '../lib/store'
import { EASE, STAGGER } from '../lib/motion'

interface PropsSeccion {
  section: TemplateSection
  /** Base del stagger de filas (índice de la sección dentro del form). */
  delayBase?: number
  onAbrirHallazgo: (item: TemplateItem, seccion: string) => void
}

export function FormRenderer({ section, delayBase = 0, onAbrirHallazgo }: PropsSeccion) {
  const { respuestas } = useEstado()
  const reducir = useReducedMotion()
  const items = section.items
  const contestados = items.filter((i) => contestado(respuestas[i.id]?.campo)).length

  return (
    <motion.section
      initial={reducir ? { opacity: 1 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE.out, delay: delayBase * STAGGER + 0.05 }}
      className="space-y-2.5"
    >
      <div className="flex items-center gap-3 px-0.5">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em]">{section.title}</h2>
        <div className="flex-1 rule" />
        <span className="label-inst">
          {contestados}/{items.length}
        </span>
      </div>

      {items.map((item, i) => (
        <FilaCampo
          key={item.id}
          item={item}
          seccion={section.title}
          delay={reducir ? 0 : (delayBase + i) * STAGGER + 0.08}
          onAbrirHallazgo={onAbrirHallazgo}
        />
      ))}
    </motion.section>
  )
}

function FilaCampo({
  item,
  seccion,
  delay,
  onAbrirHallazgo,
}: {
  item: TemplateItem
  seccion: string
  delay: number
  onAbrirHallazgo: (item: TemplateItem, seccion: string) => void
}) {
  const { respuestas, erroresCampo, responderCampo } = useEstado()
  const reducir = useReducedMotion()
  const r = respuestas[item.id]
  const campo = r?.campo ?? null
  const error = erroresCampo[item.id]
  const props = item.props ?? {}
  // FR-032: un nok en ítem con hallazgo obligatorio muestra la acción.
  const requiereHallazgo = campo === 'nok' && (item.require_finding_on_nok ?? false)
  const conHallazgo = !!r?.hallazgoId

  const control: Record<TemplateItem['response_type'], ReactNode> = {
    ok_nok_na: (
      <CampoOkNokNa
        item={item}
        valor={campo}
        onCambio={(v) => responderCampo(item.id, v)}
      />
    ),
    text: (
      <CampoTexto item={item} valor={campo} error={error} onCambio={(v) => responderCampo(item.id, v)} />
    ),
    numeric: (
      <CampoNumerico
        item={item}
        valor={campo}
        error={error}
        onCambio={(v) => responderCampo(item.id, v)}
      />
    ),
    date: (
      <CampoFecha item={item} valor={campo} error={error} onCambio={(v) => responderCampo(item.id, v)} />
    ),
    time: (
      <CampoHora item={item} valor={campo} error={error} onCambio={(v) => responderCampo(item.id, v)} />
    ),
    select_single: (
      <CampoSeleccion
        item={item}
        valor={campo}
        error={error}
        onCambio={(v) => responderCampo(item.id, v)}
      />
    ),
    select_multiple: (
      <CampoSeleccionMultiple
        item={item}
        valor={campo}
        error={error}
        onCambio={(v) => responderCampo(item.id, v)}
      />
    ),
    photo: (
      <CampoFoto
        item={item}
        valor={campo}
        error={error}
        onCambio={(v) => responderCampo(item.id, v)}
        onFoto={(f) => responderCampo(item.id, 'capturada', { foto: f })}
      />
    ),
  }

  return (
    <motion.div
      initial={reducir ? { opacity: 1 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE.out, delay }}
      className={[
        'panel p-4 transition-colors duration-250 ease-out',
        requiereHallazgo && !conHallazgo ? 'border-failed/35 bg-failed/[0.04]' : '',
      ].join(' ')}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 sm:pt-0.5">
          <p className="text-[14px] leading-snug">{item.prompt}</p>
          {item.help && <p className="mt-1 text-[12px] text-ink-3">{item.help}</p>}
          {props.required && item.response_type !== 'ok_nok_na' && (
            <p className="label-inst mt-1.5">Obligatorio</p>
          )}
          {item.require_finding_on_nok && (
            <p className="label-inst mt-1.5" style={{ color: 'var(--color-sev-alta)' }}>
              Hallazgo obligatorio si es NOK
            </p>
          )}
        </div>
        <div className="w-full sm:w-auto flex sm:justify-end shrink-0">
          {control[item.response_type]}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2.5 text-[12px] font-medium text-failed">
          {error}
        </p>
      )}

      <AnimatePresence>
        {requiereHallazgo && (
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
                  onClick={() => onAbrirHallazgo(item, seccion)}
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
                <Boton
                  tamano="sm"
                  variante="peligro"
                  icono={
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                      <path d="M6.5 1.6 12 11.4H1L6.5 1.6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                      <path d="M6.5 5.6v2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      <circle cx="6.5" cy="9.8" r="0.75" fill="currentColor" />
                    </svg>
                  }
                  onClick={() => onAbrirHallazgo(item, seccion)}
                >
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
