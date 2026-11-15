/**
 * Migración 025 — Alerta desde la bitácora (TSK-DOM-009, FR-069, Enmienda 010).
 *
 * Hasta ahora un hallazgo nacía de una respuesta NOK de una inspección y su
 * faena se leía de esa inspección. Desde la bitácora un trabajador también
 * puede reportar una alerta, que no tiene inspección:
 *
 *  - `log_entry_id`: la entrada de bitácora de la que nació la alerta.
 *  - `site_id`: la faena del hallazgo cuando no viene de una inspección. Las
 *    lecturas usan `COALESCE(finding.site_id, inspection.site_id)`, así que los
 *    hallazgos existentes no cambian.
 *
 * Ambas columnas son opcionales y la ingesta de sync las acepta de clientes
 * nuevos; las colas antiguas siguen sincronizando igual (Art. III). RLS: la
 * tabla `finding` ya tiene su política por `tenant_id`; las FK se validan
 * además contra el tenant en la ingesta (`assertRefs`).
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE finding
      ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES site (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS log_entry_id uuid REFERENCES log_entry (id) ON DELETE SET NULL;
  `)
  pgm.sql('CREATE INDEX IF NOT EXISTS finding_site_idx ON finding (tenant_id, site_id) WHERE site_id IS NOT NULL;')
  pgm.sql('CREATE INDEX IF NOT EXISTS finding_log_entry_idx ON finding (log_entry_id) WHERE log_entry_id IS NOT NULL;')
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS finding_log_entry_idx;')
  pgm.sql('DROP INDEX IF EXISTS finding_site_idx;')
  pgm.sql('ALTER TABLE finding DROP COLUMN IF EXISTS log_entry_id, DROP COLUMN IF EXISTS site_id;')
}
