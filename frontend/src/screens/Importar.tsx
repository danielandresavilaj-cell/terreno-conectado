/* Importación asistida de plantillas desde `.xlsx` — FR-029, FR-048 (TSK-FORM-006).
 *
 * Wizard de 5 pasos para `tenant_admin`, con estado LOCAL (`useState`): no toca
 * el store global porque es una tarea de configuración, no de captura.
 *
 *   1. Subir     → lee el buffer en el dispositivo y propone secciones/ítems
 *                  (`proponerImport`, subpath `@terreno/shared/xlsx` — la única
 *                  vía al módulo; el barrel `@terreno/shared` no lo reexporta) y
 *                  SUBE el original (`subirImportOriginal`) para dejar un
 *                  `template_import` con el que confirmar.
 *   2. Preview   → tabla read-only de la propuesta (sin edición).
 *   3. Editar    → nombre + prompt/tipo/requerido/props por ítem, con validación
 *                  EN VIVO contra `FIELD_PROPS_SCHEMA` (mismo contrato que el
 *                  backend, FR-036/039).
 *   4. Borrador  → `propuestaADefinicion` → `confirmarImport` (crea template +
 *                  borrador atados al `source_import_id`, el origen que hace
 *                  exportable el original, FR-019) o `actualizarBorrador` si ya
 *                  se guardó → id/revisión/estado.
 *   5. Publicar  → NUNCA automático (FR-048): confirmación explícita y
 *                  `publicarRevision`; los errores (409…) conservan el draft.
 *
 * TSK-FORM-022: el mismo asistente sirve para CREAR DESDE CERO (`inicio="cero"`):
 * arranca en Editar con una propuesta vacía (pasos Editar → Borrador → Publicar)
 * y el primer guardado usa `crearPlantilla` (`POST /templates`). El editor, en
 * ambos modos, agrega, reordena y quita preguntas y secciones
 * (`lib/editor-formulario.ts`).
 *
 * MOVIMIENTO: migración entre pasos con fade corto (`EASE.out`, 200 ms) y
 * desplazamiento mínimo de 6 px — el usuario avanza/retrocede; no es un cambio
 * de "página" con historial. Nada más se anima: el wizard es trabajo de foco.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Chip } from '../components/Badges'
import { Boton } from '../components/ui'
import {
  ApiError,
  actualizarBorrador,
  analizarImportConIA,
  confirmarImport,
  crearPlantilla,
  getCapacidadesImport,
  getPlantillas,
  publicarRevision,
  subirImportOriginal,
} from '../lib/api'
import { comprimirImagen } from '../lib/compresor'
import {
  agregarPregunta,
  agregarSeccion,
  moverPregunta,
  moverSeccion,
  propuestaVacia,
  quitarPregunta,
  quitarSeccion,
  renombrarSeccion,
} from '../lib/editor-formulario'
import { useEstado } from '../lib/store'
import { EASE } from '../lib/motion'
import { proponerImport, propuestaADefinicion } from '@terreno/shared/xlsx'
import { FIELD_PROPS_SCHEMA, RESPONSE_TYPES } from '@terreno/shared'
import type { CapacidadesImport, FieldProps, MotorImport, ResponseType, TemplateImport, TemplateRevisionDetailDto } from '@terreno/shared'
import type { ProposedItem, TemplateImportProposal } from '@terreno/shared/xlsx'

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
  if (item.prompt.trim() === '') return 'Escribe el texto de la pregunta.'
  // TSK-FORM-022: el mensaje crudo de Zod ("Required") no dice qué hacer.
  if ((item.response_type === 'select_single' || item.response_type === 'select_multiple') && !item.props.options?.length) {
    return 'Agrega al menos una opción (una por línea).'
  }
  const check = FIELD_PROPS_SCHEMA[item.response_type].safeParse(item.props)
  if (!check.success) {
    const m = check.error.issues[0]?.message ?? ''
    return /^required$/i.test(m) || !m ? 'Completa los datos de esta pregunta.' : m
  }
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

/** La propuesta persistida (Zod) no trae los metadatos del preview: se completan vacíos. */
function desdeServidor(p: NonNullable<TemplateImport['proposed_schema']>): TemplateImportProposal {
  return {
    ...p,
    secciones: p.secciones.map((s) => ({
      ...s,
      items: s.items.map((it) => ({ ...it, props: it.props as FieldProps, opcionesConteo: {}, muestra: [], filasConDato: 0 })),
    })),
  }
}

/** TSK-FORM-021: una foto de pauta en papel (sólo la lee la IA). */
const esFoto = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name)

/**
 * Las fotos del teléfono pesan varios MB: se reescalan a JPEG con un lado
 * mayor de 2000 px (el texto sigue legible y cabe en el tope de 5 MB).
 */
async function prepararFoto(f: File): Promise<File> {
  const c = await comprimirImagen(f, { maxLado: 2000, calidad: 0.85 })
  const nombre = f.name.replace(/\.[^.]+$/, '') || 'pauta'
  return new File([c.blob], `${nombre}.jpg`, { type: 'image/jpeg' })
}

export function Importar({ inicio = 'importar' }: { inicio?: 'importar' | 'cero' } = {}) {
  const { ir } = useEstado()
  const reducir = useReducedMotion()
  const inputRef = useRef<HTMLInputElement>(null)

  /* TSK-FORM-022: 'cero' = crear desde cero (sin archivo, empieza en Editar). */
  const [modo, setModo] = useState<'importar' | 'cero'>(inicio)
  const [paso, setPaso] = useState(inicio === 'cero' ? 3 : 1)
  const [analizando, setAnalizando] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [propuesta, setPropuesta] = useState<TemplateImportProposal | null>(() =>
    inicio === 'cero' ? propuestaVacia() : null,
  )
  // Import al que se confirmará el borrador. Se llena al SUBIR el original en el
  // paso 1: sin él no hay documento fuente que exportar después (FR-019/044).
  const [importId, setImportId] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [revision, setRevision] = useState<TemplateRevisionDetailDto | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null)
  const [confirmado, setConfirmado] = useState(false)
  const [publicando, setPublicando] = useState(false)
  const [errorPublicar, setErrorPublicar] = useState<string | null>(null)
  const [publicado, setPublicado] = useState<TemplateRevisionDetailDto | null>(null)
  /* TSK-FORM-020: si ya hay un formulario publicado con este nombre, se ofrece
   * crear el borrador como NUEVA VERSIÓN suya en vez de duplicarlo. */
  const [publicadas, setPublicadas] = useState<{ template_id: string; name: string; version: number }[]>([])
  const [comoVersion, setComoVersion] = useState(true)
  /* TSK-FORM-021: importar con IA (opcional; sólo si el servidor la tiene). */
  const camaraRef = useRef<HTMLInputElement>(null)
  const [capacidades, setCapacidades] = useState<CapacidadesImport | null>(null)
  const [usarIA, setUsarIA] = useState(true)
  const [motorPropuesta, setMotorPropuesta] = useState<MotorImport>('reglas')
  /** Import que las reglas no pudieron leer: se ofrece "Reintentar con IA". */
  const [fallido, setFallido] = useState<string | null>(null)

  const refrescarCapacidades = () =>
    getCapacidadesImport()
      .then(setCapacidades)
      .catch(() => setCapacidades(null))
  useEffect(() => {
    void refrescarCapacidades()
  }, [])
  // Desde cero también se avisa si el nombre ya existe (no se duplica sin querer).
  useEffect(() => {
    if (modo !== 'cero') return
    void getPlantillas()
      .then((d) => setPublicadas(d.items))
      .catch(() => setPublicadas([]))
  }, [modo])
  const iaDisponible = capacidades?.ia === true
  const iaRestante = iaDisponible && (capacidades?.restantes_hoy ?? 0) > 0

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

  const normalizar = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')
  const existente = publicadas.find((t) => normalizar(t.name) === normalizar(nombre)) ?? null
  const nombreValido = nombre.trim().length > 0
  const seccionesSinTitulo = secciones.filter((s) => s.titulo.trim() === '').length
  const puedeContinuar = nombreValido && errores.length === 0 && totalItems > 0 && seccionesSinTitulo === 0

  /* ── PASO 1 · lectura del archivo ─────────────────────────────────────── */

  /** Deja el wizard en el Preview con la propuesta de un import exitoso. */
  const aplicarImport = (imp: TemplateImport, local: TemplateImportProposal | null) => {
    const prop = local ?? (imp.proposed_schema ? desdeServidor(imp.proposed_schema) : null)
    if (!prop) return
    void getPlantillas()
      .then((d) => setPublicadas(d.items))
      .catch(() => setPublicadas([]))
    setComoVersion(true)
    setImportId(imp.id)
    setFallido(null)
    setMotorPropuesta(imp.motor ?? 'reglas')
    setPropuesta(prop)
    setNombre(prop.nombre_archivo.replace(/\.[^.]+$/, '') || 'Plantilla importada')
    setRevision(null)
    setPublicado(null)
    setErrorGuardar(null)
    setErrorPublicar(null)
    setConfirmado(false)
    setPaso(2)
  }

  const mensajeDe = (err: unknown) =>
    err instanceof ApiError ? err.detalle : 'No se pudo subir el archivo al servidor. Intenta de nuevo.'

  const leerArchivo = async (original: File) => {
    setErrorCarga(null)
    setFallido(null)
    const foto = esFoto(original)
    if (foto && !iaRestante) {
      setErrorCarga(
        iaDisponible
          ? 'Se alcanzó el máximo de análisis con IA de hoy; una foto sólo se puede leer con IA.'
          : 'Para leer una foto de una pauta en papel hace falta "Analizar con IA", que no está activo en este servidor.',
      )
      return
    }
    setAnalizando(true)
    try {
      const esXlsx = /\.xlsx$/i.test(original.name)
      const motor: MotorImport = foto || (!esXlsx && usarIA && iaRestante) ? 'ia' : 'reglas'
      const file = foto ? await prepararFoto(original) : original
      let local: TemplateImportProposal | null = null
      if (esXlsx) {
        // El .xlsx se lee también en el dispositivo (mismo código que el servidor).
        const r = await proponerImport(new Uint8Array(await file.arrayBuffer()), file.name)
        if (!r.ok) {
          setPropuesta(null)
          setImportId(null)
          setErrorCarga(r.error)
          return
        }
        local = r.propuesta
      }
      // El ORIGINAL siempre se sube: la revisión nace atada a un `template_import`
      // (FR-019/044). Word, PDF y fotos se leen sólo en el servidor (TSK-FORM-020/021):
      // su propuesta es la que devuelve la subida.
      const imp = await subirImportOriginal(file, motor)
      if (motor === 'ia') void refrescarCapacidades()
      if (imp.status === 'failed' || (!local && !imp.proposed_schema)) {
        setPropuesta(null)
        setImportId(null)
        setErrorCarga(imp.error ?? 'El servidor no pudo interpretar el archivo.')
        // Las reglas no pudieron (p. ej. un PDF escaneado): la IA puede reintentar.
        if (motor === 'reglas' && !esXlsx) setFallido(imp.id)
        return
      }
      aplicarImport(imp, local)
    } catch (err) {
      setPropuesta(null)
      setImportId(null)
      setErrorCarga(err instanceof Error && !(err instanceof ApiError) && foto ? 'No se pudo leer la foto en este dispositivo.' : mensajeDe(err))
    } finally {
      setAnalizando(false)
    }
  }

  /** TSK-FORM-021: re-analiza con IA el archivo ya subido. */
  const reintentarConIA = async (id: string) => {
    setErrorCarga(null)
    setAnalizando(true)
    try {
      const imp = await analizarImportConIA(id)
      void refrescarCapacidades()
      if (imp.status === 'failed' || !imp.proposed_schema) {
        setPaso(1)
        setPropuesta(null)
        setImportId(null)
        setFallido(null)
        setErrorCarga(imp.error ?? 'La IA no pudo interpretar el archivo.')
        return
      }
      aplicarImport(imp, null)
    } catch (err) {
      setPaso(1)
      setErrorCarga(mensajeDe(err))
    } finally {
      setAnalizando(false)
    }
  }

  /** TSK-FORM-022: pasa al editor con un formulario vacío. */
  const empezarDesdeCero = () => {
    setModo('cero')
    setPropuesta(propuestaVacia())
    setNombre('')
    setImportId(null)
    setFallido(null)
    setErrorCarga(null)
    setRevision(null)
    setPublicado(null)
    setErrorGuardar(null)
    setErrorPublicar(null)
    setConfirmado(false)
    setPaso(3)
  }

  const resetear = () => {
    setPaso(1)
    setFallido(null)
    setMotorPropuesta('reglas')
    setPropuesta(null)
    setNombre('')
    setImportId(null)
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

  const quitarItem = (pi: number, ii: number) => setPropuesta((p) => (p ? quitarPregunta(p, pi, ii) : p))
  const editar = (fn: (p: TemplateImportProposal) => TemplateImportProposal) =>
    setPropuesta((p) => (p ? fn(p) : p))

  /* ── PASO 4 · guardar borrador ────────────────────────────────────────── */
  const guardarBorrador = async () => {
    if (!propuesta || (!importId && modo !== 'cero')) return
    setErrorGuardar(null)
    const def = propuestaADefinicion(propuesta)
    if (!def.ok) {
      setErrorGuardar(def.error)
      return
    }
    setGuardando(true)
    try {
      // Primera vez: se CONFIRMA el import con la definición revisada. Esa
      // confirmación crea template + borrador atados al `source_import_id` — el
      // origen que hace exportable el `.xlsx` (FR-019). Las ediciones siguientes
      // ya son PATCH sobre ese borrador, como en el camino sin origen.
      const r = revision
        ? await actualizarBorrador(revision.id, def.definition)
        : modo === 'cero' || !importId
          ? // TSK-FORM-022: formulario nuevo sin archivo de origen.
            await crearPlantilla({ name: nombre.trim(), definition: def.definition })
          : await confirmarImport(importId, {
              name: nombre.trim(),
              definition: def.definition,
              ...(existente && comoVersion ? { template_id: existente.template_id } : {}),
            })
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
        err instanceof ApiError ? err.detalle : 'No se pudo publicar la revisión. Intenta nuevamente.',
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
            <span className="text-synced">published</span>. El siguiente paso es asignarla a las
            faenas y roles que deben verla en terreno.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Boton variante="primaria" onClick={() => ir('plantillas')}>
              Asignar a equipo
            </Boton>
            {modo === 'cero' && (
              <Boton variante="secundaria" onClick={empezarDesdeCero}>
                Crear otro formulario
              </Boton>
            )}
            <Boton variante="secundaria" onClick={() => ir('dashboard')}>
              Volver a Gerencia
            </Boton>
          </div>
        </motion.section>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {modo === 'cero' ? (
        <header>
          <p className="label-inst">Formulario nuevo</p>
          <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
            Crear formulario
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-2 max-w-[68ch] leading-relaxed">
            Arma las secciones y preguntas, elige el tipo de respuesta de cada una, guarda el borrador y
            publícalo. La publicación nunca es automática: la confirmas tú.
          </p>
        </header>
      ) : (
      <header>
        <p className="label-inst">Importación asistida</p>
        <h1 className="mt-1.5 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] leading-[1.1]">
          Importar plantilla
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-2 max-w-[68ch] leading-relaxed">
          Sube un <span className="text-ink">Excel (.xlsx)</span>, <span className="text-ink">Word (.docx)</span> o{' '}
          <span className="text-ink">PDF</span>, revisa la propuesta,
          corrige lo que haga falta, guarda el borrador y publícalo. La publicación nunca es
          automática: la confirmas tú.
        </p>
      </header>
      )}

      <Stepper paso={paso} modo={modo} />

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
                  accept={`.xlsx,.docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet${iaDisponible ? ',.jpg,.jpeg,.png,image/jpeg,image/png' : ''}`}
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
                  {analizando
                    ? usarIA && iaRestante
                      ? 'Analizando con IA… puede tardar hasta un minuto'
                      : 'Analizando el archivo…'
                    : iaDisponible
                      ? 'Elige un Excel, Word, PDF o una foto'
                      : 'Elige un Excel, Word o PDF'}
                </span>
                <span className="text-[12px] text-ink-3 max-w-[48ch] leading-relaxed">
                  Excel: cada hoja es una sección y cada columna con encabezado, un ítem. Word y
                  PDF: los títulos son secciones; las tablas con columnas Sí/No/N.A., las casillas
                  ☐ y las líneas «Etiqueta: ____» se vuelven preguntas, y los PDF rellenables
                  aportan sus campos.{' '}
                  {iaDisponible
                    ? 'Con IA también se leen PDF escaneados y fotos de pautas en papel. Siempre revisas la propuesta antes de guardar.'
                    : 'Los PDF escaneados (imagen) necesitan la IA, que no está activa en este servidor.'}
                </span>
              </label>

              {/* TSK-FORM-021: motor de IA opcional (sólo si el servidor la tiene). */}
              {iaDisponible && (
                <div className="panel p-4 space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={usarIA}
                      disabled={analizando}
                      onChange={(e) => setUsarIA(e.target.checked)}
                    />
                    <span className="space-y-0.5">
                      <span className="block text-[13px] font-medium">Analizar Word y PDF con IA</span>
                      <span className="block text-[12px] text-ink-3 leading-relaxed">
                        La IA entiende pautas desordenadas y escaneadas; sin ella se usan las reglas.
                        Sólo se envía la pauta en blanco, nunca inspecciones ni respuestas.{' '}
                        {iaRestante
                          ? `Quedan ${capacidades?.restantes_hoy} análisis con IA hoy.`
                          : 'Se alcanzó el máximo de análisis con IA de hoy.'}
                      </span>
                    </span>
                  </label>
                  <input
                    ref={camaraRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) void leerArchivo(f)
                    }}
                  />
                  <Boton
                    tamano="sm"
                    variante="secundaria"
                    disabled={analizando || !iaRestante}
                    onClick={() => camaraRef.current?.click()}
                  >
                    Fotografiar una pauta en papel
                  </Boton>
                </div>
              )}

              {/* TSK-FORM-022: alternativa sin archivo. */}
              <div className="panel p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">¿No tienes el formulario en un archivo?</p>
                  <p className="text-[12px] text-ink-3 leading-relaxed">
                    Créalo desde cero: agregas secciones y preguntas, y eliges el tipo de respuesta.
                  </p>
                </div>
                <Boton tamano="sm" variante="secundaria" disabled={analizando} onClick={empezarDesdeCero}>
                  Crear desde cero
                </Boton>
              </div>

              <AnimatePresence>
                {errorCarga && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    <Aviso>No se pudo interpretar el archivo: {errorCarga}</Aviso>
                    {fallido && iaRestante && (
                      <div className="pt-2">
                        <Boton tamano="sm" variante="primaria" disabled={analizando} onClick={() => void reintentarConIA(fallido)}>
                          Reintentar con IA
                        </Boton>
                      </div>
                    )}
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
                <Chip>{(propuesta.formato ?? 'xlsx').toUpperCase()}</Chip>
                <Chip>{motorPropuesta === 'ia' ? 'Propuesta de IA' : 'Reglas'}</Chip>
                {(propuesta.formato ?? 'xlsx') === 'xlsx' && <Chip>{propuesta.resumen.filasDatos} filas de datos</Chip>}
                <span className="flex-1" />
                {motorPropuesta === 'reglas' && importId && iaRestante && (propuesta.formato === 'pdf' || propuesta.formato === 'docx') && (
                  <Boton tamano="sm" variante="secundaria" disabled={analizando} onClick={() => void reintentarConIA(importId)}>
                    {analizando ? 'Analizando con IA…' : '¿No quedó bien? Analizar con IA'}
                  </Boton>
                )}
                <Boton tamano="sm" variante="secundaria" onClick={resetear}>
                  Elegir otro archivo
                </Boton>
              </div>

              {(propuesta.advertencias?.length ?? 0) > 0 && (
                <div className="panel p-4 space-y-1.5 border-sev-media/35">
                  <p className="text-[13px] font-medium">Revisa esto antes de seguir</p>
                  <ul className="list-disc pl-5 space-y-1 text-[12px] text-ink-2 leading-relaxed">
                    {propuesta.advertencias?.map((a) => <li key={a}>{a}</li>)}
                  </ul>
                </div>
              )}

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
                              {it.source?.headerCell ?? '—'}
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
                {existente && !revision && modo === 'cero' && (
                  <p className="pt-1 text-[12px] text-sev-media leading-relaxed">
                    Ya existe un formulario llamado «{existente.name}». Se creará uno nuevo con el mismo
                    nombre; si querías una nueva versión de ese, impórtalo desde un archivo.
                  </p>
                )}
                {existente && !revision && modo !== 'cero' && (
                  <label className="flex items-start gap-2 pt-1 text-[12px] text-ink-2 leading-relaxed">
                    <input
                      type="checkbox"
                      checked={comoVersion}
                      onChange={(e) => setComoVersion(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Ya existe «{existente.name}» (versión {existente.version}). Guardar esto como su{' '}
                      <span className="text-ink">versión {existente.version + 1}</span> en vez de crear un
                      formulario duplicado.
                    </span>
                  </label>
                )}
              </div>

              {errores.length > 0 && (
                <Aviso>
                  {errores.length === 1
                    ? 'Hay 1 pregunta por completar: revisa la marcada abajo.'
                    : `Hay ${errores.length} preguntas por completar: revisa las marcadas abajo.`}
                </Aviso>
              )}

              {seccionesSinTitulo > 0 && <Aviso>Cada sección necesita un título.</Aviso>}

              {secciones.map((s, pi) => (
                <section key={`sec-edit-${pi}`} className="space-y-2.5">
                  {/* TSK-FORM-022: título editable y controles de la sección. */}
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-2">
                    <span className="label-inst shrink-0">Sección {pi + 1}</span>
                    <input
                      value={s.titulo}
                      onChange={(e) => editar((p) => renombrarSeccion(p, pi, e.target.value))}
                      aria-label={`Título de la sección ${pi + 1}`}
                      placeholder="Título de la sección"
                      className={`${INPUT} h-9 font-medium min-w-0 flex-1`}
                    />
                    <div className="flex gap-2 w-full sm:w-auto justify-end">
                    <BotonIcono
                      etiqueta={`Subir sección ${pi + 1}`}
                      onClick={pi > 0 ? () => editar((p) => moverSeccion(p, pi, -1)) : null}
                    >
                      <path d="M7.5 11.5v-8M4 7l3.5-3.5L11 7" />
                    </BotonIcono>
                    <BotonIcono
                      etiqueta={`Bajar sección ${pi + 1}`}
                      onClick={pi < secciones.length - 1 ? () => editar((p) => moverSeccion(p, pi, 1)) : null}
                    >
                      <path d="M7.5 3.5v8M4 8l3.5 3.5L11 8" />
                    </BotonIcono>
                    <BotonIcono
                      etiqueta={`Quitar sección ${pi + 1}`}
                      onClick={
                        secciones.length > 1
                          ? () => {
                              if (
                                s.items.length === 0 ||
                                window.confirm(`¿Quitar la sección «${s.titulo || pi + 1}» y sus ${s.items.length} preguntas?`)
                              ) {
                                editar((p) => quitarSeccion(p, pi))
                              }
                            }
                          : null
                      }
                    >
                      <path d="M3.2 4h8.6M6 4V2.7h3V4M4.3 4l.5 8h5.4l.5-8" />
                    </BotonIcono>
                    </div>
                  </div>
                  {s.items.length === 0 && (
                    <p className="panel px-4 py-3 text-[12px] text-ink-3">
                      Esta sección todavía no tiene preguntas.
                    </p>
                  )}
                  {s.items.map((it, ii) => (
                    <EditorItem
                      key={it.source ? `${it.source.sheet}:${it.source.column}` : `${pi}:${ii}`}
                      indice={`${pi + 1}.${ii + 1}`}
                      item={it}
                      error={errorDe(pi, ii)}
                      onPrompt={(v) => mutarItem(pi, ii, (x) => ({ ...x, prompt: v }))}
                      onTipo={(t) => cambiarTipo(pi, ii, t)}
                      onRequerido={(v) => cambiarRequerido(pi, ii, v)}
                      onProps={(patch) => cambiarProps(pi, ii, patch)}
                      onQuitar={() => quitarItem(pi, ii)}
                      onSubir={ii > 0 ? () => editar((p) => moverPregunta(p, pi, ii, -1)) : null}
                      onBajar={ii < s.items.length - 1 ? () => editar((p) => moverPregunta(p, pi, ii, 1)) : null}
                    />
                  ))}
                  <Boton tamano="sm" variante="fantasma" onClick={() => editar((p) => agregarPregunta(p, pi))}>
                    + Agregar pregunta
                  </Boton>
                </section>
              ))}

              <Boton variante="secundaria" onClick={() => editar((p) => agregarSeccion(p))}>
                + Agregar sección
              </Boton>

              <footer className="flex items-center justify-between gap-3 pt-1">
                {modo === 'cero' ? (
                  <Boton variante="fantasma" onClick={() => ir('plantillas')}>
                    Cancelar
                  </Boton>
                ) : (
                  <Boton variante="fantasma" onClick={() => setPaso(2)}>
                    Atrás
                  </Boton>
                )}
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
                      {modo === 'cero'
                        ? 'Se guarda el formulario con sus secciones y preguntas. Se podrá exportar en Excel consolidado, PDF o Word. '
                        : 'Se persiste la definición con ids y posiciones generadas, y queda guardado el archivo original: la plantilla podrá exportar el documento rellenado. '}
                      Todavía no se publica: la revisión queda en estado{' '}
                      <span className="text-ink">draft</span> hasta que la confirmes.
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
                  todos los dispositivos del tenant. Es una acción explícita: nada se
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
function Stepper({ paso, modo }: { paso: number; modo: 'importar' | 'cero' }) {
  // Desde cero no hay Subir ni Preview: se ven Editar → Borrador → Publicar (1–3).
  const offset = modo === 'cero' ? 2 : 0
  const pasos = PASOS.slice(offset)
  return (
    <ol className="flex items-center gap-1.5 flex-wrap" aria-label={modo === 'cero' ? 'Pasos para crear el formulario' : 'Pasos de la importación'}>
      {pasos.map((label, i) => {
        const n = i + 1 + offset
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
                  activo ? 'bg-beam text-on-beam' : hecho ? 'bg-synced/20 text-synced' : 'bg-s3 text-ink-3',
                ].join(' ')}
              >
                {hecho ? '✓' : n - offset}
              </span>
              {label}
            </span>
            {i < pasos.length - 1 && <span className="h-px w-3 bg-line-soft" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

/* ── Botón de ícono del editor (reordenar) ─────────────────────────────────
 * 40 px como el de quitar; deshabilitado cuando la pregunta/sección ya está en
 * el borde. TSK-FORM-022. */
function BotonIcono({ etiqueta, onClick, children }: { etiqueta: string; onClick: (() => void) | null; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick ?? undefined}
      disabled={!onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className="shrink-0 h-10 w-10 grid place-items-center rounded-[10px] border border-line-soft text-ink-3 hover:text-ink hover:border-line transition-colors duration-150 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:text-ink-3 disabled:hover:border-line-soft"
    >
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
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
  onSubir,
  onBajar,
}: {
  indice: string
  item: ProposedItem
  error: string | null
  onPrompt: (v: string) => void
  onTipo: (t: ResponseType) => void
  onRequerido: (v: boolean) => void
  onProps: (patch: Partial<FieldProps>) => void
  onQuitar: () => void
  /** TSK-FORM-022: reordenar; null = ya está en el borde. */
  onSubir: (() => void) | null
  onBajar: (() => void) | null
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
      <div className="flex flex-wrap sm:flex-nowrap items-start gap-x-3 gap-y-2">
        <span className="label-inst mt-3 shrink-0 w-7">{indice}</span>
        <input
          value={item.prompt}
          onChange={(e) => onPrompt(e.target.value)}
          aria-label={`Texto del ítem ${indice}`}
          placeholder="Escribe la pregunta"
          className={`${INPUT} min-w-0 flex-1`}
        />
        {/* En móvil los botones bajan a su fila: el texto de la pregunta necesita el ancho. */}
        <div className="flex gap-2 w-full sm:w-auto justify-end">
        <BotonIcono etiqueta={`Subir ítem ${indice}`} onClick={onSubir}>
          <path d="M7.5 11.5v-8M4 7l3.5-3.5L11 7" />
        </BotonIcono>
        <BotonIcono etiqueta={`Bajar ítem ${indice}`} onClick={onBajar}>
          <path d="M7.5 3.5v8M4 8l3.5 3.5L11 8" />
        </BotonIcono>
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
