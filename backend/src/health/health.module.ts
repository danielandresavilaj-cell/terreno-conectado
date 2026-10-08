import { Module } from '@nestjs/common'
import { DbModule } from '../db/db.module'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'

@Module({
  imports: [DbModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}