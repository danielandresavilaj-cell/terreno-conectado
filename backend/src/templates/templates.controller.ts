/**
 * Endpoints de lectura de plantillas (TSK-FORM-001, FR-018/027/036).
 *
 *  · `GET /api/v1/templates?since=<n>`          — revisiones publicadas del
 *    tenant con su `definition`, filtradas por delta `version > since`
 *    (base del caché offline del worker, FR-018/027).
 *  · `GET /api/v1/templates/revisions/:id`      — detalle de una revisión;
 *    los borradores sólo los lee `tenant_admin` (FR-048/049).
 *
 * Sólo lectura: publicar/asignar/editar llega con TSK-FORM-006/008. El
 * aislamiento por tenant lo garantiza RLS (FR-007): estos handlers sólo
 * traducen claims HTTP → servicio.
 */

import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
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
    return {
      id: rev.id,
      template_id: rev.template_id,
      version: rev.version,
      status: rev.status,
      definition: rev.definition as unknown as TemplateRevisionDetailDto['definition'],
      published_at: rev.published_at,
      created_at: rev.created_at,
      updated_at: rev.updated_at,
    }
  }
}
