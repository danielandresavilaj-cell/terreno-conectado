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
  Body,
  Controller,
  FileTypeValidator,
  ForbiddenException,
  Get,
  Inject,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Request } from 'express'
import type {
  TemplateRevisionDetailDto,
  TemplatesDeltaResponse,
} from '@terreno/shared'
import { AuthGuard } from '../auth/auth.guard'
import type { JwtClaims } from '../auth/auth.types'
import { TemplatesService } from './templates.service'
import type { TemplateImportRow } from './templates.types'

interface ConfirmImportBody {
  publish?: boolean
}

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

  /* ── Importación de plantillas desde .xlsx (TSK-FORM-006/007) ──────────── */

  @UseGuards(AuthGuard)
  @Post('imports')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImport(
    @Req() req: AuthedRequest,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<TemplateImportRow> {
    const claims = req.user as JwtClaims
    if (claims.rol !== 'tenant_admin') {
      throw new ForbiddenException('Sólo tenant_admin puede importar plantillas')
    }
    return this.templates.uploadAndParseTemplateImport(
      tenantDe(req),
      claims.sub,
      file.originalname,
      file.buffer,
    )
  }

  @UseGuards(AuthGuard)
  @Get('imports')
  listImports(@Req() req: AuthedRequest): Promise<TemplateImportRow[]> {
    return this.templates.listTemplateImports(tenantDe(req))
  }

  @UseGuards(AuthGuard)
  @Get('imports/:importId')
  async getImport(
    @Req() req: AuthedRequest,
    @Param('importId') importId: string,
  ): Promise<TemplateImportRow> {
    return this.templates.getTemplateImport(tenantDe(req), importId)
  }

  @UseGuards(AuthGuard)
  @Post('imports/:importId/confirm')
  async confirmImport(
    @Req() req: AuthedRequest,
    @Param('importId') importId: string,
    @Body() body: ConfirmImportBody,
  ): Promise<TemplateRevisionDetailDto> {
    const claims = req.user as JwtClaims
    if (claims.rol !== 'tenant_admin') {
      throw new ForbiddenException('Sólo tenant_admin puede confirmar imports')
    }
    const rev = await this.templates.confirmTemplateImport({
      tenantId: tenantDe(req),
      importId,
      publish: body.publish,
    })
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
