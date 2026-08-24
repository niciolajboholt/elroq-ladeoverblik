import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getVehicleSnapshot, type SmartcarCredentials } from "../smartcar";
import { deleteCredentials, saveCredentials } from "../storage";

export async function POST(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Du skal være logget ind" }, { status: 401 });
  const body = await request.json().catch(() => null) as Partial<SmartcarCredentials> | null;
  const credentials = {
    clientId: body?.clientId?.trim() ?? "",
    clientSecret: body?.clientSecret?.trim() ?? "",
    userId: body?.userId?.trim() ?? "",
  };
  if (!credentials.clientId || !credentials.clientSecret || !credentials.userId) {
    return NextResponse.json({ error: "Udfyld alle tre felter" }, { status: 400 });
  }
  try {
    const vehicle = await getVehicleSnapshot(credentials);
    await saveCredentials(user.email, credentials);
    return NextResponse.json({ ok: true, vehicle });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Forbindelsen kunne ikke testes" }, { status: 400 });
  }
}

export async function DELETE() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Du skal være logget ind" }, { status: 401 });
  await deleteCredentials(user.email);
  return NextResponse.json({ ok: true });
}
