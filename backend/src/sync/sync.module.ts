/**
 * Módulo de ingesta por lotes (TSK-WS-007). Se registra en `AppModule`;
 * el servicio sólo depende de `DbService` (RLS por tenant) y `ConfigService`
 * (`SYNC_VOLUME`).
 */

import { Module } from '@nestjs/common'
import { SyncController } from './sync.controller'
import { SyncService } from './sync.service'

@Module({
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}