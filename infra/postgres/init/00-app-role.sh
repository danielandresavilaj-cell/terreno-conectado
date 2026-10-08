#!/bin/sh
# Provisiona el rol de aplicación `tc_app` (sujeto a RLS) al crear el contenedor.
# Las migraciones también lo garantizan (para Testcontainers); aquí se le da
# LOGIN + password para la app. APP_DB_PASSWORD viene del entorno (.env).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tc_app') THEN
    CREATE ROLE tc_app LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE tc_app WITH LOGIN PASSWORD '${APP_DB_PASSWORD}';
  END IF;
END
\$\$;
EOSQL
