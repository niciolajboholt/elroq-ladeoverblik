import { getVehicleSnapshot } from "../app/api/vehicle/smartcar";
import { getMySkodaChargingHistory, getMySkodaSnapshot, refreshMySkoda } from "../app/api/vehicle/myskoda";
import {
  loadCredentials,
  loadMySkodaSession,
  saveMySkodaSession,
} from "../app/api/vehicle/storage";
import { recordVehicleSnapshot } from "../app/api/vehicle/history";
import { importExternalChargingSessions } from "../app/api/charging/storage";
import {
  hasTomorrowPrices,
  listCurrentPrices,
  refreshPriceCache,
} from "../app/api/prices/storage";

type SchedulerEnv = CloudflareEnv & {
  SMARTCAR_STORAGE_KEY?: string;
};

const STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS scheduler_state (
  job_name TEXT PRIMARY KEY NOT NULL,
  last_attempt_at INTEGER NOT NULL,
  last_success_at INTEGER,
  last_error TEXT,
  details_json TEXT
)`;

const MONTHLY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS monthly_summaries (
  owner_email TEXT NOT NULL,
  month TEXT NOT NULL,
  total_kwh REAL NOT NULL,
  home_kwh REAL NOT NULL,
  public_kwh REAL NOT NULL,
  session_count INTEGER NOT NULL,
  generated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_email, month)
)`;

export async function runScheduler(env: SchedulerEnv, scheduledAt: Date): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(STATE_TABLE_SQL),
    env.DB.prepare(MONTHLY_TABLE_SQL),
  ]);

  const local = zonedParts(scheduledAt, "Europe/Copenhagen");
  const localHour = local.hour;

  const jobs: Promise<void>[] = [];
  if (localHour >= 6 && localHour < 23) {
    jobs.push(runTracked(env.DB, "vehicle-sync", () => syncVehicle(env)));
  }
  if ((localHour === 5 || localHour === 23) && local.minute === 0) {
    jobs.push(runTracked(env.DB, "myskoda-charging-sync", () => syncMySkodaChargingHistory(env, scheduledAt)));
  }
  jobs.push(runTracked(env.DB, "price-sync", () => syncPrices(scheduledAt)));
  jobs.push(runTracked(env.DB, "monthly-summary", () => createPreviousMonthSummary(env, scheduledAt)));

  const results = await Promise.allSettled(jobs);
  const failed = results.filter((result) => result.status === "rejected");
  console.log(JSON.stringify({
    event: "elroq-scheduler",
    scheduledAt: scheduledAt.toISOString(),
    jobs: results.length,
    failed: failed.length,
  }));
}

async function syncMySkodaChargingHistory(env: SchedulerEnv, now: Date): Promise<Record<string, unknown>> {
  const ownerEmail = env.OWNER_EMAIL.trim().toLowerCase();
  const stored = await loadMySkodaSession(ownerEmail);
  if (!stored) return { skipped: "myskoda-not-connected" };
  const start = new Date(now.getTime() - 75 * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  let activeSession = stored;
  let sessions;
  try {
    sessions = await getMySkodaChargingHistory(activeSession, start, end);
  } catch {
    activeSession = await refreshMySkoda(stored.refreshToken);
    await saveMySkodaSession(ownerEmail, activeSession);
    sessions = await getMySkodaChargingHistory(activeSession, start, end);
  }
  const imported = await importExternalChargingSessions(ownerEmail, sessions);
  return { found: sessions.length, imported };
}

async function syncVehicle(env: SchedulerEnv): Promise<Record<string, unknown>> {
  const ownerEmail = env.OWNER_EMAIL.trim().toLowerCase();
  const mySkodaSession = await loadMySkodaSession(ownerEmail);
  if (mySkodaSession) {
    let activeSession = mySkodaSession;
    let snapshot;
    try {
      snapshot = await getMySkodaSnapshot(activeSession);
    } catch {
      activeSession = await refreshMySkoda(mySkodaSession.refreshToken);
      await saveMySkodaSession(ownerEmail, activeSession);
      snapshot = await getMySkodaSnapshot(activeSession);
    }
    await recordVehicleSnapshot(ownerEmail, "myskoda", snapshot);
    return { provider: "myskoda", batteryPercent: snapshot.batteryPercent };
  }

  const credentials = await loadCredentials(ownerEmail);
  if (!credentials) return { skipped: "vehicle-not-connected" };
  const snapshot = await getVehicleSnapshot(credentials);
  await recordVehicleSnapshot(ownerEmail, "smartcar", snapshot);
  return { provider: "smartcar", batteryPercent: snapshot.batteryPercent };
}

async function syncPrices(now: Date): Promise<Record<string, unknown>> {
  const localHour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Copenhagen",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
  const current = await listCurrentPrices(now, 1);
  const needsInitialData = current.length === 0;
  const needsTomorrowData = localHour >= 13 && !(await hasTomorrowPrices(now));
  if (!needsInitialData && !needsTomorrowData) return { skipped: "price-cache-current" };
  const records = await refreshPriceCache(now);
  return { records };
}

async function createPreviousMonthSummary(env: SchedulerEnv, now: Date): Promise<Record<string, unknown>> {
  const ownerEmail = env.OWNER_EMAIL.trim().toLowerCase();
  const local = zonedParts(now, "Europe/Copenhagen");
  const previousMonthDate = new Date(Date.UTC(local.year, local.month - 2, 15, 12));
  const previous = zonedParts(previousMonthDate, "Europe/Copenhagen");
  const month = `${previous.year}-${String(previous.month).padStart(2, "0")}`;
  const exists = await env.DB.prepare(`SELECT 1 AS found FROM monthly_summaries
    WHERE owner_email = ? AND month = ? LIMIT 1`)
    .bind(ownerEmail, month)
    .first<{ found: number }>();
  if (exists?.found === 1) return { skipped: "summary-already-created", month };

  const start = zonedMidnight(previous.year, previous.month, 1, "Europe/Copenhagen");
  const nextMonthDate = new Date(Date.UTC(previous.year, previous.month, 15, 12));
  const next = zonedParts(nextMonthDate, "Europe/Copenhagen");
  const end = zonedMidnight(next.year, next.month, 1, "Europe/Copenhagen");
  const totals = await env.DB.prepare(`SELECT
      COALESCE(SUM(energy_kwh), 0) AS total_kwh,
      COALESCE(SUM(CASE WHEN location_type = 'home' THEN energy_kwh ELSE 0 END), 0) AS home_kwh,
      COALESCE(SUM(CASE WHEN location_type = 'public' THEN energy_kwh ELSE 0 END), 0) AS public_kwh,
      COUNT(*) AS session_count
    FROM charging_sessions
    WHERE owner_email = ? AND charged_at >= ? AND charged_at < ?`)
    .bind(ownerEmail, start, end)
    .first<{ total_kwh: number; home_kwh: number; public_kwh: number; session_count: number }>();

  await env.DB.prepare(`INSERT INTO monthly_summaries
    (owner_email, month, total_kwh, home_kwh, public_kwh, session_count, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      ownerEmail,
      month,
      totals?.total_kwh ?? 0,
      totals?.home_kwh ?? 0,
      totals?.public_kwh ?? 0,
      totals?.session_count ?? 0,
      Date.now(),
    )
    .run();
  return { month, sessions: totals?.session_count ?? 0 };
}

async function runTracked(
  db: D1Database,
  jobName: string,
  job: () => Promise<Record<string, unknown>>,
): Promise<void> {
  const attemptedAt = Date.now();
  await db.prepare(`INSERT INTO scheduler_state
      (job_name, last_attempt_at, last_success_at, last_error, details_json)
      VALUES (?, ?, NULL, NULL, NULL)
      ON CONFLICT(job_name) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`)
    .bind(jobName, attemptedAt)
    .run();
  try {
    const details = await job();
    await db.prepare(`UPDATE scheduler_state SET
        last_success_at = ?, last_error = NULL, details_json = ?
      WHERE job_name = ?`)
      .bind(Date.now(), JSON.stringify(details), jobName)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scheduler error";
    await db.prepare(`UPDATE scheduler_state SET last_error = ? WHERE job_name = ?`)
      .bind(message.slice(0, 500), jobName)
      .run();
    console.error(JSON.stringify({ event: "elroq-scheduler-job-failed", jobName, message }));
    throw error;
  }
}

function zonedParts(date: Date, timeZone: string) {
  const values = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(values.find((value) => value.type === type)?.value ?? 0);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

function zonedMidnight(year: number, month: number, day: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day);
  const represented = zonedParts(new Date(guess), timeZone);
  const offset = Date.UTC(
    represented.year,
    represented.month - 1,
    represented.day,
    represented.hour,
    represented.minute,
    represented.second,
  ) - guess;
  return guess - offset;
}
