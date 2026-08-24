import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getMySkodaChargingHistory, refreshMySkoda } from "../../vehicle/myskoda";
import { loadMySkodaSession, saveMySkodaSession } from "../../vehicle/storage";
import { importExternalChargingSessions, listChargingSessions } from "../storage";

export async function POST() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });
  try {
    const stored = await loadMySkodaSession(user.email);
    if (!stored) return NextResponse.json({ error: "MyŠkoda er ikke forbundet" }, { status: 409 });
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    let history;
    try {
      history = await getMySkodaChargingHistory(stored, start, end);
    } catch {
      const refreshed = await refreshMySkoda(stored.refreshToken);
      await saveMySkodaSession(user.email, refreshed);
      history = await getMySkodaChargingHistory(refreshed, start, end);
    }
    const imported = await importExternalChargingSessions(user.email, history);
    const sessions = await listChargingSessions(user.email);
    return NextResponse.json({
      imported,
      found: history.length,
      total: sessions.length,
      syncedAt: now.toISOString(),
      classification: "AC-opladninger regnes som hjemme, mens DC-opladninger regnes som offentlige.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "MyŠkoda-ladehistorik kunne ikke synkroniseres",
    }, { status: 502 });
  }
}
