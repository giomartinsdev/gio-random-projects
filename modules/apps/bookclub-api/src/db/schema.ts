import { customType, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// The uploaded PDF's bytes live directly in Postgres (bytea), not an
// object store -- this repo has no MinIO/S3 yet, and homelab-scale
// PDFs (a chapter, a short book) comfortably fit a bytea column. If
// that stops being true, this table is the one place that'd need to
// change to a real object store.
//
// This is the ONLY table left in this service's own database. Rooms
// and chat messages moved to domain-api/domain-worker's Room/Message
// aggregates (see lib/domainApiClient.ts) -- a binary blob doesn't fit
// a JSON command envelope, so the PDF itself is the one thing that
// stays here, referenced from a Room only by its opaque document_id
// string (domain-api has no idea what that id points to, or that a
// PDF exists at all).
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const bookclubDocument = pgTable("bookclub_document", {
  id: text("id").primaryKey(),
  uploadedBy: text("uploaded_by").notNull(),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
