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

import { useState } from 'react'
import { motion } from 'motion/react'
import { Chip } from '../components/Badges'
import { Boton } from '../components/ui'
import { FormRenderer } from '../components/FormRenderer'
import { SheetHallazgo } from '../components/SheetHallazgo'
import { useEstado, type PlantillaActual } from '../lib/store'
import { contestado, itemsDe } from '../lib/valores'
import { EASE } from '../lib/motion'
import type { TemplateItem } from '@terreno/shared'
import type { ItemPlantilla } from '../lib/types'

/** Chip de cabecera cuando el turno quedó congelado en una revisión ausente (FR-028). */
const CHIP_SIN_REVISION = 'Revisión congelada ausente'

export function Captura() {
  const {
    plantilla,
    respuestas,
    pendientes,
    enviarInspeccion,
    crearHallazgo,
    online,
    usuario,
    originales,
    descartarBorradorYRecargar,
  } = useEstado()
  const [sheetItem, setSheetItem] = useState<ItemPlantilla | null>(null)
  const [confirmarDescarte, setConfirmarDescarte] = useState(false)

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
    <div className="space-y-6">
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
            <Chip color={online ? 'var(--color-synced)' : 'var(--color-pending)'}>
              {online ? 'Guardado en cola · online' : 'Guardado en dispositivo'}
            </Chip>
            <Chip color={congeladaAusente ? 'var(--color-failed)' : 'var(--color-beam)'}>
              {congeladaAusente ? CHIP_SIN_REVISION : origenDe(plantilla.origen)}
            </Chip>
          </div>
        </div>

        {/* Progreso: barra que crece en scaleX. Comunica avance sin texto.
            Sin la revisión congelada no hay ítems que contar: una barra en 0%
            sobre una lista vacía sería ruido (FR-028). */}
        {!congeladaAusente && (
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
        {!congeladaAusente && (
          <div className="flex gap-2">
            <Boton tamano="sm" variante="secundaria">
              Guardar borrador
            </Boton>
            <Boton tamano="sm" variante="primaria" onClick={() => void enviarInspeccion()}>
              Enviar inspección
            </Boton>
          </div>
        )}
      </div>

      {/* FR-018: los originales `.xlsx` viven en el dispositivo con un tope de
       * 25 MB. Si una pasada los truncó, el trabajador tiene que saberlo: un
       * original que no está sólo seefirenta al exportar, y no al capturar. */}
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
