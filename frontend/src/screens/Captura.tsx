/* Captura en terreno — FR-011, FR-012, FR-013, FR-014, FR-036, FR-039.
 *
 * Esta es la pantalla que se usa en modo avión, con guantes y bajo el sol.
 * Desde TSK-FORM-001 el checklist NO está hardcodeado: se dibuja desde la
 * plantilla activa (server → caché → demo local) vía <FormRenderer>, con el
 * mismo contrato Zod que validó el backend al publicar (FR-036).
 *
 * MOVIMIENTO (decisiones — esta pantalla es la de mayor frecuencia):
 * · El control ok/nok/na hace pop al seleccionarse (spring 260 ms, bounce 0.22).
 *   Es LA interacción del producto y se repite decenas de veces por turno.
 * · El progreso de la barra se anima en scaleX al responder. Comunica avance.
 * · El sheet de hallazgo entra con transform-origin en el botón que lo abrió.
 * · Las secciones y sus filas entran con stagger de 40 ms al montar, una sola
 *   vez. Nunca al hacer scroll.
 * · NO anima: el focus de los campos de texto, el scroll, el hover de las filas.
 */

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Chip } from '../components/Badges'
import { Boton } from '../components/ui'
import { FormRenderer } from '../components/FormRenderer'
import { SheetHallazgo } from '../components/SheetHallazgo'
import { useEstado, type PlantillaActual } from '../lib/store'
import {
  descargarLibro,
  exportarDocumento,
  hayOriginalCacheado,
  type ResultadoExportar,
} from '../lib/exportar'
import { contestado, itemsDe } from '../lib/valores'
import { EASE } from '../lib/motion'
import { fechaHoraLocal } from '../lib/fecha-hora-actual'
import type { TemplateItem } from '@terreno/shared'
import type { ItemPlantilla } from '../lib/types'

/** Chip de cabecera cuando el turno quedó congelado en una revisión ausente (FR-028). */
const CHIP_SIN_REVISION = 'Revisión congelada ausente'

/** Estado del export offline (FR-019). El texto vive en el panel, no en alertas. */
type EstadoExport =
  | { fase: 'inactivo' }
  | { fase: 'trabajando' }
  | { fase: 'error'; mensaje: string }
  | { fase: 'ok'; resumen: string }

export function Captura() {
  const {
    plantilla,
    respuestas,
    pendientes,
    enviarInspeccion,
    enviandoInspeccion,
    erroresCampo,
    crearHallazgo,
    online,
    usuario,
    originales,
    descartarBorradorYRecargar,
    responderCampo,
    ir,
  } = useEstado()
  const [sheetItem, setSheetItem] = useState<ItemPlantilla | null>(null)
  const [confirmarDescarte, setConfirmarDescarte] = useState(false)
  const [estadoExport, setEstadoExport] = useState<EstadoExport>({ fase: 'inactivo' })
  const [hayOriginal, setHayOriginal] = useState(false)
  const revisionId = plantilla?.revisionId ?? null

  /* Al abrir un formulario, fecha y hora representan el momento de inicio del
   * recorrido. Se escriben al faltar en el borrador y no se reescriben si el
   * trabajador vuelve a abrirlo, para que no dependan de que recuerde llenar
   * dos campos administrativos en terreno.
   *
   * No se marca la revisión como "inicializada" antes de escribir: durante la
   * hidratación una actualización de estado puede interrumpir esa primera
   * escritura y dejar fecha/hora vacías para todo el turno. El propio valor
   * persistido es la condición idempotente. */
  useEffect(() => {
    if (!plantilla || plantilla.estado !== 'ok') return

    const automaticos = itemsDe(plantilla.definition).filter(
      (item) => item.response_type === 'date' || item.response_type === 'time',
    )
    if (automaticos.length === 0) return

    const { fecha, hora } = fechaHoraLocal()
    for (const item of automaticos) {
      if (respuestas[item.id]?.campo !== null && respuestas[item.id]?.campo !== undefined) continue
      responderCampo(item.id, item.response_type === 'date' ? fecha : hora)
    }
  }, [plantilla, respuestas, responderCampo])

  /* El botón de exportar se habilita sólo con el original de ESTA revisión en el
   * dispositivo (FR-019). Se consulta al montar y cada vez que cambia la revisión
   * congelada o la cuenta de originales: una pasada de sincronización puede
   * purgar por presupuesto (FR-018) y dejar el export sin libro, y el trabajador
   * tiene que enterarse antes de pulsar, no después. */
  useEffect(() => {
    let vivo = true
    void hayOriginalCacheado(revisionId).then((v) => {
      if (vivo) setHayOriginal(v)
    })
    return () => {
      vivo = false
    }
  }, [revisionId, originales.cacheados])

  const exportar = async () => {
    if (!plantilla) return
    setEstadoExport({ fase: 'trabajando' })
    try {
      const r: ResultadoExportar = await exportarDocumento({
        revisionId: plantilla.revisionId,
        templateName: plantilla.nombre,
        definition: plantilla.definition,
        respuestas,
      })
      if (!r.ok) {
        setEstadoExport({ fase: 'error', mensaje: r.error })
        return
      }
      descargarLibro(r.libro, r.fileName)
      setEstadoExport({
        fase: 'ok',
        resumen:
          `${r.fileName} · ${r.celdasEscritas} respuesta(s) escritas` +
          (r.omitidas.length > 0 ? ` · ${r.omitidas.length} ítem(s) no se pudieron escribir` : ''),
      })
    } catch (err) {
      /* El módulo no lanza por datos, pero un fallo de lectura del caché sí
       * llegaría aquí: sin esto el botón quedaría en "Generando…" para siempre y
       * en faena eso es indistinguishable de que la app se colgó. */
      setEstadoExport({
        fase: 'error',
        mensaje: err instanceof Error ? err.message : 'No se pudo exportar el documento',
      })
    }
  }

  if (!plantilla) return null
  const definition = plantilla.definition
  const items = itemsDe(definition)
  const contestados = items.filter((i) => contestado(respuestas[i.id]?.campo)).length
  const noks = items.filter((i) => respuestas[i.id]?.campo === 'nok').length
  const pct = items.length > 0 ? Math.round((contestados / items.length) * 100) : 0
  /* FR-028: el turno quedó congelado en una revisión que no está en el
   * dispositivo. Se bloquea la captura en vez de reencuadrar a otra plantilla:
   * las respuestas ya escritas pertenecen a esa revisión, y validar un ítem
   * contra otra dejaría el turno inconsistente al enviarlo. */
  const congeladaAusente = plantilla.estado === 'no-disponible'
  const sinFormularios = plantilla.estado === 'sin-plantillas'
  const exportando = estadoExport.fase === 'trabajando'

  /* El sheet de hallazgo trabaja sobre el item legacy: se adapta desde el
   * TemplateItem del renderer (FR-032 sobre definición dinámica). */
  const abrirHallazgo = (item: TemplateItem, seccion: string) =>
    setSheetItem({
      id: item.id,
      texto: item.prompt,
      seccion,
      hallazgoObligatorio: item.require_finding_on_nok ?? false,
      tipo: 'ok_nok_na',
    })

  return (
    <div data-testid="capture-screen" className="space-y-6">
      {/* ── Encabezado de la inspección ───────────────────────────────────── */}
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="label-inst">FR-036 · Captura con plantilla dinámica</p>
            <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
              {plantilla.nombre}
            </h1>
            <p className="mt-1.5 text-[13px] text-ink-2">
              {usuario?.faena} · Turno B ·{' '}
              {plantilla.version !== null ? `v${plantilla.version} de la plantilla` : 'plantilla local'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Boton tamano="sm" variante="secundaria" onClick={() => ir('formularios')}>
              Ver formularios
            </Boton>
            <Chip color={online ? 'var(--color-synced)' : 'var(--color-pending)'}>
              {online ? 'Guardado en cola · online' : 'Guardado en dispositivo'}
            </Chip>
            <Chip color={congeladaAusente ? 'var(--color-failed)' : 'var(--color-beam)'}>
              {congeladaAusente ? CHIP_SIN_REVISION : origenDe(plantilla.origen)}
            </Chip>
          </div>
        </div>

        {itemsDe(plantilla.definition).some(
          (item) => item.response_type === 'date' || item.response_type === 'time',
        ) && (
          <p className="mt-3 text-[12px] text-ink-2">
            La fecha y la hora se registran automáticamente al abrir el formulario.
          </p>
        )}

        {/* Progreso: barra que crece en scaleX. Comunica avance sin texto.
            Sin la revisión congelada no hay ítems que contar: una barra en 0%
            sobre una lista vacía sería ruido (FR-028). */}
        {!congeladaAusente && !sinFormularios && (
          <div className="mt-5 panel p-4">
            <div className="flex items-end justify-between gap-4 mb-3">
              <div>
                <p className="label-inst">Progreso de la inspección</p>
                <p className="mt-1 num-inst text-[15px]">
                  {contestados} <span className="text-ink-3">de {items.length} ítems</span>
                </p>
              </div>
              <div className="text-right">
                <p className="num-inst text-[22px] font-semibold text-beam">{pct}%</p>
                {noks > 0 && (
                  <p className="text-[11px] text-failed font-medium">{noks} con hallazgo</p>
                )}
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-s3 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-beam"
                initial={false}
                animate={{ scaleX: Math.max(0.02, pct / 100) }}
                transition={{ duration: 0.45, ease: EASE.out }}
                style={{ transformOrigin: 'left center' }}
              />
            </div>
            <p className="mt-3 text-[11px] text-ink-3 leading-relaxed">
              El borrador se autoguarda en cada cambio (FR-014). Podés cerrar la app y seguir
              después: el dato no se pierde.
            </p>
          </div>
        )}
      </header>

      {/* ── Secciones del formulario (render data-driven, FR-036) ─────────── */}
      {congeladaAusente ? (
        /* Sin la revisión congelada no hay formulario que mostrar (FR-028). */
        <div className="panel p-5">
          <p className="label-inst">FR-028 · Revisión congelada no disponible</p>
          <p className="mt-2 text-[14px] text-ink leading-relaxed">
            Este turno quedó congelado en una revisión de la plantilla que no está en este
            dispositivo
            {plantilla.revisionPendiente ? ` (${plantilla.revisionPendiente})` : ''}. Lo que ya
            respondiste sigue guardado en el borrador.
          </p>
          <p className="mt-2 text-[12px] text-ink-3 leading-relaxed">
            No se cambia a otra plantilla a propósito: eso invalidaría lo ya respondido. Volverá
            sola si la asignación sigue vigente; si tu supervisor la retiró, no volverá y el turno
            queda bloqueado.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {confirmarDescarte ? (
              <>
                <span className="text-[12px] text-ink-2">
                  Se borrará el borrador y lo que llevas respondido. ¿Continuar?
                </span>
                <Boton
                  tamano="sm"
                  variante="peligro"
                  onClick={() => {
                    setConfirmarDescarte(false)
                    void descartarBorradorYRecargar()
                  }}
                >
                  Descartar y empezar de nuevo
                </Boton>
                <Boton tamano="sm" variante="fantasma" onClick={() => setConfirmarDescarte(false)}>
                  Cancelar
                </Boton>
              </>
            ) : (
              <Boton tamano="sm" variante="secundaria" onClick={() => setConfirmarDescarte(true)}>
                Descartar borrador
              </Boton>
            )}
          </div>
        </div>
      ) : sinFormularios ? (
        <div className="panel p-5">
          <p className="label-inst">Formularios asignados</p>
          <h2 className="mt-2 text-[17px] font-semibold">No tenés formularios asignados</h2>
          <p className="mt-2 text-[13px] text-ink-2 leading-relaxed">
            Tu rol y faena no tienen una plantilla disponible. Pedile a un administrador que te asigne un formulario antes de iniciar una inspección.
          </p>
          <Boton tamano="sm" variante="secundaria" className="mt-4" onClick={() => ir('formularios')}>
            Ver formularios asignados
          </Boton>
        </div>
      ) : (
        definition.sections.map((sec, si) => (
          <FormRenderer
            key={sec.id ?? sec.title}
            section={sec}
            delayBase={si}
            onAbrirHallazgo={abrirHallazgo}
          />
        ))
      )}

      {/* ── Pie ───────────────────────────────────────────────────────────── */}
      <div className="panel p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span
            className={[
              'h-2 w-2 rounded-full shrink-0',
              pendientes > 0 ? 'bg-pending' : 'bg-synced',
            ].join(' ')}
          />
          <p className="text-[12px] text-ink-2">
            {pendientes > 0 ? (
              <>
                <span className="num-inst text-ink">{pendientes}</span> registro
                {pendientes > 1 ? 's' : ''} en la cola local
              </>
            ) : (
              'Todo sincronizado'
            )}
          </p>
        </div>
        {/* Sin la revisión congelada no se envía nada: el lote iría contra una
            plantilla que no es la del turno (FR-028). */}
        {!congeladaAusente && !sinFormularios && (
          <div className="flex gap-2">
            {/* FR-014 guarda cada respuesta inmediatamente en el dispositivo.
                No se ofrece un segundo "Guardar" sin trabajo que hacer: en
                terreno un control que no cambia nada parece una falla. El
                estado de autoguardado queda visible en la cabecera y junto a
                la cola local de este mismo pie. */}
            <Boton tamano="sm" variante="primaria" disabled={enviandoInspeccion} onClick={() => void enviarInspeccion()}>
              {enviandoInspeccion ? 'Enviando…' : 'Enviar inspección'}
            </Boton>
          </div>
        )}
      </div>

      {!congeladaAusente && !sinFormularios && Object.keys(erroresCampo).length > 0 && (
        <p role="alert" className="-mt-3 text-[12px] font-medium text-failed">
          Completá los campos obligatorios marcados antes de enviar la inspección.
        </p>
      )}

      {/* ── Export del documento original (FR-019) ──────────────────────
       *  Se genera entero en el dispositivo a partir del `.xlsx` cacheado con la
       *  plantilla: respuestas en sus celdas + hoja "Evidencias". No hay red en
       *  esta ruta (Art. I), y el botón se deshabilita —lo dice, no falla— cuando
       *  el original no está: bajarlo en el momento rompería la promesa offline. */}
      {!sinFormularios && <div className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="label-inst">FR-019 · Documento original rellenado</p>
            <p className="mt-1.5 text-[13px] text-ink-2 leading-relaxed">
              {hayOriginal
                ? 'Se arma en el dispositivo con el .xlsx que se descargó de esta plantilla: tus respuestas en sus columnas y una hoja de evidencias con las fotos. Funciona sin señal.'
                : `${revisionId
                    ? 'El documento original de esta plantilla todavía no está en el dispositivo.'
                    : 'Esta plantilla no viene de una revisión publicada, así que no hay documento original que rellenar.'} Vuelve la señal y se descarga con la plantilla (FR-018); la exportación no baja nada por su cuenta. Lo que ya respondiste queda guardado.`}
            </p>
          </div>
          <Boton
            tamano="sm"
            variante="secundaria"
            disabled={!hayOriginal || exportando}
            aria-busy={exportando}
            onClick={() => void exportar()}
          >
            {exportando ? 'Generando…' : 'Exportar .xlsx'}
          </Boton>
        </div>

        {estadoExport.fase === 'error' && (
          <p role="alert" className="mt-3 text-[12px] font-medium text-failed leading-relaxed">
            {estadoExport.mensaje}
          </p>
        )}
        {estadoExport.fase === 'ok' && (
          <p role="status" className="mt-3 text-[12px] font-medium text-synced leading-relaxed">
            Documento exportado · {estadoExport.resumen}
          </p>
        )}
      </div>}

      {/* FR-018: los originales `.xlsx` viven en el dispositivo con un tope de
       * 25 MB. Si una pasada los truncó, el trabajador tiene que saberlo: un
       *  original que no está sólo se ve al exportar, y no al capturar. */}
      <p className="text-[11px] text-ink-3 leading-relaxed">
        {originales.cacheados === 0
          ? `Documento original sin cachear: la exportación offline se habilita cuando se descargue (FR-018 · tope ${formatMb(originales.presupuestoBytes)}).`
          : `${originales.cacheados} documentos originales en el dispositivo para exportar sin conexión (FR-018 · tope ${formatMb(originales.presupuestoBytes)}).`}
        {originales.purgados > 0 &&
          ` ${originales.purgados} se liberaron en esta pasada por ese tope.`}
      </p>

      <SheetHallazgo
        item={sheetItem}
        onClose={() => setSheetItem(null)}
        onGuardar={(sev, desc, foto) => {
          if (sheetItem) crearHallazgo(sheetItem.id, sev, desc, foto)
          setSheetItem(null)
        }}
      />
    </div>
  )
}

/** Etiqueta del chip de origen de la plantilla (FR-036). */
function origenDe(origen: PlantillaActual['origen']): string {
  return origen === 'servidor'
    ? 'Plantilla del servidor'
    : origen === 'caché'
      ? 'Plantilla en caché'
      : 'Plantilla demo local'
}

/** Presupuesto de originales en MB (FR-018): el tope se muestra, no se esconde. */
function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}
