CREATE TABLE "bookclub_document" (
	"id" text PRIMARY KEY NOT NULL,
	"uploaded_by" text NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookclub_message" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookclub_room" (
	"id" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"title" text NOT NULL,
	"document_id" text NOT NULL,
	"current_page" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookclub_message" ADD CONSTRAINT "bookclub_message_room_id_bookclub_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."bookclub_room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookclub_room" ADD CONSTRAINT "bookclub_room_document_id_bookclub_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."bookclub_document"("id") ON DELETE cascade ON UPDATE no action;