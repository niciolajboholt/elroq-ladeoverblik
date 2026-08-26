import "server-only";
import { env } from "cloudflare:workers";

export function database(): D1Database {
  if (!env.DB) throw new Error("Databasen er ikke tilgængelig");
  return env.DB;
}

export function storageEncryptionSecret(): string | undefined {
  return env.SMARTCAR_STORAGE_KEY ?? process.env.SMARTCAR_STORAGE_KEY;
}
