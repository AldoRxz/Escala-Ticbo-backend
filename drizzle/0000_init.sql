CREATE TYPE "public"."account_type" AS ENUM('personal', 'organization');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('google', 'facebook');--> statement-breakpoint
CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."plan_code" AS ENUM('pro', 'negocio', 'despacho');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."secret_kind" AS ENUM('whatsapp_access_token', 'whatsapp_app_secret', 'fiel_private_key', 'fiel_password', 'csd_private_key', 'csd_password');--> statement-breakpoint
CREATE TYPE "public"."fiscal_credential_kind" AS ENUM('fiel', 'csd');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_channel_status" AS ENUM('pending_verification', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."merchant_portal_status" AS ENUM('active', 'degraded', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."receipt_source" AS ENUM('whatsapp', 'web', 'email');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('received', 'extracting', 'requesting_invoice', 'awaiting_cfdi', 'invoiced', 'needs_review', 'failed');--> statement-breakpoint
CREATE TYPE "public"."cfdi_sat_status" AS ENUM('unknown', 'active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."efos_status" AS ENUM('unknown', 'clear', 'listed');--> statement-breakpoint
CREATE TABLE "account_members" (
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_members_account_id_user_id_pk" PRIMARY KEY("account_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"type" "account_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"user_agent" varchar(512),
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"subject" varchar(255) NOT NULL,
	"email" varchar(254) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"full_name" varchar(120) NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"plan" "plan_code" NOT NULL,
	"billing_cycle" "billing_cycle" NOT NULL,
	"status" "subscription_status" NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"provider" varchar(32),
	"provider_customer_id" varchar(255),
	"provider_subscription_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encrypted_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "secret_kind" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"wrapped_data_key" "bytea" NOT NULL,
	"key_id" varchar(256) NOT NULL,
	"algorithm" varchar(32) DEFAULT 'AES-256-GCM' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "encrypted_secrets_id_account_key" UNIQUE("id","account_id")
);
--> statement-breakpoint
CREATE TABLE "fiscal_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"fiscal_profile_id" uuid NOT NULL,
	"kind" "fiscal_credential_kind" NOT NULL,
	"certificate_number" varchar(20) NOT NULL,
	"certificate" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"private_key_secret_id" uuid NOT NULL,
	"password_secret_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"rfc" varchar(13) NOT NULL,
	"legal_name" varchar(300) NOT NULL,
	"tax_regime" char(3) NOT NULL,
	"postal_code" char(5) NOT NULL,
	"default_cfdi_use" varchar(4) DEFAULT 'G03' NOT NULL,
	"invoice_email" varchar(254) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_profiles_id_account_key" UNIQUE("id","account_id"),
	CONSTRAINT "fiscal_profiles_rfc_format" CHECK ("fiscal_profiles"."rfc" ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
	CONSTRAINT "fiscal_profiles_postal_code_format" CHECK ("fiscal_profiles"."postal_code" ~ '^[0-9]{5}$')
);
--> statement-breakpoint
CREATE TABLE "whatsapp_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"phone_number_id" varchar(32) NOT NULL,
	"business_account_id" varchar(32) NOT NULL,
	"display_phone_number" varchar(20) NOT NULL,
	"access_token_secret_id" uuid,
	"app_secret_secret_id" uuid,
	"verify_token_hash" varchar(64),
	"status" "whatsapp_channel_status" DEFAULT 'pending_verification' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"wa_id" varchar(20) NOT NULL,
	"user_id" uuid,
	"default_fiscal_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"rfc" varchar(13),
	"portal_url" text,
	"adapter_key" varchar(64),
	"ticket_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invoice_window_days" integer,
	"status" "merchant_portal_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"fiscal_profile_id" uuid,
	"submitted_by_user_id" uuid,
	"source" "receipt_source" NOT NULL,
	"source_message_id" varchar(128),
	"status" "receipt_status" DEFAULT 'received' NOT NULL,
	"image_object_key" text NOT NULL,
	"merchant_id" uuid,
	"merchant_rfc" varchar(13),
	"ticket_folio" varchar(64),
	"purchased_at" timestamp with time zone,
	"total" numeric(14, 2),
	"currency" char(3) DEFAULT 'MXN' NOT NULL,
	"cfdi_use" varchar(4),
	"extraction" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_id_account_key" UNIQUE("id","account_id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"receipt_id" uuid,
	"fiscal_profile_id" uuid NOT NULL,
	"cfdi_uuid" uuid NOT NULL,
	"issuer_rfc" varchar(13) NOT NULL,
	"issuer_name" varchar(300),
	"receiver_rfc" varchar(13) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"subtotal" numeric(14, 2),
	"total" numeric(14, 2) NOT NULL,
	"currency" char(3) DEFAULT 'MXN' NOT NULL,
	"cfdi_use" varchar(4),
	"xml_object_key" text NOT NULL,
	"pdf_object_key" text,
	"sat_status" "cfdi_sat_status" DEFAULT 'unknown' NOT NULL,
	"sat_checked_at" timestamp with time zone,
	"issuer_efos_status" "efos_status" DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encrypted_secrets" ADD CONSTRAINT "encrypted_secrets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_credentials" ADD CONSTRAINT "fiscal_credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_credentials" ADD CONSTRAINT "fiscal_credentials_profile_fk" FOREIGN KEY ("fiscal_profile_id","account_id") REFERENCES "public"."fiscal_profiles"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_credentials" ADD CONSTRAINT "fiscal_credentials_private_key_fk" FOREIGN KEY ("private_key_secret_id","account_id") REFERENCES "public"."encrypted_secrets"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_credentials" ADD CONSTRAINT "fiscal_credentials_password_fk" FOREIGN KEY ("password_secret_id","account_id") REFERENCES "public"."encrypted_secrets"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_profiles" ADD CONSTRAINT "fiscal_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_channels" ADD CONSTRAINT "whatsapp_channels_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_channels" ADD CONSTRAINT "whatsapp_channels_access_token_fk" FOREIGN KEY ("access_token_secret_id","account_id") REFERENCES "public"."encrypted_secrets"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_channels" ADD CONSTRAINT "whatsapp_channels_app_secret_fk" FOREIGN KEY ("app_secret_secret_id","account_id") REFERENCES "public"."encrypted_secrets"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_senders" ADD CONSTRAINT "whatsapp_senders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_senders" ADD CONSTRAINT "whatsapp_senders_channel_id_whatsapp_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."whatsapp_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_senders" ADD CONSTRAINT "whatsapp_senders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_senders" ADD CONSTRAINT "whatsapp_senders_default_profile_fk" FOREIGN KEY ("default_fiscal_profile_id","account_id") REFERENCES "public"."fiscal_profiles"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_fiscal_profile_fk" FOREIGN KEY ("fiscal_profile_id","account_id") REFERENCES "public"."fiscal_profiles"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_receipt_fk" FOREIGN KEY ("receipt_id","account_id") REFERENCES "public"."receipts"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fiscal_profile_fk" FOREIGN KEY ("fiscal_profile_id","account_id") REFERENCES "public"."fiscal_profiles"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_members_user_id_idx" ON "account_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_provider_subject_key" ON "user_identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE INDEX "user_identities_user_id_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_account_open_key" ON "subscriptions" USING btree ("account_id") WHERE status <> 'canceled';--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_subscription_key" ON "subscriptions" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_account_id_idx" ON "subscriptions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "encrypted_secrets_account_id_idx" ON "encrypted_secrets" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "encrypted_secrets_key_id_idx" ON "encrypted_secrets" USING btree ("key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_credentials_profile_kind_number_key" ON "fiscal_credentials" USING btree ("fiscal_profile_id","kind","certificate_number");--> statement-breakpoint
CREATE INDEX "fiscal_credentials_account_id_idx" ON "fiscal_credentials" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_profiles_account_rfc_key" ON "fiscal_profiles" USING btree ("account_id","rfc");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_profiles_account_default_key" ON "fiscal_profiles" USING btree ("account_id") WHERE is_default;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_profiles_invoice_email_key" ON "fiscal_profiles" USING btree ("invoice_email");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_channels_phone_number_id_key" ON "whatsapp_channels" USING btree ("phone_number_id");--> statement-breakpoint
CREATE INDEX "whatsapp_channels_account_id_idx" ON "whatsapp_channels" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_senders_channel_wa_id_key" ON "whatsapp_senders" USING btree ("channel_id","wa_id");--> statement-breakpoint
CREATE INDEX "whatsapp_senders_account_id_idx" ON "whatsapp_senders" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_rfc_key" ON "merchants" USING btree ("rfc");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_account_source_message_key" ON "receipts" USING btree ("account_id","source","source_message_id");--> statement-breakpoint
CREATE INDEX "receipts_account_created_idx" ON "receipts" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "receipts_account_status_idx" ON "receipts" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_account_cfdi_uuid_key" ON "invoices" USING btree ("account_id","cfdi_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_receipt_id_key" ON "invoices" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "invoices_account_issued_idx" ON "invoices" USING btree ("account_id","issued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invoices_account_profile_idx" ON "invoices" USING btree ("account_id","fiscal_profile_id");