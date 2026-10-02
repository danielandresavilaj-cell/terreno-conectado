/* Estado del mockup.
 *
 * IMPORTANTE — esto NO es la lógica de negocio del sistema. El pedido es un
 * mockup: los botones reaccionan, las transiciones se ven, pero no hay
 * persistencia, ni API, ni IndexedDB, ni cola real. Lo único que simula de
 * verdad es el ciclo de vida de la cola (pending → syncing → synced), porque
 * es EL momento que demuestra la propuesta de valor del proyecto y sin él el
 * mockup no cuenta la historia (spec maestro §9, paso 3).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { COLA_INICIAL, CUOTA, TENANTS, USUARIOS } from './seed'
import type { RegistroCola, Severidad, Usuario } from './types'

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
  /** Registro que acaba de pasar a synced: dispara el barrido de confirmación. */
  recienSincronizado: string | null
  cuotaAviso: boolean
  respuestas: Record<string, RespuestaItem>

  entrar: (u: Usuario) => void
  salir: () => void
  ir: (p: Pantalla) => void
  setOnline: (v: boolean) => void
  toggleOnline: () => void

  pendientes: number
  enCola: RegistroCola[]
  responder: (itemId: string, valor: 'ok' | 'nok' | 'na') => void
  crearHallazgo: (itemId: string, sev: Severidad, descripcion: string, conFoto: boolean) => void
}

const StoreCtx = createContext<Ctx | null>(null)

/** Al reconectar, la cola avanza sola: cada registro tarda ~700 ms en pasar a
 *  syncing y ~900 ms en confirmar. Coincide con el guion de demo del §9. */
const A_SYNCE_MS = 700
const A_SYNCED_MS = 900

export function ProveedorEstado({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [online, setOnline] = useState(false) // arranca offline: es el escenario del proyecto
  const [pantalla, setPantalla] = useState<Pantalla>('captura')
  const [cola, setCola] = useState<RegistroCola[]>(COLA_INICIAL)
  const [recienSincronizado, setRecienSincronizado] = useState<string | null>(null)
  const [cuotaAviso, setCuotaAviso] = useState(false)
  const [respuestas, setRespuestas] = useState<Record<string, RespuestaItem>>({})
  const timers = useRef<number[]>([])

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
    },
    [],
  )

  /* Al volver la señal (FR-016: disparo automático, sin acción del usuario)
   * la cola se drena respectando el orden de dependencias (FR-020). */
  const drenar = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []

    const pendientes = cola
      .filter((r) => r.estado === 'pending' || r.estado === 'failed')
      .sort((a, b) => a.orden - b.orden)

    let offset = 0
    for (const reg of pendientes) {
      const id = reg.id
      timers.current.push(
        window.setTimeout(() => {
          setCola((c) => c.map((r) => (r.id === id ? { ...r, estado: 'syncing' } : r)))
        }, offset + A_SYNCE_MS),
      )
      timers.current.push(
        window.setTimeout(() => {
          // FR-024: se registra la latencia captura→disponibilidad.
          const latencia = 18 + Math.round(Math.random() * 40)
          setCola((c) =>
            c.map((r) =>
              r.id === id ? { ...r, estado: 'synced', latenciaSeg: latencia, intentos: 0 } : r,
            ),
          )
          setRecienSincronizado(id)
          window.setTimeout(() => setRecienSincronizado(null), 900)
        }, offset + A_SYNCE_MS + A_SYNCED_MS),
      )
      offset += 420
    }
  }, [cola])

  useEffect(() => {
    if (online) drenar()
  }, [online, drenar])

  /* FR-017: al superar el 80% de la cuota aparece el aviso de almacenamiento. */
  const pendientes = useMemo(
    () => cola.filter((r) => r.estado === 'pending' || r.estado === 'syncing' || r.estado === 'failed')
      .length,
    [cola],
  )

  useEffect(() => {
    if (CUOTA.usadaPct >= 80) setCuotaAviso(true)
  }, [])

  const entrar = useCallback((u: Usuario) => {
    setUsuario(u)
    setPantalla(u.rol === 'field_worker' ? 'captura' : 'dashboard')
  }, [])

  const salir = useCallback(() => {
    setUsuario(null)
    setPantalla('captura')
  }, [])

  const toggleOnline = useCallback(() => setOnline((v) => !v), [])

  const responder = useCallback((itemId: string, valor: 'ok' | 'nok' | 'na') => {
    setRespuestas((r) => ({ ...r, [itemId]: { ...r[itemId], itemId, valor } }))
  }, [])

  const crearHallazgo = useCallback(
    (itemId: string, sev: Severidad, descripcion: string, conFoto: boolean) => {
      const n = Date.now().toString(16).slice(-6)
      const nuevo: RegistroCola = {
        id: `h-${n}`,
        uuid: `0198c2f0-a41d-7b2e-9f10-${n}0001`,
        tipo: 'hallazgo',
        titulo: `Hallazgo · Severidad ${sev}`,
        detalle: descripcion.slice(0, 42) || 'Sin descripción',
        estado: 'pending',
        orden: 3,
        tenantId: TENANTS.cobre.id,
      }
      setCola((c) => [nuevo, ...c])
      if (conFoto) {
        setCola((c) => [
          {
            id: `f-${n}`,
            uuid: `0198c2f0-a41d-7b2e-9f10-${n}0002`,
            tipo: 'foto',
            titulo: 'Foto comprimida',
            // FR-012: ≤1280 px lado mayor, q0.7
            detalle: '1280×960 · q0.7 · 196 KB',
            estado: 'pending',
            orden: 4,
            tenantId: TENANTS.cobre.id,
          },
          ...c,
        ])
      }
      setRespuestas((r) => ({ ...r, [itemId]: { itemId, valor: 'nok', hallazgoId: nuevo.id } }))
      if (online) window.setTimeout(drenar, 250)
    },
    [drenar, online],
  )

  const valor: Ctx = {
    usuario,
    online,
    pantalla,
    cola,
    recienSincronizado,
    cuotaAviso,
    respuestas,
    entrar,
    salir,
    ir: setPantalla,
    setOnline,
    toggleOnline,
    pendientes,
    enCola: cola,
    responder,
    crearHallazgo,
  }

  return <StoreCtx.Provider value={valor}>{children}</StoreCtx.Provider>
}

export function useEstado() {
  const c = useContext(StoreCtx)
  if (!c) throw new Error('useEstado debe usarse dentro de <ProveedorEstado>')
  return c
}

export { USUARIOS }
