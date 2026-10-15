/**
 * Migración 011 — Georreferencia opcional de inspección (FR-034).
 *
 * Se implementa con columnas escalares numeric (sin PostGIS) para mantener la
 * dependencia mínima del despliegue V1. Precisión suficiente para faenas mineras
 * y obras (~1 mm con 8 decimales en latitud, ~1 mm con 8 en longitud a latitudes
 * medias). El CHECK garantiza que, si se entrega alguna coordenada, ambas sean
 * válidas y dentro de los rangos geográficos.
 *
 * La captura es opcional: el dispositivo puede enviar `null` cuando no haya
 * permiso de geolocalización o no se haya podido obtener fix.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE inspection
      ADD COLUMN IF NOT EXISTS location_lat NUMERIC(10,8) NULL,
      ADD COLUMN IF NOT EXISTS location_lon NUMERIC(11,8) NULL,
      ADD CONSTRAINT inspection_location_bounds_ck
        CHECK (
          (location_lat IS NULL AND location_lon IS NULL)
          OR (
            location_lat BETWEEN -90 AND 90
            AND location_lon BETWEEN -180 AND 180
          )
        );
  `)
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE inspection
      DROP CONSTRAINT IF EXISTS inspection_location_bounds_ck,
      DROP COLUMN IF EXISTS location_lat,
      DROP COLUMN IF EXISTS location_lon;
  `)
}
