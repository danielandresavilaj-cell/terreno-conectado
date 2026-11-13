/* Cola de sincronización — FR-013, FR-020, FR-021, FR-022, FR-024, FR-026.
 *
 * TSK-OFF-006: la vista principal muestra una TARJETA por lo que capturó la
 * persona (inspección, bitácora), no una fila por registro técnico. Estado
 * agregado (el peor de sus partes), avance, motivo del fallo en lenguaje claro
 * y acciones. La lista técnica por registro queda en "Detalles técnicos"
 * (supervisión/admin). La cola en sí no cambia: sólo su representación
 * (`lib/cola-vista.ts`).
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

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { BadgeSync, SYNC_META } from '../components/Badges'
import { CountUp } from '../components/CountUp'
import { Boton } from '../components/ui'
import { useEstado } from '../lib/store'
import { UMBRAL_CUOTA_PCT } from '../lib/cuota'
import { EASE } from '../lib/motion'
import type { RegistroCola } from '../lib/types'
import { armarVistaCola, haceLegible, type GrupoCola, type LineaDetalle, type VistaCola } from '../lib/cola-vista'
import { datosVistaCola, fotoDeAdjunto } from '../lib/db'

const ORDEN_TIPO: Record<string, string> = {
  faena: 'Faena',
  inspeccion: 'Inspección',
  respuesta: 'Respuestas',
  hallazgo: 'Hallazgos',
  foto: 'Fotos',
  bitacora: 'Bitácora',
  firma: 'Firmas',
}

export function Cola() {
  const {
    cola, pendientes, online, recienSincronizado, sincronizarAhora, cuota,
    descartarRegistroCola, usuario,
  } = useEstado()
  const [vista, setVista] = useState<VistaCola | null>(null)
  const [aDescartar, setADescartar] = useState<GrupoCola | null>(null)
  const [descartando, setDescartando] = useState(false)
  const [errorDescarte, setErrorDescarte] = useState<string | null>(null)
  const [ahora, setAhora] = useState(() => new Date())
  const cuotaPct = cuota.usadaPct
  const cuotaAlta = cuotaPct !== null && cuotaPct >= UMBRAL_CUOTA_PCT
  const verTecnico = usuario?.rol === 'supervisor' || usuario?.rol === 'tenant_admin'

  // La vista se rearma cada vez que el store refresca la cola (encolar,
  // enviar, fallar, descartar): mismo disparo que la lista técnica.
  useEffect(() => {
    let vivo = true
    void datosVistaCola().then((d) => {
      if (vivo) {
        const t = new Date()
        setAhora(t)
        setVista(armarVistaCola(d, t))
      }
    })
    return () => {
      vivo = false
    }
  }, [cola])

  // Reloj suave para "hace 2 min" y la cuenta del próximo reintento.
  useEffect(() => {
    const id = window.setInterval(() => setAhora(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const grupoReciente = useMemo(() => {
    if (!recienSincronizado || !vista) return null
    const todos = [...vista.enviadoHoy, ...vista.pendientes, ...vista.conProblemas]
    return todos.find((g) => g.claves.includes(recienSincronizado))?.clave ?? null
  }, [recienSincronizado, vista])

  const envios = vista?.enviosPendientes ?? 0
  const estadoGeneral =
    envios === 0
      ? `Todo enviado${vista?.ultimoEnvioAt ? ` · último envío ${haceLegible(vista.ultimoEnvioAt, ahora)}` : ''}.`
      : (vista?.conProblemas.length ?? 0) > 0
        ? `${envios} ${envios === 1 ? 'envío pendiente' : 'envíos pendientes'}; ${vista?.conProblemas.length === 1 ? 'uno necesita' : 'algunos necesitan'} atención.`
        : online
          ? `${envios === 1 ? '1 envío' : `${envios} envíos`} en camino al servidor…`
          : `${envios === 1 ? '1 envío espera' : `${envios} envíos esperan`} señal: se envían solos al volver la conexión.`

  const confirmarDescarte = (g: GrupoCola) => {
    const id = g.outboxDescartable
    if (id === null) return
    setDescartando(true)
    setErrorDescarte(null)
    void (async () => {
      try {
        await descartarRegistroCola(id)
        setADescartar(null)
      } catch (error) {
        setErrorDescarte(error instanceof Error ? error.message : 'No se pudo descartar.')
      } finally {
        setDescartando(false)
      }
    })()
  }

  const tarjeta = (g: GrupoCola) => (
    <TarjetaEnvio
      key={g.clave}
      g={g}
      ahora={ahora}
      online={online}
      sweep={grupoReciente === g.clave}
      onReintentar={sincronizarAhora}
      onDescartar={() => {
        setErrorDescarte(null)
        setADescartar(g)
      }}
      confirmacion={
        aDescartar?.clave === g.clave
          ? {
              descartando,
              error: errorDescarte,
              onConfirmar: () => confirmarDescarte(g),
              onCancelar: () => setADescartar(null),
            }
          : null
      }
    />
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-inst">Cola local</p>
          <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
            Cola de sincronización
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-2 max-w-[58ch]" role="status">
            {vista ? estadoGeneral : 'Revisando lo guardado en este dispositivo…'}
          </p>
        </div>

        {/* Contador: envíos (lo que capturó la persona), no partes técnicas. */}
        <div className="panel px-4 py-3 shrink-0">
          <p className="label-inst">Por enviar</p>
          <CountUp valor={envios} className="block mt-1 text-[26px] font-semibold leading-none" sufijo="" />
          <div className="mt-2">
            <BadgeSync estado={pendientes === 0 ? 'synced' : online ? 'syncing' : 'pending'} />
          </div>
        </div>
      </header>

      {vista && vista.conProblemas.length > 0 && (
        <Seccion titulo="Con problemas" cantidad={vista.conProblemas.length} tono="var(--color-failed)">
          {vista.conProblemas.map(tarjeta)}
        </Seccion>
      )}

      {vista && vista.pendientes.length > 0 && (
        <Seccion titulo="Esperando envío" cantidad={vista.pendientes.length}>
          {vista.pendientes.map(tarjeta)}
        </Seccion>
      )}

      {/* ── Todo enviado ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {vista && envios === 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: EASE.out }}
            className="panel p-5 border-synced/30 bg-synced/[0.05]"
          >
            <div className="flex items-start gap-3">
              <span className="h-2 w-2 rounded-full bg-synced mt-1.5 shrink-0" />
              <div>
                <p className="text-[14px] font-semibold tracking-[-0.015em]">Nada por enviar</p>
                <p className="mt-1 text-[12px] text-ink-2 leading-relaxed">
                  Todo lo que capturaste en este dispositivo ya llegó al servidor. Si te quedas sin señal,
                  lo nuevo se guarda aquí y se envía solo al volver la conexión.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {vista && vista.enviadoHoy.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 touch-manipulation items-center gap-3 px-0.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <h2 className="label-inst">Enviado en las últimas 24 h ({vista.enviadoHoy.length})</h2>
            <div className="flex-1 rule" />
            <span className="label-inst group-open:rotate-180 transition-transform duration-150">▾</span>
          </summary>
          <div className="mt-2 space-y-2">{vista.enviadoHoy.map(tarjeta)}</div>
        </details>
      )}

      {/* TSK-OFF-013: historial propio de lo enviado desde este teléfono. */}
      {vista && vista.enviadoAntes.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 touch-manipulation items-center gap-3 px-0.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <h2 className="label-inst">Enviado los últimos 30 días ({vista.enviadoAntes.length})</h2>
            <div className="flex-1 rule" />
            <span className="label-inst group-open:rotate-180 transition-transform duration-150">▾</span>
          </summary>
          <div className="mt-2 space-y-2">{vista.enviadoAntes.map(tarjeta)}</div>
        </details>
      )}

      {/* ── Cuota de almacenamiento (FR-017) ──────────────────────────────── */}
      <div className="panel p-4">
        <div className="flex items-center justify-between gap-4 mb-2.5">
          <div>
            <p className="label-inst">Almacenamiento local estimado</p>
            <p className="mt-1 text-[12px] text-ink-2">
              {cuotaPct === null ? 'Estimación no disponible' : `${cuotaPct}% de la cuota`} ·{' '}
              {cuota.fotosPendientes} {cuota.fotosPendientes === 1 ? 'foto pendiente' : 'fotos pendientes'} de subir
            </p>
          </div>
          <span
            className="num-inst text-[15px] font-semibold"
            style={{ color: cuotaAlta ? 'var(--color-sev-media)' : 'var(--color-ink-2)' }}
          >
            {cuotaPct === null ? '—' : `${cuotaPct}%`}
          </span>
        </div>
        <div className="meter h-2 rounded-full bg-s3 overflow-hidden">
          <motion.span
            className="block h-full rounded-full"
            initial={{ scaleX: 0.02 }}
            animate={{ scaleX: (cuotaPct ?? 0) / 100 }}
            transition={{ duration: 0.7, ease: EASE.out, delay: 0.15 }}
            style={{
              transformOrigin: 'left center',
              background: cuotaAlta ? 'var(--color-sev-media)' : 'var(--color-synced)',
            }}
          />
        </div>
        {!online && (
          <p className="mt-3 text-[11px] text-ink-3">
            Sin señal: las fotos se comprimen en el dispositivo y quedan guardadas. Al volver la conexión se
            envían primero las que ya se pueden subir.
          </p>
        )}
      </div>

      {/* ── Detalles técnicos (soporte): la lista por registro ─────────────── */}
      {verTecnico && cola.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 touch-manipulation items-center gap-3 px-0.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <h2 className="label-inst">Detalles técnicos ({cola.length} registros)</h2>
            <div className="flex-1 rule" />
            <span className="label-inst group-open:rotate-180 transition-transform duration-150">▾</span>
          </summary>
          <div className="mt-2 space-y-3">
            <p className="text-[13px] text-ink-3 leading-relaxed max-w-[70ch]">
              Para soporte. Cada envío sube por partes y en orden: inspección, respuestas, hallazgos y
              fotos. Si una parte falla se reintenta sola, cada vez con más espera (hasta 5 minutos), y
              reenviar nunca duplica.
            </p>
            {Object.entries(ORDEN_TIPO).map(([tipo, etiqueta]) => {
              const items = cola.filter((r) => r.tipo === tipo).sort((a, b) => a.orden - b.orden)
              if (!items.length) return null
              return (
                <section key={tipo} className="space-y-2">
                  <div className="flex items-center gap-3 px-0.5">
                    <h3 className="label-inst">{etiqueta}</h3>
                    <div className="flex-1 rule" />
                  </div>
                  {items.map((r) => (
                    <FilaRegistro key={r.id} r={r} sweep={recienSincronizado === r.id} onReintentar={sincronizarAhora} />
                  ))}
                </section>
              )
            })}
          </div>
        </details>
      )}
    </div>
  )
}

function Seccion({ titulo, cantidad, tono, children }: { titulo: string; cantidad: number; tono?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-3 px-0.5">
        <h2 className="label-inst" style={tono ? { color: tono } : undefined}>
          {titulo} ({cantidad})
        </h2>
        <div className="flex-1 rule" />
      </div>
      {children}
    </section>
  )
}

const ETIQUETA_ESTADO: Record<GrupoCola['estado'], string> = {
  failed: 'Con problema',
  syncing: 'Enviando',
  pending: 'Esperando señal',
  synced: 'Enviado',
}

/* ── Tarjeta de envío ──────────────────────────────────────────────────────
 * Una por inspección o bitácora. El barrido de confirmación recorre la tarjeta
 * una vez cuando una de sus partes acaba de sincronizarse. */
function TarjetaEnvio({
  g,
  ahora,
  online,
  sweep,
  onReintentar,
  onDescartar,
  confirmacion,
}: {
  g: GrupoCola
  ahora: Date
  online: boolean
  sweep: boolean
  onReintentar: () => void
  onDescartar: () => void
  /** Confirmación de descarte DENTRO de la tarjeta (en el teléfono, junto al botón tocado). */
  confirmacion: { descartando: boolean; error: string | null; onConfirmar: () => void; onCancelar: () => void } | null
}) {
  const reducir = useReducedMotion()
  const [abierta, setAbierta] = useState(false)
  const [recien, setRecien] = useState(false)
  const t = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (sweep) {
      setRecien(true)
      t.current = window.setTimeout(() => setRecien(false), 760)
    }
    return () => window.clearTimeout(t.current)
  }, [sweep])

  const { total, enviadas } = g.partes
  const pct = total ? Math.round((enviadas / total) * 100) : 0
  const color = SYNC_META[g.estado].color
  const reintentoSeg = g.reintentoAt !== null ? Math.ceil(Math.max(0, g.reintentoAt - ahora.getTime()) / 1000) : null
  const idDetalle = `detalle-${g.clave.replace(/[^a-z0-9]/gi, '-')}`

  return (
    <motion.article
      layout
      transition={{ duration: 0.3, ease: EASE.out }}
      className={[
        'relative overflow-hidden panel px-4 py-3.5',
        g.estado === 'failed' ? 'border-failed/35' : '',
        recien && !reducir ? 'sweep border-synced/40' : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold tracking-[-0.015em] truncate">{g.titulo}</p>
          <p className="mt-0.5 text-[12px] text-ink-3 truncate">{g.subtitulo}</p>
          {g.resumen.length > 0 && (
            <p className="mt-1.5 text-[12px] text-ink-2 leading-relaxed">{g.resumen.join(' · ')}</p>
          )}
        </div>
        <span
          className="shrink-0 inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-medium"
          style={{ color, backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)` }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
          {g.estado === 'pending' && online ? 'En cola' : ETIQUETA_ESTADO[g.estado]}
        </span>
      </div>

      {/* Avance: sólo cuando hay más de una parte y no terminó. */}
      {total > 1 && g.estado !== 'synced' && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-s3 overflow-hidden" aria-hidden>
            <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
          </div>
          <p className="mt-1 text-[11px] text-ink-3">
            {enviadas} de {total} partes enviadas
          </p>
        </div>
      )}

      {g.error && g.estado === 'failed' && (
        <p className="mt-3 rounded-lg bg-failed/[0.07] border border-failed/25 px-3 py-2 text-[12px] leading-relaxed text-ink">
          {g.error}
          {reintentoSeg !== null && reintentoSeg > 0 && online && (
            <span className="text-ink-3"> Nuevo intento automático en ~{reintentoSeg < 60 ? `${reintentoSeg} s` : `${Math.ceil(reintentoSeg / 60)} min`}.</span>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {g.detalle.length > 0 && (
          <Boton
            tamano="sm"
            variante="fantasma"
            aria-expanded={abierta}
            aria-controls={idDetalle}
            onClick={() => setAbierta((v) => !v)}
          >
            {abierta ? 'Ocultar detalle' : 'Ver detalle'}
          </Boton>
        )}
        <span className="flex-1" />
        {g.estado === 'failed' && (
          <Boton tamano="sm" variante="secundaria" onClick={onReintentar}>
            Reintentar
          </Boton>
        )}
        {g.outboxDescartable !== null && (g.estado === 'pending' || g.estado === 'failed') && !confirmacion && (
          <Boton tamano="sm" variante="fantasma" onClick={onDescartar}>
            Descartar
          </Boton>
        )}
      </div>

      {confirmacion && (
        <div className="mt-3 rounded-lg border border-failed/35 bg-failed/[0.05] p-3" role="alert">
          <p className="text-[13px] font-semibold">
            ¿Descartar {g.tipo === 'bitacora' ? 'esta bitácora' : 'esta inspección'}?
          </p>
          <p className="mt-1 text-[12px] text-ink-2 leading-relaxed">
            {g.tipo === 'bitacora'
              ? 'Se elimina de este dispositivo. No borra lo que ya llegó al servidor.'
              : 'Se eliminan de este dispositivo la inspección, sus respuestas, hallazgos y fotos. No borra lo que ya llegó al servidor.'}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Boton tamano="sm" variante="peligro" disabled={confirmacion.descartando} onClick={confirmacion.onConfirmar}>
              {confirmacion.descartando ? 'Descartando…' : 'Sí, descartar'}
            </Boton>
            <Boton tamano="sm" variante="fantasma" disabled={confirmacion.descartando} onClick={confirmacion.onCancelar}>
              Cancelar
            </Boton>
          </div>
          {confirmacion.error && <p className="mt-2 text-[12px] text-failed">{confirmacion.error}</p>}
        </div>
      )}

      <AnimatePresence initial={false}>
        {abierta && (
          <motion.ul
            id={idDetalle}
            initial={reducir ? { opacity: 1 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reducir ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: EASE.out }}
            className="mt-2 divide-y divide-line-soft border-t border-line-soft overflow-hidden"
          >
            {g.detalle.map((l) => (
              <LineaEnvio key={l.clave} l={l} />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.article>
  )
}

function LineaEnvio({ l }: { l: LineaDetalle }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!l.adjuntoId) return
    let vivo = true
    let creada: string | null = null
    void fotoDeAdjunto(l.adjuntoId).then((b) => {
      if (!vivo || !b) return
      creada = URL.createObjectURL(b)
      setUrl(creada)
    })
    return () => {
      vivo = false
      if (creada) URL.revokeObjectURL(creada)
    }
  }, [l.adjuntoId])

  const color =
    l.severidad === 'critical'
      ? 'var(--color-sev-critica)'
      : l.severidad === 'high'
        ? 'var(--color-sev-alta)'
        : l.severidad === 'medium'
          ? 'var(--color-sev-media)'
          : undefined
  const noOk = l.valor === 'No OK'

  return (
    <li className="flex items-start gap-3 py-2.5">
      {l.adjuntoId &&
        (url ? (
          <img src={url} alt="" className="h-10 w-10 rounded-md object-cover shrink-0 border border-line-soft" />
        ) : (
          <span className="h-10 w-10 rounded-md bg-s3 shrink-0" aria-hidden />
        ))}
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-ink-2 leading-snug" style={color ? { color } : undefined}>
          {l.texto}
        </p>
        <p className={['mt-0.5 text-[13px] leading-snug break-words', noOk ? 'font-semibold text-failed' : 'text-ink'].join(' ')}>
          {l.valor}
        </p>
      </div>
      <span
        className="mt-1 h-2 w-2 rounded-full shrink-0"
        title={ETIQUETA_ESTADO[l.estado]}
        aria-label={ETIQUETA_ESTADO[l.estado]}
        style={{ backgroundColor: SYNC_META[l.estado].color }}
      />
    </li>
  )
}

/* ── Fila de registro ────────────────────────────────────────────────────
 * `layout` en la fila: cuando un registro cambia de estado y su contenido
 * cambia de alto, el resto se acomoda en lugar de saltar. Las transiciones de
 * estado son interrupibles porque son cambios de color CSS, no keyframes.
 */
function FilaRegistro({
  r,
  sweep,
  onReintentar,
  onDescartar,
}: {
  r: RegistroCola
  sweep: boolean
  onReintentar: () => void
  /** La vista técnica no descarta: eso se hace sobre la tarjeta del envío. */
  onDescartar?: () => void
}) {
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
        {r.estado === 'failed' && (
          <button
            aria-label={`Reintentar ${r.titulo}`}
            onClick={onReintentar}
            className="h-11 w-11 sm:h-8 sm:w-8 rounded-lg grid place-items-center transition-colors duration-150 cursor-pointer text-failed hover:bg-failed/12"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M11.5 7a4.5 4.5 0 1 1-1.6-3.47" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M11.9 1.6v2.9H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {onDescartar && (r.tipo === 'inspeccion' || r.tipo === 'bitacora') && (r.estado === 'pending' || r.estado === 'failed') && (
          <button
            aria-label={`Descartar ${r.titulo}`}
            onClick={onDescartar}
            className="h-11 w-11 sm:h-8 sm:w-8 rounded-lg grid place-items-center transition-colors duration-150 cursor-pointer text-ink-3 hover:bg-failed/12 hover:text-failed"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2.5 3.5h9M5.25 3.5V2.25h3.5V3.5m-5 0 .55 8h5.4l.55-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </motion.div>
  )
}
