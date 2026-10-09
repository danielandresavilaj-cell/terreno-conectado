/* Importación asistida de plantillas desde `.xlsx` — FR-029, FR-048 (TSK-FORM-006).
 *
 * Wizard de 5 pasos para `tenant_admin`, con estado LOCAL (`useState`): no toca
 * el store global porque es una tarea de configuración, no de captura.
 *
 *   1. Subir     → lee el buffer en el dispositivo y propone secciones/ítems
 *                  (`proponerImport`, subpath `@terreno/shared/xlsx` — la única
 *                  vía al módulo; el barrel `@terreno/shared` no lo reexporta).
 *   2. Preview   → tabla read-only de la propuesta (sin edición).
 *   3. Editar    → nombre + prompt/tipo/requerido/props por ítem, con validación
 *                  EN VIVO contra `FIELD_PROPS_SCHEMA` (mismo contrato que el
 *                  backend, FR-036/039).
 *   4. Borrador  → `propuestaADefinicion` → `crearPlantillaConBorrador` (o
 *                  `actualizarBorrador` si ya se guardó) → id/revisión/estado.
 *   5. Publicar  → NUNCA automático (FR-048): confirmación explícita y
 *                  `publicarRevision`; los errores (409…) conservan el draft.
 *
 * Reordenar secciones/ítems queda FUERA de alcance de esta unidad: el orden
 * propuesto por el parser (orden de hoja/columna) se respeta.
 *
 * MOVIMIENTO: migración entre pasos con fade corto (`EASE.out`, 200 ms) y
 * desplazamiento mínimo de 6 px — el usuario avanza/retrocede; no es un cambio
 * de "página" con historial. Nada más se anima: el wizard es trabajo de foco.
 */

import { useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Chip } from '../components/Badges'
import { Boton } from '../components/ui'
import {
  ApiError,
  actualizarBorrador,
  crearPlantillaConBorrador,
  publicarRevision,
} from '../lib/api'
import { useEstado } from '../lib/store'
import { EASE } from '../lib/motion'
import { proponerImport, propuestaADefinicion } from '@terreno/shared/xlsx'
import { FIELD_PROPS_SCHEMA, RESPONSE_TYPES } from '@terreno/shared'
import type { FieldProps, ResponseType, TemplateRevisionDetailDto } from '@terreno/shared'
import type { ProposedItem, TemplateImportProposal } from '@terreno/shared/xlsx'

/* `@terreno/shared/xlsx` (escolta ExcelJS) usa el `Buffer` de Node al leer/
 * escribir el libro; el bundle de ExcelJS lo provee en el navegador. El
 * tsconfig del frontend restringe `types` (sin `@types/node`), así que
 * declaramos acá la forma mínima que consume el módulo en lugar de arrastrar
 * todo Node al programa del navegador. */
declare global {
  type Buffer = Uint8Array
  const Buffer: { from(data: Uint8Array | ArrayBuffer): Buffer }
}

const PASOS = ['Subir', 'Preview', 'Editar', 'Borrador', 'Publicar'] as const

/** Etiquetas en español de los 8 tipos (FR-036). */
const TIPO_LABEL: Record<ResponseType, string> = {
  ok_nok_na: 'OK / NOK / N/A',
  text: 'Texto',
  numeric: 'Número',
  date: 'Fecha',
  time: 'Hora',
  select_single: 'Lista',
  select_multiple: 'Multi',
  photo: 'Foto',
}

const INPUT =
  'h-10 w-full px-3 rounded-[10px] bg-s0 border border-line-soft text-[14px] text-ink placeholder:text-ink-3 focus:border-beam transition-colors duration-150'
const SELECT = `${INPUT} appearance-none pr-8`

interface ErrorItem {
  pi: number
  ii: number
  mensaje: string
}

/** Error de contrato de un ítem (FR-036/039); null = válido. */
function validarItem(item: ProposedItem): string | null {
  if (item.prompt.trim() === '') return 'El texto del ítem no puede estar vacío'
  const check = FIELD_PROPS_SCHEMA[item.response_type].safeParse(item.props)
  if (!check.success) return check.error.issues[0]?.message ?? 'Props inválidas'
  return null
}

/** Resumen legible de `props` para el preview (paso 2). */
function resumenProps(item: ProposedItem): string {
  const p = item.props
  switch (item.response_type) {
    case 'numeric':
    case 'date':
      if (p.min !== undefined && p.max !== undefined) return `${p.min} – ${p.max}`
      if (p.min !== undefined) return `≥ ${p.min}`
      if (p.max !== undefined) return `≤ ${p.max}`
      return 'sin límites'
    case 'text':
      return p.max_length !== undefined ? `máx ${p.max_length} caract.` : 'sin límite'
    case 'photo':
      return p.photo_max_kb !== undefined ? `≤ ${p.photo_max_kb} KB` : 'sin límite'
    case 'select_single':
    case 'select_multiple':
      return `${p.options?.length ?? 0} opciones`
    default:
      return '—'
  }
}

export function Importar() {
  const { ir } = useEstado()
  const reducir = useReducedMotion()
  const inputRef = useRef<HTMLInputElement>(null)

  const [paso, setPaso] = useState(1)
  const [analizando, setAnalizando] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [propuesta, setPropuesta] = useState<TemplateImportProposal | null>(null)
  const [nombre, setNombre] = useState('')
  const [revision, setRevision] = useState<TemplateRevisionDetailDto | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null)
  const [confirmado, setConfirmado] = useState(false)
  const [publicando, setPublicando] = useState(false)
  const [errorPublicar, setErrorPublicar] = useState<string | null>(null)
  const [publicado, setPublicado] = useState<TemplateRevisionDetailDto | null>(null)

  const secciones = propuesta?.secciones ?? []
  const totalItems = secciones.reduce((acc, s) => acc + s.items.length, 0)

  const errores: ErrorItem[] = []
  secciones.forEach((s, pi) =>
    s.items.forEach((it, ii) => {
      const m = validarItem(it)
      if (m) errores.push({ pi, ii, mensaje: m })
    }),
  )
  const errorDe = (pi: number, ii: number) =>
    errores.find((e) => e.pi === pi && e.ii === ii)?.mensaje ?? null

  const nombreValido = nombre.trim().length > 0
  const puedeContinuar = nombreValido && errores.length === 0 && totalItems > 0

  /* ── PASO 1 · lectura del archivo ─────────────────────────────────────── */
  const leerArchivo = async (file: File) => {
    setErrorCarga(null)
    setAnalizando(true)
    try {
      const buf = await file.arrayBuffer()
      const r = await proponerImport(new Uint8Array(buf), file.name)
      if (!r.ok) {
        setPropuesta(null)
        setErrorCarga(r.error)
        return
      }
      setPropuesta(r.propuesta)
      setNombre(r.propuesta.nombre_archivo.replace(/\.[^.]+$/, '') || 'Plantilla importada')
      setRevision(null)
      setPublicado(null)
      setErrorGuardar(null)
      setErrorPublicar(null)
      setConfirmado(false)
      setPaso(2)
    } finally {
      setAnalizando(false)
    }
  }

  const resetear = () => {
    setPaso(1)
    setPropuesta(null)
    setNombre('')
    setRevision(null)
    setPublicado(null)
    setErrorCarga(null)
    setErrorGuardar(null)
    setErrorPublicar(null)
    setConfirmado(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  /* ── edición anidada (paso 3) ─────────────────────────────────────────── */
  const mutarItem = (pi: number, ii: number, fn: (it: ProposedItem) => ProposedItem) => {
    setPropuesta((p) => {
      if (!p) return p
      return {
        ...p,
        secciones: p.secciones.map((s, si) =>
          si !== pi ? s : { ...s, items: s.items.map((it, j) => (j !== ii ? it : fn(it))) },
        ),
      }
    })
  }

  const cambiarTipo = (pi: number, ii: number, tipo: ResponseType) => {
    mutarItem(pi, ii, (it) => {
      const base: FieldProps = { required: it.required }
      // Al alternar entre listas se conservan las opciones ya detectadas.
      if ((tipo === 'select_single' || tipo === 'select_multiple') && it.props.options?.length) {
        base.options = it.props.options
      }
      return { ...it, response_type: tipo, props: base }
    })
  }

  const cambiarRequerido = (pi: number, ii: number, v: boolean) =>
    mutarItem(pi, ii, (it) => ({ ...it, required: v, props: { ...it.props, required: v } }))

  const cambiarProps = (pi: number, ii: number, patch: Partial<FieldProps>) =>
    mutarItem(pi, ii, (it) => ({ ...it, props: { ...it.props, ...patch } }))

  const quitarItem = (pi: number, ii: number) => {
    setPropuesta((p) => {
      if (!p) return p
      return {
        ...p,
        secciones: p.secciones.map((s, si) =>
          si !== pi ? s : { ...s, items: s.items.filter((_, j) => j !== ii) },
        ),
      }
    })
  }

  /* ── PASO 4 · guardar borrador ────────────────────────────────────────── */
  const guardarBorrador = async () => {
    if (!propuesta) return
    setErrorGuardar(null)
    const def = propuestaADefinicion(propuesta)
    if (!def.ok) {
      setErrorGuardar(def.error)
      return
    }
    setGuardando(true)
    try {
      const r = revision
        ? await actualizarBorrador(revision.id, def.definition)
        : await crearPlantillaConBorrador({ name: nombre.trim(), definition: def.definition })
      setRevision(r)
    } catch (err) {
      setErrorGuardar(
        err instanceof ApiError ? err.detalle : 'No se pudo guardar el borrador de la plantilla.',
      )
    } finally {
      setGuardando(false)
    }
  }

  /* ── PASO 5 · publicar (solo con confirmación explícita, FR-048) ──────── */
  const publicar = async () => {
    if (!revision) return
    setErrorPublicar(null)
    setPublicando(true)
    try {
      const r = await publicarRevision(revision.id)
      setPublicado(r)
    } catch (err) {
      setErrorPublicar(
        err instanceof ApiError ? err.detalle : 'No se pudo publicar la revisión. Intentá nuevamente.',
      )
    } finally {
      setPublicando(false)
    }
  }

  /* ── Éxito: la revisión quedó publicada ───────────────────────────────── */
  if (publicado) {
    return (
      <div className="space-y-6">
        <motion.section
          initial={reducir ? { opacity: 1 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, ease: EASE.out }}
          className="panel p-8 text-center max-w-[56ch] mx-auto"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-synced/15 text-synced px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em]">
            <span className="h-1.5 w-1.5 rounded-full bg-synced" />
            Publicada
          </span>
          <h1 className="mt-4 text-[24px] font-semibold tracking-[-0.02em] leading-tight">
            {nombre.trim()}
          </h1>
          <p className="mt-2 text-[13px] text-ink-2 leading-relaxed">
            Versión {publicado.version ?? '—'} · estado{' '}
            <span className="text-synced">published</span>. Ya está disponible para la captura de
            los dispositivos del tenant (FR-027).
          </p>
          <div className="mt-6 flex justify-center">
            <Boton variante="primaria" onClick={() => ir('dashboard')}>
              Volver a Gerencia
            </Boton>
          </div>
        </motion.section>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="label-inst">FR-029 · Importación asistida</p>
        <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
          Importar plantilla desde Excel
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-2 max-w-[68ch] leading-relaxed">
          Subí un <span className="text-ink">.xlsx</span> estructurado, revisá la propuesta,
          corregí lo que haga falta, guardá el borrador y publicalo. La publicación nunca es
          automática: la confirmás vos (FR-048).
        </p>
      </header>

      <Stepper paso={paso} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={paso}
          initial={reducir ? { opacity: 1 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducir ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: EASE.out }}
        >
          {/* ── PASO 1 · Subir ──────────────────────────────────────────── */}
          {paso === 1 && (
            <div className="space-y-4">
              <label
                className={[
                  'panel flex flex-col items-center justify-center gap-3 px-6 py-12 text-center border-dashed',
                  'transition-colors duration-150',
                  analizando ? 'opacity-60 pointer-events-none' : 'cursor-pointer hover:border-beam/60',
                ].join(' ')}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void leerArchivo(f)
                  }}
                />
                <span className="h-12 w-12 rounded-full bg-beam/12 text-beam grid place-items-center">
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
                    <path
                      d="M4 3.2h9.4l4.6 4.6v11H4V3.2Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M11 9.4v5.4M8.6 12.2 11 14.6l2.4-2.4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="text-[15px] font-medium">
                  {analizando ? 'Analizando el archivo…' : 'Elegí un archivo .xlsx'}
                </span>
                <span className="text-[12px] text-ink-3 max-w-[48ch] leading-relaxed">
                  Cada hoja se propone como sección y cada columna con encabezado, como ítem. La
                  lectura es local y determinística: sin red, sin IA.
                </span>
              </label>

              <AnimatePresence>
                {errorCarga && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    <Aviso>No se pudo interpretar el archivo: {errorCarga}</Aviso>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* ── PASO 2 · Preview (read-only) ────────────────────────────── */}
          {paso === 2 && propuesta && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip>{propuesta.resumen.secciones} secciones</Chip>
                <Chip>{propuesta.resumen.items} ítems</Chip>
                <Chip>{propuesta.resumen.filasDatos} filas de datos</Chip>
                <span className="flex-1" />
                <Boton tamano="sm" variante="secundaria" onClick={resetear}>
                  Elegir otro archivo
                </Boton>
              </div>

              {secciones.map((s, pi) => (
                <section key={`sec-${pi}`} className="panel overflow-hidden">
                  <header className="px-4 py-3 border-b border-line-soft flex items-center justify-between gap-3">
                    <h2 className="text-[13px] font-semibold tracking-[-0.01em] truncate">
                      {s.titulo}
                    </h2>
                    <span className="label-inst shrink-0">{s.items.length} ítems</span>
                  </header>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-[12px]">
                      <thead>
                        <tr className="text-left text-ink-3">
                          <th className="label-inst px-4 py-2 font-normal">Ítem</th>
                          <th className="label-inst px-3 py-2 font-normal">Tipo</th>
                          <th className="label-inst px-3 py-2 font-normal">Requerido</th>
                          <th className="label-inst px-3 py-2 font-normal">Props</th>
                          <th className="label-inst px-3 py-2 font-normal">Muestra</th>
                          <th className="label-inst px-4 py-2 font-normal">Origen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.items.map((it, ii) => (
                          <tr
                            key={`${pi}-${ii}`}
                            className="border-t border-line-soft align-top"
                          >
                            <td className="px-4 py-2.5 text-ink font-medium">{it.prompt}</td>
                            <td className="px-3 py-2.5 text-ink-2 whitespace-nowrap">
                              {TIPO_LABEL[it.response_type]}
                            </td>
                            <td className="px-3 py-2.5">
                              {it.required ? (
                                <span className="text-beam">Sí</span>
                              ) : (
                                <span className="text-ink-3">No</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-ink-2 whitespace-nowrap">
                              {resumenProps(it)}
                            </td>
                            <td className="px-3 py-2.5 text-ink-3 max-w-[220px]">
                              {it.muestra.slice(0, 3).join(', ') || '—'}
                            </td>
                            <td className="px-4 py-2.5 num-inst text-ink-3 whitespace-nowrap">
                              {it.source.headerCell}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}

              <footer className="flex items-center justify-between gap-3 pt-1">
                <Boton variante="fantasma" onClick={() => setPaso(1)}>
                  Atrás
                </Boton>
                <Boton variante="primaria" onClick={() => setPaso(3)}>
                  Editar propuesta
                </Boton>
              </footer>
            </div>
          )}

          {/* ── PASO 3 · Editar ─────────────────────────────────────────── */}
          {paso === 3 && propuesta && (
            <div className="space-y-5">
              <div className="panel p-4 space-y-1.5">
                <Campo label="Nombre de la plantilla *">
                  <input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Ej.: Inspección de seguridad en rajo"
                    className={INPUT}
                  />
                </Campo>
                {!nombreValido && (
                  <p className="text-[12px] text-sev-alta">El nombre es obligatorio.</p>
                )}
              </div>

              {errores.length > 0 && (
                <Aviso>
                  {errores.length} ítem(s) con props inválidas. Corregí los campos marcados para
                  continuar.
                </Aviso>
              )}

              {secciones.map((s, pi) => (
                <section key={`sec-edit-${pi}`} className="space-y-2.5">
                  <div className="flex items-center gap-3">
                    <h2 className="label-inst truncate">{s.titulo}</h2>
                    <span className="flex-1 rule" />
                  </div>
                  {s.items.length === 0 ? (
                    <p className="panel px-4 py-3 text-[12px] text-ink-3">
                      Sección sin ítems. Se guardará vacía salvo que agregues otro archivo.
                    </p>
                  ) : (
                    s.items.map((it, ii) => (
                      <EditorItem
                        key={`${it.source.sheet}:${it.source.column}`}
                        indice={`${pi + 1}.${ii + 1}`}
                        item={it}
                        error={errorDe(pi, ii)}
                        onPrompt={(v) => mutarItem(pi, ii, (x) => ({ ...x, prompt: v }))}
                        onTipo={(t) => cambiarTipo(pi, ii, t)}
                        onRequerido={(v) => cambiarRequerido(pi, ii, v)}
                        onProps={(patch) => cambiarProps(pi, ii, patch)}
                        onQuitar={() => quitarItem(pi, ii)}
                      />
                    ))
                  )}
                </section>
              ))}

              <footer className="flex items-center justify-between gap-3 pt-1">
                <Boton variante="fantasma" onClick={() => setPaso(2)}>
                  Atrás
                </Boton>
                <Boton variante="primaria" disabled={!puedeContinuar} onClick={() => setPaso(4)}>
                  Continuar
                </Boton>
              </footer>
            </div>
          )}

          {/* ── PASO 4 · Guardar borrador ───────────────────────────────── */}
          {paso === 4 && (
            <div className="space-y-5">
              <div className="panel p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="h-9 w-9 rounded-lg bg-s3 grid place-items-center shrink-0">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M2.8 2.8h8l2.4 2.4v8H2.8V2.8Z"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M5.2 2.8v4h5.6v-4M5.2 13.2V9.4h5.6v3.8"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[14px] font-semibold tracking-[-0.015em]">
                      Guardar borrador
                    </h2>
                    <p className="mt-1 text-[12px] text-ink-2 leading-relaxed">
                      Se persiste la definición con ids y posiciones generadas. Todavía no se
                      publica: la revisión queda en estado <span className="text-ink">draft</span>{' '}
                      hasta que la confirmes.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Boton
                    variante={revision ? 'secundaria' : 'primaria'}
                    onClick={() => void guardarBorrador()}
                    disabled={guardando || !puedeContinuar}
                  >
                    {guardando
                      ? 'Guardando…'
                      : revision
                        ? 'Actualizar borrador'
                        : 'Guardar borrador'}
                  </Boton>
                  {revision && (
                    <Boton variante="primaria" onClick={() => setPaso(5)}>
                      Continuar a publicar
                    </Boton>
                  )}
                </div>

                {errorGuardar && <Aviso>{errorGuardar}</Aviso>}
              </div>

              {revision && (
                <div className="panel p-5 space-y-3">
                  <p className="label-inst">Borrador guardado</p>
                  <dl className="grid sm:grid-cols-3 gap-3 text-[12px]">
                    <div className="min-w-0">
                      <dt className="label-inst">Revisión</dt>
                      <dd className="num-inst mt-1 text-ink-2 break-all">{revision.id}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="label-inst">Template</dt>
                      <dd className="num-inst mt-1 text-ink-2 break-all">{revision.template_id}</dd>
                    </div>
                    <div>
                      <dt className="label-inst">Estado</dt>
                      <dd className="mt-1 text-ink capitalize">{revision.status}</dd>
                    </div>
                  </dl>
                </div>
              )}

              <footer className="flex items-center justify-between gap-3 pt-1">
                <Boton variante="fantasma" onClick={() => setPaso(3)}>
                  Atrás
                </Boton>
              </footer>
            </div>
          )}

          {/* ── PASO 5 · Publicar (confirmación explícita, FR-048) ──────── */}
          {paso === 5 && revision && (
            <div className="space-y-5">
              <div className="panel p-5 space-y-4">
                <h2 className="text-[14px] font-semibold tracking-[-0.015em]">
                  Publicar revisión
                </h2>
                <p className="text-[12px] text-ink-2 leading-relaxed max-w-[64ch]">
                  Publicar asigna el número de versión e incorpora la plantilla a la captura de
                  todos los dispositivos del tenant (FR-027). Es una acción explícita: nada se
                  publica sin este paso.
                </p>

                <label className="flex items-start gap-3 min-h-[44px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmado}
                    onChange={(e) => setConfirmado(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-beam"
                  />
                  <span className="text-[13px] leading-relaxed">
                    Confirmo publicar <span className="text-ink">“{nombre.trim()}”</span> con{' '}
                    {totalItems} ítem(s).
                  </span>
                </label>

                {errorPublicar && <Aviso>{errorPublicar}</Aviso>}

                <div className="flex flex-wrap items-center gap-3">
                  <Boton
                    variante="primaria"
                    disabled={!confirmado || publicando}
                    onClick={() => void publicar()}
                  >
                    {publicando ? 'Publicando…' : 'Publicar versión'}
                  </Boton>
                  <Boton variante="fantasma" onClick={() => setPaso(4)}>
                    Volver al borrador
                  </Boton>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/* ── Stepper ─────────────────────────────────────────────────────────────── */
function Stepper({ paso }: { paso: number }) {
  return (
    <ol className="flex items-center gap-1.5 flex-wrap" aria-label="Pasos de la importación">
      {PASOS.map((label, i) => {
        const n = i + 1
        const activo = n === paso
        const hecho = n < paso
        return (
          <li key={label} className="flex items-center gap-1.5">
            <span
              className={[
                'flex items-center gap-2 h-8 pl-1.5 pr-2.5 rounded-full border text-[12px]',
                'transition-colors duration-150',
                activo
                  ? 'border-beam/50 bg-beam/10 text-ink'
                  : hecho
                    ? 'border-synced/35 text-ink-2'
                    : 'border-line-soft text-ink-3',
              ].join(' ')}
              aria-current={activo ? 'step' : undefined}
            >
              <span
                className={[
                  'h-5 w-5 rounded-full grid place-items-center num-inst text-[11px] font-semibold',
                  activo ? 'bg-beam text-s0' : hecho ? 'bg-synced/20 text-synced' : 'bg-s3 text-ink-3',
                ].join(' ')}
              >
                {hecho ? '✓' : n}
              </span>
              {label}
            </span>
            {n < PASOS.length && <span className="h-px w-3 bg-line-soft" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

/* ── Editor de un ítem (paso 3) ──────────────────────────────────────────── */
function EditorItem({
  indice,
  item,
  error,
  onPrompt,
  onTipo,
  onRequerido,
  onProps,
  onQuitar,
}: {
  indice: string
  item: ProposedItem
  error: string | null
  onPrompt: (v: string) => void
  onTipo: (t: ResponseType) => void
  onRequerido: (v: boolean) => void
  onProps: (patch: Partial<FieldProps>) => void
  onQuitar: () => void
}) {
  const p = item.props

  /** Entrada de texto → número (o undefined si vacía/inválida). */
  const numero = (v: string, entero = false): number | undefined => {
    if (v === '') return undefined
    const n = entero ? parseInt(v, 10) : Number(v)
    return Number.isFinite(n) ? n : undefined
  }

  return (
    <div className={['panel p-4 space-y-3', error ? 'border-sev-alta/40' : ''].join(' ')}>
      <div className="flex items-start gap-3">
        <span className="label-inst mt-3 shrink-0 w-7">{indice}</span>
        <input
          value={item.prompt}
          onChange={(e) => onPrompt(e.target.value)}
          aria-label={`Texto del ítem ${indice}`}
          className={INPUT}
        />
        <button
          type="button"
          onClick={onQuitar}
          aria-label={`Quitar ítem ${indice}`}
          className="shrink-0 h-10 w-10 grid place-items-center rounded-[10px] border border-line-soft text-ink-3 hover:text-failed hover:border-failed/40 transition-colors duration-150 cursor-pointer"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path
              d="M3.2 4h8.6M6 4V2.7h3V4M4.3 4l.5 8h5.4l.5-8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Campo label="Tipo de campo">
          <select
            value={item.response_type}
            onChange={(e) => onTipo(e.target.value as ResponseType)}
            className={SELECT}
          >
            {RESPONSE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TIPO_LABEL[t]}
              </option>
            ))}
          </select>
        </Campo>

        <div className="space-y-1.5">
          <span className="label-inst">Requerido</span>
          <button
            type="button"
            role="switch"
            aria-checked={item.required}
            onClick={() => onRequerido(!item.required)}
            className={[
              'h-10 w-full flex items-center justify-between gap-2 px-3 rounded-[10px] border',
              'text-[13px] transition-colors duration-150 cursor-pointer',
              item.required
                ? 'border-beam/50 bg-beam/10 text-ink'
                : 'border-line-soft bg-s0 text-ink-3',
            ].join(' ')}
          >
            {item.required ? 'Sí' : 'No'}
            <span
              className={[
                'relative h-5 w-9 rounded-full shrink-0 transition-colors duration-150',
                item.required ? 'bg-beam' : 'bg-s3',
              ].join(' ')}
            >
              <span
                className={[
                  'absolute top-0.5 h-4 w-4 rounded-full bg-s0 transition-all duration-150',
                  item.required ? 'left-[18px]' : 'left-0.5',
                ].join(' ')}
              />
            </span>
          </button>
        </div>
      </div>

      {item.response_type === 'numeric' && (
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Mínimo">
            <input
              type="number"
              value={typeof p.min === 'number' ? p.min : ''}
              onChange={(e) => onProps({ min: numero(e.target.value) })}
              className={INPUT}
            />
          </Campo>
          <Campo label="Máximo">
            <input
              type="number"
              value={typeof p.max === 'number' ? p.max : ''}
              onChange={(e) => onProps({ max: numero(e.target.value) })}
              className={INPUT}
            />
          </Campo>
        </div>
      )}

      {item.response_type === 'date' && (
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Desde">
            <input
              type="date"
              value={typeof p.min === 'string' ? p.min : ''}
              onChange={(e) => onProps({ min: e.target.value || undefined })}
              className={INPUT}
            />
          </Campo>
          <Campo label="Hasta">
            <input
              type="date"
              value={typeof p.max === 'string' ? p.max : ''}
              onChange={(e) => onProps({ max: e.target.value || undefined })}
              className={INPUT}
            />
          </Campo>
        </div>
      )}

      {item.response_type === 'text' && (
        <Campo label="Largo máximo (caracteres)">
          <input
            type="number"
            min={1}
            max={10000}
            value={typeof p.max_length === 'number' ? p.max_length : ''}
            onChange={(e) => onProps({ max_length: numero(e.target.value, true) })}
            className={INPUT}
          />
        </Campo>
      )}

      {item.response_type === 'photo' && (
        <Campo label="Tamaño máximo del adjunto (KB)">
          <input
            type="number"
            min={1}
            value={typeof p.photo_max_kb === 'number' ? p.photo_max_kb : ''}
            onChange={(e) => onProps({ photo_max_kb: numero(e.target.value, true) })}
            className={INPUT}
          />
        </Campo>
      )}

      {(item.response_type === 'select_single' || item.response_type === 'select_multiple') && (
        <Campo label="Opciones (una por línea)">
          <textarea
            // No controlado: permite escribir saltos de línea sin pelear con el
            // filtrado de vacíos; `onChange` sincroniza `props.options`.
            key={item.response_type}
            defaultValue={(p.options ?? []).join('\n')}
            rows={4}
            placeholder={'Opción A\nOpción B'}
            onChange={(e) =>
              onProps({
                options: e.target.value
                  .split('\n')
                  .map((l) => l.trim())
                  .filter((l) => l !== ''),
              })
            }
            className={`${INPUT} h-auto min-h-[88px] py-2 resize-y`}
          />
        </Campo>
      )}

      {error && (
        <p className="flex items-center gap-1.5 text-[12px] text-sev-alta">
          <span className="h-1.5 w-1.5 rounded-full bg-sev-alta shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

/* ── Aviso en línea ──────────────────────────────────────────────────────── */
function Aviso({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border bg-sev-alta/10 border-sev-alta/25 px-3 py-2"
    >
      <span className="mt-[3px] h-1.5 w-1.5 rounded-full bg-sev-alta shrink-0" />
      <p className="text-[12px] leading-relaxed text-sev-alta">{children}</p>
    </div>
  )
}

/* ── Campo con etiqueta ──────────────────────────────────────────────────── */
function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="label-inst">{label}</span>
      {children}
    </label>
  )
}
