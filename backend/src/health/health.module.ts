import { Module } from '@nestjs/common'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'

/**
 * Modulo de salud del servicio (TSK-WS-012). DbService es global (DbModule
 * @Global), asi que se inyecta sin importar DbModule.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}