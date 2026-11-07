import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { handleGetProductPage } from "@/routes/product-pages/$productPageCode/-services/product-page-service";
import { fetchPublicFolderTree, nodeTitle } from "../../-services/folder-library-service";
import {
  buildPathSteps,
  collectPathEntries,
  findFolderBySlug,
  stepsInCourseLanguage,
  variantPrice,
  type PathMapping,
} from "../../-components/components/learning-path-utils";
import type { CourseLanguageOption } from "../../-utils/course-variants";
import { shortStepLabels } from "../-utils/course-page-content";

export interface SeriesStep {
  key: string;
  /** Short label ("Basic premise"); the full title is `title`. */
  label: string;
  title: string;
  courseId: string;
  enrollInviteId: string | null;
  packageSessionId: string;
  current: boolean;
  price: number | null;
  currency: string | null;
  levelName: string | null;
  tags: string | null;
}

export interface CourseSeries {
  /** The path's name (base language). */
  name: string;
  steps: SeriesStep[];
  next: SeriesStep | null;
}

/** At most this many paths are read to find the course's (a site with a large library). */
const MAX_PATHS = 12;

/**
 * The learning path (series) the course is a step of: the paths in the site's
 * Learning Paths library — those in the course's stream first, the rest only
 * when none of those holds it — read through the same queries as the Learning
 * Paths section (one request serves both). The first path that lists the
 * course wins. Null while loading, and for a course in no path.
 */
export const useCourseSeries = (input: {
  enabled: boolean;
  instituteId: string | null | undefined;
  libraryId: string | null | undefined;
  streamSlug: string | null | undefined;
  courseId: string;
  groupVersions: boolean;
  languages: CourseLanguageOption[];
  preferredLanguage: string | null;
}): CourseSeries | null => {
  const { enabled, instituteId, libraryId, streamSlug, courseId } = input;
  const on = enabled && !!instituteId && !!libraryId && !!courseId;
  const tree = useQuery({
    queryKey: ["FOLDER_LIBRARY_PUBLIC", instituteId, libraryId],
    queryFn: () => fetchPublicFolderTree(instituteId!, libraryId!),
    enabled: on,
    staleTime: 60_000,
    retry: (count: number, err: unknown) =>
      (err as { response?: { status?: number } })?.response?.status !== 404 && count < 2,
  });

  const entries = useMemo(() => {
    const roots = tree.data?.roots;
    if (!on || !roots) return [];
    const all = collectPathEntries(roots);
    const folder = streamSlug ? findFolderBySlug(roots, streamSlug) : null;
    const inStream = folder ? collectPathEntries(folder.children, folder) : [];
    const rest = all.filter((e) => !inStream.some((s) => s.code === e.code));
    return [...inStream, ...rest].slice(0, MAX_PATHS);
  }, [on, tree.data, streamSlug]);

  const pages = useQueries({
    queries: entries.map((e) => ({
      ...handleGetProductPage(e.code, instituteId ?? ""),
      enabled: on && !!e.code,
      retry: 1,
    })),
  });
  const pagesKey = pages.map((p) => p.dataUpdatedAt).join(",");

  return useMemo(() => {
    if (!on) return null;
    for (let i = 0; i < entries.length; i++) {
      const data = pages[i]?.data as { mappings?: PathMapping[] } | undefined;
      const mappings = data?.mappings || [];
      if (!mappings.some((m) => m.package_id === courseId && (m.status ?? "ACTIVE").toUpperCase() === "ACTIVE")) {
        continue;
      }
      const built = buildPathSteps(mappings, {
        groupVersions: input.groupVersions,
        languages: input.languages,
        preferredLanguage: input.preferredLanguage,
      });
      // With course languages on, numbered within the course's language: a Hindi course's chips skip the English steps.
      const steps = input.groupVersions ? stepsInCourseLanguage(built, courseId, input.languages) : built;
      if (steps.length < 2) return null;
      const titles = steps.map((s) => (s.primary.package_name || "").trim());
      const labels = shortStepLabels(titles);
      const out: SeriesStep[] = steps.map((s, idx) => ({
        key: s.key,
        label: labels[idx] || titles[idx] || "",
        title: titles[idx] || "",
        courseId: s.courseId,
        enrollInviteId: s.primary.enroll_invite_id ?? null,
        packageSessionId: s.primary.package_session_id,
        current: s.courseId === courseId,
        price: variantPrice(s.primary),
        currency: s.primary.payment_plan?.currency ?? null,
        levelName: s.primary.level_name ?? null,
        tags: s.primary.tags ?? null,
      }));
      const at = out.findIndex((s) => s.current);
      return { name: nodeTitle(entries[i]!.node), steps: out, next: at >= 0 ? out[at + 1] ?? null : null };
    }
    return null;
    // pagesKey stands for `pages`, a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, entries, pagesKey, courseId, input.groupVersions, input.languages, input.preferredLanguage]);
};
