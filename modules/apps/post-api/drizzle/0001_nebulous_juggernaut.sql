CREATE TABLE "post_likes" (
	"post_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "post_likes_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "profile_views" (
	"profile_user_id" text NOT NULL,
	"viewer_user_id" text NOT NULL,
	"first_viewed_at" timestamp DEFAULT now() NOT NULL,
	"last_viewed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profile_views_profile_user_id_viewer_user_id_pk" PRIMARY KEY("profile_user_id","viewer_user_id")
);
--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_profile_user_id_user_id_fk" FOREIGN KEY ("profile_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_viewer_user_id_user_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_likes_user_id_created_at_idx" ON "post_likes" USING btree ("user_id","created_at");