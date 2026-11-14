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
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import type { z } from 'zod'
import { AuthGuard } from '../auth/auth.guard'
import type { JwtClaims } from '../auth/auth.types'
import { UUID_RE } from '../admin/contract'
import {
  actualizarFaenaSchema,
  actualizarUsuarioSchema,
  asignarFaenasSchema,
  crearFaenaSchema,
  crearUsuarioSchema,
  resetClaveSchema,
} from './contract'
import type { FaenaDto, UsuarioDto } from './contract'
import { UsersService } from './users.service'

type AuthedRequest = Request & { user?: JwtClaims }

/** Sólo el administrador de una empresa (con tenant) gestiona su empresa. */
function exigirAdminEmpresa(req: AuthedRequest): { tenantId: string; actorId: string } {
  const c = req.user
  if (!c || c.rol !== 'tenant_admin' || !c.tenant_id) {
    throw new ForbiddenException('Sólo el administrador de la empresa puede hacer esto')
  }
  return { tenantId: c.tenant_id, actorId: c.sub }
}

function exigirUuid(id: string): string {
  if (!UUID_RE.test(id)) throw new BadRequestException('id debe ser un UUID')
  return id
}

function parsear<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ')
    throw new BadRequestException(`body inválido: ${detalle}`)
  }
  return parsed.data
}

/**
 * TSK-ADM-001 — cuentas y faenas de la empresa:
 *  - GET   /api/v1/users
 *  - POST  /api/v1/users                       (clave temporal)
 *  - PATCH /api/v1/users/:id                   (nombre, rol, activar/desactivar)
 *  - POST  /api/v1/users/:id/reset-password    (nueva clave temporal)
 *  - PUT   /api/v1/users/:id/faenas            (faenas en que captura; [] = todas, FR-065)
 *  - POST  /api/v1/sites · PATCH /api/v1/sites/:id
 * El listado de faenas sigue siendo `GET /api/v1/sites` (dashboard).
 */
@Controller()
@UseGuards(AuthGuard)
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get('users')
  listar(@Req() req: AuthedRequest): Promise<UsuarioDto[]> {
    const { tenantId } = exigirAdminEmpresa(req)
    return this.users.listar(tenantId)
  }

  @Post('users')
  @HttpCode(201)
  crear(@Req() req: AuthedRequest, @Body() body: unknown): Promise<UsuarioDto> {
    const { tenantId, actorId } = exigirAdminEmpresa(req)
    return this.users.crear(tenantId, actorId, parsear(crearUsuarioSchema, body))
  }

  @Patch('users/:id')
  actualizar(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<UsuarioDto> {
    const { tenantId, actorId } = exigirAdminEmpresa(req)
    return this.users.actualizar(tenantId, actorId, exigirUuid(id), parsear(actualizarUsuarioSchema, body))
  }

  /** TSK-ADM-003 (FR-065): faenas en que puede capturar la cuenta; `[]` = todas. */
  @Put('users/:id/faenas')
  asignarFaenas(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ id: string; faena_ids: string[] }> {
    const { tenantId, actorId } = exigirAdminEmpresa(req)
    return this.users.asignarFaenas(tenantId, actorId, exigirUuid(id), parsear(asignarFaenasSchema, body).faena_ids)
  }

  @Post('users/:id/reset-password')
  @HttpCode(200)
  resetear(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<UsuarioDto> {
    const { tenantId, actorId } = exigirAdminEmpresa(req)
    const { password } = parsear(resetClaveSchema, body)
    return this.users.resetearClave(tenantId, actorId, exigirUuid(id), password)
  }

  @Post('sites')
  @HttpCode(201)
  crearFaena(@Req() req: AuthedRequest, @Body() body: unknown): Promise<FaenaDto> {
    const { tenantId, actorId } = exigirAdminEmpresa(req)
    return this.users.crearFaena(tenantId, actorId, parsear(crearFaenaSchema, body))
  }

  @Patch('sites/:id')
  actualizarFaena(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<FaenaDto> {
    const { tenantId, actorId } = exigirAdminEmpresa(req)
    return this.users.actualizarFaena(tenantId, actorId, exigirUuid(id), parsear(actualizarFaenaSchema, body))
  }
}
