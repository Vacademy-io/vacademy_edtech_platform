import axios from "axios";
import { urlCourseDetails } from "@/constants/urls";

/** React Query key of the site's full course list (one request serves the header search and the course page's "Part of"). */
export const catalogueCourseRowsKey = (instituteId: string | null | undefined) =>
  ["CATALOGUE_SITE_SEARCH_COURSES", instituteId] as const;

/**
 * The site's listed courses: the open catalogue search the catalogue grid
 * uses (one row per listed version), optionally narrowed by name on the server.
 */
export const fetchCatalogueCourseRows = async <T = Record<string, unknown>>(
  instituteId: string,
  name = "",
  size = 1000,
): Promise<T[]> => {
  const res = await axios.post(
    urlCourseDetails,
    {
      status: [],
      level_ids: [],
      faculty_ids: [],
      search_by_name: name,
      tag: [],
      min_percentage_completed: 0,
      max_percentage_completed: 0,
    },
    {
      // Same request as the catalogue grid, so search spans every course it lists.
      params: { instituteId, page: 0, size, sort: "createdAt,desc" },
      headers: { "Content-Type": "application/json" },
    },
  );
  const raw = res.data?.content || res.data || [];
  return Array.isArray(raw) ? (raw as T[]) : [];
};
