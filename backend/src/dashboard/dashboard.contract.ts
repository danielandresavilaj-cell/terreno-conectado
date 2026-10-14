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

/**
 * Filtros del listado de hallazgos (FR-041): el período base + los propios del
 * hallazgo. `autor_id` es un UUID —se filtra por el ejecutor de la inspección,
 * no por el nombre, que puede repetirse— y `severidad`/`estado` se validan
 * contra su dominio para que un valor mal escrito sea un 400 explícito y no una
 * consulta silenciosamente vacía.
 */
export const findingsFiltrosSchema = dashboardFiltrosSchema.extend({
  severidad: z.preprocess(sinValor, z.enum(['low', 'medium', 'high', 'critical']).optional()),
  estado: z.preprocess(sinValor, z.enum(['open', 'in_progress', 'resolved']).optional()),
  autor_id: z.preprocess(sinValor, z.string().uuid('autor inválido').optional()),
})

export type FindingsFiltrosQuery = z.infer<typeof findingsFiltrosSchema>

/** Filtros de período ya validados + los del hallazgo, traducidos al SQL. */
export interface FiltrosFindings extends FiltrosPeriodo {
  severidad: string | null
  estado: string | null
  autorId: string | null
}

export function parsearFiltrosFindings(filtros: unknown): FiltrosFindings {
  const parsed = findingsFiltrosSchema.safeParse(filtros)
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || 'filtros'}: ${i.message}`)
      .join('; ')
    throw new BadRequestException(`filtros inválidos: ${detalle}`)
  }
  return {
    ...filtrosPeriodo(parsed.data),
    severidad: parsed.data.severidad ?? null,
    estado: parsed.data.estado ?? null,
    autorId: parsed.data.autor_id ?? null,
  }
}

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

/* ── Lote de exportaciones (TSK-FORM-010, FR-045/046/047) ──────────────────── */

/**
 * Una fila del manifiesto que viaja DENTRO del ZIP del lote.
 *
 * Existe porque el ZIP se entrega a un humano que puede no volver al servidor:
 * si una inspección no se exportó, el motivo tiene que estar junto a los
 * documentos, no sólo en un log. `archivo` es el nombre de la entrada en el ZIP
 * y es `null` justo cuando la inspección falló (por eso no hay un nombre que
 * desambiguar): el vínculo con el id completo es lo que hace trazable el nombre.
 */
export const loteExportEntradaSchema = z.object({
  inspeccion_id: z.string().uuid(),
  archivo: z.string().nullable(),
  estado: z.enum(['exportada', 'fallida']),
  motivo: z.string().nullable(),
  celdas_escritas: z.number().int().nonnegative(),
  omitidas: z.array(z.string()),
})

/**
 * Manifiesto del lote (`manifesto.json` dentro del ZIP).
 *
 * Los filtros van aquí y no en el nombre del archivo porque el ZIP se descarga y
 * se archiva: el nombre dice el período y el manifiesto dice exactamente qué
 * se pidió, incluso si el filtro era "todo el tenant sin fechas".
 */
export const loteExportManifiestoSchema = z.object({
  lote_id: z.string().uuid(),
  generado_at: z.string().datetime(),
  filtros: z.object({
    site_id: z.string().uuid().nullable(),
    desde: z.string().datetime().nullable(),
    hasta: z.string().datetime().nullable(),
  }),
  /** Inspecciones que el filtro trajo, antes de intentar exportarlas. */
  pedidas: z.number().int().nonnegative(),
  exportadas: z.number().int().nonnegative(),
  fallidas: z.number().int().nonnegative(),
  entradas: z.array(loteExportEntradaSchema),
})

export type LoteExportEntrada = z.infer<typeof loteExportEntradaSchema>
export type LoteExportManifiesto = z.infer<typeof loteExportManifiestoSchema>
