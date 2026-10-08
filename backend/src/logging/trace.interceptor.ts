import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { Observable } from 'rxjs'
import { logStore, type LogContext } from './json-logger'

/**
 * Trazabilidad por request (NFR-09): asigna un request_id unico y el tenant_id
 * autenticado (los guards corren antes que los interceptors, asi req.user ya
 * esta disponible). /health y /auth/login quedan con tenant_id null. El handle
 * se ejecuta dentro de AsyncLocalStorage para que los logs de los servicios
 * hereden el contexto.
 */
@Injectable()
export class TraceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: { tenant_id?: string | null } }>()
    const trace: LogContext = {
      request_id: randomUUID(),
      tenant_id: request.user?.tenant_id ?? null,
    }

    return new Observable((subscriber) => {
      logStore.run(trace, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        })
      })
    })
  }
}