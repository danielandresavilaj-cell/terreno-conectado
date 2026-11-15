/* Catálogo de plantillas de inicio — TSK-FORM-025 (FR-070).
 *
 * Diálogo de Plantillas → "Desde el catálogo". Lista las plantillas de
 * `@terreno/shared` con su vista previa; "Usar en mi empresa" lo resuelve la
 * pantalla (crea la copia propia y la publica). Las que la empresa ya usa (por
 * nombre) se marcan, pero se pueden volver a usar: la copia se nombra
 * "(copia)".
 */
import { useEffect, useRef, useState } from 'react'
import { CATALOGO_PLANTILLAS, totalPreguntas, type PlantillaCatalogo } from '@terreno/shared'
import { Boton } from './ui'
import { Chip } from './Badges'
import { VistaPreviaFormulario } from './VistaPreviaFormulario'
import { useCapaAtras } from '../lib/useCapaAtras'

export function CatalogoPlantillas({
  existentes,
  usando,
  alUsar,
  alCerrar,
}: {
  /** Nombres de los formularios que la empresa ya tiene (publicados o archivados). */
  existentes: readonly string[]
  /** Clave de la plantilla que se está copiando, si hay una en curso. */
  usando: string | null
  alUsar: (p: PlantillaCatalogo) => void
  alCerrar: () => void
}) {
  const [previa, setPrevia] = useState<PlantillaCatalogo | null>(null)
  const cerrar = useRef<HTMLButtonElement>(null)
  useCapaAtras(true, alCerrar)

  useEffect(() => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cerrar.current?.focus()
    return () => {
      if (previo?.isConnected) previo.focus()
    }
  }, [])

  useEffect(() => {
    // Con la vista previa abierta, Escape cierra sólo la vista previa.
    if (previa) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') alCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [previa, alCerrar])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Catálogo de plantillas"
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/65 p-0 sm:p-4"
      onClick={alCerrar}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(720px,100%)] max-h-[90dvh] overflow-y-auto overscroll-contain panel p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:pb-5 rounded-b-none sm:rounded-b-[14px] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label-inst">Plantillas de inicio</p>
            <h2 className="mt-1 text-[19px] font-semibold">Desde el catálogo</h2>
            <p className="mt-1 text-[13px] text-ink-2 leading-relaxed">
              Formularios típicos de faena y obra. Al usar uno se crea una copia publicada de tu empresa: luego la
              asignas a faenas y roles, y puedes duplicarla o archivarla como cualquier otra.
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

        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {CATALOGO_PLANTILLAS.map((p) => {
            const yaUsada = existentes.includes(p.nombre)
            const total = totalPreguntas(p.definition)
            return (
              <li key={p.clave} className="rounded-xl border border-line-soft bg-s0 p-4 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip>{p.categoria}</Chip>
                  {p.definition.closing?.require_supervisor_signature && <Chip>Cofirma</Chip>}
                  {yaUsada && <Chip color="var(--color-synced)">Ya en tu empresa</Chip>}
                </div>
                <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{p.nombre}</h3>
                <p className="text-[13px] text-ink-2 leading-relaxed flex-1">{p.descripcion}</p>
                <p className="label-inst">
                  {p.definition.sections.length} secciones · {total} preguntas
                </p>
                <div className="flex flex-wrap gap-2">
                  <Boton tamano="sm" variante="fantasma" onClick={() => setPrevia(p)}>
                    Vista previa
                  </Boton>
                  <Boton
                    tamano="sm"
                    variante={yaUsada ? 'secundaria' : 'primaria'}
                    disabled={usando !== null}
                    onClick={() => alUsar(p)}
                  >
                    {usando === p.clave ? 'Creando…' : yaUsada ? 'Usar otra vez' : 'Usar en mi empresa'}
                  </Boton>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {previa && (
        <div onClick={(e) => e.stopPropagation()}>
          <VistaPreviaFormulario nombre={previa.nombre} definition={previa.definition} alCerrar={() => setPrevia(null)} />
        </div>
      )}
    </div>
  )
}
