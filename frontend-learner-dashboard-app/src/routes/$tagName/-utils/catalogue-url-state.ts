import { useCallback, useMemo } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";

/**
 * Query-string state for catalogue sections: ?stream=shiksha&language=hi lets a
 * filtered view be shared, bookmarked and linked from the header mega menu.
 *
 * Every update keeps the parameters it does not own (UTMs, ?lang=, ?folder=…)
 * and goes through the router's own history, so Back/Forward and the router's
 * location stay in step. Catalogue routes declare no search schema, so the raw
 * search string is read rather than the router's validated object.
 */

/** Parameter names shared by catalogue sections — one place, so links and readers agree. */
export const URL_PARAMS = {
  stream: "stream",
  category: "category",
  language: "language",
  price: "price",
  sort: "sort",
  query: "q",
  quick: "quick",
  path: "path",
  /** Learning paths (featured layout): the goal chip picked. */
  goal: "goal",
} as const;

export const readSearchParam = (searchStr: string | undefined | null, key: string): string | null => {
  const v = new URLSearchParams(searchStr || "").get(key);
  return v && v.trim() ? v.trim() : null;
};

/** Comma-separated list parameter (?language=hi,en). */
export const readListParam = (searchStr: string | undefined | null, key: string): string[] => {
  const v = readSearchParam(searchStr, key);
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
};

/**
 * The search string after applying `updates` (null/'' / empty list removes a
 * key). Returns '' or '?…'. Keys not mentioned are left exactly as they were.
 */
export const withSearchParams = (
  searchStr: string | undefined | null,
  updates: Record<string, string | string[] | null | undefined>,
): string => {
  const params = new URLSearchParams(searchStr || "");
  for (const [key, raw] of Object.entries(updates)) {
    const value = Array.isArray(raw) ? raw.filter(Boolean).join(",") : raw;
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
};

/** A link to `path` carrying `params` — for building mega-menu / tile links. */
export const linkWithParams = (path: string, params: Record<string, string | null | undefined>): string => {
  const [base, existing] = path.split("?");
  return `${base}${withSearchParams(existing || "", params)}`;
};

/**
 * Fills {stream} / {category} placeholders in an admin-authored link pattern,
 * e.g. "/courses?stream={stream}&category={category}". Values are URI-encoded.
 */
export const fillLinkPattern = (pattern: string, values: Record<string, string | null | undefined>): string =>
  pattern.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(values[k] || ""));

export interface VisibleWhenRule {
  param: string;
  op: "empty" | "notEmpty" | "equals" | "notEquals";
  value?: string;
}

/**
 * Does a section's visibleWhen hold for this query string? Every rule must
 * pass; no rules (or a malformed rule list) means "always shown", so a typo
 * can never make content disappear. Comparison ignores case.
 */
export const evaluateVisibleWhen = (rules: unknown, searchStr: string | undefined | null): boolean => {
  if (!Array.isArray(rules) || rules.length === 0) return true;
  return rules.every((rule) => {
    if (!rule || typeof rule !== "object") return true;
    const { param, op, value } = rule as VisibleWhenRule;
    if (typeof param !== "string" || !param.trim()) return true;
    const current = (readSearchParam(searchStr, param.trim()) || "").toLowerCase();
    const expected = (value || "").trim().toLowerCase();
    switch (op) {
      case "empty":
        return current === "";
      case "notEmpty":
        return current !== "";
      case "equals":
        return current === expected;
      case "notEquals":
        return current !== expected;
      default:
        return true;
    }
  });
};

/** Read and update the current page's query string from a catalogue section. */
export const useCatalogueSearchParams = () => {
  const location = useLocation();
  const router = useRouter();
  const searchStr = location.searchStr || "";

  const get = useCallback((key: string) => readSearchParam(searchStr, key), [searchStr]);
  const getList = useCallback((key: string) => readListParam(searchStr, key), [searchStr]);

  /** replace (default) for filter tweaks; push for navigation-like changes (tabs, drill-ins). */
  const update = useCallback(
    (updates: Record<string, string | string[] | null | undefined>, opts?: { push?: boolean }) => {
      const next = withSearchParams(searchStr, updates);
      if (next === (searchStr.startsWith("?") || !searchStr ? searchStr : `?${searchStr}`)) return;
      const href = `${location.pathname}${next}`;
      if (opts?.push) router.history.push(href);
      else router.history.replace(href);
    },
    [location.pathname, router, searchStr],
  );

  return useMemo(() => ({ searchStr, get, getList, update }), [searchStr, get, getList, update]);
};
