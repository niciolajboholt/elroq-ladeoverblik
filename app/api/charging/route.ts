import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { addChargingSession, deleteChargingSession, listChargingSessions } from "./storage";

const COMPARISON_PRICE_PER_KWH = 3.49;
const CLEVER_ONE_MONTHLY_DKK = 799;

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });
  const sessions = await listChargingSessions(user.email);
  return NextResponse.json({ sessions, summary: summarize(sessions) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const energyKwh = typeof body?.energyKwh === "number" ? body.energyKwh : Number(body?.energyKwh);
  const chargedAt = typeof body?.chargedAt === "string" ? body.chargedAt : "";
  const locationType = body?.locationType === "public" ? "public" : body?.locationType === "home" ? "home" : null;
  const parsedDate = new Date(chargedAt);
  if (!Number.isFinite(energyKwh) || energyKwh < 0.1 || energyKwh > 150) return NextResponse.json({ error: "Indtast et gyldigt antal kWh" }, { status: 400 });
  if (!chargedAt || Number.isNaN(parsedDate.getTime())) return NextResponse.json({ error: "Vælg dato og tidspunkt" }, { status: 400 });
  if (!locationType) return NextResponse.json({ error: "Vælg hjemme eller offentlig opladning" }, { status: 400 });
  const locationName = typeof body?.locationName === "string" && body.locationName.trim()
    ? body.locationName.trim().slice(0, 80)
    : locationType === "home" ? "Hjemme" : "Clever-lader";
  const session = await addChargingSession(user.email, {
    chargedAt: parsedDate.toISOString(),
    energyKwh: Math.round(energyKwh * 100) / 100,
    locationType,
    locationName,
  });
  const sessions = await listChargingSessions(user.email);
  return NextResponse.json({ session, sessions, summary: summarize(sessions) }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Opladningen mangler et id" }, { status: 400 });
  await deleteChargingSession(user.email, id);
  const sessions = await listChargingSessions(user.email);
  return NextResponse.json({ sessions, summary: summarize(sessions) });
}

function summarize(sessions: Awaited<ReturnType<typeof listChargingSessions>>) {
  const now = new Date();
  const monthly = sessions.filter((session) => {
    const date = new Date(session.chargedAt);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const totalKwh = monthly.reduce((sum, session) => sum + session.energyKwh, 0);
  const homeKwh = monthly.filter((session) => session.locationType === "home").reduce((sum, session) => sum + session.energyKwh, 0);
  const publicKwh = totalKwh - homeKwh;
  const comparisonValueDkk = totalKwh * COMPARISON_PRICE_PER_KWH;
  const yearSessions = sessions.filter((session) => new Date(session.chargedAt).getFullYear() === now.getFullYear());
  const annualTotalKwh = yearSessions.reduce((sum, session) => sum + session.energyKwh, 0);
  return {
    month: now.toLocaleDateString("da-DK", { month: "long", year: "numeric" }),
    totalKwh,
    homeKwh,
    publicKwh,
    sessionCount: monthly.length,
    subscriptionDkk: CLEVER_ONE_MONTHLY_DKK,
    comparisonPricePerKwh: COMPARISON_PRICE_PER_KWH,
    comparisonValueDkk,
    differenceDkk: comparisonValueDkk - CLEVER_ONE_MONTHLY_DKK,
    effectivePricePerKwh: totalKwh > 0 ? CLEVER_ONE_MONTHLY_DKK / totalKwh : null,
    breakEvenKwh: CLEVER_ONE_MONTHLY_DKK / COMPARISON_PRICE_PER_KWH,
    annualTotalKwh,
    annualSessionCount: yearSessions.length,
  };
}
