import type {
  CanActivate,
  ExecutionContext} from '@nestjs/common';
import {
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
    try {
      const secret = new TextEncoder().encode(
        this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      )
      const { payload } = await jwtVerify(header.slice(7), secret, {
        algorithms: ['HS256'],
      })
      ;(request as unknown as { user: JwtClaims }).user = {
        sub: String(payload.sub),
        tenant_id: (payload.tenant_id as string | null) ?? null,
        rol: String(payload.rol),
      }
      return true
    } catch {
      throw new UnauthorizedException('Sesión inválida o expirada')
    }
  }
}