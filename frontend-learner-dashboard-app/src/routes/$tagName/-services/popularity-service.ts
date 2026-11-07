import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { BASE_URL } from "@/constants/urls";
import { parsePopularityRanks } from "../-components/components/catalog/catalog-popularity";

/**
 * Enrolment RANKS of an institute's catalogue courses, for the Courses page's
 * Bestseller / Popular badges and the "Popular" sort:
 *
 *   GET /admin-core-service/open/packages/v1/popularity?instituteId=
 *   → { institute_id, ranks: [{ package_id, rank }] }   (rank 1 = most enrolled)
 *
 * Ranks only — never raw counts. Courses with no enrolments are absent. The
 * server caches for 10 minutes and sends Cache-Control: max-age=600; the
 * query mirrors that, so the endpoint is hit at most once per visit and only
 * by sections that actually need ranks.
 */

const publicAxios = axios.create({ withCredentials: false });

export const POPULARITY_URL = `${BASE_URL}/admin-core-service/open/packages/v1/popularity`;

const TEN_MINUTES = 10 * 60 * 1000;

export { parsePopularityRanks };

export const fetchPopularityRanks = async (instituteId: string): Promise<Map<string, number>> =>
  parsePopularityRanks(
    (await publicAxios.get(POPULARITY_URL, { params: { instituteId } })).data,
  );

export const popularityQueryKey = (instituteId: string | undefined) =>
  ["CATALOG_POPULARITY", instituteId] as const;

const NO_RANKS = new Map<string, number>();

/**
 * Ranks for an institute, fetched only while `enabled` (badges that need
 * ranks, the Popular sort, or a Bestseller/Popular filter). A failed call
 * leaves the map empty: ranked badges simply do not show and Popular keeps
 * the catalogue order.
 */
export const usePopularityRanks = (instituteId: string | undefined, enabled: boolean) => {
  const query = useQuery({
    queryKey: popularityQueryKey(instituteId),
    queryFn: () => fetchPopularityRanks(instituteId!),
    enabled: enabled && !!instituteId,
    staleTime: TEN_MINUTES,
    gcTime: TEN_MINUTES,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  return { ranks: query.data ?? NO_RANKS, isLoading: query.isLoading };
};
