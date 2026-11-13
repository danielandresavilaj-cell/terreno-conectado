/**
 * Migración 020 — Hallazgo como acción correctiva (TSK-DOM-007, FR-064).
 *
 * Un hallazgo sólo tenía estado. Para que alguien se haga cargo se agregan
 * responsable, plazo y nota de cierre. Los escribe sólo supervisión desde el
 * servidor: la ingesta de sync no los toca (su UPDATE lista columnas), así que
 * una corrección que llega del dispositivo no borra la asignación.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE finding
      ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES app_user (id),
      ADD COLUMN IF NOT EXISTS due_date date,
      ADD COLUMN IF NOT EXISTS resolution_note text
        CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 2000);
  `)
  pgm.sql('CREATE INDEX IF NOT EXISTS finding_tenant_assignee_idx ON finding (tenant_id, assignee_id) WHERE assignee_id IS NOT NULL;')
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS finding_tenant_assignee_idx;')
  pgm.sql(`
    ALTER TABLE finding
      DROP COLUMN IF EXISTS resolution_note,
      DROP COLUMN IF EXISTS due_date,
      DROP COLUMN IF EXISTS assignee_id;
  `)
}
