import { describe, expect, it } from 'vitest'
import { csvDeClaves, leerPlanilla } from '../src/lib/alta-masiva'

describe('alta masiva de cuentas (TSK-ADM-002)', () => {
  it('lee coma, punto y coma y tabulación; el rol es opcional y en español', () => {
    const { filas, errores } = leerPlanilla(
      ['Ana Pérez, ana@minera.cl, supervisor', 'Luis Soto;LUIS@minera.cl', 'Rosa Díaz\trosa@minera.cl\tAdministrador'].join('\n'),
    )
    expect(errores).toEqual([])
    expect(filas).toEqual([
      { linea: 1, nombre: 'Ana Pérez', email: 'ana@minera.cl', rol: 'supervisor' },
      { linea: 2, nombre: 'Luis Soto', email: 'luis@minera.cl', rol: 'field_worker' },
      { linea: 3, nombre: 'Rosa Díaz', email: 'rosa@minera.cl', rol: 'tenant_admin' },
    ])
  })

  it('ignora el encabezado y las líneas vacías', () => {
    const { filas } = leerPlanilla('nombre;correo;rol\n\nAna;ana@minera.cl;Supervisión\n')
    expect(filas).toEqual([{ linea: 3, nombre: 'Ana', email: 'ana@minera.cl', rol: 'supervisor' }])
  })

  it('rechaza cada línea mala con su motivo, sin perder las buenas', () => {
    const { filas, errores } = leerPlanilla(
      ['Ana,ana@minera.cl', ',sin@nombre.cl', 'Pepe,no-es-correo', 'Juan,juan@minera.cl,gerente', 'Ana 2,ANA@minera.cl', 'Ya existe,viejo@minera.cl'].join('\n'),
      ['viejo@minera.cl'],
    )
    expect(filas.map((f) => f.email)).toEqual(['ana@minera.cl'])
    expect(errores.map((e) => e.linea)).toEqual([2, 3, 4, 5, 6])
    expect(errores[2].motivo).toMatch(/Rol desconocido/)
    expect(errores[3].motivo).toMatch(/repetido/)
  })

  it('arma la planilla de claves escapando comillas', () => {
    expect(csvDeClaves([{ nombre: 'Ana "La Jefa"', email: 'a@b.cl', clave: 'abc' }])).toBe(
      'nombre;correo;clave temporal\r\n"Ana ""La Jefa""";"a@b.cl";"abc"',
    )
  })
})
