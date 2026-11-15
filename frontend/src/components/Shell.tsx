/* Shell de la app + Barra de sincronización.
 *
 * La barra es el corazón del producto (Artículo I: offline-first es la promesa).
 * El estado de señal es el de la red real (`navigator.onLine`).
 *
 * MOVIMIENTO (decisiones):
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
import { Boton } from './ui'
import { BotonTema } from './BotonTema'
import { Marca } from './Marca'
import { subtituloEncabezado } from '../lib/roles'
import { Topografia } from './Topografia'
import { useEstado, type Pantalla } from '../lib/store'
import { EASE } from '../lib/motion'
import { useMedia } from '../lib/useMedia'
import { useCapaAtras } from '../lib/useCapaAtras'
import { llevaBarraInferior, repartirSecciones } from '../lib/nav-telefono'
import type { Rol } from '../lib/types'

const NAV: Array<{ id: Pantalla; label: string; roles: Rol[]; icono: ReactNode }> = [
  {
    id: 'formularios',
    label: 'Formularios',
    roles: ['field_worker', 'supervisor'],
    icono: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
        <path d="M3 2.5h8l3 3v9H3v-12Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M5.6 7.4h5.8M5.6 10h5.8M5.6 12.6h3.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
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
    /* TSK-DOM-008 (FR-067): los hallazgos que me asignaron. */
    id: 'hallazgos',
    label: 'Hallazgos',
    roles: ['field_worker', 'supervisor', 'tenant_admin'],
    icono: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
        <path d="M8.5 2.5 15 14H2L8.5 2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M8.5 7v3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="8.5" cy="12" r="0.8" fill="currentColor" />
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
    id: 'plataforma',
    label: 'Empresas',
    roles: ['platform_admin'],
    icono: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
        <path d="M2.5 14.5h12M4 14.5V5l4.5-2.5L13 5v9.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M6.6 8h3.8M6.6 10.8h3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'dashboard',
    label: 'Gerencia',
    roles: ['supervisor', 'tenant_admin'],
    icono: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
        <path d="M3 14V8.4M7 14V4M11 14v-3.6M15 14V6.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'administracion',
    label: 'Equipo',
    roles: ['tenant_admin'],
    icono: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
        <circle cx="6.5" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2.2 14c.5-2.4 2.2-3.6 4.3-3.6s3.8 1.2 4.3 3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M11.4 4.2a2.2 2.2 0 0 1 0 4.1M12.6 10.6c1.2.4 2 1.5 2.3 3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
  {
    id: 'plantillas',
    label: 'Plantillas',
    roles: ['tenant_admin'],
    icono: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
        <path d="M3 2.5h8l3 3v9H3v-12Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M5.6 7.6h5.8M5.6 10.4h5.8M5.6 13h3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'importar',
    label: 'Importar',
    roles: ['tenant_admin'],
    icono: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
        <path d="M3 2.5h8l3 3v9H3v-12Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path
          d="M8.5 6v4.3M6.6 8.4l1.9 1.9 1.9-1.9"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
]

export function Shell({ children }: { children: ReactNode }) {
  const {
    usuario,
    salir,
    pantalla,
    ir,
    online,
    enviosPendientes,
    hallazgosNuevos,
    cuotaAviso,
    cuota,
    sincronizarAhora,
    sesionExpirada,
    avisoSalir,
  } = useEstado()
  const reducir = useReducedMotion()
  const esTelefono = useMedia('(max-width: 639px)')
  const [verAviso, setVerAviso] = useState(false)
  const [verMas, setVerMas] = useState(false)
  useCapaAtras(verMas, () => setVerMas(false))

  /* El aviso de cuota aparece solo, una vez (FR-017). */
  useEffect(() => {
    if (!cuotaAviso) return
    const t = setTimeout(() => setVerAviso(true), 900)
    return () => clearTimeout(t)
  }, [cuotaAviso])

  if (!usuario) return null

  const nav = NAV.filter((n) => n.roles.includes(usuario.rol))
  /* TSK-OFF-011 / TSK-OFF-022: en el teléfono la navegación va abajo, al
   * alcance del pulgar, para todos los roles de empresa. Si el rol tiene más de
   * cinco secciones, van las cuatro de uso diario y "Más" abre el resto. Se
   * decide al renderizar (no con CSS) para que exista una sola barra de
   * navegación en la página. Plataforma (una sección) no lleva barra. */
  const navAbajo = llevaBarraInferior(esTelefono, nav)
  const reparto = repartirSecciones(
    usuario.rol,
    nav.map((n) => n.id),
  )
  const principales = nav.filter((n) => reparto.principales.includes(n.id))
  const enMas = nav.filter((n) => reparto.mas.includes(n.id))
  const tieneAviso = (id: Pantalla) => (id === 'cola' && enviosPendientes > 0) || (id === 'hallazgos' && hallazgosNuevos > 0)
  const masActiva = enMas.some((n) => n.id === pantalla)
  const masConAviso = enMas.some((n) => tieneAviso(n.id))
  const irDesdeMas = (id: Pantalla) => {
    setVerMas(false)
    ir(id)
  }

  return (
    <div className="relative isolate min-h-dvh flex flex-col bg-s0">
      {/* Curvas de nivel de la landing, tenues y sólo en la parte alta: dan
          continuidad de marca sin restar contraste a los formularios. */}
      <div className="fixed inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" aria-hidden>
        <Topografia semilla={4} tenue />
      </div>
      <a
        href="#contenido-principal"
        className="sr-only fixed left-4 top-4 z-50 rounded-lg bg-beam px-4 py-2 text-[13px] font-semibold text-on-beam focus:not-sr-only"
      >
        Saltar al contenido principal
      </a>
      {/* ── Barra superior ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line-soft bg-s0/85 backdrop-blur-md">
        {/* pt-safe: con viewport-fit=cover, sin esto la barra superior entra
            bajo la muesca en iPhone. En equipos sin recorte env() da 0. */}
        <div className="mx-auto max-w-[1180px] px-4 sm:px-6 pt-safe">
          <div className="h-14 flex items-center gap-3">
            <Marca tamano={30} />
            {/* En el teléfono también se ve quién está capturando y en qué
                faena: es lo primero que alguien revisa al tomar un equipo
                compartido (TSK-OFF-009). El admin de plataforma ve su alcance
                global en lugar de una faena (TSK-ADM-004). */}
            <div className="min-w-0">
              <p className="text-[13px] font-semibold tracking-[-0.02em] leading-tight truncate">
                {usuario.nombre}
              </p>
              <p className="text-[12px] text-ink-3 leading-tight truncate">{subtituloEncabezado(usuario)}</p>
            </div>

            <div className="flex-1" />

            <IndicadorSenal on={online} />
            <BotonTema />
            {esTelefono ? (
              <button
                type="button"
                onClick={() => ir('cuenta')}
                aria-label="Mi cuenta"
                aria-current={pantalla === 'cuenta' ? 'page' : undefined}
                className={[
                  'h-11 w-11 shrink-0 grid place-items-center rounded-lg cursor-pointer transition-colors duration-150',
                  pantalla === 'cuenta' ? 'bg-s3 text-ink' : 'text-ink-2 hover:text-ink hover:bg-s3',
                ].join(' ')}
              >
                <svg width="19" height="19" viewBox="0 0 18 18" fill="none" aria-hidden>
                  <circle cx="9" cy="6.2" r="3" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M3 15.5c.7-3 3-4.5 6-4.5s5.3 1.5 6 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            ) : (
              <Boton
                tamano="sm"
                variante={pantalla === 'cuenta' ? 'secundaria' : 'fantasma'}
                onClick={() => ir('cuenta')}
                aria-current={pantalla === 'cuenta' ? 'page' : undefined}
              >
                Mi cuenta
              </Boton>
            )}
          </div>

          {/* Navegación: pestañas. El indicador activo se desliza con layout, lo
              que es correcto aquí porque el usuario navega pocas veces y el
             movimiento confirma "cambié de sección". */}
          {/* overflow-x-auto: con 5 pestañas y roles de supervisor, en 360 px no caben.
              scrollbar-width:none + la alternativa para WebKit evitan que la
              barra de scroll nativa aparezca bajo las pestañas. */}
          {!esTelefono && (
          <nav className="flex gap-1 -mb-px overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {nav.map((n) => {
              const activa = pantalla === n.id
              const nuevos = n.id === 'hallazgos' && hallazgosNuevos > 0
              return (
                <button
                  key={n.id}
                  onClick={() => ir(n.id)}
                  aria-current={activa ? 'page' : undefined}
                  aria-describedby={nuevos ? 'nav-hallazgos-nuevos' : undefined}
                  className={[
                    'relative shrink-0 flex items-center gap-1.5 px-3 min-h-11 text-[14px] font-medium',
                    'transition-colors duration-150 ease-out cursor-pointer',
                    activa ? 'text-ink' : 'text-ink-2 hover:text-ink',
                  ].join(' ')}
                >
                  {n.icono}
                  {n.label}
                  {nuevos && (
                    <span className="min-w-5 h-5 px-1.5 rounded-full bg-beam text-on-beam text-[12px] font-semibold grid place-items-center" aria-hidden>
                      {hallazgosNuevos}
                    </span>
                  )}
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
          )}
        </div>
      </header>

      {/* ── Contenido ─────────────────────────────────────────────────────── */}
      <main
        id="contenido-principal"
        tabIndex={-1}
        className="flex-1 mx-auto w-full max-w-[1180px] px-4 sm:px-6 py-7 pb-barra sm:pb-24"
      >
        {/* TSK-AUTH-010: la sesión expiró con registros por enviar. La cola está
            en pausa e intacta; al volver a ingresar se envía sola. */}
        {sesionExpirada && (
          <div
            role="alert"
            className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-sev-media/40 bg-sev-media/10 px-4 py-3"
          >
            <p className="flex-1 min-w-[200px] text-[14px] leading-relaxed">
              Tu sesión expiró. Ingresa de nuevo para enviar{' '}
              {enviosPendientes === 1 ? 'lo que tienes pendiente' : `tus ${enviosPendientes} envíos pendientes`}; nada se
              ha perdido.
            </p>
            <Boton variante="primaria" onClick={salir}>
              Ingresar de nuevo
            </Boton>
          </div>
        )}
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

      {/* ── Navegación inferior (teléfono) — TSK-OFF-011 / TSK-OFF-022 ─────
          El texto de cada botón es sólo su nombre: el contador de envíos va
          en un punto aparte y en la descripción accesible, no en el nombre. */}
      {navAbajo && (
        <nav
          aria-label="Secciones"
          className="fixed bottom-0 inset-x-0 z-30 border-t border-line-soft bg-s1/95 backdrop-blur-md pb-safe"
        >
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${principales.length + (enMas.length ? 1 : 0)}, minmax(0, 1fr))` }}
          >
            {principales.map((n) => {
              const activa = pantalla === n.id
              const conAviso = tieneAviso(n.id)
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => ir(n.id)}
                  aria-label={n.label}
                  aria-describedby={conAviso ? (n.id === 'cola' ? 'nav-por-enviar' : 'nav-hallazgos-nuevos') : undefined}
                  aria-current={activa ? 'page' : undefined}
                  className={[
                    'relative h-14 flex flex-col items-center justify-center gap-0.5 text-[12px] font-medium cursor-pointer',
                    'transition-colors duration-150',
                    activa ? 'text-beam' : 'text-ink-2',
                  ].join(' ')}
                >
                  <span className="relative" aria-hidden>
                    {n.icono}
                    {conAviso && (
                      <span className="absolute -right-2 -top-1.5 h-2.5 w-2.5 rounded-full bg-beam ring-2 ring-s1" />
                    )}
                  </span>
                  {n.label}
                  {activa && <span className="absolute top-0 inset-x-4 h-[2px] rounded-full bg-beam" aria-hidden />}
                </button>
              )
            })}
            {enMas.length > 0 && (
              <button
                type="button"
                onClick={() => setVerMas(true)}
                aria-label="Más secciones"
                aria-haspopup="dialog"
                aria-expanded={verMas}
                aria-current={masActiva ? 'page' : undefined}
                className={[
                  'relative h-14 flex flex-col items-center justify-center gap-0.5 text-[12px] font-medium cursor-pointer',
                  'transition-colors duration-150',
                  masActiva ? 'text-beam' : 'text-ink-2',
                ].join(' ')}
              >
                <span className="relative" aria-hidden>
                  <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
                    <circle cx="3.5" cy="8.5" r="1.3" fill="currentColor" />
                    <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" />
                    <circle cx="13.5" cy="8.5" r="1.3" fill="currentColor" />
                  </svg>
                  {masConAviso && <span className="absolute -right-2 -top-1.5 h-2.5 w-2.5 rounded-full bg-beam ring-2 ring-s1" />}
                </span>
                Más
                {masActiva && <span className="absolute top-0 inset-x-4 h-[2px] rounded-full bg-beam" aria-hidden />}
              </button>
            )}
          </div>
          <span id="nav-por-enviar" className="sr-only">
            {enviosPendientes} por enviar
          </span>
        </nav>
      )}
      <span id="nav-hallazgos-nuevos" className="sr-only">
        {hallazgosNuevos === 1 ? '1 hallazgo nuevo asignado' : `${hallazgosNuevos} hallazgos nuevos asignados`}
      </span>

      {/* ── Hoja "Más" (teléfono) — TSK-OFF-022 ───────────────────────────
          Las secciones que no caben en la barra. El botón Atrás la cierra. */}
      <AnimatePresence>
        {navAbajo && verMas && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE.out }}
              onClick={() => setVerMas(false)}
              className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
              aria-hidden
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Más secciones"
              initial={reducir ? { opacity: 0 } : { y: '100%' }}
              animate={reducir ? { opacity: 1 } : { y: 0 }}
              exit={reducir ? { opacity: 0 } : { y: '100%' }}
              transition={{ duration: reducir ? 0.15 : 0.32, ease: EASE.drawer }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setVerMas(false)
              }}
              className="fixed inset-x-0 bottom-0 z-50 panel rounded-b-none px-3 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-2xl"
            >
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" aria-hidden />
              <ul className="flex flex-col">
                {enMas.map((n) => {
                  const activa = pantalla === n.id
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        autoFocus={n === enMas[0]}
                        onClick={() => irDesdeMas(n.id)}
                        aria-current={activa ? 'page' : undefined}
                        className={[
                          'w-full min-h-12 flex items-center gap-3 px-3 rounded-lg text-[15px] font-medium cursor-pointer',
                          'transition-colors duration-150',
                          activa ? 'bg-s3 text-beam' : 'text-ink hover:bg-s3',
                        ].join(' ')}
                      >
                        <span aria-hidden>{n.icono}</span>
                        <span className="flex-1 text-left">{n.label}</span>
                        {n.id === 'cola' && enviosPendientes > 0 && (
                          <span className="text-[13px] text-ink-2">{enviosPendientes} por enviar</span>
                        )}
                        {n.id === 'hallazgos' && hallazgosNuevos > 0 && (
                          <span className="min-w-5 h-5 px-1.5 rounded-full bg-beam text-on-beam text-[12px] font-semibold grid place-items-center">
                            {hallazgosNuevos}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Aviso de salida (TSK-OFF-008) ─────────────────────────────────
          Se pulsó Atrás en la primera pantalla: se avisa antes de cerrar. */}
      {avisoSalir && (
        <div
          role="status"
          className="fixed z-40 inset-x-0 bottom-20 sm:bottom-6 mb-safe flex justify-center px-4 pointer-events-none"
        >
          <p className="rounded-full bg-ink text-s0 px-4 py-2.5 text-[14px] font-medium shadow-2xl">
            Pulsa Atrás otra vez para salir
          </p>
        </div>
      )}

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
                  Espacio del teléfono al {cuota.usadaPct ?? 0}%
                </p>
                <p className="mt-1 text-[13px] text-ink-2 leading-relaxed">
                  Queda poco espacio en este teléfono y hay {cuota.fotosPendientes}{' '}
                  {cuota.fotosPendientes === 1 ? 'foto' : 'fotos'} por enviar. Conéctate para liberarlo.
                </p>
                <div className="meter mt-3 h-1.5 rounded-full bg-s3 overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-sev-media"
                    style={{ transform: `scaleX(${(cuota.usadaPct ?? 0) / 100})` }}
                  />
                </div>
                <div className="mt-3 flex gap-2">
                  <Boton
                    tamano="sm"
                    variante="secundaria"
                    onClick={() => {
                      setVerAviso(false)
                      void sincronizarAhora()
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

/** Estado real de la red (navigator.onLine): ya no es un interruptor manual. */
function IndicadorSenal({ on }: { on: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-2 px-2 h-9 rounded-lg text-[13px] text-ink-2 shrink-0 whitespace-nowrap"
      role="status"
      aria-live="polite"
    >
      <span className={['h-2 w-2 rounded-full', on ? 'bg-synced throb' : 'bg-pending'].join(' ')} />
      {on ? 'En línea' : 'Sin señal'}
    </span>
  )
}

export { BadgeSync }
