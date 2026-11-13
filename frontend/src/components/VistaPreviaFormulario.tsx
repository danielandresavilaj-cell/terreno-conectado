/* Vista previa de un formulario publicado — TSK-FORM-023.
 *
 * Muestra secciones y preguntas como las verá el trabajador (tipo de respuesta,
 * opciones, obligatorio, hallazgo exigido), sin crear inspecciones ni respuestas.
 * Es de sólo lectura a propósito: la captura real pasa por el borrador offline.
 */
import { useEffect, useRef } from 'react'
import type { TemplateDefinition, TemplateItem } from '@terreno/shared'
import { useCapaAtras } from '../lib/useCapaAtras'

const TIPO: Record<TemplateItem['response_type'], string> = {
  ok_nok_na: 'OK · NOK · N/A',
  text: 'Texto libre',
  numeric: 'Número',
  date: 'Fecha',
  time: 'Hora',
  select_single: 'Una opción',
  select_multiple: 'Varias opciones',
  photo: 'Foto',
}

export function VistaPreviaFormulario({
  nombre,
  version,
  definition,
  alCerrar,
}: {
  nombre: string
  version: number
  definition: TemplateDefinition
  alCerrar: () => void
}) {
  const cerrar = useRef<HTMLButtonElement>(null)
  useCapaAtras(true, alCerrar)
  useEffect(() => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cerrar.current?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') alCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => {
      window.removeEventListener('keydown', tecla)
      if (previo?.isConnected) previo.focus()
    }
  }, [alCerrar])

  const total = definition.sections.reduce((n, s) => n + s.items.length, 0)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Vista previa de ${nombre}`}
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/65 p-0 sm:p-4"
      onClick={alCerrar}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(640px,100%)] max-h-[90dvh] overflow-y-auto overscroll-contain panel p-5 rounded-b-none sm:rounded-b-[14px] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label-inst">Vista previa · como lo verá el trabajador</p>
            <h2 className="mt-1 text-[19px] font-semibold break-words">{nombre}</h2>
            <p className="mt-1 text-[13px] text-ink-2">
              Versión {version} · {total} {total === 1 ? 'pregunta' : 'preguntas'}
              {definition.closing?.require_supervisor_signature ? ' · pide cofirma de supervisión' : ''}
            </p>
          </div>
          <button
            ref={cerrar}
            type="button"
            onClick={alCerrar}
            className="h-11 px-4 shrink-0 rounded-lg border border-campo bg-s3 text-[14px] font-medium cursor-pointer"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-5 space-y-5">
          {definition.sections.map((s, si) => (
            <section key={s.id ?? `${si}-${s.title}`}>
              <h3 className="text-[15px] font-semibold">{s.title}</h3>
              <ol className="mt-2 space-y-2">
                {s.items.map((item) => (
                  <li key={item.id} className="rounded-xl border border-line-soft bg-s0 px-3.5 py-3">
                    <p className="text-[14px] leading-snug">{item.prompt}</p>
                    {item.help && <p className="mt-1 text-[13px] text-ink-2">{item.help}</p>}
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
                      <span className="rounded-md bg-s3 px-2 py-1 text-ink-2">{TIPO[item.response_type]}</span>
                      {item.props?.required && <span className="rounded-md bg-s3 px-2 py-1 text-ink-2">Obligatoria</span>}
                      {item.require_finding_on_nok && (
                        <span className="rounded-md bg-s3 px-2 py-1 text-sev-alta">Hallazgo si es NOK</span>
                      )}
                      {(item.props?.options ?? []).map((o) => (
                        <span key={o} className="rounded-md border border-line-soft px-2 py-1 text-ink-2">
                          {o}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
