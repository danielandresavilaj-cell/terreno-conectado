import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

/* Contador que cuenta hacia arriba al montar.
 *
 * ¿Debería animar? (marco de decisión)
 * Frecuencia: se ve 1 vez por visita al dashboard → "ocasional", animación
 * estándar permitida. Propósito: EXPLICAÇÃO — comunica que el número es una
 * magnitud medida, no un literal. 550 ms con ease-out: llega rápido y se asienta.
 * Con reduced-motion muestra el valor final directo.
 */
export function CountUp({
  valor,
  decimales = 0,
  sufijo = '',
  duracion = 550,
  className = '',
}: {
  valor: number
  decimales?: number
  sufijo?: string
  duracion?: number
  className?: string
}) {
  const reducir = useReducedMotion()
  const [n, setN] = useState(reducir ? valor : 0)
  const raf = useRef(0)

  useEffect(() => {
    if (reducir) {
      setN(valor)
      return
    }
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duracion)
      // ease-out cúbica: Same as el mood del resto del sistema
      const e = 1 - Math.pow(1 - p, 3)
      setN(valor * e)
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [valor, duracion, reducir])

  return (
    <span className={['num-inst', className].join(' ')}>
      {n.toFixed(decimales)}
      {sufijo}
    </span>
  )
}

/* Barra que crece desde cero.
 * Frecuencia: 1 vez por montaje → propósito: explicación de la proporción.
 * Se anima scaleX (no width) porque es GPU y no recalcula layout.
 * scaleX parte de 0.04 en vez de 0 para no "aparecer de la nada".
 */
export function Barra({
  pct,
  color,
  alto = 6,
  retardo = 0,
}: {
  pct: number
  color: string
  alto?: number
  retardo?: number
}) {
  const reducir = useReducedMotion()
  const [listo, setListo] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setListo(true), retardo)
    return () => clearTimeout(t)
  }, [retardo])

  return (
    <div
      className="w-full rounded-full bg-s3 overflow-hidden"
      style={{ height: alto }}
      role="presentation"
    >
      <div
        className="h-full rounded-full"
        style={{
          background: color,
          transform: listo ? `scaleX(${Math.max(0.04, pct / 100)})` : 'scaleX(0.04)',
          transformOrigin: 'left center',
          transition: reducir ? 'none' : 'transform 620ms cubic-bezier(0.23,1,0.32,1)',
        }}
      />
    </div>
  )
}
