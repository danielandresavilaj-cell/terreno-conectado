import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import { z } from 'zod'
import { AuthGuard } from '../auth/auth.guard'
import type { JwtClaims } from '../auth/auth.types'
import { UUID_RE } from '../admin/contract'
import { SupervisionService } from './supervision.service'

type AuthedRequest = Request & { user?: JwtClaims }

const ROLES_SUPERVISION = new Set(['supervisor', 'tenant_admin'])
/** TSK-DOM-007 (FR-064): estado y/o gestión; al menos un campo. */
const estadoHallazgoSchema = z
  .object({
    status: z.enum(['open', 'in_progress', 'resolved']).optional(),
    assignee_id: z.string().regex(UUID_RE, 'responsable inválido').nullable().optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'plazo inválido (AAAA-MM-DD)').nullable().optional(),
    resolution_note: z.string().max(2000, 'la nota de cierre no puede superar 2000 caracteres').nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'nada que cambiar')
const cofirmaSchema = z.object({
  strokes: z.array(z.object({
    points: z.array(z.object({ x: z.number().int().min(0).max(1000), y: z.number().int().min(0).max(1000) })).min(2),
  })).min(1).max(32),
}).superRefine(({ strokes }, ctx) => {
  const totalPuntos = strokes.reduce((total, stroke) => total + stroke.points.length, 0)
  if (totalPuntos > 1024) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'La firma no puede superar 1024 puntos.',
      path: ['strokes'],
    })
  }
})

function exigirSupervision(req: AuthedRequest): { tenantId: string; actorId: string } {
  const c = req.user
  if (!c || !c.tenant_id || !ROLES_SUPERVISION.has(c.rol)) {
    throw new ForbiddenException('Sólo supervisión o el admin de la empresa puede hacer esto')
  }
  return { tenantId: c.tenant_id, actorId: c.sub }
}

function uuid(id: string): string {
  if (!UUID_RE.test(id)) throw new BadRequestException('id debe ser un UUID')
  return id
}

/**
 * TSK-DOM-005 — supervisión (FR-031/032):
 *  - PATCH /api/v1/inspections/:id/review
 *  - PATCH /api/v1/findings/:id          { status }
 *  - PATCH /api/v1/conflicts/:id/review
 */
@Controller()
@UseGuards(AuthGuard)
export class SupervisionController {
  constructor(@Inject(SupervisionService) private readonly svc: SupervisionService) {}

  @Patch('inspections/:id/review')
  revisarInspeccion(@Req() req: AuthedRequest, @Param('id') id: string) {
    const { tenantId, actorId } = exigirSupervision(req)
    return this.svc.revisarInspeccion(tenantId, actorId, uuid(id))
  }

  @Post('inspections/:id/signature')
  cofirmarInspeccion(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { tenantId, actorId } = exigirSupervision(req)
    const parsed = cofirmaSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('strokes debe contener trazos válidos de firma')
    return this.svc.cofirmarInspeccion(tenantId, actorId, uuid(id), parsed.data.strokes)
  }

  @Patch('findings/:id')
  cambiarEstadoHallazgo(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { tenantId, actorId } = exigirSupervision(req)
    const parsed = estadoHallazgoSchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'status debe ser open, in_progress o resolved')
    }
    return this.svc.gestionarHallazgo(tenantId, actorId, uuid(id), parsed.data)
  }

  /** TSK-DOM-007: a quién se le puede asignar un hallazgo. */
  @Get('findings/responsables')
  responsables(@Req() req: AuthedRequest) {
    const { tenantId } = exigirSupervision(req)
    return this.svc.equipo(tenantId)
  }

  @Patch('conflicts/:id/review')
  revisarConflicto(@Req() req: AuthedRequest, @Param('id') id: string) {
    const { tenantId, actorId } = exigirSupervision(req)
    return this.svc.revisarConflicto(tenantId, actorId, uuid(id))
  }
}
