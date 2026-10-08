/**
 * Migración 004 — Plantillas versionadas (módulo 007, TSK-FORM-002, FR-007/049).
 *
 * Entidades `TEMPLATE` (cabecera) y `TEMPLATE_REVISION` (contenido versionado e
 * inmutable) del data-model §2.2 (v1.1.0, PR #65).
 *
 * Aislamiento multi-tenant por RLS (FR-007, Artículo IV) y congelamiento de
 * revisiones publicadas (FR-049): `tc_app` solo puede INSERT/UPDATE/DELETE
 * sobre revisiones en estado `draft`. Una vez `published` o `archived` ninguna
 * política permite tocar la fila — el rechazo ocurre en el motor, no en la app.
 *
 * NOTAS:
 *  - `template_revision.version` es NULL en borrador y se asigna al publicar
 *    (max+1 por plantilla, FR-027); índice parcial único evita dos versiones
 *    iguales en la misma plantilla.
 *  - `source_import_id` queda sin FK hasta la migración del TSK-FORM-007
 *    (entidad TEMPLATE_IMPORT); columna reservada del data-model.
 *  - `archived` se alcanza desde `draft` (descartar borrador); archivar una
 *    revisión publicada es una operación owner que la tarea de administración
 *    del módulo resolverá sin flexibilizar RLS (FR-049 se mantiene estricta).
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

const APP_ROLE = 'tc_app'

/**
 * @param {MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE template (
      id          uuid PRIMARY KEY,
      tenant_id   uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      name        text NOT NULL,
      description text,
      status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX template_tenant_idx ON template (tenant_id);')

  pgm.sql(`
    CREATE TABLE template_revision (
      id               uuid PRIMARY KEY,
      template_id      uuid NOT NULL REFERENCES template (id) ON DELETE CASCADE,
      tenant_id        uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      version          integer,
      definition       jsonb NOT NULL,
      status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      source_import_id uuid,
      published_at     timestamptz,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX template_revision_tenant_idx ON template_revision (tenant_id);')
  pgm.sql('CREATE INDEX template_revision_template_idx ON template_revision (template_id);')
  pgm.sql(`
    CREATE UNIQUE INDEX template_revision_version_uidx
      ON template_revision (template_id, version)
      WHERE version IS NOT NULL;
  `)

  // RLS: aislamiento por tenant (FR-007, Artículo IV).
  pgm.sql(`ALTER TABLE template ENABLE ROW LEVEL SECURITY;`)
  pgm.sql(`
    CREATE POLICY tenant_isolation ON template
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `)

  pgm.sql(`ALTER TABLE template_revision ENABLE ROW LEVEL SECURITY;`)
  // Política ÚNICA por comando (las políticas del mismo comando se OR-an:
  // dividir tenant y estado en políticas separadas filtraría filas "publicadas
  // del tenant" en UPDATE). Ambas condiciones van juntas.
  pgm.sql(`
    CREATE POLICY revision_select ON template_revision
      FOR SELECT
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `)
  pgm.sql(`
    CREATE POLICY revision_insert ON template_revision
      FOR INSERT
      WITH CHECK (
        tenant_id = current_setting('app.tenant_id', true)::uuid
        AND status = 'draft'
      );
  `)
  pgm.sql(`
    CREATE POLICY revision_update ON template_revision
      FOR UPDATE
      USING (
        tenant_id = current_setting('app.tenant_id', true)::uuid
        AND status = 'draft'
      )
      WITH CHECK (
        tenant_id = current_setting('app.tenant_id', true)::uuid
        AND status IN ('draft', 'published', 'archived')
      );
  `)
  pgm.sql(`
    CREATE POLICY revision_delete ON template_revision
      FOR DELETE
      USING (
        tenant_id = current_setting('app.tenant_id', true)::uuid
        AND status = 'draft'
      );
  `)

  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON template, template_revision TO ${APP_ROLE};`)
}

/**
 * @param {MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS template_revision;')
  pgm.sql('DROP TABLE IF EXISTS template;')
}