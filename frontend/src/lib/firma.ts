import type { SignatureStroke } from '@terreno/shared'

/**
 * TSK-OFF-018 (FR-056) — la firma que sale del teléfono siempre cumple lo que
 * exige el servidor (`backend/src/sync/sync.service.ts`, `assertSignatureStrokes`):
 *
 *  - cada trazo con al menos 2 puntos (un toque suelto, como el punto de una
 *    "i", se guarda como un trazo de 2 puntos iguales y no se pierde);
 *  - como máximo 32 trazos y 1024 puntos en total;
 *  - coordenadas enteras en 0..1000.
 *
 * Marco de la firma: x e y comparten UNA escala. El dibujo se recorta a su
 * contorno y se centra en un rectángulo de 1000 × 500 (la proporción de una
 * línea de firma), así no se deforma aunque se haya dibujado en vertical o en
 * horizontal. Quien la dibuje debe usar `viewBox="0 0 1000 500"`.
 */

export const MAX_TRAZOS = 32
export const MAX_PUNTOS = 1024
export const ANCHO_FIRMA = 1000
export const ALTO_FIRMA = 500
const MARGEN = 20

type Punto = { x: number; y: number }

const limitar = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)))

/** Distancia de `p` al segmento `a`–`b`. */
function distanciaASegmento(p: Punto, a: Punto, b: Punto): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const largo2 = dx * dx + dy * dy
  if (largo2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / largo2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Ramer–Douglas–Peucker iterativo: conserva los extremos y la forma del trazo. */
export function simplificarTrazo(puntos: readonly Punto[], tolerancia: number): Punto[] {
  if (puntos.length <= 2 || tolerancia <= 0) return [...puntos]
  const conservar = new Uint8Array(puntos.length)
  conservar[0] = 1
  conservar[puntos.length - 1] = 1
  const pila: Array<[number, number]> = [[0, puntos.length - 1]]
  while (pila.length > 0) {
    const [ini, fin] = pila.pop() as [number, number]
    let maxDist = 0
    let indice = -1
    for (let i = ini + 1; i < fin; i++) {
      const d = distanciaASegmento(puntos[i], puntos[ini], puntos[fin])
      if (d > maxDist) {
        maxDist = d
        indice = i
      }
    }
    if (indice !== -1 && maxDist > tolerancia) {
      conservar[indice] = 1
      pila.push([ini, indice], [indice, fin])
    }
  }
  return puntos.filter((_, i) => conservar[i] === 1)
}

/** Une puntos consecutivos repetidos y deja todo trazo con al menos 2 puntos. */
function completarTrazos(strokes: readonly SignatureStroke[]): SignatureStroke[] {
  const salida: SignatureStroke[] = []
  for (const s of strokes) {
    const puntos: Punto[] = []
    for (const p of s.points ?? []) {
      if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue
      const ultimo = puntos.at(-1)
      if (ultimo && ultimo.x === p.x && ultimo.y === p.y) continue
      puntos.push({ x: p.x, y: p.y })
    }
    if (puntos.length === 0) continue
    if (puntos.length === 1) puntos.push({ ...puntos[0] })
    salida.push({ points: puntos })
  }
  return salida
}

const largoTrazo = (s: SignatureStroke) =>
  s.points.reduce((t, p, i) => (i === 0 ? 0 : t + Math.hypot(p.x - s.points[i - 1].x, p.y - s.points[i - 1].y)), 0)

/**
 * Deja la firma dentro de los límites del servidor sin cambiar su forma:
 * redondea a 0..1000, completa los trazos de un punto, conserva los 32 trazos
 * más largos (en su orden) y simplifica hasta quedar en 1024 puntos o menos.
 * Sirve tanto para una firma recién dibujada como para una ya guardada.
 */
export function ajustarALimites(strokes: readonly SignatureStroke[]): SignatureStroke[] {
  let trazos = completarTrazos(
    strokes.map((s) => ({
      points: (s.points ?? []).map((p) => ({ x: limitar(p.x, 1000), y: limitar(p.y, 1000) })),
    })),
  )
  if (trazos.length > MAX_TRAZOS) {
    const elegidos = new Set(
      trazos
        .map((s, i) => ({ i, largo: largoTrazo(s) }))
        .sort((a, b) => b.largo - a.largo)
        .slice(0, MAX_TRAZOS)
        .map((t) => t.i),
    )
    trazos = trazos.filter((_, i) => elegidos.has(i))
  }
  const total = (t: SignatureStroke[]) => t.reduce((n, s) => n + s.points.length, 0)
  let tolerancia = 0.5
  let resultado = trazos
  while (total(resultado) > MAX_PUNTOS && tolerancia < 1000) {
    tolerancia *= 2
    resultado = completarTrazos(trazos.map((s) => ({ points: simplificarTrazo(s.points, tolerancia) })))
  }
  return resultado
}

/**
 * Pasa los trazos dibujados en el pad (en píxeles de pantalla) al marco de la
 * firma: recorta al contorno, escala con UN solo factor y centra en 1000 × 500.
 * Luego ajusta a los límites del servidor.
 */
export function normalizarFirma(trazosPantalla: ReadonlyArray<{ points: readonly Punto[] }>): SignatureStroke[] {
  const puntos = trazosPantalla.flatMap((s) => s.points)
  if (puntos.length === 0) return []
  const minX = Math.min(...puntos.map((p) => p.x))
  const maxX = Math.max(...puntos.map((p) => p.x))
  const minY = Math.min(...puntos.map((p) => p.y))
  const maxY = Math.max(...puntos.map((p) => p.y))
  const ancho = maxX - minX
  const alto = maxY - minY
  const util = { ancho: ANCHO_FIRMA - 2 * MARGEN, alto: ALTO_FIRMA - 2 * MARGEN }
  // Una firma que es sólo un punto o una línea recta no define escala en un eje.
  const escala = Math.min(
    ancho > 0 ? util.ancho / ancho : Infinity,
    alto > 0 ? util.alto / alto : Infinity,
  )
  const k = Number.isFinite(escala) ? escala : 1
  const offX = (ANCHO_FIRMA - ancho * k) / 2
  const offY = (ALTO_FIRMA - alto * k) / 2
  return ajustarALimites(
    trazosPantalla.map((s) => ({
      points: s.points.map((p) => ({ x: (p.x - minX) * k + offX, y: (p.y - minY) * k + offY })),
    })),
  )
}

export function firmaTieneTrazo(strokes: ReadonlyArray<{ points: readonly unknown[] }>): boolean {
  return strokes.some((stroke) => stroke.points.length >= 2)
}
