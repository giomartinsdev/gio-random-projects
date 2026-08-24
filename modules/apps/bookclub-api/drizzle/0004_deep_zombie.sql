-- Any row from before this migration has no MinIO object (its bytes
-- only ever lived in the "data" column being dropped below) -- rather
-- than a raw manual delete, an unreachable placeholder key leaves it
-- as an orphaned metadata row a 404 on /pdf, not a broken migration.
UPDATE "bookclub_document" SET "object_key" = 'unmigrated-' || "id" WHERE "object_key" IS NULL;--> statement-breakpoint
ALTER TABLE "bookclub_document" ALTER COLUMN "object_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookclub_document" DROP COLUMN "data";