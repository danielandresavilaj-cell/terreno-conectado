import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  QR_PREFIJO,
  type AssetConQrDto,
  type AssetDto,
  type AssetResueltoDto,
  type AssetsCatalogoResponse,
  type AssetsResponse,
  type CrearAssetBody,
} from '@terreno/shared'
import type { JwtClaims } from '../auth/auth.types'
import { DbService } from '../db/db.service'

type Run = <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>

/** Contenido nuevo de QR: `tc1:` + 128 bits aleatorios en base64url. */
export function nuevoQr(): string {
  return `${QR_PREFIJO}${randomBytes(16).toString('base64url')}`
}

/** SHA-256 hex del contenido completo del QR (lo único que guarda la base). */
export function hashDeQr(qr: string): string {
  return createHash('sha256').update(qr, 'utf8').digest('hex')
}

const SELECT_ASSET = `
  SELECT a.id, a.name, a.kind, a.site_id, s.name AS faena_nombre, a.template_id, t.name AS template_nombre,
         a.status, a.created_at, a.updated_at
    FROM asset a
    JOIN site s ON s.id = a.site_id
    JOIN template t ON t.id = a.template_id`

interface FilaAsset extends Omit<AssetDto, 'created_at' | 'updated_at'> {
  created_at: Date
  updated_at: Date
}

const aDto = (f: FilaAsset): AssetDto => ({
  ...f,
  created_at: f.created_at.toISOString(),
  updated_at: f.updated_at.toISOString(),
})

/**
 * Activos y QR (TSK-OPS-003-C, FR-060). Todo pasa por RLS de `asset`; las
 * escrituras son sólo del `tenant_admin` y quedan en `audit_log`. El token en
 * claro nunca se guarda ni se registra: se devuelve una vez al crearlo o
 * regenerarlo.
 */
@Injectable()
export class AssetsService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  private exigirAdmin(u: JwtClaims): string {
    if (!u.tenant_id || u.rol !== 'tenant_admin') {
      throw new ForbiddenException('Sólo el administrador de la empresa puede gestionar activos')
    }
    return u.tenant_id
  }

  async listar(u: JwtClaims): Promise<AssetsResponse> {
    const tenantId = this.exigirAdmin(u)
    const filas = await this.db.queryAsTenant<FilaAsset>(tenantId, `${SELECT_ASSET} ORDER BY a.status, s.name, a.name`)
    return { items: filas.map(aDto) }
  }

  async crear(u: JwtClaims, body: CrearAssetBody): Promise<AssetConQrDto> {
    const tenantId = this.exigirAdmin(u)
    return this.db.withTenantTransaction(tenantId, async (run) => {
      await this.validarRefs(run, body.site_id, body.template_id)
      const id = randomUUID()
      const qr = nuevoQr()
      await run(
        `INSERT INTO asset (id, tenant_id, site_id, template_id, name, kind, qr_token_hash, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, tenantId, body.site_id, body.template_id, body.name, body.kind, hashDeQr(qr), u.sub],
      )
      await auditar(run, u.sub, tenantId, 'asset_created', id, {
        name: body.name,
        kind: body.kind,
        site_id: body.site_id,
        template_id: body.template_id,
      })
      return { ...(await this.uno(run, id)), qr }
    })
  }

  /** Nuevo QR: el anterior deja de servir de inmediato (en línea). */
  async regenerar(u: JwtClaims, id: string): Promise<AssetConQrDto> {
    const tenantId = this.exigirAdmin(u)
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const qr = nuevoQr()
      const filas = await run<{ id: string }>(
        `UPDATE asset SET qr_token_hash = $2, status = 'active', updated_at = now() WHERE id = $1 RETURNING id`,
        [id, hashDeQr(qr)],
      )
      if (!filas[0]) throw new NotFoundException('Activo no encontrado')
      await auditar(run, u.sub, tenantId, 'asset_qr_regenerated', id, {})
      return { ...(await this.uno(run, id)), qr }
    })
  }

  async cambiarEstado(u: JwtClaims, id: string, status: 'active' | 'revoked'): Promise<AssetDto> {
    const tenantId = this.exigirAdmin(u)
    return this.db.withTenantTransaction(tenantId, async (run) => {
      const antes = await run<{ status: string }>('SELECT status FROM asset WHERE id = $1 FOR UPDATE', [id])
      if (!antes[0]) throw new NotFoundException('Activo no encontrado')
      if (antes[0].status !== status) {
        await run('UPDATE asset SET status = $2, updated_at = now() WHERE id = $1', [id, status])
        await auditar(run, u.sub, tenantId, status === 'revoked' ? 'asset_revoked' : 'asset_restored', id, {
          from: antes[0].status,
        })
      }
      return this.uno(run, id)
    })
  }

  /**
   * Tramo 2 (FR-060/061): activos activos de las faenas de la cuenta (FR-065),
   * con su hash, para que el teléfono resuelva un QR sin señal. Se descarga la
   * lista completa del alcance: un activo revocado desaparece en la próxima
   * sincronización (hasta entonces, sin señal, sigue abriendo: desfase aceptado).
   * La asignación faena/rol del formulario la aplica el teléfono con su catálogo
   * de formularios, que ya viene filtrado por el servidor.
   */
  async catalogo(u: JwtClaims): Promise<AssetsCatalogoResponse> {
    if (!u.tenant_id) throw new ForbiddenException('Sólo una cuenta de empresa puede descargar activos')
    const operativo = u.rol === 'field_worker' || u.rol === 'supervisor'
    const items = await this.db.queryAsTenant<AssetsCatalogoResponse['items'][number]>(
      u.tenant_id,
      `SELECT a.id, a.name, a.kind, a.site_id, a.template_id, a.qr_token_hash
         FROM asset a
        WHERE a.status = 'active'
          AND (NOT $1::boolean
               OR NOT EXISTS (SELECT 1 FROM user_site us WHERE us.user_id = $2)
               OR EXISTS (SELECT 1 FROM user_site us WHERE us.user_id = $2 AND us.site_id = a.site_id))
        ORDER BY a.site_id, a.name`,
      [operativo, u.sub],
    )
    return { items }
  }

  /**
   * Resuelve un QR para quien lo escanea (FR-060): el activo debe estar activo
   * y ser de su empresa (RLS), su faena debe estar entre las suyas (FR-065) y
   * su formulario debe tener una revisión publicada asignada a esa faena y a su
   * rol. Cualquier otro caso responde 404 igual que un QR inexistente, sin
   * decir por qué.
   */
  async resolver(u: JwtClaims, hash: string): Promise<AssetResueltoDto> {
    if (!u.tenant_id) throw new ForbiddenException('Sólo una cuenta de empresa puede abrir un QR')
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new BadRequestException('código QR inválido')
    const operativo = u.rol === 'field_worker' || u.rol === 'supervisor'
    const filas = await this.db.queryAsTenant<AssetResueltoDto>(
      u.tenant_id,
      `SELECT a.id AS asset_id, a.name, a.kind, a.site_id, s.name AS faena_nombre,
              a.template_id, r.id AS revision_id, t.name AS template_nombre
         FROM asset a
         JOIN site s ON s.id = a.site_id
         JOIN template t ON t.id = a.template_id AND t.status = 'active'
         JOIN LATERAL (
           SELECT r.id FROM template_revision r
            WHERE r.template_id = a.template_id AND r.status = 'published'
            ORDER BY r.version DESC LIMIT 1
         ) r ON true
        WHERE a.qr_token_hash = $1
          AND a.status = 'active'
          AND (NOT $2::boolean OR (
                (NOT EXISTS (SELECT 1 FROM user_site us WHERE us.user_id = $3)
                  OR EXISTS (SELECT 1 FROM user_site us WHERE us.user_id = $3 AND us.site_id = a.site_id))
                AND EXISTS (
                  SELECT 1 FROM template_assignment ta
                   WHERE ta.template_revision_id = r.id AND ta.active AND ta.role = $4
                     AND (ta.site_id IS NULL OR ta.site_id = a.site_id))))`,
      [hash, operativo, u.sub, u.rol],
    )
    if (!filas[0]) throw new NotFoundException('Código QR no reconocido')
    return filas[0]
  }

  private async uno(run: Run, id: string): Promise<AssetDto> {
    const [fila] = await run<FilaAsset>(`${SELECT_ASSET} WHERE a.id = $1`, [id])
    if (!fila) throw new NotFoundException('Activo no encontrado')
    return aDto(fila)
  }

  /** Una FK no mira RLS: la faena y el formulario deben ser de esta empresa. */
  private async validarRefs(run: Run, siteId: string, templateId: string): Promise<void> {
    const [faena] = await run<{ id: string }>('SELECT id FROM site WHERE id = $1', [siteId])
    if (!faena) throw new BadRequestException('La faena no existe en tu empresa')
    const [plantilla] = await run<{ status: string }>('SELECT status FROM template WHERE id = $1', [templateId])
    if (!plantilla) throw new BadRequestException('El formulario no existe en tu empresa')
    if (plantilla.status !== 'active') throw new ConflictException('El formulario está archivado')
  }
}

async function auditar(run: Run, actorId: string, tenantId: string, action: string, entityId: string, payload: unknown) {
  await run(
    `INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, 'asset', $5, $6)`,
    [randomUUID(), actorId, tenantId, action, entityId, JSON.stringify(payload)],
  )
}
