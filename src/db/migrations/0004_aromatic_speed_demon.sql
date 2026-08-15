ALTER TABLE "pub_teams" ADD COLUMN "join_code" varchar(8) NOT NULL;--> statement-breakpoint
ALTER TABLE "pub_teams" ADD CONSTRAINT "pub_teams_join_code_unique" UNIQUE("join_code");