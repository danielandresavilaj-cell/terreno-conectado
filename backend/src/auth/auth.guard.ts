import type {
  CanActivate,
  ExecutionContext} from '@nestjs/common';
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { jwtVerify } from 'jose'
import type { JwtClaims } from './auth.types'

/**
 * Valida el access token (HS256, ≤15 min, NFR-06) y deja los claims en
 * `req.user` para los handlers protegidos.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>()
    const header = request.headers['authorization']
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException()
    }
    let claims: JwtClaims
    try {
      const secret = new TextEncoder().encode(
        this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      )
      const { payload } = await jwtVerify(header.slice(7), secret, {
        algorithms: ['HS256'],
      })
      claims = {
        sub: String(payload.sub),
        tenant_id: (payload.tenant_id as string | null) ?? null,
        rol: String(payload.rol),
        mcp: payload.mcp === true,
      }
    } catch {
      throw new UnauthorizedException('Sesión inválida o expirada')
    }
    // TSK-AUTH-010: con clave temporal sólo se puede consultar el perfil y
    // cambiarla. Cualquier otra ruta responde 403 con un código que el cliente
    // usa para mostrar la pantalla de cambio obligatorio.
    const ruta = rutaDe(request as { url?: unknown; originalUrl?: unknown })
    if (claims.mcp && !RUTAS_CON_CLAVE_TEMPORAL.some((r) => ruta.endsWith(r))) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'password_change_required',
        message: 'Debes cambiar tu contraseña antes de continuar',
      })
    }
    ;(request as unknown as { user: JwtClaims }).user = claims
    return true
  }
}

const RUTAS_CON_CLAVE_TEMPORAL = ['/auth/me', '/me', '/auth/password', '/auth/logout']

function rutaDe(request: { url?: unknown; originalUrl?: unknown }): string {
  const url = typeof request.originalUrl === 'string' ? request.originalUrl : String(request.url ?? '')
  return url.split('?')[0].replace(/\/+$/, '')
}