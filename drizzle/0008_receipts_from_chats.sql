ALTER TYPE "public"."receipt_source" ADD VALUE 'telegram';--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "sender_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "sender_label" varchar(80);