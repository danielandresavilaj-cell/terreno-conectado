/* Datos semilla — el mockup muestra contenido de producto real, nunca lorem
 * ipsum. Nombres, faenas y cifras corresponden al dominio es-CL del spec
 * (§7: tenant semilla "Minera El Cobre SpA" + "Constructora Andes SpA").
 *
 * FRONTEND-DESIGN: el contenido es el material de diseño. Si el texto fuera
 * genérico, la pantalla se vería genérica. */

import type {
  Conflicto,
  Faena,
  Hallazgo,
  InspeccionEstado,
  ItemPlantilla,
  RegistroCola,
  Usuario,
} from './types'

export const TENANTS = {
  cobre: { id: 't-cobre', nombre: 'Minera El Cobre SpA' },
  andes: { id: 't-andes', nombre: 'Constructora Andes SpA' },
} as const

export const FAENAS: Faena[] = [
  { id: 'f-01', nombre: 'Faena Centinela — Sector Norte', tipo: 'mina', region: 'Antofagasta' },
  { id: 'f-02', nombre: 'Faena Centinela — Rajo Sur', tipo: 'mina', region: 'Antofagasta' },
  { id: 'f-03', nombre: 'Túnel Base — Etapa 3', tipo: 'obra', region: 'Región Metropolitana' },
]

/** FR-006: tenant demo sembrado, un usuario por rol. */
export const USUARIOS: Usuario[] = [
  {
    id: 'u-carla',
    nombre: 'Carla Ñanco',
    rol: 'field_worker',
    tenant: TENANTS.cobre.nombre,
    faena: 'Faena Centinela — Sector Norte',
    intentosFallidos: 2,
  },
  {
    id: 'u-tomas',
    nombre: 'Tomás Ibáñez',
    rol: 'supervisor',
    tenant: TENANTS.cobre.nombre,
    faena: 'Faena Centinela — Sector Norte',
  },
  {
    id: 'u-bernarda',
    nombre: 'Bernardita Ruiz',
    rol: 'tenant_admin',
    tenant: TENANTS.cobre.nombre,
    faena: 'Faena Centinela — Sector Norte',
  },
  {
    id: 'u-platform',
    nombre: 'Operación Plataforma',
    rol: 'platform_admin',
    tenant: 'Todos los tenants',
    faena: '—',
  },
]

export const ROL_LABEL: Record<Usuario['rol'], string> = {
  field_worker: 'Trabajador de terreno',
  supervisor: 'Supervisor',
  tenant_admin: 'Admin de empresa',
  platform_admin: 'Admin de plataforma',
}

export const ROL_HINT: Record<Usuario['rol'], string> = {
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

/** Cola local inicial: mezcla de estados para que el outbox tenga contenido
 *  realista desde el primer frame (FR-013, FR-020). */
export const COLA_INICIAL: RegistroCola[] = [
  {
    id: 'r-1',
    uuid: '0198c2f0-a41d-7b2e-9f10-4c7e5a1b0031',
    tipo: 'inspeccion',
    titulo: 'Inspección · Seguridad en rajo',
    detalle: 'Sector Norte · 8 ítems',
    estado: 'synced',
    orden: 1,
    tenantId: TENANTS.cobre.id,
    latenciaSeg: 22,
  },
  {
    id: 'r-2',
    uuid: '0198c2f0-a41d-7b2e-9f10-4c7e5a1b0032',
    tipo: 'bitacora',
    titulo: 'Bitácora de turno',
    detalle: 'Turno B · 2 entradas',
    estado: 'pending',
    orden: 2,
    tenantId: TENANTS.cobre.id,
  },
  {
    id: 'r-3',
    uuid: '0198c2f0-a41d-7b2e-9f10-4c7e5a1b0033',
    tipo: 'hallazgo',
    titulo: 'Hallazgo · Severidad alta',
    detalle: 'Sin señalización en ruta de evacuación',
    estado: 'syncing',
    orden: 3,
    tenantId: TENANTS.cobre.id,
    intentos: 1,
  },
  {
    id: 'r-4',
    uuid: '0198c2f0-a41d-7b2e-9f10-4c7e5a1b0034',
    tipo: 'foto',
    titulo: 'Foto comprimida',
    detalle: '1280×960 · q0.7 · 214 KB',
    estado: 'pending',
    orden: 4,
    tenantId: TENANTS.cobre.id,
  },
  {
    id: 'r-5',
    uuid: '0198c2f0-a41d-7b2e-9f10-4c7e5a1b0035',
    tipo: 'bitacora',
    titulo: 'Bitácora de turno',
    detalle: 'Geolocalización 23.4°S 69.8°W',
    estado: 'failed',
    orden: 5,
    tenantId: TENANTS.cobre.id,
    intentos: 3,
  },
  {
    id: 'r-6',
    uuid: '0198c2f0-a41d-7b2e-9f10-4c7e5a1b0036',
    tipo: 'respuesta',
    titulo: 'Respuestas de checklist',
    detalle: '5 de 8 contestadas',
    estado: 'pending',
    orden: 2,
    tenantId: TENANTS.cobre.id,
  },
]

export const HALLAZGOS: Hallazgo[] = [
  {
    id: 'h-01',
    titulo: 'Señalización de evacuación ausente',
    descripcion:
      'Tramo de 40 m entre nivel 4120 y 4115 sin conos ni placas de ruta. El equipo no tiene visual de la salida hacia la rampa de emergencia.',
    severidad: 'alta',
    estado: 'open',
    faena: 'Faena Centinela — Sector Norte',
    autor: 'Carla Ñanco',
    autorId: 'u-carla',
    foto: { ancho: 1280, alto: 960, kb: 214 },
    capturadoEn: 'hace 2 min',
  },
  {
    id: 'h-02',
    titulo: 'Agua en el footing SE',
    descripcion:
      'Afloramiento de agua con arrastre de material fino. Se recomienda revisar el corte del talud antes de continuar con la excavación.',
    severidad: 'critica',
    estado: 'in_progress',
    faena: 'Faena Centinela — Sector Norte',
    autor: 'Carla Ñanco',
    autorId: 'u-carla',
    foto: { ancho: 1280, alto: 853, kb: 188 },
    capturadoEn: 'hace 6 min',
  },
  {
    id: 'h-03',
    titulo: 'Barr con leaning en la esquina NO',
    descripcion: 'Barrier inclinado, anclaje superior flojo.',
    severidad: 'media',
    estado: 'open',
    faena: 'Faena Centinela — Rajo Sur',
    autor: 'Javiera Molina',
    autorId: 'u-javi',
    capturadoEn: 'hace 41 min',
  },
  {
    id: 'h-04',
    titulo: 'Falta señalética de tiro en bodega de control',
    descripcion: 'No es bloqueante, se programó para el turno siguiente.',
    severidad: 'baja',
    estado: 'resolved',
    faena: 'Faena Centinela — Rajo Sur',
    autor: 'Javiera Molina',
    autorId: 'u-javi',
    capturadoEn: 'ayer 18:20',
  },
  {
    id: 'h-05',
    titulo: 'Presión anormal en Shovel 240',
    descripcion: 'Alerta en el panel de la cabina a las 04:12.',
    severidad: 'media',
    estado: 'in_progress',
    faena: 'Faena Centinela — Sector Norte',
    autor: 'Carla Ñanco',
    autorId: 'u-carla',
    capturadoEn: 'ayer 04:12',
  },
]

export const INSPECCIONES_POR_ESTADO: Record<InspeccionEstado, number> = {
  draft: 3,
  in_progress: 11,
  submitted: 47,
  reviewed: 126,
}

export const CONFLICTOS: Conflicto[] = [
  {
    id: 'c-01',
    registro: 'Inspección SEG-2026-0912 · Ítem i-01 (barriers)',
    faena: 'Sector Norte',
    devices: [
      {
        device: 'Tablet CBA-04',
        autor: 'Carla Ñanco',
        valor: 'nok — barrier faltante en tramo 4120–4115',
        ts: '09:41:12',
      },
      {
        device: 'Tablet CBA-11',
        autor: 'Javiera Molina',
        valor: 'ok — tramo verificado completo',
        ts: '09:44:50',
      },
    ],
    ganador: 'B',
    resuelto: false,
  },
  {
    id: 'c-02',
    registro: 'Bitácora de turno B · nota de relevo',
    faena: 'Sector Norte',
    devices: [
      { device: 'Tablet CBA-04', autor: 'Carla Ñanco', valor: 'Jefe de turno: Jh. Salas', ts: '14:02:00' },
      { device: 'Celular personal', autor: 'Carla Ñanco', valor: 'Jefe de turno: R. Peña', ts: '14:09:31' },
    ],
    ganador: 'B',
    resuelto: true,
  },
]

/** NFR-03 / FR-043: la métrica que demuestra la propuesta de valor del informe APT. */
export const LATENCIA_P50 = 34
export const LATENCIA_P95 = 58

/** FR-017: aviso de cuota de almacenamiento local. */
export const CUOTA = { usadaPct: 83, fotosPendientes: 14 }
