import { Module } from '@nestjs/common'
import { TemplatesService } from './templates.service'

/**
 * Módulo 007 — plantillas versionadas (TSK-FORM-002).
 * Sin endpoints todavía: el servicio lo usan las tasks siguientes (renderer,
 * import, asignación) vía DI. DbModule es @Global (DbService inyectable).
 */
@Module({
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}