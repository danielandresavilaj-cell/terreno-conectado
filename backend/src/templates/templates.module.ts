import { Module } from '@nestjs/common'
import { TemplatesController } from './templates.controller'
import { TemplatesService } from './templates.service'

/**
 * Módulo 007 — plantillas versionadas (TSK-FORM-002) + endpoints de lectura
 * para el renderer (TSK-FORM-001). DbModule es @Global (DbService inyectable).
 */
@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}