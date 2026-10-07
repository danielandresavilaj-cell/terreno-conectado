/**
 * Migración 004 — Resolución LWW + CONFLICT_RECORD (spec 003, TSK-WS-009).
 *
 *  · `conflict_record` conserva AMBAS versiones de una edición concurrente
 *    (winner/loser payload JSONB, resolución determinista `lww`, Artículo III):
 *    nunca hay sobrescritura silenciosa. Es append-only para la app
 *    (REVOKE DELETE): el supervisor lo lee (TSK-WS-011) pero nadie lo borra.
 *    Idempotencia de reintento: pares winner/loser iguales no se duplican
 *    (dedupe en SyncService contra (entity_id, winner, loser)).
 *  · `sync_log` pasa a escribirse en dos fases (INSERT `pending` → UPDATE con
 *    totales al final del lote) para que `conflict_record.sync_log_id`
 *    referencie el batch que detectó el conflicto.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conflict_record (
      id             uuid PRIMARY KEY,
      tenant_id      uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      entity_type    text NOT NULL CHECK (entity_type IN
        ('inspection','response','finding','log_entry','attachment')),
      entity_id      uuid NOT NULL,
      winner_payload jsonb NOT NULL,
      loser_payload  jsonb NOT NULL,
      resolution     text NOT NULL DEFAULT 'lww' CHECK (resolution = 'lww'),
      resolved_at    timestamptz NOT NULL DEFAULT now(),
      sync_log_id    uuid REFERENCES sync_log (id)
    );
  `)
  pgm.sql(
    'CREATE INDEX conflict_record_tenant_resolved_idx ON conflict_record (tenant_id, resolved_at DESC);',
  )
  pgm.sql(
    'CREATE INDEX conflict_record_entity_idx ON conflict_record (tenant_id, entity_type, entity_id);',
  )
  pgm.sql('ALTER TABLE conflict_record ENABLE ROW LEVEL SECURITY;')
  pgm.sql(`
    CREATE POLICY tenant_isolation ON conflict_record
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `)
  pgm.sql('REVOKE DELETE ON conflict_record FROM tc_app;')

  pgm.sql(`
    ALTER TABLE sync_log
      DROP CONSTRAINT sync_log_status_check,
      ADD CONSTRAINT sync_log_status_check CHECK (status IN ('pending','ok','partial','failed')),
      ALTER COLUMN finished_at DROP NOT NULL;
  `)
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS conflict_record;')
}