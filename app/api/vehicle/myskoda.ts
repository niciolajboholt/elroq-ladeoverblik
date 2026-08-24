const CLIENT_ID = "7f045eee-7003-4379-9968-9355ed2adb06@apps_vw-dilab_com";
const REDIRECT_URI = "myskoda://redirect/login/";
const IDENTITY_BASE = "https://identity.vwgroup.io";
const API_BASE = "https://mysmob.api.connect.skoda-auto.cz";
const SCOPE = "address badge birthdate cars driversLicense dealers email mileage mbb nationalIdentifier openid phone profession profile vin";

export type MySkodaSession = {
  accessToken: string;
  refreshToken: string;
  idToken: string;
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export async function loginMySkoda(email: string, password: string): Promise<MySkodaSession> {
  const jar = new CookieJar();
  const verifier = randomBase64Url(64);
  const challengeBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const authorizeUrl = new URL(`${IDENTITY_BASE}/oidc/v1/authorize`);
  authorizeUrl.search = new URLSearchParams({
    client_id: CLIENT_ID,
    nonce: randomBase64Url(32),
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    code_challenge: base64Url(challengeBytes),
    code_challenge_method: "s256",
    prompt: "login",
  }).toString();

  const initial = await jar.request(authorizeUrl.toString(), { method: "GET" });
  const firstState = parseLoginState(await initial.response.text());
  const identifier = await jar.request(`${IDENTITY_BASE}/signin-service/v1/${CLIENT_ID}/login/identifier`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ relayState: firstState.relayState, email, hmac: firstState.hmac, _csrf: firstState.csrf }),
  });
  const passwordState = parseLoginState(await identifier.response.text());
  const authenticated = await jar.request(`${IDENTITY_BASE}/signin-service/v1/${CLIENT_ID}/login/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ relayState: passwordState.relayState, email, password, hmac: passwordState.hmac, _csrf: passwordState.csrf }),
  }, "myskoda:");

  const location = authenticated.location;
  if (!location?.startsWith("myskoda:")) {
    const body = await authenticated.response.text().catch(() => "");
    if (/terms-and-conditions/i.test(location ?? body)) throw new Error("Godkend først de nye vilkår i MyŠkoda-appen");
    if (/consent\/marketing/i.test(location ?? body)) throw new Error("Gennemfør først samtykke-dialogen i MyŠkoda-appen");
    throw new Error("MyŠkoda-login mislykkedes. Kontrollér e-mail og adgangskode");
  }
  const code = new URL(location).searchParams.get("code");
  if (!code) throw new Error("MyŠkoda returnerede ingen login-kode");

  return tokenRequest("/api/v1/authentication/exchange-authorization-code?tokenType=CONNECT", {
    code,
    redirectUri: REDIRECT_URI,
    verifier,
  });
}

export async function refreshMySkoda(refreshToken: string): Promise<MySkodaSession> {
  return tokenRequest("/api/v1/authentication/refresh-token?tokenType=CONNECT", { token: refreshToken });
}

export async function getMySkodaSnapshot(session: MySkodaSession) {
  const garage = await apiGet("/api/v2/garage?connectivityGenerations=MOD1&connectivityGenerations=MOD2&connectivityGenerations=MOD3&connectivityGenerations=MOD4", session.accessToken);
  const vehicles = objectValue(garage)?.vehicles;
  const vehicle = Array.isArray(vehicles) ? objectValue(vehicles[0]) : null;
  const vin = stringValue(vehicle?.vin) ?? findString(garage, ["vin"]);
  if (!vin) throw new Error("Der blev ikke fundet en bil på din MyŠkoda-konto");

  const [charging, drivingRange, maintenanceReport, health, trips] = await Promise.all([
    apiGet(`/api/v1/charging/${encodeURIComponent(vin)}`, session.accessToken),
    apiGet(`/api/v2/vehicle-status/${encodeURIComponent(vin)}/driving-range`, session.accessToken).catch(() => null),
    apiGet(`/api/v3/vehicle-maintenance/vehicles/${encodeURIComponent(vin)}/report`, session.accessToken).catch(() => null),
    apiGet(`/api/v1/vehicle-health-report/warning-lights/${encodeURIComponent(vin)}`, session.accessToken).catch(() => null),
    apiGet(`/api/v1/trip-statistics/${encodeURIComponent(vin)}?offsetType=week&offset=0&timezone=Europe%2FCopenhagen`, session.accessToken).catch(() => null),
  ]);

  const batteryPercent = findNumber(charging, ["stateOfChargeInPercent", "stateOfCharge"]);
  const rangeMeters = findNumber(charging, ["remainingCruisingRangeInMeters", "cruisingRangeElectricInMeters", "electricRangeInMeters", "remainingRangeInMeters"]);
  const rangeKmDirect = findNumber(drivingRange, ["totalRangeInKm", "remainingRangeInKm"])
    ?? findNumber(charging, ["rangeInKm", "electricRangeInKm", "remainingRangeInKm"]);
  const odometerKm = findNumber(maintenanceReport, ["mileageInKm"])
    ?? findNumber(health, ["mileageInKm"]);
  const consumptionKwhPer100Km = findNumber(trips, [
    "overallAverageElectricConsumption",
    "averageElectricConsumptionInKWhPer100Km",
    "overallAverageElectricConsumptionInKWhPer100Km",
    "averageElectricConsumption",
  ]);
  const model = stringValue(vehicle?.model) ?? stringValue(vehicle?.name) ?? findString(garage, ["model"]);
  const missingSignals = [
    batteryPercent == null ? "Batteriniveau" : null,
    rangeMeters == null && rangeKmDirect == null ? "Rækkevidde" : null,
    odometerKm == null ? "Kilometerstand" : null,
  ].filter((value): value is string => value !== null);

  return {
    make: "Škoda",
    model: model ?? "Elroq",
    batteryPercent,
    rangeKm: rangeKmDirect ?? (rangeMeters == null ? null : rangeMeters / 1000),
    odometerKm,
    consumptionKwhPer100Km,
    efficiencyKmPerKwh: consumptionKwhPer100Km && consumptionKwhPer100Km > 0 ? 100 / consumptionKwhPer100Km : null,
    chargeState: findString(charging, ["state", "chargingState", "status"]),
    dataComplete: missingSignals.length === 0,
    missingSignals,
  };
}

async function tokenRequest(path: string, payload: Record<string, string>): Promise<MySkodaSession> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`MyŠkoda kunne ikke oprette adgang (${response.status})`);
  const data = await response.json() as Record<string, unknown>;
  const accessToken = stringValue(data.accessToken);
  const refreshToken = stringValue(data.refreshToken);
  const idToken = stringValue(data.idToken);
  if (!accessToken || !refreshToken || !idToken) throw new Error("MyŠkoda returnerede ufuldstændige adgangsdata");
  return { accessToken, refreshToken, idToken };
}

async function apiGet(path: string, accessToken: string): Promise<JsonValue> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`MyŠkoda-data kunne ikke hentes (${response.status})`);
  return response.json() as Promise<JsonValue>;
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  async request(url: string, init: RequestInit, stopPrefix?: string) {
    let currentUrl = url;
    let currentInit = init;
    for (let redirectCount = 0; redirectCount < 12; redirectCount += 1) {
      const headers = new Headers(currentInit.headers);
      if (this.cookies.size) headers.set("Cookie", [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "));
      const response = await fetch(currentUrl, { ...currentInit, headers, redirect: "manual" });
      this.capture(response.headers);
      const locationHeader = response.headers.get("location");
      if (!locationHeader || response.status < 300 || response.status >= 400) return { response, location: locationHeader };
      const location = locationHeader.startsWith("myskoda:") ? locationHeader : new URL(locationHeader, currentUrl).toString();
      if (stopPrefix && location.startsWith(stopPrefix)) return { response, location };
      currentUrl = location;
      currentInit = response.status === 307 || response.status === 308 ? currentInit : { method: "GET" };
    }
    throw new Error("MyŠkoda-login gav for mange viderestillinger");
  }

  private capture(headers: Headers) {
    const extended = headers as Headers & { getSetCookie?: () => string[] };
    const values = extended.getSetCookie?.() ?? splitSetCookie(headers.get("set-cookie"));
    values.forEach((cookie) => {
      const pair = cookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    });
  }
}

function parseLoginState(html: string) {
  const csrf = hiddenInput(html, "_csrf", false) ?? scriptValue(html, "csrf_token");
  const relayState = hiddenInput(html, "relayState", false) ?? scriptValue(html, "relayState");
  const hmac = hiddenInput(html, "hmac", false) ?? scriptValue(html, "hmac");
  if (!csrf || !relayState || !hmac) throw new Error("MyŠkoda ændrede login-flowet. Prøv igen senere");
  return { csrf, relayState, hmac };
}

function hiddenInput(html: string, name: string, required = true) {
  const inputs = html.match(/<input\b[^>]*>/gi) ?? [];
  const tag = inputs.find((input) => new RegExp(`\\bname=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(input));
  const value = tag?.match(/\bvalue=["']([^"']*)["']/i)?.[1];
  if (!value && required) throw new Error("MyŠkoda ændrede login-flowet. Prøv igen senere");
  if (!value) return null;
  return decodeHtml(value);
}

function scriptValue(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`["']?${escaped}["']?\\s*:\\s*["']([^"']+)["']`, "i"));
  return match?.[1] ? decodeHtml(match[1]) : null;
}

function form(values: Record<string, string>) { return new URLSearchParams(values).toString(); }
function decodeHtml(value: string) { return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">"); }
function randomBase64Url(size: number) { return base64Url(crypto.getRandomValues(new Uint8Array(size))); }
function base64Url(bytes: Uint8Array) { let binary = ""; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function splitSetCookie(value: string | null) { return value ? value.split(/,(?=\s*[^;,]+=)/) : []; }
function objectValue(value: JsonValue | undefined): { [key: string]: JsonValue } | null { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function stringValue(value: unknown) { return typeof value === "string" && value.trim() ? value : null; }

function findNumber(value: JsonValue | null, keys: string[]): number | null {
  if (value == null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findNumber(item, keys); if (found != null) return found; }
    return null;
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  for (const candidate of Object.values(value)) { const found = findNumber(candidate, keys); if (found != null) return found; }
  return null;
}

function findString(value: JsonValue | null, keys: string[]): string | null {
  if (value == null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findString(item, keys); if (found) return found; }
    return null;
  }
  for (const key of keys) { const candidate = stringValue(value[key]); if (candidate) return candidate; }
  for (const candidate of Object.values(value)) { const found = findString(candidate, keys); if (found) return found; }
  return null;
}
