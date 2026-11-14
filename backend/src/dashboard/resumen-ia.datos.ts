/**
 * Resumen de Gerencia con IA — lo que sale del sistema (TSK-REP-014, FR-068).
 *
 * Esta es la única puerta hacia la IA: arma, a partir del `DashboardSummary`,
 * el período, el nombre de la faena y las cifras agregadas. Deja fuera a
 * propósito los autores (nombres de personas) y los ids (ADR-005, Enmienda 1).
 *
 * Las claves van en español para que el modelo redacte sin traducir los
 * códigos internos (`critical`, `in_progress`…).
 *
 * Un período CERRADO (ya terminó: semana o mes anterior, un rango pasado) no
 * lleva la tendencia de 8 semanas ni los plazos vencidos: esas cifras se miden
 * "a hoy" y cambian cada día. Así el resumen guardado de una semana pasada
 * sólo queda desactualizado si llegan datos sincronizados tarde.
 */
import { createHash } from 'node:crypto'
import type { DashboardSummary } from '@terreno/shared'
import type { FiltrosPeriodo } from './dashboard.contract'

export interface DatosResumen {
  faena: string
  periodo: { desde: string | null; hasta: string | null }
  inspecciones_por_estado: { borrador: number; en_curso: number; enviadas: number; revisadas: number }
  hallazgos_por_severidad: { baja: number; media: number; alta: number; critica: number }
  hallazgos_total: number
  /** Alta o crítica sin resolver, dentro del período. */
  hallazgos_urgentes_sin_resolver: number
  /** Acciones correctivas con plazo vencido, medidas a hoy. Sólo en períodos abiertos. */
  acciones_con_plazo_vencido?: number
  conflictos_pendientes_de_revision: number
  sincronizaciones: number
  /** Últimas 8 semanas (lunes AAAA-MM-DD) hasta hoy. Sólo en períodos abiertos. */
  tendencia_semanal?: Array<{ semana: string; inspecciones: number; hallazgos: number }>
}

/** Zona de las faenas: el producto opera en Chile (spec maestro §1). */
const DIA_CHILE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' })

/** ¿El período terminó antes de `ahora`? Sin `hasta` llega hasta hoy: abierto. */
export function periodoCerrado(filtros: FiltrosPeriodo, ahora = new Date()): boolean {
  return filtros.hasta !== null && new Date(filtros.hasta).getTime() < ahora.getTime()
}

/** Clave del filtro: faena (o `todas`) + primer y último día en hora de Chile. */
export function alcanceResumen(filtros: FiltrosPeriodo): string {
  return `${filtros.siteId ?? 'todas'}|${dia(filtros.desde) ?? 'inicio'}|${dia(filtros.hasta) ?? 'hoy'}`
}

/**
 * ISO → AAAA-MM-DD en hora de Chile. El modelo no necesita la hora, y así la
 * ventana móvil ("7 días"), que corre con el refresco de 30 s, mantiene la
 * misma clave durante el día. En hora de Chile para que "mes anterior" termine
 * el 31 y no el 1 del mes siguiente en UTC.
 */
function dia(iso: string | null): string | null {
  return iso ? DIA_CHILE.format(new Date(iso)) : null
}

export function datosParaResumen(s: DashboardSummary, filtros: FiltrosPeriodo, cerrado = false): DatosResumen {
  const faena = s.site_id ? (s.faenas.find((f) => f.id === s.site_id)?.nombre ?? 'faena sin nombre') : 'todas las faenas'
  return {
    faena,
    periodo: { desde: dia(filtros.desde), hasta: dia(filtros.hasta) },
    inspecciones_por_estado: {
      borrador: s.inspecciones_por_estado.draft,
      en_curso: s.inspecciones_por_estado.in_progress,
      enviadas: s.inspecciones_por_estado.submitted,
      revisadas: s.inspecciones_por_estado.reviewed,
    },
    hallazgos_por_severidad: {
      baja: s.hallazgos_por_severidad.low,
      media: s.hallazgos_por_severidad.medium,
      alta: s.hallazgos_por_severidad.high,
      critica: s.hallazgos_por_severidad.critical,
    },
    hallazgos_total: s.hallazgos_total,
    hallazgos_urgentes_sin_resolver: s.hallazgos_urgentes,
    conflictos_pendientes_de_revision: s.conflictos_pendientes,
    sincronizaciones: s.sincronizaciones,
    ...(cerrado
      ? {}
      : {
          acciones_con_plazo_vencido: s.hallazgos_vencidos,
          tendencia_semanal: s.tendencia_semanal.map((t) => ({ semana: t.semana, inspecciones: t.inspecciones, hallazgos: t.hallazgos })),
        }),
  }
}

/**
 * Huella de las cifras: la empresa más los datos exactos que se envían. Si
 * cambia cualquier número, cambia la huella y el resumen guardado queda
 * desactualizado. `datosParaResumen` arma siempre las claves en el mismo
 * orden, así que `JSON.stringify` es estable.
 */
export function huellaCifras(tenantId: string, datos: DatosResumen): string {
  return createHash('sha256').update(tenantId).update('\n').update(JSON.stringify(datos)).digest('hex')
}
