import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'

/**
 * Contratos Zod del dashboard (spec 005, TSK-WS-011 + TSK-FORM-010).
 *
 * `shared/src/dashboard.ts` espeja los DTO que el dispositivo y el frontend ya
 * comparten; lo que se declara ACÁ es lo que el servidor produce y todavía no
 * tiene contraparte en `shared` (la lista de inspecciones y el download del
 * documento rellenado). Al ser Zod, el tipo sale del propio contrato (`z.infer`)
 * y no hay una interfaz escrita a mano que pueda divergir del validador.
 *
 * Los tipos duplicados a mano se evitan también para los filtros: el esquema
 * `dashboardFiltrosSchema` es el ÚNICO validador de `site_id`/`desde`/`hasta`
 * del módulo, y lo usan tanto las consultas ya existentes como las nuevas.
 */

/** Query vacío: `?` sin parámetros y `?site_id=` vacío significan lo mismo. */
function sinValor(v: unknown): unknown {
  return v === undefined || v === null || v === '' ? undefined : v
}

/**
 * Fecha del período. Se acepta cualquier cosa que `Date.parse` entienda (igual
 * que antes de este contrato) porque el dashboard pinta rangos con un
 * `<input type="date">` y con un ISO completo indistinto; lo que no se acepta es
 * lo que no es una fecha, porque compararlo contra `captured_at` en SQL dejaría
 * la consulta sin rango y devolvería todo el período.
 */
const fecha = (etiqueta: string) =>
  z.preprocess(
    sinValor,
    z.string().refine((v) => !Number.isNaN(Date.parse(v)), `${etiqueta} inválido`).optional(),
  )

/** Filtros de período que el dashboard ya usaba en `summary` y `findings`. */
export const dashboardFiltrosSchema = z.object({
  site_id: z.preprocess(sinValor, z.string().uuid('faena inválida').optional()),
  desde: fecha('desde'),
  hasta: fecha('hasta'),
})

/**
 * Un `:param` de ruta que tiene que ser un UUID. El 400 va en el borde (el id
 * viene del path y no se puede consultar sin UUID) y con el mismo validador que
 * el de `site_id`.
 */
export function exigirUuid(valor: string, etiqueta: string): string {
  const parsed = z.string().uuid(`${etiqueta} inválida`).safeParse(valor)
  if (!parsed.success) {
    throw new BadRequestException(`${etiqueta} inválida`)
  }
  return parsed.data
}

export type DashboardFiltrosQuery = z.infer<typeof dashboardFiltrosSchema>

/** Filtros ya validados y traducidos a los parámetros del SQL. */
export interface FiltrosPeriodo {
  siteId: string | null
  desde: string | null
  hasta: string | null
}

/** Los mismos filtros, ya validados, con las fechas en ISO. */
function filtrosPeriodo(f: DashboardFiltrosQuery): FiltrosPeriodo {
  return {
    siteId: f.site_id ?? null,
    desde: f.desde ? new Date(f.desde).toISOString() : null,
    hasta: f.hasta ? new Date(f.hasta).toISOString() : null,
  }
}

/**
 * Valida los filtros del período y devuelve los valores que viajan al motor.
 *
 * El rechazo es un 400 con el mensaje del propio contrato, así que todos los
 * endpoints del dashboard dicten el mismo motivo y no hace falta que cada uno
 * escriba su propio mensaje.
 */
export function parsearFiltrosPeriodo(filtros: unknown): FiltrosPeriodo {
  const parsed = dashboardFiltrosSchema.safeParse(filtros)
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || 'filtros'}: ${i.message}`)
      .join('; ')
    throw new BadRequestException(`filtros inválidos: ${detalle}`)
  }
  return filtrosPeriodo(parsed.data)
}

/* ── Lista de inspecciones (TSK-FORM-010, FR-044/049) ─────────────────────── */

/**
 * Fila de `GET /api/v1/dashboard/inspections`.
 *
 * `template_nombre` es nullable a propósito: `inspection.template_id` es una
 * referencia opaca (la ingesta no valida contra `template`, es de otro módulo) y
 * una inspección huérfana tiene que verse en la lista — oculta, el supervisor
 * pierde el registro; con el nombre a null, la UI puede decir que no se puede
 * exportar sin inventarse una plantilla.
 */
export {
  inspectionListaItemSchema,
  inspectionsResponseSchema,
  type InspectionListaItem,
  type InspectionsResponse,
} from '@terreno/shared'
