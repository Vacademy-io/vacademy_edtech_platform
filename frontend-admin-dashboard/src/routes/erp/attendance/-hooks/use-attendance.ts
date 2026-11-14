import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import {
    actOnRegularization,
    assignShift,
    bulkCreateHolidays,
    deleteHoliday,
    fetchAttendanceConfig,
    fetchAttendanceRecords,
    fetchAttendanceSummary,
    fetchHolidays,
    fetchRegularizations,
    fetchShifts,
    hrKeys,
    markAttendance,
    saveAttendanceConfig,
    saveHoliday,
    saveShift,
} from '@/routes/erp/-shared/hr-service';
import type { AttendanceConfigDTO, HolidayDTO, ShiftDTO } from '@/routes/erp/-shared/hr-types';

/**
 * Query/mutation bindings for ERP → Attendance.
 *
 * Fetchers and keys both live in `erp/-shared/hr-service`; this module only wires
 * them to TanStack Query so the screens hold no cache plumbing — the same split
 * People and Payroll use.
 */

const REFERENCE_STALE_MS = 5 * 60 * 1000; // shifts, holidays, config: edited rarely
const RECORD_STALE_MS = 30 * 1000; // day records an admin is actively marking

const enabled = () => !!getInstituteId();

// ───────────────────────── Reads ─────────────────────────

/**
 * The institute's attendance configuration, or `null` when it has never been set.
 *
 * The fetcher swallows the 4xx an unconfigured institute returns, so `null` here
 * means "not configured yet", not "failed" — screens fall back to TIME_TRACKING.
 */
export const useAttendanceConfig = () =>
    useQuery({
        queryKey: hrKeys.attendanceConfig(),
        queryFn: fetchAttendanceConfig,
        enabled: enabled(),
        staleTime: REFERENCE_STALE_MS,
    });

/**
 * Every record for a month.
 *
 * The API is month-grained — there is no single-day endpoint — so the daily board
 * fetches the month once and filters client-side. Moving between days inside the
 * same month is then instant and costs no request.
 */
export const useAttendanceRecords = (month: number, year: number, employeeId?: string) =>
    useQuery({
        queryKey: hrKeys.attendance(year, month, employeeId),
        queryFn: () => fetchAttendanceRecords({ month, year, employeeId }),
        enabled: enabled(),
        staleTime: RECORD_STALE_MS,
    });

export const useAttendanceSummary = (month: number, year: number) =>
    useQuery({
        queryKey: hrKeys.attendanceSummary(year, month),
        queryFn: () => fetchAttendanceSummary(month, year),
        enabled: enabled(),
        staleTime: RECORD_STALE_MS,
    });

export const useRegularizations = (status?: string) =>
    useQuery({
        queryKey: hrKeys.regularizations(status),
        queryFn: () => fetchRegularizations(status),
        enabled: enabled(),
        staleTime: RECORD_STALE_MS,
    });

export const useShifts = () =>
    useQuery({
        queryKey: hrKeys.shifts(),
        queryFn: fetchShifts,
        enabled: enabled(),
        staleTime: REFERENCE_STALE_MS,
    });

export const useHolidays = (year: number) =>
    useQuery({
        queryKey: hrKeys.holidays(year),
        queryFn: () => fetchHolidays(year),
        enabled: enabled(),
        staleTime: REFERENCE_STALE_MS,
    });

// ───────────────────────── Mutations ─────────────────────────

/**
 * Everything a marked day can change.
 *
 * Marking rewrites the month's records AND the month's summary, and the record it
 * writes is what a pending regularization for that day was raised against — so all
 * three families are invalidated rather than just the day's list.
 */
const invalidateMonth = (
    queryClient: ReturnType<typeof useQueryClient>,
    year: number,
    month: number
) => {
    // The trailing segment is the employee filter; dropping it invalidates the
    // whole-month list AND every per-employee variant, which the same write changed.
    void queryClient.invalidateQueries({
        queryKey: [...hrKeys.attendance(year, month)].slice(0, -1),
    });
    void queryClient.invalidateQueries({ queryKey: hrKeys.attendanceSummary(year, month) });
};

export const useMarkAttendance = (year: number, month: number) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: {
            attendance_date: string;
            records: Array<{ employee_id: string; status: string; remarks?: string }>;
        }) => markAttendance(payload),
        onSuccess: () => invalidateMonth(queryClient, year, month),
    });
};

/**
 * Approving rewrites the underlying attendance record, so the decision invalidates
 * the month it belongs to as well as every regularization list.
 */
export const useActOnRegularization = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: {
            id: string;
            payload: { approval_status: 'APPROVED' | 'REJECTED'; remarks?: string };
            /** The day the request is about — used to invalidate that month's records. */
            date?: string;
        }) => actOnRegularization(variables.id, variables.payload),
        onSuccess: (_data, variables) => {
            void queryClient.invalidateQueries({
                queryKey: [...hrKeys.regularizations()].slice(0, -1),
            });
            const iso = (variables.date ?? '').slice(0, 10);
            const [yearPart, monthPart] = iso.split('-');
            if (yearPart && monthPart) {
                invalidateMonth(queryClient, Number(yearPart), Number(monthPart));
            }
        },
    });
};

export const useSaveShift = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: ShiftDTO) => saveShift(payload),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: hrKeys.shifts() });
        },
    });
};

export const useAssignShift = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: {
            shift_id: string;
            employee_ids: string[];
            effective_from: string;
        }) => assignShift(payload),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: hrKeys.shifts() });
        },
    });
};

export const useSaveHoliday = (year: number) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: HolidayDTO) => saveHoliday(payload),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: hrKeys.holidays(year) });
        },
    });
};

export const useDeleteHoliday = (year: number) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => deleteHoliday(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: hrKeys.holidays(year) });
        },
    });
};

export const useBulkCreateHolidays = (year: number) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (holidays: HolidayDTO[]) => bulkCreateHolidays(holidays),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: hrKeys.holidays(year) });
        },
    });
};

export const useSaveAttendanceConfig = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: AttendanceConfigDTO) => saveAttendanceConfig(payload),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: hrKeys.attendanceConfig() });
        },
    });
};
