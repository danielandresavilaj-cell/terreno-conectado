/**
 * Migración 014 — Revisión persistente de conflictos (TSK-DOM-005).
 *
 * El conflicto sigue siendo inmutable en su contenido (ambas versiones); lo
 * único que se agrega es quién lo revisó y cuándo, para que "marcar como
 * revisado" sobreviva a recargar la página y quede auditado.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE conflict_record
      ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS reviewed_by uuid NULL REFERENCES app_user (id);
  `)
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE conflict_record
      DROP COLUMN IF EXISTS reviewed_by,
      DROP COLUMN IF EXISTS reviewed_at;
  `)
}
