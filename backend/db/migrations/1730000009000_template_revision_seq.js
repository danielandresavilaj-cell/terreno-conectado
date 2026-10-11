/**
 * Migración 009 — Cursor de publicación para el delta de plantillas
 * (módulo 007, TSK-FORM-009, FR-018/027/028).
 *
 * `template_revision.version` se asigna POR PLANTILLA (`MAX(version)+1` dentro
 * de su `template_id`), pero el delta de FR-027 compara contra un único umbral
 * global. Con el dispositivo cacheando la plantilla A en v9 y la B en v3, el
 * cursor `since=9` hace que la v4 de B nunca llegue: el delta nunca garantiza
 * una respuesta completa. `published_seq` es la secuencia GLOBAL de
 * publicaciones — monotónica, con huecos tolerados (dos tenants publican en la
 * misma secuencia y cada uno ve la suya).
 *
 * Decisiones:
 *  - NULL en borradores: la secuencia significa "publicación", no "fila". Así no
 *    se consumen números en revisiones que quizá nunca se publiquen, y el
 *    borrador queda fuera del delta por construcción.
 *  - Backfill determinista `ORDER BY published_at, id`: el seed inserta
 *    revisiones publicadas saltándose `publishRevision` (fixtures con estado
 *    `published`), y esas filas también deben quedar con secuencia.
 *  - CHECK: ninguna revisión puede estar `published` sin secuencia. Es la red
 *    estructural — cualquier camino futuro que publique sin sellar secuencia
 *    revienta en el motor, no en silencio como un delta que nunca llega.
 *
 * @typedef {import('node-pg-migrate').MigrationBuilder} MigrationBuilder
 */

const APP_ROLE = 'tc_app'
const SEQ = 'template_revision_published_seq'

/** @param {MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`CREATE SEQUENCE IF NOT EXISTS ${SEQ};`)
  pgm.sql('ALTER TABLE template_revision ADD COLUMN published_seq bigint NULL;')

  // Backfill: sólo las publicadas, en orden determinista.
  pgm.sql(`
    WITH orden AS (
      SELECT id, row_number() OVER (ORDER BY published_at, id) AS n
        FROM template_revision
       WHERE status = 'published' AND published_seq IS NULL
    )
    UPDATE template_revision r
       SET published_seq = orden.n
      FROM orden
     WHERE r.id = orden.id;
  `)

  // La secuencia debe empezar por encima de lo ya asignado.
  pgm.sql(`
    SELECT setval(
      '${SEQ}',
      GREATEST((SELECT COALESCE(MAX(published_seq), 0) FROM template_revision), 1)
    );
  `)

  pgm.sql(`
    CREATE INDEX template_revision_published_seq_idx
      ON template_revision (published_seq)
      WHERE published_seq IS NOT NULL;
  `)

  pgm.sql(`
    ALTER TABLE template_revision
      ADD CONSTRAINT template_revision_published_seq_check
      CHECK (status <> 'published' OR published_seq IS NOT NULL);
  `)

  // `publishRevision` sella la secuencia desde `tc_app`: sin estos permisos la
  // publicación revienta con "permission denied for sequence".
  pgm.sql(`GRANT USAGE, SELECT ON SEQUENCE ${SEQ} TO ${APP_ROLE};`)
}

/** @param {MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('ALTER TABLE template_revision DROP CONSTRAINT IF EXISTS template_revision_published_seq_check;')
  pgm.sql('DROP INDEX IF EXISTS template_revision_published_seq_idx;')
  pgm.sql('ALTER TABLE template_revision DROP COLUMN IF EXISTS published_seq;')
  pgm.sql(`DROP SEQUENCE IF EXISTS ${SEQ};`)
}