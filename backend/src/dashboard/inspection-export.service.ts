import { readFile } from 'node:fs/promises'
import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ZodError } from 'zod'
import {
  nombreArchivoSchema,
  parseTemplateDefinition,
  type CampoValor,
  type TemplateDefinition,
  type TemplateItem,
  type InspectionsResponse,
} from '@terreno/shared'
import {
  campoDesdeColumnas,
  construirRespuestas,
  emparejarItemsConOrigen,
  evidenciaSeIncrusta,
  proponerImport,
  rellenarOriginal,
  nombreEvidencia,
  type EvidenciaRellenable,
} from '@terreno/shared/xlsx'
import type { JwtClaims } from '../auth/auth.types'
import { DbService } from '../db/db.service'
import { SyncVolumeService } from '../storage/sync-volume.service'
import { TemplatesService } from '../templates/templates.service'
import { exigirDashboard } from './dashboard.auth'
import {
  parsearFiltrosPeriodo,
} from './dashboard.contract'

/**
 * Exportación del documento original rellenado — TSK-FORM-010 (FR-019/044/049).
 *
 * El supervisor descarga una inspección como el `.xlsx` que el `tenant_admin`
 * subió, con las respuestas escritas encima y una hoja "Evidencias". **El
 * servidor no tiene su propio formato**: ejecuta el mismo módulo que corre en el
 * dispositivo (`@terreno/shared/xlsx`) sobre los mismos bytes, así que el
 * artefacto es el mismo sin importar de qué lado se generó (ADR-003 d5).
 *
 * Lo único que el servidor aporta es lo que el dispositivo no puede saber:
 *
 *  - la definición CONGELADA de la revisión con la que se ejecutó la inspección
 *    (`(template_id, template_version)`, FR-028) — no la última publicada;
 *  - las filas de `inspection_response`, que se leen con el mismo mapeo
 *    ítem→columna con el que el dispositivo las escribió (`valorDesdeColumnas`);
 *  - los bytes de las evidencias, que ya están en el volumen de sync.
 *
 * ## Por qué el estado de la revisión NO se filtra
 *
 * Una revisión `archived` es un registro inmutable (FR-049) y las inspecciones
 * que la usaron no dejan de existir porque la plantilla se archive. Filtrar por
 * `status='published'` haría desaparecer del histórico exactamente los
 * documentos que hay que auditar.
 */

/**
 * Tope de la lista, el mismo orden de magnitud que el de hallazgos. No es un
 * contrato de paginación (no la pide ningún FR): es el freno para que un
 * tenant con años de historial no pida el período entero en un solo response.
 * El orden es `captured_at DESC`, así que lo que se ve es lo más reciente.
 */
const TOPE_INSPECCIONES = 200


export interface InspectionExportFile {
  /** Bytes del `.xlsx` ya rellenado, listos para servirse. */
  libro: Uint8Array
  /** Nombre de la descarga (`Content-Disposition`). */
  fileName: string
  /** Ítems que no llegaron al documento, para que quien exporta lo diga. */
  omitidas: string[]
  celdasEscritas: number
}

/** Fila de `inspection` que necesita el export (todo lo demás es de la lista). */
interface InspectionRow {
  id: string
  template_id: string
  template_version: number
}

/** Fila de la revisión resuelta por `(template_id, template_version)`. */
interface RevisionRow {
  id: string
  definition: unknown
}

/** `inspection_response` en la forma híbrida de `value_json` (FR-036). */
interface ResponseRow {
  template_item_id: string
  value_ok: 'ok' | 'nok' | 'na' | null
  value_text: string | null
  /** `numeric` en la base: el driver lo devuelve como texto. */
  value_number: string | null
  value_json: unknown
}

/** Adjunto de una respuesta `photo` (FR-037) — metadata, no bytes. */
interface AdjuntoRow {
  template_item_id: string
  file_key: string
  mime: string
  bytes: number
  captured_at: string
}

@Injectable()
export class InspectionExportService {
  private readonly logger = new Logger(InspectionExportService.name)

  constructor(
    private readonly db: DbService,
    private readonly templates: TemplatesService,
    private readonly volume: SyncVolumeService,
  ) {}

  /* --------------------------------------------------------------- listado */

  /**
   * `GET /dashboard/inspections`: inspecciones del período con los mismos
   * filtros que el resto del dashboard. Sin filtro por estado a propósito
   * (FR-049): el registro es inmutable y lo que el supervisor tiene que decidir
   * es si lo descarga, no si existe.
   */
  async listar(u: JwtClaims, filtros: unknown): Promise<InspectionsResponse> {
    exigirDashboard(u)
    const { siteId, desde, hasta } = parsearFiltrosPeriodo(filtros)

    const rows = await this.db.queryAsTenant<{
      id: string
      faena_id: string
      faena_nombre: string
      template_id: string
      template_nombre: string | null
      template_version: number
      ejecutado_por: string
      status: 'draft' | 'in_progress' | 'submitted' | 'reviewed'
      captured_ms: number
      respuestas: number
    }>(
      u.tenant_id as string,
      `SELECT i.id, i.site_id AS faena_id, s.name AS faena_nombre,
              i.template_id, t.name AS template_nombre, i.template_version,
              a.full_name AS ejecutado_por, i.status,
              (extract(epoch FROM i.captured_at) * 1000)::float8 AS captured_ms,
              count(r.id)::int AS respuestas
         FROM inspection i
         JOIN site s ON s.id = i.site_id
         LEFT JOIN template t ON t.id = i.template_id
         LEFT JOIN app_user a ON a.id = i.executed_by
         LEFT JOIN inspection_response r ON r.inspection_id = i.id
        WHERE ($1::uuid IS NULL OR i.site_id = $1)
          AND i.captured_at >= COALESCE($2::timestamptz, '-infinity'::timestamptz)
          AND i.captured_at <= COALESCE($3::timestamptz, 'infinity'::timestamptz)
        GROUP BY i.id, s.name, t.name, a.full_name
        ORDER BY i.captured_at DESC, i.id
        LIMIT ${TOPE_INSPECCIONES}`,
      [siteId, desde, hasta],
    )

    return {
      items: rows.map((r) => ({
        id: r.id,
        faena_id: r.faena_id,
        faena_nombre: r.faena_nombre,
        template_id: r.template_id,
        template_nombre: r.template_nombre,
        template_version: r.template_version,
        ejecutado_por: r.ejecutado_por,
        status: r.status,
        captured_at: new Date(r.captured_ms).toISOString(),
        respuestas: r.respuestas,
      })),
    }
  }

  /* --------------------------------------------------------------- export */

  /**
   * `GET /dashboard/inspections/:id/export`: el `.xlsx` original rellenado.
   *
   * Nunca devuelve un libro a medias: si el original no se puede interpretar, si
   * el libro y la plantilla no describen lo mismo o si la escritura falla, se
   * dice el motivo. Escribir en una celda que no corresponde produce un
   * documento firmado por la faena que afirma otra cosa, y eso es peor que un
   * error (FR-019, FR-051).
   */
  async exportar(u: JwtClaims, inspectionId: string): Promise<InspectionExportFile> {
    exigirDashboard(u)
    const tenantId = u.tenant_id as string

    const inspeccion = await this.inspeccion(tenantId, inspectionId)
    const revision = await this.revisionDe(tenantId, inspeccion)

    // La seguridad de ruta y el 404 "no viene de un import" son los del endpoint
    // del original (TSK-FORM-009): no se duplica ni se suaviza.
    const original = await this.templates.getRevisionOriginal(tenantId, revision.id)
    const bytes = new Uint8Array(await readFile(original.path))
    const definition = this.definitionDe(revision)

    // El original se vuelve a pasar por el parser porque el emparejamiento
    // definition ↔ libro es POR POSICIÓN (sección, ítem): de la propuesta salen
    // la hoja y la columna destino de cada celda. El parser es determinista.
    const parseo = await proponerImport(bytes, original.fileName)
    if (!parseo.ok) {
      throw new UnprocessableEntityException(
        `el documento original de la plantilla no se pudo interpretar: ${parseo.error}`,
      )
    }

    // Comprobación explícita ANTES de escribir nada: si el libro y la plantilla
    // no describen lo mismo, el error tiene que verse (nunca rellenar la celda
    // de otro ítem).
    const emparejado = emparejarItemsConOrigen(definition, parseo.propuesta)
    if (!emparejado.ok) {
      throw new UnprocessableEntityException(emparejado.error)
    }

    const items = definition.sections.flatMap((s) => s.items)
    const campos = await this.camposDe(tenantId, inspectionId, items)
    const { respuestas, omitidas: omitidasSinCelda } = construirRespuestas(items, campos)
    const evidencias = await this.evidenciasDe(tenantId, inspectionId, items, campos)

    const relleno = await rellenarOriginal({
      original: bytes,
      definition,
      propuesta: parseo.propuesta,
      respuestas,
      evidencias,
    })
    if (!relleno.ok) {
      throw new UnprocessableEntityException(relleno.error)
    }

    const omitidas = [...omitidasSinCelda, ...relleno.omitidas]
    // Traza de una exportación incompleta (FR-051): un ítem que no llegó al
    // documento tiene que verse en el log del servidor, porque en un download
    // no hay dónde avisarle al usuario sin perder el archivo.
    this.logger.log(
      `inspección ${inspectionId}: ${relleno.celdasEscritas} celda(s) escritas` +
        (omitidas.length > 0 ? `, ${omitidas.length} ítem(s) omitidos` : ''),
    )

    return {
      libro: relleno.libro,
      fileName: this.nombreDeDescarga(inspeccion.id, original.fileName),
      omitidas,
      celdasEscritas: relleno.celdasEscritas,
    }
  }

  /** Inspección del tenant o 404: el cruce de tenant también cae aquí (RLS). */
  private async inspeccion(tenantId: string, inspectionId: string): Promise<InspectionRow> {
    const [row] = await this.db.queryAsTenant<InspectionRow>(
      tenantId,
      `SELECT id, template_id, template_version FROM inspection WHERE id = $1`,
      [inspectionId],
    )
    if (!row) {
      throw new NotFoundException('inspección no encontrada para este tenant')
    }
    return row
  }

  /**
   * Revisión con la que se EJECUTÓ la inspección, por `(template_id,
   * template_version)`: es el par que congela el turno (FR-028) y el único que
   * devuelve el mismo documento que firmar el trabajador, aunque la plantilla
   * haya avanzado desde entonces.
   *
   * Sin filtro de estado: una revisión archivada sigue siendo el registro
   * inmutable de lo que se llenó (FR-049). Sólo una revisión `draft` (version
   * NULL, o sea nunca igualable) queda fuera por construcción.
   */
  private async revisionDe(tenantId: string, inspeccion: InspectionRow): Promise<RevisionRow> {
    const [row] = await this.db.queryAsTenant<RevisionRow>(
      tenantId,
      `SELECT id, definition FROM template_revision
        WHERE template_id = $1 AND version = $2`,
      [inspeccion.template_id, inspeccion.template_version],
    )
    if (!row) {
      throw new NotFoundException(
        'la inspección apunta a una revisión de plantilla que no existe en este tenant',
      )
    }
    return row
  }

  /**
   * Definición de la revisión validada con el MISMO contrato que la validó al
   * guardarse (FR-039). Si no valida, la revisión está corrupta y no hay
   * emparejamiento posible: se dice, no se rellena a ciegas.
   */
  private definitionDe(revision: RevisionRow): TemplateDefinition {
    try {
      return parseTemplateDefinition(revision.definition)
    } catch (error) {
      const detalle = error instanceof ZodError
        ? error.issues.slice(0, 3).map((i) => i.message).join('; ')
        : String(error)
      throw new UnprocessableEntityException(
        `la definición de la revisión no es válida: ${detalle}`,
      )
    }
  }

  /**
   * Filas de `inspection_response` → `CampoValor` por ítem.
   *
   * El mapeo columna→valor es el MISMO que el del dispositivo al leer su
   * borrador (`frontend/src/lib/valores.ts`, `valorDesdeColumnas`), incluidas
   * las caídas al texto legacy de antes de `value_json`: si divergieran, el
   * documento del servidor y el del dispositivo no coincidirían (FR-044).
   */
  private async camposDe(
    tenantId: string,
    inspectionId: string,
    items: TemplateItem[],
  ): Promise<Record<string, CampoValor | null>> {
    const porItem = new Map(items.map((i) => [i.id, i]))
    const campos: Record<string, CampoValor | null> = {}
    for (const item of items) campos[item.id] = null

    const rows = await this.db.queryAsTenant<ResponseRow>(
      tenantId,
      `SELECT template_item_id, value_ok, value_text, value_number, value_json
         FROM inspection_response
        WHERE inspection_id = $1
        ORDER BY updated_at DESC, created_at DESC`,
      [inspectionId],
    )

    // `ORDER BY` descendente + "la primera gana": si una misma respuesta quedó
    // duplicada (la ingesta no tiene unicidad aquí), gana la más reciente, que
    // es la que el LWW dejó como vigente.
    const vistas = new Set<string>()
    for (const row of rows) {
      const item = porItem.get(row.template_item_id)
      if (!item || vistas.has(item.id)) continue
      vistas.add(item.id)
      campos[item.id] = campoDesdeColumnas(item, row)
    }
    return campos
  }

  /**
   * Adjuntos `owner_type='response'` → filas de la hoja "Evidencias".
   *
   * La política de evidencias (FR-046) la decide `evidenciaSeIncrusta` sobre el
   * tamaño DECLARADO: los bytes sólo se leen del volumen si la foto acaba
   * embebida, y si no se referencian por `file_key`. Es la misma decisión que
   * toma el dispositivo, y por eso el resultado no depende de si el servidor
   * llegó o no a leer el archivo.
   */
  private async evidenciasDe(
    tenantId: string,
    inspectionId: string,
    items: TemplateItem[],
    campos: Record<string, CampoValor | null>,
  ): Promise<EvidenciaRellenable[]> {
    const fotos = items.filter((i) => i.response_type === 'photo')
    const adjuntos = await this.db.queryAsTenant<AdjuntoRow>(
      tenantId,
      `SELECT r.template_item_id, a.file_key, a.mime, a.bytes, a.captured_at
         FROM attachment a
         JOIN inspection_response r ON r.id = a.owner_id
        WHERE a.owner_type = 'response' AND r.inspection_id = $1
        ORDER BY a.created_at, a.id`,
      [inspectionId],
    )
    // Una foto por ítem es lo normal; si hay varias, gana la primera por orden de
    // ingesta, igual que en el dispositivo, donde gana la primera del índice.
    const primeroPorItem = new Map<string, AdjuntoRow>()
    for (const a of adjuntos) {
      if (!primeroPorItem.has(a.template_item_id)) primeroPorItem.set(a.template_item_id, a)
    }

    const evidencias: EvidenciaRellenable[] = []
    for (const [indice, item] of fotos.entries()) {
      if (!campos[item.id]) continue
      const adjunto = primeroPorItem.get(item.id)
      if (!adjunto) continue
      const incrusta = evidenciaSeIncrusta(adjunto.bytes)
      evidencias.push({
        itemId: item.id,
        nombre: nombreEvidencia(indice + 1, item),
        mime: adjunto.mime,
        bytesLength: adjunto.bytes,
        bytes: incrusta ? new Uint8Array(await this.volume.leer(adjunto.file_key)) : new Uint8Array(0),
        // El servidor sí puede nombrar el archivo: la referencia lleva la clave
        // con la que se recupera aparte del `.xlsx` (el dispositivo no la tiene).
        fileKey: adjunto.file_key,
        capturadoAt: new Date(adjunto.captured_at).toISOString(),
      })
    }
    return evidencias
  }

  /**
   * Nombre de la descarga: el del documento original, que es el documento que el
   * cliente reconoce, validado por el contrato de nombre de archivo compartido.
   * Si el `tenant_admin` subió un nombre que hoy no serviría (control chars,
   * separadores), se cae a uno derivado de la inspección: un nombre inseguro en
   * un header HTTP es un problema, no un detalle cosmético.
   */
  private nombreDeDescarga(inspectionId: string, fileNameOriginal: string): string {
    const directo = nombreArchivoSchema.safeParse(fileNameOriginal)
    return directo.success ? directo.data : `inspeccion-${inspectionId}.xlsx`
  }
}
