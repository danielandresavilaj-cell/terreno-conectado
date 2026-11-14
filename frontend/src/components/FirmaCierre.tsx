import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { SignatureStroke } from '@terreno/shared'
import { Boton } from './ui'
import { useCapaAtras } from '../lib/useCapaAtras'
import { MAX_TRAZOS, firmaTieneTrazo, normalizarFirma } from '../lib/firma'

export { firmaTieneTrazo }

type Punto = { x: number; y: number }

/** Distancia mínima (px) entre dos puntos seguidos de un trazo: menos es ruido del dedo. */
const PASO_MINIMO = 2

/** Agrega `p` al trazo si se alejó lo suficiente del punto anterior. */
export function agregarPunto(puntos: readonly Punto[], p: Punto, paso = PASO_MINIMO): Punto[] {
  const ultimo = puntos.at(-1)
  if (ultimo && Math.hypot(p.x - ultimo.x, p.y - ultimo.y) < paso) return puntos as Punto[]
  return [...puntos, p]
}

/**
 * Pad de firma a pantalla completa (TSK-OFF-018). Guarda trazos, no una imagen
 * de firma ni biometría. Se dibuja en píxeles de pantalla y, al confirmar, la
 * firma se escala sin deformarse al marco 1000 × 500 y se ajusta a los límites
 * del servidor (`lib/firma.ts`).
 */
export function FirmaCierre({
  onCancelar,
  onConfirmar,
  modo = 'inspector',
  firmante,
  resumen,
}: {
  onCancelar: () => void
  onConfirmar: (strokes: SignatureStroke[]) => void
  modo?: 'inspector' | 'supervisor'
  /** Nombre de quien firma: la declaración es de una persona, no anónima. */
  firmante?: string
  /** Qué se está firmando (formulario y respuestas), en una línea. */
  resumen?: string
}) {
  const pad = useRef<SVGSVGElement>(null)
  const dialogo = useRef<HTMLElement>(null)
  const [trazos, setTrazos] = useState<Punto[][]>([])
  const [dibujando, setDibujando] = useState(false)
  const [lienzo, setLienzo] = useState({ ancho: 0, alto: 0 })
  const esCofirma = modo === 'supervisor'
  const lleno = trazos.length >= MAX_TRAZOS
  const trazosRef = useRef(trazos)
  trazosRef.current = trazos

  const medirLienzo = () => {
    const r = pad.current?.getBoundingClientRect()
    if (r) setLienzo({ ancho: r.width, alto: r.height })
  }

  // El viewBox sigue el tamaño del pad mientras no haya trazos; con trazos se
  // congela, así girar el teléfono no mueve lo ya dibujado.
  useLayoutEffect(() => {
    const el = pad.current
    if (!el) return
    const medir = () => {
      const r = el.getBoundingClientRect()
      setLienzo((prev) => (trazosRef.current.length > 0 && prev.ancho > 0 ? prev : { ancho: r.width, alto: r.height }))
    }
    medir()
    const obs = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir)
    obs?.observe(el)
    return () => obs?.disconnect()
  }, [])
  /** Punto del evento en coordenadas del viewBox (respeta el escalado del SVG). */
  const punto = (ev: PointerEvent<SVGSVGElement>): Punto | null => {
    const svg = pad.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse())
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }
  }
  const iniciar = (ev: PointerEvent<SVGSVGElement>) => {
    if (lleno) return
    const p = punto(ev)
    if (!p) return
    ev.currentTarget.setPointerCapture(ev.pointerId)
    setDibujando(true)
    setTrazos((prev) => [...prev, [p]])
  }
  const mover = (ev: PointerEvent<SVGSVGElement>) => {
    if (!dibujando) return
    const p = punto(ev)
    if (!p) return
    setTrazos((prev) => {
      const ultimo = prev.at(-1)
      if (!ultimo) return prev
      const siguiente = agregarPunto(ultimo, p)
      return siguiente === ultimo ? prev : [...prev.slice(0, -1), siguiente]
    })
  }
  const terminar = () => setDibujando(false)

  // TSK-OFF-008: el botón Atrás del teléfono cancela la firma, no cambia de pantalla.
  useCapaAtras(true, onCancelar)

  // Como el diálogo de cámara (TSK-OFF-003): toma el foco al abrir y lo
  // devuelve al botón que lo abrió al cerrar; Escape cancela.
  useEffect(() => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogo.current?.focus()
    // Pantalla completa: la página de atrás no debe desplazarse mientras se firma.
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      if (previo?.isConnected) previo.focus()
    }
  }, [])
  const alTeclado = (ev: KeyboardEvent<HTMLElement>) => {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      onCancelar()
    }
  }

  const listo = firmaTieneTrazo(trazos.map((points) => ({ points })))
  const grosor = Math.max(2.5, Math.min(lienzo.ancho, lienzo.alto) / 110)

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="firma-cierre-titulo"
      ref={dialogo}
      tabIndex={-1}
      onKeyDown={alTeclado}
      className="fixed inset-0 z-50 flex flex-col bg-s0 outline-none"
      style={{
        paddingTop: 'max(12px, env(safe-area-inset-top))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(16px, env(safe-area-inset-left))',
        paddingRight: 'max(16px, env(safe-area-inset-right))',
      }}
    >
      <header className="shrink-0">
        <p className="label-inst">{esCofirma ? 'Cofirma de supervisión' : 'Cierre de inspección'}</p>
        <h2 id="firma-cierre-titulo" className="mt-0.5 text-[18px] font-semibold">
          {esCofirma ? 'Cofirma con tu dedo' : 'Firma con tu dedo'}
        </h2>
        {(firmante || resumen) && (
          <p className="mt-1 text-[13px] text-ink-2 leading-snug">
            {firmante && <span className="font-semibold text-ink">{firmante}</span>}
            {firmante && resumen && ' · '}
            {resumen}
          </p>
        )}
        <p className="mt-1 text-[12px] leading-snug text-ink-2">
          {esCofirma
            ? 'Confirmo que revisé esta inspección. La firma queda vinculada a este cierre.'
            : 'Declaro que completé esta inspección. Si no hay señal, la firma queda en este teléfono y se envía sola al volver la conexión.'}
        </p>
      </header>

      <div className="relative mt-3 min-h-0 flex-1 rounded-xl border-2 border-dashed border-campo bg-s1">
        <svg
          ref={pad}
          viewBox={`0 0 ${Math.max(1, lienzo.ancho)} ${Math.max(1, lienzo.alto)}`}
          role="img"
          aria-label="Área para dibujar la firma"
          className="absolute inset-0 h-full w-full touch-none select-none"
          onPointerDown={iniciar}
          onPointerMove={mover}
          onPointerUp={terminar}
          onPointerCancel={terminar}
        >
          {/* Línea de firma: guía visual, no forma parte de los trazos. */}
          <line
            x1={lienzo.ancho * 0.08}
            x2={lienzo.ancho * 0.92}
            y1={lienzo.alto * 0.72}
            y2={lienzo.alto * 0.72}
            stroke="currentColor"
            strokeWidth="1"
            className="text-line-strong"
          />
          {trazos.map((t, index) =>
            t.length === 1 ? (
              <circle key={index} cx={t[0].x} cy={t[0].y} r={grosor / 2} fill="currentColor" className="text-ink" />
            ) : (
              <polyline
                key={index}
                points={t.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="currentColor"
                strokeWidth={grosor}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-ink"
              />
            ),
          )}
        </svg>
        {trazos.length === 0 && (
          <p className="pointer-events-none absolute inset-x-0 top-[74%] text-center text-[13px] text-ink-3">
            Firma sobre la línea
          </p>
        )}
      </div>

      <p className="mt-2 min-h-[18px] shrink-0 text-[12px] text-ink-2" aria-live="polite">
        {lleno
          ? `La firma llegó a ${MAX_TRAZOS} trazos. Confírmala o pulsa Limpiar para empezar de nuevo.`
          : !listo
            ? 'Dibuja tu firma en el recuadro para continuar. Puedes girar el teléfono para tener más espacio.'
            : ''}
      </p>
      <div className="mt-2 flex shrink-0 flex-wrap justify-end gap-2">
        <Boton tamano="sm" variante="fantasma" onClick={() => {
            setTrazos([])
            medirLienzo()
          }}>Limpiar</Boton>
        <Boton tamano="sm" variante="secundaria" onClick={onCancelar}>Cancelar</Boton>
        <Boton
          tamano="sm"
          variante="primaria"
          disabled={!listo}
          onClick={() => onConfirmar(normalizarFirma(trazos.map((points) => ({ points }))))}
        >
          {esCofirma ? 'Cofirmar inspección' : 'Firmar y enviar'}
        </Boton>
      </div>
    </section>
  )
}
