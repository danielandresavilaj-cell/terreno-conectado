/* Botón de modo claro / oscuro — TSK-OFF-005.
 *
 * Muestra el icono del tema AL QUE se cambia (sol para pasar a claro, luna
 * para pasar a oscuro) y lo dice en texto accesible. Target de 44 px como el
 * resto de la app (guantes, spec 002 §4). Todos los botones comparten estado
 * vía `useTema`, así que cambiar en una pantalla se refleja en las demás. */
import { useTema } from '../lib/tema'

export function BotonTema({ className = '' }: { className?: string }) {
  const { tema, alternar } = useTema()
  const aClaro = tema === 'oscuro'
  const etiqueta = aClaro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'
  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={etiqueta}
      title={etiqueta}
      className={[
        'h-11 w-11 shrink-0 grid place-items-center rounded-lg text-ink-2',
        'hover:text-ink hover:bg-s3 transition-colors duration-150 cursor-pointer',
        className,
      ].join(' ')}
    >
      {aClaro ? (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          <circle cx="9" cy="9" r="3.4" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M9 1.6v1.8M9 14.6v1.8M1.6 9h1.8M14.6 9h1.8M3.8 3.8l1.3 1.3M12.9 12.9l1.3 1.3M3.8 14.2l1.3-1.3M12.9 5.1l1.3-1.3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          <path
            d="M15.2 11.1A6.6 6.6 0 0 1 6.9 2.8a6.6 6.6 0 1 0 8.3 8.3Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}
