import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'
import { hash, verify } from '@node-rs/argon2'
import type { CookieOptions, Request, Response } from 'express'
import { DbService } from '../db/db.service'
import { IpRateLimiter } from './ip-rate-limiter'
import type {
  AuthUserRow,
  ChangePasswordBody,
  JwtClaims,
  LoginBody,
  LoginResult,
  PublicProfile,
  SessionRow,
} from './auth.types'
import { MIN_PASSWORD_LENGTH } from './auth.types'

const ACCESS_TTL_JOSE = '15m'
const REFRESH_TTL_DAYS = 30
const MAX_FAILED_LOGINS = 5
const LOCK_MINUTES = 15
const LOCKED_STATUS = 423
const COOKIE_PATH = '/api/v1/auth'
const CSRF_HEADER = 'x-csrf-token'

@Injectable()
export class AuthService {
  /** Rate-limit por IP (FR-005: "por cuenta e IP"); ver `IpRateLimiter`. */
  private readonly ipLimiter = new IpRateLimiter({
    maxFails: MAX_FAILED_LOGINS,
    windowMs: LOCK_MINUTES * 60_000,
    blockMs: LOCK_MINUTES * 60_000,
  })

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /* ---------------------------------------------------------------- login */

  async login(body: LoginBody, ip: string, res: Response): Promise<LoginResult> {
    if (typeof body?.email !== 'string' || typeof body?.password !== 'string') {
      throw new BadRequestException('Faltan email o password')
    }
    const email = body.email.trim().toLowerCase()

    const users = await this.db.queryOwner<AuthUserRow>(AUTH_USER_SQL, [email])
    const candidates = body.tenant
      ? users.filter((u) => u.tenant_slug === body.tenant)
      : users

    // Credenciales inválidas a propósito: misma respuesta para email inexistente,
    // email en dos tenants sin slug, o password errónea (evita enumeración).
    if (candidates.length !== 1) {
      this.registerIpFail(ip)
      throw new UnauthorizedException('Credenciales inválidas')
    }

    const user = candidates[0]

    if (user.role !== 'platform_admin' && user.tenant_status !== 'active') {
      throw new UnauthorizedException('Credenciales inválidas')
    }
    if (!user.is_active) {
      throw new UnauthorizedException('Credenciales inválidas')
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      // TSK-AUTH-012: los minutos que FALTAN, no siempre los 15 del bloqueo.
      const minutos = Math.max(1, Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60_000))
      throw new HttpException(
        { statusCode: LOCKED_STATUS, message: `Cuenta bloqueada temporalmente (${minutos} min)`, minutos },
        LOCKED_STATUS,
      )
    }
    if (this.isIpBlocked(ip)) {
      throw new HttpException('Demasiados intentos', HttpStatus.TOO_MANY_REQUESTS)
    }

    const passwordOk = await this.verifyPassword(user.password_hash, body.password)
    if (!passwordOk) {
      await this.registerAccountFail(user)
      this.registerIpFail(ip)
      throw new UnauthorizedException('Credenciales inválidas')
    }

    await this.db.queryOwner(
      'UPDATE app_user SET failed_login_count = 0, locked_until = NULL WHERE id = $1',
      [user.id],
    )
    this.ipLimiter.reset(ip)

    // Una sesión activa por usuario (rotaciones conviven en su familia). El
    // motivo deja avisar al otro dispositivo en vez de "expiró" (TSK-AUTH-011).
    await this.db.queryOwner(
      `UPDATE auth_session SET revoked_at = now(), revoked_reason = 'new_login'
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    )
    const session = await this.createSession(user)
    this.setAuthCookies(res, session.token)

    return {
      access_token: await this.signAccessToken(user),
      user: profileOf(user),
    }
  }

  /* --------------------------------------------------------------- refresh */

  async refresh(req: Request, res: Response): Promise<{ access_token: string }> {
    const token = this.readCookie(req, 'rt')
    const csrf = this.readCookie(req, 'csrf')
    if (!token || !csrf || req.headers[CSRF_HEADER] !== csrf) {
      throw new UnauthorizedException('Sesión inválida')
    }

    const sessions = await this.db.queryOwner<SessionRow>(
      'SELECT * FROM auth_session WHERE token_hash = $1',
      [sha256(token)],
    )
    const session = sessions[0]
    if (!session) {
      throw new UnauthorizedException('Sesión inválida')
    }
    if (session.revoked_at && session.revoked_reason === 'new_login') {
      // Se entró con esta cuenta en otro dispositivo: no es robo, es reemplazo.
      this.clearAuthCookies(res)
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'session_replaced',
        message: 'Iniciaste sesión en otro dispositivo; esta sesión se cerró',
      })
    }
    if (session.revoked_at) {
      // Refresh token ya rotado vuelve a presentarse → posible robo (D5).
      await this.revokeFamily(session, 'token_reuse')
      this.clearAuthCookies(res)
      throw new UnauthorizedException('Sesión revocada')
    }
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await this.db.queryOwner(
        'UPDATE auth_session SET revoked_at = now() WHERE id = $1',
        [session.id],
      )
      this.clearAuthCookies(res)
      throw new UnauthorizedException('Sesión expirada')
    }

    const users = await this.db.queryOwner<AuthUserRow>(AUTH_USER_SQL_ID, [
      session.user_id,
    ])
    const user = users[0]
    if (!user || !user.is_active) {
      throw new UnauthorizedException('Cuenta inactiva')
    }
    if (user.role !== 'platform_admin' && user.tenant_status !== 'active') {
      // Empresa suspendida: la sesión deja de renovarse.
      await this.revokeFamily(session, 'refresh_tenant_inactive')
      this.clearAuthCookies(res)
      throw new UnauthorizedException('Cuenta inactiva')
    }

    // Rotación D5: revocamos este rt e insertamos uno nuevo en la misma familia.
    await this.db.queryOwner(
      'UPDATE auth_session SET revoked_at = now() WHERE id = $1',
      [session.id],
    )
    const rotated = await this.createSession(user, session.family_id)
    this.setAuthCookies(res, rotated.token)

    return { access_token: await this.signAccessToken(user) }
  }

  /* ------------------------------------------------------- password (010) */

  /**
   * Cambio de la clave propia (TSK-AUTH-010). También es la salida obligatoria
   * de una clave temporal: baja `must_change_password`, revoca TODAS las
   * sesiones del usuario y abre una nueva en este dispositivo, así el que
   * cambia la clave sigue dentro y cualquier otra copia queda fuera.
   */
  async changePassword(
    claims: JwtClaims,
    body: ChangePasswordBody,
    res: Response,
  ): Promise<LoginResult> {
    const actual = typeof body?.current_password === 'string' ? body.current_password : ''
    const nueva = typeof body?.new_password === 'string' ? body.new_password : ''
    if (!actual || !nueva) {
      throw new BadRequestException('Faltan la contraseña actual o la nueva')
    }
    if (nueva.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
      )
    }
    if (nueva === actual) {
      throw new BadRequestException('La nueva contraseña debe ser distinta de la actual')
    }

    const users = await this.db.queryOwner<AuthUserRow>(AUTH_USER_SQL_ID, [claims.sub])
    const user = users[0]
    if (!user || !user.is_active) {
      throw new UnauthorizedException('Cuenta inactiva')
    }
    if (!(await this.verifyPassword(user.password_hash, actual))) {
      throw new BadRequestException('La contraseña actual no es correcta')
    }

    await this.db.queryOwner(
      `UPDATE app_user
         SET password_hash = $2, must_change_password = false,
             failed_login_count = 0, locked_until = NULL, updated_at = now()
       WHERE id = $1`,
      [user.id, await hash(nueva)],
    )
    await this.db.queryOwner(
      "UPDATE auth_session SET revoked_at = now(), revoked_reason = 'password_changed' WHERE user_id = $1 AND revoked_at IS NULL",
      [user.id],
    )
    await this.audit(user.id, user.tenant_id, 'password_changed', 'app_user', user.id, {
      was_temporary: user.must_change_password,
    })

    const actualizado = { ...user, must_change_password: false }
    const session = await this.createSession(actualizado)
    this.setAuthCookies(res, session.token)
    return {
      access_token: await this.signAccessToken(actualizado),
      user: profileOf(actualizado),
    }
  }

  /* ---------------------------------------------------------- logout (010) */

  /**
   * Cierra la sesión de este dispositivo: revoca la familia del refresh token
   * y borra las cookies. No exige access token (puede haber vencido), pero sí
   * el header CSRF cuando hay cookie, para que otro sitio no pueda forzarlo.
   */
  async logout(req: Request, res: Response): Promise<void> {
    const token = this.readCookie(req, 'rt')
    const csrf = this.readCookie(req, 'csrf')
    if (token) {
      if (!csrf || req.headers[CSRF_HEADER] !== csrf) {
        throw new UnauthorizedException('Sesión inválida')
      }
      const sessions = await this.db.queryOwner<SessionRow>(
        'SELECT * FROM auth_session WHERE token_hash = $1',
        [sha256(token)],
      )
      if (sessions[0]) await this.revokeFamily(sessions[0], 'logout')
    }
    this.clearAuthCookies(res)
  }

  /* ------------------------------------------------------------------- me */

  async me(claims: JwtClaims): Promise<PublicProfile> {
    const sql =
      'SELECT id, tenant_id, email, role, full_name, must_change_password FROM app_user WHERE id = $1'
    const rows = claims.tenant_id
      ? await this.db.queryAsTenant<PublicProfile>(claims.tenant_id, sql, [claims.sub])
      : await this.db.queryOwner<PublicProfile>(sql, [claims.sub]) // platform_admin
    if (rows.length === 0) {
      throw new UnauthorizedException('Usuario no encontrado')
    }
    return rows[0]
  }

  /* ------------------------------------------------------------- helpers */

  private async verifyPassword(hashValue: string, password: string): Promise<boolean> {
    try {
      return await verify(hashValue, password)
    } catch {
      return false
    }
  }

  /**
   * FR-005: "5 veces consecutivas". Un bloqueo ya cumplido cierra la racha: el
   * primer fallo después de él cuenta como el 1, no como el 6 (TSK-AUTH-012).
   * Sin esto, al vencer los 15 min un solo error volvía a bloquear la cuenta.
   */
  private async registerAccountFail(user: AuthUserRow): Promise<void> {
    await this.db.queryOwner(
      `UPDATE app_user
         SET failed_login_count = CASE
               WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
               ELSE failed_login_count + 1
             END,
             locked_until = CASE
               WHEN (CASE
                       WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
                       ELSE failed_login_count + 1
                     END) >= ${MAX_FAILED_LOGINS}
               THEN now() + interval '${LOCK_MINUTES} minutes'
               WHEN locked_until IS NOT NULL AND locked_until <= now() THEN NULL
               ELSE locked_until
             END
       WHERE id = $1`,
      [user.id],
    )
  }

  private registerIpFail(ip: string): void {
    this.ipLimiter.registerFail(ip)
  }

  private isIpBlocked(ip: string): boolean {
    return this.ipLimiter.isBlocked(ip)
  }

  private async createSession(
    user: AuthUserRow,
    familyId?: string,
  ): Promise<{ token: string }> {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000)
    await this.db.queryOwner(
      `INSERT INTO auth_session (id, user_id, tenant_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        user.id,
        user.tenant_id,
        familyId ?? randomUUID(),
        sha256(token),
        expiresAt.toISOString(),
      ],
    )
    return { token }
  }

  private async revokeFamily(session: SessionRow, action: string): Promise<void> {
    await this.db.queryOwner(
      'UPDATE auth_session SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
      [session.family_id],
    )
    await this.db.queryOwner(
      `INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        session.user_id,
        session.tenant_id,
        action,
        'auth_session',
        session.family_id,
        JSON.stringify({ user_id: session.user_id }),
      ],
    )
  }

  private async audit(
    actorId: string,
    tenantId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.db.queryOwner(
      `INSERT INTO audit_log (id, actor_id, tenant_id, action, entity_type, entity_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), actorId, tenantId, action, entityType, entityId, JSON.stringify(payload)],
    )
  }

  private async signAccessToken(user: AuthUserRow): Promise<string> {
    const secret = new TextEncoder().encode(
      this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    )
    return new SignJWT({
      tenant_id: user.tenant_id,
      rol: user.role,
      full_name: user.full_name,
      mcp: user.must_change_password,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(ACCESS_TTL_JOSE)
      .sign(secret)
  }

  private setAuthCookies(res: Response, refreshToken: string): void {
    res.cookie('rt', refreshToken, {
      ...this.cookieBase(),
      httpOnly: true,
      maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    })
    // La cookie csrf vive en `/` (no en COOKIE_PATH): la PWA tiene que poder
    // leerla con `document.cookie` para mandarla en el header (doble envío).
    res.cookie('csrf', randomBytes(24).toString('hex'), {
      ...this.cookieBase(),
      path: '/',
      httpOnly: false,
      maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    })
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie('rt', this.cookieBase())
    res.clearCookie('csrf', { ...this.cookieBase(), path: '/', httpOnly: false })
  }

  private cookieBase(): CookieOptions {
    return {
      path: COOKIE_PATH,
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
    }
  }

  private readCookie(req: Request, name: string): string | undefined {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies
    return typeof cookies?.[name] === 'string' ? cookies[name] : undefined
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function profileOf(user: AuthUserRow): PublicProfile {
  return {
    id: user.id,
    tenant_id: user.tenant_id,
    email: user.email,
    role: user.role,
    full_name: user.full_name,
    must_change_password: user.must_change_password,
  }
}

const AUTH_USER_SQL = `
  SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role, u.full_name,
         u.is_active, u.failed_login_count, u.locked_until, u.must_change_password,
         t.slug AS tenant_slug, t.status AS tenant_status
  FROM app_user u
  LEFT JOIN tenant t ON t.id = u.tenant_id
  WHERE u.email = $1
`

const AUTH_USER_SQL_ID = `
  SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role, u.full_name,
         u.is_active, u.failed_login_count, u.locked_until, u.must_change_password,
         t.slug AS tenant_slug, t.status AS tenant_status
  FROM app_user u
  LEFT JOIN tenant t ON t.id = u.tenant_id
  WHERE u.id = $1
`