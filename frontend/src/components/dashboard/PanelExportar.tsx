/* Panel de exportación — TSK-REP-007 (Enmienda 005, FR-045/046/047).
 *
 * Exporta lo elegido (casillas de la tabla) o, si no hay nada marcado, todo lo
 * filtrado. Formatos: Excel consolidado (un solo libro), PDF o Word (un archivo
 * o uno por inspección en un ZIP) y el Excel original rellenado de siempre.
 * El resultado se dice aquí mismo, sin alert().
 */
import { useState } from 'react'
import { TOPE_EXPORTACION, type ExportFormato, type ExportarInspeccionesBody } from '@terreno/shared'
import { Boton } from '../ui'
import { ApiError, exportarInspecciones } from '../../lib/api'
import { descargarLibro } from '../../lib/exportar'

export const FORMATOS: { id: ExportFormato; titulo: string; detalle: string }[] = [
  { id: 'xlsx_consolidado', titulo: 'Excel consolidado', detalle: 'Un solo .xlsx: resumen, una hoja por formulario, hallazgos y fotos.' },
  { id: 'pdf', titulo: 'PDF', detalle: 'Informe listo para imprimir o enviar.' },
  { id: 'docx', titulo: 'Word', detalle: 'Informe editable (.docx).' },
  { id: 'xlsx_original', titulo: 'Excel original', detalle: 'Cada inspección en el formato de su plantilla (sólo plantillas importadas desde Excel). ZIP.' },
]

type Fase =
  | { fase: 'inactivo' }
  | { fase: 'trabajando' }
  | { fase: 'ok'; exportadas: number | null; fallidas: number | null; fileName: string }
  | { fase: 'error'; mensaje: string }

/** Cuerpo de la petición: los ids elegidos o, si no hay, el filtro completo. */
export function cuerpoExportacion(
  filtros: Omit<ExportarInspeccionesBody, 'formato' | 'agrupar' | 'ids'>,
  seleccion: string[],
  formato: ExportFormato,
  agrupar: 'un_archivo' | 'zip',
): ExportarInspeccionesBody {
  const base = seleccion.length > 0 ? { ids: seleccion } : filtros
  return { ...base, formato, ...(formato === 'pdf' || formato === 'docx' ? { agrupar } : {}) }
}

/**
 * TSK-REP-013: la descarga desde una fila siempre es un PDF de esa inspección.
 * No depende de que exista una planilla Excel de origen: el informe usa la
 * revisión congelada y por eso también sirve para formularios creados aquí.
 */
export function exportacionIndividualPdf(inspeccionId: string): ExportarInspeccionesBody {
  return { ids: [inspeccionId], formato: 'pdf', agrupar: 'un_archivo' }
}

export function PanelExportar({
  filtros,
  seleccion,
  totalFiltrado,
  alcance,
  onLimpiarSeleccion,
}: {
  filtros: Omit<ExportarInspeccionesBody, 'formato' | 'agrupar' | 'ids'>
  seleccion: string[]
  /** Inspecciones visibles con el filtro (la lista muestra hasta 200). */
  totalFiltrado: number
  alcance: string
  onLimpiarSeleccion: () => void
}) {
  const [formato, setFormato] = useState<ExportFormato>('xlsx_consolidado')
  const [agrupar, setAgrupar] = useState<'un_archivo' | 'zip'>('un_archivo')
  const [estado, setEstado] = useState<Fase>({ fase: 'inactivo' })

  const cantidad = seleccion.length > 0 ? seleccion.length : totalFiltrado
  const tope = TOPE_EXPORTACION[formato]
  const excede = cantidad > tope

  const exportar = async () => {
    setEstado({ fase: 'trabajando' })
    try {
      const r = await exportarInspecciones(cuerpoExportacion(filtros, seleccion, formato, agrupar))
      descargarLibro(r.bytes, r.fileName, r.mime)
      setEstado({ fase: 'ok', exportadas: r.exportadas, fallidas: r.fallidas, fileName: r.fileName })
    } catch (err) {
      setEstado({
        fase: 'error',
        mensaje:
          err instanceof ApiError
            ? err.status === 0
              ? 'Sin conexión con el servidor: la exportación se arma en línea.'
              : err.detalle
            : 'No se pudo exportar.',
      })
    }
  }

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium">
          Exportar {seleccion.length > 0 ? `${seleccion.length} elegidas` : `lo filtrado (${totalFiltrado}${totalFiltrado >= 200 ? '+' : ''})`}
        </p>
        <p className="text-[11px] text-ink-3">
          {seleccion.length > 0 ? (
            <button type="button" className="text-beam hover:underline" onClick={onLimpiarSeleccion}>
              Quitar selección y exportar lo filtrado
            </button>
          ) : (
            `${alcance} · marca casillas para elegir cuáles`
          )}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Formato">
        {FORMATOS.map((f) => (
          <label
            key={f.id}
            className={[
              'rounded-lg border px-3 py-2.5 cursor-pointer transition-colors',
              formato === f.id ? 'border-beam bg-beam/[0.06]' : 'border-line-soft hover:border-beam/50',
            ].join(' ')}
          >
            <input type="radio" name="formato-export" className="sr-only" checked={formato === f.id} onChange={() => setFormato(f.id)} />
            <span className="block text-[13px] font-medium">{f.titulo}</span>
            <span className="block mt-0.5 text-[11px] text-ink-3 leading-snug">{f.detalle}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {(formato === 'pdf' || formato === 'docx') && (
          <div className="flex items-center gap-3 text-[12px] text-ink-2">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="agrupar" checked={agrupar === 'un_archivo'} onChange={() => setAgrupar('un_archivo')} />
              Un archivo con todas
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="agrupar" checked={agrupar === 'zip'} onChange={() => setAgrupar('zip')} />
              Uno por inspección (ZIP)
            </label>
          </div>
        )}
        <span className="flex-1" />
        <Boton
          tamano="sm"
          variante="primaria"
          onClick={() => void exportar()}
          disabled={estado.fase === 'trabajando' || cantidad === 0 || excede}
          aria-busy={estado.fase === 'trabajando'}
        >
          {estado.fase === 'trabajando' ? 'Generando…' : 'Exportar'}
        </Boton>
      </div>

      <div aria-live="polite" className="text-[12px] leading-relaxed">
        {excede && (
          <p className="text-sev-alta">
            Son {cantidad} inspecciones y este formato admite {tope}. Acota el período, la faena o el formulario, o elige cuáles.
          </p>
        )}
        {estado.fase === 'ok' && (
          <p className="text-synced">
            Listo: {estado.fileName}
            {estado.exportadas !== null && ` · ${estado.exportadas} exportadas`}
            {estado.fallidas ? ` · ${estado.fallidas} no se pudieron leer` : ''}
          </p>
        )}
        {estado.fase === 'error' && <p role="alert" className="text-sev-alta">No se pudo exportar: {estado.mensaje}</p>}
      </div>
    </div>
  )
}
