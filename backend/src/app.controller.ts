import { Controller, Get } from '@nestjs/common'
import { appVersion } from './app.version'

@Controller()
export class AppController {
  @Get()
  root(): { service: string; status: string; version: string } {
    return {
      service: 'terreno-conectado-backend',
      status: 'ok',
      version: appVersion(),
    }
  }
}
