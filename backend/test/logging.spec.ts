import { describe, expect, it } from 'vitest'
import { JsonLogger, logStore } from '../src/logging/json-logger'

/**
 * TSK-WS-012 - JsonLogger (NFR-09): cada linea sale como JSON con
 * ts/level/msg/context y trae request_id + tenant_id del AsyncLocalStorage.
 */
describe('JsonLogger (NFR-09)', () => {
  it('emite JSON con los 6 campos y hereda el contexto del trace', () => {
    const writes: string[] = []
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: unknown) => {
      writes.push(String(chunk))
      return true
    }) as unknown as typeof process.stdout.write

    try {
      logStore.run({ request_id: 'r-42', tenant_id: 't-7' }, () => {
        new JsonLogger().log('hola', 'HealthService')
      })
      logStore.run({ request_id: null, tenant_id: null }, () => {
        new JsonLogger().error('boom', 'SyncService')
      })
      new JsonLogger().warn('sin request', 'AppController')
    } finally {
      process.stdout.write = original
    }

    expect(writes).toHaveLength(3)

    const first = JSON.parse(writes[0]) as Record<string, unknown>
    expect(first.ts).toBeTypeOf('string')
    expect(first.level).toBe('log')
    expect(first.msg).toBe('hola')
    expect(first.context).toBe('HealthService')
    expect(first.request_id).toBe('r-42')
    expect(first.tenant_id).toBe('t-7')

    const second = JSON.parse(writes[1]) as Record<string, unknown>
    expect(second.level).toBe('error')
    expect(second.request_id).toBeNull()
    expect(second.tenant_id).toBeNull()

    const third = JSON.parse(writes[2]) as Record<string, unknown>
    expect(third.level).toBe('warn')
    expect(third.context).toBe('AppController')
    expect(third.request_id).toBeNull()
  })
})