/**
 * Migración 007 — Entidad TEMPLATE_IMPORT + documento fuente ATTACHMENT
 * (módulo 007, TSK-FORM-007, FR-029/047/051, data-model §2.2 v1.2.0).
 *
 * 1. Crea `template_imports` con ciclo de vida `uploaded → parsed → proposed →
 *    confirmed|failed`. Guarda la propuesta parseada en `proposed_schema` y
 *    la referencia al archivo fuente en `file_key` (ATTACHMENT con
 *    `owner_type='template_import'`).
 *
 * 2. Ensancha el CHECK de `attachment.owner_type` con 'template_import'.
 *
 * 3. Agrega FK `template_revision.source_import_id → template_imports.id`.
 *
 * 4. RLS por tenant + grants a `tc_app`.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

const APP_ROLE = 'tc_app'

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE template_imports (
      id              uuid PRIMARY KEY,
      tenant_id       uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      uploaded_by     uuid NOT NULL,
      file_key        text NOT NULL,
      file_name       text NOT NULL,
      status          text NOT NULL CHECK (status IN ('uploaded', 'parsed', 'proposed', 'confirmed', 'failed')),
      proposed_schema jsonb NULL,
      error           text NULL,
      confirmed_at    timestamptz NULL,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX template_imports_tenant_idx ON template_imports (tenant_id);')
  pgm.sql('CREATE INDEX template_imports_status_idx ON template_imports (tenant_id, status);')

  pgm.sql(`
    ALTER TABLE template_revision
    ADD CONSTRAINT template_revision_source_import_id_fkey
    FOREIGN KEY (source_import_id) REFERENCES template_imports (id) ON DELETE SET NULL;
  `)

  pgm.sql(`
    ALTER TABLE attachment DROP CONSTRAINT IF EXISTS attachment_owner_type_check;
    ALTER TABLE attachment ADD CONSTRAINT attachment_owner_type_check
      CHECK (owner_type IN ('inspection', 'finding', 'log_entry', 'response', 'template_import'));
  `)

  pgm.sql(`
    ALTER TABLE template_imports ENABLE ROW LEVEL SECURITY;

    CREATE POLICY template_imports_select ON template_imports
      FOR SELECT
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

    CREATE POLICY template_imports_insert ON template_imports
      FOR INSERT
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

    CREATE POLICY template_imports_update ON template_imports
      FOR UPDATE
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

    CREATE POLICY template_imports_delete ON template_imports
      FOR DELETE
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `)

  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON template_imports TO ${APP_ROLE};`)
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`REVOKE ALL ON template_imports FROM ${APP_ROLE};`)
  pgm.sql('DROP POLICY IF EXISTS template_imports_delete ON template_imports;')
  pgm.sql('DROP POLICY IF EXISTS template_imports_update ON template_imports;')
  pgm.sql('DROP POLICY IF EXISTS template_imports_insert ON template_imports;')
  pgm.sql('DROP POLICY IF EXISTS template_imports_select ON template_imports;')
  pgm.sql('ALTER TABLE template_imports DISABLE ROW LEVEL SECURITY;')

  pgm.sql(`
    ALTER TABLE attachment DROP CONSTRAINT IF EXISTS attachment_owner_type_check;
    ALTER TABLE attachment ADD CONSTRAINT attachment_owner_type_check
      CHECK (owner_type IN ('inspection', 'finding', 'log_entry', 'response'));
  `)

  pgm.sql('ALTER TABLE template_revision DROP CONSTRAINT IF EXISTS template_revision_source_import_id_fkey;')
  pgm.sql('DROP TABLE IF EXISTS template_imports;')
}
