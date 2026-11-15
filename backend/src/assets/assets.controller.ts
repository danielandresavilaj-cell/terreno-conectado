import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { z } from 'zod'
import { ASSET_KINDS } from '@terreno/shared'
import { AuthGuard } from '../auth/auth.guard'
import type { JwtClaims } from '../auth/auth.types'
import { UUID_RE } from '../admin/contract'
import { AssetsService } from './assets.service'

type AuthedRequest = Request & { user?: JwtClaims }

const crearSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es obligatorio').max(120, 'El nombre no puede superar 120 caracteres'),
    kind: z.enum(ASSET_KINDS),
    site_id: z.string().regex(UUID_RE, 'faena inválida'),
    template_id: z.string().regex(UUID_RE, 'formulario inválido'),
  })
  .strict()

const estadoSchema = z.object({ status: z.enum(['active', 'revoked']) }).strict()

function uuid(id: string): string {
  if (!UUID_RE.test(id)) throw new BadRequestException('id debe ser un UUID')
  return id
}

function claims(req: AuthedRequest): JwtClaims {
  return req.user as JwtClaims
}

/**
 * TSK-OPS-003-C (FR-060/061) — activos y QR:
 *  - GET   /api/v1/assets                   (tenant_admin)
 *  - POST  /api/v1/assets                   (tenant_admin; devuelve el QR una vez)
 *  - POST  /api/v1/assets/:id/regenerar     (tenant_admin; invalida el QR anterior)
 *  - PATCH /api/v1/assets/:id/estado        (tenant_admin; revocar o reactivar)
 *  - GET   /api/v1/assets/catalogo          (cuenta de empresa; activos de sus faenas, con hash)
 *  - GET   /api/v1/assets/resolver/:hash    (cuenta de empresa; 404 si no corresponde)
 */
@Controller('assets')
@UseGuards(AuthGuard)
export class AssetsController {
  constructor(@Inject(AssetsService) private readonly svc: AssetsService) {}

  @Get()
  listar(@Req() req: AuthedRequest) {
    return this.svc.listar(claims(req))
  }

  @Get('catalogo')
  catalogo(@Req() req: AuthedRequest) {
    return this.svc.catalogo(claims(req))
  }

  @Get('resolver/:hash')
  resolver(@Req() req: AuthedRequest, @Param('hash') hash: string) {
    return this.svc.resolver(claims(req), hash)
  }

  @Post()
  crear(@Req() req: AuthedRequest, @Body() body: unknown) {
    const parsed = crearSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'datos inválidos')
    return this.svc.crear(claims(req), parsed.data)
  }

  @Post(':id/regenerar')
  regenerar(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.svc.regenerar(claims(req), uuid(id))
  }

  @Patch(':id/estado')
  cambiarEstado(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = estadoSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('status debe ser active o revoked')
    return this.svc.cambiarEstado(claims(req), uuid(id), parsed.data.status)
  }
}
