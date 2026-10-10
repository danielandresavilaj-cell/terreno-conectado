/**
 * Migración 008 — Asignación de plantillas por faena y rol (módulo 007,
 * TSK-FORM-008, FR-008/009; data-model §2.2).
 *
 * `template_assignment` liga una revisión PUBLICADA a una combinación
 * faena + rol. `site_id NULL` = todas las faenas del tenant (asignación
 * global); `role` ∈ {field_worker, supervisor}. El `field_worker` sólo
 * consulta las revisiones publicadas asignadas a su faena y su rol (FR-009);
 * el `tenant_admin` asigna/desasigna.
 *
 * Reglas del motor:
 *  - Único lógico (revisión, faena, rol): dos índices parciales porque en
 *    Postgres un `site_id NULL` no colisiona en un UNIQUE simple. Así la
 *    asignación global y la por faena son cada una únicas.
 *  - `active=false` desactiva sin borrar (auditoría de quién asignó).
 *  - RLS por `tenant_id` (Artículo IV); sin `app.tenant_id` no hay filas.
 *  - No se restringe en CHECK a que la revisión sea `published`: un CHECK no
 *    puede mirar otra tabla. El servicio valida el estado antes de asignar.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

const APP_ROLE = 'tc_app'

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE template_assignment (
      id                   uuid PRIMARY KEY,
      tenant_id            uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      template_revision_id uuid NOT NULL REFERENCES template_revision (id) ON DELETE CASCADE,
      site_id              uuid REFERENCES site (id) ON DELETE CASCADE,
      role                 text NOT NULL CHECK (role IN ('field_worker', 'supervisor')),
      active               boolean NOT NULL DEFAULT true,
      assigned_by          uuid NOT NULL,
      assigned_at          timestamptz NOT NULL DEFAULT now(),
      created_at           timestamptz NOT NULL DEFAULT now(),
      updated_at           timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX template_assignment_tenant_idx ON template_assignment (tenant_id);')
  pgm.sql('CREATE INDEX template_assignment_revision_idx ON template_assignment (template_revision_id);')
  pgm.sql('CREATE INDEX template_assignment_site_role_idx ON template_assignment (tenant_id, site_id, role);')
  pgm.sql(`
    CREATE UNIQUE INDEX template_assignment_global_uidx
      ON template_assignment (template_revision_id, role)
      WHERE site_id IS NULL;
  `)
  pgm.sql(`
    CREATE UNIQUE INDEX template_assignment_site_uidx
      ON template_assignment (template_revision_id, site_id, role)
      WHERE site_id IS NOT NULL;
  `)

  pgm.sql(`
    ALTER TABLE template_assignment ENABLE ROW LEVEL SECURITY;

    CREATE POLICY template_assignment_select ON template_assignment
      FOR SELECT
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

    CREATE POLICY template_assignment_insert ON template_assignment
      FOR INSERT
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

    CREATE POLICY template_assignment_update ON template_assignment
      FOR UPDATE
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

    CREATE POLICY template_assignment_delete ON template_assignment
      FOR DELETE
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `)

  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON template_assignment TO ${APP_ROLE};`)
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`REVOKE ALL ON template_assignment FROM ${APP_ROLE};`)
  pgm.sql('DROP POLICY IF EXISTS template_assignment_delete ON template_assignment;')
  pgm.sql('DROP POLICY IF EXISTS template_assignment_update ON template_assignment;')
  pgm.sql('DROP POLICY IF EXISTS template_assignment_insert ON template_assignment;')
  pgm.sql('DROP POLICY IF EXISTS template_assignment_select ON template_assignment;')
  pgm.sql('ALTER TABLE template_assignment DISABLE ROW LEVEL SECURITY;')
  pgm.sql('DROP TABLE IF EXISTS template_assignment;')
}
