-- Hardening for managed PostgreSQL (Supabase) and pooled connections.
--
-- 1. Supabase publishes the public schema through its Data API (PostgREST) and
--    by default grants every new table to "anon" and "authenticated", roles used
--    with an API key that ships to browsers. Ticbo never uses the Data API, so
--    both roles lose every privilege here. Turn the Data API off as well.
-- 2. Row-level security on the control-plane tables too, with a policy for
--    ticbo_app only: any other non-owner role sees no rows at all.
-- 3. Timeouts live on the ticbo_app role: transaction poolers (Supavisor,
--    PgBouncer) reject them as connection startup parameters.
--
-- Steps that depend on Supabase roles are skipped where they do not exist.

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  control_table text;
BEGIN
  FOREACH control_table IN ARRAY ARRAY[
    'users', 'user_identities', 'refresh_tokens', 'accounts', 'account_members',
    'subscriptions', 'whatsapp_channels', 'whatsapp_senders', 'merchants'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', control_table);
    EXECUTE format(
      'CREATE POLICY api_access ON %I TO ticbo_app USING (true) WITH CHECK (true)',
      control_table
    );
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER ROLE ticbo_app SET statement_timeout = '10s';
--> statement-breakpoint
ALTER ROLE ticbo_app SET idle_in_transaction_session_timeout = '15s';
