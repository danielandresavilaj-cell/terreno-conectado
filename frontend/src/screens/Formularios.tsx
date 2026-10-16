import { useState } from 'react'
import { Chip } from '../components/Badges'
import { Boton } from '../components/ui'
import { useEstado } from '../lib/store'
import { itemsDe } from '../lib/valores'

/** Punto de entrada de terreno: sólo muestra formularios que el servidor ya
 * filtró por la faena y rol del usuario autenticado. */
export function Formularios() {
  const { formularios, plantilla, hayBorrador, seleccionarFormulario, ir } = useEstado()
  const [error, setError] = useState<string | null>(null)

  const abrir = async (revisionId: string) => {
    setError(null)
    const r = await seleccionarFormulario(revisionId)
    if (!r.ok) {
      setError(r.error ?? 'No se pudo abrir el formulario.')
      return
    }
    ir('captura')
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="label-inst">Formularios asignados</p>
        <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1] text-pretty">
          Elegí qué vas a inspeccionar
        </h1>
        <p className="mt-2 text-[13px] text-ink-2 max-w-[62ch] leading-relaxed">
          Sólo aparecen los formularios habilitados para tu faena y tu rol. Tu selección se conserva
          en este dispositivo hasta que elijas otro formulario.
        </p>
      </header>

      {hayBorrador && plantilla && (
        <section className="panel p-4 border-beam/35 bg-beam/[0.05] flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="label-inst">Borrador en curso</p>
            <p className="mt-1 text-[14px] font-semibold truncate">{plantilla.nombre}</p>
            <p className="mt-1 text-[12px] text-ink-2">Terminá o descartá este borrador antes de cambiar de formulario.</p>
          </div>
          <Boton tamano="sm" variante="primaria" onClick={() => ir('captura')}>
            Continuar
          </Boton>
        </section>
      )}

      {error && <p className="rounded-[10px] border border-sev-alta/40 bg-sev-alta/10 px-3.5 py-2.5 text-[13px] text-sev-alta" role="status" aria-live="polite">{error}</p>}

      {formularios.length === 0 ? (
        <section className="panel p-8 text-center">
          <h2 className="text-[15px] font-semibold">Todavía no tenés formularios asignados</h2>
          <p className="mt-2 text-[13px] text-ink-2 max-w-[48ch] mx-auto leading-relaxed">
            Pedile al administrador que publique el formulario y lo asigne a tu faena y rol desde Plantillas.
          </p>
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2">
          {formularios.map((formulario) => {
            const activa = plantilla?.revisionId === formulario.revision_id
            return (
              <article key={formulario.revision_id} className="panel p-5 flex flex-col gap-4 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[16px] font-semibold tracking-[-0.015em] break-words">{formulario.name}</h2>
                    <p className="mt-1 text-[12px] text-ink-3">
                      {itemsDe(formulario.definition).length} ítems · versión {formulario.version}
                    </p>
                  </div>
                  {activa && <Chip color="var(--color-beam)">Seleccionado</Chip>}
                </div>
                <Boton variante={activa ? 'secundaria' : 'primaria'} onClick={() => void abrir(formulario.revision_id)}>
                  {hayBorrador && activa ? 'Continuar formulario' : activa ? 'Abrir formulario' : 'Usar este formulario'}
                </Boton>
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}
