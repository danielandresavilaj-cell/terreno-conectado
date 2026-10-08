import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Contexto de request (NFR-09): cada petición HTTP corre dentro de un
 * `AsyncLocalStorage` con `requestId` y `tenantId` para que **todas** las
 * líneas de log emitidas durante el manejo (no sólo el access log) lleven la
 * correlación. Fuera de un request (boot, workers) ambos quedan en `null`.
 */
export interface RequestContext {
  requestId: string
  tenantId: string | null
}

export const requestContext = new AsyncLocalStorage<RequestContext>()