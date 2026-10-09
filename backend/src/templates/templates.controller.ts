/**
 * Endpoints de plantillas.
 *
 * Lectura (TSK-FORM-001, FR-018/027/036):
 *  · `GET /api/v1/templates?since=<n>`          — revisiones publicadas del
 *    tenant con su `definition`, filtradas por delta `version > since`
 *    (base del caché offline del worker, FR-018/027).
 *  · `GET /api/v1/templates/revisions/:id`      — detalle de una revisión;
 *    los borradores sólo los lee `tenant_admin` (FR-048/049).
 *
 * Escritura (TSK-FORM-006, FR-029/FR-047/FR-049):
 *  · `POST /api/v1/templates`                    — crea template + draft (solo `tenant_admin`)
 *  · `PATCH /api/v1/templates/revisions/:id`     — actualiza draft (solo `tenant_admin`)
 *  · `POST /api/v1/templates/revisions/:id/publish` — publica draft explícitamente (solo `tenant_admin`); nunca publica automático (FR-048)
 *
 * El aislamiento por tenant lo garantiza RLS (FR-007): estos handlers sólo
 * traducen claims HTTP → servicio.
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
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import { z } from 'zod'
import type {
  TemplateRevisionDetailDto,
  TemplatesDeltaResponse,
} from '@terreno/shared'
import { AuthGuard } from '../auth/auth.guard'
import type { JwtClaims } from '../auth/auth.types'
import { TemplatesService } from './templates.service'

type AuthedRequest = Request & { user?: JwtClaims }

function tenantDe(req: AuthedRequest): string {
  const claims = req.user as JwtClaims
  if (!claims.tenant_id) {
    throw new ForbiddenException('La operación de plataforma no lee plantillas de tenant')
  }
  return claims.tenant_id
}

function parseSince(v: unknown): number | undefined {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0) {
    throw new BadRequestException('since debe ser un entero ≥ 0')
  }
  return n
}

function requireTenantAdmin(req: AuthedRequest): void {
  const claims = req.user as JwtClaims
  if (claims.rol !== 'tenant_admin') {
    throw new ForbiddenException('Sólo tenant_admin puede ejecutar esta acción sobre plantillas')
  }
}

function toRevisionDto(rev: {
  id: string
  template_id: string
  version: number | null
  status: 'draft' | 'published' | 'archived'
  definition: unknown
  published_at: string | null
  created_at: string
  updated_at: string
}): TemplateRevisionDetailDto {
  return {
    id: rev.id,
    template_id: rev.template_id,
    version: rev.version,
    status: rev.status,
    definition: rev.definition as TemplateRevisionDetailDto['definition'],
    published_at: rev.published_at,
    created_at: rev.created_at,
    updated_at: rev.updated_at,
  }
}

const CreateTemplateSchema = z.object({
  name: z
    .string({ required_error: 'name es requerido' })
    .trim()
    .min(1, 'name debe tener al menos 1 carácter'),
  description: z.string().trim().optional(),
  definition: z.unknown(),
})

const UpdateDraftSchema = z.object({
  definition: z.unknown(),
})

@Controller('templates')
export class TemplatesController {
  constructor(@Inject(TemplatesService) private readonly templates: TemplatesService) {}

  @UseGuards(AuthGuard)
  @Get()
  list(@Req() req: AuthedRequest, @Query('since') since?: string): Promise<TemplatesDeltaResponse> {
    return this.templates.listPublishedRevisions(tenantDe(req), parseSince(since))
  }

  @UseGuards(AuthGuard)
  @Get('revisions/:revisionId')
  async revision(
    @Req() req: AuthedRequest,
    @Param('revisionId') revisionId: string,
  ): Promise<TemplateRevisionDetailDto> {
    const claims = req.user as JwtClaims
    const rev = await this.templates.getRevision(tenantDe(req), revisionId)
    if (rev.status !== 'published' && claims.rol !== 'tenant_admin') {
      throw new ForbiddenException('Sólo tenant_admin lee borradores de plantilla')
    }
    return toRevisionDto(rev)
  }

  @UseGuards(AuthGuard)
  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<TemplateRevisionDetailDto> {
    requireTenantAdmin(req)
    const parsed = CreateTemplateSchema.safeParse(body)
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ')
      throw new BadRequestException(`body inválido: ${detail}`)
    }
    const rev = await this.templates.createTemplateWithDraft({
      tenantId: tenantDe(req),
      name: parsed.data.name,
      description: parsed.data.description,
      definition: parsed.data.definition,
    })
    return toRevisionDto(rev)
  }

  @UseGuards(AuthGuard)
  @Patch('revisions/:revisionId')
  async updateDraft(
    @Req() req: AuthedRequest,
    @Param('revisionId') revisionId: string,
    @Body() body: unknown,
  ): Promise<TemplateRevisionDetailDto> {
    requireTenantAdmin(req)
    const parsed = UpdateDraftSchema.safeParse(body)
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ')
      throw new BadRequestException(`body inválido: ${detail}`)
    }
    const rev = await this.templates.updateDraftRevision({
      tenantId: tenantDe(req),
      revisionId,
      definition: parsed.data.definition,
    })
    return toRevisionDto(rev)
  }

  @UseGuards(AuthGuard)
  @Post('revisions/:revisionId/publish')
  @HttpCode(200)
  async publish(
    @Req() req: AuthedRequest,
    @Param('revisionId') revisionId: string,
  ): Promise<TemplateRevisionDetailDto> {
    requireTenantAdmin(req)
    const rev = await this.templates.publishRevision(tenantDe(req), revisionId)
    return toRevisionDto(rev)
  }
}
