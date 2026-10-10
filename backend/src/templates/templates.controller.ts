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
  Delete,
  FileTypeValidator,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Request } from 'express'
import { z } from 'zod'
import {
  assignTemplateSchema,
  type TemplateAssignmentDto,
  type TemplateRevisionDetailDto,
  type TemplatesDeltaResponse,
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

function requireTenantAdmin(req: AuthedRequest): void {
  const claims = req.user as JwtClaims
  if (claims.rol !== 'tenant_admin') {
    throw new ForbiddenException('Sólo tenant_admin puede ejecutar esta acción sobre plantillas')
  }
}

const ROLES_OPERATIVOS = ['field_worker', 'supervisor'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * FR-009: los roles operativos ven sólo lo asignado a su rol/faena; el admin
 * ve todo (sin filtro). `site_id` es la faena activa del dispositivo.
 */
function workerFilter(
  claims: JwtClaims,
  siteId: string | undefined,
): { role: 'field_worker' | 'supervisor'; siteId: string | null } | undefined {
  if (!(ROLES_OPERATIVOS as readonly string[]).includes(claims.rol)) return undefined
  if (siteId === undefined || siteId === '') return { role: claims.rol as 'field_worker' | 'supervisor', siteId: null }
  if (!UUID_RE.test(siteId)) throw new BadRequestException('site_id debe ser un UUID')
  return { role: claims.rol as 'field_worker' | 'supervisor', siteId }
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

function toAssignmentDto(row: {
  id: string
  template_revision_id: string
  tenant_id: string
  site_id: string | null
  role: 'field_worker' | 'supervisor'
  active: boolean
  assigned_by: string
  assigned_at: string
  created_at: string
  updated_at: string
}): TemplateAssignmentDto {
  return {
    id: row.id,
    template_revision_id: row.template_revision_id,
    tenant_id: row.tenant_id,
    site_id: row.site_id,
    role: row.role,
    active: row.active,
    assigned_by: row.assigned_by,
    assigned_at: row.assigned_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
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
  list(
    @Req() req: AuthedRequest,
    @Query('since') since?: string,
    @Query('site_id') siteId?: string,
  ): Promise<TemplatesDeltaResponse> {
    const claims = req.user as JwtClaims
    return this.templates.listPublishedRevisions(
      tenantDe(req),
      parseSince(since),
      workerFilter(claims, siteId),
    )
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

  /* ── Asignación por faena y rol (TSK-FORM-008, FR-008/009) ─────────────── */

  @UseGuards(AuthGuard)
  @Get('assignments')
  async listAssignments(@Req() req: AuthedRequest): Promise<{ items: TemplateAssignmentDto[] }> {
    requireTenantAdmin(req)
    const rows = await this.templates.listAssignments(tenantDe(req))
    return { items: rows.map(toAssignmentDto) }
  }

  @UseGuards(AuthGuard)
  @Post('assignments')
  @HttpCode(200)
  async assign(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<TemplateAssignmentDto> {
    requireTenantAdmin(req)
    const claims = req.user as JwtClaims
    const parsed = assignTemplateSchema.safeParse(body)
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ')
      throw new BadRequestException(`body inválido: ${detail}`)
    }
    const row = await this.templates.assignTemplate({
      tenantId: tenantDe(req),
      revisionId: parsed.data.revision_id,
      siteId: parsed.data.site_id ?? null,
      role: parsed.data.role,
      active: parsed.data.active,
      assignedBy: claims.sub,
    })
    return toAssignmentDto(row)
  }

  @UseGuards(AuthGuard)
  @Delete('assignments/:assignmentId')
  @HttpCode(204)
  async unassign(
    @Req() req: AuthedRequest,
    @Param('assignmentId') assignmentId: string,
  ): Promise<void> {
    requireTenantAdmin(req)
    await this.templates.deleteAssignment(tenantDe(req), assignmentId)
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
