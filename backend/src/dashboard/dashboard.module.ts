/**
 * Módulo de lectura del dashboard mínimo del supervisor (TSK-WS-011).
 * Sólo lecturas read-only sobre lo sincronizado; guard por roles + RLS.
 */

import { Module } from '@nestjs/common'
import { DashboardController } from './dashboard.controller'
import { DashboardService } from './dashboard.service'

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}