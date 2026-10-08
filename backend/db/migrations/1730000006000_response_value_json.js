/**
 * Migración 006 — Respuesta híbrida `value_json` + `ATTACHMENT` de respuesta
 * (módulo 007, TSK-FORM-004, FR-036/FR-037, data-model §2.2 v1.1.0).
 *
 * 1. `inspection_response.value_json` (jsonb NULL): soporta los tipos
 *    select_single/select_multiple/date/time con la forma `string | string[]`
 *    (validada contra `template_item.props` en el device antes de encolar,
 *    FR-039; el servidor valida forma y tamaño). ok_nok_na/numeric/text
 *    siguen en sus columnas escalares; photo deja su marcador en
 *    `value_text` y los bytes viven en un ATTACHMENT `owner_type='response'`.
 *
 * 2. El CHECK de `attachment.owner_type` (column-level, migración 003 →
 *    nombre auto `attachment_owner_type_check`) se ensancha con 'response':
 *    FR-037 habilita fotos de respuesta cuyo `owner_id` apunta a
 *    `inspection_response.id`.
 *
 * Sin cambios RLS ni grants: la política `tenant_isolation` es por tabla y
 * los privilegios de tabla cubren columnas nuevas (Artículo IV).
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql('ALTER TABLE inspection_response ADD COLUMN IF NOT EXISTS value_json jsonb NULL;')
  pgm.sql(`
    ALTER TABLE attachment DROP CONSTRAINT IF EXISTS attachment_owner_type_check;
    ALTER TABLE attachment ADD CONSTRAINT attachment_owner_type_check
      CHECK (owner_type IN ('inspection', 'finding', 'log_entry', 'response'));
  `)
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE attachment DROP CONSTRAINT IF EXISTS attachment_owner_type_check;
    ALTER TABLE attachment ADD CONSTRAINT attachment_owner_type_check
      CHECK (owner_type IN ('inspection', 'finding', 'log_entry'));
  `)
  pgm.sql('ALTER TABLE inspection_response DROP COLUMN IF EXISTS value_json;')
}
