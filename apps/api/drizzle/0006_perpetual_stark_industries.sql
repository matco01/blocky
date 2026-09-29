CREATE TABLE "save_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"pot_id" text NOT NULL,
	"kind" text NOT NULL,
	"percent" integer,
	"amount_usd" numeric(38, 6),
	"every_days" integer,
	"next_run_at" timestamp with time zone,
	"last_balance_usd" numeric(38, 6),
	"saved_since_check_in_usd" numeric(38, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "save_rules" ADD CONSTRAINT "save_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "save_rules" ADD CONSTRAINT "save_rules_pot_id_pots_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "save_rules_user_idx" ON "save_rules" USING btree ("user_id");