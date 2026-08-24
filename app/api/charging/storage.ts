import "server-only";

declare global {
  var __ELROQ_ENV__: {
    DB: D1Database;
    OWNER_EMAIL?: string;
    SMARTCAR_STORAGE_KEY?: string;
  } | undefined;
}

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS charging_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_email TEXT NOT NULL,
  charged_at INTEGER NOT NULL,
  location_type TEXT NOT NULL,
  location_name TEXT NOT NULL,
  energy_kwh REAL NOT NULL,
  created_at INTEGER NOT NULL
)`;

const INDEX_SQL = `CREATE INDEX IF NOT EXISTS charging_sessions_owner_date_idx
  ON charging_sessions (owner_email, charged_at)`;
const COPENHAGEN_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Copenhagen",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type ChargingSession = {
  id: string;
  chargedAt: string;
  locationType: "home" | "public";
  locationName: string;
  energyKwh: number;
};

type SessionRow = {
  id: string;
  charged_at: number;
  location_type: string;
  location_name: string;
  energy_kwh: number;
};

export async function listChargingSessions(ownerEmail: string): Promise<ChargingSession[]> {
  await ensureTable();
  const result = await database().prepare(`SELECT id, charged_at, location_type, location_name, energy_kwh
    FROM charging_sessions WHERE owner_email = ? ORDER BY charged_at DESC LIMIT 500`)
    .bind(ownerEmail).all<SessionRow>();
  return (result.results ?? []).map(toSession);
}

export async function addChargingSession(ownerEmail: string, input: Omit<ChargingSession, "id">) {
  await ensureTable();
  const id = crypto.randomUUID();
  await database().prepare(`INSERT INTO charging_sessions
    (id, owner_email, charged_at, location_type, location_name, energy_kwh, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, ownerEmail, new Date(input.chargedAt).getTime(), input.locationType, input.locationName, input.energyKwh, Date.now()).run();
  return { id, ...input } satisfies ChargingSession;
}

export async function importChargingSessions(ownerEmail: string, inputs: Array<Omit<ChargingSession, "id">>) {
  await ensureTable();
  const existing = await listChargingSessions(ownerEmail);
  const keys = new Set(existing.map(sessionKey));
  const additions = inputs.filter((input) => !keys.has(sessionKey(input)));
  if (!additions.length) return 0;
  const db = database();
  await db.batch(additions.map((input) => db.prepare(`INSERT INTO charging_sessions
    (id, owner_email, charged_at, location_type, location_name, energy_kwh, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), ownerEmail, new Date(input.chargedAt).getTime(), input.locationType, input.locationName, input.energyKwh, Date.now())));
  return additions.length;
}

export async function importExternalChargingSessions(ownerEmail: string, inputs: ChargingSession[]) {
  await ensureTable();
  if (!inputs.length) return 0;
  const uniqueInputs = [...new Map(inputs.map(input => [input.id, input])).values()];
  const existing = await listChargingSessions(ownerEmail);
  const existingIds = new Set(existing.map(input => input.id));
  const additions = uniqueInputs.filter(input =>
    !existingIds.has(input.id) && !existing.some(stored => likelySameChargingSession(stored, input)),
  );
  if (!additions.length) return 0;
  const db = database();
  await db.batch(additions.map(input => db.prepare(`INSERT OR IGNORE INTO charging_sessions
    (id, owner_email, charged_at, location_type, location_name, energy_kwh, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
      input.id,
      ownerEmail,
      new Date(input.chargedAt).getTime(),
      input.locationType,
      input.locationName,
      input.energyKwh,
      Date.now(),
    )));
  return additions.length;
}

export async function deleteChargingSession(ownerEmail: string, id: string) {
  await ensureTable();
  await database().prepare("DELETE FROM charging_sessions WHERE owner_email = ? AND id = ?")
    .bind(ownerEmail, id).run();
}

async function ensureTable() {
  const db = database();
  await db.batch([db.prepare(TABLE_SQL), db.prepare(INDEX_SQL)]);
}

function database() {
  const db = globalThis.__ELROQ_ENV__?.DB;
  if (!db) throw new Error("Databasen er ikke tilgængelig");
  return db;
}

function toSession(row: SessionRow): ChargingSession {
  return {
    id: row.id,
    chargedAt: new Date(row.charged_at).toISOString(),
    locationType: row.location_type === "public" ? "public" : "home",
    locationName: row.location_name,
    energyKwh: row.energy_kwh,
  };
}

function sessionKey(session: Omit<ChargingSession, "id">) {
  return `${new Date(session.chargedAt).getTime()}|${session.locationType}|${session.locationName}|${session.energyKwh}`;
}

function likelySameChargingSession(stored: ChargingSession, incoming: ChargingSession) {
  if (stored.id.startsWith("myskoda:")) return false;
  const sameDay = COPENHAGEN_DAY_FORMAT.format(new Date(stored.chargedAt))
    === COPENHAGEN_DAY_FORMAT.format(new Date(incoming.chargedAt));
  const toleranceKwh = Math.max(1, stored.energyKwh * 0.25);
  return sameDay && Math.abs(stored.energyKwh - incoming.energyKwh) <= toleranceKwh;
}
