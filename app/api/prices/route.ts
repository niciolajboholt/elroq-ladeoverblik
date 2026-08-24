import { listCurrentPrices, refreshPriceCache } from "./storage";

export async function GET() {
  const now = new Date();

  try {
    let records = await listCurrentPrices(now);
    if (records.length < 8) {
      await refreshPriceCache(now);
      records = await listCurrentPrices(now);
    }
    if (!records.length) throw new Error("No current DK1 prices available");
    return Response.json(
      { area: "DK1", source: "Energinet", updatedAt: new Date().toISOString(), prices: records },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600" } },
    );
  } catch {
    return Response.json({ error: "Kunne ikke hente aktuelle priser" }, { status: 503 });
  }
}
