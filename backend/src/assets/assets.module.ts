import { Module } from '@nestjs/common'
import { AssetsController } from './assets.controller'
import { AssetsService } from './assets.service'

/** Activos y QR (TSK-OPS-003-C, FR-060/061). */
@Module({ controllers: [AssetsController], providers: [AssetsService] })
export class AssetsModule {}
