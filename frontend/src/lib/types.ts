/* Tipos del dominio — espejo de `data-model.md` y de los FR del spec maestro.
 * Solo las formas; el mockup no implementa persistencia ni API. */

export type Rol = 'field_worker' | 'supervisor' | 'tenant_admin' | 'platform_admin'

/** FR-013: estado de cada registro local. */
export type SyncEstado = 'pending' | 'syncing' | 'synced' | 'failed'

/** FR-032: severidad de hallazgo. */
export type Severidad = 'baja' | 'media' | 'alta' | 'critica'

/** FR-031: ciclo de vida de una inspección. */
export type InspeccionEstado = 'draft' | 'in_progress' | 'submitted' | 'reviewed'

/** FR-030: tipos de respuesta de un ítem de plantilla. */
export type Respuesta = 'ok' | 'nok' | 'na'

export interface Usuario {
  id: string
  nombre: string
  rol: Rol
  tenant: string
  faena: string
  /** FR-001: cuenta con 2 fallos previos, para mostrar el rate-limit (FR-005). */
  intentosFallidos?: number
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

export interface Hallazgo {
  id: string
  titulo: string
  descripcion: string
  severidad: Severidad
  estado: 'open' | 'in_progress' | 'resolved'
  faena: string
  autor: string
  autorId: string
  /** FR-012: la foto se comprime a ≤1280px q0.7 antes de encolarse. */
  foto?: { ancho: number; alto: number; kb: number }
  capturadoEn: string
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
