import { Boton } from './ui'

/**
 * Navegación progresiva de listas densas. Muestra una tanda pequeña al entrar
 * para que el siguiente bloque del panel siga siendo alcanzable, sin obligar a
 * la persona a entender páginas numeradas.
 */
export function ControlesListado({
  mostrados,
  total,
  paso = 5,
  cargando = false,
  onVerMas,
  onVerTodos,
  onMostrarMenos,
}: {
  mostrados: number
  total: number
  paso?: number
  cargando?: boolean
  onVerMas: () => void
  onVerTodos?: () => void
  onMostrarMenos: () => void
}) {
  const quedan = Math.max(0, total - mostrados)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2.5" aria-live="polite">
      <p className="label-inst">
        Mostrando {mostrados} de {total}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {quedan > 0 && (
          <Boton tamano="sm" variante="secundaria" disabled={cargando} aria-busy={cargando} onClick={onVerMas}>
            {cargando ? 'Cargando…' : `Ver ${Math.min(paso, quedan)} más · quedan ${quedan}`}
          </Boton>
        )}
        {quedan > 0 && onVerTodos && (
          <Boton tamano="sm" variante="fantasma" disabled={cargando} onClick={onVerTodos}>
            Ver todos
          </Boton>
        )}
        {mostrados > paso && (
          <Boton tamano="sm" variante="fantasma" disabled={cargando} onClick={onMostrarMenos}>
            Mostrar menos
          </Boton>
        )}
      </div>
    </div>
  )
}
