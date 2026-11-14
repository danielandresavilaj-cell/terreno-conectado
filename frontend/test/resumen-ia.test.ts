/* Resumen de Gerencia con IA — reglas de la pantalla (TSK-REP-014, FR-068). */
import { describe, expect, it } from 'vitest'
import type { EstadoResumenIA, ResumenIA } from '@terreno/shared'
import { cuandoSeGenero, etiquetaPeriodo, pieResumenIA, restantesTras, vistaResumenIA } from '../src/lib/resumen-ia'

const conIA: EstadoResumenIA = { disponible: true, restantes_hoy: 5, tope_diario: 20 }
const sinIA: EstadoResumenIA = { disponible: false, restantes_hoy: 0, tope_diario: 20 }
const ahora = new Date(2026, 10, 15, 16, 0, 0)
const guardado: ResumenIA = {
  id: 'r1',
  titular: 'Semana con 1 hallazgo crítico.',
  puntos: ['11 inspecciones.'],
  atencion: null,
  modelo: 'claude-haiku-5-5',
  generado_en: new Date(2026, 10, 15, 13, 5).toISOString(),
  faena: 'Todas las faenas',
  desde: new Date(2026, 10, 2).toISOString(),
  hasta: new Date(2026, 10, 8, 23, 59, 59, 999).toISOString(),
  cerrado: true,
  desde_cache: true,
  desactualizado: false,
}

describe('vistaResumenIA', () => {
  it('sin IA y sin resumen guardado (o sin saberlo todavía) el bloque no aparece', () => {
    expect(vistaResumenIA(null, null, true, false)).toEqual({ visible: false })
    expect(vistaResumenIA(sinIA, null, true, false)).toEqual({ visible: false })
  })

  it('sin IA pero con un resumen guardado: se ve, sin botón', () => {
    expect(vistaResumenIA(sinIA, guardado, true, false)).toEqual({ visible: true, accion: null, puedePedir: false, motivo: null })
  })

  it('sin resumen para el filtro ofrece "resumir"', () => {
    expect(vistaResumenIA(conIA, null, true, false)).toEqual({ visible: true, accion: 'resumir', puedePedir: true, motivo: null })
  })

  it('con un resumen al día no ofrece nada: pedirlo otra vez no aportaría', () => {
    expect(vistaResumenIA(conIA, guardado, true, false)).toMatchObject({ accion: null, puedePedir: false })
  })

  it('con un resumen desactualizado ofrece "actualizar"', () => {
    expect(vistaResumenIA(conIA, { ...guardado, desactualizado: true }, true, false)).toMatchObject({ accion: 'actualizar', puedePedir: true })
  })

  it('sin señal no se puede pedir, y lo dice', () => {
    expect(vistaResumenIA(conIA, null, false, false)).toEqual({
      visible: true,
      accion: 'resumir',
      puedePedir: false,
      motivo: 'El resumen con IA necesita conexión.',
    })
  })

  it('mientras redacta no se puede pedir otro', () => {
    expect(vistaResumenIA(conIA, null, true, true)).toMatchObject({ puedePedir: false })
  })

  it('sin cupo del día explica cuándo se renueva', () => {
    const v = vistaResumenIA({ ...conIA, restantes_hoy: 0 }, null, true, false)
    expect(v).toMatchObject({ visible: true, puedePedir: false })
    expect(v.visible && v.motivo).toContain('20 resúmenes de hoy')
  })
})

describe('restantesTras', () => {
  it('un resumen nuevo gasta uno del cupo; uno que ya estaba guardado no', () => {
    expect(restantesTras(conIA, { ...guardado, desde_cache: false }).restantes_hoy).toBe(4)
    expect(restantesTras(conIA, guardado).restantes_hoy).toBe(5)
    expect(restantesTras({ ...conIA, restantes_hoy: 0 }, { ...guardado, desde_cache: false }).restantes_hoy).toBe(0)
  })
})

describe('pie y fechas', () => {
  it('el pie deja claro que lo escribió una IA, cuándo y cuántos quedan', () => {
    const pie = pieResumenIA(guardado, 4, ahora)
    expect(pie).toBe('Generado con IA hoy a las 13:05 a partir de las cifras de este panel. Revísalo antes de compartirlo. Quedan 4 resúmenes hoy.')
    expect(pieResumenIA(guardado, null, ahora)).not.toContain('Quedan')
  })

  it('un resumen de otro día dice la fecha', () => {
    expect(cuandoSeGenero(new Date(2026, 10, 9, 18, 2).toISOString(), ahora)).toMatch(/^el 9 nov\.? a las 18:02$/)
  })

  it('nombra el período en la hora de quien mira', () => {
    expect(etiquetaPeriodo(guardado.desde, guardado.hasta)).toMatch(/^2 nov\.? – 8 nov\.? 2026$/)
    expect(etiquetaPeriodo(null, null)).toBe('Todo el período')
    expect(etiquetaPeriodo(new Date(2025, 11, 29).toISOString(), new Date(2026, 0, 4).toISOString())).toMatch(/2025 – .*2026$/)
  })
})
