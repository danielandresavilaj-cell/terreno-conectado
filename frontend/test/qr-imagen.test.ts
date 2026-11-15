/* QR imprimible y lector — TSK-OPS-003-C, tramo 3.
 *
 * Ida y vuelta sin cámara: el QR que genera la pantalla Activos, pintado como
 * píxeles, lo lee el mismo decodificador que usa el lector de la cámara.
 */
import { describe, expect, it } from 'vitest'
import { normalizarQr } from '@terreno/shared'
import { matrizQr } from '../src/lib/qr-imagen'
import { leerQr } from '../src/lib/qr-lector'

/** Pinta la matriz en RGBA con margen blanco (como una etiqueta impresa). */
function pintar(matriz: boolean[][], escala = 4, margen = 4): { datos: Uint8ClampedArray; lado: number } {
  const n = matriz.length
  const lado = (n + margen * 2) * escala
  const datos = new Uint8ClampedArray(lado * lado * 4).fill(255)
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < n; c++) {
      if (!matriz[f][c]) continue
      for (let y = 0; y < escala; y++) {
        for (let x = 0; x < escala; x++) {
          const i = (((f + margen) * escala + y) * lado + (c + margen) * escala + x) * 4
          datos[i] = datos[i + 1] = datos[i + 2] = 0
        }
      }
    }
  }
  return { datos, lado }
}

describe('QR imprimible y lector (TSK-OPS-003-C)', () => {
  const contenido = 'tc1:abcdefghijklmnopqrstuv'

  it('genera una matriz cuadrada', () => {
    const m = matrizQr(contenido)
    expect(m.length).toBeGreaterThanOrEqual(21)
    expect(m.every((fila) => fila.length === m.length)).toBe(true)
  })

  it('lo que se imprime se lee de vuelta igual y lo acepta la app', () => {
    const { datos, lado } = pintar(matrizQr(contenido))
    const leido = leerQr(datos, lado, lado)
    expect(leido).toBe(contenido)
    expect(normalizarQr(leido as string)).toBe(contenido)
  })

  it('un cuadro sin QR no devuelve nada', () => {
    const lado = 64
    expect(leerQr(new Uint8ClampedArray(lado * lado * 4).fill(255), lado, lado)).toBeNull()
  })
})
