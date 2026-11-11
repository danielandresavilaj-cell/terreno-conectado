/**
 * Exportar inspecciones en Excel consolidado, PDF o Word — TSK-REP-007
 * (Enmienda 005, FR-045/046/047).
 *
 * `POST /dashboard/inspections/exportar` recibe el mismo filtro que la tabla
 * (faena, período, formulario, estado, autor) más, opcionalmente, los `ids`
 * elegidos, y un formato:
 *
 * - `xlsx_consolidado`: un solo `.xlsx` con Resumen, una hoja por formulario,
 *   Hallazgos y Evidencias (funciona con cualquier plantilla).
 * - `pdf` / `docx`: un informe con todas, o un ZIP con uno por inspección.
 * - `xlsx_original`: el ZIP de originales rellenados de siempre (delegado al lote).
 *
 * Una inspección que no se puede leer no aborta la exportación: se omite y se
 * cuenta en `fallidas` (cabecera y auditoría). Si fallan todas, 422.
 */
import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common'
import JSZip from 'jszip'
import { TOPE_EXPORTACION, exportarInspeccionesBodySchema, type ExportFormato } from '@terreno/shared'
import { construirConsolidado, fechaLegible, type InspeccionExportable, type MetaExportacion } from '@terreno/shared/exportar'
import type { JwtClaims } from '../auth/auth.types'
import { DbService } from '../db/db.service'
import { exigirDashboard } from './dashboard.auth'
import { parsearFiltrosInspecciones, type FiltrosInspecciones } from './dashboard.contract'
import { InspectionExportLoteService, ZIP_MIME } from './inspection-export-lote.service'
import { InspectionExportService } from './inspection-export.service'
import { informePdf } from './informes/pdf'
import { informeWord } from './informes/word'

export const MIME_EXPORT = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: ZIP_MIME,
} as const

export interface ArchivoExportado {
  bytes: Buffer
  fileName: string
  mime: string
  exportadas: number
  fallidas: number
}

const ESTADO_FILTRO: Record<string, string> = { draft: 'borradores', in_progress: 'en curso', submitted: 'enviadas', reviewed: 'revisadas' }

/** Segmento de nombre de archivo: letras y números; lo demás a guion. */
function segmento(t: string, max = 40): string {
  const s = t.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  return (s || 'x').slice(0, max)
}

@Injectable()
export class InspectionReportService {
  private readonly logger = new Logger(InspectionReportService.name)

  constructor(
    private readonly db: DbService,
    private readonly individual: InspectionExportService,
    private readonly lote: InspectionExportLoteService,
  ) {}

  async exportar(u: JwtClaims, body: unknown): Promise<ArchivoExportado> {
    exigirDashboard(u)
    const parsed = exportarInspeccionesBodySchema.safeParse(body ?? {})
    if (!parsed.success) {
      const detalle = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
      throw new BadRequestException(`exportación inválida: ${detalle}`)
    }
    const { formato, agrupar } = parsed.data

    // El original rellenado sigue siendo el lote de siempre (con los filtros nuevos).
    if (formato === 'xlsx_original') {
      const r = await this.lote.exportarLote(u, parsed.data)
      return { bytes: r.zip, fileName: r.fileName, mime: ZIP_MIME, exportadas: r.exportadas, fallidas: r.fallidas }
    }

    const f = parsearFiltrosInspecciones(parsed.data)
    const tope = TOPE_EXPORTACION[formato]
    const filas = await this.individual.seleccionar(u, f, tope + 1)
    if (filas.length === 0) {
      throw new NotFoundException('el filtro no trae ninguna inspección: no hay nada que exportar')
    }
    if (filas.length > tope) {
      throw new PayloadTooLargeException(
        `hay más de ${tope} inspecciones y ${this.nombreFormato(formato)} admite ${tope}: acota el período, la faena o el formulario, o elige cuáles exportar`,
      )
    }

    const inspecciones: InspeccionExportable[] = []
    const fallos: { inspeccion_id: string; motivo: string }[] = []
    for (const fila of filas) {
      try {
        inspecciones.push(await this.individual.exportable(u, fila.id))
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err)
        fallos.push({ inspeccion_id: fila.id, motivo })
        this.logger.warn(`exportación: la inspección ${fila.id} se omite: ${motivo}`)
      }
    }
    if (inspecciones.length === 0) {
      throw new UnprocessableEntityException(`no se pudo leer ninguna inspección: ${fallos.map((x) => x.motivo).join('; ')}`)
    }

    const meta: MetaExportacion = {
      empresa: await this.empresa(u.tenant_id as string),
      filtro: this.describirFiltro(f, filas),
      generado_at: new Date().toISOString(),
    }
    const base = this.nombreBase(f, inspecciones)
    let archivo: { bytes: Buffer; fileName: string; mime: string }
    if (formato === 'xlsx_consolidado') {
      archivo = { bytes: Buffer.from(await construirConsolidado(inspecciones, meta)), fileName: `${base}.xlsx`, mime: MIME_EXPORT.xlsx }
    } else {
      const generar = formato === 'pdf' ? informePdf : informeWord
      if (agrupar === 'zip') {
        const zip = new JSZip()
        const usados = new Set<string>()
        for (const ins of inspecciones) {
          let nombre = `${segmento(ins.faena)}_${segmento(ins.formulario.nombre, 30)}_${ins.capturada_at.slice(0, 10)}_${ins.id.slice(0, 8)}.${formato}`
          for (let n = 2; usados.has(nombre); n++) nombre = nombre.replace(/(\.\w+)$/, `-${n}$1`)
          usados.add(nombre)
          zip.file(nombre, await generar([ins], meta), { compression: formato === 'pdf' ? 'DEFLATE' : 'STORE' })
        }
        archivo = { bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), fileName: `${base}.zip`, mime: ZIP_MIME }
      } else {
        archivo = { bytes: await generar(inspecciones, meta), fileName: `${base}.${formato}`, mime: MIME_EXPORT[formato] }
      }
    }

    await this.auditar(u, formato, agrupar, f, inspecciones.map((i) => i.id), fallos)
    return { ...archivo, exportadas: inspecciones.length, fallidas: fallos.length }
  }

  private nombreFormato(f: ExportFormato): string {
    return f === 'xlsx_consolidado' ? 'el Excel consolidado' : f === 'pdf' ? 'el PDF' : f === 'docx' ? 'el Word' : 'el lote'
  }

  private async empresa(tenantId: string): Promise<string> {
    try {
      const [t] = await this.db.queryAsTenant<{ name: string }>(tenantId, 'SELECT name FROM tenant WHERE id = $1', [tenantId])
      return t?.name ?? 'Empresa'
    } catch {
      return 'Empresa'
    }
  }

  private describirFiltro(f: FiltrosInspecciones, filas: { faena_nombre: string; template_nombre: string | null }[]): string {
    const partes: string[] = []
    if (f.ids) partes.push(`${f.ids.length} inspecciones elegidas`)
    if (f.siteId) partes.push(`Faena ${filas[0]?.faena_nombre ?? ''}`.trim())
    if (f.templateId) partes.push(filas[0]?.template_nombre ?? 'Formulario')
    if (f.status) partes.push(ESTADO_FILTRO[f.status] ?? f.status)
    const d = (iso: string | null) => (iso ? fechaLegible(iso).slice(0, 10) : null)
    if (f.desde || f.hasta) partes.push(`${d(f.desde) ?? 'inicio'} a ${d(f.hasta) ?? 'hoy'}`)
    return partes.length > 0 ? partes.join(' · ') : 'Todas las inspecciones'
  }

  private nombreBase(f: FiltrosInspecciones, inspecciones: InspeccionExportable[]): string {
    const formularios = new Set(inspecciones.map((i) => i.formulario.template_id))
    const quien = formularios.size === 1 ? segmento(inspecciones[0].formulario.nombre, 30) : 'varios'
    const fechas = inspecciones.map((i) => i.capturada_at.slice(0, 10)).sort()
    const desde = f.desde?.slice(0, 10) ?? fechas[0]
    const hasta = f.hasta?.slice(0, 10) ?? fechas[fechas.length - 1]
    return `inspecciones_${quien}_${desde}_${hasta}`
  }

  /** FR-047: toda exportación queda en `audit_log` (si falla el registro, la descarga sigue). */
  private async auditar(
    u: JwtClaims,
    formato: ExportFormato,
    agrupar: string,
    f: FiltrosInspecciones,
    exportadas: string[],
    fallos: { inspeccion_id: string; motivo: string }[],
  ): Promise<void> {
    try {
      await this.db.queryAsTenant(
        u.tenant_id as string,
        `INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
         VALUES ($1, $2, $3, 'inspection_export', 'inspection_export', $4, $5)`,
        [
          randomUUID(),
          u.sub,
          u.tenant_id,
          `${formato};site=${f.siteId ?? 'todas'};desde=${f.desde ?? '-inf'};hasta=${f.hasta ?? '+inf'}`,
          JSON.stringify({
            formato,
            agrupar,
            filtros: { site_id: f.siteId, desde: f.desde, hasta: f.hasta, template_id: f.templateId, status: f.status, autor_id: f.autorId, elegidas: f.ids?.length ?? null },
            exportadas: exportadas.length,
            inspecciones_exportadas: exportadas,
            fallidas: fallos.length,
            fallos,
          }),
        ],
      )
    } catch (err) {
      this.logger.error(`no se pudo registrar la exportación en audit_log: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
