/**
 * Cola legible — TSK-OFF-006.
 *
 * El outbox guarda una fila por registro técnico (inspección, cada respuesta,
 * cada hallazgo, cada foto). Para la persona eso es ruido: lo que importa es
 * "la inspección que hice" o "la bitácora que escribí". Este módulo agrupa las
 * filas por UNIDAD DE TRABAJO, calcula un estado y un avance por grupo, y
 * traduce todo a lenguaje claro (pregunta en vez de ID, severidad en español,
 * motivo del fallo sin UUIDs).
 *
 * Es una función pura sobre datos ya leídos de Dexie: no toca la cola ni el
 * orden de envío (FR-020/021/022 intactos) y se prueba sin navegador.
 */
import type { TemplateDefinition } from '@terreno/shared'
import type {
  AttachmentRow,
  SyncEstado,
  FindingRow,
  InspectionRow,
  LogEntryRow,
  OutboxRow,
  ResponseRow,
  Severity,
} from './db'

/** Metadatos de un adjunto, sin el blob (la miniatura se lee aparte). */
export type AdjuntoMeta = Omit<AttachmentRow, 'blob'>

export interface EntradaVistaCola {
  outbox: OutboxRow[]
  inspecciones: InspectionRow[]
  respuestas: ResponseRow[]
  hallazgos: FindingRow[]
  adjuntos: AdjuntoMeta[]
  bitacoras: LogEntryRow[]
  /** Definición congelada por `revision_id` (caché de plantillas del dispositivo). */
  definiciones: Record<string, TemplateDefinition>
}

export type TipoGrupo = 'inspeccion' | 'bitacora' | 'hallazgo' | 'foto'

export interface LineaDetalle {
  clave: string
  tipo: 'respuesta' | 'hallazgo' | 'foto' | 'bitacora'
  texto: string
  valor: string
  estado: SyncEstado
  /** Sólo fotos: id del adjunto para leer la miniatura al abrir el detalle. */
  adjuntoId?: string
  /** Sólo hallazgos: severidad para el color. */
  severidad?: Severity
}

export interface GrupoCola {
  clave: string
  tipo: TipoGrupo
  titulo: string
  /** "Faena Norte · hoy 14:32" */
  subtitulo: string
  resumen: string[]
  estado: SyncEstado
  partes: { total: number; enviadas: number; fallidas: number }
  /** Motivo legible del último fallo del grupo, si lo hay. */
  error: string | null
  /** Instante (epoch ms) estimado del próximo reintento automático; null = sin fallo. */
  reintentoAt: number | null
  /** Fila que permite descartar la unidad completa (inspección o bitácora). */
  outboxDescartable: number | null
  capturadoAt: string
  /** Última vez que una parte del grupo cambió de estado. */
  actualizadoAt: string
  /** Claves `entityType:entityId` de sus filas (para el barrido de confirmación). */
  claves: string[]
  detalle: LineaDetalle[]
}

export interface VistaCola {
  conProblemas: GrupoCola[]
  pendientes: GrupoCola[]
  enviadoHoy: GrupoCola[]
  /** Envíos (grupos) que aún no terminan; no partes técnicas. */
  enviosPendientes: number
  ultimoEnvioAt: string | null
}

export const SEVERIDAD_ES: Record<Severity, string> = {
  low: 'baja',
  medium: 'media',
  high: 'alta',
  critical: 'crítica',
}

const PESO: Record<SyncEstado, number> = { failed: 3, syncing: 2, pending: 1, synced: 0 }
const DIA_MS = 24 * 3600_000
const MIN_MS = 60_000
/** Mismo cálculo que `backoffMs` de `lib/sync.ts` (se duplica para no arrastrar el worker a la vista). */
const backoff = (intentos: number) => Math.min(1000 * 2 ** intentos, 5 * 60_000)

/** Peor estado de un conjunto: un fallo manda sobre todo lo demás. */
export function estadoAgregado(estados: SyncEstado[]): SyncEstado {
  return estados.reduce<SyncEstado>((peor, e) => (PESO[e] > PESO[peor] ? e : peor), 'synced')
}

const RE_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

/** `lastError` técnico → frase que la persona entiende y sabe qué hacer. */
export function mensajeError(lastError: string | null | undefined): string | null {
  if (!lastError) return null
  const t = lastError.trim()
  if (/sin conexi|failed to fetch|network|timeout|tard[oó]/i.test(t)) {
    return 'Sin conexión: se vuelve a intentar solo cuando haya señal.'
  }
  if (/sesi[oó]n expir|401|no autenticad/i.test(t)) {
    return 'Tu sesión expiró: vuelve a ingresar y se envía solo.'
  }
  const limpio = t
    .replace(/^[a-z_]+:/i, '')
    .replace(RE_UUID, '')
    .replace(/^[\s:·-]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return limpio ? `El servidor rechazó un dato: ${limpio}` : 'El servidor rechazó un dato de este envío.'
}

/** "hoy 14:32", "ayer 09:10" o "05-11-2026 14:32" (hora local del dispositivo). */
export function cuandoLegible(iso: string, ahora: Date): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dif = Math.round((dia(ahora) - dia(d)) / DIA_MS)
  if (dif === 0) return `hoy ${hh}`
  if (dif === 1) return `ayer ${hh}`
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()} ${hh}`
}

/** "hace 2 min", "hace 3 h"… para el último envío. */
export function haceLegible(iso: string, ahora: Date): string {
  const ms = ahora.getTime() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < MIN_MS) return 'hace un momento'
  if (ms < 3600_000) return `hace ${Math.round(ms / MIN_MS)} min`
  if (ms < DIA_MS) return `hace ${Math.round(ms / 3600_000)} h`
  return `hace ${Math.round(ms / DIA_MS)} d`
}

function fechaCorta(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v
}

/** Valor capturado → texto ("OK", "No OK", "12,5", "05-11-2026", "Día; Noche"). */
export function valorLegible(r: ResponseRow, tipo: string | undefined): string {
  if (r.valueOk === 'ok') return 'OK'
  if (r.valueOk === 'nok') return 'No OK'
  if (r.valueOk === 'na') return 'N/A'
  if (typeof r.valueNumber === 'number') return r.valueNumber.toLocaleString('es-CL')
  if (Array.isArray(r.valueJson)) return r.valueJson.join('; ') || 'Sin respuesta'
  if (typeof r.valueJson === 'string' && r.valueJson) return tipo === 'date' ? fechaCorta(r.valueJson) : r.valueJson
  if (r.valueText) return r.valueText
  if (tipo === 'photo' || r.valuePhoto) return 'Foto adjunta'
  return 'Sin respuesta'
}

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`
const mb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB` : kb(bytes))
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

interface Acumulado {
  clave: string
  tipo: TipoGrupo
  filas: OutboxRow[]
  detalle: LineaDetalle[]
  inspeccion?: InspectionRow
  bitacora?: LogEntryRow
  hallazgo?: FindingRow
  capturadoAt: string
}

export function armarVistaCola(e: EntradaVistaCola, ahora: Date = new Date()): VistaCola {
  const insp = new Map(e.inspecciones.map((x) => [x.id, x]))
  const resp = new Map(e.respuestas.map((x) => [x.id, x]))
  const hall = new Map(e.hallazgos.map((x) => [x.id, x]))
  const adj = new Map(e.adjuntos.map((x) => [x.id, x]))
  const bit = new Map(e.bitacoras.map((x) => [x.id, x]))

  // Pregunta y tipo por ítem, desde la definición congelada de cada inspección.
  const itemDe = (i: InspectionRow | undefined, itemId: string) => {
    const def = i?.templateRevisionId ? e.definiciones[i.templateRevisionId] : undefined
    for (const s of def?.sections ?? []) for (const it of s.items) if (it.id === itemId) return it
    return undefined
  }

  /** Grupo al que pertenece cada fila del outbox. */
  const grupoDe = (f: OutboxRow): { clave: string; tipo: TipoGrupo } => {
    switch (f.entityType) {
      case 'inspection':
        return { clave: `inspeccion:${f.entityId}`, tipo: 'inspeccion' }
      case 'response': {
        const r = resp.get(f.entityId)
        return r ? { clave: `inspeccion:${r.inspectionId}`, tipo: 'inspeccion' } : { clave: `suelto:${f.entityId}`, tipo: 'inspeccion' }
      }
      case 'finding': {
        const h = hall.get(f.entityId)
        return h?.inspectionId ? { clave: `inspeccion:${h.inspectionId}`, tipo: 'inspeccion' } : { clave: `hallazgo:${f.entityId}`, tipo: 'hallazgo' }
      }
      case 'log_entry':
        return { clave: `bitacora:${f.entityId}`, tipo: 'bitacora' }
      case 'attachment': {
        const a = adj.get(f.entityId)
        if (a?.ownerType === 'response') {
          const r = resp.get(a.ownerId)
          if (r) return { clave: `inspeccion:${r.inspectionId}`, tipo: 'inspeccion' }
        } else if (a?.ownerType === 'finding') {
          const h = hall.get(a.ownerId)
          if (h?.inspectionId) return { clave: `inspeccion:${h.inspectionId}`, tipo: 'inspeccion' }
          if (h) return { clave: `hallazgo:${h.id}`, tipo: 'hallazgo' }
        } else if (a?.ownerType === 'log_entry') {
          return { clave: `bitacora:${a.ownerId}`, tipo: 'bitacora' }
        } else if (a?.ownerType === 'inspection') {
          return { clave: `inspeccion:${a.ownerId}`, tipo: 'inspeccion' }
        }
        return { clave: `foto:${f.entityId}`, tipo: 'foto' }
      }
    }
  }

  const grupos = new Map<string, Acumulado>()
  for (const f of e.outbox) {
    const { clave, tipo } = grupoDe(f)
    let g = grupos.get(clave)
    if (!g) {
      const id = clave.slice(clave.indexOf(':') + 1)
      g = {
        clave,
        tipo,
        filas: [],
        detalle: [],
        inspeccion: tipo === 'inspeccion' ? insp.get(id) : undefined,
        bitacora: tipo === 'bitacora' ? bit.get(id) : undefined,
        hallazgo: tipo === 'hallazgo' ? hall.get(id) : undefined,
        capturadoAt: f.capturedAt,
      }
      grupos.set(clave, g)
    }
    g.filas.push(f)
    if (f.capturedAt < g.capturadoAt) g.capturadoAt = f.capturedAt

    // Línea legible de la parte.
    if (f.entityType === 'response') {
      const r = resp.get(f.entityId)
      const it = r ? itemDe(g.inspeccion, r.templateItemId) : undefined
      g.detalle.push({
        clave: `response:${f.entityId}`,
        tipo: 'respuesta',
        texto: it?.prompt ?? 'Pregunta no disponible en este dispositivo',
        valor: r ? valorLegible(r, it?.response_type) : '—',
        estado: f.status,
      })
    } else if (f.entityType === 'finding') {
      const h = hall.get(f.entityId)
      g.detalle.push({
        clave: `finding:${f.entityId}`,
        tipo: 'hallazgo',
        texto: h ? `Hallazgo de severidad ${SEVERIDAD_ES[h.severity]}` : 'Hallazgo',
        valor: h?.description?.trim() || 'Sin descripción',
        estado: f.status,
        severidad: h?.severity,
      })
    } else if (f.entityType === 'attachment') {
      const a = adj.get(f.entityId)
      const deHallazgo = a?.ownerType === 'finding'
      g.detalle.push({
        clave: `attachment:${f.entityId}`,
        tipo: 'foto',
        texto: deHallazgo ? 'Foto del hallazgo' : 'Foto de la respuesta',
        valor: a ? kb(a.bytes) : 'Foto',
        estado: f.status,
        adjuntoId: f.entityId,
      })
    } else if (f.entityType === 'log_entry') {
      const b = bit.get(f.entityId)
      g.detalle.push({
        clave: `log_entry:${f.entityId}`,
        tipo: 'bitacora',
        texto: b?.tags?.length ? b.tags.join(' · ') : 'Bitácora de turno',
        valor: b?.entryText?.trim() || f.detalle,
        estado: f.status,
      })
    }
  }

  const terminados: GrupoCola[] = []
  const conProblemas: GrupoCola[] = []
  const pendientes: GrupoCola[] = []
  let ultimoEnvioAt: string | null = null

  for (const g of grupos.values()) {
    const estados = g.filas.map((f) => f.status)
    const estado = estadoAgregado(estados)
    const enviadas = estados.filter((s) => s === 'synced').length
    const fallidas = g.filas.filter((f) => f.status === 'failed')
    const actualizadoAt = g.filas.reduce((m, f) => (f.updatedAt > m ? f.updatedAt : m), g.filas[0].updatedAt)
    for (const f of g.filas) if (f.status === 'synced' && (!ultimoEnvioAt || f.updatedAt > ultimoEnvioAt)) ultimoEnvioAt = f.updatedAt

    // El motivo del fallo más reciente y su próximo reintento estimado.
    const ultimoFallo = fallidas.reduce<OutboxRow | null>((m, f) => (!m || f.updatedAt > m.updatedAt ? f : m), null)
    const reintentoAt = ultimoFallo ? new Date(ultimoFallo.updatedAt).getTime() + backoff(ultimoFallo.retries ?? 0) : null

    const raiz = g.filas.find((f) => f.entityType === 'inspection' || f.entityType === 'log_entry')
    const outboxDescartable = raiz && (raiz.status === 'pending' || raiz.status === 'failed') ? (raiz.id ?? null) : null

    const respuestas = g.detalle.filter((d) => d.tipo === 'respuesta').length
    const hallazgos = g.detalle.filter((d) => d.tipo === 'hallazgo')
    const criticos = hallazgos.filter((d) => d.severidad === 'critical' || d.severidad === 'high').length
    const fotos = g.filas.filter((f) => f.entityType === 'attachment')
    const bytesFotos = fotos.reduce((n, f) => n + (adj.get(f.entityId)?.bytes ?? 0), 0)

    let titulo: string
    let lugar: string | null = null
    const resumen: string[] = []
    if (g.tipo === 'inspeccion') {
      titulo = g.inspeccion?.templateName || 'Inspección'
      lugar = g.inspeccion?.siteName ?? null
      if (respuestas) resumen.push(plural(respuestas, 'respuesta', 'respuestas'))
      if (hallazgos.length)
        resumen.push(`${plural(hallazgos.length, 'hallazgo', 'hallazgos')}${criticos ? ` (${criticos} ${criticos === 1 ? 'grave' : 'graves'})` : ''}`)
    } else if (g.tipo === 'bitacora') {
      titulo = 'Bitácora de turno'
      const b = g.bitacora
      if (b?.entryText) resumen.push(b.entryText.trim().slice(0, 80) + (b.entryText.trim().length > 80 ? '…' : ''))
    } else if (g.tipo === 'hallazgo') {
      titulo = g.hallazgo ? `Hallazgo de severidad ${SEVERIDAD_ES[g.hallazgo.severity]}` : 'Hallazgo'
      if (g.hallazgo?.description) resumen.push(g.hallazgo.description.trim().slice(0, 80))
    } else {
      titulo = 'Foto'
    }
    if (fotos.length) resumen.push(`${plural(fotos.length, 'foto', 'fotos')} (${mb(bytesFotos)})`)

    const vista: GrupoCola = {
      clave: g.clave,
      tipo: g.tipo,
      titulo,
      subtitulo: [lugar, cuandoLegible(g.capturadoAt, ahora)].filter(Boolean).join(' · '),
      resumen,
      estado,
      partes: { total: g.filas.length, enviadas, fallidas: fallidas.length },
      error: mensajeError(ultimoFallo?.lastError) ?? (ultimoFallo ? 'No se pudo enviar este registro.' : null),
      reintentoAt,
      outboxDescartable,
      capturadoAt: g.capturadoAt,
      actualizadoAt,
      claves: g.filas.map((f) => `${f.entityType}:${f.entityId}`),
      // Orden de lectura: respuestas, hallazgos, fotos (como en la captura).
      detalle: [...g.detalle].sort((a, b) => ORDEN_LINEA[a.tipo] - ORDEN_LINEA[b.tipo]),
    }
    if (estado === 'failed') conProblemas.push(vista)
    else if (estado === 'synced') terminados.push(vista)
    else pendientes.push(vista)
  }

  const masRecientePrimero = (a: GrupoCola, b: GrupoCola) => (a.capturadoAt < b.capturadoAt ? 1 : -1)
  const enviadoHoy = terminados
    .filter((g) => ahora.getTime() - new Date(g.actualizadoAt).getTime() < DIA_MS)
    .sort((a, b) => (a.actualizadoAt < b.actualizadoAt ? 1 : -1))
  return {
    conProblemas: conProblemas.sort(masRecientePrimero),
    pendientes: pendientes.sort(masRecientePrimero),
    enviadoHoy,
    enviosPendientes: conProblemas.length + pendientes.length,
    ultimoEnvioAt,
  }
}

const ORDEN_LINEA: Record<LineaDetalle['tipo'], number> = { bitacora: 0, respuesta: 1, hallazgo: 2, foto: 3 }
