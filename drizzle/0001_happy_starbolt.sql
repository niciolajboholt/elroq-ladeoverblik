CREATE TABLE `myskoda_config` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`encrypted_session` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
