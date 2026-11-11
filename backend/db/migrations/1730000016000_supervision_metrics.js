/**
 * Migración 016 — Datos para el dashboard de supervisión (TSK-REP-006).
 *
 * - `inspection.queued_at` / `client_sent_at`: entrada al outbox y envío del
 *   lote, ambos con el reloj del DISPOSITIVO. Su diferencia es la espera sin
 *   señal y no depende de que ese reloj coincida con el del servidor.
 * - `inspection.reviewed_at`: cuándo la supervisión la revisó (FR-031).
 * - `finding.resolved_at`: cuándo se resolvió (tiempo de cierre, FR-032).
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE inspection
      ADD COLUMN IF NOT EXISTS queued_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS client_sent_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL;
    ALTER TABLE finding ADD COLUMN IF NOT EXISTS resolved_at timestamptz NULL;
    UPDATE finding SET resolved_at = updated_at WHERE status = 'resolved' AND resolved_at IS NULL;
  `)
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE finding DROP COLUMN IF EXISTS resolved_at;
    ALTER TABLE inspection
      DROP COLUMN IF EXISTS reviewed_at,
      DROP COLUMN IF EXISTS client_sent_at,
      DROP COLUMN IF EXISTS queued_at;
  `)
}
