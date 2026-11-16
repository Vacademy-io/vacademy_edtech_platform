/**
 * Fetches a spreadsheet slide's grid file (see spreadsheet-slide-utils.ts) and
 * keeps the last few in memory. A grid file id always points at the same
 * content (replacing the workbook uploads a new file), so a cached grid never
 * goes stale. Shared by the slide view and the AI tutor context.
 */
import type { CbeSheet } from "@/components/cbe/types";
import { getPublicUrl } from "@/services/upload_file";
import {
  loadSpreadsheetGrid,
  parseSpreadsheetSlideData,
  spreadsheetSlideSummary,
  spreadsheetToPlainText,
} from "./spreadsheet-slide-utils";

/** Grids kept in memory (each is at most ~1.2 MB of JSON). */
const MAX_CACHED_GRIDS = 3;
/** The tutor waits this long for a grid before falling back to the summary. */
const TUTOR_GRID_TIMEOUT_MS = 5000;

const cache = new Map<string, Promise<CbeSheet>>();

/** The grid for `gridFileId`, downloaded once and reused (failures are not cached). */
export function fetchSpreadsheetGrid(gridFileId: string): Promise<CbeSheet> {
  const hit = cache.get(gridFileId);
  if (hit) {
    // Most recently used goes last.
    cache.delete(gridFileId);
    cache.set(gridFileId, hit);
    return hit;
  }
  const pending = loadSpreadsheetGrid(gridFileId, { getUrl: getPublicUrl });
  cache.set(gridFileId, pending);
  pending.catch(() => {
    if (cache.get(gridFileId) === pending) cache.delete(gridFileId);
  });
  while (cache.size > MAX_CACHED_GRIDS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return pending;
}

/**
 * Tutor text for a stored spreadsheet slide: the cell values (capped) when the
 * grid loads within a few seconds, else the file name and tab names.
 */
export async function spreadsheetTutorText(raw: unknown): Promise<string> {
  const data = parseSpreadsheetSlideData(raw);
  if (!data) return "";
  if (data.sheet) return spreadsheetToPlainText(data.sheet);
  if (!data.gridFileId) return spreadsheetSlideSummary(data);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sheet = await Promise.race([
      fetchSpreadsheetGrid(data.gridFileId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), TUTOR_GRID_TIMEOUT_MS);
      }),
    ]);
    return spreadsheetToPlainText(sheet);
  } catch {
    return spreadsheetSlideSummary(data);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
