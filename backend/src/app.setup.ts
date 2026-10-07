import type { INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'

/**
 * Configuración común del servidor HTTP (usada por bootstrap y por los tests
 * e2e para que el prefijo/cookies/CORS no diverjan).
 */
export function configureApp(app: INestApplication): INestApplication {
  const allowedOrigin = (process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
  app.enableCors({ origin: allowedOrigin, credentials: true })

  // Cookies rt/csrf (Decisión D5) y proxy confiable para rate-limit por IP.
  app.use(cookieParser())
  app.getHttpAdapter().getInstance().set('trust proxy', 1)

  app.setGlobalPrefix('api/v1')
  return app
}