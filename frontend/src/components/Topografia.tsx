/* Curvas de nivel de fondo — las mismas de la landing (`landing/index.html`).
 *
 * Dibuja dos cerros como anillos concéntricos deformados con una suma de
 * senos. Es determinista (misma `semilla`, mismo dibujo) y se calcula una sola
 * vez por montaje: no anima nada. Cada quinto anillo es una "curva maestra" en
 * el acento, como en una carta topográfica; el resto va en tinta muy tenue.
 *
 * Es decorativa: no recibe eventos y queda detrás del contenido. Detrás de las
 * pantallas de trabajo se usa con `tenue` para no restar contraste a pleno sol.
 */

import { useMemo } from 'react'

const W = 1440
const H = 900

function anillos(semilla: number) {
  const rnd = (n: number) => {
    const x = Math.sin(n * 127.1 + semilla * 311.7) * 43758.5453
    return x - Math.floor(x)
  }
  const cerros = [
    { x: W * (0.72 + rnd(1) * 0.15), y: H * (0.25 + rnd(2) * 0.2), r: 520 },
    { x: W * (0.08 + rnd(3) * 0.15), y: H * (0.85 + rnd(4) * 0.1), r: 420 },
  ]
  const trazos: Array<{ d: string; maestra: boolean }> = []
  cerros.forEach((c, ci) => {
    const total = 15
    for (let k = 1; k <= total; k++) {
      const base = (c.r / total) * k
      let d = ''
      const pasos = 90
      for (let i = 0; i <= pasos; i++) {
        const t = (i / pasos) * Math.PI * 2
        const ruido =
          Math.sin(t * 3 + rnd(ci + 5) * 6 + k * 0.18) * (base * 0.09) +
          Math.sin(t * 5 + rnd(ci + 9) * 6 - k * 0.11) * (base * 0.045) +
          Math.sin(t * 2 + k * 0.3) * (base * 0.06)
        const r = base + ruido
        const x = c.x + Math.cos(t) * r * 1.25
        const y = c.y + Math.sin(t) * r * 0.82
        d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)
      }
      trazos.push({ d: d + 'Z', maestra: k % 5 === 0 })
    }
  })
  return trazos
}

export function Topografia({
  semilla = 1,
  tenue = false,
  className = '',
}: {
  semilla?: number
  /** Versión más suave, para detrás de pantallas de trabajo. */
  tenue?: boolean
  className?: string
}) {
  const trazos = useMemo(() => anillos(semilla), [semilla])
  const k = tenue ? 0.75 : 1
  return (
    <svg
      className={['pointer-events-none absolute inset-0 h-full w-full text-ink-3', className].join(' ')}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      {trazos.map((t, i) => (
        <path
          key={i}
          d={t.d}
          fill="none"
          stroke={t.maestra ? 'var(--color-beam)' : 'currentColor'}
          strokeOpacity={(t.maestra ? 0.3 : 0.16) * k}
          strokeWidth={t.maestra ? 1.4 : 1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}
