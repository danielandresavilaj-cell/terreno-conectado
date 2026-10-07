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
import { verify } from '@node-rs/argon2'
import type { CookieOptions, Request, Response } from 'express'
import { DbService } from '../db/db.service'
import type {
  AuthUserRow,
  JwtClaims,
  LoginBody,
  LoginResult,
  PublicProfile,
  SessionRow,
} from './auth.types'

const ACCESS_TTL_JOSE = '15m'
const REFRESH_TTL_DAYS = 30
const MAX_FAILED_LOGINS = 5
const LOCK_MINUTES = 15
const LOCKED_STATUS = 423
const COOKIE_PATH = '/api/v1/auth'
const CSRF_HEADER = 'x-csrf-token'

/** Rate-limit por IP (FR-005: "por cuenta e IP"). En memoria: un solo instancia
 * del backend en el skeleton; multi-instancia → store compartido (ADR-002). */
interface IpCounter {
  fails: number
  blockedUntil: number
}

@Injectable()
export class AuthService {
  private readonly ipFails = new Map<string, IpCounter>()

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

    if (user.tenant_status !== 'active') {
      throw new UnauthorizedException('Credenciales inválidas')
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      throw new HttpException(
        `Cuenta bloqueada temporalmente (${LOCK_MINUTES} min)`,
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
    this.ipFails.delete(ip)

    // Una sesión activa por usuario (rotaciones conviven en su familia).
    await this.db.queryOwner(
      'UPDATE auth_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
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

    // Rotación D5: revocamos este rt e insertamos uno nuevo en la misma familia.
    await this.db.queryOwner(
      'UPDATE auth_session SET revoked_at = now() WHERE id = $1',
      [session.id],
    )
    const rotated = await this.createSession(user, session.family_id)
    this.setAuthCookies(res, rotated.token)

    return { access_token: await this.signAccessToken(user) }
  }

  /* ------------------------------------------------------------------- me */

  async me(claims: JwtClaims): Promise<PublicProfile> {
    const sql = 'SELECT id, tenant_id, email, role, full_name FROM app_user WHERE id = $1'
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

  private async registerAccountFail(user: AuthUserRow): Promise<void> {
    await this.db.queryOwner(
      `UPDATE app_user
         SET failed_login_count = failed_login_count + 1,
             locked_until = CASE
               WHEN failed_login_count + 1 >= ${MAX_FAILED_LOGINS}
               THEN now() + interval '${LOCK_MINUTES} minutes'
               ELSE locked_until
             END
       WHERE id = $1`,
      [user.id],
    )
  }

  private registerIpFail(ip: string): void {
    const entry = this.ipFails.get(ip) ?? { fails: 0, blockedUntil: 0 }
    entry.fails += 1
    if (entry.fails >= MAX_FAILED_LOGINS) {
      entry.blockedUntil = Date.now() + LOCK_MINUTES * 60_000
    }
    this.ipFails.set(ip, entry)
  }

  private isIpBlocked(ip: string): boolean {
    const entry = this.ipFails.get(ip)
    return entry ? entry.blockedUntil > Date.now() : false
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

  private async signAccessToken(user: AuthUserRow): Promise<string> {
    const secret = new TextEncoder().encode(
      this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    )
    return new SignJWT({
      tenant_id: user.tenant_id,
      rol: user.role,
      full_name: user.full_name,
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
    res.cookie('csrf', randomBytes(24).toString('hex'), {
      ...this.cookieBase(),
      httpOnly: false,
    })
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie('rt', this.cookieBase())
    res.clearCookie('csrf', this.cookieBase())
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
  }
}

const AUTH_USER_SQL = `
  SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role, u.full_name,
         u.is_active, u.failed_login_count, u.locked_until,
         t.slug AS tenant_slug, t.status AS tenant_status
  FROM app_user u
  LEFT JOIN tenant t ON t.id = u.tenant_id
  WHERE u.email = $1
`

const AUTH_USER_SQL_ID = `
  SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role, u.full_name,
         u.is_active, u.failed_login_count, u.locked_until,
         t.slug AS tenant_slug, t.status AS tenant_status
  FROM app_user u
  LEFT JOIN tenant t ON t.id = u.tenant_id
  WHERE u.id = $1
`