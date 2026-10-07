import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { AuthGuard } from './auth.guard'
import { AuthService } from './auth.service'
import type { JwtClaims, LoginBody } from './auth.types'

/**
 * Contratos (spec 001):
 *  - POST /api/v1/auth/login   → { access_token, user } + cookies rt/csrf
 *  - POST /api/v1/auth/refresh → { access_token } (rota la cookie rt, D5)
 *  - GET  /api/v1/me           → perfil del usuario autenticado
 */
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @HttpCode(200)
  @Post('login')
  async login(
    @Body() body: LoginBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login(body, req.ip ?? 'unknown', res)
  }

  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.refresh(req, res)
  }
}

@Controller()
export class MeController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @UseGuards(AuthGuard)
  @Get('me')
  async me(@Req() req: Request & { user?: JwtClaims }) {
    return this.auth.me(req.user as JwtClaims)
  }
}