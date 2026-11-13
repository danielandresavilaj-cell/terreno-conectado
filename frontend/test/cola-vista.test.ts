/* Cola legible — TSK-OFF-006: agrupación por unidad de trabajo y lenguaje claro. */
import { describe, expect, it } from 'vitest'
import type { TemplateDefinition } from '@terreno/shared'
import { armarVistaCola, cuandoLegible, estadoAgregado, mensajeError, valorLegible, type EntradaVistaCola } from '../src/lib/cola-vista'
import type { InspectionRow, OutboxRow, ResponseRow } from '../src/lib/db'

const AHORA = new Date(2026, 10, 13, 15, 0, 0)
const iso = (horasAtras: number) => new Date(AHORA.getTime() - horasAtras * 3600_000).toISOString()
const ITEM_FRENOS = '11111111-1111-4111-8111-111111111111'
const ITEM_KM = '22222222-2222-4222-8222-222222222222'
const ITEM_FECHA = '33333333-3333-4333-8333-333333333333'

const definicion: TemplateDefinition = {
  sections: [
    {
      title: 'Motor',
      items: [
        { id: ITEM_FRENOS, prompt: '¿Frenos operativos?', response_type: 'ok_nok_na' },
        { id: ITEM_KM, prompt: 'Kilometraje', response_type: 'numeric' },
        { id: ITEM_FECHA, prompt: 'Fecha revisión técnica', response_type: 'date' },
      ],
    },
  ],
}

let id = 1
function fila(entityType: OutboxRow['entityType'], entityId: string, status: OutboxRow['status'], horas = 1, extra: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: id++,
    entityType,
    entityId,
    tipo: 'inspeccion',
    titulo: 't',
    detalle: 'd',
    batchOrder: 1,
    status,
    retries: 0,
    tenantId: 'T',
    capturedAt: iso(horas),
    updatedAt: iso(horas),
    ...extra,
  }
}

const inspeccion: InspectionRow = {
  id: 'insp-1',
  tenantId: 'T',
  siteId: 'S',
  templateId: 'tpl',
  templateVersion: 1,
  templateRevisionId: 'rev-1',
  executedBy: 'U',
  status: 'submitted',
  capturedAt: iso(2),
  syncedAt: null,
  clientVersion: 2,
  templateName: 'Checklist camioneta',
  siteName: 'Faena Norte',
  answeredCount: 3,
  totalItems: 3,
}

const resp = (rid: string, itemId: string, v: Partial<ResponseRow>): ResponseRow => ({
  id: rid,
  inspectionId: 'insp-1',
  templateItemId: itemId,
  tenantId: 'T',
  valueOk: null,
  valueText: null,
  valueNumber: null,
  capturedAt: iso(2),
  clientVersion: 1,
  ...v,
})

function entrada(over: Partial<EntradaVistaCola> = {}): EntradaVistaCola {
  return {
    outbox: [],
    inspecciones: [inspeccion],
    respuestas: [
      resp('r1', ITEM_FRENOS, { valueOk: 'nok' }),
      resp('r2', ITEM_KM, { valueNumber: 12500 }),
      resp('r3', 'item-que-no-existe', { valueText: 'algo' }),
    ],
    hallazgos: [
      { id: 'h1', inspectionId: 'insp-1', responseId: 'r1', tenantId: 'T', severity: 'critical', description: 'Fuga en freno trasero', status: 'open', capturedAt: iso(2), clientVersion: 1 },
      { id: 'h2', inspectionId: null, responseId: null, tenantId: 'T', severity: 'medium', description: 'Baranda suelta', status: 'open', capturedAt: iso(3), clientVersion: 1 },
    ],
    adjuntos: [
      { id: 'a1', tenantId: 'T', ownerType: 'finding', ownerId: 'h1', mime: 'image/jpeg', bytes: 200 * 1024, ancho: 1280, alto: 960, capturedAt: iso(2), clientVersion: 1 },
    ],
    bitacoras: [{ id: 'b1', siteId: 'S', authorId: 'U', tenantId: 'T', entryText: 'Lluvia fuerte en el turno', tags: ['Clima'], shiftDate: '2026-11-13', capturedAt: iso(1), clientVersion: 1 }],
    definiciones: { 'rev-1': definicion },
    ...over,
  }
}

describe('cola legible', () => {
  it('agrupa una inspección con sus respuestas, hallazgos y fotos en UNA tarjeta legible', () => {
    const v = armarVistaCola(
      entrada({
        outbox: [
          fila('inspection', 'insp-1', 'synced'),
          fila('response', 'r1', 'pending'),
          fila('response', 'r2', 'pending'),
          fila('response', 'r3', 'pending'),
          fila('finding', 'h1', 'pending'),
          fila('attachment', 'a1', 'pending'),
          fila('log_entry', 'b1', 'pending'),
          fila('finding', 'h2', 'pending'),
        ],
      }),
      AHORA,
    )
    expect(v.enviosPendientes).toBe(3) // inspección + bitácora + hallazgo suelto, no 8 filas
    const g = v.pendientes.find((x) => x.tipo === 'inspeccion')!
    expect(g.titulo).toBe('Checklist camioneta')
    expect(g.subtitulo).toMatch(/^Faena Norte · hoy \d\d:\d\d$/)
    expect(g.resumen).toEqual(['3 respuestas', '1 hallazgo (1 grave)', '1 foto (200 KB)'])
    expect(g.partes).toEqual({ total: 6, enviadas: 1, fallidas: 0 })
    expect(g.outboxDescartable).toBeNull() // la inspección ya se envió: no se descarta a medias
    const lineas = g.detalle.map((l) => [l.texto, l.valor])
    expect(lineas).toEqual([
      ['¿Frenos operativos?', 'No OK'],
      ['Kilometraje', (12500).toLocaleString('es-CL')],
      ['Pregunta no disponible en este dispositivo', 'algo'],
      ['Hallazgo de severidad crítica', 'Fuga en freno trasero'],
      ['Foto del hallazgo', '200 KB'],
    ])
    expect(v.pendientes.find((x) => x.tipo === 'hallazgo')?.titulo).toBe('Hallazgo de severidad media')
    expect(v.pendientes.find((x) => x.tipo === 'bitacora')?.resumen).toEqual(['Lluvia fuerte en el turno'])
  })

  it('un fallo manda: la tarjeta va a "Con problemas" con el motivo legible y se puede descartar', () => {
    const v = armarVistaCola(
      entrada({
        outbox: [
          fila('inspection', 'insp-1', 'failed', 1, { retries: 2, lastError: 'inspection:9f1c2d3e-1111-4111-8111-111111111111: site_id no pertenece al tenant' }),
          fila('response', 'r1', 'pending'),
        ],
      }),
      AHORA,
    )
    expect(v.conProblemas).toHaveLength(1)
    const g = v.conProblemas[0]
    expect(g.estado).toBe('failed')
    expect(g.error).toBe('El servidor rechazó un dato: site_id no pertenece al tenant')
    expect(g.error).not.toMatch(/9f1c2d3e/)
    expect(g.outboxDescartable).not.toBeNull()
    expect(g.reintentoAt).toBe(new Date(iso(1)).getTime() + 4000) // backoff 2^2 s
  })

  it('"Enviado" sólo muestra las últimas 24 h y el último envío', () => {
    const v = armarVistaCola(
      entrada({
        outbox: [fila('log_entry', 'b1', 'synced', 2), fila('inspection', 'insp-1', 'synced', 30)],
      }),
      AHORA,
    )
    expect(v.enviosPendientes).toBe(0)
    expect(v.enviadoHoy.map((g) => g.tipo)).toEqual(['bitacora'])
    expect(v.ultimoEnvioAt).toBe(iso(2))
  })

  it('apoyos: estado agregado, errores, fechas y valores', () => {
    expect(estadoAgregado(['synced', 'pending', 'syncing'])).toBe('syncing')
    expect(estadoAgregado(['synced', 'failed', 'syncing'])).toBe('failed')
    expect(estadoAgregado(['synced'])).toBe('synced')
    expect(mensajeError('Sin conexión con el servidor')).toMatch(/^Sin conexión/)
    expect(mensajeError('Tu sesión expiró')).toMatch(/vuelve a ingresar/)
    expect(mensajeError(undefined)).toBeNull()
    expect(cuandoLegible(iso(24 + 15), AHORA)).toMatch(/^ayer|^\d\d-\d\d-2026/)
    expect(valorLegible(resp('x', ITEM_FECHA, { valueJson: '2026-11-05' }), 'date')).toBe('05-11-2026')
    expect(valorLegible(resp('x', 'i', { valueJson: ['Día', 'Noche'] }), 'select_multiple')).toBe('Día; Noche')
    expect(valorLegible(resp('x', 'i', {}), 'text')).toBe('Sin respuesta')
  })
})
