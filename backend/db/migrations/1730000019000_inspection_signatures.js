/**
 * Migración 019 — Firma de cierre (TSK-OPS-003-B, FR-056/057).
 *
 * La firma es un trazo vectorial inmutable, no una imagen biométrica. La
 * inspección congela si requiere cofirma y los registros previos a esta
 * migración quedan explícitamente exentos para no invalidar historia ya válida.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE inspection
      ADD COLUMN IF NOT EXISTS signature_required boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS requires_supervisor_signature boolean NOT NULL DEFAULT false;
  `)
  pgm.sql(`
    CREATE TABLE inspection_signature (
      id                  uuid PRIMARY KEY,
      tenant_id           uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      inspection_id       uuid NOT NULL REFERENCES inspection (id) ON DELETE CASCADE,
      signer_id           uuid NOT NULL REFERENCES app_user (id),
      signer_role         text NOT NULL CHECK (signer_role IN ('inspector', 'supervisor')),
      strokes_json        jsonb NOT NULL,
      content_hash        text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
      declaration_version text NOT NULL,
      signed_at           timestamptz NOT NULL,
      client_version      integer NOT NULL DEFAULT 0,
      created_at          timestamptz NOT NULL DEFAULT now(),
      UNIQUE (inspection_id, signer_role)
    );
  `)
  pgm.sql('CREATE INDEX inspection_signature_tenant_inspection_idx ON inspection_signature (tenant_id, inspection_id);')
  pgm.sql('ALTER TABLE inspection_signature ENABLE ROW LEVEL SECURITY;')
  pgm.sql(`
    CREATE POLICY tenant_isolation ON inspection_signature
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `)
  // Una firma certifica un estado concreto: no se modifica ni se borra desde
  // el rol de aplicación. Las dos escrituras legítimas son INSERT inspector/supervisor.
  pgm.sql('REVOKE UPDATE, DELETE ON inspection_signature FROM tc_app;')
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS inspection_signature;')
  pgm.sql(`
    ALTER TABLE inspection
      DROP COLUMN IF EXISTS requires_supervisor_signature,
      DROP COLUMN IF EXISTS signature_required;
  `)
}
