import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getMySkodaSnapshot, loginMySkoda } from "../../myskoda";
import { deleteMySkodaSession, saveMySkodaSession } from "../../storage";

export async function POST(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Du skal være logget ind" }, { status: 401 });
  const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
  const email = body?.email?.trim() ?? "";
  const password = body?.password ?? "";
  if (!email || !password) return NextResponse.json({ error: "Udfyld MyŠkoda e-mail og adgangskode" }, { status: 400 });

  try {
    const session = await loginMySkoda(email, password);
    const vehicle = await getMySkodaSnapshot(session);
    await saveMySkodaSession(user.email, session);
    return NextResponse.json({ ok: true, provider: "myskoda", vehicle });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MyŠkoda-forbindelsen kunne ikke oprettes" }, { status: 400 });
  }
}

export async function DELETE() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Du skal være logget ind" }, { status: 401 });
  await deleteMySkodaSession(user.email);
  return NextResponse.json({ ok: true });
}
