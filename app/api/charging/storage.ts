import "server-only";
import { database } from "../runtime";
import { likelySameChargingSession } from "../../domain/charging";
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
  const result = await database().prepare(`SELECT id, charged_at, location_type, location_name, energy_kwh
    FROM charging_sessions WHERE owner_email = ? ORDER BY charged_at DESC LIMIT 500`)
    .bind(ownerEmail).all<SessionRow>();
  return (result.results ?? []).map(toSession);
}

export async function addChargingSession(ownerEmail: string, input: Omit<ChargingSession, "id">) {
  const id = crypto.randomUUID();
  await database().prepare(`INSERT INTO charging_sessions
    (id, owner_email, charged_at, location_type, location_name, energy_kwh, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, ownerEmail, new Date(input.chargedAt).getTime(), input.locationType, input.locationName, input.energyKwh, Date.now()).run();
  return { id, ...input } satisfies ChargingSession;
}

export async function importChargingSessions(ownerEmail: string, inputs: Array<Omit<ChargingSession, "id">>) {
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
  await database().prepare("DELETE FROM charging_sessions WHERE owner_email = ? AND id = ?")
    .bind(ownerEmail, id).run();
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
