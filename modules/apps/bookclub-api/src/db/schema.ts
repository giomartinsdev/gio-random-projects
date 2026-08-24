import { customType, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// user/host/uploader ids are plain text columns, not a Postgres FK to
// authSchema's "user" table -- that table lives in a migration this
// package doesn't own (post-api's), so a hard cross-migration FK
// isn't safe to declare here. Same soft-reference approach as every
// other author_id/host_id in this repo's other services.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// The uploaded PDF's bytes live directly in Postgres (bytea), not an
// object store -- this repo has no MinIO/S3 yet, and homelab-scale
// PDFs (a chapter, a short book) comfortably fit a bytea column. If
// that stops being true, this table is the one place that'd need to
// change to a real object store.
export const bookclubDocument = pgTable("bookclub_document", {
  id: text("id").primaryKey(),
  uploadedBy: text("uploaded_by").notNull(),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const bookclubRoom = pgTable("bookclub_room", {
  id: text("id").primaryKey(),
  hostId: text("host_id").notNull(),
  title: text("title").notNull(),
  documentId: text("document_id")
    .notNull()
    .references(() => bookclubDocument.id, { onDelete: "cascade" }),
  currentPage: integer("current_page").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Chat history is the one piece of realtime room state worth
// persisting -- so a participant who joins late (or reconnects) still
// sees prior messages. Live cursors and pen strokes are NOT persisted
// here on purpose: they're broadcast-only, held in the ws room hub's
// in-memory state (src/ws/roomHub.ts), and reset whenever the host
// turns the page -- annotations are meant to be "for this page, right
// now", not a permanent record.
export const bookclubMessage = pgTable("bookclub_message", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => bookclubRoom.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
