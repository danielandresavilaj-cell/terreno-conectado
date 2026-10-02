/* Primitivas de interacción.
 *
 * MOVIMIENTO — decisiones (find-animation-opportunities: justificar antes):
 * · La presión de botón SÍ anima (scale 0.97, 160ms ease-out). Ocurre cientos
 *   de veces al día y es retroalimentación pura: el usuario debe sentir que la
 *   interfaz escuchó. Sin esto el mockup se siente muerto.
 * · El hover NO usa transform. En pantallas táctiles con guantes el hover se
 *   dispara en el tap y produce falsos positivos; por eso va detrás de
 *   `@media (hover: hover) and (pointer: fine)` y solo cambia color.
 * · El focus-visible es instantáneo y sin animación: navegación por teclado,
 *   nunca se ralentiza una acción que se repite sin parar.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'

type Variante = 'primaria' | 'secundaria' | 'fantasma' | 'peligro'
type Tamano = 'sm' | 'md' | 'lg'

const VARIANTES: Record<Variante, string> = {
  primaria:
    'bg-beam text-s0 hover:bg-[#ffb733] active:bg-[#d8941c] shadow-[0_1px_0_#ffd27a_inset]',
  secundaria:
    'bg-s3 text-ink hover:bg-[#31363d] border border-line hover:border-[#3d434b]',
  fantasma: 'bg-transparent text-ink-2 hover:text-ink hover:bg-s3',
  peligro: 'bg-failed/12 text-failed border border-failed/35 hover:bg-failed/20',
}

const TAMANOS: Record<Tamano, string> = {
  // Targets táctiles ≥44px: el trabajador usa guantes (spec 002 §UX de captura).
  sm: 'h-9 px-3 text-[13px] rounded-lg gap-1.5',
  md: 'h-11 px-4 text-sm rounded-[10px] gap-2',
  lg: 'h-14 px-5 text-[15px] rounded-xl gap-2.5',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  tamano?: Tamano
  icono?: ReactNode
  bloqueCompleto?: boolean
}

export function Boton({
  variante = 'secundaria',
  tamano = 'md',
  icono,
  bloqueCompleto,
  className = '',
  children,
  ...rest
}: Props) {
  const reducir = useReducedMotion()

  return (
    <motion.button
      whileTap={reducir ? undefined : { scale: 0.97 }}
      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
      className={[
        'inline-flex items-center justify-center font-medium tracking-[-0.01em]',
        'transition-colors duration-150 ease-out',
        'disabled:opacity-40 disabled:pointer-events-none select-none',
        VARIANTES[variante],
        TAMANOS[tamano],
        bloqueCompleto ? 'w-full' : '',
        className,
      ].join(' ')}
      {...(rest as React.ComponentProps<typeof motion.button>)}
    >
      {icono}
      {children}
    </motion.button>
  )
}

/** Tarjeta seleccionable (usuarios de login, faenas, filtros).
 *  Pop de selección con spring corto: se usa en la lista de usuarios y en los
 *  filtros del dashboard, nunca cientos de veces seguidas. */
export function Tarjeta({
  activa,
  onClick,
  children,
  className = '',
}: {
  activa: boolean
  onClick: () => void
  children: ReactNode
  className?: string
}) {
  const reducir = useReducedMotion()

  return (
    <motion.button
      onClick={onClick}
      whileTap={reducir ? undefined : { scale: 0.985 }}
      animate={{
        borderColor: activa ? 'var(--color-beam)' : 'var(--color-line-soft)',
        backgroundColor: activa ? 'var(--color-beam-glow)' : 'var(--color-s1)',
      }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className={[
        'relative w-full text-left rounded-[10px] px-3.5 py-3 border',
        'transition-colors duration-200 ease-out cursor-pointer',
        className,
      ].join(' ')}
    >
      {children}
    </motion.button>
  )
}
