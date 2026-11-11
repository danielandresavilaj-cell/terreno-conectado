/* Titulares del dashboard de supervisión — TSK-REP-006.
 * Sin datos se dice "sin datos suficientes" y nunca se inventa un número. */
import { describe, expect, it } from 'vitest'
import type { DashboardSupervision } from '@terreno/shared'
import {
  SIN_DATOS,
  duracion,
  porcentaje,
  titularActividad,
  titularHallazgos,
  titularRevision,
  titularSincronizacion,
} from '../src/lib/supervision'

const vacio: DashboardSupervision = {
  hallazgos: {
    abiertos_por_antiguedad: { hasta_1d: 0, de_1_a_7d: 0, mas_de_7d: 0 },
    criticos_abiertos: [],
    cierre_horas_media: null,
    cierre_horas_p50: null,
    resueltos_periodo: 0,
    top_nok: [],
  },
  revision: { pendientes: 0, dias_mas_antigua: null, dias_mediana: null, mas_antiguas: [] },
  actividad: { por_dia: [{ dia: '2026-11-10', inspecciones: 0 }], por_faena: [], por_trabajador: [], faenas_sin_actividad: 0 },
  sincronizacion: {
    espera_sin_senal_p50_seg: null,
    espera_sin_senal_p95_seg: null,
    muestras_espera: 0,
    procesamiento_p95_seg: null,
    lotes: 0,
    lotes_con_error: 0,
    equipos_inactivos: [],
    equipos_activos_30d: 0,
  },
}

describe('titulares sin datos', () => {
  it('cada bloque dice algo honesto cuando no hay nada', () => {
    expect(titularHallazgos(vacio.hallazgos)).toBe('Sin hallazgos abiertos')
    expect(titularRevision(vacio.revision)).toBe('Todo revisado')
    expect(titularActividad(vacio.actividad)).toBe('Sin inspecciones en el período')
    expect(titularSincronizacion(vacio.sincronizacion)).toBe(SIN_DATOS)
    expect(duracion(null)).toBe('—')
    expect(porcentaje(0, 0)).toBeNull()
  })
})

describe('titulares accionables', () => {
  it('prioriza críticos, antigüedad y equipos inactivos', () => {
    expect(
      titularHallazgos({
        ...vacio.hallazgos,
        abiertos_por_antiguedad: { hasta_1d: 0, de_1_a_7d: 0, mas_de_7d: 2 },
        criticos_abiertos: [{ id: 'x', descripcion: 'd', severidad: 'critical', faena_nombre: null, dias_abierto: 9 }],
      }),
    ).toBe('1 hallazgo crítico o alto abierto · 2 con más de 7 días')
    expect(titularRevision({ ...vacio.revision, pendientes: 3, dias_mas_antigua: 5.6 })).toBe(
      '3 inspecciones esperan revisión · la más antigua hace 5 días',
    )
    expect(
      titularSincronizacion({
        ...vacio.sincronizacion,
        equipos_inactivos: [{ device_id: 'd', usuario: 'Ana', ultima_sync: '', horas_sin_sync: 30 }],
      }),
    ).toBe('1 equipo lleva más de 24 h sin sincronizar')
    expect(duracion(5400)).toBe('1,5 h')
    expect(duracion(45)).toBe('45 s')
    expect(porcentaje(1, 3)).toBe(33.3)
  })
})
