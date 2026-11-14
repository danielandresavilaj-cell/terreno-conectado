/* Marca de Terreno Conectado — la misma de la landing (`landing/index.html`).
 *
 * Tres arcos de señal que nacen de un punto en el suelo: el punto (cobre del
 * Atacama) es el dato guardado en el teléfono; los arcos en ámbar, la señal
 * que vuelve y lo sube. Reemplaza al cuadrado "TC".
 *
 * Usa los tokens de color, así que se adapta a los temas claro y oscuro sin
 * variantes propias. Es decorativa (`aria-hidden`): el nombre de la app va
 * siempre como texto al lado.
 */

export function Marca({ tamano = 32, className = '' }: { tamano?: number; className?: string }) {
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden
      className={['shrink-0', className].join(' ')}
    >
      <path
        d="M2 30c4-10 10.5-15 18-15s14 5 18 15"
        stroke="var(--color-ink-2)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".45"
      />
      <path d="M6 30c3-6 8-9 14-9s11 3 14 9" stroke="var(--color-beam)" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M11 30c2-3.5 5-5.2 9-5.2s7 1.7 9 5.2"
        stroke="var(--color-beam)"
        strokeWidth="3"
        strokeLinecap="round"
        opacity=".6"
      />
      <circle cx="20" cy="31" r="3" fill="var(--color-copper)" />
    </svg>
  )
}
