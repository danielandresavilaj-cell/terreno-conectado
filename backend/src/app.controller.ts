import { Controller, Get } from '@nestjs/common'
import { APP_VERSION } from './version'

@Controller()
export class AppController {
  @Get()
  root(): { service: string; status: string; version: string } {
    return {
      service: 'terreno-conectado-backend',
      status: 'ok',
      version: APP_VERSION,
    }
  }
}