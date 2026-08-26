import type { SmartcarCredentials } from "./smartcar";
import type { MySkodaSession } from "./myskoda";
import { database, storageEncryptionSecret } from "../runtime";

export async function loadCredentials(ownerEmail: string): Promise<SmartcarCredentials | null> {
  const row = await database().prepare("SELECT encrypted_credentials FROM smartcar_config WHERE owner_email = ?")
    .bind(ownerEmail).first<{ encrypted_credentials: string }>();
  return row ? decrypt<SmartcarCredentials>(row.encrypted_credentials) : null;
}

export async function saveCredentials(ownerEmail: string, credentials: SmartcarCredentials) {
  const now = Date.now();
  const encrypted = await encrypt(credentials);
  await database().prepare(`INSERT INTO smartcar_config (owner_email, encrypted_credentials, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(owner_email) DO UPDATE SET encrypted_credentials = excluded.encrypted_credentials, updated_at = excluded.updated_at`)
    .bind(ownerEmail, encrypted, now, now).run();
}

export async function deleteCredentials(ownerEmail: string) {
  await database().prepare("DELETE FROM smartcar_config WHERE owner_email = ?").bind(ownerEmail).run();
}

export async function loadMySkodaSession(ownerEmail: string): Promise<MySkodaSession | null> {
  const row = await database().prepare("SELECT encrypted_session FROM myskoda_config WHERE owner_email = ?")
    .bind(ownerEmail).first<{ encrypted_session: string }>();
  return row ? decrypt<MySkodaSession>(row.encrypted_session) : null;
}

export async function saveMySkodaSession(ownerEmail: string, session: MySkodaSession) {
  const now = Date.now();
  const encrypted = await encrypt(session);
  await database().prepare(`INSERT INTO myskoda_config (owner_email, encrypted_session, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(owner_email) DO UPDATE SET encrypted_session = excluded.encrypted_session, updated_at = excluded.updated_at`)
    .bind(ownerEmail, encrypted, now, now).run();
}

export async function deleteMySkodaSession(ownerEmail: string) {
  await database().prepare("DELETE FROM myskoda_config WHERE owner_email = ?").bind(ownerEmail).run();
}

async function encrypt(value: unknown) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value))));
  return `${base64url(iv)}.${base64url(ciphertext)}`;
}

async function decrypt<T>(value: string): Promise<T> {
  const [ivPart, ciphertextPart] = value.split(".");
  if (!ivPart || !ciphertextPart) throw new Error("Ugyldig krypteret konfiguration");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64url(ivPart) }, await encryptionKey(), fromBase64url(ciphertextPart));
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

async function encryptionKey() {
  const secret = storageEncryptionSecret();
  if (!secret) throw new Error("Serverkryptering er ikke konfigureret");
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
