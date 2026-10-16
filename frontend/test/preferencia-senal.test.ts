import { describe, expect, it } from 'vitest'
import { guardarSinSenalManual, leerSinSenalManual } from '../src/lib/preferencia-senal'

describe('preferencia manual de señal', () => {
  it('conserva el apagado al releer y sólo lo borra al encender explícitamente', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
    expect(leerSinSenalManual(storage)).toBe(false)
    guardarSinSenalManual(true, storage)
    expect(leerSinSenalManual(storage)).toBe(true)
    expect(leerSinSenalManual(storage)).toBe(true)
    guardarSinSenalManual(false, storage)
    expect(leerSinSenalManual(storage)).toBe(false)
  })
  it('degrada sin fallar si el navegador deniega el almacenamiento', () => {
    const storage = { getItem: () => { throw Error('denied') }, setItem: () => { throw Error('denied') }, removeItem: () => { throw Error('denied') } }
    expect(leerSinSenalManual(storage)).toBe(false)
    expect(() => guardarSinSenalManual(true, storage)).not.toThrow()
    expect(() => guardarSinSenalManual(false, storage)).not.toThrow()
  })
})
