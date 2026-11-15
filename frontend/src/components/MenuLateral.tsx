/* Menú lateral — TSK-OFF-024.
 *
 * Un solo menú que es fijo o no según el tamaño de pantalla (lo decide Shell
 * con `modoNavegacion`):
 *  - `fijo`: escritorio, siempre visible a la izquierda bajo la barra superior;
 *  - `cajon`: tableta (hamburguesa) y teléfono ("Más"), desliza desde la
 *    izquierda sobre un fondo oscuro.
 * Secciones agrupadas (Terreno, Operación, Configuración) con sus avisos, y
 * "Mi cuenta" al fondo. Lo crítico no vive aquí: la barra inferior del
 * teléfono, la señal y los avisos de la barra superior siguen siempre a la
 * vista. El cajón se cierra con Atrás (`useCapaAtras`), Escape, tocando el
 * fondo o eligiendo una sección.
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import type { Pantalla } from '../lib/navegacion'
import type { TituloGrupo } from '../lib/nav-telefono'
import { EASE } from '../lib/motion'
import { useCapaAtras } from '../lib/useCapaAtras'

export interface ItemMenu {
  id: Pantalla
  label: string
  icono: ReactNode
}

export interface GrupoMenu {
  titulo: TituloGrupo
  items: ItemMenu[]
}

interface Props {
  grupos: GrupoMenu[]
  pantalla: Pantalla
  enviosPendientes: number
  hallazgosNuevos: number
  alIr: (id: Pantalla) => void
}

const ICONO_CUENTA = (
  <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden>
    <circle cx="9" cy="6.2" r="3" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3 15.5c.7-3 3-4.5 6-4.5s5.3 1.5 6 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

function Contenido({ grupos, pantalla, enviosPendientes, hallazgosNuevos, alIr, primerFoco }: Props & { primerFoco?: boolean }) {
  const fila = (id: Pantalla, label: string, icono: ReactNode, enfocar: boolean) => {
    const activa = pantalla === id
    return (
      <li key={id}>
        <button
          type="button"
          autoFocus={enfocar}
          onClick={() => alIr(id)}
          aria-current={activa ? 'page' : undefined}
          aria-describedby={
            id === 'cola' && enviosPendientes > 0
              ? 'nav-por-enviar-menu'
              : id === 'hallazgos' && hallazgosNuevos > 0
                ? 'nav-hallazgos-nuevos'
                : undefined
          }
          className={[
            'w-full min-h-12 flex items-center gap-3 px-3 rounded-lg text-[15px] font-medium cursor-pointer text-left',
            'transition-colors duration-150',
            activa ? 'bg-s3 text-beam' : 'text-ink hover:bg-s3',
          ].join(' ')}
        >
          <span aria-hidden>{icono}</span>
          <span className="flex-1 min-w-0 truncate">{label}</span>
          {id === 'cola' && enviosPendientes > 0 && (
            <span className="text-[13px] text-ink-2 whitespace-nowrap" aria-hidden>
              {enviosPendientes} por enviar
            </span>
          )}
          {id === 'hallazgos' && hallazgosNuevos > 0 && (
            <span
              className="min-w-5 h-5 px-1.5 rounded-full bg-beam text-on-beam text-[12px] font-semibold grid place-items-center"
              aria-hidden
            >
              {hallazgosNuevos}
            </span>
          )}
        </button>
      </li>
    )
  }
  const primero = grupos[0]?.items[0]?.id
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain">
        {grupos.map((g) => (
          <section key={g.titulo} aria-label={g.titulo}>
            <p className="label-inst px-3 pb-1">{g.titulo}</p>
            <ul className="flex flex-col gap-0.5">
              {g.items.map((n) => fila(n.id, n.label, n.icono, Boolean(primerFoco) && n.id === primero))}
            </ul>
          </section>
        ))}
      </div>
      <div className="mt-3 border-t border-line-soft pt-3">
        <ul>{fila('cuenta', 'Mi cuenta', ICONO_CUENTA, false)}</ul>
      </div>
      <span id="nav-por-enviar-menu" className="sr-only">
        {enviosPendientes} por enviar
      </span>
    </div>
  )
}

/** Escritorio: menú siempre visible a la izquierda. */
export function MenuLateralFijo(props: Props) {
  return (
    <nav
      aria-label="Secciones"
      className="sticky top-14 hidden lg:block h-[calc(100dvh-3.5rem)] w-60 shrink-0 border-r border-line-soft px-3 py-5"
    >
      <Contenido {...props} />
    </nav>
  )
}

/** Tableta y teléfono: cajón que desliza desde la izquierda. */
export function MenuLateralCajon({
  abierto,
  alCerrar,
  etiqueta,
  ...props
}: Props & { abierto: boolean; alCerrar: () => void; etiqueta: string }) {
  const reducir = useReducedMotion()
  const previo = useRef<HTMLElement | null>(null)
  useCapaAtras(abierto, alCerrar)

  useEffect(() => {
    if (!abierto) return
    previo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      if (previo.current?.isConnected) previo.current.focus()
    }
  }, [abierto])

  return (
    <AnimatePresence>
      {abierto && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE.out }}
            onClick={alCerrar}
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={etiqueta}
            initial={reducir ? { opacity: 0 } : { x: '-100%' }}
            animate={reducir ? { opacity: 1 } : { x: 0 }}
            exit={reducir ? { opacity: 0 } : { x: '-100%' }}
            transition={{ duration: reducir ? 0.15 : 0.3, ease: EASE.drawer }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') alCerrar()
            }}
            className="fixed inset-y-0 left-0 z-50 w-[min(300px,85vw)] border-r border-line-soft bg-s1 px-3 shadow-2xl pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))]"
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <p className="text-[15px] font-semibold">{etiqueta === 'Menú' ? 'Secciones' : 'Más secciones'}</p>
              <button
                type="button"
                onClick={alCerrar}
                aria-label="Cerrar menú"
                className="h-11 w-11 grid place-items-center rounded-lg text-ink-2 hover:text-ink hover:bg-s3 cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                  <path d="M4 4l10 10M14 4 4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="h-[calc(100%-3.5rem)]">
              <Contenido
                {...props}
                primerFoco
                alIr={(id) => {
                  alCerrar()
                  props.alIr(id)
                }}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
