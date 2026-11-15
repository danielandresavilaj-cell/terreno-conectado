/**
 * Migración 027 — Inspección abierta desde un QR (TSK-OPS-003-C, tramo 2, FR-060/061).
 *
 * `inspection.asset_id` registra el activo cuyo QR abrió la inspección. Es
 * opcional (las inspecciones sin QR y las colas antiguas no lo traen) y la
 * ingesta valida que el activo sea de la misma empresa (además de RLS). Un
 * activo revocado después de abrir la inspección sin señal sigue siendo una
 * referencia válida: la inspección ya se hizo (desfase aceptado, Enmienda 007).
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql('ALTER TABLE inspection ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES asset (id) ON DELETE SET NULL;')
  pgm.sql('CREATE INDEX IF NOT EXISTS inspection_asset_idx ON inspection (asset_id) WHERE asset_id IS NOT NULL;')
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS inspection_asset_idx;')
  pgm.sql('ALTER TABLE inspection DROP COLUMN IF EXISTS asset_id;')
}
