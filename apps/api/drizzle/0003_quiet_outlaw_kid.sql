CREATE TABLE "tracked_tokens" (
	"user_id" text NOT NULL,
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"symbol" text NOT NULL,
	"decimals" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracked_tokens_user_id_chain_id_address_pk" PRIMARY KEY("user_id","chain_id","address")
);
--> statement-breakpoint
ALTER TABLE "tracked_tokens" ADD CONSTRAINT "tracked_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;