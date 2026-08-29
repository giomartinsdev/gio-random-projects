CREATE TABLE "announced_posts" (
	"post_id" text PRIMARY KEY NOT NULL,
	"announced_at" timestamp DEFAULT now() NOT NULL
);
