import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const smartcarConfig = sqliteTable("smartcar_config", {
  ownerEmail: text("owner_email").primaryKey(),
  encryptedCredentials: text("encrypted_credentials").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const mySkodaConfig = sqliteTable("myskoda_config", {
  ownerEmail: text("owner_email").primaryKey(),
  encryptedSession: text("encrypted_session").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const vehicleSnapshots = sqliteTable("vehicle_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerEmail: text("owner_email").notNull(),
  provider: text("provider").notNull(),
  capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
  batteryPercent: real("battery_percent"),
  rangeKm: real("range_km"),
  odometerKm: real("odometer_km"),
  chargeState: text("charge_state"),
}, (table) => [
  index("vehicle_snapshots_owner_time_idx").on(table.ownerEmail, table.capturedAt),
]);

export const chargingSessions = sqliteTable("charging_sessions", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  chargedAt: integer("charged_at", { mode: "timestamp_ms" }).notNull(),
  locationType: text("location_type").notNull(),
  locationName: text("location_name").notNull(),
  energyKwh: real("energy_kwh").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("charging_sessions_owner_date_idx").on(table.ownerEmail, table.chargedAt),
]);

export const priceCache = sqliteTable("price_cache", {
  area: text("area").notNull(),
  startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
  timeDk: text("time_dk").notNull(),
  priceDkkPerKwh: real("price_dkk_per_kwh").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.area, table.startsAt] }),
  index("price_cache_time_idx").on(table.startsAt),
]);

export const schedulerState = sqliteTable("scheduler_state", {
  jobName: text("job_name").primaryKey(),
  lastAttemptAt: integer("last_attempt_at", { mode: "timestamp_ms" }).notNull(),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  detailsJson: text("details_json"),
});

export const monthlySummaries = sqliteTable("monthly_summaries", {
  ownerEmail: text("owner_email").notNull(),
  month: text("month").notNull(),
  totalKwh: real("total_kwh").notNull(),
  homeKwh: real("home_kwh").notNull(),
  publicKwh: real("public_kwh").notNull(),
  sessionCount: integer("session_count").notNull(),
  generatedAt: integer("generated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerEmail, table.month] }),
]);
