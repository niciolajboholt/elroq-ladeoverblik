import assert from "node:assert/strict";
import test from "node:test";

const { calculateProviderMatchScore } = await import("../app/domain/provider-score.ts");

test("uses the documented 55/20/15/10 weighting", () => {
  assert.equal(calculateProviderMatchScore(100, 100, { dk: 5, europe: 5, convenience: 5 }), 100);
});

test("caps invalid network ratings and never exceeds 100", () => {
  assert.equal(calculateProviderMatchScore(100, 100, { dk: 9, europe: 9, convenience: 9 }), 100);
});

test("gives network quality 45 points when price contributes nothing", () => {
  assert.equal(calculateProviderMatchScore(0, 100, { dk: 5, europe: 5, convenience: 5 }), 45);
});
