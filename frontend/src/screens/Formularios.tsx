import { useState } from 'react'
import { Chip } from '../components/Badges'
import { Boton } from '../components/ui'
import { useEstado } from '../lib/store'
import { itemsDe } from '../lib/valores'

/** Punto de entrada de terreno: sólo muestra formularios que el servidor ya
 * filtró por la faena y rol del usuario autenticado. */
export function Formularios() {
  const {
    formularios,
    plantilla,
    hayBorrador,
    seleccionarFormulario,
    ir,
    usuario,
    identidad,
    faenaPorElegir,
    cambiarFaena,
    hallazgosNuevos,
  } = useEstado()
  const [error, setError] = useState<string | null>(null)
  const [cambiando, setCambiando] = useState<string | null>(null)
  const faenas = identidad?.faenas ?? []

  /* TSK-OFF-010 (FR-034): con más de una faena, la persona dice en cuál está. */
  const elegirFaena = async (faenaId: string) => {
    if (faenaId === usuario?.faenaId && !faenaPorElegir) return
    setError(null)
    setCambiando(faenaId)
    const r = await cambiarFaena(faenaId)
    setCambiando(null)
    if (!r.ok) setError(r.error ?? 'No se pudo cambiar de faena.')
  }

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
        <p className="label-inst">Formularios</p>
        <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1] text-pretty">
          Elige qué vas a inspeccionar
        </h1>
        <p className="mt-2 text-[14px] text-ink-2 max-w-[62ch] leading-relaxed">
          Estos son los formularios habilitados para {usuario?.faena && usuario.faena !== '—' ? usuario.faena : 'tu faena'}.
        </p>
      </header>

      {/* TSK-DOM-008 (FR-067): al abrir la app, la persona se entera de lo que le asignaron. */}
      {hallazgosNuevos > 0 && (
        <section className="panel p-4 border-beam/45 bg-beam/[0.06] flex flex-wrap items-center justify-between gap-3" role="status">
          <p className="text-[15px] font-semibold">
            {hallazgosNuevos === 1
              ? 'Tienes 1 hallazgo nuevo asignado'
              : `Tienes ${hallazgosNuevos} hallazgos nuevos asignados`}
          </p>
          <button
            type="button"
            onClick={() => ir('hallazgos')}
            className="min-h-11 px-4 rounded-[10px] bg-beam text-on-beam text-[14px] font-semibold cursor-pointer"
          >
            Ver hallazgos
          </button>
        </section>
      )}

      {faenas.length > 1 && (
        <section
          className={['panel p-4', faenaPorElegir ? 'border-beam/45 bg-beam/[0.06]' : ''].join(' ')}
          aria-labelledby="titulo-faena"
        >
          <p id="titulo-faena" className={faenaPorElegir ? 'text-[16px] font-semibold' : 'label-inst'}>
            {faenaPorElegir ? '¿En qué faena estás hoy?' : 'Faena'}
          </p>
          {faenaPorElegir && (
            <p className="mt-1 text-[13px] text-ink-2">
              Tu empresa tiene varias. Los formularios y tus inspecciones quedan asociados a la que elijas.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-labelledby="titulo-faena">
            {faenas.map((f) => {
              const activa = f.id === usuario?.faenaId && !faenaPorElegir
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={activa}
                  disabled={cambiando !== null}
                  onClick={() => void elegirFaena(f.id)}
                  className={[
                    'min-h-11 px-4 rounded-xl border text-[14px] font-medium cursor-pointer transition-colors duration-150',
                    'disabled:opacity-50',
                    activa ? 'border-beam bg-beam/10 text-ink' : 'border-campo bg-s0 text-ink-2',
                  ].join(' ')}
                >
                  {cambiando === f.id ? 'Cambiando…' : f.nombre}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {hayBorrador && plantilla && (
        <section className="panel p-4 border-beam/35 bg-beam/[0.05] flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="label-inst">Inspección en curso</p>
            <p className="mt-1 text-[14px] font-semibold truncate">{plantilla.nombre}</p>
            <p className="mt-1 text-[13px] text-ink-2">Tienes una inspección sin enviar. Termínala antes de empezar otra.</p>
          </div>
          <Boton tamano="sm" variante="primaria" onClick={() => ir('captura')} data-testid="continue-draft">
            Continuar
          </Boton>
        </section>
      )}

      {error && <p className="rounded-[10px] border border-sev-alta/40 bg-sev-alta/10 px-3.5 py-2.5 text-[13px] text-sev-alta" role="status" aria-live="polite">{error}</p>}

      {formularios.length === 0 ? (
        <section className="panel p-8 text-center">
          <h2 className="text-[15px] font-semibold">Todavía no tienes formularios asignados</h2>
          <p className="mt-2 text-[13px] text-ink-2 max-w-[48ch] mx-auto leading-relaxed">
            Pídele a tu administrador que publique un formulario y lo asigne a tu faena.
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
                    <p className="mt-1 text-[13px] text-ink-2">
                      {itemsDe(formulario.definition).length} preguntas · versión {formulario.version}
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
