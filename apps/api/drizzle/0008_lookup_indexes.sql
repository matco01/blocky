CREATE INDEX "payment_requests_plan_idx" ON "payment_requests" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "price_alerts_user_idx" ON "price_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_wallet_idx" ON "users" USING btree ("wallet_address");