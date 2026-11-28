import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { handleGetProductPage } from "@/routes/product-pages/$productPageCode/-services/product-page-service";
import { fetchPublicFolderTree, nodeTitle } from "../../-services/folder-library-service";
import { catalogueCourseRowsKey, fetchCatalogueCourseRows } from "../../-services/catalogue-course-rows-service";
import {
  collectPathEntries,
  findFolderBySlug,
  type PathMapping,
} from "../../-components/components/learning-path-utils";
import type { CatalogStream } from "../../-components/components/catalog/catalog-streams";
import type { CourseLanguageOption } from "../../-utils/course-variants";
import {
  coursePlaceSeriesCandidates,
  seriesFromMappings,
  type CatalogueCourseRow,
  type CoursePlaceRef,
} from "../-utils/course-place-series";

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
 * course wins.
 *
 * A course in no path — or whose path holds no other course in its language —
 * is "part of" its category instead (else its stream): the site's listed
 * courses in that place, in its language, oldest first, read from the same
 * course list as the header search. Such a list is no series, so it has no
 * "next". Null while loading, and when there is nothing to show.
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
  /** The site's streams (the Courses section's) and the course's place in them, for the fallback. */
  streams?: readonly CatalogStream[];
  place?: { stream: CoursePlaceRef | null; category: CoursePlaceRef | null };
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

  // Every path read (or failed, or never asked for): only then is "in no path" known.
  const pathsSettled =
    (tree.isSuccess || tree.isError) && pages.every((p) => p.isSuccess || p.isError || p.fetchStatus === "idle");

  // A path that lists the course shows as soon as it is read. undefined = paths still loading;
  // null = the course is in no path (or alone in its language there).
  const pathSeries = useMemo((): CourseSeries | null | undefined => {
    if (!on) return null;
    const opts = {
      courseId,
      groupVersions: input.groupVersions,
      languages: input.languages,
      preferredLanguage: input.preferredLanguage,
      placeList: false,
    };
    for (let i = 0; i < entries.length; i++) {
      const data = pages[i]?.data as { mappings?: PathMapping[] } | undefined;
      const mappings = data?.mappings || [];
      if (!mappings.some((m) => m.package_id === courseId && (m.status ?? "ACTIVE").toUpperCase() === "ACTIVE")) {
        continue;
      }
      return seriesFromMappings(mappings, nodeTitle(entries[i]!.node), opts);
    }
    return pathsSettled ? null : undefined;
    // pagesKey stands for `pages`, a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, pathsSettled, entries, pagesKey, courseId, input.groupVersions, input.languages, input.preferredLanguage]);

  const streams = input.streams;
  const place = input.place;
  const wantsPlace = on && pathSeries === null && !!streams?.length && !!place?.stream;
  const courseRows = useQuery({
    queryKey: catalogueCourseRowsKey(instituteId),
    queryFn: () => fetchCatalogueCourseRows<CatalogueCourseRow>(instituteId!),
    enabled: wantsPlace,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const placeSeries = useMemo((): CourseSeries | null => {
    if (!wantsPlace || !courseRows.data) return null;
    const candidates = coursePlaceSeriesCandidates({
      rows: courseRows.data,
      streams: streams ?? [],
      stream: place?.stream ?? null,
      category: place?.category ?? null,
    });
    for (const candidate of candidates) {
      const series = seriesFromMappings(candidate.mappings, candidate.name, {
        courseId,
        groupVersions: input.groupVersions,
        languages: input.languages,
        preferredLanguage: input.preferredLanguage,
        placeList: true,
      });
      if (series) return series;
    }
    return null;
  }, [
    wantsPlace,
    courseRows.data,
    streams,
    place?.stream,
    place?.category,
    courseId,
    input.groupVersions,
    input.languages,
    input.preferredLanguage,
  ]);

  return pathSeries ?? placeSeries;
};
