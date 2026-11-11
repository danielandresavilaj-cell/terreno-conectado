/**
 * Migración 012 — Clave temporal con cambio obligatorio (TSK-AUTH-010, Enmienda 003).
 *
 * Sin servicio de correo, el alta de cuentas usa una clave temporal que define
 * un administrador. `must_change_password` obliga al usuario a reemplazarla en
 * su primer ingreso; mientras esté en `true` el backend sólo deja usar
 * `/auth/me`, `/auth/password` y `/auth/logout`.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE app_user
      ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
  `)
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('ALTER TABLE app_user DROP COLUMN IF EXISTS must_change_password;')
}
