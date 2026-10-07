import { Controller, Get } from '@nestjs/common'

@Controller()
export class AppController {
  @Get()
  root(): { service: string; status: string; version: string } {
    return {
      service: 'terreno-conectado-backend',
      status: 'ok',
      version: '0.1.0',
    }
  }
}
