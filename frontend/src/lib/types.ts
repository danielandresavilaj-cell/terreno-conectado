/* Tipos del dominio — espejo de `data-model.md` y de los FR del spec maestro.
 * Solo las formas; el mockup no implementa persistencia ni API. */

export type Rol = 'field_worker' | 'supervisor' | 'tenant_admin' | 'platform_admin'

/** FR-013: estado de cada registro local. */
export type SyncEstado = 'pending' | 'syncing' | 'synced' | 'failed'

/** FR-032: severidad de hallazgo. */
export type Severidad = 'baja' | 'media' | 'alta' | 'critica'

/** FR-031: ciclo de vida de una inspección. */
export type InspeccionEstado = 'draft' | 'in_progress' | 'submitted' | 'reviewed'

export interface Usuario {
  id: string
  nombre: string
  rol: Rol
  email: string
  /** Nombre del tenant (display). */
  tenant: string
  /** UUID real del tenant en el backend (identidad offline, FR-006). */
  tenantId: string
  /** Nombre de la faena principal (display). */
  faena: string
  /** UUID real de la faena principal vía `GET /sites`. */
  faenaId: string
  /** FR-001: cuenta con 2 fallos previos, para mostrar el rate-limit (FR-005). */
  intentosFallidos?: number
}

/** Identidad del dispositivo: tenant + faenas tal como las confirmó el
 *  backend (login/restaurado). Se cachea en Dexie `meta` para que la captura
 *  offline (FR-006) sepa a qué tenant/faena escribir sin red. */
export interface Identidad {
  tenantId: string
  tenantNombre: string
  faenas: Faena[]
}

export interface Faena {
  id: string
  nombre: string
  tipo: 'mina' | 'obra'
  region: string
}

export interface ItemPlantilla {
  id: string
  seccion: string
  texto: string
  /** FR-032: si el ítem exige hallazgo al responderse nok. */
  hallazgoObligatorio: boolean
  tipo: 'ok_nok_na' | 'numerico' | 'texto' | 'foto'
}

export interface RegistroCola {
  id: string
  /** UUIDv7 simulado — FR-015. */
  uuid: string
  tipo: 'inspeccion' | 'respuesta' | 'hallazgo' | 'foto' | 'bitacora'
  titulo: string
  detalle: string
  estado: SyncEstado
  /** FR-020: orden de dependencia faena → inspección → respuestas → hallazgos → fotos. */
  orden: number
  tenantId: string
  /** FR-024: latencia captura→disponibilidad en segundos. */
  latenciaSeg?: number
  intentos?: number
}

export interface Conflicto {
  id: string
  registro: string
  faena: string
  devices: Array<{ device: string; autor: string; valor: string; ts: string }>
  /** FR-023: LWW aplica por captured_at/updated_at más reciente. */
  ganador: 'A' | 'B'
  resuelto: boolean
}
