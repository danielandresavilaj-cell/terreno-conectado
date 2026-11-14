/**
 * Resumen de Gerencia con IA — piezas puras (TSK-REP-014, FR-068).
 *
 * Sin base de datos ni red: qué sale del sistema hacia la IA (y qué no), la
 * clave del filtro, la huella de las cifras, períodos cerrados, la validación de la salida del modelo y el redactor sin
 * clave. El flujo completo por la API está en `resumen-ia.spec.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { DashboardSummary } from '@terreno/shared'
import { alcanceResumen, datosParaResumen, huellaCifras, periodoCerrado } from '../src/dashboard/resumen-ia.datos'
import { RedactorClaude, interpretarSalida } from '../src/dashboard/resumen-ia'
import { topeDiarioResumen } from '../src/dashboard/resumen-ia.service'

const FAENA = '0190f0a0-0000-7000-8000-0000000000f1'

function resumen(parcial: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    site_id: FAENA,
    faenas: [
      { id: FAENA, nombre: 'Faena Los Cóndores' },
      { id: '0190f0a0-0000-7000-8000-0000000000f2', nombre: 'Obra Norte' },
    ] as DashboardSummary['faenas'],
    autores: [{ id: '0190f0a0-0000-7000-8000-00000000aaaa', nombre: 'Camila Rojas' }] as DashboardSummary['autores'],
    inspecciones_por_estado: { draft: 1, in_progress: 2, submitted: 5, reviewed: 3 },
    hallazgos_por_severidad: { low: 4, medium: 2, high: 1, critical: 1 },
    hallazgos_urgentes: 2,
    hallazgos_vencidos: 1,
    tendencia_semanal: [{ semana: '2026-11-09', inspecciones: 11, hallazgos: 8 }],
    hallazgos_total: 8,
    conflictos_pendientes: 0,
    sincronizaciones: 14,
    ...parcial,
  }
}

const periodo = { siteId: FAENA, desde: '2026-11-08T03:00:00.000Z', hasta: '2026-11-15T02:59:59.999Z' }

describe('datosParaResumen: lo único que sale hacia la IA', () => {
  it('lleva faena, período en días de Chile y cifras con claves en español', () => {
    const d = datosParaResumen(resumen(), periodo)
    expect(d).toEqual({
      faena: 'Faena Los Cóndores',
      periodo: { desde: '2026-11-08', hasta: '2026-11-14' },
      inspecciones_por_estado: { borrador: 1, en_curso: 2, enviadas: 5, revisadas: 3 },
      hallazgos_por_severidad: { baja: 4, media: 2, alta: 1, critica: 1 },
      hallazgos_total: 8,
      hallazgos_urgentes_sin_resolver: 2,
      acciones_con_plazo_vencido: 1,
      conflictos_pendientes_de_revision: 0,
      sincronizaciones: 14,
      tendencia_semanal: [{ semana: '2026-11-09', inspecciones: 11, hallazgos: 8 }],
    })
  })

  it('no lleva personas ni ids (ADR-005, Enmienda 1)', () => {
    const texto = JSON.stringify(datosParaResumen(resumen(), periodo))
    expect(texto).not.toContain('Camila')
    expect(texto).not.toContain('autor')
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(texto).not.toContain('Obra Norte')
  })

  it('un período cerrado no lleva lo que se mide a hoy (tendencia y plazos vencidos)', () => {
    const d = datosParaResumen(resumen(), periodo, true)
    expect(d).not.toHaveProperty('tendencia_semanal')
    expect(d).not.toHaveProperty('acciones_con_plazo_vencido')
    expect(d.hallazgos_urgentes_sin_resolver).toBe(2)
  })

  it('"mes anterior" en hora de Chile termina el 31, no el 1 del mes siguiente', () => {
    const octubre = { siteId: null, desde: '2026-10-01T03:00:00.000Z', hasta: '2026-11-01T02:59:59.999Z' }
    expect(datosParaResumen(resumen(), octubre).periodo).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' })
  })

  it('sin faena elegida dice "todas las faenas"', () => {
    expect(datosParaResumen(resumen({ site_id: null }), { siteId: null, desde: null, hasta: null })).toMatchObject({
      faena: 'todas las faenas',
      periodo: { desde: null, hasta: null },
    })
  })
})

describe('huellaCifras', () => {
  const d = datosParaResumen(resumen(), periodo)
  it('es la misma para la misma empresa y las mismas cifras', () => {
    expect(huellaCifras('t1', d)).toBe(huellaCifras('t1', datosParaResumen(resumen(), periodo)))
    expect(huellaCifras('t1', d)).toMatch(/^[0-9a-f]{64}$/)
  })
  it('cambia con otra empresa o con cualquier cifra distinta', () => {
    expect(huellaCifras('t2', d)).not.toBe(huellaCifras('t1', d))
    expect(huellaCifras('t1', datosParaResumen(resumen({ hallazgos_urgentes: 3 }), periodo))).not.toBe(huellaCifras('t1', d))
  })
  it('no cambia por la hora dentro del mismo día (refresco de 30 s)', () => {
    const otraHora = { ...periodo, desde: '2026-11-08T03:00:30.000Z' }
    expect(huellaCifras('t1', datosParaResumen(resumen(), otraHora))).toBe(huellaCifras('t1', d))
  })
  it('en un período cerrado no cambia porque avance la tendencia o los vencidos', () => {
    const cerrado = huellaCifras('t1', datosParaResumen(resumen(), periodo, true))
    const otroDia = datosParaResumen(resumen({ hallazgos_vencidos: 9, tendencia_semanal: [] }), periodo, true)
    expect(huellaCifras('t1', otroDia)).toBe(cerrado)
  })
})

describe('alcanceResumen y periodoCerrado', () => {
  it('la clave es faena + primer y último día en hora de Chile', () => {
    expect(alcanceResumen(periodo)).toBe(`${FAENA}|2026-11-08|2026-11-14`)
    expect(alcanceResumen({ siteId: null, desde: null, hasta: null })).toBe('todas|inicio|hoy')
  })
  it('la ventana móvil mantiene la misma clave durante el día', () => {
    const tarde = { ...periodo, desde: '2026-11-08T18:00:00.000Z' }
    expect(alcanceResumen(tarde)).toBe(alcanceResumen(periodo))
  })
  it('cerrado = terminó antes de ahora; sin fin, abierto', () => {
    const ahora = new Date('2026-11-15T12:00:00.000Z')
    expect(periodoCerrado(periodo, ahora)).toBe(true)
    expect(periodoCerrado({ ...periodo, hasta: '2026-11-15T13:00:00.000Z' }, ahora)).toBe(false)
    expect(periodoCerrado({ ...periodo, hasta: null }, ahora)).toBe(false)
  })
})

describe('interpretarSalida', () => {
  it('acepta la salida esperada', () => {
    const r = interpretarSalida(JSON.stringify({ titular: 'Semana con 1 hallazgo crítico.', puntos: ['11 inspecciones.', '2 urgentes.'], atencion: null }))
    expect(r).toEqual({ titular: 'Semana con 1 hallazgo crítico.', puntos: ['11 inspecciones.', '2 urgentes.'], atencion: null })
  })
  it('recorta a 4 puntos en vez de perder el resumen', () => {
    const r = interpretarSalida(JSON.stringify({ titular: 'T', puntos: ['a', 'b', 'c', 'd', 'e'], atencion: 'Revisar la correa C-2.' }))
    expect(r?.puntos).toEqual(['a', 'b', 'c', 'd'])
  })
  it('rechaza JSON ilegible, campos faltantes o puntos vacíos', () => {
    expect(interpretarSalida('no es json')).toBeNull()
    expect(interpretarSalida(JSON.stringify({ puntos: ['a'], atencion: null }))).toBeNull()
    expect(interpretarSalida(JSON.stringify({ titular: 'T', puntos: [], atencion: null }))).toBeNull()
  })
})

describe('RedactorClaude sin clave', () => {
  it('queda apagado y no llama a nada', async () => {
    const r = new RedactorClaude('', '')
    expect(r.disponible()).toBe(false)
    expect(r.modelo).toBe('claude-haiku-5-5')
    await expect(r.redactar(datosParaResumen(resumen(), periodo))).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('no está configurada'),
      tokens_entrada: 0,
    })
  })
})

describe('topeDiarioResumen', () => {
  afterEach(() => {
    delete process.env.IA_TOPE_RESUMEN_DIARIO
  })
  it('usa 20 por omisión o con un valor inválido, y respeta un entero válido', () => {
    expect(topeDiarioResumen()).toBe(20)
    process.env.IA_TOPE_RESUMEN_DIARIO = 'muchos'
    expect(topeDiarioResumen()).toBe(20)
    process.env.IA_TOPE_RESUMEN_DIARIO = '5'
    expect(topeDiarioResumen()).toBe(5)
    process.env.IA_TOPE_RESUMEN_DIARIO = '0'
    expect(topeDiarioResumen()).toBe(0)
  })
})
