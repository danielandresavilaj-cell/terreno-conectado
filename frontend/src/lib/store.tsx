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
  useState,
  type ReactNode,
} from 'react'
import { COLA_INICIAL, DEFINICION_DEMO } from './seed'
import type { Identidad, RegistroCola, Rol, Severidad, Usuario } from './types'
import {
  addFinding,
  addLogEntry,
  borrarSesionCaché,
  contadorFallidos,
  contadorPendientes,
  ensureDraftInspection,
  getDeviceId,
  getDraftInspectionId,
  getInspection,
  getTemplateId,
  guardarPlantillasCache,
  guardarSesionCaché,
  listLogEntries,
  listOutbox,
  plantillasCacheadas,
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
  getPlantillas,
  getSites,
  getToken,
  login,
  me,
  setToken,
} from './api'
import { comprimirImagen } from './compresor'
import { sincronizarCola } from './sync'
import {
  validateValorCampo,
  type CampoValor,
  type TemplateDefinition,
  type TemplatePublicadaDto,
} from '@terreno/shared'
import { columnasDesdeValor, esOkNokNa, itemsDe, valorDesdeColumnas } from './valores'

export type Pantalla = 'captura' | 'bitacora' | 'cola' | 'dashboard' | 'conflictos'

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
  respuestas: Record<string, RespuestaItem>
  entradasBitacora: Array<{ id: string; hora: string; autor: string; texto: string; tags: string[]; geo: string }>

  /** Plantilla activa (FR-036); null sólo durante la hidratación inicial. */
  plantilla: PlantillaActual | null
  /** Errores de validación por ítem (FR-039); vacío = todo válido. */
  erroresCampo: Record<string, string>

  loginInApp: (email: string, password: string) => Promise<void>
  salir: () => void
  ir: (p: Pantalla) => void
  setOnline: (v: boolean) => void
  toggleOnline: () => void
  sincronizarAhora: () => void
  sincronizando: boolean

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
  const [cuotaAviso, setCuotaAviso] = useState(false)
  const [plantilla, setPlantilla] = useState<PlantillaActual | null>(null)
  const [erroresCampo, setErroresCampo] = useState<Record<string, string>>({})

  const refrescar = useCallback(async () => {
    setCola((await listOutbox()).map(mapaCola))
    setPendientes(await contadorPendientes())
    setFallidos(await contadorFallidos())
  }, [])

  const sincronizarAhora = useCallback(() => {
    void (async () => {
      setSincronizando(true)
      try {
        const r = await sincronizarCola()
        if (r.estado === 'ok' || r.estado === 'parcial') {
          const ultimo = r.sincronizados[r.sincronizados.length - 1]
          if (ultimo) setRecienSincronizado(ultimo)
        }
        if (r.estado === 'fallo' && r.error) setCuotaAviso(true)
      } finally {
        setSincronizando(false)
        await refrescar()
      }
    })()
  }, [refrescar])

  /* TSK-FORM-001 / FR-036: hidrata la plantilla activa — caché local del
   * dispositivo → red (`GET /templates` con delta) → definición demo. Si hay
   * borrador en curso, prefiere la revisión publicada que coincide con su
   * `template_id`+versión (FR-038: el borrador conserva su versión). */
  const cargarPlantilla = useCallback(async (tenantId: string): Promise<PlantillaActual> => {
    // La caché local es multi-tenant en el mismo dispositivo: se filtra por
    // el tenant de la sesión activa (FR-007).
    let items: TemplatePublicadaDto[] = (await plantillasCacheadas()).filter(
      (i) => i.tenant_id === tenantId,
    )
    let enRed = false
    if (getToken()) {
      try {
        const desde = items.length ? Math.max(...items.map((i) => i.version)) : undefined
        const r = await getPlantillas(desde)
        if (r.items.length) {
          await guardarPlantillasCache(r.items)
          const porRevision = new Map<string, TemplatePublicadaDto>()
          for (const i of [...items, ...r.items]) porRevision.set(i.revision_id, i)
          items = [...porRevision.values()]
        }
        enRed = true
      } catch {
        /* sin red o sin sesión: manda la caché local (offline-first). */
      }
    }
    let mejor: TemplatePublicadaDto | null = null
    const draftId = await getDraftInspectionId()
    if (draftId) {
      const ins = await getInspection(draftId)
      if (ins) {
        mejor =
          items.find((i) => i.template_id === ins.templateId && i.version === ins.templateVersion) ??
          null
      }
    }
    if (!mejor && items.length) mejor = items.reduce((a, b) => (b.version > a.version ? b : a))
    let p: PlantillaActual
    if (mejor) {
      p = {
        templateId: mejor.template_id,
        revisionId: mejor.revision_id,
        nombre: mejor.name,
        version: mejor.version,
        origen: enRed ? 'servidor' : 'caché',
        definition: mejor.definition,
      }
    } else {
      p = {
        templateId: await getTemplateId(),
        revisionId: null,
        nombre: 'Seguridad en rajo',
        version: null,
        origen: 'demo',
        definition: DEFINICION_DEMO,
      }
    }
    setPlantilla(p)
    setErroresCampo({})
    return p
  }, [])

  const arrancarSesión = useCallback(
    async (perfil: { id: string; tenant_id: string | null; email: string; role: string; full_name: string }, i: Identidad) => {
      const u = usuarioDe(perfil, i)
      await seedDemoDataIfNeeded(COLA_INICIAL, i, u)
      // FR-038: la plantilla activa se hidrata ANTES de tocar el borrador, así
      // el borrador queda ligado al marco de la plantilla vigente.
      const activa = await cargarPlantilla(u.tenantId)
      if (u.faenaId && (u.rol === 'field_worker' || u.rol === 'supervisor')) {
        // FR-014: al reabrir, se restaura el borrador en curso y sus respuestas.
        const ins = await ensureDraftInspection({
          tenantId: u.tenantId,
          siteId: u.faenaId,
          executedBy: u.id,
          templateName: activa.nombre,
          siteName: u.faena,
          totalItems: itemsDe(activa.definition).length,
          templateId: activa.templateId,
          templateVersion: activa.version ?? undefined,
        })
        const draftRespuestas: Record<string, RespuestaItem> = {}
        for (const item of itemsDe(activa.definition)) {
          const r = await respuestaDelItem(ins.id, item.id)
          if (!r) continue
          const campo = valorDesdeColumnas(item, r)
          if (
            campo === null &&
            !r.valueOk &&
            !r.valueText &&
            r.valueNumber === null &&
            !r.valuePhoto
          )
            continue
          draftRespuestas[item.id] = {
            itemId: item.id,
            campo,
            valor: esOkNokNa(campo) ? campo : null,
            hallazgoId: r.valueOk === 'nok' ? r.id : undefined,
          }
        }
        setRespuestas(draftRespuestas)
      }
      setUsuario(u)
      setIdentidad(i)
      setPantalla(u.rol === 'field_worker' ? 'captura' : 'dashboard')
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
    // El valor del cierre es el estado previo: si estaba offline, al encender
    // la señal se inicia el flush (FR-016, FR-022).
    if (!online) {
      void sincronizarAhora()
    } else {
      void refrescar()
    }
  }, [online, refrescar, sincronizarAhora])

  /* FR-016: el evento `online` del navegador dispara la sincronización sin
   * intervención del usuario; `offline` apaga el indicador. El toggle del
   * mockup sigue siendo útil en el demo (simular señal). */
  useEffect(() => {
    const conectar = () => {
      setOnline(true)
      void sincronizarAhora()
    }
    const desconectar = () => setOnline(false)
    window.addEventListener('online', conectar)
    window.addEventListener('offline', desconectar)
    setOnline(navigator.onLine)
    return () => {
      window.removeEventListener('online', conectar)
      window.removeEventListener('offline', desconectar)
    }
  }, [sincronizarAhora])

  const resolverDraft = useCallback(
    async (u: Usuario) => {
      return ensureDraftInspection({
        tenantId: u.tenantId,
        siteId: u.faenaId,
        executedBy: u.id,
        templateName: plantilla?.nombre ?? 'Seguridad en rajo',
        siteName: u.faena,
        totalItems: plantilla ? itemsDe(plantilla.definition).length : 0,
        templateId: plantilla?.templateId,
        templateVersion: plantilla?.version ?? undefined,
      })
    },
    [plantilla],
  )

  /* TSK-FORM-001 / FR-036: única vía de escritura de la captura. Valida el
   * valor contra `props` (FR-039: si falla, no se escribe ni se encola),
   * limpia/registra el error por ítem y persiste en las columnas naturales.
   * La foto se comprime (FR-012) y su binario vive en `valuePhoto` local
   * hasta TSK-FORM-004. */
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
          let valuePhoto: Blob | null | undefined = undefined
          if (campo === null) valuePhoto = null
          else if (adjunto?.foto) {
            try {
              valuePhoto = (await comprimirImagen(adjunto.foto)).blob
            } catch {
              valuePhoto = null
            }
          }
          await upsertResponse({
            inspectionId: draft.id,
            templateItemId: itemId,
            tenantId: usuario.tenantId,
            ...cols,
            valueText: campo === null ? null : 'capturada',
            valuePhoto,
          })
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
    if (!usuario) return
    void (async () => {
      const draftId = await getDraftInspectionId()
      if (draftId) await submitInspection(draftId)
      setRespuestas({})
      await refrescar()
      // FR-004: apenas se encola, si hay señal se intenta el flush.
      void sincronizarAhora()
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
    respuestas,
    entradasBitacora,
    plantilla,
    erroresCampo,
    loginInApp,
    salir,
    ir: setPantalla,
    setOnline,
    toggleOnline,
    sincronizarAhora,
    sincronizando,
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