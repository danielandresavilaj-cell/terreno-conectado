import { describe, expect, it } from 'vitest'
import { agregarPunto, firmaTieneTrazo } from '../src/components/FirmaCierre'
import { motivoRechazoLegible } from '../src/screens/Conflictos'
import {
  ALTO_FIRMA,
  ANCHO_FIRMA,
  MAX_PUNTOS,
  MAX_TRAZOS,
  ajustarALimites,
  normalizarFirma,
  simplificarTrazo,
} from '../src/lib/firma'
import { mensajeError } from '../src/lib/cola-vista'

type Trazo = { points: Array<{ x: number; y: number }> }

/** Reglas del servidor (`backend/src/sync/sync.service.ts`, assertSignatureStrokes). */
function cumpleServidor(strokes: Trazo[]): boolean {
  const puntos = strokes.reduce((n, s) => n + s.points.length, 0)
  return (
    strokes.length >= 1 &&
    strokes.length <= MAX_TRAZOS &&
    puntos <= MAX_PUNTOS &&
    strokes.every(
      (s) =>
        s.points.length >= 2 &&
        s.points.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 1000),
    )
  )
}

/** Trazo ondulado de `n` puntos: una firma real, no una recta. */
function onda(n: number, dy = 0): Trazo {
  return { points: Array.from({ length: n }, (_, i) => ({ x: (i * 997) / n, y: 300 + dy + Math.round(150 * Math.sin(i / 7)) })) }
}

describe('firma de cierre (TSK-OFF-018)', () => {
  it('no acepta un toque aislado como firma', () => {
    expect(firmaTieneTrazo([])).toBe(false)
    expect(firmaTieneTrazo([{ points: [{ x: 1, y: 1 }] }])).toBe(false)
    expect(firmaTieneTrazo([{ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }])).toBe(true)
  })

  it('descarta los movimientos menores a 2 px del dedo', () => {
    const base = [{ x: 10, y: 10 }]
    expect(agregarPunto(base, { x: 11, y: 10 })).toBe(base)
    expect(agregarPunto(base, { x: 13, y: 10 })).toEqual([{ x: 10, y: 10 }, { x: 13, y: 10 }])
  })

  it('el punto de una "i" se conserva como trazo de 2 puntos', () => {
    const firma = ajustarALimites([onda(40), { points: [{ x: 500, y: 100 }] }])
    expect(firma).toHaveLength(2)
    expect(firma[1].points).toEqual([{ x: 500, y: 100 }, { x: 500, y: 100 }])
    expect(cumpleServidor(firma)).toBe(true)
  })

  it('una firma larga se simplifica bajo 1024 puntos sin perder trazos', () => {
    const larga = [onda(900), onda(900, 50), onda(600, 100)]
    const firma = ajustarALimites(larga)
    expect(firma).toHaveLength(3)
    expect(cumpleServidor(firma)).toBe(true)
    // Conserva los extremos de cada trazo.
    expect(firma[0].points[0]).toEqual({ x: 0, y: 300 })
  })

  it('con más de 32 trazos conserva los 32 más largos, en su orden', () => {
    const muchos = Array.from({ length: 40 }, (_, i) => ({
      points: [{ x: i * 20, y: 10 }, { x: i * 20 + (i % 2 === 0 ? 15 : 3), y: 10 }],
    }))
    const firma = ajustarALimites(muchos)
    expect(firma).toHaveLength(MAX_TRAZOS)
    expect(cumpleServidor(firma)).toBe(true)
    const xs = firma.map((s) => s.points[0].x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })

  it('redondea y recorta coordenadas fuera de rango', () => {
    expect(ajustarALimites([{ points: [{ x: -4.2, y: 10.6 }, { x: 1200, y: 999.4 }] }])).toEqual([
      { points: [{ x: 0, y: 11 }, { x: 1000, y: 999 }] },
    ])
  })

  it('RDP conserva los extremos y quita los puntos alineados', () => {
    const recta = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i }))
    expect(simplificarTrazo(recta, 0.5)).toEqual([{ x: 0, y: 0 }, { x: 49, y: 49 }])
  })

  it('escala con un solo factor: una firma dibujada en vertical no se deforma', () => {
    // Un cuadrado de 200×200 px dibujado en un pad angosto.
    const cuadrado = [{ points: [{ x: 50, y: 300 }, { x: 250, y: 300 }, { x: 250, y: 500 }, { x: 50, y: 500 }, { x: 50, y: 300 }] }]
    const [s] = normalizarFirma(cuadrado)
    const xs = s.points.map((p) => p.x)
    const ys = s.points.map((p) => p.y)
    const ancho = Math.max(...xs) - Math.min(...xs)
    const alto = Math.max(...ys) - Math.min(...ys)
    expect(Math.abs(ancho - alto)).toBeLessThanOrEqual(1)
    // Centrado en el marco 1000 × 500.
    expect(Math.round((Math.max(...xs) + Math.min(...xs)) / 2)).toBe(ANCHO_FIRMA / 2)
    expect(Math.round((Math.max(...ys) + Math.min(...ys)) / 2)).toBe(ALTO_FIRMA / 2)
  })

  it('una firma ancha ocupa el ancho del marco y queda dentro de los límites', () => {
    const firma = normalizarFirma([{ points: Array.from({ length: 3000 }, (_, i) => ({ x: i / 3, y: 200 + 40 * Math.sin(i / 30) })) }])
    expect(cumpleServidor(firma)).toBe(true)
    const xs = firma[0].points.map((p) => p.x)
    expect(Math.min(...xs)).toBe(20)
    expect(Math.max(...xs)).toBe(980)
  })

  it('el teléfono explica el rechazo de la firma sin JSON ni rutas internas', () => {
    const crudo =
      'HTTP 400: {"message":"records[7].payload.strokes debe tener trazos de al menos 2 puntos (máx. 1024)","error":"Bad Request","status'
    expect(mensajeError(crudo)).toMatch(/^La firma no tenía el formato/)
    expect(mensajeError('HTTP 400: {"message":"records[2].payload.width/height inválidos","error":"Bad Request"}')).toBe(
      'El servidor rechazó un dato: width/height inválidos',
    )
  })

  it('la supervisión ve el motivo del rechazo en palabras simples', () => {
    expect(motivoRechazoLegible('records[7].payload.strokes debe tener trazos de al menos 2 puntos (máx. 1024)')).toMatch(/firma de cierre/)
    expect(motivoRechazoLegible('records[3].payload.bytes fuera de rango (1..5242880)')).toBe('bytes fuera de rango (1..5242880)')
  })
})
