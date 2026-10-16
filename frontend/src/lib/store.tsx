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
 * `online` sigue siendo el toggle del mockup: el disparo real por el evento
 * `online` del navegador llega con el worker de cola (FR-016, TSK-WS-008).
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
import { COLA_INICIAL, DEFINICION_DEMO } from './seed'
import type { Identidad, RegistroCola, Rol, Severidad, Usuario } from './types'
import {
  addFinding,
  addLogEntry,
  aplicarPurgaOriginales,
  borrarSesionCaché,
  contadorFallidos,
  contadorFotosPendientes,
  contadorPendientes,
  descartarBorrador,
  ensureDraftInspection,
  getDeviceId,
  getDraftInspectionId,
  getInspection,
  getTemplateId,
  guardarFotoRespuesta,
  guardarOriginalPlantilla,
  guardarPlantillaSeleccionada,
  guardarSesionCaché,
  leerPlantillaSeleccionada,
  limpiarDatosLocalesPrueba,
  listarOriginalesPlantilla,
  listLogEntries,
  listOutbox,
  migrarFotosLegacy,
  quitarFotoRespuesta,
  respuestaDelItem,
  seedDemoDataIfNeeded,
  sesionCaché,
  submitInspection,
  upsertResponse,
  type OutboxRow,
} from './db'
import {
  ApiError,
  clearToken,
  EVENTO_LOGOUT,
  getPlantillaOriginal,
  getSites,
  getToken,
  login,
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
  type TemplateDefinition,
  type TemplatePublicadaDto,
} from '@terreno/shared'
import { columnasDesdeValor, esOkNokNa, itemsDe, valorDesdeColumnas } from './valores'

export type Pantalla =
  | 'formularios'
  | 'captura'
  | 'bitacora'
  | 'cola'
  | 'dashboard'
  | 'conflictos'
  | 'importar'
  | 'plantillas'

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
  origen: 'servidor' | 'caché' | 'demo'
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
  entradasBitacora: Array<{ id: string; hora: string; autor: string; texto: string; tags: string[]; geo: string }>

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

  loginInApp: (email: string, password: string) => Promise<void>
  salir: () => void
  ir: (p: Pantalla) => void
  setOnline: (v: boolean) => void
  toggleOnline: () => void
  sincronizarAhora: () => void
  sincronizando: boolean
  enviandoInspeccion: boolean
  /** Descarta el borrador congelado que no se puede resolver (FR-028).
   *  Acción explícita del usuario, nunca automática: reencuadrar por la
   *  espalda invalidaría lo ya respondido. */
  descartarBorradorYRecargar: () => Promise<void>
  seleccionarFormulario: (revisionId: string) => Promise<{ ok: boolean; error?: string }>
  limpiarDatosPrueba: () => Promise<void>

  pendientes: number
  fallidos: number
  enCola: RegistroCola[]
  /** Única vía de escritura de la captura: valida contra `props` (FR-039)
   *  y persiste el valor en las columnas naturales del borrador. */
  responderCampo: (itemId: string, valor: CampoValor, adjunto?: { foto: File }) => void
  crearHallazgo: (itemId: string, sev: Severidad, descripcion: string, foto: File | null) => void
  enviarInspeccion: () => void
  agregarBitacora: (texto: string, tags: string[], faenaId: string) => void
}

const StoreCtx = createContext<Ctx | null>(null)

function mapaCola(o: OutboxRow): RegistroCola {
  return {
    id: `${o.entityType}:${o.entityId}`,
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

/** Perfil de `/auth/me` (o `/auth/login`) → `Usuario` de la UI + identidad. */
function identidadDeSites(tenantNombre: string, tenantId: string, items: Array<{ id: string; nombre: string; tipo: 'mina' | 'obra' }>): Identidad {
  return {
    tenantId,
    tenantNombre,
    faenas: items.map((s) => ({ id: s.id, nombre: s.nombre, tipo: s.tipo, region: '' })),
  }
}

function usuarioDe(perfil: { id: string; full_name: string; email: string; role: string }, i: Identidad): Usuario {
  const faena = i.faenas[0]
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
    hora: new Date(e.capturedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
    autor,
    texto: e.entryText,
    tags: e.tags,
    geo: 'guardada en el dispositivo',
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
  const [online, setOnline] = useState(false)
  const [pantalla, setPantalla] = useState<Pantalla>('captura')
  const [cola, setCola] = useState<RegistroCola[]>([])
  const [respuestas, setRespuestas] = useState<Record<string, RespuestaItem>>({})
  const [pendientes, setPendientes] = useState(0)
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

  const refrescar = useCallback(async () => {
    setCola((await listOutbox()).map(mapaCola))
    setPendientes(await contadorPendientes())
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
        if (r.estado === 'ok' || r.estado === 'parcial') {
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
          definition: DEFINICION_DEMO,
          estado: 'no-disponible',
          revisionPendiente: r.marco.templateRevisionId,
        }
      } else {
        p = {
          templateId: await getTemplateId(),
          revisionId: null,
          nombre: 'Seguridad en rajo',
          version: null,
          origen: 'demo',
          definition: DEFINICION_DEMO,
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
   * el evento `online` y el toggle del mockup disparan esta misma ruta, que
   * reutiliza el borrador congelado sin tocar su marco (FR-028). */
  const recargarPlantillas = useCallback(() => {
    if (!usuario) return
    void cargarPlantilla(usuario)
  }, [usuario, cargarPlantilla])

  /* Salida explícita del bloqueo FR-028. El borrador congelado cuya revisión no
   * llega (marco demo, o plantilla desasignada) no se puede resolver nunca;
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
        return { ok: false, error: 'Tenés un borrador en curso. Continuálo o descartalo antes de cambiar.' }
      }

      await guardarPlantillaSeleccionada(usuario.tenantId, usuario.faenaId, revisionId)
      setPlantilla(plantillaDesdeRevision(revision, 'caché'))
      setErroresCampo({})
      if (!borrador) setRespuestas({})
      setHayBorrador(!!borrador)
      return { ok: true }
    },
    [usuario, formularios],
  )

  const limpiarDatosPrueba = useCallback(async () => {
    if (!usuario) return
    await limpiarDatosLocalesPrueba(usuario.tenantId)
    setRespuestas({})
    setErroresCampo({})
    setHayBorrador(false)
    setEntradasBitacora([])
    await refrescar()
    await cargarPlantilla(usuario)
  }, [usuario, refrescar, cargarPlantilla])

  const arrancarSesión = useCallback(
    async (perfil: { id: string; tenant_id: string | null; email: string; role: string; full_name: string }, i: Identidad) => {
      const u = usuarioDe(perfil, i)
      await seedDemoDataIfNeeded(COLA_INICIAL, i, u)
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
              hallazgoId: r.valueOk === 'nok' ? r.id : undefined,
            }
          }
        }
        setRespuestas(draftRespuestas)
        setHayBorrador(!!ins)
      }
      setUsuario(u)
      setIdentidad(i)
      setPantalla(u.rol === 'field_worker' ? (await getDraftInspectionId() ? 'captura' : 'formularios') : 'dashboard')
      const entradas = await listLogEntries(null)
      setEntradasBitacora(mapEntradas(entradas, u.nombre))
      setHidratando(false)
      await refrescar()
      // FR-004: al entrar se intenta drenar la cola pendiente.
      void sincronizarAhora()
    },
    [refrescar, sincronizarAhora, cargarPlantilla],
  )

  /* FR-006: al arrancar se restaura la sesión. Con token se refresca el perfil
   * y la identidad contra el backend; sin red se usa la caché de Dexie (la
   * captura offline sigue funcionando). Un 401/5xx (o ausencia de token)
   * devuelve al login. */
  useEffect(() => {
    let vivo = true
    void (async () => {
      await getDeviceId() // persiste el UUIDv7 del dispositivo (FR-015) si falta
      const caché = await sesionCaché()
      let perfil: { id: string; tenant_id: string | null; email: string; role: string; full_name: string } | undefined
      let ident: Identidad | undefined
      try {
        if (getToken()) {
          const p = await me()
          const sites = p.role === 'platform_admin' ? null : await getSites()
          ident = sites
            ? identidadDeSites(sites.tenant.nombre, sites.tenant.id, sites.items)
            : { tenantId: '', tenantNombre: 'Todos los tenants', faenas: [] }
          await guardarSesionCaché({
            perfil: { id: p.id, tenant_id: p.tenant_id, email: p.email, role: p.role, full_name: p.full_name },
            identidad: ident,
            ts: new Date().toISOString(),
          })
          perfil = p
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 0 && caché) {
          // Sin red: sesión visual desde la caché (las escrituras offline siguen).
          perfil = caché.perfil
          ident = caché.identidad
        } else {
          // Token inválido/vencido o error del servidor: fuera.
          clearToken()
          await borrarSesionCaché()
        }
      }
      if (!perfil || !ident) {
        if (vivo) setHidratando(false)
        return
      }
      if (vivo) await arrancarSesión(perfil, ident)
    })()
    return () => {
      vivo = false
    }
  }, [arrancarSesión])

  useEffect(() => {
    document.title = `Terreno Conectado · ${pendientes} pendientes`
  }, [pendientes])

  const loginInApp = useCallback(
    async (email: string, password: string) => {
      const r = await login(email, password)
      setToken(r.access_token)
      const p = r.user
      const sites = p.role === 'platform_admin' ? null : await getSites()
      const ident = sites
        ? identidadDeSites(sites.tenant.nombre, sites.tenant.id, sites.items)
        : { tenantId: '', tenantNombre: 'Todos los tenants', faenas: [] }
      await guardarSesionCaché({
        perfil: { id: p.id, tenant_id: p.tenant_id, email: p.email, role: p.role, full_name: p.full_name },
        identidad: ident,
        ts: new Date().toISOString(),
      })
      await arrancarSesión(
        { id: p.id, tenant_id: p.tenant_id, email: p.email, role: p.role, full_name: p.full_name },
        ident,
      )
    },
    [arrancarSesión],
  )

  const salir = useCallback(() => {
    clearToken()
    void borrarSesionCaché()
    setUsuario(null)
    setIdentidad(null)
    setRespuestas({})
    setErroresCampo({})
    setEntradasBitacora([])
    setPantalla('captura')
  }, [])

  /* TSK-WS-011: cualquier 401 de una ruta de lectura/sesión cierra la sesión. */
  useEffect(() => {
    const logout = () => salir()
    window.addEventListener(EVENTO_LOGOUT, logout)
    return () => window.removeEventListener(EVENTO_LOGOUT, logout)
  }, [salir])

  const toggleOnline = useCallback(() => {
    setOnline((v) => !v)
  }, [])

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

  /* FR-016: el evento `online` del navegador dispara la sincronización sin
   * intervención del usuario; `offline` apaga el indicador. El toggle del
   * mockup sigue siendo útil en el demo (simular señal). */
  useEffect(() => {
    const conectar = () => {
      setOnline(true)
    }
    const desconectar = () => setOnline(false)
    window.addEventListener('online', conectar)
    window.addEventListener('offline', desconectar)
    setOnline(navigator.onLine)
    return () => {
      window.removeEventListener('online', conectar)
      window.removeEventListener('offline', desconectar)
    }
  }, [sincronizarAhora, recargarPlantillas])

  const resolverDraft = useCallback(
    async (u: Usuario) => {
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

  const crearHallazgo = useCallback(
    (itemId: string, sev: Severidad, descripcion: string, foto: File | null) => {
      if (!usuario) return
      void (async () => {
        const draft = await resolverDraft(usuario)
        const respuesta = await respuestaDelItem(draft.id, itemId)
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
        await addFinding({
          inspectionId: draft.id,
          responseId: respuesta?.id ?? null,
          tenantId: usuario.tenantId,
          severity: SEV_TO_EN[sev],
          description: descripcion.trim() || 'Sin descripción',
          detalle: descripcion.trim().slice(0, 42) || 'Sin descripción',
          foto: fotoComprimida,
        })
        setRespuestas((r) => ({
          ...r,
          [itemId]: {
            ...r[itemId],
            itemId,
            campo: 'nok',
            valor: 'nok',
            hallazgoId: respuesta?.id,
          },
        }))
        await refrescar()
      })()
    },
    [usuario, refrescar, resolverDraft],
  )

  const enviarInspeccion = useCallback(() => {
    if (!usuario || envioInspeccionEnCurso.current) return
    envioInspeccionEnCurso.current = true
    setEnviandoInspeccion(true)
    void (async () => {
      try {
        const draftId = await getDraftInspectionId()
        if (!draftId) return
        // FR-034: georreferencia opcional al cerrar la inspección. Si no hay
        // permiso, señal o la API no existe, se envía `null` (graceful degrade).
        let location: { lat: number; lon: number } | null = null
        try {
          const pos = await new Promise<GeolocationPosition | null>((resolve) => {
            if (!navigator.geolocation) {
              resolve(null)
              return
            }
            navigator.geolocation.getCurrentPosition(
              (p) => resolve(p),
              () => resolve(null),
              { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
            )
          })
          if (pos) {
            location = { lat: pos.coords.latitude, lon: pos.coords.longitude }
          }
        } catch {
          location = null
        }
        await submitInspection(draftId, location)
        setRespuestas({})
        setHayBorrador(false)
        await refrescar()
        // FR-004: si hay señal la cola se drena; con el switch apagado
        // `sincronizarAhora` no inicia ninguna conexión.
        void sincronizarAhora()
      } finally {
        envioInspeccionEnCurso.current = false
        setEnviandoInspeccion(false)
      }
    })()
  }, [usuario, refrescar, sincronizarAhora])

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
    salir,
    ir: setPantalla,
    setOnline,
    toggleOnline,
    sincronizarAhora,
    sincronizando,
    enviandoInspeccion,
    descartarBorradorYRecargar,
    seleccionarFormulario,
    limpiarDatosPrueba,
    pendientes,
    fallidos,
    enCola: cola,
    responderCampo,
    crearHallazgo,
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
