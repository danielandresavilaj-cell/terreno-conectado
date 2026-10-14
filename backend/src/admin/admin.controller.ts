/**
 * Endpoints de administración de plataforma (spec 006, FR-050/051).
 *
 *  · `POST  /api/v1/admin/tenants`              — crear tenant
 *  · `PATCH /api/v1/admin/tenants/:id`          — suspender / reactivar
 *  · `POST  /api/v1/admin/tenants/:id/admins`   — asignar `tenant_admin` inicial
 *  · `GET   /api/v1/admin/audit-log`            — lectura filtrada del audit log
 *
 * Todos exigen `AuthGuard` + rol `platform_admin` (no se crea un segundo
 * mecanismo de autorización). El aislamiento de tenant lo bypassa el rol de
 * plataforma de forma deliberada y auditada (§1 del spec).
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { AuthGuard } from '../auth/auth.guard'
import type { JwtClaims } from '../auth/auth.types'
import { AdminService } from './admin.service'
import {
  asignarAdminSchema,
  cambiarEstadoSchema,
  crearTenantSchema,
  filtroAuditSchema,
  UUID_RE,
} from './contract'
import type { AdminUserDto, AuditEntryDto, TenantDto } from './contract'

type AuthedRequest = Request & { user?: JwtClaims }

/** Rol exigido por todos los endpoints admin (FR-050). */
function exigirPlatformAdmin(req: AuthedRequest): string {
  const claims = req.user
  if (!claims || claims.rol !== 'platform_admin') {
    throw new ForbiddenException('Sólo platform_admin puede administrar la plataforma')
  }
  return claims.sub
}

/** Valida un parámetro de ruta que debe ser UUID. */
function exigirUuid(id: string): string {
  if (!UUID_RE.test(id)) {
    throw new BadRequestException('id debe ser un UUID')
  }
  return id
}

/** Valida con Zod y traduce el error a `400` con detalle legible. */
function parsear<S extends z.ZodType>(schema: S, value: unknown, etiqueta = 'body'): z.output<S> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || etiqueta}: ${i.message}`)
      .join('; ')
    throw new BadRequestException(`${etiqueta} inválido: ${detalle}`)
  }
  return parsed.data
}

@Controller('admin')
@UseGuards(AuthGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Post('tenants')
  @HttpCode(201)
  async crearTenant(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<TenantDto> {
    const actorId = exigirPlatformAdmin(req)
    const data = parsear(crearTenantSchema, body)
    return this.admin.crearTenant(data.name, data.slug, actorId)
  }

  @Patch('tenants/:id')
  async cambiarEstado(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<TenantDto> {
    const actorId = exigirPlatformAdmin(req)
    const data = parsear(cambiarEstadoSchema, body)
    const { tenant } = await this.admin.cambiarEstado(exigirUuid(id), data.status, actorId)
    return tenant
  }

  @Post('tenants/:id/admins')
  async asignarAdmin(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminUserDto> {
    const actorId = exigirPlatformAdmin(req)
    const data = parsear(asignarAdminSchema, body)
    const { user, created } = await this.admin.asignarAdmin(
      exigirUuid(id),
      { email: data.email, fullName: data.full_name, password: data.password },
      actorId,
    )
    // 201 al crear la cuenta; 200 al promover o cuando ya era tenant_admin.
    res.status(created ? 201 : 200)
    return user
  }

  @Get('audit-log')
  async auditLog(
    @Req() req: AuthedRequest,
    @Query() query: Record<string, unknown>,
  ): Promise<{ items: AuditEntryDto[]; limit: number; offset: number }> {
    exigirPlatformAdmin(req)
    const filtros = parsear(filtroAuditSchema, query, 'query')
    return this.admin.listarAudit(filtros)
  }
}
