/**
 * Migración 026 — Activos y lugares con QR (TSK-OPS-003-C, FR-060/061, Enmienda 007).
 *
 * Un activo (vehículo, equipo o lugar) pertenece a una faena y tiene un
 * formulario estable. Su QR contiene `tc1:<token aleatorio de 128 bits>`; la
 * base guarda sólo `qr_token_hash` = SHA-256 (hex) de ese texto completo. Sin
 * sal a propósito: la entropía del token lo hace imposible de adivinar y el
 * mismo hash permite resolver el QR en el teléfono sin señal (tramo 2).
 *
 *  - Regenerar el QR cambia el hash: el código impreso anterior deja de servir.
 *  - Revocar (`status = revoked`) lo deja sin efecto sin borrar el historial.
 *  - `site_id` y `template_id` se validan contra el tenant en el servicio: una
 *    FK no mira RLS.
 *
 * Tabla de dominio con `tenant_id` + RLS (Art. IV); permisos de `tc_app` por
 * `ALTER DEFAULT PRIVILEGES` (migración 001).
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE asset (
      id             uuid PRIMARY KEY,
      tenant_id      uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      site_id        uuid NOT NULL REFERENCES site (id) ON DELETE CASCADE,
      template_id    uuid NOT NULL REFERENCES template (id) ON DELETE CASCADE,
      name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
      kind           text NOT NULL CHECK (kind IN ('vehicle', 'equipment', 'location')),
      qr_token_hash  text NOT NULL UNIQUE CHECK (qr_token_hash ~ '^[0-9a-f]{64}$'),
      status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
      created_by     uuid REFERENCES app_user (id) ON DELETE SET NULL,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX asset_tenant_site_idx ON asset (tenant_id, site_id);')
  pgm.sql('ALTER TABLE asset ENABLE ROW LEVEL SECURITY;')
  pgm.sql(`
    CREATE POLICY tenant_isolation ON asset
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `)
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS asset;')
}
