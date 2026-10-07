/* Cola de sincronización — FR-013, FR-020, FR-021, FR-022, FR-024, FR-026.
 *
 * MOVIMIENTO (decisiones):
 * · El BARRIDO de confirmación es el momento más importante de la pantalla:
 *   un registro pasa de syncing a synced y el barrido recorre la fila UNA vez.
 *   Frecuencia: ocurre ~6 veces por sesión de demo → "ocasional". Propósito:
 *   feedback — comunica "esto acaba de pasar" sin que el usuario tenga que
 *   comparar el texto del badge antes y después. 700 ms, ease-out, una vez.
 * · El badge de estado cambia de color en 200 ms (transición CSS, no keyframe):
 *   las filas se actualizan en cadena y con keyframes parpadearían.
 * · El reintento (failed → syncing) usa la fila con layout, para que el resto
 *   de la lista se acomode con suavidad en vez de saltar.
 * · El contador de pendientes en el encabezado hace count-up. Es el número que
 *   el usuario vigila durante el turno, y un cambio de 4 a 0 debe notarse.
 * · La barra de cuota NO se anima en loop: es estática. Un pulso perpetuo sobre
 *   una advertencia la vuelve ruido. Solo crece una vez al entrar.
 */

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { BadgeSync, SYNC_META } from '../components/Badges'
import { CountUp } from '../components/CountUp'
import { Boton } from '../components/ui'
import { useEstado } from '../lib/store'
import { CUOTA } from '../lib/seed'
import { EASE } from '../lib/motion'
import type { RegistroCola } from '../lib/types'

const ORDEN_TIPO: Record<string, string> = {
  faena: 'Faena',
  inspeccion: 'Inspección',
  respuesta: 'Respuestas',
  hallazgo: 'Hallazgos',
  foto: 'Fotos',
  bitacora: 'Bitácora',
}

export function Cola() {
  const { cola, pendientes, online, recienSincronizado, setOnline, sincronizarAhora } = useEstado()
  const [filtro, setFiltro] = useState<'todos' | 'pendientes' | 'fallidos'>('todos')

  const lista = cola
    .filter((r) =>
      filtro === 'todos'
        ? true
        : filtro === 'pendientes'
          ? r.estado === 'pending' || r.estado === 'syncing'
          : r.estado === 'failed',
    )
    .sort((a, b) => a.orden - b.orden)

  const fallidos = cola.filter((r) => r.estado === 'failed').length

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-inst">FR-013 · Outbox local</p>
          <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
            Cola de sincronización
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-2 max-w-[58ch]">
            Orden de dependencia: faena → inspección → respuestas → hallazgos → fotos (FR-020).
            Reintentos con backoff exponencial de 1 s a 5 min (FR-022).
          </p>
        </div>

        {/* Contador de pendientes: count-up, es la cifra que el usuario vigila. */}
        <div className="panel px-4 py-3 shrink-0">
          <p className="label-inst">Pendientes</p>
          <CountUp
            valor={pendientes}
            className="block mt-1 text-[26px] font-semibold leading-none"
            sufijo=""
          />
          <div className="mt-2">
            <BadgeSync estado={pendientes === 0 ? 'synced' : online ? 'syncing' : 'pending'} />
          </div>
        </div>
      </header>

      {/* ── Filtros: sin animación de cambio, es un estado de lectura ─────── */}
      <div className="flex gap-1.5 flex-wrap">
        {(
          [
            ['todos', `Todos (${cola.length})`],
            ['pendientes', `En cola (${pendientes})`],
            ['fallidos', `Fallidos (${fallidos})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFiltro(k)}
            className={[
              'h-8 px-3 rounded-lg text-[12px] font-medium font-mono tracking-[0.04em] cursor-pointer',
              'transition-colors duration-150 ease-out border',
              filtro === k
                ? 'bg-beam/12 border-beam/40 text-beam'
                : 'bg-s1 border-line-soft text-ink-3 hover:text-ink-2',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Lista agrupada por tipo ───────────────────────────────────────── */}
      {Object.entries(ORDEN_TIPO).map(([tipo, etiqueta]) => {
        const items = lista.filter((r) => r.tipo === tipo)
        if (!items.length) return null
        return (
          <section key={tipo} className="space-y-2">
            <div className="flex items-center gap-3 px-0.5">
              <h2 className="label-inst">{etiqueta}</h2>
              <div className="flex-1 rule" />
            </div>
            {items.map((r) => (
              <FilaRegistro key={r.id} r={r} sweep={recienSincronizado === r.id} />
            ))}
          </section>
        )
      })}

      {lista.length === 0 && (
        <div className="panel p-10 text-center">
          <p className="text-[14px] text-ink-2">Sin registros en este filtro.</p>
        </div>
      )}

      {/* ── Estado vacío / todo sincronizado ──────────────────────────────── */}
      <AnimatePresence>
        {pendientes === 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: EASE.out }}
            className="panel p-5 border-synced/30 bg-synced/[0.05]"
          >
            <div className="flex items-start gap-3">
              <span className="h-2 w-2 rounded-full bg-synced mt-1.5 shrink-0" />
              <div>
                <p className="text-[14px] font-semibold tracking-[-0.015em]">
                  Cola vacía · todo sincronizado
                </p>
                <p className="mt-1 text-[12px] text-ink-2 leading-relaxed">
                  Sin acción del usuario: el disparo fue el evento <span className="text-ink">online</span>{' '}
                  del navegador (FR-016). Los reintentos por red son idempotentes por UUID cliente, así que
                  reenviar un lote no crea duplicados (FR-021).
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Cuota de almacenamiento (FR-017) ──────────────────────────────── */}
      <div className="panel p-4">
        <div className="flex items-center justify-between gap-4 mb-2.5">
          <div>
            <p className="label-inst">Almacenamiento local estimado</p>
            <p className="mt-1 text-[12px] text-ink-2">
              {CUOTA.usadaPct}% de la cuota · {CUOTA.fotosPendientes} fotos pendientes de subir
            </p>
          </div>
          <span
            className="num-inst text-[15px] font-semibold"
            style={{ color: CUOTA.usadaPct >= 80 ? 'var(--color-sev-media)' : 'var(--color-ink-2)' }}
          >
            {CUOTA.usadaPct}%
          </span>
        </div>
        <div className="meter h-2 rounded-full bg-s3 overflow-hidden">
          <motion.span
            className="block h-full rounded-full"
            initial={{ scaleX: 0.02 }}
            animate={{ scaleX: CUOTA.usadaPct / 100 }}
            transition={{ duration: 0.7, ease: EASE.out, delay: 0.15 }}
            style={{
              transformOrigin: 'left center',
              background:
                CUOTA.usadaPct >= 80 ? 'var(--color-sev-media)' : 'var(--color-synced)',
            }}
          />
        </div>
        {!online && (
          <p className="mt-3 text-[11px] text-ink-3">
            Sin señal: las fotos se comprimen en el dispositivo y quedan en cola. Se priorizan las
            ya sincronizables al recuperar conexión.
          </p>
        )}
        {!online && (
          <div className="mt-3">
            <Boton
              tamano="sm"
              variante="secundaria"
              onClick={() => {
                setOnline(true)
                void sincronizarAhora()
              }}
            >
              Simular llegada de señal
            </Boton>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Fila de registro ────────────────────────────────────────────────────
 * `layout` en la fila: cuando un registro cambia de estado y su contenido
 * cambia de alto, el resto se acomoda en lugar de saltar. Las transiciones de
 * estado son interrupibles porque son cambios de color CSS, no keyframes.
 */
function FilaRegistro({ r, sweep }: { r: RegistroCola; sweep: boolean }) {
  const reducir = useReducedMotion()
  const [recien, setRecien] = useState(false)
  const t = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (sweep) {
      setRecien(true)
      t.current = window.setTimeout(() => setRecien(false), 760)
    }
    return () => window.clearTimeout(t.current)
  }, [sweep])

  const m = SYNC_META[r.estado]

  return (
    <motion.div
      layout
      transition={{ duration: 0.3, ease: EASE.out }}
      className={[
        'relative overflow-hidden panel px-4 py-3 flex items-center gap-4',
        recien && !reducir ? 'sweep border-synced/40' : '',
      ].join(' ')}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium truncate">{r.titulo}</p>
        <p className="mt-0.5 text-[12px] text-ink-3 truncate">{r.detalle}</p>
        {/* FR-024: latencia captura→disponibilidad por registro. */}
        {r.latenciaSeg !== undefined && (
          <p className="mt-1 label-inst">
            Latencia captura→visible: <span className="num-inst text-ink-2">{r.latenciaSeg}s</span>
          </p>
        )}
        {r.intentos && r.intentos > 0 && r.estado !== 'synced' && (
          <p className="mt-1 label-inst" style={{ color: 'var(--color-sev-media)' }}>
            Intento {r.intentos} · backoff 2^{r.intentos - 1} s
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <span className="hidden sm:block label-inst max-w-[140px] truncate">{m.desc}</span>
        <BadgeSync estado={r.estado} />
        <button
          aria-label={`Reintentar ${r.titulo}`}
          className={[
            /* 44px en móvil (spec 002: guantes). El icono sigue en 13px, lo
               que crece es el área tocable, no el dibujo: con h-8 el botón
               quedaba en 32px y fallaba el objetivo táctil mínimo. */
            'h-11 w-11 sm:h-8 sm:w-8 rounded-lg grid place-items-center transition-colors duration-150 cursor-pointer',
            r.estado === 'failed'
              ? 'text-failed hover:bg-failed/12'
              : 'text-ink-3 hover:bg-s3',
          ].join(' ')}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="M11.5 7a4.5 4.5 0 1 1-1.6-3.47"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <path d="M11.9 1.6v2.9H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </motion.div>
  )
}
