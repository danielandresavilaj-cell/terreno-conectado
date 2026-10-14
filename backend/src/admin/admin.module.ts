import { Module } from '@nestjs/common'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

/**
 * Administración de plataforma (spec 006, FR-050/051).
 *
 * No declara providers propios de acceso a datos: usa `DbService` (global) por
 * la conexión *owner*, que es el bypass de RLS deliberado del `platform_admin`.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
