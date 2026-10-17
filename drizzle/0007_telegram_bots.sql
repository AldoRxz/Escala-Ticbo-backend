CREATE TYPE "public"."telegram_bot_status" AS ENUM('active', 'disabled');--> statement-breakpoint
ALTER TYPE "public"."secret_kind" ADD VALUE 'telegram_bot_token' BEFORE 'fiel_private_key';--> statement-breakpoint
CREATE TABLE "telegram_bots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"bot_user_id" bigint NOT NULL,
	"username" varchar(64) NOT NULL,
	"display_name" varchar(128) NOT NULL,
	"token_secret_id" uuid NOT NULL,
	"webhook_secret_hash" varchar(64) NOT NULL,
	"status" "telegram_bot_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"phone" varchar(20) NOT NULL,
	"label" varchar(80),
	"default_fiscal_profile_id" uuid,
	"telegram_user_id" bigint,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_bots" ADD CONSTRAINT "telegram_bots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bots" ADD CONSTRAINT "telegram_bots_token_fk" FOREIGN KEY ("token_secret_id","account_id") REFERENCES "public"."encrypted_secrets"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_senders" ADD CONSTRAINT "telegram_senders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_senders" ADD CONSTRAINT "telegram_senders_bot_id_telegram_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."telegram_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_senders" ADD CONSTRAINT "telegram_senders_default_profile_fk" FOREIGN KEY ("default_fiscal_profile_id","account_id") REFERENCES "public"."fiscal_profiles"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_bots_bot_user_id_key" ON "telegram_bots" USING btree ("bot_user_id");--> statement-breakpoint
CREATE INDEX "telegram_bots_account_id_idx" ON "telegram_bots" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_senders_bot_phone_key" ON "telegram_senders" USING btree ("bot_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_senders_bot_user_key" ON "telegram_senders" USING btree ("bot_id","telegram_user_id");--> statement-breakpoint
CREATE INDEX "telegram_senders_account_id_idx" ON "telegram_senders" USING btree ("account_id");--> statement-breakpoint
-- Control plane, like the WhatsApp routing tables (0002): the webhook reads them
-- before the tenant is known, and only the API role may touch them.
ALTER TABLE "telegram_bots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY api_access ON "telegram_bots" TO ticbo_app USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "telegram_senders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY api_access ON "telegram_senders" TO ticbo_app USING (true) WITH CHECK (true);
