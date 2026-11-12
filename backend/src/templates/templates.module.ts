import { Module } from '@nestjs/common'
import { TemplatesController } from './templates.controller'
import { ANALIZADOR_IA, AnalizadorClaude } from './importar-ia'
import { TemplatesService } from './templates.service'

/**
 * Módulo 007 — plantillas versionadas (TSK-FORM-002) + endpoints de lectura
 * para el renderer (TSK-FORM-001). DbModule es @Global (DbService inyectable).
 */
@Module({
  controllers: [TemplatesController],
  // TSK-FORM-021: la IA es un provider para que los tests inyecten uno falso.
  providers: [TemplatesService, { provide: ANALIZADOR_IA, useFactory: () => new AnalizadorClaude() }],
  exports: [TemplatesService],
})
export class TemplatesModule {}