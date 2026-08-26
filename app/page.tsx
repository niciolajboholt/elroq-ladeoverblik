"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "./components/icon";
import { calculateProviderMatchScore } from "./domain/provider-score";

type Tab = "overblik" | "ladning" | "oekonomi" | "bil";

type PricePoint = { time: string; label: string; value: number; startsAt?: string };
type ChargingSession = { id: string; chargedAt: string; locationType: "home" | "public"; locationName: string; energyKwh: number };
type ChargingSummary = {
  month: string; totalKwh: number; homeKwh: number; publicKwh: number; sessionCount: number;
  subscriptionDkk: number; comparisonPricePerKwh: number; comparisonValueDkk: number; differenceDkk: number;
  effectivePricePerKwh: number | null; breakEvenKwh: number;
  annualTotalKwh: number; annualSessionCount: number;
};
type ChargingState = { sessions: ChargingSession[]; summary: ChargingSummary | null };
type ProviderComparison = {
  id: string; name: string; detail: string; totalCost: number; equivalentMonthlyCost: number;
  effectivePrice: number; sourceUrl: string; sourceLabel: string; caveat: string;
  breakdown: { subscription: number; home: number; publicDk: number; foreign: number };
  network: { dk: number; europe: number; convenience: number; own: string; partners: string; countries: string[] };
  matchScore: number;
  isCustom?: boolean;
};
type CustomProvider = { id: string; name: string; monthlyFee: number; publicDkPrice: number; foreignPrice: number };
type VehicleState = {
  configured: boolean;
  connected: boolean;
  provider?: "smartcar" | "myskoda";
  stale?: boolean;
  updatedAt?: string;
  error?: string;
  vehicle?: {
    make?: string;
    model?: string;
    year?: number;
    batteryPercent?: number | null;
    rangeKm?: number | null;
    odometerKm?: number | null;
    chargeState?: string;
    consumptionKwhPer100Km?: number | null;
    efficiencyKmPerKwh?: number | null;
    efficiencySource?: "vehicle" | "estimated_history" | "collecting";
    history?: {
      status: "collecting" | "estimated";
      samples: number;
      distanceKm: number | null;
      estimatedEnergyKwh: number | null;
      firstCapturedAt: string | null;
      lastCapturedAt: string | null;
    };
    dataComplete?: boolean;
    missingSignals?: string[];
  };
};

const fallbackPrices: PricePoint[] = [
  { time: "18", label: "18:00", value: 0.68 }, { time: "19", label: "19:00", value: 0.82 }, { time: "20", label: "20:00", value: 0.64 },
  { time: "21", label: "21:00", value: 0.51 }, { time: "22", label: "22:00", value: 0.44 }, { time: "23", label: "23:00", value: 0.38 },
  { time: "00", label: "00:00", value: 0.31 }, { time: "01", label: "01:00", value: 0.27 }, { time: "02", label: "02:00", value: 0.22 },
  { time: "03", label: "03:00", value: 0.25 }, { time: "04", label: "04:00", value: 0.29 }, { time: "05", label: "05:00", value: 0.36 },
];

const FOREIGN_LOCATION = /Aral pulse|Harz|Riedener|Memmingen|Brenner|Guxhagen|Schongauer|Baukreativ/i;
const OK_SOURCE = "https://www.ok.dk/privat/produkter/opladning/ude";
const IONITY_SOURCE = "https://www.ionity.eu/dk/abonnementer";
const NORLYS_SOURCE = "https://norlys.dk/opladning/oplad-ude/";
const CLEVER_SOURCE = "https://clever.dk/ladeloesninger/opladning-med-abonnement/";
const EON_SOURCE = "https://www.edri.com/da-dk/app";
const Q8_SOURCE = "https://www.q8.dk/priser/";
const EWII_SOURCE = "https://www.ewii.dk/privat/kundeservice/opladning/ladekort/";
const SPIRII_SOURCE = "https://spiriihelp.zendesk.com/hc/da/articles/15328005885969-Spirii-s-offentlige-ladenetv%C3%A6rk";
const CIRCLE_K_SOURCE = "https://www.circlek.dk/opladning";
const TESLA_SOURCE = "https://www.tesla.com/da_dk/supercharger";

export default function Home() {
  const [tab, setTab] = useState<Tab>("overblik");
  const [departure, setDeparture] = useState("06:45");
  const [target, setTarget] = useState(80);
  const [planned, setPlanned] = useState(false);
  const [prices, setPrices] = useState<PricePoint[]>(fallbackPrices);
  const [priceState, setPriceState] = useState<"loading" | "live" | "fallback">("loading");
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [vehicleState, setVehicleState] = useState<VehicleState>({ configured: false, connected: false });
  const [vehicleLoading, setVehicleLoading] = useState(true);
  const [vehicleLoadError, setVehicleLoadError] = useState("");
  const [mySkodaEmail, setMySkodaEmail] = useState("");
  const [mySkodaPassword, setMySkodaPassword] = useState("");
  const [setupState, setSetupState] = useState<"idle" | "saving" | "error">("idle");
  const [setupMessage, setSetupMessage] = useState("");
  const [charging, setCharging] = useState<ChargingState>({ sessions: [], summary: null });
  const [showChargeForm, setShowChargeForm] = useState(false);
  const [chargeSaving, setChargeSaving] = useState(false);
  const [chargeError, setChargeError] = useState("");
  const [chargeDate, setChargeDate] = useState(localDateTimeValue());
  const [chargeKwh, setChargeKwh] = useState("");
  const [chargeType, setChargeType] = useState<"home" | "public">("home");
  const [chargePlace, setChargePlace] = useState("");
  const [historyImporting, setHistoryImporting] = useState(false);
  const [mySkodaHistorySyncing, setMySkodaHistorySyncing] = useState(false);
  const [historyImportMessage, setHistoryImportMessage] = useState("");
  const cleverMonthlyDkk = 799;
  const [comparisonPeriod, setComparisonPeriod] = useState<"month" | "year">("month");
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [showCustomProvider, setShowCustomProvider] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customMonthlyFee, setCustomMonthlyFee] = useState("0");
  const [customPublicPrice, setCustomPublicPrice] = useState("3.50");
  const [customForeignPrice, setCustomForeignPrice] = useState("4.50");
  const [priceAlerts, setPriceAlerts] = useState(false);
  const [tripDistanceKm, setTripDistanceKm] = useState(500);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const saved = window.localStorage.getItem("elroq-custom-providers");
      if (saved) timer = setTimeout(() => setCustomProviders(JSON.parse(saved) as CustomProvider[]), 0);
    } catch { /* En ugyldig lokal indstilling ignoreres. */ }
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const savedPlan = window.localStorage.getItem("elroq-charge-plan") === "true";
      const savedPriceWatch = window.localStorage.getItem("elroq-price-watch") === "true";
      timer = setTimeout(() => {
        setPlanned(savedPlan);
        setPriceAlerts(savedPriceWatch);
      }, 0);
    } catch { /* Browseren tillader ikke lokal lagring. */ }
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  function togglePlanned() {
    const next = !planned;
    setPlanned(next);
    try { window.localStorage.setItem("elroq-charge-plan", String(next)); } catch { /* Indstillingen gælder kun denne visning. */ }
  }

  function togglePriceAlerts() {
    const next = !priceAlerts;
    setPriceAlerts(next);
    try { window.localStorage.setItem("elroq-price-watch", String(next)); } catch { /* Indstillingen gælder kun denne visning. */ }
  }

  function storeCustomProviders(next: CustomProvider[]) {
    setCustomProviders(next);
    window.localStorage.setItem("elroq-custom-providers", JSON.stringify(next));
  }

  function prepareCustomProvider(name = "") {
    setCustomName(name);
    setCustomMonthlyFee("0");
    setCustomPublicPrice("3.50");
    setCustomForeignPrice("4.50");
    setShowCustomProvider(true);
  }

  function addCustomProvider(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = customName.trim();
    if (!name) return;
    storeCustomProviders([...customProviders, {
      id: `custom-${Date.now()}`,
      name,
      monthlyFee: Math.max(0, Number(customMonthlyFee.replace(",", ".")) || 0),
      publicDkPrice: Math.max(0, Number(customPublicPrice.replace(",", ".")) || 0),
      foreignPrice: Math.max(0, Number(customForeignPrice.replace(",", ".")) || 0),
    }]);
    setShowCustomProvider(false);
  }

  function exportMonthlyReport() {
    const rows = [
      ["Dato", "Sted", "Type", "kWh"],
      ...charging.sessions.map((session) => [new Date(session.chargedAt).toLocaleDateString("da-DK"), session.locationName, session.locationType === "home" ? "Hjemme" : "Offentlig", session.energyKwh.toFixed(2)]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `elroq-laderapport-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/prices", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Price feed unavailable");
        return response.json();
      })
      .then((data: { prices?: PricePoint[]; updatedAt?: string }) => {
        if (!data.prices?.length) throw new Error("No current prices");
        setPrices(data.prices);
        setUpdatedAt(data.updatedAt ?? new Date().toISOString());
        setPriceState("live");
      })
      .catch((error) => {
        if (error.name !== "AbortError") setPriceState("fallback");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    fetch("/api/charging", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Charging unavailable")))
      .then((data: ChargingState) => setCharging(data))
      .catch(() => setCharging({ sessions: [], summary: null }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    fetch("/api/vehicle", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((data: VehicleState) => {
        setVehicleState(data);
        setVehicleLoadError(data.error ?? "");
      })
      .catch((error) => setVehicleLoadError(error instanceof DOMException && error.name === "AbortError"
        ? "MyŠkoda svarede ikke inden for 20 sekunder. Forbindelsen er ikke slettet."
        : "Bildata kunne ikke hentes. Forbindelsen er ikke slettet."))
      .finally(() => {
        window.clearTimeout(timeout);
        setVehicleLoading(false);
      });
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  async function connectMySkoda(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSetupState("saving");
    setSetupMessage("");
    const response = await fetch("/api/vehicle/myskoda/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: mySkodaEmail, password: mySkodaPassword }),
    });
    const data = await response.json() as { ok?: boolean; error?: string; provider?: "myskoda"; vehicle?: VehicleState["vehicle"] };
    setMySkodaPassword("");
    if (!response.ok || !data.ok) {
      setSetupState("error");
      setSetupMessage(data.error ?? "MyŠkoda-forbindelsen kunne ikke oprettes");
      return;
    }
    setSetupState("idle");
    setVehicleState({ configured: true, connected: true, provider: "myskoda", updatedAt: new Date().toISOString(), vehicle: data.vehicle });
  }

  async function removeMySkoda() {
    if (!window.confirm("Fjern den gemte MyŠkoda-forbindelse fra ladeoverblikket?")) return;
    await fetch("/api/vehicle/myskoda/config", { method: "DELETE" });
    setVehicleState({ configured: false, connected: false });
  }

  async function refreshVehicle() {
    setVehicleLoading(true);
    setVehicleLoadError("");
    try {
      const response = await fetch("/api/vehicle", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const data = await response.json() as VehicleState;
      setVehicleState(data);
      setVehicleLoadError(data.error ?? "");
    } catch (error) {
      setVehicleLoadError(error instanceof DOMException && error.name === "TimeoutError"
        ? "MyŠkoda svarede ikke inden for 20 sekunder. Prøv igen om lidt."
        : "Bildata kunne ikke opdateres lige nu.");
    } finally {
      setVehicleLoading(false);
    }
  }

  async function saveChargingSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChargeSaving(true);
    setChargeError("");
    try {
      const response = await fetch("/api/charging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chargedAt: chargeDate, energyKwh: Number(chargeKwh.replace(",", ".")), locationType: chargeType, locationName: chargePlace }),
      });
      const data = await response.json() as ChargingState & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Opladningen kunne ikke gemmes");
      setCharging(data);
      setChargeKwh("");
      setChargePlace("");
      setChargeDate(localDateTimeValue());
      setShowChargeForm(false);
    } catch (error) {
      setChargeError(error instanceof Error ? error.message : "Opladningen kunne ikke gemmes");
    } finally {
      setChargeSaving(false);
    }
  }

  async function removeChargingSession(id: string) {
    if (!window.confirm("Slet denne opladning fra regnskabet?")) return;
    const response = await fetch(`/api/charging?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) setCharging(await response.json() as ChargingState);
  }

  async function importCleverHistory() {
    setHistoryImporting(true);
    setHistoryImportMessage("");
    try {
      const response = await fetch("/api/charging/import", { method: "POST" });
      const data = await response.json() as { imported?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Historikken kunne ikke indlæses");
      const refreshed = await fetch("/api/charging", { cache: "no-store" });
      if (!refreshed.ok) throw new Error("Historikken blev gemt, men visningen kunne ikke opdateres");
      setCharging(await refreshed.json() as ChargingState);
      setHistoryImportMessage(data.imported ? `${data.imported} opladninger blev indlæst` : "Historikken var allerede indlæst");
    } catch (error) {
      setHistoryImportMessage(error instanceof Error ? error.message : "Historikken kunne ikke indlæses");
    } finally {
      setHistoryImporting(false);
    }
  }

  async function syncMySkodaChargingHistory() {
    setMySkodaHistorySyncing(true);
    setHistoryImportMessage("");
    try {
      const response = await fetch("/api/charging/myskoda", { method: "POST" });
      const data = await response.json() as { imported?: number; found?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "MyŠkoda-ladehistorikken kunne ikke hentes");
      const refreshed = await fetch("/api/charging", { cache: "no-store" });
      if (!refreshed.ok) throw new Error("Historikken blev gemt, men visningen kunne ikke opdateres");
      setCharging(await refreshed.json() as ChargingState);
      setHistoryImportMessage(data.imported
        ? `${data.imported} nye opladninger blev hentet fra MyŠkoda`
        : data.found
          ? "MyŠkoda-historikken er allerede ajour"
          : "MyŠkoda returnerede ingen afsluttede opladninger for i år");
    } catch (error) {
      setHistoryImportMessage(error instanceof Error ? error.message : "MyŠkoda-ladehistorikken kunne ikke hentes");
    } finally {
      setMySkodaHistorySyncing(false);
    }
  }

  const maxPrice = Math.max(...prices.map((p) => p.value));
  const cheapest = useMemo(() => prices.reduce((a, b) => a.value < b.value ? a : b), [prices]);
  const currentPrice = prices[0]?.value ?? 0;
  const cheapestWindow = useMemo(() => {
    const currentBattery = vehicleState.vehicle?.batteryPercent ?? 64;
    const quartersNeeded = Math.max(1, Math.ceil((59 * Math.max(0, target - currentBattery) / 100 / 0.9) / 11 * 4));
    const usable = prices.filter((point) => {
      if (!point.startsAt) return true;
      const departureDate = new Date(point.startsAt);
      const [hours, minutes] = departure.split(":").map(Number);
      const deadline = new Date(departureDate);
      deadline.setHours(hours, minutes, 0, 0);
      if (deadline <= new Date(point.startsAt)) deadline.setDate(deadline.getDate() + 1);
      return new Date(point.startsAt) < deadline;
    });
    let bestStart = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= usable.length - quartersNeeded; i++) {
      const cost = usable.slice(i, i + quartersNeeded).reduce((sum, p) => sum + p.value, 0);
      if (cost < bestCost) { bestCost = cost; bestStart = i; }
    }
    const window = usable.slice(bestStart, bestStart + quartersNeeded);
    if (!window.length) return { start: "–", end: "–" };
    const start = window[0].label;
    const last = window[window.length - 1];
    const endDate = last.startsAt ? new Date(new Date(last.startsAt).getTime() + 15 * 60 * 1000) : null;
    const end = endDate ? endDate.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }) : last.label;
    return { start, end };
  }, [departure, prices, target, vehicleState.vehicle?.batteryPercent]);

  const today = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" }).format(new Date()).toUpperCase();
  const hour = new Date().getHours();
  const greeting = hour < 10 ? "Godmorgen" : hour < 18 ? "God eftermiddag" : "Godaften";
  const efficiencySource = vehicleState.vehicle?.efficiencySource;
  const history = vehicleState.vehicle?.history;
  const chargeSummary = charging.summary;
  const averageSpotPrice = prices.length ? prices.reduce((sum, point) => sum + point.value, 0) / prices.length : 0.3;
  const automaticHomePriceDkk = Math.max(1.25, Math.min(4, averageSpotPrice + 1.45));
  const automaticChargingEfficiencyPercent = vehicleState.connected && (history?.samples ?? 0) >= 2 ? 91 : 90;
  const homeShare = chargeSummary?.totalKwh ? chargeSummary.homeKwh / chargeSummary.totalKwh * 100 : 0;
  const publicShare = chargeSummary?.totalKwh ? 100 - homeShare : 0;
  const remainingBreakEven = chargeSummary ? Math.max(0, chargeSummary.breakEvenKwh - chargeSummary.totalKwh) : 0;
  const hasImportedHistory = (chargeSummary?.annualSessionCount ?? 0) >= 49 && (chargeSummary?.annualTotalKwh ?? 0) >= 1336.5;
  const comparisonBasis = useMemo(() => {
    const thisYear = charging.sessions.filter((session) => new Date(session.chargedAt).getFullYear() === new Date().getFullYear());
    const monthKeys = [...new Set(thisYear.map((session) => session.chargedAt.slice(0, 7)))].sort();
    const months = monthKeys.length || 1;
    const activeMonth = monthKeys.at(-1) ?? new Date().toISOString().slice(0, 7);
    const periodSessions = comparisonPeriod === "month" ? thisYear.filter((session) => session.chargedAt.slice(0, 7) === activeMonth) : thisYear;
    const annualize = 12 / months;
    const factor = comparisonPeriod === "year" ? annualize : 1;
    const home = periodSessions.filter((session) => session.locationType === "home").reduce((sum, session) => sum + session.energyKwh, 0) * factor;
    const foreign = periodSessions.filter((session) => session.locationType === "public" && FOREIGN_LOCATION.test(session.locationName)).reduce((sum, session) => sum + session.energyKwh, 0) * factor;
    const publicDk = periodSessions.filter((session) => session.locationType === "public" && !FOREIGN_LOCATION.test(session.locationName)).reduce((sum, session) => sum + session.energyKwh, 0) * factor;
    const monthLabel = new Date(`${activeMonth}-01T12:00:00`).toLocaleDateString("da-DK", { month: "long", year: "numeric" });
    return { months, activeMonth, monthLabel, periodMonths: comparisonPeriod === "year" ? 12 : 1, home, publicDk, foreign, total: home + publicDk + foreign };
  }, [charging.sessions, comparisonPeriod]);
  const providerComparisons = useMemo<ProviderComparison[]>(() => {
    const { home, publicDk, foreign, total, periodMonths } = comparisonBasis;
    const safeTotal = Math.max(total, 1);
    const homeCost = home * automaticHomePriceDkk;
    const marketPublicPrice = 3.50;
    const marketForeignPrice = 4.50;
    const plans = [
      { id: "clever", name: "Din Clever One", detail: "Fri opladning ude og hjemme", breakdown: { subscription: cleverMonthlyDkk * periodMonths, home: 0, publicDk: 0, foreign: foreign * 3.75 }, sourceUrl: CLEVER_SOURCE, sourceLabel: "Clever", caveat: "Din abonnementspris. Udland afregnes særskilt; IONITY-prisen for Clever One bruges som rejseestimat.", network: { dk: 5, europe: 4, convenience: 5, own: "Danmarks største ladenetværk · 60.000+ punkter", partners: "IONITY · Aral pulse · E.ON/Clever Drive", countries: ["Tyskland", "Østrig", "Italien"] } },
      { id: "ok", name: "OK · betal pr. kWh", detail: "Uden offentligt abonnement", breakdown: { subscription: 0, home: homeCost, publicDk: publicDk * 3.49, foreign: foreign * marketForeignPrice }, sourceUrl: OK_SOURCE, sourceLabel: "OK", caveat: "OK-appen kan ikke betale i udlandet; rejseprisen er derfor et separat markedsestimat.", network: { dk: 4, europe: 1, convenience: 3, own: "5.600+ offentlige ladepunkter i Danmark", partners: "Dansk roaming i OK-appen", countries: [] } },
      { id: "ionity", name: "IONITY Passport Power", detail: "90 kr./md. + forbrug", breakdown: { subscription: 90 * periodMonths, home: homeCost, publicDk: publicDk * 2.2, foreign: foreign * 3.3 }, sourceUrl: IONITY_SOURCE, sourceLabel: "IONITY", caveat: "Forudsætter, at de offentlige stop kan flyttes til IONITY; udlandsprisen er et automatisk gennemsnit.", network: { dk: 3, europe: 5, convenience: 4, own: "Europæisk motorvejsnet med lynladere", partners: "IONITYs eget netværk", countries: ["Tyskland", "Østrig", "Italien"] } },
      { id: "norlys", name: "Norlys Oplad Ude 15", detail: "250 kWh/md. på egne ladere", breakdown: { subscription: 499 * periodMonths, home: homeCost, publicDk: Math.max(0, publicDk - 250 * periodMonths) * 3.49, foreign: foreign * marketForeignPrice }, sourceUrl: NORLYS_SOURCE, sourceLabel: "Norlys", caveat: "Pakken gælder egne offentlige ladere. Udlandsprisen er et markedsestimat og dækning kontrolleres i appen.", network: { dk: 4, europe: 2, convenience: 4, own: "Stort dansk netværk og samlet app", partners: "Offentlige partnere vises i appen", countries: ["Udvalgte roamingpunkter"] } },
      { id: "eon-lite", name: "E.ON Drive Lite", detail: "0 kr./md. · betal pr. kWh", breakdown: { subscription: 0, home: homeCost, publicDk: publicDk * 3.25, foreign: foreign * marketForeignPrice }, sourceUrl: EON_SOURCE, sourceLabel: "E.ON", caveat: "Dansk DC-pris anvendt. Roamingpriser varierer efter operatør og land.", network: { dk: 4, europe: 4, convenience: 4, own: "E.ON Drive-netværk", partners: "Hubject og europæiske roamingpartnere", countries: ["Tyskland", "Østrig", "Italien"] } },
      { id: "eon-plus", name: "E.ON Drive Plus", detail: "99 kr./md. · lavere kWh-pris", breakdown: { subscription: 99 * periodMonths, home: homeCost, publicDk: publicDk * 2.95, foreign: foreign * marketForeignPrice }, sourceUrl: EON_SOURCE, sourceLabel: "E.ON", caveat: "Dansk DC-pris anvendt. Roamingpriser varierer efter operatør og land.", network: { dk: 4, europe: 4, convenience: 4, own: "E.ON Drive-netværk", partners: "Hubject og europæiske roamingpartnere", countries: ["Tyskland", "Østrig", "Italien"] } },
      { id: "ewii", name: "EWII Opladning", detail: "Betal pr. kWh · Monta-roaming", breakdown: { subscription: 0, home: homeCost, publicDk: publicDk * marketPublicPrice, foreign: foreign * marketForeignPrice }, sourceUrl: EWII_SOURCE, sourceLabel: "EWII", caveat: "Priser varierer pr. operatør og vises i appen; modellen bruger automatisk markedsniveau.", network: { dk: 3, europe: 5, convenience: 4, own: "EWII og Monta-ladere", partners: "Monta · 1,2 mio.+ europæiske ladepunkter", countries: ["Tyskland", "Østrig", "Italien"] } },
      { id: "spirii", name: "Spirii Go", detail: "Uden abonnement · bred roaming", breakdown: { subscription: 0, home: homeCost, publicDk: publicDk * marketPublicPrice, foreign: foreign * marketForeignPrice }, sourceUrl: SPIRII_SOURCE, sourceLabel: "Spirii", caveat: "Operatøren bestemmer prisen; modellen bruger automatisk markedsniveau.", network: { dk: 3, europe: 5, convenience: 4, own: "Spirii-partnernetværk", partners: "Hubject · 1 mio.+ europæiske ladepunkter", countries: ["Tyskland", "Østrig", "Italien"] } },
      { id: "circle-k", name: "Circle K Charge", detail: "Uden abonnement · dagspris", breakdown: { subscription: 0, home: homeCost, publicDk: publicDk * marketPublicPrice, foreign: foreign * marketForeignPrice }, sourceUrl: CIRCLE_K_SOURCE, sourceLabel: "Circle K", caveat: "Dagsprisen varierer; automatisk markedsniveau anvendes. Appen virker i Danmark, Sverige og Norge.", network: { dk: 3, europe: 2, convenience: 4, own: "Knap 750 danske lynladepladser", partners: "Circle K Charge i Norden", countries: [] } },
      { id: "tesla", name: "Tesla Supercharger", detail: "Åbne stationer for andre bilmærker", breakdown: { subscription: 0, home: homeCost, publicDk: publicDk * marketPublicPrice, foreign: foreign * 3.95 }, sourceUrl: TESLA_SOURCE, sourceLabel: "Tesla", caveat: "Kun Superchargere åbne for andre bilmærker tæller. Pris og spidsbelastning varierer i Tesla-appen.", network: { dk: 3, europe: 5, convenience: 3, own: "80.000+ Superchargere globalt", partners: "Teslas eget netværk · udvalgte åbne lokationer", countries: ["Tyskland", "Østrig", "Italien"] } },
      { id: "q8", name: "Q8 Opladning", detail: "Uden abonnement", breakdown: { subscription: 0, home: homeCost, publicDk: publicDk * 3.75, foreign: foreign * marketForeignPrice }, sourceUrl: Q8_SOURCE, sourceLabel: "Q8", caveat: "Vejledende AC-pris anvendt; lyn- og roamingpriser kan afvige.", network: { dk: 2, europe: 2, convenience: 3, own: "Q8-ladere i Danmark", partners: "Varierer i appen", countries: ["Udvalgte roamingpunkter"] } },
      ...customProviders.map((provider) => ({ id: provider.id, name: provider.name, detail: "Brugerdefineret scenarie", breakdown: { subscription: provider.monthlyFee * periodMonths, home: homeCost, publicDk: publicDk * provider.publicDkPrice, foreign: foreign * provider.foreignPrice }, sourceUrl: "", sourceLabel: "Din pris", caveat: `Din indtastede pris: ${formatNumber(provider.publicDkPrice, 2)} kr./kWh i Danmark og ${formatNumber(provider.foreignPrice, 2)} kr./kWh i udlandet.`, network: { dk: 3, europe: 3, convenience: 3, own: "Ikke vurderet", partners: "Brugerdefineret", countries: [] }, isCustom: true })),
    ];
    const costed = plans.map((plan) => {
      const totalCost = Object.values(plan.breakdown).reduce((sum, value) => sum + value, 0);
      return { ...plan, totalCost, equivalentMonthlyCost: totalCost / periodMonths, effectivePrice: totalCost / safeTotal };
    });
    const lowestCost = Math.min(...costed.map((plan) => plan.totalCost));
    return costed.map((plan) => ({
      ...plan,
      matchScore: calculateProviderMatchScore(lowestCost, plan.totalCost, plan.network),
    })).sort((a, b) => a.totalCost - b.totalCost);
  }, [automaticHomePriceDkk, cleverMonthlyDkk, comparisonBasis, customProviders]);
  const cleverComparison = providerComparisons.find((plan) => plan.id === "clever");
  const cheapestProvider = providerComparisons[0];
  const highestProviderCost = Math.max(...providerComparisons.map((plan) => plan.totalCost), 1);
  const bestOverallProvider = providerComparisons.reduce((best, plan) => plan.matchScore > best.matchScore ? plan : best, providerComparisons[0]);
  const bestAlternative = providerComparisons.find((plan) => plan.id !== "clever");
  const cleverAdvantage = (bestAlternative?.totalCost ?? 0) - (cleverComparison?.totalCost ?? 0);
  const estimatedBatteryEnergy = comparisonBasis.total * automaticChargingEfficiencyPercent / 100;
  const estimatedChargingLoss = Math.max(0, comparisonBasis.total - estimatedBatteryEnergy);
  const currentBattery = vehicleState.vehicle?.batteryPercent ?? 64;
  const requiredChargeKwh = Math.max(0, 59 * (target - currentBattery) / 100 / (automaticChargingEfficiencyPercent / 100));
  const chargeWindowPrice = prices.length ? prices.slice(0, Math.max(1, Math.ceil(requiredChargeKwh / 11 * 4))).reduce((sum, point) => sum + point.value, 0) / Math.max(1, Math.ceil(requiredChargeKwh / 11 * 4)) : 0;
  const estimatedChargeCost = requiredChargeKwh * chargeWindowPrice;
  const efficiencyKmPerKwh = vehicleState.vehicle?.efficiencyKmPerKwh ?? 5.46;
  const tripEnergyKwh = tripDistanceKm / Math.max(efficiencyKmPerKwh, 0.1) / (automaticChargingEfficiencyPercent / 100);
  const tripPriceDkk = 3.75;
  const tripCostDkk = tripEnergyKwh * tripPriceDkk;
  const firstLegEnergy = 59 * Math.max(0, currentBattery - 15) / 100;
  const tripStops = Math.max(0, Math.ceil(Math.max(0, tripEnergyKwh - firstLegEnergy) / (59 * 0.65)));
  const budgetUse = Math.min(100, (cheapestProvider?.equivalentMonthlyCost ?? 0) / Math.max(cleverMonthlyDkk, 1) * 100);
  const summerSessions = charging.sessions.filter((session) => [4, 5, 6, 7, 8, 9].includes(new Date(session.chargedAt).getMonth() + 1));
  const winterSessions = charging.sessions.filter((session) => [10, 11, 12, 1, 2, 3].includes(new Date(session.chargedAt).getMonth() + 1));
  const averageSession = (sessions: ChargingSession[]) => sessions.length ? sessions.reduce((sum, session) => sum + session.energyKwh, 0) / sessions.length : null;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Elroq Ladeoverblik"><span className="brand-mark"><Icon name="bolt" /></span><span>Elroq<span className="brand-light">blik</span></span></a>
        <nav className="desktop-nav" aria-label="Primær navigation">
          {([['overblik', 'Overblik'], ['ladning', 'Opladning'], ['oekonomi', 'Økonomi'], ['bil', 'Bil']] as [Tab,string][]).map(([id,label]) => <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)} className={tab === id ? "active" : ""}>{label}</button>)}
        </nav>
        <div className="profile" aria-label="Nicolaj er logget ind"><span>NB</span><span className="status-dot" /></div>
      </header>

      <div className="page" id="top">
        <section className="welcome"><div><p className="eyebrow">{today}</p><h1>{greeting}, Nicolaj</h1><p className="subline">Elpriser leveres af Energinet. {vehicleState.connected && vehicleState.vehicle?.dataComplete ? "Bildata hentes direkte fra din bil." : vehicleState.connected ? "Bilforbindelsen er aktiv; datatilladelser afventer." : "Bildata er fortsat demo."}</p></div><div className={`demo-pill ${priceState === "live" ? "live-data" : ""}`}><span /> {priceState === "live" ? "LIVE PRISER" : priceState === "loading" ? "HENTER PRISER" : "PRIS-DEMO"}</div></section>
        {priceAlerts && tab === "overblik" && <div className="price-watch-banner"><span>●</span><div><strong>Prisoverblikket er gemt</strong><p>Bedste fundne ladevindue er {cheapestWindow.start}–{cheapestWindow.end}. Du ser den opdaterede anbefaling, når dashboardet åbnes.</p></div><button onClick={togglePriceAlerts}>Slå fra</button></div>}

        {tab === "overblik" && <>
          <section className="hero-grid">
            <article className="vehicle-card">
              <div className="vehicle-head"><div><span className={`live ${vehicleState.connected ? "" : "demo"}`}><i /> {vehicleState.connected ? "LIVE BILDATA" : "DEMO"}</span><h2>{vehicleState.vehicle?.model ? `${vehicleState.vehicle.make ?? "Škoda"} ${vehicleState.vehicle.model}` : "Škoda Elroq 60"}</h2><p>{vehicleState.connected ? `Sidst opdateret ${vehicleState.updatedAt ? new Date(vehicleState.updatedAt).toLocaleTimeString("da-DK", {hour:"2-digit", minute:"2-digit"}) : "nu"}` : "Klar til sikker forbindelse"}</p></div><button className="car-badge" onClick={() => setTab("bil")} aria-label="Åbn bilforbindelse"><Icon name="car" /></button></div>
              <div className="battery-area"><div className="battery-ring" style={{background: `conic-gradient(var(--green) ${vehicleState.vehicle?.batteryPercent ?? (vehicleState.connected ? 0 : 64)}%,#dfe9e4 0)`}}><div><strong>{vehicleState.connected && vehicleState.vehicle?.batteryPercent == null ? "–" : Math.round(vehicleState.vehicle?.batteryPercent ?? 64)}<span>{vehicleState.connected && vehicleState.vehicle?.batteryPercent == null ? "" : "%"}</span></strong><small>Batteri</small></div></div><div className="range-copy"><span>Forventet rækkevidde</span><strong>{vehicleState.connected && vehicleState.vehicle?.rangeKm == null ? "–" : Math.round(vehicleState.vehicle?.rangeKm ?? 287)} <small>{vehicleState.connected && vehicleState.vehicle?.rangeKm == null ? "" : "km"}</small></strong><p>{vehicleState.connected && vehicleState.vehicle?.dataComplete ? `Hentet fra ${vehicleState.provider === "myskoda" ? "MyŠkoda" : "bilen"}` : vehicleState.connected ? "Nogle bildata mangler" : "Baseret på demoforbrug"}</p></div></div>
              <div className="vehicle-stats"><div><span>Forbrug</span><strong>{vehicleState.vehicle?.consumptionKwhPer100Km == null ? (vehicleState.connected ? "Indsamler" : "18,3") : vehicleState.vehicle.consumptionKwhPer100Km.toFixed(1).replace(".", ",")} <small>{vehicleState.connected && vehicleState.vehicle?.consumptionKwhPer100Km == null ? "kørselshistorik" : "kWh/100 km"}</small></strong></div><div><span>Effektivitet</span><strong>{vehicleState.vehicle?.efficiencyKmPerKwh == null ? (vehicleState.connected ? "Indsamler" : "5,46") : vehicleState.vehicle.efficiencyKmPerKwh.toFixed(2).replace(".", ",")} <small>{vehicleState.connected && vehicleState.vehicle?.efficiencyKmPerKwh == null ? "målinger" : efficiencySource === "estimated_history" ? "km/kWh · estimat" : "km/kWh"}</small></strong></div><div><span>Kilometerstand</span><strong>{vehicleState.vehicle?.odometerKm ? Math.round(vehicleState.vehicle.odometerKm).toLocaleString("da-DK") : "–"} <small>km</small></strong></div></div>
            </article>

            <article className="plan-card">
              <div className="section-title"><div><p className="eyebrow">NÆSTE OPLADNING</p><h2>Billigst i nat</h2></div><span className="moon">☾</span></div>
              <div className="time-window"><div><span>Bedste ladevindue</span><strong>{cheapestWindow.start}–{cheapestWindow.end}</strong></div><div className="save">{priceState === "live" ? "BEREGNET LIVE" : "PRIS-ESTIMAT"}</div></div>
              <div className="charge-forecast"><span>Forventet behov <strong>{formatNumber(requiredChargeKwh, 1)} kWh</strong></span><span>Estimeret elpris <strong>{formatCurrency(estimatedChargeCost)}</strong></span></div>
              <div className="plan-row"><label>Afgang<input aria-label="Afgangstid" type="time" value={departure} onChange={e => setDeparture(e.target.value)} /></label><label>Mål<select aria-label="Lademål" value={target} onChange={e => setTarget(Number(e.target.value))}><option>70</option><option>80</option><option>90</option><option>100</option></select><b>%</b></label></div>
              <button className={planned ? "primary planned" : "primary"} onClick={togglePlanned}>{planned ? "✓ Ladeforslag gemt" : "Gem dette ladeforslag"}</button>
              <button className={`alert-toggle ${priceAlerts ? "active" : ""}`} onClick={togglePriceAlerts}>{priceAlerts ? "● Prisoverblik gemt" : "○ Gem prisoverblik i appen"}</button>
              <p className="fine"><Icon name="leaf" /> Laveste pris og CO₂-aftryk prioriteres</p>
            </article>
          </section>

          <section className="metrics"><article><div className="metric-icon green"><Icon name="bolt" /></div><div><span>Opladet denne måned</span><strong>{chargeSummary ? formatNumber(chargeSummary.totalKwh, 1) : "–"} <small>{chargeSummary && "kWh"}</small></strong><em>{chargeSummary?.sessionCount ?? 0} registrerede opladninger</em></div></article><article><div className="metric-icon blue"><Icon name="car" /></div><div><span>Målt kørsel</span><strong>{history?.distanceKm == null ? "Afventer" : Math.round(history.distanceKm).toLocaleString("da-DK")} {history?.distanceKm != null && <small>km</small>}</strong><em>{history?.status === "estimated" ? "grundlag for forbrugsestimat" : "opdater efter næste køretur"}</em></div></article><article><div className="metric-icon amber"><Icon name="wallet" /></div><div><span>Effektiv abonnementspris</span><strong>{chargeSummary?.effectivePricePerKwh == null ? "Afventer" : formatCurrency(chargeSummary.effectivePricePerKwh)} <small>{chargeSummary?.effectivePricePerKwh != null && "/kWh"}</small></strong><em>beregnet ud fra Clever One</em></div></article></section>

          <section className="content-grid">
            <article className="price-card panel"><div className="section-title"><div><p className="eyebrow">LIVE SPOTPRIS · DK1</p><h2>De næste 12 timer</h2></div><div className="now-price"><span>Lige nu</span><strong>{currentPrice.toFixed(2).replace('.', ',')} kr.</strong></div></div><div className="chart" aria-label="Elprisgraf for de næste 12 timer">{prices.map((p, i) => <div className="bar-wrap" key={`${p.time}-${i}`}><div className={`bar ${p.value === cheapest.value ? "best" : ""}`} style={{height: `${Math.max(18, (p.value/Math.max(maxPrice, .01))*118)}px`}}><span>{p.value === cheapest.value ? "Billigst" : p.value.toFixed(2).replace('.', ',')}</span></div><small>{p.label.endsWith(":00") ? p.label.slice(0,2) : ""}</small>{i > 0 && p.label === "00:00" && <i className="midnight" />}</div>)}</div><div className="chart-foot"><span><i className="dot green-dot" /> {cheapest.value.toFixed(2).replace('.', ',')} kr./kWh kl. {cheapest.label}</span><span>{priceState === "live" ? `Rå spotpris · opdateret ${new Date(updatedAt).toLocaleTimeString("da-DK", {hour:"2-digit",minute:"2-digit"})}` : "Rå spotpris · reservetal"}</span></div></article>
            <article className="economy-card panel"><div className="section-title"><div><p className="eyebrow">{chargeSummary?.month?.toUpperCase() ?? "DENNE MÅNED"}</p><h2>Dit laderegnskab</h2></div><button className="round-btn" onClick={() => setTab("oekonomi")} aria-label="Se økonomi"><Icon name="arrow" /></button></div><div className="account-row"><span>Clever One</span><strong>{formatCurrency(chargeSummary?.subscriptionDkk ?? 799)}</strong></div><div className="account-row"><span>Registreret strøm</span><strong>{formatNumber(chargeSummary?.totalKwh ?? 0, 1)} kWh</strong></div><div className="account-row benefit"><span>Sammenligningsværdi</span><strong>{formatCurrency(chargeSummary?.comparisonValueDkk ?? 0)}</strong></div><div className="account-total"><span>Effektiv pris</span><strong>{chargeSummary?.effectivePricePerKwh == null ? "–" : formatCurrency(chargeSummary.effectivePricePerKwh)}<small>/kWh</small></strong></div><div className="break-even"><div><span style={{width: `${Math.min(100, chargeSummary?.totalKwh ? chargeSummary.totalKwh / chargeSummary.breakEvenKwh * 100 : 0)}%`}} /></div><p><strong>{formatNumber(remainingBreakEven, 1)} kWh til break-even</strong><span>ved {formatCurrency(chargeSummary?.comparisonPricePerKwh ?? 3.49)}/kWh</span></p></div></article>
          </section>

          <section className="recent"><div className="section-title"><div><p className="eyebrow">KØRSELSHISTORIK</p><h2>{history?.status === "estimated" ? "Dit beregnede forbrug" : "Indsamling er startet"}</h2></div><button className="text-btn" onClick={() => setTab("bil")}>Se bildata <Icon name="arrow" /></button></div><div className="history-message"><span className="history-icon">↗</span><div><strong>{history?.status === "estimated" ? `${vehicleState.vehicle?.efficiencyKmPerKwh?.toFixed(2).replace(".", ",")} km/kWh` : "Kør en tur og hent derefter friske bildata"}</strong><p>{history?.status === "estimated" ? "Estimatet beregnes ud fra ændringen i kilometerstand og batteriprocent. Faktiske lade-kWh fra Clever vil senere gøre tallet mere præcist." : "Ladeoverblikket har gemt den første måling. Når kilometerstanden og batteriet ændrer sig, kan vi begynde at beregne dit forbrug."}</p></div></div></section>
        </>}

        {tab === "ladning" && vehicleState.connected && vehicleState.provider === "myskoda" && <div className="history-import myskoda-import"><div className="history-import-icon"><Icon name="car" /></div><div><p className="eyebrow">MYŠKODA · AUTOMATISK</p><h2>Hent bilens ladehistorik</h2><p>Synkroniseres automatisk kl. 05 og 23. AC registreres foreløbigt som formodet hjemme; DC som offentlig opladning.</p></div><button className="connect-button" onClick={syncMySkodaChargingHistory} disabled={mySkodaHistorySyncing}>{mySkodaHistorySyncing ? "Henter…" : "Synkronisér nu"}</button></div>}

        {tab === "ladning" && <section className="tab-page"><div className="section-title"><div><p className="eyebrow">CLEVER-REGNSKAB</p><h1>Dine opladninger</h1><p className="subline">Registrér kWh fra Clever-appen. Tallene gemmes sikkert og bruges i dit regnskab.</p></div><button className="primary small" onClick={() => setShowChargeForm(!showChargeForm)}><Icon name="plus" /> {showChargeForm ? "Luk" : "Tilføj opladning"}</button></div>{!hasImportedHistory && <div className="history-import"><div className="history-import-icon"><Icon name="bolt" /></div><div><p className="eyebrow">CLEVER-HISTORIK FUNDET</p><h2>Indlæs hele årsoversigten</h2><p>49 opladninger · 1.336,6 kWh · 25. april–16. august. Din hjemmeadresse vises kun som “Hjemme”.</p></div><button className="connect-button" onClick={importCleverHistory} disabled={historyImporting}>{historyImporting ? "Indlæser…" : "Indlæs historikken"}</button></div>}{historyImportMessage && <div className={`import-message ${historyImportMessage.includes("kunne ikke") ? "error" : ""}`}>{historyImportMessage}</div>}{showChargeForm && <form className="charge-form" onSubmit={saveChargingSession}><label>Dato og tid<input required type="datetime-local" value={chargeDate} onChange={event => setChargeDate(event.target.value)} /></label><label>Energi<input required inputMode="decimal" value={chargeKwh} onChange={event => setChargeKwh(event.target.value)} placeholder="fx 31,4" /><b>kWh</b></label><label>Sted<select value={chargeType} onChange={event => setChargeType(event.target.value as "home" | "public")}><option value="home">Hjemme</option><option value="public">Offentlig lader</option></select></label><label>Navn <small>(valgfrit)</small><input value={chargePlace} onChange={event => setChargePlace(event.target.value)} placeholder={chargeType === "home" ? "Hjemme" : "fx Clever Aarhus N"} /></label><button className="connect-button" disabled={chargeSaving}>{chargeSaving ? "Gemmer…" : "Gem opladning"}</button>{chargeError && <div className="form-error">{chargeError}</div>}</form>}<div className="summary-strip"><div><span>Denne måned</span><strong>{formatNumber(chargeSummary?.totalKwh ?? 0, 1)} kWh</strong></div><div><span>Hjemme</span><strong>{formatNumber(homeShare, 0)} %</strong></div><div><span>Offentligt</span><strong>{formatNumber(publicShare, 0)} %</strong></div><div><span>År i alt</span><strong>{formatNumber(chargeSummary?.annualTotalKwh ?? 0, 2)} kWh</strong></div></div>{charging.sessions.length ? <div className="session-list large">{charging.sessions.map((session) => <Session s={session} onDelete={() => removeChargingSession(session.id)} key={session.id} />)}</div> : <div className="empty-state"><span>ϟ</span><h2>Ingen opladninger endnu</h2><p>Indlæs årsoversigten ovenfor, eller tilføj en opladning manuelt.</p><button className="secondary" onClick={importCleverHistory} disabled={historyImporting}>Indlæs 49 opladninger</button></div>}<div className="notice">ⓘ Clever tilbyder ikke en offentlig privatkunde-API. Historikken er aflæst fra dine skærmbilleder og kan indlæses uden at dele dit Clever-login.</div></section>}

        {tab === "oekonomi" && <section className="tab-page">
          <div className="economy-heading"><div><p className="eyebrow">ØKONOMI · UDBYDERSAMMENLIGNING</p><h1>Hvilken ladeløsning er billigst?</h1><p className="subline">Sammenlign din faktiske måned eller se en årsprognose baseret på din ladehistorik.</p></div><div className="period-switch" aria-label="Vælg beregningsperiode"><button className={comparisonPeriod === "month" ? "active" : ""} onClick={() => setComparisonPeriod("month")}>Denne måned</button><button className={comparisonPeriod === "year" ? "active" : ""} onClick={() => setComparisonPeriod("year")}>Årsprognose</button></div></div>
          {comparisonBasis.total > 0 ? <>
            <div className="provider-hero">
              <div><span>BEDSTE SAMLEDE MATCH</span><h2>{bestOverallProvider?.name}</h2><strong>{bestOverallProvider?.matchScore ?? 0}<small>/100</small></strong><p>Pris vægter 55 %, dansk netværk 20 %, Europa 15 % og brugervenlighed 10 %. Billigst alene er {cheapestProvider?.name} til {formatCurrency(cheapestProvider?.equivalentMonthlyCost ?? 0)}/md.</p></div>
              <div className="basis-card"><span>BEREGNINGSGRUNDLAG</span><strong>{formatNumber(comparisonBasis.total, 0)} kWh/{comparisonPeriod === "month" ? "md." : "år"}</strong><p>{formatNumber(comparisonBasis.home, 0)} hjemme · {formatNumber(comparisonBasis.publicDk, 0)} offentligt DK · {formatNumber(comparisonBasis.foreign, 0)} udland</p><small>{comparisonPeriod === "month" ? `Faktisk registreret i ${comparisonBasis.monthLabel} indtil nu` : `${comparisonBasis.months} registrerede kalendermåneder er fremskrevet til 12 måneder`}</small></div>
            </div>
            <div className="automation-bar"><div><span>✓ AUTOMATISK</span><strong>Forbrug fra ladehistorikken</strong><small>{formatNumber(comparisonBasis.total, 1)} kWh i beregningen</small></div><div><span>✓ LIVE + ESTIMAT</span><strong>Hjemmepris {formatCurrency(automaticHomePriceDkk)}/kWh</strong><small>Spotpris plus automatisk net-, tarif- og afgiftsestimat</small></div><div><span>✓ AUTOMATISK</span><strong>Ladeeffektivitet {automaticChargingEfficiencyPercent} %</strong><small>{vehicleState.connected ? "Tilpasset bilens målehistorik" : "Modelestimat indtil flere bilmålinger"}</small></div></div>
            <section className="cost-chart panel" aria-labelledby="cost-chart-title">
              <div className="cost-chart-head"><div><p className="eyebrow">SAMMENSAT {comparisonPeriod === "month" ? "MÅNEDSPRIS" : "ÅRSPRIS"}</p><h2 id="cost-chart-title">Hvad består prisen af?</h2></div><p>Samme ladebehov, opdelt efter hvor pengene bruges.</p></div>
              <div className="cost-legend" aria-label="Forklaring"><span><i className="subscription" /> Abonnement</span><span><i className="home" /> Hjemme</span><span><i className="public" /> Offentligt DK</span><span><i className="foreign" /> Udland</span></div>
              <div className="cost-chart-rows">{providerComparisons.map((plan) => <div className="cost-chart-row" key={`chart-${plan.id}`}>
                <strong>{plan.name}</strong>
                <div className="cost-track" role="img" aria-label={`${plan.name}: ${formatCurrency(plan.totalCost)} ${comparisonPeriod === "month" ? "denne måned" : "om året"}`}>
                  {(Object.entries(plan.breakdown) as [keyof ProviderComparison["breakdown"], number][]).map(([part, value]) => value > 0 && <span key={part} className={`cost-segment ${part}`} style={{width: `${value / highestProviderCost * 100}%`}} title={`${part === "subscription" ? "Abonnement" : part === "home" ? "Hjemme" : part === "publicDk" ? "Offentligt DK" : "Udland"}: ${formatCurrency(value)}`} />)}
                </div>
                <b>{formatCurrency(plan.totalCost)}</b>
              </div>)}</div>
            </section>
            <section className="network-comparison panel">
              <div className="cost-chart-head"><div><p className="eyebrow">NETVÆRK · DANMARK OG EUROPA</p><h2>Hvor fleksibel er ladeløsningen?</h2></div><p>Bløde værdier indgår nu i den samlede anbefaling.</p></div>
              <div className="network-table" role="table" aria-label="Sammenligning af ladenetværk">
                {providerComparisons.filter((plan) => !plan.isCustom).map((plan) => <div className={`network-row ${plan.id === bestOverallProvider?.id ? "recommended" : ""}`} role="row" key={`network-${plan.id}`}>
                  <div><strong>{plan.name}</strong><small>{plan.network.own}</small></div>
                  <div><span>Danmark</span><b>{"●".repeat(plan.network.dk)}{"○".repeat(5 - plan.network.dk)}</b></div>
                  <div><span>Europa</span><b>{"●".repeat(plan.network.europe)}{"○".repeat(5 - plan.network.europe)}</b></div>
                  <div><span>Rejser</span><b>{plan.network.countries.length ? plan.network.countries.join(" · ") : "Kræver anden app"}</b><small>{plan.network.partners}</small></div>
                  <em>{plan.matchScore}/100</em>
                </div>)}
              </div>
              <div className="notice">ⓘ Dækningen vurderes ud fra dokumenteret eget netværk, roamingpartnere og adgang i Tyskland, Østrig og Italien. Den konkrete station og pris skal altid kontrolleres i udbyderens app.</div>
            </section>
            <section className="custom-provider panel">
              <div className="custom-provider-head"><div><p className="eyebrow">FLERE LADESELSKABER</p><h2>Tilføj en pris fra en app</h2><p>Tesla, Uno-X og Circle K bruger stations- eller dagspriser. Tilføj den pris, du ser lige nu, eller brug dit gennemsnit.</p></div><button className="secondary" onClick={() => prepareCustomProvider()}><Icon name="plus" /> Tilføj udbyder</button></div>
              <div className="provider-presets"><span>Hurtigvalg:</span>{["Tesla Supercharger", "Uno-X", "Circle K Charge", "Allego"].map((name) => <button key={name} onClick={() => prepareCustomProvider(name)}>+ {name}</button>)}</div>
              {showCustomProvider && <form className="custom-provider-form" onSubmit={addCustomProvider}><label>Udbyder<input required value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="fx Tesla Supercharger" /></label><label>Abonnement pr. md.<input inputMode="decimal" value={customMonthlyFee} onChange={(event) => setCustomMonthlyFee(event.target.value)} /><b>kr.</b></label><label>Offentlig pris i DK<input inputMode="decimal" value={customPublicPrice} onChange={(event) => setCustomPublicPrice(event.target.value)} /><b>kr./kWh</b></label><label>Pris i udlandet<input inputMode="decimal" value={customForeignPrice} onChange={(event) => setCustomForeignPrice(event.target.value)} /><b>kr./kWh</b></label><button className="connect-button">Gem scenarie</button><button type="button" className="text-btn" onClick={() => setShowCustomProvider(false)}>Annuller</button></form>}
            </section>
            <div className="provider-list">{providerComparisons.map((plan, index) => {
              const difference = plan.totalCost - (cleverComparison?.totalCost ?? 0);
              return <article className={`provider-card ${index === 0 ? "winner" : ""}`} key={plan.id}>
                <div className="provider-rank">{index === 0 ? "✓" : index + 1}</div>
                <div className="provider-name"><div>{index === 0 && <span className="best-label">BILLIGST</span>}{plan.id === bestOverallProvider?.id && <span className="match-label">BEDSTE SAMLEDE MATCH</span>}<h2>{plan.name}</h2><p>{plan.detail}</p></div>{plan.sourceUrl ? <a href={plan.sourceUrl} target="_blank" rel="noreferrer">Kilde: {plan.sourceLabel} ↗</a> : <span className="custom-label">DIT SCENARIE</span>}</div>
                <div className="provider-price"><strong>{formatCurrency(plan.equivalentMonthlyCost)}</strong><span>{comparisonPeriod === "month" ? "denne måned" : "pr. måned"}</span><b>{formatCurrency(plan.totalCost)} / {comparisonPeriod === "month" ? "måned" : "år"}</b></div>
                <div className={`provider-difference ${difference <= 0 ? "saving" : "extra"}`}>{plan.id === "clever" ? "Din nuværende løsning" : difference < 0 ? `${formatCurrency(Math.abs(difference))} billigere` : `${formatCurrency(difference)} dyrere`}</div>
                <div className="provider-detail"><span>{formatCurrency(plan.effectivePrice)}/kWh · match {plan.matchScore}/100</span><small>{plan.caveat} Netværk: {plan.network.partners}.</small>{plan.isCustom && <button className="remove-custom" onClick={() => storeCustomProviders(customProviders.filter((provider) => provider.id !== plan.id))}>Fjern</button>}</div>
              </article>;
            })}</div>
            <div className="panel explanation"><h2>Sådan skal resultatet læses</h2><p>Sammenligningen tager dine registrerede kWh og fordeler dem mellem hjemmeopladning, danske offentlige ladere og dine kendte udlandsstop. Vælg “Denne måned” for dit faktiske registrerede forbrug eller “Årsprognose” for et normaliseret år.</p><div className="notice">ⓘ Netværk, roaming og standardpriser er kontrolleret 18. august 2026. Dynamiske stationspriser hos blandt andre Tesla og Circle K beregnes automatisk med et synligt markedsestimat.</div></div>
            <section className="insight-section">
              <div className="section-title"><div><p className="eyebrow">PERSONLIGE INDSIGTER</p><h2>Dit abonnement, budget og ladetab</h2></div></div>
              <div className="insight-grid">
                <article className="insight-card"><span className="insight-icon">↔</span><p>CLEVER-TJEK</p><h3>{cleverAdvantage >= 0 ? `Clever sparer ${formatCurrency(cleverAdvantage)}` : `${bestAlternative?.name} er ${formatCurrency(Math.abs(cleverAdvantage))} billigere`}</h3><small>{comparisonPeriod === "month" ? "Baseret på den valgte måned" : "Baseret på årsprognosen"}</small></article>
                <article className="insight-card"><span className="insight-icon">≈</span><p>LADETAB · AUTOMATISK ESTIMAT</p><h3>{formatNumber(estimatedChargingLoss, 1)} kWh · {formatNumber(100 - automaticChargingEfficiencyPercent, 0)} %</h3><small>Beregnet uden manuel indtastning ud fra {automaticChargingEfficiencyPercent} % ladeeffektivitet og dine registrerede kWh.</small></article>
                <article className="insight-card budget-card"><span className="insight-icon">◫</span><p>AUTOMATISK PRISRAMME</p><h3>{formatCurrency(cheapestProvider?.equivalentMonthlyCost ?? 0)} mod Clever {formatCurrency(cleverMonthlyDkk)}</h3><div className="budget-track"><span style={{width: `${budgetUse}%`}} /></div><small>Opdateres automatisk, når ladehistorik, elpris eller udbydergrundlag ændres.</small></article>
                <article className="insight-card"><span className="insight-icon">✓</span><p>DATAGRUNDLAG</p><h3>{charging.sessions.length} ladeposter · {history?.samples ?? 0} bilmålinger</h3><small>{vehicleState.connected ? "Live bildata er forbundet" : "Bildata er demo; ladehistorikken er målt"}</small></article>
              </div>
            </section>

            <section className="tool-grid">
              <article className="panel trip-tool"><div><p className="eyebrow">TURENS LADEBUDGET</p><h2>Hvad koster næste køretur?</h2><p>Bilens effektivitet, ladetab og rejsepris hentes automatisk. Kun turens længde skal angives.</p></div><div className="trip-inputs single"><label>Afstand<input type="number" min="1" value={tripDistanceKm} onChange={(event) => setTripDistanceKm(Math.max(1, Number(event.target.value) || 1))} /><b>km</b></label><div className="auto-value"><span>AUTOMATISK REJSEPRIS</span><strong>{formatCurrency(tripPriceDkk)}/kWh</strong></div></div><div className="trip-result"><div><span>Forventet energi</span><strong>{formatNumber(tripEnergyKwh, 1)} kWh</strong></div><div><span>Forventet pris</span><strong>{formatCurrency(tripCostDkk)}</strong></div><div><span>Ladestop</span><strong>ca. {tripStops}</strong></div></div><small>Rute, vejr, hastighed og temperatur kan ændre resultatet.</small></article>
              <article className="panel report-tool"><p className="eyebrow">MÅNEDSRAPPORT</p><h2>Gem eller del dit regnskab</h2><p>Rapporten indeholder alle registrerede opladninger, kWh og placeringstype.</p><div className="report-actions"><button className="connect-button" onClick={exportMonthlyReport}>Hent CSV</button><button className="secondary" onClick={() => window.print()}>Gem som PDF</button></div><small>PDF åbner telefonens eller computerens normale udskriftsdialog.</small></article>
            </section>

            <section className="panel season-quality">
              <div><p className="eyebrow">SÆSONANALYSE</p><h2>Sommer mod vinter</h2><div className="season-bars"><div><span>Sommer</span><strong>{averageSession(summerSessions) == null ? "Afventer" : `${formatNumber(averageSession(summerSessions)!, 1)} kWh pr. opladning`}</strong><i><b style={{width: `${Math.min(100, (averageSession(summerSessions) ?? 0) / 60 * 100)}%`}} /></i></div><div><span>Vinter</span><strong>{averageSession(winterSessions) == null ? "Afventer vinterdata" : `${formatNumber(averageSession(winterSessions)!, 1)} kWh pr. opladning`}</strong><i><b style={{width: `${Math.min(100, (averageSession(winterSessions) ?? 0) / 60 * 100)}%`}} /></i></div></div><small>Når der er nok køredata fra begge sæsoner, sammenligner appen også kWh/100 km og rækkeviddetab.</small></div>
              <div className="quality-list"><p className="eyebrow">PRIS- OG DATAKVALITET</p><ul><li><span className="quality measured">MÅLT</span>Clever-ladehistorik</li><li><span className={priceState === "live" ? "quality live" : "quality estimate"}>{priceState === "live" ? "LIVE" : "ESTIMAT"}</span>Energinet-elpris</li><li><span className="quality checked">KONTROLLERET</span>Netværk og roaming · 18. aug. 2026</li><li><span className="quality estimate">AUTO-ESTIMAT</span>Ladetab og dynamiske stationspriser</li></ul></div>
            </section>
          </> : <div className="empty-state"><span>ϟ</span><h2>Indlæs ladehistorikken først</h2><p>Når opladningerne ligger under Opladning, kan vi sammenligne udbyderne ud fra dit reelle forbrug.</p><button className="secondary" onClick={() => setTab("ladning")}>Gå til Opladning</button></div>}
        </section>}

        {tab === "bil" && <section className="tab-page vehicle-connect-page">
          <div><p className="eyebrow">BILFORBINDELSE</p><h1>Forbind din Škoda Elroq gratis</h1><p className="subline">Skrivebeskyttet adgang via din private Elroqblik Worker og MyŠkoda — uden Smartcar-abonnement og uden en Windows-pc.</p></div>
          <div className="connect-layout">
            <article className="connect-card">
              <div className={`connection-orb ${vehicleState.provider === "myskoda" && vehicleState.connected ? "connected" : ""}`}><Icon name="car" /></div>
              <div>
                {vehicleState.provider === "myskoda" && vehicleState.connected ? <>
                  <p className="eyebrow">{vehicleState.stale ? "MYŠKODA · SENEST GEMTE DATA" : "MYŠKODA · LIVE DATA"}</p><h2>Din Elroq er stadig forbundet</h2>
                  <p>Dashboardet henter batteri, rækkevidde og kilometerstand direkte fra MyŠkoda og gemmer målepunkter, så dit kørselsforbrug kan beregnes over tid.</p>
                  {(vehicleState.stale || vehicleLoadError) && <div className="connection-warning" role="status"><strong>Forbindelsen er gemt</strong>{vehicleLoadError || "MyŠkoda kunne ikke opdateres lige nu. De senest gemte bildata vises."}</div>}
                  <div className="connected-details"><span>Batteri <strong>{vehicleState.vehicle?.batteryPercent == null ? "Ikke tilgængelig" : `${Math.round(vehicleState.vehicle.batteryPercent)} %`}</strong></span><span>Rækkevidde <strong>{vehicleState.vehicle?.rangeKm == null ? "Ikke tilgængelig" : `${Math.round(vehicleState.vehicle.rangeKm)} km`}</strong></span><span>Kilometerstand <strong>{vehicleState.vehicle?.odometerKm == null ? "Ikke tilgængelig" : `${Math.round(vehicleState.vehicle.odometerKm).toLocaleString("da-DK")} km`}</strong></span></div>
                  <div className="connection-actions"><button className="secondary" type="button" onClick={refreshVehicle} disabled={vehicleLoading}>{vehicleLoading ? "Henter…" : "Hent friske bildata"}</button><span className="snapshot-count">{history?.samples ?? 0} målepunkter gemt</span><button className="text-btn danger" type="button" onClick={removeMySkoda}>Fjern MyŠkoda-forbindelse</button></div>
                </> : vehicleLoading ? <div className="connection-loading" role="status"><span /><strong>Kontrollerer MyŠkoda-forbindelsen…</strong><small>Det kan tage nogle sekunder, hvis bilen eller MyŠkoda er i dvale.</small></div> : vehicleLoadError ? <div className="connection-retry" role="alert"><p className="eyebrow">MIDLERTIDIG FORBINDELSESFEJL</p><h2>Din forbindelse er ikke blevet slettet</h2><p>{vehicleLoadError}</p><button className="secondary" type="button" onClick={refreshVehicle}>Prøv igen</button></div> : <>
                  <p className="eyebrow">GRATIS · ANBEFALET</p><h2>Log ind én gang med MyŠkoda</h2>
                  <form className="credential-form" onSubmit={connectMySkoda} autoComplete="off">
                    <p>Din adgangskode behandles kortvarigt af din private Elroqblik Worker og sendes krypteret videre til Volkswagens login. Den bruges kun til at oprette forbindelsen og bliver ikke gemt.</p>
                    <label>MyŠkoda e-mail<input required type="email" value={mySkodaEmail} onChange={event => setMySkodaEmail(event.target.value)} placeholder="Din MyŠkoda e-mail" autoCapitalize="none" spellCheck={false} autoComplete="username" /></label>
                    <label>MyŠkoda adgangskode<input required type="password" value={mySkodaPassword} onChange={event => setMySkodaPassword(event.target.value)} placeholder="Din MyŠkoda adgangskode" autoComplete="current-password" /></label>
                    <button className="connect-button" disabled={setupState === "saving"} type="submit">{setupState === "saving" ? "Forbinder sikkert…" : "Forbind gratis med MyŠkoda"} <Icon name="arrow" /></button>
                    {setupState === "error" && <div className="form-error" role="alert">{setupMessage}</div>}
                    <small className="security-copy">🔒 Kun det roterende adgangstoken gemmes krypteret. Ingen adgangskode lagres.</small>
                  </form>
                  {vehicleState.provider === "smartcar" && vehicleState.connected && <div className="permission-guide" role="status"><strong>Smartcar er stadig gemt som reserve</strong>Den gratis MyŠkoda-forbindelse overtager automatisk, så snart login lykkes.</div>}
                </>}
              </div>
            </article>
            <aside className="privacy-card"><h2>Det giver adgang til</h2><ul><li><span>✓</span><div><strong>Batteri og rækkevidde</strong><small>Aktuel procent og forventede kilometer</small></div></li><li><span>✓</span><div><strong>Kilometerstand og forbrug</strong><small>Grundlag for at beregne km/kWh</small></div></li><li><span>✓</span><div><strong>Krypteret opbevaring</strong><small>Adgangskoden bliver aldrig gemt</small></div></li></ul><div className="read-only">Gratis · Kun læseadgang · Ingen fjernstyring</div></aside>
          </div>
        </section>}
      </div>

      <nav className="mobile-nav" aria-label="Mobilnavigation"><button aria-current={tab === "overblik" ? "page" : undefined} className={tab === "overblik" ? "active" : ""} onClick={() => setTab("overblik")}><Icon name="home" /><span>Overblik</span></button><button aria-current={tab === "ladning" ? "page" : undefined} className={tab === "ladning" ? "active" : ""} onClick={() => setTab("ladning")}><Icon name="bolt" /><span>Opladning</span></button><button aria-current={tab === "oekonomi" ? "page" : undefined} className={tab === "oekonomi" ? "active" : ""} onClick={() => setTab("oekonomi")}><Icon name="wallet" /><span>Økonomi</span></button><button aria-current={tab === "bil" ? "page" : undefined} className={tab === "bil" ? "active" : ""} onClick={() => setTab("bil")}><Icon name="car" /><span>Bil</span></button></nav>
    </main>
  );
}

function Session({s,onDelete}:{s:ChargingSession;onDelete:()=>void}) {
  const date = new Date(s.chargedAt);
  const source = s.id.startsWith("myskoda:") ? "MyŠkoda" : "Clever";
  return <div className="session"><div className={`session-icon ${s.locationType === "home" ? "home" : "fast"}`}><Icon name={s.locationType === "home" ? "home" : "pin"} /></div><div className="session-main"><strong>{s.locationName}</strong><span>{date.toLocaleDateString("da-DK", { day:"numeric", month:"short" })} · {date.toLocaleTimeString("da-DK", { hour:"2-digit", minute:"2-digit" })} · {source}</span></div><div><strong>{formatNumber(s.energyKwh, 1)} kWh</strong><span>registreret</span></div><button className="session-delete" onClick={onDelete} aria-label={`Slet opladning fra ${s.locationName}`}>Slet</button></div>;
}

function formatNumber(value: number, digits: number) { return value.toLocaleString("da-DK", { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function formatCurrency(value: number) { return `${value.toLocaleString("da-DK", { minimumFractionDigits: value < 10 ? 2 : 0, maximumFractionDigits: value < 10 ? 2 : 0 })} kr.`; }
function localDateTimeValue() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
