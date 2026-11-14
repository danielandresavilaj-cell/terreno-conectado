/* Estado de la app.
 *
 * Hasta TSK-WS-005 la captura es REAL (Dexie/IndexedDB): crea inspecciones/
 * respuestas/hallazgos/bitácora con UUIDv7 de cliente y los encola en el
 * outbox local (FR-011, FR-013, FR-014, FR-015). El outbox lo consume la capa
 * de sync (TSK-WS-007/008); acá solo se crea y se muestra.
 *
 * Desde TSK-WS-011 la SESIÓN también es real: `loginInApp` autentica contra el
 * backend, guarda el access token (sessionStorage) y cachea la identidad
 * (tenant + faenas reales) en Dexie `meta` — `AnswerIdentidad.dexie`. Sin red,
 * el arranque restaura la sesión desde esa caché (FR-006): el trabajador puede
 * seguir capturando aunque el token no se haya refrescado todavía.
 *
 * `online` es el estado real de la red (`navigator.onLine` y sus eventos):
 * al volver la señal, el worker de cola drena solo (FR-016, TSK-WS-008).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Identidad, RegistroCola, Rol, Severidad, Usuario } from './types'
import { armarVistaCola } from './cola-vista'
import {
  datosVistaCola,
  guardarHallazgo as guardarHallazgoDb,
  hallazgoDeRespuesta,
  hallazgosDeInspeccion,
  addLogEntry,
  aplicarPurgaOriginales,
  borrarSesionCaché,
  contadorFallidos,
  contadorFotosPendientes,
  contadorPendientes,
  descartarBorrador,
  descartarRegistroCola as descartarRegistroColaDb,
  ensureDraftInspection,
  getDeviceId,
  getDraftInspectionId,
  getInspection,
  fotoDeItem,
  guardarFaenaSeleccionada,
  guardarFotoRespuesta,
  guardarOriginalPlantilla,
  guardarPlantillaSeleccionada,
  guardarSesionCaché,
  leerFaenaSeleccionada,
  leerPlantillaSeleccionada,
  listarOriginalesPlantilla,
  listLogEntries,
  listOutbox,
  migrarFotosLegacy,
  quitarFotoRespuesta,
  respuestaDelItem,
  setDueñoCola,
  sesionCaché,
  submitInspection,
  upsertResponse,
  type OutboxRow,
} from './db'
import {
  ApiError,
  cambiarClave,
  clearToken,
  EVENTO_CAMBIO_CLAVE,
  EVENTO_LOGOUT,
  type MotivoSalida,
  getPlantillaOriginal,
  getSites,
  getToken,
  login,
  logoutServidor,
  refrescarToken,
  me,
  setToken,
} from './api'
import { actualizarCatalogo, leerCatalogo } from './catalogo-formularios'
import { comprimirImagen } from './compresor'
import { sincronizarCola, setPriorizarFotos, setSincronizacionPermitida } from './sync'
import { cuotaEsAlta, estimarCuota } from './cuota'
import {
  elegirPlantillaActiva,
  planificarPurga,
  revisionesParaOriginal,
  type MarcoBorrador,
  type ResolucionPlantilla,
} from './plantillas'
import {
  PRESUPUESTO_ORIGINALES_BYTES,
  validateValorCampo,
  XLSX_MIME,
  type CampoValor,
  type SignatureStroke,
  type TemplateDefinition,
  type TemplatePublicadaDto,
} from '@terreno/shared'
import { columnasDesdeValor, contestado, esOkNokNa, itemsDe, valorDesdeColumnas } from './valores'
import { erroresDeEnvio } from './validar-envio-inspeccion'
import { detalleDeHallazgo } from './hallazgo'
import { elegirFaenaInicial, motivoParaNoCambiar } from './faena'
import { anotarPantalla, iniciarHistorial, resolverRetroceso, type Pantalla } from './navegacion'

export type { Pantalla }

export interface RespuestaItem {
  itemId: string
  /** Valor tipado del campo según `response_type` (FR-036); null = vacío. */
  campo: CampoValor | null
  /** Solo para el marcador visual ok/nok/na (legend del botón). */
  valor: 'ok' | 'nok' | 'na' | null
  hallazgoId?: string
}

/** Plantilla activa de la captura: server/caché o demo local (FR-036). */
export interface PlantillaActual {
  templateId: string
  revisionId: string | null
  nombre: string
  version: number | null
  origen: 'servidor' | 'caché'
  definition: TemplateDefinition
  /**
   * FR-028: `'no-disponible'` = hay borrador congelado pero su revisión no está
   * en el dispositivo. La UI lo dice en vez de reencuadrar a otra plantilla
   * (el trabajador estaría respondiendo un ítem distinto al que leyó).
   */
  estado: ResolucionPlantilla['estado']
  /** Revisión congelada pendiente, para que la UI pueda nombrarla. */
  revisionPendiente: string | null
}

interface Ctx {
  usuario: Usuario | null
  identidad: Identidad | null
  online: boolean
  pantalla: Pantalla
  hidratando: boolean
  cola: RegistroCola[]
  recienSincronizado: string | null
  cuotaAviso: boolean
  /** Cuota de almacenamiento local (FR-017); `usadaPct` null si el navegador
   *  no expone la Storage API (no se inventa un porcentaje). */
  cuota: { usadaPct: number | null; fotosPendientes: number }
  respuestas: Record<string, RespuestaItem>
  entradasBitacora: Array<{ id: string; capturadaEn: string; hora: string; autor: string; texto: string; tags: string[] }>

  /** Plantilla activa (FR-036); null sólo durante la hidratación inicial. */
  plantilla: PlantillaActual | null
  /** Sólo incluye formularios publicados y asignados al rol/faena de la sesión. */
  formularios: TemplatePublicadaDto[]
  /** Impide cambiar de formulario sin decidir qué hacer con el borrador actual. */
  hayBorrador: boolean
  /** Originales `.xlsx` cacheados y avisa de purga (FR-018); 0 = sin purgar. */
  originales: { cacheados: number; presupuestoBytes: number; purgados: number }
  /** Errores de validación por ítem (FR-039); vacío = todo válido. */
  erroresCampo: Record<string, string>

  loginInApp: (email: string, password: string, tenant?: string) => Promise<void>
  /** TSK-AUTH-010: clave temporal pendiente; la app muestra el cambio obligatorio. */
  debeCambiarClave: boolean
  cambiarClaveEnApp: (actual: string, nueva: string) => Promise<void>
  /** TSK-AUTH-010: la sesión expiró con registros por enviar (cola en pausa). */
  sesionExpirada: boolean
  /** TSK-AUTH-011: motivo del último cierre forzado (para el login). */
  avisoSalida: MotivoSalida | null
  /** Cierra la sesión en el servidor y en el dispositivo (la cola local queda). */
  salir: () => void
  /** Cambia de pantalla y deja la anterior en el historial (TSK-OFF-008).
   *  `reemplazar` es para redirecciones: no deja a dónde volver con Atrás. */
  ir: (p: Pantalla, opciones?: { reemplazar?: boolean }) => void
  /** TSK-OFF-008: se pulsó Atrás en la primera pantalla; otro Atrás cierra la app. */
  avisoSalir: boolean
  sincronizarAhora: () => void
  sincronizando: boolean
  enviandoInspeccion: boolean
  /** Descarta el borrador congelado que no se puede resolver (FR-028).
   *  Acción explícita del usuario, nunca automática: reencuadrar por la
   *  espalda invalidaría lo ya respondido. */
  descartarBorradorYRecargar: () => Promise<void>
  seleccionarFormulario: (revisionId: string) => Promise<{ ok: boolean; error?: string }>
  /** TSK-OFF-010: la empresa tiene varias faenas y la persona aún no eligió la suya. */
  faenaPorElegir: boolean
  /** Cambia la faena de la sesión (y sus formularios). No se puede con una inspección sin enviar. */
  cambiarFaena: (faenaId: string) => Promise<{ ok: boolean; error?: string }>
  descartarRegistroCola: (outboxId: number) => Promise<void>

  pendientes: number
  /** TSK-OFF-006: envíos por enviar (inspecciones/bitácoras), no filas técnicas. Es lo que ve la persona. */
  enviosPendientes: number
  fallidos: number
  enCola: RegistroCola[]
  /** Única vía de escritura de la captura: valida contra `props` (FR-039)
   *  y persiste el valor en las columnas naturales del borrador. */
  responderCampo: (itemId: string, valor: CampoValor, adjunto?: { foto: File }) => void
  /** Crea el hallazgo del ítem o corrige el que ya tenía (TSK-OFF-007). */
  guardarHallazgo: (itemId: string, sev: Severidad, descripcion: string, foto: File | null) => void
  /** TSK-OFF-011: foto guardada de un ítem del borrador (`null` si no hay). */
  leerFotoItem: (itemId: string) => Promise<Blob | null>
  /** Hallazgo ya registrado para un ítem del borrador, para poder corregirlo. */
  leerHallazgo: (itemId: string) => Promise<HallazgoGuardado | null>
  /** Resultado del último envío, para confirmarlo en pantalla (TSK-OFF-007). */
  ultimoEnvio: EnvioConfirmado | null
  descartarAvisoEnvio: () => void
  /** Revalida antes de abrir el pad de firma; mantiene la firma fuera si faltan datos. */
  prepararCierre: () => boolean
  enviarInspeccion: (strokes: SignatureStroke[]) => void
  agregarBitacora: (texto: string, tags: string[], faenaId: string) => void
}

/** Hallazgo guardado en el dispositivo, en los términos del panel que lo edita. */
export interface HallazgoGuardado {
  severidad: Severidad
  descripcion: string
  foto: Blob | null
}

/** Lo que se le confirma a la persona después de firmar y enviar. */
export interface EnvioConfirmado {
  formulario: string
  respondidos: number
  total: number
  hallazgos: number
  /** Había señal al enviar: sale ahora. Sin señal: queda guardado y sale solo. */
  conSenal: boolean
}

const StoreCtx = createContext<Ctx | null>(null)

function mapaCola(o: OutboxRow): RegistroCola {
  return {
    id: `${o.entityType}:${o.entityId}`,
    outboxId: o.id as number,
    uuid: o.entityId,
    tipo: o.tipo,
    titulo: o.titulo,
    detalle: o.detalle,
    estado: o.status,
    orden: o.batchOrder,
    tenantId: o.tenantId,
    intentos: o.retries,
  }
}

const SEV_TO_EN: Record<Severidad, 'low' | 'medium' | 'high' | 'critical'> = {
  baja: 'low',
  media: 'medium',
  alta: 'high',
  critica: 'critical',
}

const SEV_TO_ES: Record<'low' | 'medium' | 'high' | 'critical', Severidad> = {
  low: 'baja',
  medium: 'media',
  high: 'alta',
  critical: 'critica',
}

/** Una sesión sin asignaciones no recibe una plantilla de demostración. */
const DEFINICION_VACIA: TemplateDefinition = { sections: [] }

/** Perfil de `/auth/me` (o `/auth/login`) → `Usuario` de la UI + identidad. */
function identidadDeSites(tenantNombre: string, tenantId: string, items: Array<{ id: string; nombre: string; tipo: 'mina' | 'obra' }>): Identidad {
  return {
    tenantId,
    tenantNombre,
    faenas: items.map((s) => ({ id: s.id, nombre: s.nombre, tipo: s.tipo, region: '' })),
  }
}

function usuarioDe(
  perfil: { id: string; full_name: string; email: string; role: string },
  i: Identidad,
  faena: Identidad['faenas'][number] | null,
): Usuario {
  return {
    id: perfil.id,
    nombre: perfil.full_name,
    rol: perfil.role as Rol,
    email: perfil.email,
    tenant: i.tenantNombre,
    tenantId: i.tenantId,
    faena: faena?.nombre ?? '—',
    faenaId: faena?.id ?? '',
  }
}

function mapEntradas(rows: Array<{ id: string; capturedAt: string; authorId: string; entryText: string; tags: string[] }>, autor: string) {
  return rows.map((e) => ({
    id: e.id,
    capturadaEn: e.capturedAt,
    hora: new Date(e.capturedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
    autor,
    texto: e.entryText,
    tags: e.tags,
  }))
}

function plantillaDesdeRevision(
  revision: TemplatePublicadaDto,
  origen: 'servidor' | 'caché',
): PlantillaActual {
  return {
    templateId: revision.template_id,
    revisionId: revision.revision_id,
    nombre: revision.name,
    version: revision.version,
    origen,
    definition: revision.definition,
    estado: 'ok',
    revisionPendiente: null,
  }
}

/** Revisión congelada del borrador en curso; `null` si no hay borrador (FR-028).
 *  Es la que la purga de originales nunca puede borrar (FR-018/019). */
async function revisionActivaId(): Promise<string | null> {
  const draftId = await getDraftInspectionId()
  if (!draftId) return null
  const ins = await getInspection(draftId)
  return ins?.templateRevisionId ?? null
}

export function ProveedorEstado({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [identidad, setIdentidad] = useState<Identidad | null>(null)
  const [hidratando, setHidratando] = useState(true)
  const [debeCambiarClave, setDebeCambiarClave] = useState(false)
  const [sesionExpirada, setSesionExpirada] = useState(false)
  /** TSK-AUTH-011: por qué se cerró la sesión, para explicarlo en el login. */
  const [avisoSalida, setAvisoSalida] = useState<MotivoSalida | null>(null)
  const [conConexion, setConConexion] = useState(() => navigator.onLine)
  // El estado de señal es el de la red real (navigator.onLine); v1 no tiene
  // interruptor manual.
  const online = conConexion
  const [pantalla, setPantalla] = useState<Pantalla>('captura')
  const pantallaRef = useRef(pantalla)
  pantallaRef.current = pantalla
  const [avisoSalir, setAvisoSalir] = useState(false)
  const [cola, setCola] = useState<RegistroCola[]>([])
  const [respuestas, setRespuestas] = useState<Record<string, RespuestaItem>>({})
  const [pendientes, setPendientes] = useState(0)
  const [enviosPendientes, setEnviosPendientes] = useState(0)
  const [fallidos, setFallidos] = useState(0)
  const [entradasBitacora, setEntradasBitacora] = useState<Ctx['entradasBitacora']>([])
  const [recienSincronizado, setRecienSincronizado] = useState<string | null>(null)
  const [sincronizando, setSincronizando] = useState(false)
  const [enviandoInspeccion, setEnviandoInspeccion] = useState(false)
  const envioInspeccionEnCurso = useRef(false)
  const [cuotaAviso, setCuotaAviso] = useState(false)
  const [cuota, setCuota] = useState<Ctx['cuota']>({ usadaPct: null, fotosPendientes: 0 })
  const [plantilla, setPlantilla] = useState<PlantillaActual | null>(null)
  const [formularios, setFormularios] = useState<TemplatePublicadaDto[]>([])
  const [hayBorrador, setHayBorrador] = useState(false)
  const [originales, setOriginales] = useState<Ctx['originales']>({
    cacheados: 0,
    presupuestoBytes: PRESUPUESTO_ORIGINALES_BYTES,
    purgados: 0,
  })
  const [erroresCampo, setErroresCampo] = useState<Record<string, string>>({})
  const [ultimoEnvio, setUltimoEnvio] = useState<EnvioConfirmado | null>(null)
  const [faenaPorElegir, setFaenaPorElegir] = useState(false)

  const refrescar = useCallback(async () => {
    setCola((await listOutbox()).map(mapaCola))
    setPendientes(await contadorPendientes())
    setEnviosPendientes(armarVistaCola(await datosVistaCola()).enviosPendientes)
    setFallidos(await contadorFallidos())
    // FR-017: la cuota se relee en cada refresco (tras capturar o sincronizar).
    // `estimarCuota` no lanza y degrada a null si el navegador no la expone.
    const est = await estimarCuota()
    const fotosPendientes = await contadorFotosPendientes()
    setCuota({ usadaPct: est.usadaPct, fotosPendientes })
    const alta = cuotaEsAlta(est.usadaPct)
    setCuotaAviso(alta)
    // Mientras la cuota esté alta, el worker prioriza las fotos ya sincronizables.
    setPriorizarFotos(alta)
  }, [])

  const sincronizarAhora = useCallback(() => {
    // El modo sin señal debe ser una barrera real: el submit conserva la cola
    // local y no puede iniciar un fetch sólo porque el navegador tenga Wi‑Fi.
    if (!online) return
    void (async () => {
      setSincronizando(true)
      try {
        const r = await sincronizarCola()
        if (r.estado === 'sin_sesion') {
          setSesionExpirada(true)
        } else if (r.estado === 'ok' || r.estado === 'parcial') {
          setSesionExpirada(false)
          const ultimo = r.sincronizados[r.sincronizados.length - 1]
          if (ultimo) setRecienSincronizado(ultimo)
        }
      } finally {
        setSincronizando(false)
        await refrescar()
      }
    })()
  }, [online, refrescar])

/* ── FR-018/027/028 · sincronización de plantillas ─────────────────────────
   *
   * Va en pasos explícitos porque cada uno puede fallar sin arrastrar a los
   * demás: (1) catálogo asignado completo → caché por sesión, (2) descarga de los originales
   * que faltan, (3) purga por presupuesto. La plantilla activa se resuelve DESPUÉS
   * contra el borrador congelado: el delta nunca reencuadra un turno en curso.
   */
  const purgarOriginales = useCallback(
    async (tenantId: string, items: TemplatePublicadaDto[]): Promise<number> => {
      const enCache = await listarOriginalesPlantilla(tenantId)
      const plan = planificarPurga(
        enCache,
        PRESUPUESTO_ORIGINALES_BYTES,
        await revisionActivaId(),
        items.map((i) => i.revision_id),
      )
      await aplicarPurgaOriginales(plan)
      return plan.aBorrar.length
    },
    [],
  )

  /* Descarga los originales que faltan y purga por presupuesto (FR-018). Un
   * 404/403 = "no visible para ti": se descarta sin reintentar. Devuelve
   * cuántas filas se purgaron, para que la captura pueda avisar del truncado. */
  const sincronizarOriginales = useCallback(
    async (
      tenantId: string,
      items: TemplatePublicadaDto[],
      siteId: string | null,
    ): Promise<number> => {
      const enCache = await listarOriginalesPlantilla(tenantId)
      // Tres por pasada: bajar el libro completo de golpe al volver la señal en
      // una faena con muchas plantillas le comería el presupuesto (FR-018). La
      // revisión congelada va primera: es la que se exporta (FR-019/044).
      const pendientes = revisionesParaOriginal(
        items,
        enCache.map((o) => o.revision_id),
        3,
        await revisionActivaId(),
      )
      for (const revisionId of pendientes) {
        try {
          const original = await getPlantillaOriginal(revisionId, siteId)
          await guardarOriginalPlantilla({
            meta: {
              revision_id: revisionId,
              tenant_id: tenantId,
              file_name: original.fileName,
              mime: XLSX_MIME,
              bytes_length: original.bytes.size,
              cached_at: Date.now(),
            },
            bytes: original.bytes,
          })
        } catch (err) {
          // 404/403 = la revisión no está asignada a este rol (FR-009): no es
          // transitorio y no se reintenta — reintentar sería enumerar originales
          // ajenos. Un 401 ya cerró la sesión vía `tc:logout`; cualquier otro
          // fallo (sin señal, caché local llena) corta el lote.
          if (err instanceof ApiError && (err.status === 404 || err.status === 403)) continue
          break
        }
      }
      return purgarOriginales(tenantId, items)
    },
    [purgarOriginales],
  )

  const sincronizarPlantillas = useCallback(
    async (
      ambito: Usuario,
    ): Promise<{ items: TemplatePublicadaDto[]; enRed: boolean; purgados: number }> => {
      const { tenantId, faenaId: siteId } = ambito
      const { items, enRed } = await actualizarCatalogo(ambito)

      const purgados = await sincronizarOriginales(tenantId, items, siteId ?? null)
      return { items, enRed, purgados }
    },
    [sincronizarOriginales],
  )

  /* TSK-FORM-001 / FR-036: resuelve la plantilla activa contra el borrador
   * congelado. Devuelve un estado explícito 'no-disponible' si la revisión del
   * borrador no está: la UI lo dice en vez de reencuadrar (FR-028). */
  const elegirActiva = useCallback(
    async (
      items: TemplatePublicadaDto[],
      enRed: boolean,
      revisionPreferida?: string | null,
    ): Promise<PlantillaActual> => {
      const draftId = await getDraftInspectionId()
      let marco: MarcoBorrador | null = null
      if (draftId) {
        const ins = await getInspection(draftId)
        if (ins) {
          marco = {
            templateId: ins.templateId,
            templateVersion: ins.templateVersion,
            templateRevisionId: ins.templateRevisionId ?? null,
          }
        }
      }
      const r = elegirPlantillaActiva(items, marco, revisionPreferida)
      let p: PlantillaActual
      if (r.estado === 'ok') {
        p = plantillaDesdeRevision(r.revision, enRed ? 'servidor' : 'caché')
      } else if (r.estado === 'no-disponible') {
        // Sin definición que renderizar: la UI explica el bloqueo en vez de
        // mostrar otra plantilla (reencuadrar invalidaría lo ya respondido).
        p = {
          templateId: r.marco.templateId,
          revisionId: null,
          nombre: 'Plantilla no disponible',
          version: r.marco.templateVersion,
          origen: 'caché',
          definition: DEFINICION_VACIA,
          estado: 'no-disponible',
          revisionPendiente: r.marco.templateRevisionId,
        }
      } else {
        p = {
          templateId: '',
          revisionId: null,
          nombre: 'Sin formularios asignados',
          version: null,
          origen: 'caché',
          definition: DEFINICION_VACIA,
          estado: 'sin-plantillas',
          revisionPendiente: null,
        }
      }
      setPlantilla(p)
      setHayBorrador(marco !== null)
      setErroresCampo({})
      return p
    },
    [],
  )

  const cargarPlantilla = useCallback(
    async (ambito: Usuario): Promise<PlantillaActual> => {
      const { tenantId, faenaId: siteId } = ambito
      let items: TemplatePublicadaDto[] = []
      let enRed = false
      let purgados = 0
      try {
        const r = await sincronizarPlantillas(ambito)
        items = r.items
        enRed = r.enRed
        purgados = r.purgados
      } catch {
        /* Sólo se recupera el catálogo confirmado para esta sesión y faena. */
        items = await leerCatalogo(ambito)
      }
      setOriginales({
        cacheados: (await listarOriginalesPlantilla(tenantId)).length,
        presupuestoBytes: PRESUPUESTO_ORIGINALES_BYTES,
        purgados,
      })
      setFormularios(items)
      const seleccionada = siteId ? await leerPlantillaSeleccionada(tenantId, siteId) : null
      return elegirActiva(items, enRed, seleccionada)
    },
    [sincronizarPlantillas, elegirActiva],
  )

  /* Al volver la señal hay que traer el delta igual que al arrancar (FR-027):
   * el evento `online` del navegador dispara esta misma ruta, que
   * reutiliza el borrador congelado sin tocar su marco (FR-028). */
  const recargarPlantillas = useCallback(() => {
    if (!usuario) return
    void cargarPlantilla(usuario)
  }, [usuario, cargarPlantilla])

  /* Salida explícita del bloqueo FR-028. El borrador congelado cuya revisión no
   * llega (p. ej. una plantilla desasignada) no se puede resolver nunca;
   * descartarlo es una decisión del usuario y la UI la pide confirmada. */
  const descartarBorradorYRecargar = useCallback(async () => {
    if (!usuario) return
    await descartarBorrador()
    setRespuestas({})
    setHayBorrador(false)
    await refrescar()
    await cargarPlantilla(usuario)
  }, [usuario, refrescar, cargarPlantilla])

  const seleccionarFormulario = useCallback(
    async (revisionId: string): Promise<{ ok: boolean; error?: string }> => {
      if (!usuario || !usuario.faenaId) return { ok: false, error: 'No se encontró una faena para esta sesión.' }
      const revision = formularios.find((item) => item.revision_id === revisionId)
      if (!revision) return { ok: false, error: 'El formulario ya no está asignado a tu faena.' }

      const draftId = await getDraftInspectionId()
      const borrador = draftId ? await getInspection(draftId) : undefined
      if (borrador && borrador.templateRevisionId !== revisionId) {
        return { ok: false, error: 'Tienes un borrador en curso. Continúalo o descártalo antes de cambiar.' }
      }

      await guardarPlantillaSeleccionada(usuario.tenantId, usuario.faenaId, revisionId)
      setPlantilla(plantillaDesdeRevision(revision, 'caché'))
      setErroresCampo({})
      setUltimoEnvio(null)
      if (!borrador) setRespuestas({})
      setHayBorrador(!!borrador)
      return { ok: true }
    },
    [usuario, formularios],
  )


  /* TSK-OFF-008: navegar deja la pantalla anterior en el historial para que el
   * botón Atrás del teléfono vuelva a ella. */
  const ir = useCallback((p: Pantalla, opciones?: { reemplazar?: boolean }) => {
    if (p === pantallaRef.current) return
    anotarPantalla(window.history, p, opciones?.reemplazar ? 'reemplazar' : 'agregar')
    setPantalla(p)
  }, [])

  const haySesion = usuario !== null
  useEffect(() => {
    if (!haySesion) return
    let rearmar: number | undefined
    const alRetroceder = () => {
      window.clearTimeout(rearmar)
      const r = resolverRetroceso(window.history, window.location.hash, pantallaRef.current)
      if (r.tipo === 'pantalla') {
        setAvisoSalir(false)
        setPantalla(r.pantalla)
      } else if (r.tipo === 'salida') {
        /* Se llegó a la entrada de guarda: un Atrás más cierra la app. Si la
         * persona no insiste, se vuelve a dejar la pantalla encima de la guarda
         * para que el próximo Atrás avise de nuevo en vez de salir sin más. */
        setAvisoSalir(true)
        rearmar = window.setTimeout(() => {
          anotarPantalla(window.history, pantallaRef.current, 'agregar')
          setAvisoSalir(false)
        }, 2500)
      } else {
        setAvisoSalir(false)
      }
    }
    window.addEventListener('popstate', alRetroceder)
    return () => {
      window.clearTimeout(rearmar)
      window.removeEventListener('popstate', alRetroceder)
    }
  }, [haySesion])

  /* TSK-OFF-010 (FR-034): la persona elige en qué faena está inspeccionando.
   * Cambia los formularios disponibles (la asignación es por faena) y la faena
   * a la que quedará asociada la próxima inspección. */
  const cambiarFaena = useCallback(
    async (faenaId: string): Promise<{ ok: boolean; error?: string }> => {
      if (!usuario || !identidad) return { ok: false, error: 'No hay una sesión activa.' }
      const motivo = motivoParaNoCambiar(identidad.faenas, faenaId, (await getDraftInspectionId()) !== null)
      if (motivo) return { ok: false, error: motivo }
      const faena = identidad.faenas.find((f) => f.id === faenaId)
      if (!faena) return { ok: false, error: 'Esa faena ya no existe en tu empresa.' }
      await guardarFaenaSeleccionada(usuario.tenantId, usuario.id, faena.id)
      const u: Usuario = { ...usuario, faena: faena.nombre, faenaId: faena.id }
      setUsuario(u)
      setFaenaPorElegir(false)
      setUltimoEnvio(null)
      setRespuestas({})
      await cargarPlantilla(u)
      return { ok: true }
    },
    [usuario, identidad, cargarPlantilla],
  )

  const descartarRegistroCola = useCallback(async (outboxId: number) => {
    if (!usuario) return
    await descartarRegistroColaDb(outboxId, usuario.tenantId)
    const entradas = await listLogEntries(null)
    setEntradasBitacora(mapEntradas(entradas, usuario.nombre))
    await refrescar()
  }, [usuario, refrescar])

  const arrancarSesión = useCallback(
    async (perfil: { id: string; tenant_id: string | null; email: string; role: string; full_name: string }, i: Identidad) => {
      // TSK-AUTH-010: antes de leer cola o borrador, la sesión fija su dueño.
      await setDueñoCola({ userId: perfil.id, tenantId: perfil.tenant_id ?? '' })
      /* TSK-OFF-010: la faena de la sesión es la de la inspección en curso, o la
       * última elegida en este equipo, o la primera de la empresa (y entonces,
       * si hay varias, se pide elegir). */
      const borradorPrevioId = await getDraftInspectionId()
      const borradorPrevio = borradorPrevioId ? await getInspection(borradorPrevioId) : undefined
      const inicial = elegirFaenaInicial(
        i.faenas,
        await leerFaenaSeleccionada(i.tenantId, perfil.id),
        borradorPrevio?.siteId ?? null,
      )
      const u = usuarioDe(perfil, i, inicial.faena)
      setFaenaPorElegir(inicial.porElegir && (u.rol === 'field_worker' || u.rol === 'supervisor'))
      setSesionExpirada(false)
      // TSK-FORM-004: borrares previos con la foto en `valuePhoto` → ATTACHMENT.
      await migrarFotosLegacy()
      // FR-038: la plantilla activa se hidrata ANTES de tocar el borrador, así
      // el borrador queda ligado al marco de la plantilla vigente.
      const activa = await cargarPlantilla(u)
      if (u.faenaId && (u.rol === 'field_worker' || u.rol === 'supervisor')) {
        // No se crea un borrador sólo por iniciar sesión: así el trabajador
        // puede elegir un formulario antes de que una revisión quede congelada.
        const draftId = await getDraftInspectionId()
        const ins = draftId ? await getInspection(draftId) : undefined
        const draftRespuestas: Record<string, RespuestaItem> = {}
        if (ins) {
          /* Un ítem "tiene hallazgo" sólo si el hallazgo existe. Antes bastaba
           * con que la respuesta fuera NOK: tras recargar, un NOK sin hallazgo
           * pasaba la validación de cierre como si lo tuviera. */
          const conHallazgo = new Map(
            (await hallazgosDeInspeccion(ins.id))
              .filter((h) => h.responseId !== null)
              .map((h) => [h.responseId as string, h.id]),
          )
          for (const item of itemsDe(activa.definition)) {
            const r = await respuestaDelItem(ins.id, item.id)
            if (!r) continue
            const campo = valorDesdeColumnas(item, r)
            if (
              campo === null &&
              !r.valueOk &&
              !r.valueText &&
              r.valueNumber === null &&
              (r.valueJson ?? null) === null
            )
              continue
            draftRespuestas[item.id] = {
              itemId: item.id,
              campo,
              valor: esOkNokNa(campo) ? campo : null,
              hallazgoId: conHallazgo.get(r.id),
            }
          }
        }
        setRespuestas(draftRespuestas)
        setHayBorrador(!!ins)
      }
      // La pantalla destino se decide ANTES de publicar el usuario: si no, la
      // pantalla por defecto ('captura') se pinta un instante tras el login.
      const destino: Pantalla =
        u.rol === 'field_worker'
          ? (await getDraftInspectionId())
            ? 'captura'
            : 'formularios'
          : u.rol === 'platform_admin'
            ? 'plataforma'
            : 'dashboard'
      // TSK-OFF-008: la primera pantalla de la sesión abre el historial.
      iniciarHistorial(window.history, destino)
      setPantalla(destino)
      setUsuario(u)
      setIdentidad(i)
      const entradas = await listLogEntries(null)
      setEntradasBitacora(mapEntradas(entradas, u.nombre))
      setHidratando(false)
      await refrescar()
      /* TSK-OFF-010: los formularios de las OTRAS faenas se dejan en el equipo
       * mientras hay señal, para poder cambiar de faena sin conexión. No bloquea
       * el arranque y, si falla, cada faena conserva su último catálogo. */
      if (u.rol === 'field_worker' || u.rol === 'supervisor') {
        void (async () => {
          for (const f of i.faenas.filter((x) => x.id !== u.faenaId).slice(0, 12)) {
            await actualizarCatalogo({ ...u, faenaId: f.id })
          }
        })()
      }
      // FR-004: el efecto de transporte drena al cambiar usuario/conexión.
      // La hidratación no debe depender de `online`: restaurar la sesión en
      // cada evento de red puede cerrar una sesión válida durante una carrera.
    },
    [refrescar, cargarPlantilla],
  )

  /** Perfil + identidad del tenant (faenas) → caché offline → sesión activa. */
  const completarIngreso = useCallback(
    async (p: { id: string; tenant_id: string | null; email: string; role: string; full_name: string }) => {
      const sites = p.role === 'platform_admin' ? null : await getSites()
      const ident = sites
        ? identidadDeSites(sites.tenant.nombre, sites.tenant.id, sites.items)
        : { tenantId: '', tenantNombre: 'Plataforma', faenas: [] }
      const perfil = { id: p.id, tenant_id: p.tenant_id, email: p.email, role: p.role, full_name: p.full_name }
      await guardarSesionCaché({ perfil, identidad: ident, ts: new Date().toISOString() })
      await arrancarSesión(perfil, ident)
    },
    [arrancarSesión],
  )

  /* Las funciones de sesión cambian de identidad cuando cambian la red o el
   * usuario; el arranque las lee por ref para correr UNA vez al montar. Si el
   * efecto dependiera de ellas, cada cambio volvería a hidratar la sesión y
   * devolvería al trabajador a "Formularios" en medio de una captura. */
  const arrancarRef = useRef(arrancarSesión)
  arrancarRef.current = arrancarSesión
  const completarRef = useRef(completarIngreso)
  completarRef.current = completarIngreso

  /* FR-006 + TSK-AUTH-010: al arrancar se restaura la sesión. El token vive en
   * memoria, así que se pide uno nuevo con la cookie de sesión (refresh). Sin
   * red se entra con la identidad cacheada: la captura offline sigue y la cola
   * espera. Sin sesión válida (o primera vez) se muestra el login. */
  useEffect(() => {
    let vivo = true
    void (async () => {
      await getDeviceId() // persiste el UUIDv7 del dispositivo (FR-015) si falta
      const caché = await sesionCaché()
      try {
        if (!getToken()) await refrescarToken()
        const p = await me()
        if (!vivo) return
        if (p.must_change_password) {
          setDebeCambiarClave(true)
          setHidratando(false)
          return
        }
        await completarRef.current(p)
      } catch (err) {
        if (err instanceof ApiError && err.status === 0 && caché) {
          // Sin red: sesión desde la caché (las escrituras offline siguen).
          if (vivo) await arrancarRef.current(caché.perfil, caché.identidad)
          return
        }
        if (err instanceof ApiError && err.status === 403) {
          if (vivo) {
            setDebeCambiarClave(true)
            setHidratando(false)
          }
          return
        }
        if (err instanceof ApiError && err.codigo === 'session_replaced' && vivo) {
          setAvisoSalida('session_replaced')
        }
        clearToken()
        await borrarSesionCaché()
        if (vivo) setHidratando(false)
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  useEffect(() => {
    document.title = `Terreno Conectado · ${enviosPendientes} por enviar`
  }, [enviosPendientes])

  const loginInApp = useCallback(
    async (email: string, password: string, tenant?: string) => {
      const r = await login(email, password, tenant)
      setToken(r.access_token)
      setAvisoSalida(null)
      if (r.user.must_change_password) {
        // Clave temporal: nada más se carga hasta que la cambie.
        setDebeCambiarClave(true)
        return
      }
      await completarIngreso(r.user)
    },
    [completarIngreso],
  )

  /** TSK-AUTH-010: cambio de clave (obligatorio o desde "Mi cuenta"). */
  const cambiarClaveEnApp = useCallback(
    async (actual: string, nueva: string) => {
      const r = await cambiarClave(actual, nueva)
      setToken(r.access_token)
      if (debeCambiarClave) {
        setDebeCambiarClave(false)
        await completarIngreso(r.user)
      }
    },
    [debeCambiarClave, completarIngreso],
  )

  /** Cierre local (sin tocar la cola): borra token, caché de sesión y vista. */
  const cerrarLocal = useCallback(() => {
    clearToken()
    void borrarSesionCaché()
    void setDueñoCola(null)
    setUsuario(null)
    setIdentidad(null)
    setRespuestas({})
    setErroresCampo({})
    setEntradasBitacora([])
    setDebeCambiarClave(false)
    setUltimoEnvio(null)
    setAvisoSalir(false)
    setFaenaPorElegir(false)
    setPantalla('captura')
  }, [])

  /** Cierre pedido por el usuario: además revoca la sesión en el servidor. */
  const salir = useCallback(() => {
    void logoutServidor()
    setSesionExpirada(false)
    cerrarLocal()
  }, [cerrarLocal])

  /* Un 401 sin refresh posible cierra la sesión local; la cola queda intacta y
   * se envía cuando el mismo usuario vuelva a ingresar. */
  useEffect(() => {
    const logout = (e: Event) => {
      const motivo = (e as CustomEvent<MotivoSalida | undefined>).detail
      setAvisoSalida(motivo ?? 'expirada')
      cerrarLocal()
    }
    const cambio = () => setDebeCambiarClave(true)
    window.addEventListener(EVENTO_LOGOUT, logout)
    window.addEventListener(EVENTO_CAMBIO_CLAVE, cambio)
    return () => {
      window.removeEventListener(EVENTO_LOGOUT, logout)
      window.removeEventListener(EVENTO_CAMBIO_CLAVE, cambio)
    }
  }, [cerrarLocal])


  /* El estado de señal gobierna toda la capa de transporte. Cuando vuelve,
   * recién entonces se drena la cola y se actualiza el catálogo offline. */
  useEffect(() => {
    setSincronizacionPermitida(online)
    if (!online) {
      void refrescar()
      return
    }
    void sincronizarAhora()
    void recargarPlantillas()
  }, [online, refrescar, sincronizarAhora, recargarPlantillas])

  /* FR-016: escuchar la red una sola vez. No depender de sincronizarAhora:
   * cambia con `online` y antes reinicializaba el switch a navigator.onLine
   * en cada clic. La preferencia manual persiste y no la pisa un reconnect. */
  useEffect(() => {
    const conectar = () => setConConexion(true)
    const desconectar = () => {
      setSincronizacionPermitida(false)
      setConConexion(false)
    }
    window.addEventListener('online', conectar)
    window.addEventListener('offline', desconectar)
    setConConexion(navigator.onLine)
    return () => {
      window.removeEventListener('online', conectar)
      window.removeEventListener('offline', desconectar)
    }
  }, [])

  const resolverDraft = useCallback(
    async (u: Usuario) => {
      if (!plantilla || plantilla.estado !== 'ok') {
        throw new Error('No hay un formulario asignado disponible para iniciar una inspección')
      }
      const borrador = await ensureDraftInspection({
        tenantId: u.tenantId,
        siteId: u.faenaId,
        executedBy: u.id,
        templateName: plantilla?.nombre ?? 'Seguridad en rajo',
        siteName: u.faena,
        totalItems: plantilla ? itemsDe(plantilla.definition).length : 0,
        templateId: plantilla?.templateId,
        templateVersion: plantilla?.version ?? undefined,
        templateRevisionId: plantilla?.revisionId ?? null,
        requiresSupervisorSignature: plantilla?.definition.closing?.require_supervisor_signature ?? false,
      })
      setHayBorrador(true)
      return borrador
    },
    [plantilla],
  )

  /* TSK-FORM-001 / FR-036: única vía de escritura de la captura. Valida el
   * valor contra `props` (FR-039: si falla, no se escribe ni se encola),
   * limpia/registra el error por ítem y persiste en las columnas naturales
   * (híbridas: `value_json` para select/date/time). La foto se comprime
   * (FR-012) y su binario vive en un ATTACHMENT `owner_type='response'`
   * (FR-037, TSK-FORM-004); el outbox la toma al enviar la inspección. */
  const responderCampo = useCallback(
    (itemId: string, crudo: CampoValor, adjunto?: { foto: File }) => {
      if (!usuario || !plantilla) return
      const item = itemsDe(plantilla.definition).find((i) => i.id === itemId)
      if (!item) return
      const v = validateValorCampo(item, crudo)
      if (!v.ok) {
        setErroresCampo((e) => ({ ...e, [itemId]: v.error }))
        return
      }
      setErroresCampo((e) => {
        if (!(itemId in e)) return e
        const resto = { ...e }
        delete resto[itemId]
        return resto
      })
      const campo = v.valor
      // Empezar la inspección siguiente retira la confirmación de la anterior.
      setUltimoEnvio(null)
      setRespuestas((r) => ({
        ...r,
        [itemId]: { ...r[itemId], itemId, campo, valor: esOkNokNa(campo) ? campo : null },
      }))
      void (async () => {
        const draft = await resolverDraft(usuario)
        const cols = columnasDesdeValor(item, campo)
        if (item.response_type === 'photo') {
          // Invariante: marcador 'capturada' ⇔ adjunto local existe. Si la
          // compresión falla, el campo vuelve a no contestado (UI incluida).
          let foto: { blob: Blob; ancho: number; alto: number; mime: string } | null = null
          let capturada = campo !== null
          if (capturada && adjunto?.foto) {
            try {
              const c = await comprimirImagen(adjunto.foto)
              foto = { blob: c.blob, ancho: c.ancho, alto: c.alto, mime: c.blob.type || 'image/jpeg' }
            } catch {
              capturada = false
            }
          }
          if (!capturada) {
            setRespuestas((r) => ({
              ...r,
              [itemId]: { ...r[itemId], itemId, campo: null, valor: null },
            }))
            const id = await upsertResponse({
              inspectionId: draft.id,
              templateItemId: itemId,
              tenantId: usuario.tenantId,
              valueOk: null,
              valueText: null,
              valueNumber: null,
              valueJson: null,
            })
            await quitarFotoRespuesta(id)
          } else {
            const id = await upsertResponse({
              inspectionId: draft.id,
              templateItemId: itemId,
              tenantId: usuario.tenantId,
              ...cols, // valueText = marcador 'capturada'
            })
            // Sin adjunto nuevo se conserva el que ya existía (recaptura nula).
            if (foto) await guardarFotoRespuesta({ responseId: id, tenantId: usuario.tenantId, foto })
          }
        } else {
          await upsertResponse({
            inspectionId: draft.id,
            templateItemId: itemId,
            tenantId: usuario.tenantId,
            ...cols,
          })
        }
        await refrescar()
      })()
    },
    [usuario, plantilla, refrescar, resolverDraft],
  )

  const guardarHallazgo = useCallback(
    (itemId: string, sev: Severidad, descripcion: string, foto: File | null) => {
      if (!usuario) return
      void (async () => {
        const draft = await resolverDraft(usuario)
        /* El hallazgo cuelga de la respuesta NOK. Si su escritura aún no
         * terminó, se asegura aquí: sin `responseId` no habría cómo encontrar
         * este hallazgo después para corregirlo. */
        const responseId =
          (await respuestaDelItem(draft.id, itemId))?.id ??
          (await upsertResponse({
            inspectionId: draft.id,
            templateItemId: itemId,
            tenantId: usuario.tenantId,
            valueOk: 'nok',
          }))
        // FR-012: la foto se comprime ANTES de encolarse (canvas ≤1280 px, q0.7).
        // Si la compresión falla, el hallazgo se guarda igual sin foto: la
        // captura nunca depende de la evidencia fotográfica.
        let fotoComprimida: { blob: Blob; ancho: number; alto: number; mime: string } | null = null
        if (foto) {
          try {
            const comp = await comprimirImagen(foto)
            fotoComprimida = {
              blob: comp.blob,
              ancho: comp.ancho,
              alto: comp.alto,
              mime: comp.blob.type || 'image/jpeg',
            }
          } catch {
            fotoComprimida = null
          }
        }
        const { id } = await guardarHallazgoDb({
          inspectionId: draft.id,
          responseId,
          tenantId: usuario.tenantId,
          severity: SEV_TO_EN[sev],
          description: descripcion.trim() || 'Sin descripción',
          detalle: detalleDeHallazgo(descripcion),
          foto: fotoComprimida,
        })
        setRespuestas((r) => ({
          ...r,
          [itemId]: {
            ...r[itemId],
            itemId,
            campo: 'nok',
            valor: 'nok',
            hallazgoId: id,
          },
        }))
        setErroresCampo((e) => {
          if (!(itemId in e)) return e
          const resto = { ...e }
          delete resto[itemId]
          return resto
        })
        await refrescar()
      })()
    },
    [usuario, refrescar, resolverDraft],
  )

  const leerFotoItem = useCallback(async (itemId: string): Promise<Blob | null> => {
    const draftId = await getDraftInspectionId()
    return draftId ? fotoDeItem(draftId, itemId) : null
  }, [])

  const leerHallazgo = useCallback(async (itemId: string): Promise<HallazgoGuardado | null> => {
    const draftId = await getDraftInspectionId()
    if (!draftId) return null
    const respuesta = await respuestaDelItem(draftId, itemId)
    if (!respuesta) return null
    const guardado = await hallazgoDeRespuesta(draftId, respuesta.id)
    if (!guardado) return null
    return {
      severidad: SEV_TO_ES[guardado.hallazgo.severity],
      descripcion: guardado.hallazgo.description === 'Sin descripción' ? '' : guardado.hallazgo.description,
      foto: guardado.foto?.blob ?? null,
    }
  }, [])

  const prepararCierre = useCallback((): boolean => {
    if (!usuario || !plantilla || plantilla.estado !== 'ok' || envioInspeccionEnCurso.current) return false
    const errores = erroresDeEnvio(plantilla.definition, respuestas, erroresCampo)
    if (Object.keys(errores).length > 0) {
      setErroresCampo(errores)
      return false
    }
    setErroresCampo({})
    return true
  }, [usuario, plantilla, respuestas, erroresCampo])

  const enviarInspeccion = useCallback((strokes: SignatureStroke[]) => {
    if (!prepararCierre() || envioInspeccionEnCurso.current) return
    envioInspeccionEnCurso.current = true
    setEnviandoInspeccion(true)
    void (async () => {
      try {
        const draftId = await getDraftInspectionId()
        if (!draftId) return
        // Enmienda 004 (TSK-DOM-006): la ubicación ya no se registra. Se pedía
        // en cada envío sin explicar para qué y ningún reporte la usaba.
        const hallazgos = (await hallazgosDeInspeccion(draftId)).length
        const enviada = await submitInspection(draftId, { strokes, declarationVersion: 'v1' }, null)
        if (enviada && plantilla) {
          const items = itemsDe(plantilla.definition)
          setUltimoEnvio({
            formulario: plantilla.nombre,
            respondidos: items.filter((i) => contestado(respuestas[i.id]?.campo)).length,
            total: items.length,
            hallazgos,
            conSenal: online,
          })
        }
        setRespuestas({})
        setHayBorrador(false)
        await refrescar()
        // FR-004: si hay señal la cola se drena; sin señal `sincronizarAhora`
        // no inicia ninguna conexión y el envío queda guardado.
        void sincronizarAhora()
      } finally {
        envioInspeccionEnCurso.current = false
        setEnviandoInspeccion(false)
      }
    })()
  }, [prepararCierre, refrescar, sincronizarAhora, plantilla, respuestas, online])

  const descartarAvisoEnvio = useCallback(() => setUltimoEnvio(null), [])

  const agregarBitacora = useCallback(
    (texto: string, tags: string[], faenaId: string) => {
      if (!usuario) return
      void (async () => {
        await addLogEntry({
          siteId: faenaId,
          authorId: usuario.id,
          tenantId: usuario.tenantId,
          entryText: texto,
          tags,
          shiftDate: new Date().toISOString().slice(0, 10),
          detalle: `${identidad?.faenas.find((f) => f.id === faenaId)?.nombre ?? '—'} · ${tags.join(' · ')}`,
        })
        const entradas = await listLogEntries(null)
        setEntradasBitacora(mapEntradas(entradas, usuario.nombre))
        await refrescar()
      })()
    },
    [usuario, identidad, refrescar],
  )

  const valor: Ctx = {
    usuario,
    identidad,
    online,
    pantalla,
    hidratando,
    cola,
    recienSincronizado,
    cuotaAviso,
    cuota,
    respuestas,
    entradasBitacora,
    plantilla,
    formularios,
    hayBorrador,
    originales,
    erroresCampo,
    loginInApp,
    debeCambiarClave,
    cambiarClaveEnApp,
    sesionExpirada,
    avisoSalida,
    salir,
    ir,
    avisoSalir,
    sincronizarAhora,
    sincronizando,
    enviandoInspeccion,
    descartarBorradorYRecargar,
    seleccionarFormulario,
    faenaPorElegir,
    cambiarFaena,
    descartarRegistroCola,
    pendientes,
    enviosPendientes,
    fallidos,
    enCola: cola,
    responderCampo,
    guardarHallazgo,
    leerHallazgo,
    leerFotoItem,
    ultimoEnvio,
    descartarAvisoEnvio,
    prepararCierre,
    enviarInspeccion,
    agregarBitacora,
  }

  return <StoreCtx.Provider value={valor}>{children}</StoreCtx.Provider>
}

export function useEstado() {
  const c = useContext(StoreCtx)
  if (!c) throw new Error('useEstado debe usarse dentro de <ProveedorEstado>')
  return c
}
