/**
 * Migración 003 — Sincronización (spec 003, TSK-WS-007).
 *
 * Crea las tablas de dominio que recibe la ingesta idempotente
 * `POST /api/v1/sync/batch` (data-model.md §2.2 y §2.3):
 * inspection, inspection_response, finding, log_entry, attachment y sync_log.
 *
 * Notas de diseño:
 *  - Toda tabla de dominio lleva `tenant_id` + política RLS `tenant_isolation`
 *    (Artículo IV). Los grants a `tc_app` llegan vía `ALTER DEFAULT PRIVILEGES`
 *    de la migración 001.
 *  - Los IDs son UUIDv7 generados en el cliente (FR-015): la PK es el UUID del
 *    cliente y la idempotencia (FR-021) opera con `ON CONFLICT (id)`.
 *  - `template_id`/`template_item_id` NO llevan FK: las tablas de plantillas
 *    llegan con el spec 004; acá son referencias opacas validadas por contrato.
 *  - `attachment.file_key` apunta al volumen Docker (data-model §2.2, V1);
 *    los bytes se escriben como archivo por `SyncService` (evolución a S3
 *    documentada en research.md §6).
 *  - `sync_log` es auditable por tenant (FR-024): SELECT/INSERT/UPDATE para
 *    registrar el fin del lote, jamás DELETE.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

const DOMAIN_TABLES = [
  'inspection',
  'inspection_response',
  'finding',
  'log_entry',
  'attachment',
  'sync_log',
]

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE inspection (
      id                uuid PRIMARY KEY,
      tenant_id         uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      site_id           uuid NOT NULL REFERENCES site (id) ON DELETE CASCADE,
      template_id       uuid NOT NULL,
      template_version  integer NOT NULL,
      executed_by       uuid NOT NULL REFERENCES app_user (id),
      status            text NOT NULL CHECK (status IN ('draft','in_progress','submitted','reviewed')),
      captured_at       timestamptz NOT NULL,
      synced_at         timestamptz,
      client_version    integer NOT NULL DEFAULT 0,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX inspection_tenant_captured_idx ON inspection (tenant_id, captured_at DESC);')

  pgm.sql(`
    CREATE TABLE inspection_response (
      id                uuid PRIMARY KEY,
      inspection_id     uuid NOT NULL REFERENCES inspection (id) ON DELETE CASCADE,
      template_item_id  uuid NOT NULL,
      tenant_id         uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      value_ok          text CHECK (value_ok IN ('ok','nok','na')),
      value_text        text,
      value_number      numeric,
      captured_at       timestamptz NOT NULL,
      client_version    integer NOT NULL DEFAULT 0,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX inspection_response_inspection_idx ON inspection_response (inspection_id);')
  pgm.sql('CREATE INDEX inspection_response_item_uidx ON inspection_response (inspection_id, template_item_id);')
  pgm.sql('CREATE INDEX inspection_response_tenant_captured_idx ON inspection_response (tenant_id, captured_at DESC);')

  pgm.sql(`
    CREATE TABLE finding (
      id              uuid PRIMARY KEY,
      inspection_id   uuid REFERENCES inspection (id) ON DELETE SET NULL,
      response_id     uuid REFERENCES inspection_response (id) ON DELETE SET NULL,
      tenant_id       uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      severity        text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
      description     text NOT NULL,
      status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
      captured_at     timestamptz NOT NULL,
      client_version  integer NOT NULL DEFAULT 0,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX finding_tenant_captured_idx ON finding (tenant_id, captured_at DESC);')
  pgm.sql(`CREATE INDEX finding_tenant_severity_idx ON finding (tenant_id, severity) WHERE status <> 'resolved';`)

  pgm.sql(`
    CREATE TABLE log_entry (
      id            uuid PRIMARY KEY,
      site_id       uuid NOT NULL REFERENCES site (id) ON DELETE CASCADE,
      author_id     uuid NOT NULL REFERENCES app_user (id),
      tenant_id     uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      entry_text    text NOT NULL,
      tags          text[] NOT NULL DEFAULT '{}',
      shift_date    date NOT NULL,
      captured_at   timestamptz NOT NULL,
      client_version integer NOT NULL DEFAULT 0,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX log_entry_tenant_captured_idx ON log_entry (tenant_id, captured_at DESC);')

  pgm.sql(`
    CREATE TABLE attachment (
      id              uuid PRIMARY KEY,
      tenant_id       uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      owner_type      text NOT NULL CHECK (owner_type IN ('inspection','finding','log_entry')),
      owner_id        uuid NOT NULL,
      file_key        text NOT NULL,
      mime            text NOT NULL,
      bytes           integer NOT NULL,
      width           integer,
      height          integer,
      captured_at     timestamptz NOT NULL,
      client_version  integer NOT NULL DEFAULT 0,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX attachment_owner_idx ON attachment (owner_id);')
  pgm.sql('CREATE INDEX attachment_tenant_captured_idx ON attachment (tenant_id, captured_at DESC);')

  pgm.sql(`
    CREATE TABLE sync_log (
      id              uuid PRIMARY KEY,
      tenant_id       uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      user_id         uuid REFERENCES app_user (id),
      device_id       uuid NOT NULL,
      batch_id        uuid NOT NULL,
      records_total   integer NOT NULL,
      records_ok      integer NOT NULL,
      records_failed  integer NOT NULL,
      started_at      timestamptz NOT NULL,
      finished_at     timestamptz NOT NULL,
      status          text NOT NULL CHECK (status IN ('ok','partial','failed'))
    );
  `)
  pgm.sql('CREATE INDEX sync_log_tenant_batch_idx ON sync_log (tenant_id, batch_id);')
  pgm.sql('CREATE INDEX sync_log_tenant_started_idx ON sync_log (tenant_id, started_at DESC);')

  for (const table of DOMAIN_TABLES) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`)
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${table}
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    `)
  }

  // sync_log es un log auditable: se actualiza el fin del lote, nunca se borra.
  pgm.sql('REVOKE DELETE ON sync_log FROM tc_app;')
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  for (const table of ['sync_log', 'attachment', 'log_entry', 'finding', 'inspection_response', 'inspection']) {
    pgm.sql(`DROP TABLE IF EXISTS ${table};`)
  }
}