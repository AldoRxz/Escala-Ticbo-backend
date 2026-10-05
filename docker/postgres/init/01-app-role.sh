#!/bin/sh
# Runs once, when the data volume is initialised. Creates the restricted role
# the API connects with (not the table owner, so row-level security applies to
# it) and the database used by the end-to-end tests.
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v app_password="$POSTGRES_APP_PASSWORD" \
  -v test_db="${POSTGRES_DB}_test" <<'SQL'
CREATE ROLE ticbo_app LOGIN PASSWORD :'app_password';
CREATE DATABASE :"test_db";
SQL
