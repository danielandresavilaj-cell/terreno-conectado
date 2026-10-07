/* Estado de la app.
 *
 * A partir de TSK-WS-005 la persistencia es REAL (Dexie/IndexedDB): la captura
 * crea inspecciones/respuestas/hallazgos/bitácora con UUIDv7 de cliente y los
 * encola en el outbox local (FR-011, FR-013, FR-014, FR-015). El outbox lo
 * consume la capa de sync (TSK-WS-007/008); acá solo se crea y se muestra.
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
import { COLA_INICIAL, FAENAS, PLANTILLA, TENANTS, USUARIOS } from './seed'
import type { RegistroCola, Severidad, Usuario } from './types'
import {
  addFinding,
  addLogEntry,
  contadorFallidos,
  contadorPendientes,
  ensureDraftInspection,
  getDeviceId,
  getDraftInspectionId,
  listLogEntries,
  listOutbox,
  respuestaDelItem,
  seedDemoDataIfNeeded,
  submitInspection,
  upsertResponse,
  type OutboxRow,
} from './db'

export type Pantalla = 'captura' | 'bitacora' | 'cola' | 'dashboard' | 'conflictos'

export interface RespuestaItem {
  itemId: string
  valor: 'ok' | 'nok' | 'na' | null
  hallazgoId?: string
  texto?: string
}

interface Ctx {
  usuario: Usuario | null
  online: boolean
  pantalla: Pantalla
  cola: RegistroCola[]
  recienSincronizado: string | null
  cuotaAviso: boolean
  respuestas: Record<string, RespuestaItem>
  entradasBitacora: Array<{ id: string; hora: string; autor: string; texto: string; tags: string[]; geo: string }>

  entrar: (u: Usuario) => void
  salir: () => void
  ir: (p: Pantalla) => void
  setOnline: (v: boolean) => void
  toggleOnline: () => void

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

const DEFAULT_TENANT = TENANTS.cobre
const DEFAULT_FAENA = FAENAS[0]

const SEV_TO_EN: Record<Severidad, 'low' | 'medium' | 'high' | 'critical'> = {
  baja: 'low',
  media: 'medium',
  alta: 'high',
  critica: 'critical',
}

export function ProveedorEstado({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [online, setOnline] = useState(false)
  const [pantalla, setPantalla] = useState<Pantalla>('captura')
  const [cola, setCola] = useState<RegistroCola[]>([])
  const [respuestas, setRespuestas] = useState<Record<string, RespuestaItem>>({})
  const [pendientes, setPendientes] = useState(0)
  const [fallidos, setFallidos] = useState(0)
  const [entradasBitacora, setEntradasBitacora] = useState<Ctx['entradasBitacora']>([])
  const deviceRef = useRef<string>('')

  const refrescar = useCallback(async () => {
    setCola((await listOutbox()).map(mapaCola))
    setPendientes(await contadorPendientes())
    setFallidos(await contadorFallidos())
  }, [])

  useEffect(() => {
    let vivo = true
    void (async () => {
      await seedDemoDataIfNeeded(COLA_INICIAL)
      await getDeviceId()
      await refrescar()
      const entradas = await listLogEntries(null)
      if (!vivo) return
      setEntradasBitacora(
        entradas.map((e) => ({
          id: e.id,
          hora: new Date(e.capturedAt).toLocaleTimeString('es-CL', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          autor: e.authorId,
          texto: e.entryText,
          tags: e.tags,
          geo: 'guardada en el dispositivo',
        })),
      )
      // FR-014: al reabrir, se restaura el borrador en curso y sus respuestas.
      const ins = await ensureDraftInspection({
        tenantId: DEFAULT_TENANT.id,
        siteId: DEFAULT_FAENA.id,
        executedBy: deviceRef.current || 'u-carla',
        templateName: 'Seguridad en rajo',
        siteName: DEFAULT_FAENA.nombre,
        totalItems: PLANTILLA.length,
      })
      const draftRespuestas: Record<string, RespuestaItem> = {}
      for (const item of PLANTILLA) {
        const r = await respuestaDelItem(ins.id, item.id)
        if (!r || !r.valueOk) continue
        const hallazgo = r.valueOk === 'nok' ? r.id : undefined
        draftRespuestas[item.id] = { itemId: item.id, valor: r.valueOk, hallazgoId: hallazgo }
      }
      if (vivo) setRespuestas(draftRespuestas)
    })()
    return () => {
      vivo = false
    }
  }, [refrescar])

  useEffect(() => {
    document.title = `Terreno Conectado · ${pendientes} pendientes`
  }, [pendientes])

  const tenantId = (u: Usuario) =>
    (Object.values(TENANTS).find((t) => t.nombre === u.tenant) ?? DEFAULT_TENANT).id
  const faenaDe = (u: Usuario) => FAENAS.find((f) => f.nombre === u.faena) ?? DEFAULT_FAENA

  const entrar = useCallback(
    (u: Usuario) => {
      setUsuario(u)
      setPantalla(u.rol === 'field_worker' ? 'captura' : 'dashboard')
      void getDeviceId().then((id) => {
        deviceRef.current = id
      })
    },
    [],
  )

  const salir = useCallback(() => {
    setUsuario(null)
    setPantalla('captura')
  }, [])

  const toggleOnline = useCallback(() => {
    setOnline((v) => !v)
    void refrescar()
  }, [refrescar])

  const resolverDraft = useCallback(
    async (u: Usuario) => {
      void getDeviceId().then((id) => {
        deviceRef.current = id
      })
      const faena = faenaDe(u)
      return ensureDraftInspection({
        tenantId: tenantId(u),
        siteId: faena.id,
        executedBy: u.id,
        templateName: 'Seguridad en rajo',
        siteName: faena.nombre,
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
          tenantId: tenantId(usuario),
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
          tenantId: tenantId(usuario),
          valueOk: null,
          valueText: item?.tipo === 'numerico' ? null : texto,
          valueNumber:
            item?.tipo === 'numerico' && texto ? Number(texto.replace(',', '.')) : null,
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
        await addFinding({
          inspectionId: draft.id,
          responseId: respuesta?.id ?? null,
          tenantId: tenantId(usuario),
          severity: SEV_TO_EN[sev],
          description: descripcion.trim() || 'Sin descripción',
          detalle: descripcion.trim().slice(0, 42) || 'Sin descripción',
          foto: foto,
          mime: foto?.type || 'image/png',
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
    })()
  }, [usuario, refrescar])

  const agregarBitacora = useCallback(
    (texto: string, tags: string[], faenaId: string) => {
      if (!usuario) return
      void (async () => {
        await addLogEntry({
          siteId: faenaId,
          authorId: usuario.id,
          tenantId: tenantId(usuario),
          entryText: texto,
          tags,
          shiftDate: new Date().toISOString().slice(0, 10),
          detalle: `${FAENAS.find((f) => f.id === faenaId)?.nombre ?? '—'} · ${tags.join(' · ')}`,
        })
        const entradas = await listLogEntries(null)
        setEntradasBitacora(
          entradas.map((e) => ({
            id: e.id,
            hora: new Date(e.capturedAt).toLocaleTimeString('es-CL', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            autor: usuario.nombre,
            texto: e.entryText,
            tags: e.tags,
            geo: 'guardada en el dispositivo',
          })),
        )
        await refrescar()
      })()
    },
    [usuario, refrescar],
  )

  const valor: Ctx = {
    usuario,
    online,
    pantalla,
    cola,
    recienSincronizado: null,
    cuotaAviso: false,
    respuestas,
    entradasBitacora,
    entrar,
    salir,
    ir: setPantalla,
    setOnline,
    toggleOnline,
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

export { USUARIOS }