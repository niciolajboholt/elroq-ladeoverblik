CREATE TABLE `vehicle_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`provider` text NOT NULL,
	`captured_at` integer NOT NULL,
	`battery_percent` integer,
	`range_km` integer,
	`odometer_km` integer,
	`charge_state` text
);
