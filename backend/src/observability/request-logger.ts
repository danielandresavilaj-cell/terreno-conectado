import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { decodeJwt } from 'jose'
import type { JsonLogger } from './json.logger'
import { requestContext } from './request-context'

/**
 * Asigna `request_id` (UUID) y `tenant_id` (decodificado del Bearer JWT, sin
 * verificar — el token ya lo valida AuthGuard) y emite el **access log** JSON
 * al terminar la respuesta. Todo el manejo del request corre dentro del
 * `AsyncLocalStorage` para que los logs de servicios (NFR-09) hereden la
 * correlación.
 *
 * No verifica firma ni credenciales a propósito: el middleware corre antes de
 * AuthGuard y su trabajo es correlación, no autorización. Un token inválido
 * simplemente deja `tenant_id: null` (o llega el 401 de AuthGuard).
 */
export function requestLogger(logger: JsonLogger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = randomUUID()
    const tenantId = extraerTenantId(
      typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
    )
    const inicio = Date.now()

    requestContext.run({ requestId, tenantId }, () => {
      res.on('finish', () => {
        logger.http({
          method: req.method,
          path: req.originalUrl ?? req.url,
          status: res.statusCode,
          duration_ms: Date.now() - inicio,
          requestId,
          tenantId,
        })
      })
      next()
    })
  }
}

function extraerTenantId(header: string | null): string | null {
  if (!header || !header.startsWith('Bearer ')) return null
  try {
    const payload = decodeJwt(header.slice(7))
    const tenant = payload.tenant_id
    return typeof tenant === 'string' ? tenant : null
  } catch {
    return null
  }
}