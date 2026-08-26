import assert from "node:assert/strict";
import test from "node:test";

const { likelySameChargingSession } = await import("../app/domain/charging.ts");

const base = {
  id: "manual-1",
  chargedAt: "2026-08-20T10:00:00.000Z",
  locationType: "home",
  energyKwh: 40,
};

test("matches a legacy entry only when day, type and energy are nearly identical", () => {
  assert.equal(likelySameChargingSession(base, {
    ...base,
    id: "myskoda:new",
    chargedAt: "2026-08-20T18:00:00.000Z",
    energyKwh: 40.2,
  }), true);
});

test("keeps two legitimate same-day charges with meaningfully different energy", () => {
  assert.equal(likelySameChargingSession(base, {
    ...base,
    id: "myskoda:new",
    energyKwh: 42,
  }), false);
});

test("keeps same-day charges with different location types", () => {
  assert.equal(likelySameChargingSession(base, {
    ...base,
    id: "myskoda:new",
    locationType: "public",
  }), false);
});

test("never heuristically replaces an existing MySkoda session", () => {
  assert.equal(likelySameChargingSession({ ...base, id: "myskoda:existing" }, {
    ...base,
    id: "myskoda:new",
  }), false);
});
