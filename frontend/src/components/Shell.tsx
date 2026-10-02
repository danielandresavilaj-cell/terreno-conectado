/* Shell de la app + Barra de sincronización.
 *
 * La barra es el corazón del producto (Artículo I: offline-first es la promesa).
 * En el mockup debe poder encenderse y apagarse la señal para que el docente
 * vea el ciclo pending → syncing → synced sin real red.
 *
 * MOVIMIENTO (decisiones):
 * · El toggle de señal hace pop de escala al cambiar — acción manual, rara,
 *   y su resultado (offline/online) es el mensaje central. Confirma el clic.
 * · El contador de pendientes ANIMA SU VALOR (count-up) cuando cambia. Antes
 *   se usaba solo latido; el latido solo dice "hay algo pendiente" pero no
 *   CUÁNTO, y el número es lo que el usuario vigila durante el turno. El
 *   count-up da esa información. Es una sola vez por cambio, ~500 ms.
 * · El punto "sincronizando" late con opacidad (throb): muestra trabajo en curso.
 * · El aviso de cuota (FR-017) entra con fade + escala 0.95. Se muestra una vez.
 * · La navegación entre pantallas NO tiene animación de "página" con dirección.
 *   El usuario salta entre secciones; un slide lateral daría la sensación
 *   errónea de historial. En su lugar, un crossfade corto con desplazamiento
 *   mínimo (6px) que marca "cambió el contexto, no el sitio".
 */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { BadgeSync } from './Badges'
import { CountUp } from './CountUp'
import { Boton } from './ui'
import { useEstado, type Pantalla } from '../lib/store'
import { CUOTA } from '../lib/seed'
import { EASE } from '../lib/motion'
import type { Rol } from '../lib/types'

const NAV: Array<{ id: Pantalla; label: string; roles: Rol[]; icono: ReactNode }> = [
  {
    id: 'captura',
    label: 'Inspección',
    roles: ['field_worker', 'supervisor'],
    icono: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
        <path d="M3 2.5h8l3 3v9H3v-12Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M5.8 8.2 7.2 9.6l3.6-3.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'bitacora',
    label: 'Bitácora',
    roles: ['field_worker', 'supervisor'],
    icono: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
        <path d="M4 2.5h9v12H4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M6.3 6h4.4M6.3 8.6h4.4M6.3 11.2h2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'cola',
    label: 'Cola',
    roles: ['field_worker', 'supervisor', 'tenant_admin'],
    icono: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
        <path d="M8.5 2.5a6 6 0 1 0 6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M8.5 5.4V8.5l2.4 1.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'dashboard',
    label: 'Gerencia',
    roles: ['supervisor', 'tenant_admin', 'platform_admin'],
    icono: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
        <path d="M3 14V8.4M7 14V4M11 14v-3.6M15 14V6.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'conflictos',
    label: 'Conflictos',
    roles: ['supervisor', 'tenant_admin'],
    icono: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
        <path d="M8.5 2.2 14.8 14H2.2L8.5 2.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M8.5 7v3.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="8.5" cy="12" r="0.85" fill="currentColor" />
      </svg>
    ),
  },
]

export function Shell({ children }: { children: ReactNode }) {
  const { usuario, salir, pantalla, ir, online, toggleOnline, pendientes, cuotaAviso, setOnline } =
    useEstado()
  const reducir = useReducedMotion()
  const [verAviso, setVerAviso] = useState(false)

  /* El aviso de cuota aparece solo, una vez (FR-017). */
  useEffect(() => {
    if (!cuotaAviso) return
    const t = setTimeout(() => setVerAviso(true), 900)
    return () => clearTimeout(t)
  }, [cuotaAviso])

  if (!usuario) return null

  const nav = NAV.filter((n) => n.roles.includes(usuario.rol))

  return (
    <div className="min-h-dvh flex flex-col bg-s0">
      {/* ── Barra superior ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line-soft bg-s0/85 backdrop-blur-md">
        {/* pt-safe: con viewport-fit=cover, sin esto la barra superior entra
            bajo la muesca en iPhone. En equipos sin recorte env() da 0. */}
        <div className="mx-auto max-w-[1180px] px-4 sm:px-6 pt-safe">
          <div className="h-14 flex items-center gap-3">
            <div className="h-7 w-7 rounded-[8px] bg-beam grid place-items-center shrink-0">
              <span className="text-s0 font-bold text-[12px] leading-none">TC</span>
            </div>
            <div className="min-w-0 hidden sm:block">
              <p className="text-[13px] font-semibold tracking-[-0.02em] leading-tight truncate">
                {usuario.nombre}
              </p>
              <p className="label-inst truncate">{usuario.faena}</p>
            </div>

            <div className="flex-1" />

            <ToggleSenal on={online} onToggle={toggleOnline} reducir={!!reducir} />
            <Boton tamano="sm" variante="fantasma" onClick={salir}>
              Salir
            </Boton>
          </div>

          {/* Navegación: pestañas. El indicador activo se desliza con layout, lo
              que es correcto aquí porque el usuario navega pocas veces y el
             movimiento confirma "cambié de sección". */}
          {/* overflow-x-auto: con 5 pestañas y roles de supervisor, en 360 px no caben.
              scrollbar-width:none + la alternativa para WebKit evitan que la
              barra de scroll nativa aparezca bajo las pestañas. */}
          <nav className="flex gap-1 -mb-px overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {nav.map((n) => {
              const activa = pantalla === n.id
              return (
                <button
                  key={n.id}
                  onClick={() => ir(n.id)}
                  aria-current={activa ? 'page' : undefined}
                  className={[
                    'relative shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium',
                    'transition-colors duration-150 ease-out cursor-pointer',
                    activa ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
                  ].join(' ')}
                >
                  {n.icono}
                  {n.label}
                  {activa && (
                    <motion.span
                      layoutId="nav-activo"
                      className="absolute left-0 right-0 -bottom-px h-[2px] bg-beam rounded-full"
                      transition={{ type: 'spring', duration: 0.4, bounce: 0.16 }}
                    />
                  )}
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      {/* ── Contenido ─────────────────────────────────────────────────────── */}
      <main className="flex-1 mx-auto w-full max-w-[1180px] px-4 sm:px-6 py-7 pb-barra sm:pb-24">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pantalla}
            initial={reducir ? { opacity: 1 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducir ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE.out }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ── Barra de estado inferior (solo móvil) ─────────────────────────── */}
      <div className="fixed bottom-0 inset-x-0 z-30 border-t border-line-soft bg-s1/95 backdrop-blur-md sm:hidden">
        <div className="flex items-center justify-between px-4 h-barra-inferior pb-safe">
          <div className="flex items-center gap-2">
            <span
              className={[
                'h-2 w-2 rounded-full shrink-0',
                online ? 'bg-synced' : 'bg-pending',
                online ? 'throb' : '',
              ].join(' ')}
            />
            <span className="label-inst">{online ? 'En línea' : 'Sin señal'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="label-inst">Pendientes</span>
            <CountUp valor={pendientes} className="text-[14px] font-semibold text-beam" />
          </div>
        </div>
      </div>

      {/* ── Aviso de cuota de almacenamiento (FR-017) ─────────────────────── */}
      <AnimatePresence>
        {verAviso && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', duration: 0.5, bounce: 0.14 }}
            className="fixed z-40 bottom-24 sm:bottom-6 sm:right-6 mb-safe w-[min(360px,calc(100vw-2rem))] panel p-4 shadow-2xl"
            role="status"
          >
            <div className="flex items-start gap-3">
              <span className="h-2 w-2 rounded-full bg-sev-media mt-1.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold tracking-[-0.01em]">
                  Almacenamiento local al {CUOTA.usadaPct}%
                </p>
                <p className="mt-1 text-[12px] text-ink-2 leading-relaxed">
                  {CUOTA.fotosPendientes} fotos en cola. Se priorizarán las que ya pueden
                  subirse (FR-017).
                </p>
                <div className="meter mt-3 h-1.5 rounded-full bg-s3 overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-sev-media"
                    style={{ transform: `scaleX(${CUOTA.usadaPct / 100})` }}
                  />
                </div>
                <div className="mt-3 flex gap-2">
                  <Boton
                    tamano="sm"
                    variante="secundaria"
                    onClick={() => {
                      setVerAviso(false)
                      setOnline(true)
                    }}
                  >
                    Sincronizar ahora
                  </Boton>
                  <Boton tamano="sm" variante="fantasma" onClick={() => setVerAviso(false)}>
                    Después
                  </Boton>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Toggle de señal ─────────────────────────────────────────────────────
 * Control de demostración: en el producto real la señal depende del
 * dispositivo (evento `online`). Acá es un interruptor para poder mostrar el
 * ciclo completo en vivo ante el docente.
 *
 * Pop al alternar: es acción manual del usuario y su efecto es el mensaje
 * central del producto. Sin él el clic parece no haber hecho nada.
 */
function ToggleSenal({
  on,
  onToggle,
  reducir,
}: {
  on: boolean
  onToggle: () => void
  reducir: boolean
}) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      aria-label={on ? 'Desactivar señal (demo)' : 'Activar señal (demo)'}
      className={[
        'group flex items-center gap-2.5 h-9 pl-2.5 pr-2 rounded-full border cursor-pointer',
        'transition-colors duration-200 ease-out',
        on ? 'border-synced/40 bg-synced/10' : 'border-line bg-s1',
      ].join(' ')}
    >
      <span
        className={[
          'relative h-1.5 w-1.5 rounded-full shrink-0',
          on ? 'bg-synced throb' : 'bg-pending',
        ].join(' ')}
      />
      <span className="label-inst">{on ? 'En línea' : 'Sin señal'}</span>

      {/* El interruptor físico: knob que se desplaza. `layout` mantiene el
          movimiento interruptible si el usuario lo pulsa rápido. */}
      <span
        className={[
          'relative h-6 w-10 rounded-full shrink-0 transition-colors duration-200 ease-out',
          on ? 'bg-synced/35' : 'bg-s3',
        ].join(' ')}
      >
        <motion.span
          layout
          transition={reducir ? { duration: 0 } : { type: 'spring', duration: 0.4, bounce: 0.28 }}
          className={[
            'absolute top-0.5 h-5 w-5 rounded-full shadow-md',
            on ? 'bg-synced' : 'bg-ink-3',
          ].join(' ')}
          style={{ left: on ? 20 : 2 }}
        />
      </span>
    </button>
  )
}

export { BadgeSync }
