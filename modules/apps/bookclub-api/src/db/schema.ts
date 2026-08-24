import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// bookclub_document is just the PDF's metadata now -- the bytes
// themselves live in MinIO (lib/minioClient.ts), objectKey pointing
// at them there. This is the ONLY table left in this service's own
// Postgres database: rooms and chat messages moved to domain-api/
// domain-worker's Room/Message aggregates (see lib/domainApiClient.ts).
export const bookclubDocument = pgTable("bookclub_document", {
  id: text("id").primaryKey(),
  uploadedBy: text("uploaded_by").notNull(),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  objectKey: text("object_key").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
