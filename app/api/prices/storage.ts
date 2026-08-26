import { database } from "../runtime";

type EnerginetRecord = {
  TimeUTC: string;
  TimeDK: string;
  PriceArea: string;
  DayAheadPriceDKK: number;
};

export type StoredPricePoint = {
  time: string;
  label: string;
  value: number;
  startsAt: string;
};

export async function listCurrentPrices(now = new Date(), limit = 48): Promise<StoredPricePoint[]> {
  const currentQuarter = Math.floor(now.getTime() / 900000) * 900000;
  const result = await database().prepare(`SELECT starts_at, time_dk, price_dkk_per_kwh
    FROM price_cache WHERE area = 'DK1' AND starts_at >= ?
    ORDER BY starts_at ASC LIMIT ?`)
    .bind(currentQuarter, limit)
    .all<{ starts_at: number; time_dk: string; price_dkk_per_kwh: number }>();
  return (result.results ?? []).map((row) => ({
    time: row.time_dk.slice(11, 16),
    label: row.time_dk.slice(11, 16),
    value: row.price_dkk_per_kwh,
    startsAt: new Date(row.starts_at).toISOString(),
  }));
}

export async function refreshPriceCache(now = new Date()): Promise<number> {
  const end = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  const filter = encodeURIComponent(JSON.stringify({ PriceArea: ["DK1"] }));
  const url = `https://api.energidataservice.dk/dataset/DayAheadPrices?start=${dateOnly(now)}&end=${dateOnly(end)}&filter=${filter}&sort=TimeUTC%20ASC&limit=0`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Energinet returned ${response.status}`);
  const payload = await response.json() as { records?: EnerginetRecord[] };
  const records = (payload.records ?? []).filter((record) =>
    Number.isFinite(record.DayAheadPriceDKK) && record.PriceArea === "DK1");
  if (!records.length) throw new Error("Energinet returned no DK1 prices");

  const fetchedAt = Date.now();
  const db = database();
  for (let offset = 0; offset < records.length; offset += 75) {
    const chunk = records.slice(offset, offset + 75);
    await db.batch(chunk.map((record) => db.prepare(`INSERT INTO price_cache
      (area, starts_at, time_dk, price_dkk_per_kwh, fetched_at)
      VALUES ('DK1', ?, ?, ?, ?)
      ON CONFLICT(area, starts_at) DO UPDATE SET
        time_dk = excluded.time_dk,
        price_dkk_per_kwh = excluded.price_dkk_per_kwh,
        fetched_at = excluded.fetched_at`)
      .bind(
        utcMilliseconds(record.TimeUTC),
        record.TimeDK,
        Number((record.DayAheadPriceDKK / 1000).toFixed(4)),
        fetchedAt,
      )));
  }
  await db.prepare("DELETE FROM price_cache WHERE starts_at < ?")
    .bind(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    .run();
  return records.length;
}

export async function hasTomorrowPrices(now = new Date()): Promise<boolean> {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowKey = dateOnly(tomorrow);
  const row = await database().prepare(`SELECT 1 AS found FROM price_cache
    WHERE area = 'DK1' AND substr(time_dk, 1, 10) = ? LIMIT 1`)
    .bind(tomorrowKey)
    .first<{ found: number }>();
  return row?.found === 1;
}

function dateOnly(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function utcMilliseconds(value: string): number {
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  return new Date(normalized).getTime();
}
