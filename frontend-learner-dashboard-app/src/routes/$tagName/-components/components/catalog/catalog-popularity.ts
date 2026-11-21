/**
 * Parser for the public popularity endpoint (see -services/popularity-service.ts):
 *
 *   { institute_id, ranks: [{ package_id, rank }] }   (rank 1 = most enrolled)
 *
 * Pure, so it can be tested without the app's URL config. The response is
 * untrusted: malformed entries are dropped and a duplicated course keeps its
 * best rank.
 */
export const parsePopularityRanks = (data: unknown): Map<string, number> => {
  const ranks = new Map<string, number>();
  const list = data && typeof data === "object" ? (data as { ranks?: unknown }).ranks : undefined;
  if (!Array.isArray(list)) return ranks;
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const { package_id: id, rank } = entry as { package_id?: unknown; rank?: unknown };
    if (typeof id !== "string" || !id.trim()) continue;
    if (typeof rank !== "number" || !Number.isFinite(rank) || rank < 1) continue;
    const key = id.trim();
    const value = Math.floor(rank);
    const previous = ranks.get(key);
    if (previous === undefined || value < previous) ranks.set(key, value);
  }
  return ranks;
};
