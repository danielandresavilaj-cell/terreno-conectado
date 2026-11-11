/**
 * Migración 015 — Motivo de revocación de sesión (TSK-AUTH-011).
 *
 * Con una sola sesión activa por usuario, entrar desde otro dispositivo revoca
 * la anterior. Guardar el motivo permite decirle al usuario "iniciaste sesión
 * en otro dispositivo" en vez de un genérico "tu sesión expiró", y no confundir
 * ese caso con el reuso de un refresh token (posible robo).
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql('ALTER TABLE auth_session ADD COLUMN IF NOT EXISTS revoked_reason text NULL;')
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('ALTER TABLE auth_session DROP COLUMN IF EXISTS revoked_reason;')
}
