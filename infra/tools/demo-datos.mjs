#!/usr/bin/env node
/**
 * Empresa de demostración — plan 011 (presentación del 19 de noviembre de 2026).
 *
 * Crea "Minera Cordillera Austral SpA" (ficticia) con 3 faenas, 9 cuentas,
 * formularios del catálogo y ~6 semanas de historia: inspecciones firmadas,
 * hallazgos en todos sus estados, bitácora con alertas, revisiones y cofirmas,
 * conflictos, activos con QR y resúmenes con IA.
 *
 * Usa SÓLO la API de la app (la misma que el teléfono y la web): pasa por las
 * validaciones, el aislamiento por empresa (RLS) y la auditoría. No inserta en
 * la base de datos ni usa la semilla de desarrollo (Enmienda 003).
 *
 * Credenciales (Art. IX):
 *  - El correo y la clave del administrador de plataforma se escriben en la
 *    terminal al correr (no van en argumentos ni en el historial). Para el
 *    ensayo local se pueden pasar con las variables DEMO_PLATAFORMA_EMAIL y
 *    DEMO_PLATAFORMA_CLAVE.
 *  - Las claves de las 9 cuentas se generan al azar y se guardan sólo en
 *    `.demo-cuentas.local.json` (ignorado por Git). No se imprimen.
 *
 * Requisitos: `npm ci` y `npm run build --workspace @terreno/shared` (el
 * catálogo de plantillas sale del build de shared).
 *
 * Uso:
 *   node infra/tools/demo-datos.mjs --api https://terrenoconectado.cl/api/v1 [--fotos carpeta] [--slug ...]
 *
 * Opciones:
 *   --api URL       API (por omisión http://localhost:3000/api/v1)
 *   --fotos DIR     carpeta con fotos .jpg para respuestas de foto y hallazgos (opcional)
 *   --slug SLUG     identificador de la empresa (por omisión minera-cordillera-austral)
 *   --semanas N     semanas de historia (por omisión 8: llena el gráfico de 8 semanas de Gerencia)
 *   --salida RUTA   archivo de cuentas (por omisión .demo-cuentas.local.json en la raíz)
 *   --dominio D     dominio de los correos (por omisión demo.terrenoconectado.cl; para ensayos repetidos)
 *   --sin-ia        no pide resúmenes con IA
 *   --continuar     NO crea nada: agrega a la empresa ya cargada la actividad
 *                   desde la última carga hasta ahora (TSK-DEMO-003). Usa las
 *                   cuentas de `--salida` (no pide la cuenta de plataforma),
 *                   revisa lo pendiente con más de 2 días y cierra parte de lo
 *                   vencido de antes. Se puede correr varias veces.
 *   --ahora ISO     (sólo ensayos) fecha que el script toma como "ahora"
 */
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(join(RAIZ, 'package.json'))

/* ── Argumentos ─────────────────────────────────────────────────────────── */

function arg(nombre, porOmision) {
  const i = process.argv.indexOf(`--${nombre}`)
  if (i < 0) return porOmision
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}

const API = String(arg('api', 'http://localhost:3000/api/v1')).replace(/\/$/, '')
const DIR_FOTOS = arg('fotos', null)
const SLUG = String(arg('slug', 'minera-cordillera-austral'))
const SEMANAS = Number(arg('semanas', 8))
const SALIDA = resolve(RAIZ, String(arg('salida', '.demo-cuentas.local.json')))
const SIN_IA = arg('sin-ia', false) === true
const DOMINIO_CORREO = String(arg('dominio', 'demo.terrenoconectado.cl'))
const CONTINUAR = arg('continuar', false) === true
const AHORA_ARG = arg('ahora', null)

/* ── Utilidades ─────────────────────────────────────────────────────────── */

const log = (...m) => console.log(...m)
const paso = (m) => console.log(`\n▸ ${m}`)

/** Azar reproducible (mulberry32): la misma empresa en cada ensayo. */
let semilla = 20261119
function azar() {
  semilla |= 0
  semilla = (semilla + 0x6d2b79f5) | 0
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1))
const elegir = (lista) => lista[Math.floor(azar() * lista.length)]
const prob = (p) => azar() < p
function ponderado(pares) {
  const total = pares.reduce((s, [, p]) => s + p, 0)
  let r = azar() * total
  for (const [v, p] of pares) if ((r -= p) <= 0) return v
  return pares[pares.length - 1][0]
}

const clave = () => randomBytes(15).toString('base64url')
const sha256 = (t) => createHash('sha256').update(t).digest('hex')

function preguntar(texto, { oculto = false } = {}) {
  return new Promise((ok) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (oculto) {
      rl._writeToOutput = (s) => {
        if (s.includes(texto)) process.stdout.write(s)
      }
    }
    rl.question(texto, (r) => {
      rl.close()
      if (oculto) process.stdout.write('\n')
      ok(r.trim())
    })
  })
}

class ErrorApi extends Error {
  constructor(status, detalle, ruta) {
    super(`${status} en ${ruta}: ${detalle}`)
    this.status = status
  }
}

async function api(token, metodo, ruta, cuerpo) {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await r.text()
  let json = null
  try {
    json = texto ? JSON.parse(texto) : null
  } catch {
    json = null
  }
  if (!r.ok) throw new ErrorApi(r.status, json?.message ?? texto.slice(0, 200), `${metodo} ${ruta}`)
  return json
}

const login = async (email, password) => (await api(null, 'POST', '/auth/login', { email, password })).access_token

/** Entra con la clave temporal y la cambia por la definitiva (la app lo exige). */
async function activarCuenta(email, temporal, definitiva) {
  const t = await login(email, temporal)
  const r = await api(t, 'POST', '/auth/password', { current_password: temporal, new_password: definitiva })
  return r?.access_token ?? (await login(email, definitiva))
}

/* ── Tiempo (hora de Chile continental, UTC−3 en noviembre) ─────────────── */

const AHORA = AHORA_ARG ? Date.parse(String(AHORA_ARG)) : Date.now()
if (!Number.isFinite(AHORA)) throw new Error('--ahora no es una fecha válida (ISO, p. ej. 2026-11-16T20:00:00-03:00)')
const DIA = 86_400_000
const OFFSET_CL = -3 * 3_600_000
/** Fecha local de Chile `YYYY-MM-DD` de un instante. */
const fechaCl = (ms) => new Date(ms + OFFSET_CL).toISOString().slice(0, 10)
/** Instante para un día (0 = hoy, -1 = ayer…) a la hora local hh:mm. */
function instante(dia, hh, mm) {
  const base = Date.parse(`${fechaCl(AHORA + dia * DIA)}T00:00:00.000Z`) - OFFSET_CL
  return base + (hh * 60 + mm) * 60_000
}
const diaSemana = (dia) => new Date(AHORA + dia * DIA + OFFSET_CL).getUTCDay() // 0 domingo
const iso = (ms) => new Date(ms).toISOString()

/* ── Empresa ficticia ───────────────────────────────────────────────────── */

const EMPRESA = 'Minera Cordillera Austral SpA'
const FAENAS = [
  { clave: 'cerro', name: 'Faena Cerro Plata', kind: 'mining', sectores: ['rampa 3', 'chancador primario', 'taller de camiones', 'botadero norte'] },
  { clave: 'llano', name: 'Planta Llano Seco', kind: 'mining', sectores: ['nave de flotación', 'correa C-2', 'bodega de reactivos', 'sala eléctrica'] },
  { clave: 'camino', name: 'Obra Camino del Cobre', kind: 'construction', sectores: ['km 12', 'puente La Quebrada', 'instalación de faena', 'frente de excavación'] },
]

const PERSONAS = [
  { clave: 'gerente', nombre: 'Valentina Rojas', rol: 'tenant_admin', faenas: [] },
  { clave: 'sup-norte', nombre: 'Matías Fuentes', rol: 'supervisor', faenas: ['cerro', 'llano'] },
  { clave: 'sup-obra', nombre: 'Carolina Muñoz', rol: 'supervisor', faenas: ['camino'] },
  { clave: 't-cerro-1', nombre: 'Pedro Araya', rol: 'field_worker', faenas: ['cerro'] },
  { clave: 't-cerro-2', nombre: 'Javiera Soto', rol: 'field_worker', faenas: ['cerro'] },
  { clave: 't-llano-1', nombre: 'Luis Contreras', rol: 'field_worker', faenas: ['llano'] },
  { clave: 't-llano-2', nombre: 'Fernanda Díaz', rol: 'field_worker', faenas: ['llano'] },
  { clave: 't-camino-1', nombre: 'Jorge Morales', rol: 'field_worker', faenas: ['camino'] },
  { clave: 't-camino-2', nombre: 'Camila Reyes', rol: 'field_worker', faenas: ['camino'] },
]
const correoDe = (p) =>
  p.rol === 'tenant_admin'
    ? `gerencia@${DOMINIO_CORREO}`
    : `${p.nombre
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '.')}@${DOMINIO_CORREO}`

/** Formularios del catálogo por faena (trabajador) + relevo para supervisión. */
const FORMULARIOS_POR_FAENA = {
  cerro: ['seguridad-diaria', 'equipo-movil', 'extintores', 'epp'],
  llano: ['seguridad-diaria', 'orden-aseo', 'equipo-movil', 'extintores', 'epp'],
  camino: ['seguridad-diaria', 'andamios', 'trabajo-altura', 'epp'],
}
const FORMULARIOS_SUPERVISION = ['relevo-turno', 'seguridad-diaria']

const ACTIVOS = [
  { name: 'Camioneta CA-12', kind: 'vehicle', faena: 'cerro', formulario: 'equipo-movil' },
  { name: 'Extintor E-07 · Taller de camiones', kind: 'equipment', faena: 'cerro', formulario: 'extintores' },
  { name: 'Grúa horquilla GH-3', kind: 'equipment', faena: 'llano', formulario: 'equipo-movil' },
  { name: 'Andamio torre T-2 · Puente La Quebrada', kind: 'location', faena: 'camino', formulario: 'andamios' },
]

/* ── Textos de terreno ──────────────────────────────────────────────────── */

const HALLAZGOS = {
  'seguridad-diaria': [
    'Acceso al {s} con material acopiado en la vía de tránsito; se pidió despejar antes del cambio de turno.',
    'Señalética de segregación caída en el {s}; se repuso provisoriamente con cinta.',
    'Extintor del {s} con carga vencida desde el mes pasado.',
    'Derrame de aceite cerca del {s}; se aplicó absorbente y se aisló el área.',
    'Iluminación insuficiente en el {s} para el turno noche: dos focos fuera de servicio.',
  ],
  'equipo-movil': [
    'Neumático trasero izquierdo con corte lateral; equipo detenido hasta su cambio.',
    'Alarma de retroceso sin funcionar; se informó a mantención.',
    'Fuga de aceite hidráulico en el cilindro de levante.',
    'Cinturón del copiloto con el anclaje dañado.',
    'Parabrisas trizado en el campo visual del operador.',
  ],
  extintores: [
    'Manómetro bajo la zona verde; extintor retirado para recarga.',
    'Sello de seguridad roto y pasador ausente.',
    'Acceso al extintor bloqueado por pallets en el {s}.',
    'Manguera agrietada en la unión con la válvula.',
  ],
  epp: [
    'Dos trabajadores de la cuadrilla sin protección auditiva en el {s}.',
    'Respiradores con filtros vencidos en la cuadrilla de mantención.',
    'Casco con barbiquejo cortado; se entregó uno nuevo en bodega.',
    'Ropa de alta visibilidad deteriorada en el turno de noche.',
  ],
  'orden-aseo': [
    'Residuos peligrosos mezclados con domiciliarios en el {s}.',
    'Pasillo de la {s} con herramientas en el piso.',
    'Tambores sin rotular junto a la bodega de reactivos.',
  ],
  andamios: [
    'Plataforma con un tablón suelto en el nivel 2.',
    'Falta rodapié en el costado oriente del andamio.',
    'Anclaje a la estructura ausente sobre los 4 m.',
    'Base sobre terreno blando sin placa de apoyo.',
  ],
  'trabajo-altura': [
    'Línea de vida sin certificación vigente en el {s}.',
    'Área inferior sin segregar mientras se trabajaba en altura.',
    'Cabo de vida sin absorbedor de impacto en uno de los trabajadores.',
  ],
  'relevo-turno': ['Permiso de trabajo en caliente quedó abierto sin traspaso al turno entrante.'],
}

const BITACORA = {
  Relevo: [
    'Recibo turno sin novedades mayores. Equipos operativos en el {s}.',
    'Entrego turno con la {s} en mantención programada; vuelve a operar a las 14:00.',
    'Relevo conversado con el turno saliente: quedan dos permisos abiertos en el {s}.',
  ],
  Seguridad: [
    'Charla de 5 minutos sobre caída de objetos con la cuadrilla del {s}.',
    'Se detectó a una persona sin lentes en el {s}; se corrigió en el momento.',
    'Inspección visual de barandas en el {s}: una sección suelta.',
  ],
  Clima: [
    'Viento fuerte desde las 15:00; se suspendieron izajes en el {s}.',
    'Neblina matinal reduce la visibilidad en el {s}; tránsito con luces encendidas.',
    'Temperatura bajo cero al inicio del turno; caminos con escarcha en el {s}.',
  ],
  Equipos: [
    'Camión 14 detenido por falla en frenos; derivado a taller.',
    'Se cambió el filtro de aire del generador del {s}.',
    'Bomba del {s} con vibración anormal; queda en observación.',
  ],
  Incidencia: [
    'Corte de energía de 20 minutos en el {s}; se reanudó sin daños.',
    'Casi accidente: carga mal estrobada en el {s}. Se detuvo la maniobra y se re-estrobó.',
    'Ingreso de vehículo particular sin autorización al {s}; se informó a portería.',
  ],
}
const ALERTAS_BITACORA = [
  ['high', 'Baranda suelta en el {s}: riesgo de caída de altura. Se segregó el área.'],
  ['critical', 'Correa sin guarda en el {s} con personal trabajando cerca. Se detuvo el equipo.'],
  ['medium', 'Fisura en el radier del {s}; revisar antes de mover carga pesada.'],
  ['high', 'Cables eléctricos expuestos en el {s} tras la lluvia.'],
]

const NOTAS_CIERRE = [
  'Se reparó y se verificó en terreno con el supervisor.',
  'Se cambió el elemento dañado y se registró en la bitácora de mantención.',
  'Se instruyó a la cuadrilla y se repuso el elemento faltante.',
  'Se segregó, se corrigió la condición y se liberó el área.',
]
const REPORTES = [
  'Listo: se cambió la pieza y quedó operativo.',
  'Se corrigió la condición; adjunto foto en la próxima inspección.',
  'Reparado con apoyo de mantención; pendiente que supervisión valide.',
]

const conSector = (t, sectores) => t.replaceAll('{s}', elegir(sectores))

/* ── Fotos (opcional) ───────────────────────────────────────────────────── */

const FOTOS = (() => {
  if (!DIR_FOTOS) return []
  const dir = resolve(String(DIR_FOTOS))
  if (!existsSync(dir)) throw new Error(`No existe la carpeta de fotos: ${dir}`)
  return readdirSync(dir)
    .filter((f) => ['.jpg', '.jpeg'].includes(extname(f).toLowerCase()))
    .map((f) => {
      const bytes = readFileSync(join(dir, f))
      return { nombre: f, data: bytes.toString('base64'), bytes: bytes.length, ...dimensionesJpeg(bytes) }
    })
    .filter((f) => f.bytes <= 4 * 1024 * 1024)
})()

/** Ancho y alto de un JPEG leyendo su marcador SOF. */
function dimensionesJpeg(b) {
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) break
    const m = b[i + 1]
    const largo = b.readUInt16BE(i + 2)
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    }
    i += 2 + largo
  }
  return { width: 1280, height: 960 }
}

/** Qué fotos calzan con cada formulario (por palabra en el nombre del archivo). */
const TEMAS_FOTO = {
  extintores: ['extintor'],
  andamios: ['andamio', 'obra'],
  'trabajo-altura': ['andamio', 'obra'],
  'equipo-movil': ['cargador', 'neumatico'],
  'seguridad-diaria': ['letrero', 'correa', 'obra', 'extintor'],
  'orden-aseo': ['correa', 'obra'],
  epp: ['obra', 'letrero'],
  'relevo-turno': ['correa', 'obra'],
  bitacora: ['letrero', 'correa', 'obra', 'andamio'],
}

function fotoPara(tema) {
  const claves = TEMAS_FOTO[tema] ?? []
  const calzan = FOTOS.filter((f) => claves.some((k) => f.nombre.includes(k)))
  return elegir(calzan.length ? calzan : FOTOS)
}

function adjunto(tenant, ownerType, ownerId, capturedMs, tema) {
  if (FOTOS.length === 0) return null
  const f = fotoPara(tema)
  return registro(tenant, 'attachment', randomUUID(), capturedMs, {
    owner_type: ownerType,
    owner_id: ownerId,
    mime: 'image/jpeg',
    bytes: f.bytes,
    width: f.width,
    height: f.height,
    data: f.data,
  })
}

/* ── Registros de sincronización ────────────────────────────────────────── */

function registro(tenant, entity_type, id, capturedMs, payload, version = 1) {
  return { entity_type, id, tenant_id: tenant, client_version: version, captured_at: iso(capturedMs), queued_at: iso(capturedMs + entre(1, 4) * 60_000), payload }
}

function trazoFirma() {
  const trazos = []
  let x = entre(120, 220)
  for (let t = 0; t < entre(2, 3); t++) {
    const puntos = []
    let y = entre(380, 620)
    for (let p = 0; p < entre(8, 14); p++) {
      x = Math.min(980, x + entre(15, 45))
      y = Math.max(80, Math.min(920, y + entre(-90, 90)))
      puntos.push({ x, y })
    }
    trazos.push({ points: puntos })
    x = Math.min(900, x + entre(20, 60))
  }
  return trazos
}

/** Respuesta realista para un ítem; devuelve `null` si no se responde. */
function responder(item, capturedMs) {
  const p = item.props ?? {}
  switch (item.response_type) {
    case 'ok_nok_na': {
      const v = ponderado([['ok', 90], ['nok', 7], ['na', 3]])
      return { value_ok: v, value_text: null, value_number: null }
    }
    case 'text':
      if (!p.required && !prob(0.35)) return null
      return { value_ok: null, value_text: textoPara(item.prompt), value_number: null }
    case 'numeric': {
      const min = Number(p.min ?? 0)
      const max = Math.min(Number(p.max ?? 100), min + (min < 2 ? 40 : 60))
      const v = item.prompt.includes('(m)') ? Math.round((min + azar() * (max - min)) * 10) / 10 : entre(Math.ceil(min), Math.floor(max))
      return { value_ok: null, value_text: null, value_number: v }
    }
    case 'select_single':
      return { value_ok: null, value_text: null, value_number: null, value_json: ponderado(p.options.map((o, i) => [o, i === 0 ? 6 : 1])) }
    case 'select_multiple': {
      if (!prob(0.3)) return null
      return { value_ok: null, value_text: null, value_number: null, value_json: [elegir(p.options)] }
    }
    case 'date':
      return { value_ok: null, value_text: null, value_number: null, value_json: fechaCl(capturedMs + entre(30, 300) * DIA) }
    case 'time': {
      const d = new Date(capturedMs + OFFSET_CL)
      return { value_ok: null, value_text: null, value_number: null, value_json: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
    }
    case 'photo':
      return FOTOS.length > 0 && (p.required || prob(0.5)) ? { value_ok: null, value_text: null, value_number: null, foto: true } : null
    default:
      return null
  }
}

function textoPara(prompt) {
  const pr = prompt.toLowerCase()
  if (pr.includes('patente') || pr.includes('código')) return `${elegir(['CA', 'GH', 'CM', 'E'])}-${entre(2, 40)}`
  if (pr.includes('ubicación')) return elegir(['Nivel 2, eje B', 'Pasarela norte', 'Costado oriente'])
  if (pr.includes('cuadrilla')) return elegir(['Montajes del Sur Ltda.', 'Cuadrilla de mantención mecánica', 'Contratista Eléctrica Andina'])
  if (pr.includes('descripción del trabajo')) return elegir(['Montaje de cañería a 6 m', 'Cambio de luminarias en nave', 'Soldadura de baranda en pasarela'])
  if (pr.includes('área') || pr.includes('sector')) return elegir(['Bodega de reactivos', 'Taller de camiones', 'Nave de flotación'])
  if (pr.includes('pendientes')) return 'Terminar el cambio de polines de la correa C-2 y cerrar el permiso de trabajo.'
  if (pr.includes('riesgos')) return 'Viento en aumento durante la tarde; revisar amarras de los acopios.'
  if (pr.includes('acciones')) return 'Se entregó EPP faltante desde bodega.'
  if (pr.includes('detenidos')) return 'Camión 14 en taller por frenos.'
  return elegir(['Sin observaciones.', 'Condición normal.', 'Se conversó con la cuadrilla.'])
}

/* ── Programa principal ─────────────────────────────────────────────────── */

async function main() {
  const { CATALOGO_PLANTILLAS } = require('@terreno/shared')
  if (!CATALOGO_PLANTILLAS) throw new Error('Falta el catálogo: corre `npm run build --workspace @terreno/shared`.')
  const catalogo = Object.fromEntries(CATALOGO_PLANTILLAS.map((p) => [p.clave, p]))

  log(`Empresa de demostración → ${API}`)
  if (CONTINUAR) return continuar(catalogo)
  if (existsSync(SALIDA)) throw new Error(`Ya existe ${SALIDA}: muévelo o usa --salida para no pisar claves anteriores.`)
  log(FOTOS.length ? `Fotos: ${FOTOS.length} de ${DIR_FOTOS}` : 'Sin fotos (usa --fotos carpeta para agregarlas).')

  /* 1. Administrador de plataforma: crea la empresa y su administración. */
  const correoPlat = process.env.DEMO_PLATAFORMA_EMAIL || (await preguntar('Correo del administrador de plataforma: '))
  const clavePlat = process.env.DEMO_PLATAFORMA_CLAVE || (await preguntar('Contraseña: ', { oculto: true }))
  const tPlat = await login(correoPlat, clavePlat)

  paso('Empresa')
  const existentes = await api(tPlat, 'GET', '/admin/tenants')
  if ((existentes.items ?? existentes).some((t) => t.slug === SLUG)) throw new Error(`Ya existe una empresa con slug "${SLUG}". Usa --slug para otra.`)
  const tenant = await api(tPlat, 'POST', '/admin/tenants', { name: EMPRESA, slug: SLUG })
  log(`  ${EMPRESA} (${tenant.id})`)

  const cuentas = {}
  const gerente = PERSONAS[0]
  {
    const temporal = clave()
    const definitiva = clave()
    await api(tPlat, 'POST', `/admin/tenants/${tenant.id}/admins`, { email: correoDe(gerente), full_name: gerente.nombre, password: temporal })
    const token = await activarCuenta(correoDe(gerente), temporal, definitiva)
    const yo = await api(token, 'GET', '/me')
    cuentas[gerente.clave] = { ...gerente, email: correoDe(gerente), password: definitiva, token, id: yo.id ?? yo.user?.id }
  }
  const tAdmin = cuentas.gerente.token

  /* 2. Faenas y cuentas. */
  paso('Faenas')
  const faenas = {}
  for (const f of FAENAS) {
    const creada = await api(tAdmin, 'POST', '/sites', { name: f.name, kind: f.kind })
    faenas[f.clave] = { ...f, id: creada.id }
    log(`  ${f.name}`)
  }

  paso('Cuentas')
  for (const p of PERSONAS.slice(1)) {
    const temporal = clave()
    const definitiva = clave()
    const u = await api(tAdmin, 'POST', '/users', { email: correoDe(p), full_name: p.nombre, role: p.rol, password: temporal })
    if (p.faenas.length) await api(tAdmin, 'PUT', `/users/${u.id}/faenas`, { faena_ids: p.faenas.map((k) => faenas[k].id) })
    const token = await activarCuenta(correoDe(p), temporal, definitiva)
    cuentas[p.clave] = { ...p, email: correoDe(p), password: definitiva, token, id: u.id }
    log(`  ${p.nombre} · ${p.rol}`)
  }

  /* 3. Formularios del catálogo, publicados y asignados. */
  paso('Formularios')
  const formularios = {}
  const claves = new Set([...Object.values(FORMULARIOS_POR_FAENA).flat(), ...FORMULARIOS_SUPERVISION])
  for (const k of claves) {
    const p = catalogo[k]
    if (!p) throw new Error(`El catálogo no tiene "${k}"`)
    const definicion = copiarDefinicion(p.definition)
    const borrador = await api(tAdmin, 'POST', '/templates', { name: p.nombre, definition: definicion })
    const pub = await api(tAdmin, 'POST', `/templates/revisions/${borrador.id}/publish`)
    formularios[k] = { clave: k, nombre: p.nombre, template_id: borrador.template_id, revision_id: pub.id ?? borrador.id, definition: definicion, cofirma: Boolean(definicion.closing?.require_supervisor_signature) }
    log(`  ${p.nombre}`)
  }
  for (const [fk, lista] of Object.entries(FORMULARIOS_POR_FAENA)) {
    for (const k of lista) await api(tAdmin, 'POST', '/templates/assignments', { revision_id: formularios[k].revision_id, site_id: faenas[fk].id, role: 'field_worker' })
    for (const k of FORMULARIOS_SUPERVISION) await api(tAdmin, 'POST', '/templates/assignments', { revision_id: formularios[k].revision_id, site_id: faenas[fk].id, role: 'supervisor' })
  }

  /* 4. Activos con QR. */
  paso('Activos y QR')
  const activos = []
  for (const a of ACTIVOS) {
    const creado = await api(tAdmin, 'POST', '/assets', { name: a.name, kind: a.kind, site_id: faenas[a.faena].id, template_id: formularios[a.formulario].template_id })
    activos.push({ ...a, id: creado.id, qr: creado.qr, faena_nombre: faenas[a.faena].name })
    log(`  ${a.name}`)
  }

  /* 5. Historia: inspecciones, hallazgos y bitácora, por persona y día. */
  paso(`Historia de ${SEMANAS} semanas`)
  const ctx = { tenantId: tenant.id, cuentas, faenas, formularios, activos }
  const { inspecciones, hallazgos, trabajadores, supervisores, dispositivos } = await generarHistoria(ctx, -SEMANAS * 7 + 1, null)

  /* 6. Supervisión: cofirmas, revisiones y gestión de hallazgos. */
  paso('Supervisión')
  const supDe = (fk) => supervisores.find((s) => s.faenas.includes(fk))
  let revisadas = 0
  for (const ins of inspecciones) {
    // Lo de los últimos 2 días queda por revisar; lo anterior, casi todo revisado.
    if (ins.capturedMs > AHORA - 2 * DIA || !prob(0.97)) continue
    const sup = supDe(ins.faena)
    if (ins.cofirma) await api(sup.token, 'POST', `/inspections/${ins.id}/signature`, { strokes: trazoFirma() })
    await api(sup.token, 'PATCH', `/inspections/${ins.id}/review`)
    revisadas++
  }
  log(`  ${revisadas} inspecciones revisadas`)

  const estados = await gestionarHallazgos(hallazgos, { trabajadores, supDe })
  log(`  hallazgos: ${JSON.stringify(estados)}`)

  /* 7. Conflictos: dos teléfonos corrigieron la misma respuesta. */
  paso('Conflictos de edición')
  const tieneNumero = (k) => formularios[k].definition.sections.some((s) => s.items.some((it) => it.response_type === 'numeric'))
  const recientes = inspecciones
    .filter((i) => AHORA - i.capturedMs < 6 * DIA && FORMULARIOS_POR_FAENA[i.faena].includes(i.formulario) && tieneNumero(i.formulario))
    .slice(-3)
  let conflictos = 0
  for (const ins of recientes) {
    const persona = cuentas[ins.autor]
    const item = formularios[ins.formulario].definition.sections.flatMap((s) => s.items).find((it) => it.response_type === 'numeric')
    if (!item) continue
    const respId = randomUUID()
    const base = { inspection_id: ins.id, template_item_id: item.id, value_ok: null, value_text: null }
    const v1 = registro(tenant.id, 'response', respId, ins.capturedMs + 5 * 60_000, { ...base, value_number: Number(item.props?.min ?? 0) + 4 })
    const v2 = registro(tenant.id, 'response', respId, ins.capturedMs + 3 * 60_000, { ...base, value_number: Number(item.props?.min ?? 0) + 7 }, 2)
    await api(persona.token, 'POST', '/sync/batch', { batch_id: randomUUID(), device_id: dispositivos[persona.clave], records: [v1] })
    await api(persona.token, 'POST', '/sync/batch', { batch_id: randomUUID(), device_id: randomUUID(), records: [v2] })
    conflictos++
  }
  const lista = await api(supervisores[0].token, 'GET', '/conflicts')
  const primero = (lista.items ?? lista)[0]
  if (primero) await api(supervisores[0].token, 'PATCH', `/conflicts/${primero.id}/review`)
  log(`  ${conflictos} conflictos (uno ya revisado)`)

  /* 8. Resúmenes con IA de semanas anteriores (si el servidor tiene IA). */
  const resumenes = []
  if (!SIN_IA) {
    paso('Resúmenes de Gerencia con IA')
    const hoyDow = diaSemana(0) || 7
    for (let semana = 1; semana <= 4; semana++) {
      const lunes = -((hoyDow - 1) + 7 * semana)
      const desde = iso(instante(lunes, 0, 0))
      const hasta = iso(instante(lunes + 7, 0, 0) - 1)
      try {
        await api(tAdmin, 'POST', '/dashboard/resumen-ia', { desde, hasta })
        resumenes.push(fechaCl(Date.parse(desde)))
      } catch (e) {
        log(`  (sin resumen de la semana ${semana}: ${e.status ?? ''} ${e.message.slice(0, 80)})`)
        if (e.status === 503 || e.status === 404) break
      }
    }
    log(`  ${resumenes.length} resúmenes guardados`)
  }

  /* 9. Archivo local con las cuentas (ignorado por Git). */
  const salida = {
    // Hasta cuándo llegan los datos (con --ahora, esa fecha): --continuar parte de aquí.
    generado: iso(AHORA),
    api: API,
    empresa: { nombre: EMPRESA, slug: SLUG, id: tenant.id },
    faenas: Object.values(faenas).map((f) => ({ nombre: f.name, id: f.id })),
    cuentas: Object.values(cuentas).map((c) => ({
      rol: c.rol,
      nombre: c.nombre,
      email: c.email,
      clave: c.password,
      faenas: c.faenas.map((k) => faenas[k].name),
    })),
    activos: activos.map((a) => ({ nombre: a.name, faena: a.faena_nombre, formulario: formularios[a.formulario].nombre, qr: a.qr })),
    resumen: { inspecciones: inspecciones.length, revisadas, hallazgos: hallazgos.length, ...estados, conflictos, resumenes_ia: resumenes.length },
  }
  writeFileSync(SALIDA, `${JSON.stringify(salida, null, 2)}\n`, { mode: 0o600 })
  paso('Listo')
  log(`  Cuentas, claves y códigos QR en ${SALIDA} (no se suben a Git).`)
  log(`  Gerencia: ${cuentas.gerente.email}`)
}

/* ── Modo --continuar (TSK-DEMO-003) ────────────────────────────────────
 *
 * La empresa ya existe y sus datos envejecen: cargada el día X, una semana
 * después "7 días" casi no muestra actividad y lo pendiente parece abandonado.
 * Esto agrega la actividad desde la última carga hasta ahora, con las mismas
 * cuentas (no pide la cuenta de plataforma), y hace lo que haría supervisión:
 * revisar lo enviado hace más de 2 días y cerrar parte de lo vencido.
 * Las claves, los QR impresos y los nombres no cambian.
 */
async function continuar(catalogo) {
  if (!existsSync(SALIDA)) throw new Error(`No existe ${SALIDA}: --continuar usa el archivo de cuentas de la carga anterior.`)
  const previo = JSON.parse(readFileSync(SALIDA, 'utf8'))
  if (previo.api && previo.api !== API) throw new Error(`Ese archivo es de ${previo.api}, no de ${API}.`)
  const desdeMs = Date.parse(previo.ultima_carga ?? previo.generado)
  if (!Number.isFinite(desdeMs)) throw new Error('El archivo de cuentas no dice cuándo fue la última carga.')
  if (desdeMs > AHORA - 60 * 60_000) throw new Error('La última carga fue hace menos de una hora: no hay actividad nueva que agregar.')
  // Otra secuencia de azar que la carga original (si no, repetiría los mismos días).
  semilla = (20261119 + Math.floor(AHORA / 60_000)) | 0
  log(`Continuar ${previo.empresa?.nombre ?? 'empresa'} desde ${iso(desdeMs)}`)

  paso('Cuentas')
  const cuentas = {}
  for (const c of previo.cuentas ?? []) {
    const p = PERSONAS.find((x) => x.nombre === c.nombre)
    if (!p) throw new Error(`La cuenta "${c.nombre}" no es de esta empresa de demostración.`)
    const token = await login(c.email, c.clave)
    const yo = await api(token, 'GET', '/me')
    cuentas[p.clave] = { ...p, email: c.email, password: c.clave, token, id: yo.id ?? yo.user?.id }
  }
  if (!cuentas.gerente) throw new Error('Falta la cuenta de administración en el archivo.')
  const tAdmin = cuentas.gerente.token
  log(`  ${Object.keys(cuentas).length} cuentas`)

  const faenas = {}
  for (const f of FAENAS) {
    const g = (previo.faenas ?? []).find((x) => x.nombre === f.name)
    if (!g) throw new Error(`Falta la faena "${f.name}" en el archivo.`)
    faenas[f.clave] = { ...f, id: g.id }
  }
  const claveFaena = Object.fromEntries(Object.entries(faenas).map(([k, f]) => [f.id, k]))

  const publicadas = (await api(tAdmin, 'GET', '/templates')).items ?? []
  const formularios = {}
  for (const k of new Set([...Object.values(FORMULARIOS_POR_FAENA).flat(), ...FORMULARIOS_SUPERVISION])) {
    const nombre = catalogo[k]?.nombre
    const rev = publicadas.filter((r) => r.name === nombre).sort((a, b) => b.version - a.version)[0]
    if (!rev) throw new Error(`No encontré publicado el formulario "${nombre}".`)
    formularios[k] = {
      clave: k,
      nombre,
      template_id: rev.template_id,
      revision_id: rev.revision_id,
      definition: rev.definition,
      cofirma: Boolean(rev.definition.closing?.require_supervisor_signature),
    }
  }
  const listaActivos = await api(tAdmin, 'GET', '/assets')
  const activos = ACTIVOS.flatMap((a) => {
    const x = (listaActivos.items ?? listaActivos).find((y) => y.name === a.name && y.status === 'active')
    return x ? [{ ...a, id: x.id }] : []
  })

  const primerDia = -Math.round((Date.parse(fechaCl(AHORA)) - Date.parse(fechaCl(desdeMs))) / DIA)
  paso(`Actividad desde la última carga (${1 - primerDia} días)`)
  const ctx = { tenantId: previo.empresa.id, cuentas, faenas, formularios, activos }
  const { inspecciones, hallazgos, trabajadores, supervisores } = await generarHistoria(ctx, primerDia, desdeMs)
  const supDe = (fk) => supervisores.find((sv) => sv.faenas.includes(fk))

  /* Supervisión: lo enviado hace más de 2 días (de esta carga o de la anterior). */
  paso('Supervisión')
  const cofirmaDe = new Map(Object.values(formularios).map((f) => [f.template_id, f.cofirma]))
  const enviadas = await api(tAdmin, 'GET', `/dashboard/inspections?status=submitted&desde=${encodeURIComponent(iso(AHORA - 120 * DIA))}`)
  let revisadas = 0
  for (const ins of enviadas.items ?? []) {
    if (Date.parse(ins.captured_at) > AHORA - 2 * DIA || !prob(0.97)) continue
    const sup = supDe(claveFaena[ins.faena_id])
    if (!sup) continue
    if (cofirmaDe.get(ins.template_id)) {
      try {
        await api(sup.token, 'POST', `/inspections/${ins.id}/signature`, { strokes: trazoFirma() })
      } catch (e) {
        if (e.status !== 409) throw e // ya estaba cofirmada
      }
    }
    await api(sup.token, 'PATCH', `/inspections/${ins.id}/review`)
    revisadas++
  }
  log(`  ${revisadas} inspecciones revisadas`)
  const estados = await gestionarHallazgos(hallazgos, { trabajadores, supDe })
  log(`  hallazgos nuevos: ${JSON.stringify(estados)}`)

  /* Lo de antes también avanza: se cierra parte de lo vencido y de lo ya reportado. */
  paso('Hallazgos de la carga anterior')
  const hoy = fechaCl(AHORA)
  let cerradosAntes = 0
  for (let offset = 0; ; offset += 200) {
    const pagina = await api(tAdmin, 'GET', `/dashboard/findings?limit=200&offset=${offset}&desde=${encodeURIComponent(iso(AHORA - 120 * DIA))}`)
    const items = pagina.items ?? []
    for (const f of items) {
      if (f.status === 'resolved' || Date.parse(f.captured_at) > desdeMs) continue
      const vencido = Boolean(f.due_date) && f.due_date < hoy
      const reportado = f.status === 'in_progress' && Boolean(f.reported_at)
      if (!((vencido && prob(0.7)) || (reportado && prob(0.5)))) continue
      const sup = supDe(claveFaena[f.faena_id])
      if (!sup) continue
      await api(sup.token, 'PATCH', `/findings/${f.id}`, { status: 'resolved', resolution_note: elegir(NOTAS_CIERRE) })
      cerradosAntes++
    }
    if (items.length < 200) break
  }
  log(`  ${cerradosAntes} cerrados`)

  /* Resumen con IA de la semana anterior completa (si el servidor tiene IA). */
  let resumenIa = 0
  if (!SIN_IA) {
    const hoyDow = diaSemana(0) || 7
    const lunes = -((hoyDow - 1) + 7)
    try {
      await api(tAdmin, 'POST', '/dashboard/resumen-ia', { desde: iso(instante(lunes, 0, 0)), hasta: iso(instante(lunes + 7, 0, 0) - 1) })
      resumenIa = 1
    } catch (e) {
      log(`  (sin resumen con IA: ${e.status ?? ''} ${String(e.message).slice(0, 80)})`)
    }
  }

  const salida = {
    ...previo,
    ultima_carga: iso(AHORA),
    continuaciones: [
      ...(previo.continuaciones ?? []),
      { fecha: iso(AHORA), desde: iso(desdeMs), inspecciones: inspecciones.length, hallazgos: hallazgos.length, revisadas, cerrados_antes: cerradosAntes, resumen_ia: resumenIa, ...estados },
    ],
  }
  writeFileSync(SALIDA, `${JSON.stringify(salida, null, 2)}\n`, { mode: 0o600 })
  paso('Listo')
  log(`  ${inspecciones.length} inspecciones y ${hallazgos.length} hallazgos nuevos; ${revisadas} revisadas; ${cerradosAntes} hallazgos de antes cerrados.`)
  log(`  Cuentas y QR sin cambios (${SALIDA}).`)
}

/**
 * Inspecciones, hallazgos y bitácora por persona y día, desde `primerDia`
 * (0 = hoy) hasta ahora. Con `desdeMs` (modo --continuar) sólo se envía lo
 * capturado después de esa hora, para no repetir lo de la carga anterior.
 */
async function generarHistoria({ tenantId, cuentas, faenas, formularios, activos }, primerDia, desdeMs) {
  const inspecciones = [] // { id, faena, autor, formulario, capturedMs }
  const hallazgos = [] // { id, faena, capturedMs, severity }
  const trabajadores = Object.values(cuentas).filter((c) => c.rol === 'field_worker')
  const supervisores = Object.values(cuentas).filter((c) => c.rol === 'supervisor')
  const dispositivos = Object.fromEntries(Object.values(cuentas).map((c) => [c.clave, randomUUID()]))
  let totalRegistros = 0

  for (let dia = primerDia; dia <= 0; dia++) {
    const dow = diaSemana(dia)
    const laboral = dow >= 1 && dow <= 5
    for (const persona of [...trabajadores, ...supervisores]) {
      if (!laboral && !prob(persona.rol === 'field_worker' ? 0.25 : 0.1)) continue
      const fk = elegir(persona.faenas)
      const faena = faenas[fk]
      const registros = []
      let ultimo = 0

      const nInspecciones =
        persona.rol === 'field_worker' ? ponderado([[0, 20], [1, 60], [2, 20]]) : ponderado([[0, 50], [1, 50]])
      for (let n = 0; n < nInspecciones; n++) {
        const hh = entre(7, 17)
        const capturedMs = instante(dia, hh, entre(0, 59))
        if (capturedMs > AHORA - 30 * 60_000 || (desdeMs !== null && capturedMs <= desdeMs)) continue
        const k = persona.rol === 'field_worker' ? elegir(FORMULARIOS_POR_FAENA[fk]) : elegir(FORMULARIOS_SUPERVISION)
        const f = formularios[k]
        const insId = randomUUID()
        const activo = activos.find((a) => a.faena === fk && a.formulario === k && prob(0.5))
        registros.push(
          registro(tenantId, 'inspection', insId, capturedMs, {
            site_id: faena.id,
            template_id: f.template_id,
            template_version: 1,
            executed_by: persona.id,
            status: 'submitted',
            location: null,
            requires_supervisor_signature: f.cofirma,
            signature_required: true,
            ...(activo ? { asset_id: activo.id } : {}),
          }),
        )
        const respuestas = []
        for (const item of f.definition.sections.flatMap((s) => s.items)) {
          const r = responder(item, capturedMs)
          if (!r) continue
          const respId = randomUUID()
          const { foto, ...valores } = r
          registros.push(registro(tenantId, 'response', respId, capturedMs + 60_000, { inspection_id: insId, template_item_id: item.id, ...valores }))
          respuestas.push([item.id, valores])
          if (foto) {
            const a = adjunto(tenantId, 'response', respId, capturedMs + 90_000, k)
            if (a) registros.push(a)
          }
          if (r.value_ok === 'nok' && (item.require_finding_on_nok || prob(0.5))) {
            const hId = randomUUID()
            const severity = ponderado([['low', 30], ['medium', 40], ['high', 22], ['critical', 8]])
            registros.push(
              registro(tenantId, 'finding', hId, capturedMs + 120_000, {
                inspection_id: insId,
                response_id: respId,
                severity,
                description: conSector(elegir(HALLAZGOS[k] ?? HALLAZGOS['seguridad-diaria']), faena.sectores),
                status: 'open',
              }),
            )
            hallazgos.push({ id: hId, faena: fk, capturedMs, severity })
            if (prob(0.6)) {
              const a = adjunto(tenantId, 'finding', hId, capturedMs + 150_000, k)
              if (a) registros.push(a)
            }
          }
        }
        const firmaMs = capturedMs + entre(8, 25) * 60_000
        registros.push(
          registro(tenantId, 'inspection_signature', randomUUID(), firmaMs, {
            inspection_id: insId,
            signer_id: persona.id,
            signer_role: 'inspector',
            strokes: trazoFirma(),
            content_hash: sha256(JSON.stringify(respuestas)),
            declaration_version: 'v1',
            signed_at: iso(firmaMs),
          }, 0),
        )
        inspecciones.push({ id: insId, faena: fk, autor: persona.clave, formulario: k, capturedMs, cofirma: f.cofirma })
        ultimo = Math.max(ultimo, firmaMs)
      }

      // Bitácora: relevo de supervisión y notas de terreno; algunas con alerta.
      const nNotas = persona.rol === 'supervisor' ? (laboral ? 1 : 0) : ponderado([[0, 35], [1, 50], [2, 15]])
      for (let n = 0; n < nNotas; n++) {
        const capturedMs = instante(dia, persona.rol === 'supervisor' ? entre(7, 8) : entre(8, 18), entre(0, 59))
        if (capturedMs > AHORA - 20 * 60_000 || (desdeMs !== null && capturedMs <= desdeMs)) continue
        const tag = persona.rol === 'supervisor' ? 'Relevo' : ponderado([['Seguridad', 30], ['Clima', 15], ['Equipos', 25], ['Incidencia', 15], ['Relevo', 15]])
        const leId = randomUUID()
        registros.push(
          registro(tenantId, 'log_entry', leId, capturedMs, {
            site_id: faena.id,
            author_id: persona.id,
            entry_text: conSector(elegir(BITACORA[tag]), faena.sectores),
            tags: [tag],
            shift_date: fechaCl(capturedMs),
          }),
        )
        if ((tag === 'Seguridad' || tag === 'Incidencia') && prob(0.3)) {
          const [severity, texto] = elegir(ALERTAS_BITACORA)
          const hId = randomUUID()
          registros.push(
            registro(tenantId, 'finding', hId, capturedMs + 60_000, {
              inspection_id: null,
              response_id: null,
              log_entry_id: leId,
              site_id: faena.id,
              severity,
              description: conSector(texto, faena.sectores),
              status: 'open',
            }),
          )
          hallazgos.push({ id: hId, faena: fk, capturedMs, severity, bitacora: true })
        }
        ultimo = Math.max(ultimo, capturedMs)
      }

      if (registros.length === 0) continue
      // Se sincroniza al volver la señal: minutos u horas después de capturar.
      const enviado = Math.min(AHORA - 60_000, ultimo + ponderado([[5, 40], [40, 30], [180, 20], [420, 10]]) * 60_000)
      for (const parte of partirLote(registros)) {
        const r = await api(persona.token, 'POST', '/sync/batch', {
          batch_id: randomUUID(),
          device_id: dispositivos[persona.clave],
          sent_at: iso(enviado),
          records: parte,
        })
        if (r.records_failed > 0) throw new Error(`Lote con fallos (${persona.nombre}, día ${dia}): ${(r.errors ?? []).join(' | ')}`)
        totalRegistros += r.records_ok
      }
    }
    process.stdout.write(`\r  día ${dia - primerDia + 1}/${1 - primerDia} · ${inspecciones.length} inspecciones · ${hallazgos.length} hallazgos`)
  }
  log(`\n  ${totalRegistros} registros sincronizados`)
  return { inspecciones, hallazgos, trabajadores, supervisores, dispositivos }
}

/** Asigna, hace avanzar y cierra los hallazgos según su edad (como en la operación real). */
async function gestionarHallazgos(hallazgos, { trabajadores, supDe }) {
  const estados = { abiertos: 0, asignados: 0, vencidos: 0, listos: 0, iniciados: 0, cerrados: 0 }
  for (const h of hallazgos) {
    const sup = supDe(h.faena)
    const edad = (AHORA - h.capturedMs) / DIA
    const responsable = elegir(trabajadores.filter((t) => t.faenas.includes(h.faena)))
    const asignar = edad > 10 ? prob(0.97) : edad > 4 ? prob(0.8) : prob(0.4)
    if (!asignar) {
      estados.abiertos++
      continue
    }
    const cerrar = edad > 10 ? prob(0.88) : edad > 5 ? prob(0.45) : false
    // Abiertos: plazo futuro salvo unos pocos vencidos a propósito. Cerrados: plazo de la época.
    const vencido = !cerrar && edad > 6 && prob(0.15)
    const plazo = fechaCl(cerrar ? h.capturedMs + entre(3, 10) * DIA : vencido ? AHORA - entre(1, 4) * DIA : AHORA + entre(2, 12) * DIA)
    await api(sup.token, 'PATCH', `/findings/${h.id}`, { assignee_id: responsable.id, due_date: plazo })
    estados.asignados++
    const avance = cerrar ? prob(0.6) : edad > 4 ? ponderado([['nada', 35], ['iniciar', 30], ['reportar', 35]]) : 'nada'
    if (avance === 'iniciar' || avance === 'reportar' || avance === true) {
      await api(responsable.token, 'PATCH', `/findings/${h.id}/avance`, { accion: 'iniciar' })
      if (avance === 'reportar' || avance === true) {
        await api(responsable.token, 'PATCH', `/findings/${h.id}/avance`, { accion: 'reportar', nota: elegir(REPORTES) })
        if (!cerrar) estados.listos++
      } else if (!cerrar) estados.iniciados++
    }
    if (cerrar) {
      await api(sup.token, 'PATCH', `/findings/${h.id}`, { status: 'resolved', resolution_note: elegir(NOTAS_CIERRE) })
      estados.cerrados++
    } else if (vencido) estados.vencidos++
  }
  return estados
}

/**
 * Parte un lote por cantidad (≤ 400 de los 500 permitidos) y por tamaño
 * (≤ ~20 MB de los 32 MB que acepta el servidor), sin separar el orden: el
 * servidor ordena cada lote por tipo de entidad.
 */
function partirLote(registros) {
  const partes = []
  let actual = []
  let bytes = 0
  for (const r of registros) {
    const tam = JSON.stringify(r).length
    if (actual.length && (actual.length >= 400 || bytes + tam > 20 * 1024 * 1024)) {
      partes.push(actual)
      actual = []
      bytes = 0
    }
    actual.push(r)
    bytes += tam
  }
  if (actual.length) partes.push(actual)
  return partes
}

/** Copia una definición del catálogo con ids nuevos (como `duplicarDefinicion`). */
function copiarDefinicion(def) {
  return {
    ...def,
    ...(def.closing ? { closing: { ...def.closing } } : {}),
    sections: def.sections.map((s) => ({ ...s, id: randomUUID(), items: s.items.map((i) => ({ ...structuredClone(i), id: randomUUID() })) })),
  }
}

main().catch((e) => {
  console.error(`\n✖ ${e.message}`)
  if (process.env.DEMO_DEPURAR) console.error(e.stack)
  process.exit(1)
})
