CREATE TABLE `charging_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`charged_at` integer NOT NULL,
	`location_type` text NOT NULL,
	`location_name` text NOT NULL,
	`energy_kwh` real NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `charging_sessions_owner_date_idx` ON `charging_sessions` (`owner_email`,`charged_at`);