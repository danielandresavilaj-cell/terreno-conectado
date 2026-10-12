import { Global, Module } from '@nestjs/common'
import { SyncVolumeService } from './sync-volume.service'

/**
 * Acceso al volumen de adjuntos. Es `@Global()` por lo mismo que `DbModule`: lo
 * necesitan varios módulos (sync, templates, dashboard) y no comparte estado con
 * ellos — sólo la raíz del volumen y la validación de rutas.
 */
@Global()
@Module({
  providers: [SyncVolumeService],
  exports: [SyncVolumeService],
})
export class StorageModule {}
