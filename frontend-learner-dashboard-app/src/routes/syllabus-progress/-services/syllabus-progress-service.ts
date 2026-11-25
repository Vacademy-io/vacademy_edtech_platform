import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { SYLLABUS_PROGRESS_MINE } from "@/constants/urls";
import { getInstituteId } from "@/constants/helper";

// snake_case — mirrors admin-core-service's learner syllabus-progress response.

export type SyllabusBlockStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";

export interface SyllabusPoint {
    seq: number;
    text: string;
}

export interface SyllabusBlock {
    id: string;
    trimester: number | null;
    month_no: number | null;
    week_from: number | null;
    week_to: number | null;
    block_order: number;
    points: SyllabusPoint[] | null;
    status: SyllabusBlockStatus;
    completed_on: string | null;
    points_done: number[] | null;
    teacher_note: string | null;
    marked_by_name: string | null;
}

export interface SyllabusCourse {
    package_session_id: string;
    course_name: string | null;
    level_name: string | null;
    batch_name: string | null;
    total_blocks: number;
    completed_blocks: number;
    current_block_id: string | null;
    blocks: SyllabusBlock[] | null;
}

export interface MySyllabusResponse {
    enabled: boolean;
    courses: SyllabusCourse[] | null;
}

export const getMySyllabus = async (instituteId: string): Promise<MySyllabusResponse> => {
    const response = await authenticatedAxiosInstance({
        method: "GET",
        url: SYLLABUS_PROGRESS_MINE,
        params: { instituteId },
    });
    const data = (response.data ?? {}) as Partial<MySyllabusResponse>;
    return { enabled: data.enabled === true, courses: data.courses ?? [] };
};

export const MY_SYLLABUS_QUERY_KEY = "GET_MY_SYLLABUS_PROGRESS";

export const handleGetMySyllabus = (instituteId: string | undefined) => ({
    queryKey: [MY_SYLLABUS_QUERY_KEY, instituteId] as const,
    queryFn: () => getMySyllabus(instituteId ?? ""),
    staleTime: 5 * 60 * 1000,
    enabled: !!instituteId,
});

/** True when the institute has the feature on and the learner is in at least one course with a syllabus. */
export const hasSyllabus = (data: MySyllabusResponse | undefined): boolean =>
    !!data?.enabled && (data.courses?.length ?? 0) > 0;

/**
 * The learner's syllabus progress for the current institute. One shared query
 * (sidebar, dashboard card and page read the same cache entry).
 * `retry: false` for the nav/card gate callers: a failed or missing endpoint
 * simply keeps the entry point hidden.
 */
export const useMySyllabus = (options?: { retry?: boolean }) => {
    const [instituteId, setInstituteId] = useState<string | undefined>();
    const [instituteResolved, setInstituteResolved] = useState(false);
    useEffect(() => {
        let alive = true;
        getInstituteId()
            .then((id) => {
                if (alive) setInstituteId(id ?? undefined);
            })
            .catch(() => undefined)
            .finally(() => {
                if (alive) setInstituteResolved(true);
            });
        return () => {
            alive = false;
        };
    }, []);
    const query = useQuery({
        ...handleGetMySyllabus(instituteId),
        retry: options?.retry === false ? false : 1,
    });
    return {
        ...query,
        instituteId,
        /** True while the institute id or the request is still on its way. */
        isLoadingSyllabus: !instituteResolved || (!!instituteId && query.isPending),
    };
};
