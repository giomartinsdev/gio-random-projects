ALTER TABLE "bookclub_document" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookclub_document" ADD COLUMN "object_key" text;