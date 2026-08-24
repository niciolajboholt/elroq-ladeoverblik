CREATE TABLE `smartcar_config` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
