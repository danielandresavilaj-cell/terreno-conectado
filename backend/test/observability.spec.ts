import { describe, expect, it } from 'vitest'
import { JsonLogger, type JsonLogEntry } from '../src/observability/json.logger'
import { requestContext } from '../src/observability/request-context'

/**
 * TSK-WS-012 — Observabilidad (NFR-09).
 *
 * Verifica el formato de los logs estructurados JSON:
 *  - cada línea parsea como JSON con ts/level/message y SIEMPRE `request_id`
 *    y `tenant_id` (null fuera de un request);
 *  - el contexto AsyncLocalStorage inyecta la correlación del request en los
 *    logs de servicios emitidos durante su manejo;
 *  - niveles: filtrado por `LOG_LEVEL`, error/fatal → stderr, log/warn/debug → stdout;
 *  - `silent` (usado en tests/demo) no emite nada.
 */

function captor() {
  const lines: Array<{ stream: 'stdout' | 'stderr'; entry: JsonLogEntry }> = []
  const logger = new JsonLogger({
    nivel: 'info',
    write: (line, stream) => lines.push({ stream, entry: JSON.parse(line) as JsonLogEntry }),
  })
  return { lines, logger }
}

describe('JsonLogger (NFR-09)', () => {
  it('emite una línea JSON por evento con ts/level/message y correlación por defecto', () => {
    const { lines, logger } = captor()
    logger.log('servicio iniciado', 'HealthService')

    expect(lines).toHaveLength(1)
    const e = lines[0].entry
    expect(typeof e.ts).toBe('string')
    expect(new Date(e.ts).getTime()).not.toBeNaN()
    expect(e.level).toBe('info')
    expect(e.message).toBe('servicio iniciado')
    expect(e.context).toBe('HealthService')
    // NFR-09: la correlación está SIEMPRE presente (null fuera de request).
    expect(e.request_id).toBeNull()
    expect(e.tenant_id).toBeNull()
    expect(lines[0].stream).toBe('stdout')
  })

  it('en contexto de request inyecta request_id y tenant_id en los logs de servicios', async () => {
    const { lines, logger } = captor()
    await requestContext.run({ requestId: 'req-123', tenantId: 'tenant-A' }, () =>
      Promise.resolve(logger.warn('lote rechazado', 'SyncService')),
    )

    expect(lines).toHaveLength(1)
    expect(lines[0].entry.request_id).toBe('req-123')
    expect(lines[0].entry.tenant_id).toBe('tenant-A')
    expect(lines[0].entry.level).toBe('warn')
  })

  it('http() emite el access log con la correlación explícita y metadata', () => {
    const { lines, logger } = captor()
    logger.http({
      method: 'POST',
      path: '/api/v1/sync/batch',
      status: 409,
      duration_ms: 12,
      requestId: 'req-456',
      tenantId: 'tenant-B',
    })

    expect(lines).toHaveLength(1)
    const e = lines[0].entry
    expect(e.request_id).toBe('req-456')
    expect(e.tenant_id).toBe('tenant-B')
    expect(e.message).toContain('HTTP POST /api/v1/sync/batch 409')
    expect(e.data).toEqual({ method: 'POST', path: '/api/v1/sync/batch', status: 409, duration_ms: 12 })
  })

  it('error() con stack incluye el stack a stderr; log con objeto guarda data', () => {
    const { lines, logger } = captor()

    logger.error('falló la DB', new Error('ECONNREFUSED'), 'SyncService')
    const errorEntry = lines.at(-1)!
    expect(errorEntry.stream).toBe('stderr')
    expect(errorEntry.entry.level).toBe('error')
    expect(errorEntry.entry.stack).toContain('ECONNREFUSED')
    expect(errorEntry.entry.context).toBe('SyncService')

    logger.log({ op: 'seed', filas: 3 }, 'DbService')
    const dataEntry = lines.at(-1)!
    expect(dataEntry.entry.data).toEqual({ op: 'seed', filas: 3 })
    expect(dataEntry.entry.message).not.toBe('[object Object]')
  })

  it('respeta el nivel umbral de LOG_LEVEL', () => {
    const lines: Array<{ stream: string; entry: JsonLogEntry }> = []
    const debug = new JsonLogger({
      nivel: 'debug',
      write: (line, stream) => lines.push({ stream, entry: JSON.parse(line) as JsonLogEntry }),
    })
    debug.debug('detalle')
    debug.verbose('muy detalle') // verbose→trace < umbral debug → filtrado
    expect(lines.map((l) => l.entry.level)).toEqual(['debug'])
  })

  it('nivel silent no emite nada (tests/demo)', () => {
    const lines: Array<{ stream: string; entry: JsonLogEntry }> = []
    const silent = new JsonLogger({
      nivel: 'silent',
      write: (line, stream) => lines.push({ stream, entry: JSON.parse(line) as JsonLogEntry }),
    })
    silent.log('x')
    silent.error('y')
    silent.fatal?.('z')
    expect(lines).toHaveLength(0)
  })
})