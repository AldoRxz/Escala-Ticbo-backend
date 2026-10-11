-- auth_throttles is control plane: only the API role may touch it.
-- (Default privileges from 0001 already grant ticbo_app; 0002 removed anon/authenticated.)
ALTER TABLE auth_throttles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_access ON auth_throttles TO ticbo_app USING (true) WITH CHECK (true);
