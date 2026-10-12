import { RequestMethod } from '@nestjs/common'
import { json, urlencoded } from 'express'
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
  // `Content-Disposition` no es un header CORS "simple", así que sin
  // `exposedHeaders` el navegador no lo deja leer desde JS en cross-origin y el
  // nombre real del documento original se pierde en silencio (el cliente cae al
  // nombre derivado de la revisión).
  app.enableCors({
    origin: allowedOrigin,
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  })

  // Cookies rt/csrf (Decisión D5) y proxy confiable para rate-limit por IP.
  app.use(cookieParser())
  app.getHttpAdapter().getInstance().set('trust proxy', 1)

  // Techo del cuerpo de `POST /sync/batch` (FR-012/FR-020, Artículo I).
  //
  // El límite por defecto de body-parser es 100 kB y el compresor de fotos de
  // FR-012 deja cada imagen entre 80 kB y 200 kB: con ese techo, sincronizar una
  // sola foto real devolvía 413 y el trabajador se quedaba con la cola colgada
  // sin ninguna pista. El techo sube a 32 MB para que quepa el rezago de un turno
  // sin señal (NFR-02: 100 fotos ≈ 20 MB) sin convertir el proceso en un sumidero
  // de memoria: el lote del cliente sigue acotado por conteo (500 registros).
  app.use(json({ limit: '32mb' }))
  app.use(urlencoded({ extended: true, limit: '32mb' }))

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