export type ProviderNetworkScore = {
  dk: number;
  europe: number;
  convenience: number;
};

/** Price 55%, Danish coverage 20%, European coverage 15%, convenience 10%. */
export function calculateProviderMatchScore(
  lowestCost: number,
  providerCost: number,
  network: ProviderNetworkScore,
): number {
  const price = lowestCost / Math.max(providerCost, 1) * 55;
  const dk = clampRating(network.dk) * 4;
  const europe = clampRating(network.europe) * 3;
  const convenience = clampRating(network.convenience) * 2;
  return Math.min(100, Math.max(0, Math.round(price + dk + europe + convenience)));
}

function clampRating(value: number): number {
  return Math.min(5, Math.max(0, value));
}
