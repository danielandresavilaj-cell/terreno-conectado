import type { LoggerService } from '@nestjs/common'
import { AsyncLocalStorage } from 'node:async_hooks'

/** Contexto de trazabilidad por request (NFR-09). */
export interface LogContext {
  request_id: string | null
  tenant_id: string | null
}

export const logStore = new AsyncLocalStorage<LogContext>()

type Level = 'log' | 'warn' | 'error' | 'debug' | 'verbose' | 'fatal'

function messageText(message: unknown): string {
  if (typeof message === 'string') return message
  if (message instanceof Error) return message.stack ?? message.message
  try {
    return JSON.stringify(message)
  } catch {
    return String(message)
  }
}

function contextFrom(optional: unknown[]): string | null {
  const first = optional[0]
  return typeof first === 'string' && !/\n/.test(first) ? first : null
}

function stackFrom(message: unknown, optional: unknown[]): unknown {
  if (message instanceof Error) return message.stack
  const first = optional[0]
  if (typeof first === 'string' && /\n/.test(first)) return first
  return undefined
}

/**
 * Logger estructurado JSON que reemplaza al default de Nest (FR-052/NFR-09).
 * Cada linea lleva ts, level, msg, context, request_id y tenant_id; estos dos
 * ultimos los pone TraceInterceptor via AsyncLocalStorage, asi los logs de los
 * servicios (sync/auth/dashboard) quedan trazables sin cambiarlos.
 */
export class JsonLogger implements LoggerService {
  private emit(level: Level, message: unknown, context: string | null, stack?: unknown): void {
    const store = logStore.getStore()
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: messageText(message),
      context,
      request_id: store?.request_id ?? null,
      tenant_id: store?.tenant_id ?? null,
      ...(stack === undefined ? {} : { stack }),
    })
    process.stdout.write(`${line}\n`)
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('log', message, contextFrom(optionalParams))
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('warn', message, contextFrom(optionalParams))
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('error', message, contextFrom(optionalParams), stackFrom(message, optionalParams))
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('debug', message, contextFrom(optionalParams))
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('verbose', message, contextFrom(optionalParams))
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('fatal', message, contextFrom(optionalParams), stackFrom(message, optionalParams))
  }
}