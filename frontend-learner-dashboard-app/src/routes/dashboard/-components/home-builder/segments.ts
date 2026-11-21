import type { HomePlacement } from "@/types/learner-home";

/**
 * Desktop layout of the builder home (>= 1024 px). The list is cut at every FULL
 * block: a FULL block is a full-width band of its own, and each run of MAIN /
 * RAIL blocks between two bands becomes one 2/3 + 1/3 grid. Inside a grid the
 * MAIN blocks keep their list order in the main column and the RAIL blocks keep
 * theirs in the rail. A grid with no RAIL block lets the main column take the
 * whole width.
 *
 * Phones never use this: they show every block in list order, one column.
 */
export type HomeSegment<T> =
  | { kind: "full"; key: string; block: T }
  | { kind: "grid"; key: string; main: T[]; rail: T[] };

export function toSegments<T extends { key: string; placement: HomePlacement }>(
  blocks: readonly T[]
): HomeSegment<T>[] {
  const out: HomeSegment<T>[] = [];
  let grid: { kind: "grid"; key: string; main: T[]; rail: T[] } | null = null;
  for (const block of blocks) {
    if (block.placement === "FULL") {
      grid = null;
      out.push({ kind: "full", key: block.key, block });
      continue;
    }
    if (!grid) {
      grid = { kind: "grid", key: `grid-${block.key}`, main: [], rail: [] };
      out.push(grid);
    }
    if (block.placement === "RAIL") grid.rail.push(block);
    else grid.main.push(block);
  }
  return out;
}
