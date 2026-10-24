import { z } from "zod";

/**
 * The `utm_*` keys, as a shape to merge into a route's `validateSearch` schema.
 *
 * WHY EVERY CAPTURE ROUTE NEEDS THIS: TanStack Router treats the result of
 * `validateSearch` as the canonical search state and rewrites the URL to match.
 * A plain `z.object` STRIPS keys it does not declare, so a route that declares
 * only its own ids turns
 *
 *     /audience-response?instituteId=1&audienceId=9&utm_source=meta
 *
 * into `?instituteId=1&audienceId=9` — and the campaign is gone from the URL
 * before the institute's own GTM container or GA4 tag ever reads it. The link
 * the admin generated would still reach the right page and still be recorded by
 * our own attribution beacon (captured at boot, in main.tsx), but it would be
 * invisible to the tag manager, which is half the reason for tagging it.
 *
 * Declaring the keys keeps them on the URL. Nothing has to consume them.
 */
export const utmSearchSchema = {
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_content: z.string().optional(),
  utm_term: z.string().optional(),
};

export type UtmSearchParams = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
};

/** Same job for routes whose `validateSearch` is a hand-written function. */
export const pickUtmSearchParams = (
  search: Record<string, unknown>
): UtmSearchParams => {
  const out: UtmSearchParams = {};
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ] as const) {
    const value = search[key];
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  return out;
};
