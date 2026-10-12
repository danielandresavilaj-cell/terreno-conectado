import { randomUUID } from 'node:crypto'
import {
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common'
import JSZip from 'jszip'
import { type InspectionListaItem } from '@terreno/shared'
import type { JwtClaims } from '../auth/auth.types'
import { DbService } from '../db/db.service'
import { exigirDashboard } from './dashboard.auth'
import {
  parsearFiltrosPeriodo,
  type FiltrosPeriodo,
  type LoteExportManifiesto,
} from './dashboard.contract'
import { InspectionExportService } from './inspection-export.service'

/**
 * Exportación POR LOTE de las inspecciones del período — TSK-FORM-010
 * (FR-045/046/047).
 *
 * Un ZIP con un `.xlsx` por inspección, cada uno **exactamente** el artefacto que
 * devuelve el export individual: el lote no reimplementa nada, itera
 * `InspectionExportService.exportar` sobre el subconjunto que devuelve `listar`
 * con los mismos filtros. Así FR-046 (hoja "Evidencias" con las fotos embebidas
 * o referenciadas según tamaño) y la paridad de formato con el dispositivo
 * (FR-044) se cumplen por construcción y no por dos implementaciones parecidas.
 *
 * ## Por qué el lote se arma en memoria y con tope
 *
 * El ZIP se compone entero en memoria porque `StreamableFile` entrega bytes ya
 * empaquetados; sin tope, un tenant con años de historial pidiendo "el período"
 * construiría un archivo cuyo tamaño es proporcional al histórico y tumba al
 * proceso por OOM. `TOPE_INSPECCIONES_LOTE` acota ese techo y el error dice el
 * límite y lo que se pidió, para que el cliente acote el período en vez de
 * reintentar igual. Un 413 es lo que dice la petición —no es un error de los
 * datos ni del permiso, es una petición grande— y 422 sugeriría además que el
 * contenido está mal, que no es el caso.
 *
 * Las iteraciones son **secuenciales** a propósito: acota la memoria pico, deja
 * el orden de las entradas estable y mantiene el log legible.
 */
export const ZIP_MIME = 'application/zip'

/** Máximo de inspecciones (y por tanto de `.xlsx`) que entra en un lote. */
export const TOPE_INSPECCIONES_LOTE = 50

/**
 * Nombre del manifiesto dentro del ZIP: viaja con el archivo, así que el
 * destinatario ve qué se exportó y qué falló aunque nunca acceda al servidor.
 */
const NOMBRE_MANIFIESTO = 'manifesto.json'

/** Extensión de las entradas del ZIP (el manifiesto va en JSON). */
const EXT_XLSX = '.xlsx'

/** Una inspección que no se pudo exportar, con el motivo que se le dio. */
export interface LoteFallo {
  inspeccionId: string
  motivo: string
}

export interface InspectionExportLote {
  /** Id del lote: el mismo que va en el manifiesto, la cabecera y `audit_log`. */
  loteId: string
  /** Bytes del ZIP, listos para servirse. */
  zip: Buffer
  /** Nombre de la descarga (`Content-Disposition`). */
  fileName: string
  exportadas: number
  fallidas: number
}

/** Una entrada ya exportada, pendiente de empaquetar. */
interface EntradaExportada {
  nombre: string
  libro: Uint8Array
  celdasEscritas: number
  omitidas: string[]
}

@Injectable()
export class InspectionExportLoteService {
  private readonly logger = new Logger(InspectionExportLoteService.name)

  constructor(
    private readonly db: DbService,
    private readonly individual: InspectionExportService,
  ) {}

  /**
   * `POST /dashboard/inspections/export-lote`: un ZIP con un `.xlsx` por
   * inspección del período, filtrado por faena y fechas.
   *
   * ## Qué pasa si una inspección falla
   *
   * **No se aborta el lote.** Un original ilegible, una plantilla que no
   * corresponde o una revisión que ya no está afecta a UNA inspección del
   * período, no a las otras 49: se registra el motivo, se sigue con el resto y
   * se dice en DOS sitios, porque cada uno cubre un hueco del otro.
   *
   *  - **Manifiesto dentro del ZIP**: acompaña al archivo descargado y sobrevive
   *    a que el usuario lo reenvíe por correo a alguien que nunca verá los logs
   *    del servidor (es el registro que el FR-019 necesita para no dar por
   *    entregado un documento que no está).
   *  - **Cabeceras de la respuesta** (`X-Lote-Id`, `X-Lote-Exportadas`,
   *    `X-Lote-Fallidas`): es lo único que la UI puede mostrar en el momento sin
   *    abrir el archivo que acaba de bajar.
   *
   * En `audit_log` queda una sola fila con el recuento y los motivos (FR-047),
   * que es donde se busca cuando alguien pregunta "qué se descargó".
   */
  async exportarLote(u: JwtClaims, filtros: unknown): Promise<InspectionExportLote> {
    exigirDashboard(u)
    const periodo = parsearFiltrosPeriodo(filtros)

    // `listar` es la MISMA consulta que alimenta la tabla del período, con los
    // mismos filtros y la misma RLS: el subconjunto que el supervisor está
    // viendo es exactamente el que se exporta, y el aislamiento por tenant no
    // se reimplementa (lo que la lista no ve, el lote tampoco lo ve).
    const { items } = await this.individual.listar(u, {
      site_id: periodo.siteId ?? undefined,
      desde: periodo.desde ?? undefined,
      hasta: periodo.hasta ?? undefined,
    })

    if (items.length === 0) {
      // Un ZIP vacío se descarga, se abre y parece un archivo roto. El filtro no
      // trajo nada y eso se dice, no se disfraza de entrega.
      throw new NotFoundException(
        'el filtro no trae ninguna inspección del período: no hay nada que exportar',
      )
    }
    if (items.length > TOPE_INSPECCIONES_LOTE) {
      throw new PayloadTooLargeException(
        `el filtro trae ${items.length} inspecciones y un lote admite ` +
          `${TOPE_INSPECCIONES_LOTE}: acota el período o la faena`,
      )
    }

    const loteId = randomUUID()
    const usados = new Set<string>()
    const manifiesto: LoteExportManifiesto['entradas'] = []
    const exportadas: EntradaExportada[] = []
    const fallos: LoteFallo[] = []

    for (const item of items) {
      try {
        const archivo = await this.individual.exportar(u, item.id)
        const entrada = {
          nombre: this.nombreDeEntrada(item, usados),
          libro: archivo.libro,
          celdasEscritas: archivo.celdasEscritas,
          omitidas: archivo.omitidas,
        }
        exportadas.push(entrada)
        manifiesto.push({
          inspeccion_id: item.id,
          archivo: entrada.nombre,
          estado: 'exportada',
          motivo: null,
          celdas_escritas: entrada.celdasEscritas,
          omitidas: entrada.omitidas,
        })
      } catch (error) {
        const motivo = msg(error)
        manifiesto.push({
          inspeccion_id: item.id,
          archivo: null,
          estado: 'fallida',
          motivo,
          celdas_escritas: 0,
          omitidas: [],
        })
        fallos.push({ inspeccionId: item.id, motivo })
        this.logger.warn(
          `lote ${loteId}: la inspección ${item.id} no se exportó y el lote sigue: ${motivo}`,
        )
      }
    }

    // Si NINGUNA inspección salió, no se devuelve un ZIP: obligaría al
    // supervisor a descargar un archivo vacío para leer, dentro, que no se
    // pudo exportar nada. Los motivos van en el error, que es donde la UI los
    // puede pintar. Un lote parcialmente fallido sí se devuelve, con su
    // manifiesto — el archivo es útil aunque le falten hojas.
    if (exportadas.length === 0) {
      await this.auditar(u, loteId, periodo, items.length, manifiesto, fallos)
      throw new UnprocessableEntityException(
        `no se pudo exportar ninguna de las ${items.length} inspecciones del período: ` +
          fallos.map((f) => f.motivo).join('; '),
      )
    }

    const zip = await this.empaquetar(loteId, periodo, items.length, manifiesto, exportadas)

    // La auditoría va DESPUÉS de empaquetar y ANTES de responder: se registra
    // lo que realmente se construyó, y queda en `audit_log` aunque el cliente
    // se desconecte a mitad de la descarga (FR-047, log append-only).
    await this.auditar(u, loteId, periodo, items.length, manifiesto, fallos)

    return {
      loteId,
      zip,
      fileName: this.nombreDelZip(periodo),
      exportadas: exportadas.length,
      fallidas: fallos.length,
    }
  }

  /**
   * Arma el ZIP: un `.xlsx` por inspección más el manifiesto.
   *
   * Los `.xlsx` van con `STORE` (sin recomprimir) porque un OOXML ya es un ZIP
   * deflatado: volver a comprimirlo gasta CPU del servidor para ganar ~0%. El
   * manifiesto sí es texto y se comprime.
   */
  private async empaquetar(
    loteId: string,
    periodo: FiltrosPeriodo,
    pedidas: number,
    entradas: LoteExportManifiesto['entradas'],
    exportadas: EntradaExportada[],
  ): Promise<Buffer> {
    const zip = new JSZip()
    for (const entrada of exportadas) {
      zip.file(entrada.nombre, entrada.libro, { compression: 'STORE' })
    }
    const manifiesto: LoteExportManifiesto = {
      lote_id: loteId,
      generado_at: new Date().toISOString(),
      filtros: {
        site_id: periodo.siteId,
        desde: periodo.desde,
        hasta: periodo.hasta,
      },
      pedidas,
      exportadas: exportadas.length,
      fallidas: pedidas - exportadas.length,
      entradas,
    }
    zip.file(NOMBRE_MANIFIESTO, JSON.stringify(manifiesto, null, 2), { compression: 'DEFLATE' })
    return zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })
  }

  /**
   * FR-047: una sola fila por lote, aunque tenga fallos parciales.
   *
   * `entity_id` es el PERÍODO que se exportó, no un id propio del lote: es lo
   * que hace falta para encontrar la fila leyendo el log ("¿qué se descargó de
   * la faena X entre el 1 y el 31?") sin saber de antemano el `lote_id`. El
   * `lote_id` sí viaja, dentro del `payload`, y es lo que correlaciona la fila
   * con el manifiesto del ZIP y con la cabecera de la respuesta.
   *
   * El `action` sigue la forma `<dominio>_<evento>` de las filas que ya existen
   * (`token_reuse` en auth, `sync_tenant_mismatch` en sync) y el `entity_type` es
   * el sujeto de la fila, como `sync_batch` lo es del sync.
   *
   * Un fallo al auditar NO tumba la exportación: el archivo ya está construido
   * y el precedente es el de `SyncService` (`auditTenantMismatch`). Perder la
   * descarga del supervisor porque una fila no entró sería peor que una traza
   * que falta, y el error queda en el log del servidor.
   *
   * Ni el 413 por exceso ni el 404 por filtro vacío se auditan: en ninguno de
   * los dos casos se generó un archivo, y FR-047 audita exportaciones.
   */
  private async auditar(
    u: JwtClaims,
    loteId: string,
    periodo: FiltrosPeriodo,
    pedidas: number,
    entradas: LoteExportManifiesto['entradas'],
    fallos: LoteFallo[],
  ): Promise<void> {
    try {
      await this.db.queryAsTenant(
        u.tenant_id as string,
        `INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          u.sub,
          u.tenant_id,
          'inspection_export_lote',
          'inspection_export_batch',
          `site=${periodo.siteId ?? 'todas'};desde=${periodo.desde ?? '-inf'};hasta=${periodo.hasta ?? '+inf'}`,
          JSON.stringify({
            lote_id: loteId,
            filtros: {
              site_id: periodo.siteId,
              desde: periodo.desde,
              hasta: periodo.hasta,
            },
            pedidas,
            exportadas: entradas.filter((e) => e.estado === 'exportada').length,
            fallidas: fallos.length,
            inspecciones_exportadas: entradas
              .filter((e) => e.estado === 'exportada')
              .map((e) => e.inspeccion_id),
            fallos,
          }),
        ],
      )
    } catch (error) {
      this.logger.error(
        `lote ${loteId}: no se pudo registrar la exportación en audit_log: ${msg(error)}`,
      )
    }
  }

  /**
   * Nombre de la descarga: el rango del período, que es como el supervisor
   * piensa el lote ("octubre de la faena El Roble") y no un `lote.zip` que no
   * dice nada cuando llega a la carpeta de descargas.
   */
  private nombreDelZip(periodo: FiltrosPeriodo): string {
    const desde = periodo.desde ? periodo.desde.slice(0, 10) : 'inicio'
    const hasta = periodo.hasta ? periodo.hasta.slice(0, 10) : 'actualidad'
    return `inspecciones-${desde}_${hasta}.zip`
  }

  /**
   * Nombre de la entrada dentro del ZIP: `faena_fecha_idcorto.xlsx`.
   *
   * La faena y la fecha son lo que el supervisor reconoce a simple vista al
   * descomprimir, y el id corto es lo que hace la entrada **trazable**: con
   * 50 documentos de la misma faena y del mismo día, dos archivos llamados
   * `control-diario-2026.xlsx` son indistinguibles. El nombre se registra en el
   * manifiesto junto al id completo, así que el vínculo va en los dos sentidos.
   */
  private nombreDeEntrada(item: InspectionListaItem, usados: Set<string>): string {
    const base = `${segmentoDeFaena(item.faena_nombre)}_${item.captured_at.slice(0, 10)}_${item.id.slice(0, 8)}`
    const nombre = nombreUnico(base, usados)
    usados.add(nombre)
    return nombre
  }
}

/**
 * Nombre libre dentro del ZIP.
 *
 * Sobrescribir en silencio una entrada pierde un documento sin que nadie lo note
 * (y el manifiesto apuntaría dos veces al mismo archivo), así que ante un choque
 * se numeran las copias. `usados` es el conjunto de nombres ya tomados.
 */
function nombreUnico(base: string, usados: Set<string>): string {
  let nombre = `${base}${EXT_XLSX}`
  let intento = 2
  while (usados.has(nombre)) {
    nombre = `${base}-${intento}${EXT_XLSX}`
    intento += 1
  }
  return nombre
}

/**
 * Faena como segmento de nombre de archivo: letras y números, todo lo demás
 * (espacios, `/`, acentos de Office...) a un guion.
 *
 * Se conserva la ortografía con tilde porque el ZIP va en UTF-8 y es lo que el
 * supervisor reconoce; lo que no puede pasar es un `/`, que convertiría la
 * entrada en una ruta del filesystem donde se descomprima.
 */
function segmentoDeFaena(faena: string): string {
  const limpio = faena.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  return limpio.length > 0 ? limpio.slice(0, 40) : 'faena'
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
