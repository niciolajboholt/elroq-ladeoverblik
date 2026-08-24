CREATE TABLE `monthly_summaries` (
	`owner_email` text NOT NULL,
	`month` text NOT NULL,
	`total_kwh` real NOT NULL,
	`home_kwh` real NOT NULL,
	`public_kwh` real NOT NULL,
	`session_count` integer NOT NULL,
	`generated_at` integer NOT NULL,
	PRIMARY KEY(`owner_email`, `month`)
);
--> statement-breakpoint
CREATE TABLE `price_cache` (
	`area` text NOT NULL,
	`starts_at` integer NOT NULL,
	`time_dk` text NOT NULL,
	`price_dkk_per_kwh` real NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`area`, `starts_at`)
);
--> statement-breakpoint
CREATE INDEX `price_cache_time_idx` ON `price_cache` (`starts_at`);--> statement-breakpoint
CREATE TABLE `scheduler_state` (
	`job_name` text PRIMARY KEY NOT NULL,
	`last_attempt_at` integer NOT NULL,
	`last_success_at` integer,
	`last_error` text,
	`details_json` text
);
