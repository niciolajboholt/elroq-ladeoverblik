declare global {
  var __ELROQ_ENV__: {
    DB: D1Database;
    OWNER_EMAIL?: string;
    SMARTCAR_STORAGE_KEY?: string;
  } | undefined;
}

const SNAPSHOT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS vehicle_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_email TEXT NOT NULL,
  provider TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  battery_percent REAL,
  range_km REAL,
  odometer_km REAL,
  charge_state TEXT
)`;

const OWNER_TIME_INDEX_SQL = `CREATE INDEX IF NOT EXISTS vehicle_snapshots_owner_time_idx
  ON vehicle_snapshots (owner_email, captured_at)`;

export type SnapshotVehicle = {
  batteryPercent?: number | null;
  rangeKm?: number | null;
  odometerKm?: number | null;
  chargeState?: string | null;
};

export type DrivingHistory = {
  status: "collecting" | "estimated";
  samples: number;
  distanceKm: number | null;
  estimatedEnergyKwh: number | null;
  consumptionKwhPer100Km: number | null;
  efficiencyKmPerKwh: number | null;
  firstCapturedAt: string | null;
  lastCapturedAt: string | null;
};

type SnapshotRow = {
  captured_at: number;
  battery_percent: number | null;
  odometer_km: number | null;
};

type LatestSnapshotRow = SnapshotRow & {
  provider: string;
  range_km: number | null;
  charge_state: string | null;
};

const ELROQ_USABLE_BATTERY_KWH = 59;

export async function recordVehicleSnapshot(ownerEmail: string, provider: string, vehicle: SnapshotVehicle) {
  await ensureSnapshotTable();
  const latest = await database().prepare(`SELECT captured_at, battery_percent, range_km, odometer_km, charge_state
    FROM vehicle_snapshots WHERE owner_email = ? ORDER BY captured_at DESC LIMIT 1`)
    .bind(ownerEmail).first<{ captured_at: number; battery_percent: number | null; range_km: number | null; odometer_km: number | null; charge_state: string | null }>();

  const unchanged = latest
    && sameNumber(latest.battery_percent, vehicle.batteryPercent)
    && sameNumber(latest.range_km, vehicle.rangeKm)
    && sameNumber(latest.odometer_km, vehicle.odometerKm)
    && (latest.charge_state ?? null) === (vehicle.chargeState ?? null);
  if (unchanged) return;

  await database().prepare(`INSERT INTO vehicle_snapshots
    (owner_email, provider, captured_at, battery_percent, range_km, odometer_km, charge_state)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      ownerEmail,
      provider,
      Date.now(),
      finiteOrNull(vehicle.batteryPercent),
      finiteOrNull(vehicle.rangeKm),
      finiteOrNull(vehicle.odometerKm),
      vehicle.chargeState ?? null,
    ).run();

  await database().prepare("DELETE FROM vehicle_snapshots WHERE owner_email = ? AND captured_at < ?")
    .bind(ownerEmail, Date.now() - 400 * 24 * 60 * 60 * 1000).run();
}

export async function getDrivingHistory(ownerEmail: string): Promise<DrivingHistory> {
  await ensureSnapshotTable();
  const result = await database().prepare(`SELECT captured_at, battery_percent, odometer_km
    FROM vehicle_snapshots WHERE owner_email = ? ORDER BY captured_at ASC LIMIT 1000`)
    .bind(ownerEmail).all<SnapshotRow>();
  const rows = result.results ?? [];
  let distanceKm = 0;
  let energyKwh = 0;

  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (previous.battery_percent == null || current.battery_percent == null || previous.odometer_km == null || current.odometer_km == null) continue;
    const distanceDelta = current.odometer_km - previous.odometer_km;
    const batteryDrop = previous.battery_percent - current.battery_percent;
    // Stigende batteriprocent betyder, at der har været opladning mellem målingerne.
    if (distanceDelta <= 0 || distanceDelta > 1000 || batteryDrop <= 0 || batteryDrop > 60) continue;
    distanceKm += distanceDelta;
    energyKwh += batteryDrop / 100 * ELROQ_USABLE_BATTERY_KWH;
  }

  const hasEstimate = distanceKm >= 5 && energyKwh >= ELROQ_USABLE_BATTERY_KWH * 0.05;
  return {
    status: hasEstimate ? "estimated" : "collecting",
    samples: rows.length,
    distanceKm: hasEstimate ? distanceKm : null,
    estimatedEnergyKwh: hasEstimate ? energyKwh : null,
    consumptionKwhPer100Km: hasEstimate ? energyKwh / distanceKm * 100 : null,
    efficiencyKmPerKwh: hasEstimate ? distanceKm / energyKwh : null,
    firstCapturedAt: rows[0] ? new Date(rows[0].captured_at).toISOString() : null,
    lastCapturedAt: rows.at(-1) ? new Date(rows.at(-1)!.captured_at).toISOString() : null,
  };
}

export async function getLatestVehicleSnapshot(ownerEmail: string) {
  await ensureSnapshotTable();
  const row = await database().prepare(`SELECT provider, captured_at, battery_percent, range_km, odometer_km, charge_state
    FROM vehicle_snapshots WHERE owner_email = ? ORDER BY captured_at DESC LIMIT 1`)
    .bind(ownerEmail).first<LatestSnapshotRow>();
  if (!row) return null;
  return {
    provider: row.provider,
    capturedAt: new Date(row.captured_at).toISOString(),
    vehicle: {
      make: "Škoda",
      model: "Elroq",
      batteryPercent: row.battery_percent,
      rangeKm: row.range_km,
      odometerKm: row.odometer_km,
      chargeState: row.charge_state,
      dataComplete: row.battery_percent != null && row.range_km != null && row.odometer_km != null,
      missingSignals: [
        row.battery_percent == null ? "Batteriniveau" : null,
        row.range_km == null ? "Rækkevidde" : null,
        row.odometer_km == null ? "Kilometerstand" : null,
      ].filter((value): value is string => value !== null),
    },
  };
}

async function ensureSnapshotTable() {
  const db = database();
  await db.batch([
    db.prepare(SNAPSHOT_TABLE_SQL),
    db.prepare(OWNER_TIME_INDEX_SQL),
  ]);
}

function database() {
  const db = globalThis.__ELROQ_ENV__?.DB;
  if (!db) throw new Error("Databasen er ikke tilgængelig");
  return db;
}

function finiteOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sameNumber(left: number | null, right: number | null | undefined) {
  const normalized = finiteOrNull(right);
  return left === normalized;
}
