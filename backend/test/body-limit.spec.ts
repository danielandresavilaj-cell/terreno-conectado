import 'reflect-metadata'
import { Body, Controller, HttpCode, Module, Post } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { configureApp } from '../src/app.setup'

/**
 * Techo del cuerpo JSON por ruta (FR-012/FR-020, Art. IX).
 *
 * Usa controladores de prueba con las MISMAS rutas que la API real, montados
 * con `configureApp`: lo que se verifica es el cableado de body-parser, sin
 * PostgreSQL. Los 32 MB son sólo para `POST /api/v1/sync/batch`; el resto
 * (incluido el login público) queda en 2 MB.
 */

@Controller('sync')
class FakeSyncController {
  @Post('batch')
  @HttpCode(200)
  batch(@Body() body: { data?: string }) {
    return { bytes: body.data?.length ?? 0 }
  }
}

@Controller('auth')
class FakeAuthController {
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { data?: string }) {
    return { bytes: body.data?.length ?? 0 }
  }
}

@Module({ controllers: [FakeSyncController, FakeAuthController] })
class FakeModule {}

const MB = 1024 * 1024
const cuerpo = (bytes: number) => ({ data: 'x'.repeat(bytes) })

let app: INestApplication
const server = () => request(app.getHttpServer())

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [FakeModule] }).compile()
  app = configureApp(moduleRef.createNestApplication({ logger: false }))
  await app.init()
})

afterAll(async () => {
  await app?.close()
})

describe('techo del cuerpo JSON por ruta', () => {
  it('POST /sync/batch acepta un lote de 20 MB (NFR-02: ~100 fotos)', async () => {
    const res = await server().post('/api/v1/sync/batch').send(cuerpo(20 * MB))
    expect(res.status).toBe(200)
    expect(res.body.bytes).toBe(20 * MB)
  })

  it('POST /sync/batch rechaza más de 32 MB con 413', async () => {
    const res = await server().post('/api/v1/sync/batch').send(cuerpo(33 * MB))
    expect(res.status).toBe(413)
  })

  it('POST /auth/login acepta cuerpos normales', async () => {
    const res = await server().post('/api/v1/auth/login').send(cuerpo(1024))
    expect(res.status).toBe(200)
  })

  it('POST /auth/login rechaza más de 2 MB con 413 (ya no hereda los 32 MB)', async () => {
    const res = await server().post('/api/v1/auth/login').send(cuerpo(3 * MB))
    expect(res.status).toBe(413)
  })
})
