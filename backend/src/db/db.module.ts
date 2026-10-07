import { Global, Module } from '@nestjs/common'
import { DbService } from './db.service'

/**
 * Acceso a PostgreSQL.
 *
 *  - owner: credenciales admin (migraciones/seed/auth). Bypass de RLS auditable
 *    (spec maestro §7): login y gestión de sesiones buscan al usuario por email
 *    ANTES de conocer su tenant.
 *  - app (tc_app): conexión de la aplicación, sujeta a RLS. Cada consulta abre
 *    transacción y fija `app.tenant_id` con SET LOCAL (Artículo IV).
 */
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}