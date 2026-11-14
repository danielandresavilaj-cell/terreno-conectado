/**
 * Migración 023 — Avance del responsable de un hallazgo (TSK-DOM-008, FR-067).
 *
 * FR-064 dejó al hallazgo con responsable, plazo y nota de cierre, pero el
 * responsable no lo veía en ninguna parte. Ahora lo ve en "Hallazgos", lo
 * empieza y reporta lo que hizo; supervisión verifica y lo resuelve.
 *
 *  - `assigned_at`: cuándo se le asignó a su responsable actual (orden de la
 *    lista y aviso de "nuevo"). Se rellena con `updated_at` en los ya asignados.
 *  - `progress_note` / `reported_at`: lo que el responsable dice que hizo y
 *    cuándo lo reportó. "Listo para revisar" = `in_progress` + `reported_at`.
 *
 * El estado no cambia de dominio (open | in_progress | resolved) y la ingesta de
 * sync no toca estas columnas (su UPDATE lista columnas): una corrección que
 * llega del dispositivo no borra el avance.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE finding
      ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
      ADD COLUMN IF NOT EXISTS progress_note text
        CHECK (progress_note IS NULL OR char_length(progress_note) <= 2000),
      ADD COLUMN IF NOT EXISTS reported_at timestamptz;
  `)
  pgm.sql('UPDATE finding SET assigned_at = updated_at WHERE assignee_id IS NOT NULL AND assigned_at IS NULL;')
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE finding
      DROP COLUMN IF EXISTS reported_at,
      DROP COLUMN IF EXISTS progress_note,
      DROP COLUMN IF EXISTS assigned_at;
  `)
}
