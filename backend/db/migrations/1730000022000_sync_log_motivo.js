/**
 * Migración 022 — Motivo de un lote rechazado (TSK-OFF-018, FR-024).
 *
 * Un lote que el servidor rechaza antes de procesarlo ya dejaba una fila
 * `failed` en `sync_log`, pero sin decir por qué: el teléfono mostraba el error
 * y la supervisión no tenía cómo verlo. `error_message` guarda el motivo (texto
 * de validación, sin el contenido de los registros). Nulo en todo lo demás.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sync_log
      ADD COLUMN error_message text
      CONSTRAINT sync_log_error_message_largo CHECK (char_length(error_message) <= 500);
  `)
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('ALTER TABLE sync_log DROP COLUMN IF EXISTS error_message;')
}
