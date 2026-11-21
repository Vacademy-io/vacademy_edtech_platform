/**
 * The course page's "Part of" for a course that is in no learning path (or
 * whose path leaves it alone in its language): the courses of its category,
 * else of its stream, read from the site's open catalogue list and matched by
 * the same rule as its breadcrumb (coursePlaceOf). Also builds a path's
 * series (seriesFromMappings), so both number and window alike. Pure.
 */
import type { CatalogStream } from "../../-components/components/catalog/catalog-streams";
import {
  buildPathSteps,
  stepsInCourseLanguage,
  variantPrice,
  type PathMapping,
} from "../../-components/components/learning-path-utils";
import type { CourseLanguageOption } from "../../-utils/course-variants";
import type { CourseSeries, SeriesStep } from "../-hooks/use-course-series";
import { shortStepLabels } from "./course-page-content";
import { coursePlaceOf, courseTagSet } from "./course-page-context";

/** The fields of an open catalogue search row (one listed version of a course) this reads. */
export interface CatalogueCourseRow {
  id?: string | null;
  package_id?: string | null;
  package_name?: string | null;
  package_session_id?: string | null;
  enroll_invite_id?: string | null;
  level_name?: string | null;
  comma_separeted_tags?: string | null;
  min_plan_actual_price?: number | null;
  currency?: string | null;
  created_at?: string | null;
}

export interface CoursePlaceRef {
  /** The place's slug (stream or category), as coursePageContext names it. */
  slug: string;
  /** Its label as the page shows it (the breadcrumb's). */
  label: string;
}

export interface PlaceSeriesCandidate {
  kind: "category" | "stream";
  name: string;
  /** The place's listed courses as path mappings, oldest first. */
  mappings: PathMapping[];
}

const splitTags = (raw: string | null | undefined): string[] =>
  typeof raw === "string" ? raw.split(",").map((t) => t.trim()).filter(Boolean) : [];

const createdMs = (row: CatalogueCourseRow): number => {
  const ms = row.created_at ? Date.parse(row.created_at) : NaN;
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
};

/** A catalogue row as the mapping a path step is built from. */
export const catalogueRowAsMapping = (row: CatalogueCourseRow): PathMapping | null => {
  const packageSessionId = (row.package_session_id || "").trim();
  if (!packageSessionId) return null;
  const price = row.min_plan_actual_price;
  return {
    package_session_id: packageSessionId,
    package_id: (row.package_id || row.id || "").trim() || null,
    package_name: row.package_name ?? null,
    level_name: row.level_name ?? null,
    enroll_invite_id: row.enroll_invite_id ?? null,
    tags: row.comma_separeted_tags ?? null,
    status: "ACTIVE",
    payment_plan: {
      actual_price: typeof price === "number" && Number.isFinite(price) ? price : null,
      currency: row.currency ?? null,
    },
  };
};

/**
 * The places a course's "Part of" can fall back to, narrowest first: its
 * category's courses, then its stream's. Each lists the catalogue rows that
 * sit in that place (oldest first — the order they were added, as a series
 * reads), the course's own row included. Empty without streams or a place.
 */
export const coursePlaceSeriesCandidates = (input: {
  rows: readonly CatalogueCourseRow[] | null | undefined;
  streams: readonly CatalogStream[];
  stream: CoursePlaceRef | null;
  category: CoursePlaceRef | null;
}): PlaceSeriesCandidate[] => {
  const rows = input.rows || [];
  if (!rows.length || !input.streams.length || !input.stream) return [];
  const placed = rows
    .map((row, index) => ({ row, index, place: coursePlaceOf(courseTagSet(splitTags(row.comma_separeted_tags), row.level_name), input.streams) }))
    .sort((a, b) => createdMs(a.row) - createdMs(b.row) || a.index - b.index);
  const mappingsWhere = (keep: (p: (typeof placed)[number]["place"]) => boolean): PathMapping[] =>
    placed
      .filter((p) => keep(p.place))
      .map((p) => catalogueRowAsMapping(p.row))
      .filter((m): m is PathMapping => !!m);

  const out: PlaceSeriesCandidate[] = [];
  const category = input.category;
  const streamSlug = input.stream.slug;
  if (category) {
    out.push({
      kind: "category",
      name: category.label,
      mappings: mappingsWhere((p) => p.stream?.slug === streamSlug && p.category?.slug === category.slug),
    });
  }
  out.push({ kind: "stream", name: input.stream.label, mappings: mappingsWhere((p) => p.stream?.slug === streamSlug) });
  return out;
};

interface SeriesBuildOptions {
  courseId: string;
  groupVersions: boolean;
  languages: CourseLanguageOption[];
  preferredLanguage: string | null;
}

/**
 * A series from a list of mappings (a path's, or a place's courses): its steps
 * in the course's language when versions are grouped, the course among them.
 * `placeList`: a place's course list — each course once (its other listed
 * levels are not steps of their own) and no "next". Null when that leaves
 * fewer than two steps or not the course.
 */
export const seriesFromMappings = (
  mappings: PathMapping[],
  name: string,
  opts: SeriesBuildOptions & { placeList: boolean },
): CourseSeries | null => {
  const built = buildPathSteps(mappings, {
    groupVersions: opts.groupVersions,
    languages: opts.languages,
    preferredLanguage: opts.preferredLanguage,
  });
  // With course languages on, numbered within the course's language: a Hindi course's chips skip the English steps.
  const inLanguage = opts.groupVersions ? stepsInCourseLanguage(built, opts.courseId, opts.languages) : built;
  const seen = new Set<string>();
  const steps = opts.placeList ? inLanguage.filter((s) => !seen.has(s.courseId) && !!seen.add(s.courseId)) : inLanguage;
  if (steps.length < 2 || !steps.some((s) => s.courseId === opts.courseId)) return null;
  const titles = steps.map((s) => (s.primary.package_name || "").trim());
  const labels = shortStepLabels(titles);
  const out: SeriesStep[] = steps.map((s, idx) => ({
    key: s.key,
    label: labels[idx] || titles[idx] || "",
    title: titles[idx] || "",
    courseId: s.courseId,
    enrollInviteId: s.primary.enroll_invite_id ?? null,
    packageSessionId: s.primary.package_session_id,
    current: s.courseId === opts.courseId,
    price: variantPrice(s.primary),
    currency: s.primary.payment_plan?.currency ?? null,
    levelName: s.primary.level_name ?? null,
    tags: s.primary.tags ?? null,
  }));
  const at = out.findIndex((s) => s.current);
  return { name, steps: out, next: !opts.placeList && at >= 0 ? out[at + 1] ?? null : null };
};
