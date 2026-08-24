export type SmartcarCredentials = {
  clientId: string;
  clientSecret: string;
  userId: string;
};

type AccessToken = { access_token?: string; expires_in?: number };
type ConnectionResource = {
  attributes?: { user?: { id?: string } };
  relationships?: { vehicle?: { data?: { id?: string } } };
};
type VehicleResource = { attributes?: { make?: string; model?: string; year?: number } };
type SignalResource = {
  attributes?: {
    status?: { value?: string };
    body?: { value?: number; unit?: string };
  };
};
type ApiSingle<T> = { data?: T };
type ApiList<T> = { data?: T[] };

export async function getAccessToken(credentials: SmartcarCredentials) {
  const response = await fetch("https://iam.smartcar.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
  });
  if (!response.ok) throw new Error("Smartcar kunne ikke godkende nøglerne");
  const data = await response.json() as AccessToken;
  if (!data.access_token) throw new Error("Smartcar returnerede ingen adgang");
  return data.access_token;
}

export async function findVehicle(credentials: SmartcarCredentials, accessToken: string) {
  const params = new URLSearchParams({ "filter[userId]": credentials.userId });
  const response = await smartcarGet<ApiList<ConnectionResource>>(`/connections?${params}`, accessToken);
  const connection = response.data?.find((item) => item.attributes?.user?.id === credentials.userId) ?? response.data?.[0];
  const vehicleId = connection?.relationships?.vehicle?.data?.id;
  if (!vehicleId) throw new Error("Der blev ikke fundet en bil til dette User ID");
  return vehicleId;
}

export async function getVehicleSnapshot(credentials: SmartcarCredentials) {
  const accessToken = await getAccessToken(credentials);
  const vehicleId = await findVehicle(credentials, accessToken);
  const [infoResponse, batteryResponse, rangeResponse, odometerResponse] = await Promise.all([
    smartcarGet<ApiSingle<VehicleResource>>(`/vehicles/${vehicleId}`, accessToken),
    smartcarGet<ApiSingle<SignalResource>>(`/vehicles/${vehicleId}/signals/tractionbattery-stateofcharge`, accessToken, credentials.userId),
    smartcarGet<ApiSingle<SignalResource>>(`/vehicles/${vehicleId}/signals/tractionbattery-range`, accessToken, credentials.userId),
    smartcarGet<ApiSingle<SignalResource>>(`/vehicles/${vehicleId}/signals/odometer-traveleddistance`, accessToken, credentials.userId).catch(() => ({})),
  ]);
  const info = infoResponse.data?.attributes;
  const batteryPercent = signalValue(batteryResponse);
  const rangeKm = signalValue(rangeResponse);
  const odometerKm = signalValue(odometerResponse);
  const missingSignals = [
    batteryPercent === null ? "Batteriniveau" : null,
    rangeKm === null ? "Rækkevidde" : null,
    odometerKm === null ? "Kilometerstand" : null,
  ].filter((value): value is string => value !== null);
  return {
    make: info?.make ?? "Škoda",
    model: info?.model ?? "Elroq 60",
    year: info?.year,
    batteryPercent,
    rangeKm,
    odometerKm,
    dataComplete: missingSignals.length === 0,
    missingSignals,
  };
}

function signalValue(response: ApiSingle<SignalResource>): number | null {
  const attributes = response.data?.attributes;
  const value = attributes?.body?.value;
  if (attributes?.status?.value && attributes.status.value !== "SUCCESS") return null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function smartcarGet<T>(path: string, accessToken: string, userId?: string): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  if (userId) headers["sc-user-id"] = userId;
  const response = await fetch(`https://vehicle.api.smartcar.com/v3${path}`, {
    headers,
  });
  if (!response.ok) throw new Error(`Smartcar-data kunne ikke hentes (${response.status})`);
  return response.json() as Promise<T>;
}
