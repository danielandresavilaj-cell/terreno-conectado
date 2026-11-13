import { describe, expect, it } from 'vitest'
import { crearCacheFotos } from '../src/lib/fotos'

const blob = (texto: string) => new Blob([texto], { type: 'image/jpeg' })

describe('caché de fotos de evidencia (TSK-REP-008)', () => {
  it('baja cada foto una sola vez aunque se pida varias veces a la vez', async () => {
    const pedidas: string[] = []
    const cache = crearCacheFotos(async (id) => {
      pedidas.push(id)
      return blob(id)
    })

    const [a, b] = await Promise.all([cache.pedir('foto-1'), cache.pedir('foto-1')])
    await cache.pedir('foto-1')

    expect(a).toBe(b)
    expect(pedidas).toEqual(['foto-1'])
  })

  it('no recuerda un fallo: el siguiente intento vuelve a bajar', async () => {
    let intentos = 0
    const cache = crearCacheFotos(async () => {
      intentos += 1
      if (intentos === 1) throw new Error('sin señal')
      return blob('ok')
    })

    await expect(cache.pedir('foto-1')).rejects.toThrow('sin señal')
    expect(cache.tamano()).toBe(0)
    await expect(cache.pedir('foto-1')).resolves.toBeInstanceOf(Blob)
    expect(intentos).toBe(2)
  })

  it('con el tope lleno descarta la que hace más tiempo no se usa', async () => {
    const pedidas: string[] = []
    const cache = crearCacheFotos(async (id) => {
      pedidas.push(id)
      return blob(id)
    }, 2)

    await cache.pedir('a')
    await cache.pedir('b')
    await cache.pedir('a') // `a` vuelve a ser la más reciente
    await cache.pedir('c') // se descarta `b`
    expect(cache.tamano()).toBe(2)

    await cache.pedir('a')
    await cache.pedir('b')
    expect(pedidas).toEqual(['a', 'b', 'c', 'b'])
  })
})
