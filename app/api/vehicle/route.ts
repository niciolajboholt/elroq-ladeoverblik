import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getVehicleSnapshot } from "./smartcar";
import { getMySkodaSnapshot, refreshMySkoda, type MySkodaSession } from "./myskoda";
import { loadCredentials, loadMySkodaSession, saveMySkodaSession } from "./storage";
import { getDrivingHistory, getLatestVehicleSnapshot, recordVehicleSnapshot } from "./history";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ configured: false, connected: false }, { status: 401 });
  try {
    const mySkodaSession = await loadMySkodaSession(user.email);
    if (mySkodaSession) {
      try {
        const snapshot = await readMySkodaSnapshot(user.email, mySkodaSession);
        await recordVehicleSnapshot(user.email, "myskoda", snapshot);
        const history = await getDrivingHistory(user.email);
        const vehicle = enrichWithHistory(snapshot, history);
        return NextResponse.json(
          { configured: true, connected: true, provider: "myskoda", updatedAt: new Date().toISOString(), vehicle },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      } catch (error) {
        const [cached, history] = await Promise.all([
          getLatestVehicleSnapshot(user.email),
          getDrivingHistory(user.email),
        ]);
        return NextResponse.json({
          configured: true,
          connected: true,
          provider: "myskoda",
          stale: true,
          updatedAt: cached?.capturedAt,
          error: error instanceof Error ? error.message : "MyŠkoda kunne ikke opdateres lige nu",
          vehicle: cached ? enrichWithHistory(cached.vehicle, history) : enrichWithHistory({
            make: "Škoda",
            model: "Elroq",
            batteryPercent: null,
            rangeKm: null,
            odometerKm: null,
            dataComplete: false,
            missingSignals: ["Batteriniveau", "Rækkevidde", "Kilometerstand"],
          }, history),
        }, { headers: { "Cache-Control": "private, no-store" } });
      }
    }
    const credentials = await loadCredentials(user.email);
    if (!credentials) return NextResponse.json({ configured: false, connected: false });
    const snapshot = await getVehicleSnapshot(credentials);
    await recordVehicleSnapshot(user.email, "smartcar", snapshot);
    const history = await getDrivingHistory(user.email);
    const vehicle = enrichWithHistory(snapshot, history);
    return NextResponse.json(
      { configured: true, connected: true, provider: "smartcar", updatedAt: new Date().toISOString(), vehicle },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json({
      configured: true,
      connected: false,
      error: error instanceof Error ? error.message : "Bildata kunne ikke hentes",
    });
  }
}

async function readMySkodaSnapshot(ownerEmail: string, session: MySkodaSession) {
  try {
    return await getMySkodaSnapshot(session);
  } catch {
    const refreshed = await refreshMySkoda(session.refreshToken);
    await saveMySkodaSession(ownerEmail, refreshed);
    return getMySkodaSnapshot(refreshed);
  }
}

function enrichWithHistory<T extends { consumptionKwhPer100Km?: number | null; efficiencyKmPerKwh?: number | null }>(vehicle: T, history: Awaited<ReturnType<typeof getDrivingHistory>>) {
  const directConsumption = vehicle.consumptionKwhPer100Km ?? null;
  const directEfficiency = vehicle.efficiencyKmPerKwh ?? null;
  return {
    ...vehicle,
    consumptionKwhPer100Km: directConsumption ?? history.consumptionKwhPer100Km,
    efficiencyKmPerKwh: directEfficiency ?? history.efficiencyKmPerKwh,
    efficiencySource: directConsumption != null || directEfficiency != null ? "vehicle" : history.status === "estimated" ? "estimated_history" : "collecting",
    history,
  };
}
