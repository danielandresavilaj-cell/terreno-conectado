import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AppController } from './app.controller'
import { AuthModule } from './auth/auth.module'
import { DbModule } from './db/db.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    DbModule,
    AuthModule,
  ],
  controllers: [AppController],
})
export class AppModule {}