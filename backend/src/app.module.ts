import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AppController } from './app.controller'
import { AuthModule } from './auth/auth.module'
import { DashboardModule } from './dashboard/dashboard.module'
import { DbModule } from './db/db.module'
import { HealthModule } from './health/health.module'
import { SyncModule } from './sync/sync.module'
import { TemplatesModule } from './templates/templates.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    DbModule,
    AuthModule,
    SyncModule,
    DashboardModule,
    HealthModule,
    TemplatesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}