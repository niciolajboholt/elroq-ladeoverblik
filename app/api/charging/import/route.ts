import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { cleverScreenshotHistory } from "../clever-history";
import { importChargingSessions, listChargingSessions } from "../storage";

export async function POST() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });
  const imported = await importChargingSessions(user.email, cleverScreenshotHistory);
  const sessions = await listChargingSessions(user.email);
  return NextResponse.json({ imported, sessions });
}
