CREATE TABLE "bet_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vendor" text NOT NULL,
	"url" text NOT NULL,
	"units" integer NOT NULL,
	"stake_cents" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"receipt" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bet_credentials" (
	"user_id" uuid NOT NULL,
	"vendor" text NOT NULL,
	"username" text NOT NULL,
	"password_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bet_credentials_user_id_vendor_pk" PRIMARY KEY("user_id","vendor")
);
--> statement-breakpoint
CREATE TABLE "bet_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"unit_value_cents" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bet_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "bet_bets" ADD CONSTRAINT "bet_bets_user_id_bet_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bet_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_credentials" ADD CONSTRAINT "bet_credentials_user_id_bet_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bet_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bet_bets_claim_idx" ON "bet_bets" USING btree ("status","created_at");