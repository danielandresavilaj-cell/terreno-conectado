/**
 * Módulo de lectura del dashboard mínimo del supervisor (TSK-WS-011) y de la
 * exportación del documento rellenado (TSK-FORM-010). Sólo lecturas
 * read-only sobre lo sincronizado; guard por roles + RLS.
 *
 * Importa `TemplatesModule` porque el export resuelve el documento original con
 * `TemplatesService.getRevisionOriginal`: la comprobación de que la `file_key`
 * cae dentro del volumen de sync y el 404 de "esta revisión no viene de un
 * import" son los del endpoint del original (TSK-FORM-009) y no se reimplementan.
 */

import { Module } from '@nestjs/common'
import { TemplatesModule } from '../templates/templates.module'
import { DashboardController } from './dashboard.controller'
import { DashboardService } from './dashboard.service'
import { InspectionExportService } from './inspection-export.service'

@Module({
  imports: [TemplatesModule],
  controllers: [DashboardController],
  providers: [DashboardService, InspectionExportService],
  exports: [DashboardService],
})
export class DashboardModule {}
