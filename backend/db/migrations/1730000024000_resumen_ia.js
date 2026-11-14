/**
 * Migración 024 — Resúmenes de Gerencia guardados (TSK-REP-014, FR-068, Enmienda 009).
 *
 * Cada resumen que redacta la IA queda guardado para reutilizarlo: la próxima
 * persona que mire la misma faena y el mismo período lo ve al instante, sin
 * volver a llamar a la API ni gastar cupo. También es el historial ("el
 * resumen de la semana del 9 de noviembre").
 *
 *  - `alcance`: faena (o `todas`) + primer y último día del período en hora de
 *    Chile. Es la clave con que se busca el último resumen de ese filtro.
 *  - `desde` / `hasta`: el período exacto, para mostrarlo en la hora de quien mira.
 *  - `cerrado`: el período ya terminó cuando se redactó (semana o mes anterior,
 *    un rango pasado). Sus cifras sólo cambian si llegan datos sincronizados
 *    tarde.
 *  - `cifras_hash`: huella de las cifras que se enviaron. Si las cifras de hoy
 *    son otras, el resumen se muestra como desactualizado y se puede actualizar.
 *  - `contenido`: titular, puntos y acción, tal como los devolvió la IA.
 *
 * No se borra ni se edita: actualizar un resumen agrega una fila nueva. Tabla de
 * dominio con `tenant_id` + RLS (Art. IV); los permisos de `tc_app` llegan por
 * `ALTER DEFAULT PRIVILEGES` (migración 001).
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE resumen_ia (
      id              uuid PRIMARY KEY,
      tenant_id       uuid NOT NULL REFERENCES tenant (id) ON DELETE CASCADE,
      site_id         uuid REFERENCES site (id) ON DELETE CASCADE,
      alcance         text NOT NULL CHECK (char_length(alcance) <= 120),
      desde           timestamptz,
      hasta           timestamptz,
      cerrado         boolean NOT NULL,
      cifras_hash     text NOT NULL CHECK (char_length(cifras_hash) = 64),
      contenido       jsonb NOT NULL,
      modelo          text NOT NULL,
      tokens_entrada  integer NOT NULL DEFAULT 0,
      tokens_salida   integer NOT NULL DEFAULT 0,
      generado_por    uuid REFERENCES app_user (id) ON DELETE SET NULL,
      generado_en     timestamptz NOT NULL DEFAULT now()
    );
  `)
  pgm.sql('CREATE INDEX resumen_ia_alcance_idx ON resumen_ia (tenant_id, alcance, generado_en DESC);')
  pgm.sql('CREATE INDEX resumen_ia_historial_idx ON resumen_ia (tenant_id, generado_en DESC);')
  pgm.sql('ALTER TABLE resumen_ia ENABLE ROW LEVEL SECURITY;')
  pgm.sql(`
    CREATE POLICY tenant_isolation ON resumen_ia
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `)
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS resumen_ia;')
}
