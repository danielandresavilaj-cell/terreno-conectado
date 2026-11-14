/**
 * Módulo de lectura del dashboard mínimo del supervisor (TSK-WS-011) y de la
 * exportación del documento rellenado (TSK-FORM-010). Sólo lecturas
 * read-only sobre lo sincronizado; guard por roles + RLS.
 *
 * Importa `TemplatesModule` porque el export resuelve el documento original con
 * `TemplatesService.getRevisionOriginal`: la comprobación de que la `file_key`
 * cae dentro del volumen de sync y el 404 de "esta revisión no viene de un
 * import" son los del endpoint del original (TSK-FORM-009) y no se reimplementan.
 *
 * Las únicas escrituras son filas de `audit_log` (append-only): la del lote
 * (FR-047) y la de cada resumen con IA (FR-068). Ninguna altera una inspección.
 */

import { Module } from '@nestjs/common'
import { TemplatesModule } from '../templates/templates.module'
import { DashboardController } from './dashboard.controller'
import { InspectionReportService } from './inspection-report.service'
import { SupervisionDashboardService } from './supervision-dashboard.service'
import { DashboardService } from './dashboard.service'
import { InspectionExportLoteService } from './inspection-export-lote.service'
import { InspectionExportService } from './inspection-export.service'
import { REDACTOR_RESUMEN, RedactorClaude } from './resumen-ia'
import { ResumenIAService } from './resumen-ia.service'

@Module({
  imports: [TemplatesModule],
  controllers: [DashboardController],
  providers: [
    DashboardService,
    InspectionExportService,
    InspectionExportLoteService,
    InspectionReportService,
    SupervisionDashboardService,
    ResumenIAService,
    // TSK-REP-014: el redactor de IA es un provider para que los tests inyecten uno falso.
    { provide: REDACTOR_RESUMEN, useFactory: () => new RedactorClaude() },
  ],
  exports: [DashboardService],
})
export class DashboardModule {}
