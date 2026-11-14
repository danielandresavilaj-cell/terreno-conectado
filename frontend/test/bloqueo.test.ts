import { describe, expect, it } from 'vitest'
import { mensajeBloqueo } from '../src/lib/bloqueo'

describe('mensaje de cuenta bloqueada (TSK-AUTH-012, FR-005)', () => {
  it('dice los minutos que faltan según el servidor', () => {
    expect(mensajeBloqueo('Cuenta bloqueada temporalmente (7 min)')).toMatch(/en 7 minutos\.$/)
    expect(mensajeBloqueo('Cuenta bloqueada temporalmente (1 min)')).toMatch(/en 1 minuto\.$/)
  })

  it('sin el dato, dice el bloqueo completo de 15 minutos', () => {
    expect(mensajeBloqueo('Cuenta bloqueada temporalmente')).toMatch(/en 15 minutos\.$/)
    expect(mensajeBloqueo(undefined)).toMatch(/en 15 minutos\.$/)
  })
})
