PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_vehicle_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`provider` text NOT NULL,
	`captured_at` integer NOT NULL,
	`battery_percent` real,
	`range_km` real,
	`odometer_km` real,
	`charge_state` text
);
--> statement-breakpoint
INSERT INTO `__new_vehicle_snapshots`("id", "owner_email", "provider", "captured_at", "battery_percent", "range_km", "odometer_km", "charge_state") SELECT "id", "owner_email", "provider", "captured_at", "battery_percent", "range_km", "odometer_km", "charge_state" FROM `vehicle_snapshots`;--> statement-breakpoint
DROP TABLE `vehicle_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_vehicle_snapshots` RENAME TO `vehicle_snapshots`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `vehicle_snapshots_owner_time_idx` ON `vehicle_snapshots` (`owner_email`,`captured_at`);