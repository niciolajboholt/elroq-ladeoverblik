import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getVehicleSnapshot } from "./smartcar";
import { getMySkodaSnapshot, refreshMySkoda } from "./myskoda";
import { loadCredentials, loadMySkodaSession, saveMySkodaSession } from "./storage";
import { getDrivingHistory, recordVehicleSnapshot } from "./history";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ configured: false, connected: false }, { status: 401 });
  try {
    const mySkodaSession = await loadMySkodaSession(user.email);
    if (mySkodaSession) {
      const refreshed = await refreshMySkoda(mySkodaSession.refreshToken);
      await saveMySkodaSession(user.email, refreshed);
      const snapshot = await getMySkodaSnapshot(refreshed);
      await recordVehicleSnapshot(user.email, "myskoda", snapshot);
      const history = await getDrivingHistory(user.email);
      const vehicle = enrichWithHistory(snapshot, history);
      return NextResponse.json(
        { configured: true, connected: true, provider: "myskoda", updatedAt: new Date().toISOString(), vehicle },
        { headers: { "Cache-Control": "private, no-store" } },
      );
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
