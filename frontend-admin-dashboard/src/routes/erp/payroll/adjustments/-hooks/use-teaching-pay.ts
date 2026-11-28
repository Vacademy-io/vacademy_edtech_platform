import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MonthValue } from '@/components/design-system/month-picker';
import { getInstituteId } from '@/constants/helper';
import {
    fetchTeachingSummary,
    hrKeys,
    materializeTeachingPay,
    previewTeachingPay,
    syncTeachingAttendance,
    teachingKeys,
} from '@/routes/erp/-shared/hr-service';

/**
 * Query plumbing for Variable Pay → Teaching Pay.
 *
 * The split here is deliberate: the month summary loads on its own because it is
 * the tab's content and useless unasked-for, while the pay preview never fires on
 * mount. The preview walks every session occurrence in the month and multiplies it
 * by a per-employee rate; running that because someone clicked a tab is how a
 * screen becomes slow for everyone.
 */

/** Teaching activity barely changes within a session once the month is over. */
const SUMMARY_STALE_MS = 60 * 1000;

export function useTeachingSummary(month: MonthValue, enabled: boolean) {
    return useQuery({
        queryKey: teachingKeys.summary(month.year, month.month),
        queryFn: () => fetchTeachingSummary(month.year, month.month),
        enabled: enabled && !!getInstituteId(),
        staleTime: SUMMARY_STALE_MS,
    });
}

/**
 * The pay computation, run only when asked.
 *
 * `enabled: false` + `refetch()` rather than a mutation so the result stays in the
 * cache keyed by month: switching months and back shows the preview you already
 * ran instead of silently recomputing it.
 */
export function useTeachingPayPreview(month: MonthValue) {
    return useQuery({
        queryKey: teachingKeys.payPreview(month.year, month.month),
        queryFn: () => previewTeachingPay(month.year, month.month),
        enabled: false,
        staleTime: SUMMARY_STALE_MS,
    });
}

/**
 * Marks teaching days PRESENT in HR attendance.
 *
 * Invalidates the summary because `sessions_with_attendance` is exactly what the
 * sync changes — leaving the old numbers on screen would make the sync look like a
 * no-op.
 */
export function useSyncTeachingAttendance(month: MonthValue) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => syncTeachingAttendance({ year: month.year, month: month.month }),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: teachingKeys.summary(month.year, month.month),
            });
        },
    });
}

/**
 * Writes the previewed lines as TEACHING_PAY adjustments.
 *
 * Also invalidates that month's adjustments: the rows land on the sibling
 * Adjustments tab, and an admin who switches to it immediately should see them.
 */
export function useMaterializeTeachingPay(month: MonthValue) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => materializeTeachingPay(month.year, month.month),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: teachingKeys.payPreview(month.year, month.month),
            });
            queryClient.invalidateQueries({
                queryKey: hrKeys.adjustments(month.year, month.month),
            });
        },
    });
}
