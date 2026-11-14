import { afterEach, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { esCierreDelServidor, poolDePrueba } from './helpers/pool'

/**
 * TSK-E2E-003 — regresión del falso rojo del CI: el `57P01` que manda
 * PostgreSQL al apagar el contenedor de pruebas no debe tumbar la corrida, y
 * cualquier otro error de un cliente inactivo sí debe verse. No necesita Docker:
 * el pool no abre conexiones hasta la primera consulta.
 */

let pool: Pool | null = null

afterEach(async () => {
  await pool?.end()
  pool = null
})

function errorPg(code: string, mensaje = 'terminating connection due to administrator command'): Error {
  return Object.assign(new Error(mensaje), { code, severity: 'FATAL' })
}

describe('pool de pruebas (TSK-E2E-003)', () => {
  it('reconoce el cierre ordenado del servidor y nada más', () => {
    expect(esCierreDelServidor(errorPg('57P01'))).toBe(true)
    expect(esCierreDelServidor(errorPg('57P02'))).toBe(false)
    expect(esCierreDelServidor(new Error('sin código'))).toBe(false)
    expect(esCierreDelServidor(null)).toBe(false)
  })

  it('el 57P01 de un cliente inactivo no se convierte en excepción no manejada', () => {
    pool = poolDePrueba('postgres://nadie@127.0.0.1:1/nada')
    expect(() => pool!.emit('error', errorPg('57P01'))).not.toThrow()
  })

  it('cualquier otro error de un cliente inactivo se sigue viendo', () => {
    pool = poolDePrueba('postgres://nadie@127.0.0.1:1/nada')
    expect(() => pool!.emit('error', errorPg('XX000', 'falla real'))).toThrow('falla real')
  })
})
