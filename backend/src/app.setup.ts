import { RequestMethod } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import { JsonLogger } from './observability/json.logger'
import { requestLogger } from './observability/request-logger'

/**
 * Configuración común del servidor HTTP (usada por bootstrap y por los tests
 * e2e para que el prefijo/cookies/CORS no diverjan).
 *
 * TSK-WS-012 (NFR-09): reemplaza el logger por uno JSON estructurado y monta
 * el middleware de correlación (`request_id`/`tenant_id`). `/health` queda
 * fuera del prefijo `/api/v1` para el uptime monitor externo (FR-052).
 */
export function configureApp(app: INestApplication): INestApplication {
  const allowedOrigin = (process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
  app.enableCors({ origin: allowedOrigin, credentials: true })

  // Cookies rt/csrf (Decisión D5) y proxy confiable para rate-limit por IP.
  app.use(cookieParser())
  app.getHttpAdapter().getInstance().set('trust proxy', 1)

  // Observabilidad: logs JSON con request_id/tenant_id (NFR-09).
  const logger = new JsonLogger()
  app.useLogger(logger)
  app.use(requestLogger(logger))

  // `/health` es público y de infraestructura: sin prefijo ni sesión.
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  })
  return app
}