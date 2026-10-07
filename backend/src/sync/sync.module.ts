/**
 * Módulo de sincronización (TSK-WS-007/009): ingesta idempotente por lotes y
 * lectura de conflictos LWW. Se registra en `AppModule`; el servicio sólo
 * depende de `DbService` (RLS por tenant) y `ConfigService` (`SYNC_VOLUME`).
 */

import { Module } from '@nestjs/common'
import { ConflictsController } from './conflicts.controller'
import { SyncController } from './sync.controller'
import { SyncService } from './sync.service'

@Module({
  controllers: [SyncController, ConflictsController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}