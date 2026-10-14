/**
 * Migración 010 — Índice de auditoría para el módulo admin (spec 006, FR-051).
 *
 * La consola de administración lee `audit_log` filtrado por tenant y ordenado
 * por fecha (`GET /api/v1/admin/audit-log?tenant=&action=&desde=&hasta=`). Hoy
 * solo existe `audit_log_occurred_idx (occurred_at DESC)`, que sirve para un
 * recorrido global pero no para "las acciones del tenant X, más recientes
 * primero": Postgres acaba filtrando por `tenant_id` después de ordenar.
 *
 * Este índice compuesto `(tenant_id, occurred_at DESC)` convierte ese patrón en
 * un range scan. No se toca el índice existente: los incidentes cross-tenant se
 * escriben con `tenant_id NULL` (p. ej. `sync_tenant_mismatch`) y siguen
 * consultándose por fecha.
 *
 * No se agregan columnas ni restricciones: `tenant.status` ya es
 * `CHECK IN ('active','suspended')` desde la migración 001, y `audit_log` ya es
 * append-only para `tc_app` (migración 002: SELECT/INSERT, sin UPDATE/DELETE).
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(
    'CREATE INDEX audit_log_tenant_occurred_idx ON audit_log (tenant_id, occurred_at DESC);',
  )
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS audit_log_tenant_occurred_idx;')
}
