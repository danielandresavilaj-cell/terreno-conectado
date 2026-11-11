import { Module } from '@nestjs/common'
import { SupervisionController } from './supervision.controller'
import { SupervisionService } from './supervision.service'

/** Ciclo de supervisión: revisar inspecciones, hallazgos y conflictos (TSK-DOM-005). */
@Module({ controllers: [SupervisionController], providers: [SupervisionService] })
export class SupervisionModule {}
