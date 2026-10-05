-- Tenant isolation with PostgreSQL row-level security.
--
-- The API connects as "ticbo_app", which does not own the tables, so every policy
-- applies to it. A tenant-scoped transaction first runs
--   select set_config('app.account_id', '<account uuid>', true)
-- and rows of other accounts become invisible and unwritable. Without that
-- setting no tenant row is visible at all (fail closed). The owner role that runs
-- migrations is not subject to these policies.
--
-- Control-plane tables (users, sessions, accounts, subscriptions, WhatsApp routing,
-- merchant catalog) stay outside RLS: they are read before a tenant is known.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ticbo_app') THEN
    CREATE ROLE ticbo_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ticbo_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ticbo_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ticbo_app;
--> statement-breakpoint
CREATE FUNCTION app_current_account_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.account_id', true), '')::uuid $$;
--> statement-breakpoint
ALTER TABLE encrypted_secrets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON encrypted_secrets
  USING (account_id = app_current_account_id())
  WITH CHECK (account_id = app_current_account_id());
--> statement-breakpoint
ALTER TABLE fiscal_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON fiscal_profiles
  USING (account_id = app_current_account_id())
  WITH CHECK (account_id = app_current_account_id());
--> statement-breakpoint
ALTER TABLE fiscal_credentials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON fiscal_credentials
  USING (account_id = app_current_account_id())
  WITH CHECK (account_id = app_current_account_id());
--> statement-breakpoint
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON receipts
  USING (account_id = app_current_account_id())
  WITH CHECK (account_id = app_current_account_id());
--> statement-breakpoint
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON invoices
  USING (account_id = app_current_account_id())
  WITH CHECK (account_id = app_current_account_id());
