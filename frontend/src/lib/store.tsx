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
import { COLA_INICIAL, PLANTILLA } from './seed'
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
  guardarSesionCaché,
  listLogEntries,
  listOutbox,
  respuestaDelItem,
  seedDemoDataIfNeeded,
  sesionCaché,
  submitInspection,
  upsertResponse,
  type OutboxRow,
} from './db'
import { ApiError, clearToken, EVENTO_LOGOUT, getSites, getToken, login, me, setToken } from './api'
import { comprimirImagen } from './compresor'
import { sincronizarCola } from './sync'

export type Pantalla = 'captura' | 'bitacora' | 'cola' | 'dashboard' | 'conflictos'

export interface RespuestaItem {
  itemId: string
  valor: 'ok' | 'nok' | 'na' | null
  hallazgoId?: string
  texto?: string
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
  responder: (itemId: string, valor: 'ok' | 'nok' | 'na') => void
  responderTexto: (itemId: string, texto: string) => void
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

  const arrancarSesión = useCallback(
    async (perfil: { id: string; tenant_id: string | null; email: string; role: string; full_name: string }, i: Identidad) => {
      const u = usuarioDe(perfil, i)
      await seedDemoDataIfNeeded(COLA_INICIAL, i, u)
      if (u.faenaId && (u.rol === 'field_worker' || u.rol === 'supervisor')) {
        // FR-014: al reabrir, se restaura el borrador en curso y sus respuestas.
        const ins = await ensureDraftInspection({
          tenantId: u.tenantId,
          siteId: u.faenaId,
          executedBy: u.id,
          templateName: 'Seguridad en rajo',
          siteName: u.faena,
          totalItems: PLANTILLA.length,
        })
        const draftRespuestas: Record<string, RespuestaItem> = {}
        for (const item of PLANTILLA) {
          const r = await respuestaDelItem(ins.id, item.id)
          if (!r || !r.valueOk) continue
          const hallazgo = r.valueOk === 'nok' ? r.id : undefined
          draftRespuestas[item.id] = { itemId: item.id, valor: r.valueOk, hallazgoId: hallazgo }
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
    [refrescar, sincronizarAhora],
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
        templateName: 'Seguridad en rajo',
        siteName: u.faena,
        totalItems: PLANTILLA.length,
      })
    },
    [],
  )

  const responder = useCallback(
    (itemId: string, valor: 'ok' | 'nok' | 'na') => {
      setRespuestas((r) => ({ ...r, [itemId]: { ...r[itemId], itemId, valor } }))
      if (!usuario) return
      void (async () => {
        const draft = await resolverDraft(usuario)
        await upsertResponse({
          inspectionId: draft.id,
          templateItemId: itemId,
          tenantId: usuario.tenantId,
          valueOk: valor,
        })
        await refrescar()
      })()
    },
    [usuario, refrescar, resolverDraft],
  )

  const responderTexto = useCallback(
    (itemId: string, texto: string) => {
      setRespuestas((r) => ({ ...r, [itemId]: { ...r[itemId], itemId, texto } }))
      if (!usuario) return
      void (async () => {
        const item = PLANTILLA.find((i) => i.id === itemId)
        const draft = await resolverDraft(usuario)
        await upsertResponse({
          inspectionId: draft.id,
          templateItemId: itemId,
          tenantId: usuario.tenantId,
          valueOk: null,
          valueText: item?.tipo === 'numerico' ? null : texto,
          valueNumber: item?.tipo === 'numerico' && texto ? Number(texto.replace(',', '.')) : null,
        })
        void refrescar()
      })()
    },
    [usuario, refrescar, resolverDraft],
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
            itemId,
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
    responder,
    responderTexto,
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