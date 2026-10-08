/**
 * Migración 005 — Catálogo de campos de plantilla (módulo 007, TSK-FORM-003,
 * FR-036/FR-039, data-model §2.2).
 *
 * `template_section` y `template_item` materializan el catálogo TIPADO de la
 * definición de una revisión (ADR-003: la `definition` JSONB sigue siendo la
 * fuente de verdad para el render offline; estas tablas dan el catálogo
 * consultable —response_type, props JSONB— para import/export y reportes).
 *
 * RLS (Artículo IV) + inmutabilidad coherente con FR-049:
 *  - Las filas se crean SOLO cuando su revisión está en `draft` (la
 *    materialización ocurre dentro de la publicación, antes del cambio de
 *    estado). Una revisión `published`/`archived` no admite INSERT/UPDATE/
 *    DELETE de sus secciones/ítems desde `tc_app`: el rechazo ocurre en el
 *    motor vía subconsulta al estado de la revisión.
 *  - `tenant_id` va denormalizado por fila (patrón del repo, Artículo IV):
 *    la política aísla sin joins y sin `app.tenant_id` no hay filas visibles.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

const APP_ROLE = 'tc_app'

/**
 * @param {MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE template_section (
      id          uuid PRIMARY KEY,
      revision_id uuid NOT NULL REFERENCES template_revision (id) ON DELETE CASCADE,
      tenant_id   uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      position    integer NOT NULL CHECK (position >= 0),
      title       text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX template_section_revision_idx ON template_section (revision_id, position);')
  pgm.sql('CREATE INDEX template_section_tenant_idx ON template_section (tenant_id);')

  pgm.sql(`
    CREATE TABLE template_item (
      id                      uuid PRIMARY KEY,
      section_id              uuid NOT NULL REFERENCES template_section (id) ON DELETE CASCADE,
      tenant_id               uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      position                integer NOT NULL CHECK (position >= 0),
      prompt                  text NOT NULL,
      response_type           text NOT NULL CHECK (response_type IN
        ('ok_nok_na', 'text', 'numeric', 'date', 'time',
         'select_single', 'select_multiple', 'photo')),
      require_finding_on_nok  boolean NOT NULL DEFAULT false,
      props                   jsonb,
      help                    text,
      created_at              timestamptz NOT NULL DEFAULT now(),
      updated_at              timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX template_item_section_idx ON template_item (section_id, position);')
  pgm.sql('CREATE INDEX template_item_tenant_idx ON template_item (tenant_id);')

  /**
   * `template_section` — la revisión es directa (`revision_id`).
   * `template_item` — la revisión se alcanza vía su sección.
   * Una política por comando (las del mismo comando se OR-an: separando tenant
   * y estado, un UPDATE con tenant OK pasaría aunque la revisión esté
   * publicada). Ambas condiciones van juntas.
   */
  for (const table of ['template_section', 'template_item']) {
    const revisionIsDraft =
      table === 'template_section'
        ? `EXISTS (SELECT 1 FROM template_revision r WHERE r.id = ${table}.revision_id AND r.status = 'draft')`
        : `EXISTS (
             SELECT 1
             FROM template_revision r
             JOIN template_section s ON s.revision_id = r.id
             WHERE s.id = ${table}.section_id AND r.status = 'draft'
           )`

    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`)
    pgm.sql(`
      CREATE POLICY catalog_select ON ${table}
        FOR SELECT
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
    `)
    pgm.sql(`
      CREATE POLICY catalog_insert ON ${table}
        FOR INSERT
        WITH CHECK (
          tenant_id = current_setting('app.tenant_id', true)::uuid
          AND ${revisionIsDraft}
        );
    `)
    pgm.sql(`
      CREATE POLICY catalog_update ON ${table}
        FOR UPDATE
        USING (
          tenant_id = current_setting('app.tenant_id', true)::uuid
          AND ${revisionIsDraft}
        );
    `)
    pgm.sql(`
      CREATE POLICY catalog_delete ON ${table}
        FOR DELETE
        USING (
          tenant_id = current_setting('app.tenant_id', true)::uuid
          AND ${revisionIsDraft}
        );
    `)
    pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO ${APP_ROLE};`)
  }
}

/**
 * @param {MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS template_item;')
  pgm.sql('DROP TABLE IF EXISTS template_section;')
}