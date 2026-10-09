/* Datos semilla — el mockup muestra contenido de producto real, nunca lorem
 * ipsum. Nombres, faenas y cifras corresponden al dominio es-CL del spec
 * (§7: tenant semilla "Minera El Cobre SpA" + "Constructora Andes SpA").
 *
 * FRONTEND-DESIGN: el contenido es el material de diseño. Si el texto fuera
 * genérico, la pantalla se vería genérica.
 *
 * Desde TSK-WS-011 la sesión es REAL: el login usa el backend y las faenas
 * salen de `GET /api/v1/sites` con los IDs del tenant. Lo que queda acá es
 * estático y sin depender de credenciales: la plantilla FR-030, los textos de
 * rol del login y las cuentas demo con que el backend se sembró (`npm run
 * db:seed`, ver `backend/db/seed.ts`: mismas passwords para el demo).
 */

import type { TemplateDefinition } from '@terreno/shared'
import type { ItemPlantilla, RegistroCola, Rol, Usuario } from './types'

/** Login demo (TSK-WS-011): cuentas sembradas en el backend, misma password.
 *  Obligatoriamente desde variables de entorno (Vite expone solo VITE_*).
 *  Nunca hardcodeada en el fuente. */
const DEMO_PASSWORD_RAW = import.meta.env.VITE_DEMO_PASSWORD
if (!DEMO_PASSWORD_RAW) {
  throw new Error('VITE_DEMO_PASSWORD requerido (ver .env.example)')
}
export const DEMO_PASSWORD = DEMO_PASSWORD_RAW

export const DEMO_CUENTAS: Array<Pick<Usuario, 'nombre' | 'rol'> & { email: string }> = [
  { nombre: 'Pedro Trabajador', rol: 'field_worker', email: 'trabajador@minera.cl' },
  { nombre: 'Sofía Supervisora', rol: 'supervisor', email: 'supervisor@minera.cl' },
  { nombre: 'Andrés Admin', rol: 'tenant_admin', email: 'admin@minera.cl' },
  { nombre: 'Bárbara Trabajadora', rol: 'field_worker', email: 'trabajador@andes.cl' },
  { nombre: 'Bruno Supervisor', rol: 'supervisor', email: 'supervisor@andes.cl' },
  { nombre: 'Operación Plataforma', rol: 'platform_admin', email: 'admin@terreno.local' },
] as const

export const ROL_LABEL: Record<Rol, string> = {
  field_worker: 'Trabajador de terreno',
  supervisor: 'Supervisor',
  tenant_admin: 'Admin de empresa',
  platform_admin: 'Admin de plataforma',
}

export const ROL_HINT: Record<Rol, string> = {
  field_worker: 'Captura offline en faena, con guantes y sin señal',
  supervisor: 'Consolida el turno, revisa hallazgos y conflictos',
  tenant_admin: 'Gestiona usuarios, faenas y plantillas del tenant',
  platform_admin: 'Crea tenants y audita la salud del sistema',
}

/** Plantilla de inspección de seguridad en rajo (FR-030). */
export const PLANTILLA: ItemPlantilla[] = [
  {
    id: 'i-01',
    seccion: 'Barriers y señalética',
    texto: 'Barriers perimetrales del nivel de trabajo completos y estables',
    hallazgoObligatorio: true,
    tipo: 'ok_nok_na',
  },
  {
    id: 'i-02',
    seccion: 'Barriers y señalética',
    texto: 'Señalización de rutas de evacuación visible desde el punto de corte',
    hallazgoObligatorio: true,
    tipo: 'ok_nok_na',
  },
  {
    id: 'i-03',
    seccion: 'Equipos y maquinaria',
    texto: 'Radio comunicador en la frecuencia asignada de la faena',
    hallazgoObligatorio: false,
    tipo: 'ok_nok_na',
  },
  {
    id: 'i-04',
    seccion: 'Equipos y maquinaria',
    texto: 'Nivel de aceite y refrigerante de la perforadora RD-07',
    hallazgoObligatorio: false,
    tipo: 'numerico',
  },
  {
    id: 'i-05',
    seccion: 'Equipos y maquinaria',
    texto: 'Estado de inspección de uñas y mangueras de la Shovel 240',
    hallazgoObligatorio: false,
    tipo: 'foto',
  },
  {
    id: 'i-06',
    seccion: 'Suelo y inestabilidad',
    texto: 'Talud de pared norte sin grietas ni desprendimientos recientes',
    hallazgoObligatorio: true,
    tipo: 'ok_nok_na',
  },
  {
    id: 'i-07',
    seccion: 'Suelo y inestabilidad',
    texto: 'Afloramiento de agua en el footing SE del nivel 4115',
    hallazgoObligatorio: false,
    tipo: 'texto',
  },
  {
    id: 'i-08',
    seccion: 'EPP y salud del personal',
    texto: 'Uso de arnés de detención en tareas sobre plataforma',
    hallazgoObligatorio: true,
    tipo: 'ok_nok_na',
  },
]

/**
 * La definición de la plantilla local PLANTILLA en el formato del motor de
 * render data-driven (TSK-FORM-001 / FR-036). El dispositivo la usa como
 * fallback cuando no hay revisión publicada en caché ni red (offline-first).
 * NOTA: los `id` son los ids legados 'i-01'… y NO son UUIDs; este objeto no
 * se valida con `parseTemplateDefinition` (el Zod exige uuid).
 */
const TIPO_DEMO: Record<ItemPlantilla['tipo'], TemplateDefinition['sections'][number]['items'][number]['response_type']> = {
  ok_nok_na: 'ok_nok_na',
  numerico: 'numeric',
  texto: 'text',
  foto: 'photo',
}

export const DEFINICION_DEMO: TemplateDefinition = {
  sections: [...new Set(PLANTILLA.map((i) => i.seccion))].map((seccion) => ({
    title: seccion,
    items: PLANTILLA.filter((i) => i.seccion === seccion).map((i) => ({
      id: i.id,
      prompt: i.texto,
      response_type: TIPO_DEMO[i.tipo],
      require_finding_on_nok: i.hallazgoObligatorio || undefined,
      props: {},
    })),
  })),
}

/** Cola local inicial: mezcla de estados para que el outbox tenga contenido
 *  realista desde el primer frame (FR-013, FR-020). El `tenantId` lo fija la
 *  siembra con la identidad real de la sesión (TSK-WS-011); los IDs de
 *  inspección/hallazgo/bitácora apuntan a entidades que la siembra crea con
 *  los mismos UUIDv7, así el primer sync es un lote VÁLIDO de verdad: todo lo
 *  que apunta a una entidad ya sincronizada está en cola, y las respuestas del
 *  checklist también. El fake "foto 1280×960" se siembra como PNG 1×1 (la
 *  metadata del detalle es la del mockup, los bytes reales son mínimos). */
export const COLA_INICIAL: RegistroCola[] = [
  {
    id: 'r-1',
    uuid: '0198c2f0-a41d-7b2e-9f10-4c7e5a1b0031',
    tipo: 'inspeccion',
    titulo: 'Inspección · Seguridad en rajo',
    detalle: 'Sector Norte · 8 ítems',
    estado: 'pending',
    orden: 1,
    tenantId: '',
  },
  {
    id: 'r-2',
    uuid: '0198c2f0-a41d-7b2e-9f10-4c7e5a1b0032',
    tipo: 'bitacora',
    titulo: 'Bitácora de turno',
    detalle: 'Turno B · 2 entradas',
    estado: 'pending',
    orden: 5,
    tenantId: '',
  },
  {
    id: 'r-3',
    uuid: '0198c2f0-a41d-7b2e-9f10-4c7e5a1b0033',
    tipo: 'hallazgo',
    titulo: 'Hallazgo · Severidad alta',
    detalle: 'Sin señalización en ruta de evacuación',
    estado: 'pending',
    orden: 3,
    tenantId: '',
  },
  {
    id: 'r-4',
    uuid: '0198c2f0-a41d-7b2e-9f10-4c7e5a1b0034',
    tipo: 'foto',
    titulo: 'Foto comprimida',
    detalle: '1280×960 · q0.7 · 214 KB',
    estado: 'pending',
    orden: 4,
    tenantId: '',
  },
  {
    id: 'r-5',
    uuid: '0198c2f0-a41d-7b2e-9f10-4c7e5a1b0035',
    tipo: 'bitacora',
    titulo: 'Bitácora de turno',
    detalle: 'Geolocalización 23.4°S 69.8°W',
    estado: 'failed',
    orden: 5,
    tenantId: '',
    intentos: 3,
  },
]

/** FR-017: aviso de cuota de almacenamiento local. */
export const CUOTA = { usadaPct: 83, fotosPendientes: 14 }