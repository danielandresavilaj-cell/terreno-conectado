import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AdminModule } from './admin/admin.module'
import { AppController } from './app.controller'
import { AuthModule } from './auth/auth.module'
import { DashboardModule } from './dashboard/dashboard.module'
import { DbModule } from './db/db.module'
import { HealthModule } from './health/health.module'
import { StorageModule } from './storage/storage.module'
import { SyncModule } from './sync/sync.module'
import { UsersModule } from './users/users.module'
import { SupervisionModule } from './supervision/supervision.module'
import { TemplatesModule } from './templates/templates.module'

@Module({
  imports: [
    // El monorepo mantiene su configuración local en la raíz. Conservamos el
    // fallback `backend/.env` para despliegues que usen esa estructura.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    DbModule,
    StorageModule,
    AuthModule,
    AdminModule,
    SyncModule,
    DashboardModule,
    HealthModule,
    TemplatesModule,
    UsersModule,
    SupervisionModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
