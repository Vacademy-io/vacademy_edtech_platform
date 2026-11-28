import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { useMyEmployeeProfile } from '@/hooks/use-my-employee-profile';
import {
    applyForLeave,
    cancelLeaveApplication,
    checkIn,
    checkOut,
    fetchAttendanceConfig,
    fetchAttendanceRecords,
    fetchCompOffs,
    fetchLeaveApplications,
    fetchLeaveBalances,
    fetchLeaveTypes,
    fetchMyLoans,
    fetchMyPayslips,
    fetchMyReimbursements,
    fetchTaxDeclaration,
    hrKeys,
    submitReimbursement,
    submitTaxDeclaration,
    updateTaxDeclaration,
} from '@/routes/erp/-shared/hr-service';
import type {
    AttendanceRecordDTO,
    CompOffDTO,
    LeaveApplicationDTO,
    LeaveBalanceDTO,
    PayslipDTO,
} from '@/routes/erp/-shared/hr-types';
import {
    asList,
    type EmployeeLoanDTO,
    type ReimbursementDTO,
} from '@/routes/erp/my-hr/-components/my-hr-shared';

/**
 * Query/mutation layer for ERP → My HR.
 *
 * Every read here is scoped to ONE employee — the signed-in user's own record,
 * from `useMyEmployeeProfile`. The backend enforces that (`requireSelfOrHrStaff`
 * on each endpoint); passing the id is what makes the request answerable at all,
 * since the institute-wide variants of these endpoints are HR-staff only. That
 * is why every hook here is `enabled: !!employeeId` rather than merely
 * `!!instituteId` — firing without an id produces a 403, not an empty list.
 */

const REFERENCE_STALE_MS = 5 * 60 * 1000; // leave types, attendance config
const LIST_STALE_MS = 30 * 1000; // lists the employee acts on and expects to move

const enabledFor = (employeeId: string | null) => !!getInstituteId() && !!employeeId;

/**
 * The signed-in user as an employee.
 *
 * `hasNoProfile` is deliberately false while the lookup is in flight: rendering
 * "you have no employee profile" for a beat before the record arrives is worse
 * than a skeleton, because it reads as a verdict rather than a wait.
 */
export function useMyHrIdentity() {
    const { profile, employeeId, isLoading } = useMyEmployeeProfile();
    return {
        profile,
        employeeId,
        isProfileLoading: isLoading,
        hasNoProfile: !isLoading && !employeeId,
    };
}

// ───────────────────────── Attendance ─────────────────────────

/**
 * The institute's attendance settings, or null.
 *
 * `GET /attendance/config` is HR-staff-only, so for an ordinary employee this
 * resolves to null (the fetcher swallows the 403). Null therefore means "not
 * visible to me", NOT "day-level" — see `selfCheckInAvailable`.
 */
export const useMyAttendanceConfig = () =>
    useQuery({
        queryKey: hrKeys.attendanceConfig(),
        queryFn: fetchAttendanceConfig,
        enabled: !!getInstituteId(),
        staleTime: REFERENCE_STALE_MS,
    });

/**
 * Whether to offer the employee a check-in button.
 *
 * The backend refuses self check-in for exactly one reason — the institute is on
 * DAY_LEVEL marking (`requireTimeTrackingMode` throws only for that mode, and
 * lets a null config through). Since a non-HR employee cannot read the config at
 * all, treating "unknown" as "no button" would hide check-in from nearly
 * everyone it is built for. So the button is offered unless we positively know
 * the institute marks attendance day-level.
 */
export const selfCheckInAvailable = (mode: string | null | undefined): boolean =>
    (mode ?? '').toUpperCase() !== 'DAY_LEVEL';

export const useMyAttendanceMonth = (employeeId: string | null, month: number, year: number) =>
    useQuery({
        queryKey: hrKeys.attendance(year, month, employeeId ?? undefined),
        queryFn: async (): Promise<AttendanceRecordDTO[]> =>
            asList<AttendanceRecordDTO>(
                await fetchAttendanceRecords({ month, year, employeeId: employeeId ?? undefined })
            ),
        enabled: enabledFor(employeeId),
        staleTime: LIST_STALE_MS,
    });

/**
 * Coordinates for a check-in, or `undefined` — never a rejection.
 *
 * Geolocation is a nicety here, not a gate: the institute may not run a
 * geo-fence at all, and if it does, the backend is the one that decides. A
 * browser prompt the user dismisses, a device with location off, or a fix that
 * takes too long must not stop someone marking their day — the request goes
 * without coordinates and the backend answers ("Location coordinates are
 * required for check-in"), which is a far better message than anything the
 * client could invent. The manual timer exists because `getCurrentPosition`'s
 * own `timeout` is not honoured consistently once a permission prompt is on
 * screen.
 */
export const readCoordinates = (
    timeoutMs = 6000
): Promise<{ latitude: number; longitude: number } | undefined> =>
    new Promise((resolve) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            resolve(undefined);
            return;
        }
        let settled = false;
        const finish = (value: { latitude: number; longitude: number } | undefined) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve(value);
        };
        // Declared after `finish` because `finish` clears it; both only ever run
        // from a callback, by which point the binding is initialized.
        const timer = window.setTimeout(() => finish(undefined), timeoutMs);
        navigator.geolocation.getCurrentPosition(
            (position) =>
                finish({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                }),
            () => finish(undefined),
            { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 }
        );
    });

/**
 * Check in or out. Returns the backend's own sentence so the card can show it.
 *
 * Deliberately does NOT pass an employee id: the endpoint resolves the caller
 * itself, and a client-supplied id is exactly what the guard is there to refuse.
 */
export const useCheckInOut = (employeeId: string | null) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (direction: 'IN' | 'OUT'): Promise<string> => {
            const coordinates = await readCoordinates();
            const payload = coordinates ?? {};
            return direction === 'IN' ? checkIn(payload) : checkOut(payload);
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: hrKeys.attendance(0, 0, employeeId ?? undefined).slice(0, -3),
            });
        },
    });
};

// ───────────────────────── Leave ─────────────────────────

export const useMyLeaveTypes = () =>
    useQuery({
        queryKey: hrKeys.leaveTypes(),
        queryFn: fetchLeaveTypes,
        enabled: !!getInstituteId(),
        staleTime: REFERENCE_STALE_MS,
    });

export const useMyLeaveBalances = (employeeId: string | null, year: number) =>
    useQuery({
        queryKey: hrKeys.leaveBalances(year, employeeId ?? undefined),
        queryFn: async (): Promise<LeaveBalanceDTO[]> =>
            asList<LeaveBalanceDTO>(
                await fetchLeaveBalances({ year, employeeId: employeeId ?? undefined })
            ),
        enabled: enabledFor(employeeId),
        staleTime: LIST_STALE_MS,
    });

export const useMyLeaveApplications = (employeeId: string | null) =>
    useQuery({
        queryKey: hrKeys.leaveApplications(undefined, employeeId ?? undefined),
        queryFn: async (): Promise<LeaveApplicationDTO[]> =>
            asList<LeaveApplicationDTO>(
                await fetchLeaveApplications({ employeeId: employeeId ?? undefined })
            ),
        enabled: enabledFor(employeeId),
        staleTime: LIST_STALE_MS,
    });

export const useMyCompOffs = (employeeId: string | null) =>
    useQuery({
        queryKey: hrKeys.compOffs(employeeId ?? undefined),
        queryFn: async (): Promise<CompOffDTO[]> =>
            asList<CompOffDTO>(await fetchCompOffs(employeeId ?? undefined)),
        enabled: enabledFor(employeeId),
        staleTime: LIST_STALE_MS,
    });

/**
 * Applying spends balance the moment it is approved, so both the applications
 * list and the balance cards are invalidated — the employee's next glance at the
 * balance has to agree with what they just did.
 */
export const useApplyForLeave = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: {
            employee_id: string;
            leave_type_id: string;
            from_date: string;
            to_date: string;
            is_half_day?: boolean;
            half_day_type?: string;
            reason?: string;
        }) => applyForLeave(payload),
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: hrKeys.leaveApplications().slice(0, -2),
            });
            void queryClient.invalidateQueries({ queryKey: hrKeys.leaveBalances(0).slice(0, -2) });
        },
    });
};

export const useCancelMyLeave = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => cancelLeaveApplication(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: hrKeys.leaveApplications().slice(0, -2),
            });
            // Cancelling an approved leave returns the days and clears the ON_LEAVE days.
            void queryClient.invalidateQueries({ queryKey: hrKeys.leaveBalances(0).slice(0, -2) });
            void queryClient.invalidateQueries({ queryKey: hrKeys.attendance(0, 0).slice(0, -3) });
        },
    });
};

// ───────────────────────── Payslips ─────────────────────────

export const useMyPayslips = (employeeId: string | null, year: number) =>
    useQuery({
        queryKey: hrKeys.myPayslips(employeeId ?? '', year),
        queryFn: async (): Promise<PayslipDTO[]> =>
            asList<PayslipDTO>(await fetchMyPayslips(employeeId ?? '', year)),
        enabled: enabledFor(employeeId),
        staleTime: LIST_STALE_MS,
    });

// ───────────────────────── Tax declaration ─────────────────────────

export const useMyTaxDeclaration = (employeeId: string | null, financialYear: string) =>
    useQuery({
        queryKey: hrKeys.taxDeclaration(employeeId ?? '', financialYear),
        queryFn: () => fetchTaxDeclaration(employeeId ?? '', financialYear),
        enabled: enabledFor(employeeId),
        staleTime: LIST_STALE_MS,
    });

/**
 * Save the declaration — POST when there is none yet, PUT when there is.
 *
 * The backend refuses a second POST for the same employee and FY ("Tax
 * declaration already exists … Use update instead"), so the choice is made from
 * the record we already hold rather than by trying one and falling back.
 */
export const useSaveTaxDeclaration = (employeeId: string | null, financialYear: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({
            declarationId,
            regime,
            declarations,
        }: {
            declarationId?: string;
            regime: string;
            declarations: Record<string, unknown>;
        }) =>
            declarationId
                ? updateTaxDeclaration(declarationId, { regime, declarations })
                : submitTaxDeclaration({
                      employee_id: employeeId ?? '',
                      financial_year: financialYear,
                      regime,
                      declarations,
                  }),
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: hrKeys.taxDeclaration(employeeId ?? '', financialYear),
            });
        },
    });
};

// ───────────────────────── Claims ─────────────────────────

export const useMyReimbursements = (employeeId: string | null) =>
    useQuery({
        queryKey: hrKeys.myReimbursements(employeeId ?? ''),
        queryFn: async (): Promise<ReimbursementDTO[]> =>
            asList<ReimbursementDTO>(await fetchMyReimbursements(employeeId ?? '')),
        enabled: enabledFor(employeeId),
        staleTime: LIST_STALE_MS,
    });

export const useMyLoans = (employeeId: string | null) =>
    useQuery({
        queryKey: hrKeys.myLoans(employeeId ?? ''),
        queryFn: async (): Promise<EmployeeLoanDTO[]> =>
            asList<EmployeeLoanDTO>(await fetchMyLoans(employeeId ?? '')),
        enabled: enabledFor(employeeId),
        staleTime: LIST_STALE_MS,
    });

export const useSubmitReimbursement = (employeeId: string | null) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: {
            employee_id: string;
            type: string;
            amount: number;
            description?: string;
            expense_date?: string;
        }) => submitReimbursement(payload),
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: hrKeys.myReimbursements(employeeId ?? ''),
            });
        },
    });
};
