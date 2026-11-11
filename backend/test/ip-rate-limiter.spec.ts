import { describe, expect, it } from 'vitest'
import { IpRateLimiter } from '../src/auth/ip-rate-limiter'

/**
 * Rate-limit de login por IP (FR-005). Prueba unitaria pura: no levanta
 * PostgreSQL ni Nest, el reloj se inyecta.
 */

const MIN = 60_000

function crear(maxEntries?: number) {
  let t = 1_000_000
  const limiter = new IpRateLimiter({
    maxFails: 5,
    windowMs: 15 * MIN,
    blockMs: 15 * MIN,
    maxEntries,
    now: () => t,
  })
  return {
    limiter,
    avanzar: (ms: number) => {
      t += ms
    },
  }
}

function fallar(limiter: IpRateLimiter, ip: string, veces: number) {
  for (let i = 0; i < veces; i += 1) limiter.registerFail(ip)
}

describe('IpRateLimiter (FR-005)', () => {
  it('bloquea al quinto fallo y no antes', () => {
    const { limiter } = crear()
    fallar(limiter, '10.0.0.1', 4)
    expect(limiter.isBlocked('10.0.0.1')).toBe(false)
    limiter.registerFail('10.0.0.1')
    expect(limiter.isBlocked('10.0.0.1')).toBe(true)
    expect(limiter.isBlocked('10.0.0.2')).toBe(false)
  })

  it('el bloqueo dura 15 min y luego la IP vuelve a cero', () => {
    const { limiter, avanzar } = crear()
    fallar(limiter, '10.0.0.1', 5)
    avanzar(15 * MIN - 1)
    expect(limiter.isBlocked('10.0.0.1')).toBe(true)
    avanzar(1)
    expect(limiter.isBlocked('10.0.0.1')).toBe(false)
    // Antes, el contador seguía en 5 y un solo fallo volvía a bloquear.
    limiter.registerFail('10.0.0.1')
    expect(limiter.isBlocked('10.0.0.1')).toBe(false)
    expect(limiter.size).toBe(1)
  })

  it('los fallos fuera de la ventana no se acumulan', () => {
    const { limiter, avanzar } = crear()
    fallar(limiter, '10.0.0.1', 4)
    avanzar(15 * MIN)
    fallar(limiter, '10.0.0.1', 4)
    expect(limiter.isBlocked('10.0.0.1')).toBe(false)
  })

  it('reset (login exitoso) borra la IP', () => {
    const { limiter } = crear()
    fallar(limiter, '10.0.0.1', 4)
    limiter.reset('10.0.0.1')
    expect(limiter.size).toBe(0)
    limiter.registerFail('10.0.0.1')
    expect(limiter.isBlocked('10.0.0.1')).toBe(false)
  })

  it('consultar una IP vencida la saca de memoria', () => {
    const { limiter, avanzar } = crear()
    limiter.registerFail('10.0.0.1')
    avanzar(15 * MIN)
    expect(limiter.isBlocked('10.0.0.1')).toBe(false)
    expect(limiter.size).toBe(0)
  })

  it('con el techo lleno purga primero las entradas vencidas', () => {
    const { limiter, avanzar } = crear(100)
    for (let i = 0; i < 99; i += 1) limiter.registerFail(`10.0.1.${i}`)
    avanzar(10 * MIN)
    fallar(limiter, '10.9.9.9', 5)
    expect(limiter.size).toBe(100)
    avanzar(5 * MIN)
    limiter.registerFail('10.0.2.1')
    // Las 99 vencidas se purgan; la IP aún bloqueada y la nueva quedan.
    expect(limiter.size).toBe(2)
    expect(limiter.isBlocked('10.9.9.9')).toBe(true)
  })

  it('un barrido desde muchas IPs nunca supera el techo', () => {
    const { limiter } = crear(1_000)
    fallar(limiter, '10.9.9.9', 5)
    for (let i = 0; i < 50_000; i += 1) limiter.registerFail(`ip-${i}`)
    expect(limiter.size).toBeLessThanOrEqual(1_000)
    // Las más recientes siguen contando.
    fallar(limiter, 'ip-49999', 4)
    expect(limiter.isBlocked('ip-49999')).toBe(true)
  })
})
