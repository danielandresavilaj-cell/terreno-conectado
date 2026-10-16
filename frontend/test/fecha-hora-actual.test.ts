import { describe, expect, it } from 'vitest'
import { fechaHoraLocal } from '../src/lib/fecha-hora-actual'

describe('fechaHoraLocal', () => {
  it('usa las partes locales, sin desplazar el día a UTC', () => {
    const ahora = new Date(2026, 9, 15, 0, 5)
    expect(fechaHoraLocal(ahora)).toEqual({ fecha: '2026-10-15', hora: '00:05' })
  })
})
