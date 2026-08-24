import type { ChargingSession } from "./storage";

type ImportSession = Omit<ChargingSession, "id">;

// Aflæst fra Nicolajs Clever-årsoversigt. Hjemmeadressen er bevidst anonymiseret.
const raw: Array<[string, string, number]> = [
  ["2026-08-16", "Hjemme", 29.7], ["2026-08-15", "Hjemme", 0], ["2026-08-05", "Hjemme", 52.4],
  ["2026-08-04", "Hjemme", 29.8], ["2026-08-01", "Netto Bygholm Bakker – Horsens", 34.9],
  ["2026-07-28", "Hjemme", 36.7], ["2026-07-19", "Hjemme", 50.8], ["2026-07-18", "Aral pulse Westring 19", 40.4],
  ["2026-07-18", "Aral pulse An der Autobahn 1 Buchholz Aller", 45.5], ["2026-07-17", "IONITY Harz Ost", 20.2],
  ["2026-07-17", "IONITY Riedener Wald Ost", 53.7], ["2026-07-17", "IONITY Memmingen", 38.2],
  ["2026-07-15", "IONITY Brenner", 45.1], ["2026-07-06", "IONITY Brenner", 34.1],
  ["2026-07-06", "Aral pulse Schongauer Straße 7", 42.4], ["2026-07-05", "Aral pulse Baukreativstraße 7", 44.7],
  ["2026-07-05", "IONITY Guxhagen", 43.5], ["2026-07-05", "Aral pulse (Burger King)", 48.8],
  ["2026-07-05", "SDS Padborg", 29.4], ["2026-07-04", "Hjemme", 17.7], ["2026-07-03", "Hjemme", 5.4],
  ["2026-07-02", "Hjemme", 25.3], ["2026-06-29", "Hjemme", 31.0], ["2026-06-27", "Hjemme", 22.1],
  ["2026-06-27", "Hjemme", 13.9], ["2026-06-25", "Hjemme", 34.4], ["2026-06-20", "Storcenter Nord Århus – P-dæk", 31.6],
  ["2026-06-14", "Hjemme", 36.1], ["2026-06-11", "Hjemme", 27.3], ["2026-06-09", "Hjemme", 14.8],
  ["2026-06-05", "Hjemme", 29.3], ["2026-06-05", "Hjemme", 14.8], ["2026-06-03", "Lynladestation Purhus", 27.1],
  ["2026-06-02", "Hjemme", 42.3], ["2026-05-29", "Hjemme", 28.6], ["2026-05-29", "Hjemme", 4.1],
  ["2026-05-24", "Hjemme", 37.4], ["2026-05-18", "Hjemme", 30.7], ["2026-05-13", "Hjemme", 33.3],
  ["2026-05-06", "Hjemme", 23.6], ["2026-05-03", "Hjemme", 40.3], ["2026-04-26", "Hjemme", 22.2],
  ["2026-04-26", "Hjemme", 0.13], ["2026-04-26", "Hjemme", 0.07], ["2026-04-26", "Hjemme", 0.03],
  ["2026-04-26", "Hjemme", 0.04], ["2026-04-26", "Hjemme", 0.14], ["2026-04-26", "Hjemme", 0.04],
  ["2026-04-25", "Hjemme", 22.6],
];

export const cleverScreenshotHistory: ImportSession[] = raw.map(([date, locationName, energyKwh], index) => ({
  // Tiderne fremgår ikke af årsoversigten; minutterne gør poster på samme dato entydige.
  chargedAt: `${date}T12:${String(index % 60).padStart(2, "0")}:00+02:00`,
  locationType: locationName === "Hjemme" ? "home" : "public",
  locationName,
  energyKwh,
}));
