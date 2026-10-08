import type { LoggerService } from '@nestjs/common'
import { requestContext } from './request-context'

/**
 * Logger estructurado JSON (NFR-09). Reemplaza al logger por defecto de NestJS
 * (`app.useLogger`) y emite **una línea JSON por evento**:
 *
 *   {"ts":"…","level":"info","message":"…","context":"SyncService",
 *    "request_id":"…","tenant_id":"…","data":{…},"stack":"…"}
 *
 * - `request_id` y `tenant_id` siempre presentes (null fuera de un request).
 * - Nivel por `LOG_LEVEL` (trace|debug|info|warn|error|fatal), `silent` para
 *   tests/demo (NODE_ENV=test).
 * - `error`/`fatal` a stderr; el resto a stdout.
 * - `write` inyectable para aserciones de tests sin tocar la consola.
 */

export type JsonLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const NIVEL: Record<JsonLogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
}

export interface JsonLogEntry {
  ts: string
  level: JsonLogLevel
  message: string
  context?: string
  request_id: string | null
  tenant_id: string | null
  data?: unknown
  stack?: string
}

export interface JsonLoggerOptions {
  /** Nivel umbral; 'silent' apaga el logger. Default: env LOG_LEVEL o 'info'. */
  nivel?: JsonLogLevel | 'silent'
  /** Canal de salida inyectable (tests). Default: process.stdout/stderr. */
  write?: (line: string, stream: 'stdout' | 'stderr') => void
}

function nivelInicial(): JsonLogLevel | 'silent' {
  const env = process.env.LOG_LEVEL
  if (env) {
    const nivel = env.toLowerCase()
    if (nivel === 'silent') return 'silent'
    if (nivel in NIVEL) return nivel as JsonLogLevel
    return 'info'
  }
  if (process.env.NODE_ENV === 'test') return 'silent'
  return 'info'
}

function aTexto(message: unknown): { texto: string; data?: unknown } {
  if (typeof message === 'string') return { texto: message }
  if (message instanceof Error) return { texto: message.message, data: message.name }
  return { texto: `[${typeof message}]`, data: message }
}

export class JsonLogger implements LoggerService {
  private readonly umbral: number | null
  private readonly salida: NonNullable<JsonLoggerOptions['write']>

  constructor(options: JsonLoggerOptions = {}) {
    const nivel = options.nivel ?? nivelInicial()
    this.umbral = nivel === 'silent' ? null : NIVEL[nivel]
    this.salida = options.write ?? ((line, stream) => {
      if (stream === 'stderr') process.stderr.write(`${line}\n`)
      else process.stdout.write(`${line}\n`)
    })
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.emite('info', message, rest)
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.emite('error', message, rest)
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.emite('warn', message, rest)
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.emite('debug', message, rest)
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.emite('trace', message, rest)
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    this.emite('fatal', message, rest)
  }

  /** Access log HTTP con la correlación explícita del request (NFR-09). */
  http(meta: {
    method: string
    path: string
    status: number
    duration_ms: number
    requestId: string
    tenantId: string | null
  }): void {
    this.escribe('info', {
      ts: new Date().toISOString(),
      level: 'info',
      message: `HTTP ${meta.method} ${meta.path} ${meta.status} ${meta.duration_ms}ms`,
      context: 'http',
      request_id: meta.requestId,
      tenant_id: meta.tenantId,
      data: {
        method: meta.method,
        path: meta.path,
        status: meta.status,
        duration_ms: meta.duration_ms,
      },
    })
  }

  private emite(level: JsonLogLevel, message: unknown, rest: unknown[]): void {
    if (this.umbral === null || NIVEL[level] < this.umbral) return

    const ctx = requestContext.getStore()
    const texto = aTexto(message)
    const ultimo = rest.at(-1)
    const contexto = typeof ultimo === 'string' && rest.length >= 1 ? ultimo : undefined
    const errorEnRest = rest.find((p): p is Error => p instanceof Error)
    const stack =
      rest.find((p): p is string => typeof p === 'string' && p.includes('\n')) ??
      errorEnRest?.stack

    this.escribe(level, {
      ts: new Date().toISOString(),
      level,
      message: texto.texto,
      ...(contexto ? { context: contexto } : {}),
      request_id: ctx?.requestId ?? null,
      tenant_id: ctx?.tenantId ?? null,
      ...(texto.data !== undefined ? { data: texto.data } : {}),
      ...(stack ? { stack } : {}),
    })
  }

  private escribe(level: JsonLogLevel, entrada: JsonLogEntry): void {
    if (this.umbral === null || NIVEL[level] < this.umbral) return
    this.salida(
      JSON.stringify(entrada),
      level === 'error' || level === 'fatal' ? 'stderr' : 'stdout',
    )
  }
}