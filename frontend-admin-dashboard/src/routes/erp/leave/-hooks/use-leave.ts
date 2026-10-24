import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import {
    actOnCompOff,
    actOnLeaveApplication,
    adjustLeaveBalance,
    cancelLeaveApplication,
    fetchCompOffs,
    fetchLeaveApplications,
    fetchLeaveBalances,
    fetchLeavePolicies,
    fetchLeaveTypes,
    hrKeys,
    runLeaveAccrual,
    runLeaveYearEnd,
    saveLeavePolicy,
    saveLeaveType,
} from '@/routes/erp/-shared/hr-service';
import type { LeavePolicyDTO, LeaveTypeDTO } from '@/routes/erp/-shared/hr-types';

/**
 * Query/mutation layer for ERP → Leave.
 *
 * Fetchers and query keys both live in `erp/-shared/hr-service`; this module only
 * binds them to TanStack Query, and — more importantly — owns the invalidation
 * fan-out. Leave decisions ripple further than the row you clicked: approving an
 * application spends balance AND writes ON_LEAVE attendance for those days, and
 * an accrual or year-end run rewrites every balance in the institute. Keeping
 * that fan-out here means no screen has to remember it.
 */

const REFERENCE_STALE_MS = 5 * 60 * 1000; // leave types/policies barely change
const LIST_STALE_MS = 30 * 1000; // queues an admin acts on and expects to see move

/**
 * Prefixes for the keys that embed a filter in their last segments. Invalidating
 * the exact key would leave every OTHER filter combination stale — a request
 * approved from the Pending chip has to disappear from Pending AND appear under
 * Approved. Derived from the key factories so they cannot drift.
 */
const applicationsPrefix = () => hrKeys.leaveApplications().slice(0, -2);
const balancesPrefix = () => hrKeys.leaveBalances(0).slice(0, -2);
const compOffsPrefix = () => hrKeys.compOffs().slice(0, -1);
const attendancePrefix = () => hrKeys.attendance(0, 0).slice(0, -3);

// ───────────────────────── Reads ─────────────────────────

export const useLeaveTypes = () =>
    useQuery({
        queryKey: hrKeys.leaveTypes(),
        queryFn: fetchLeaveTypes,
        enabled: !!getInstituteId(),
        staleTime: REFERENCE_STALE_MS,
    });

export const useLeavePolicies = () =>
    useQuery({
        queryKey: hrKeys.leavePolicies(),
        queryFn: fetchLeavePolicies,
        enabled: !!getInstituteId(),
        staleTime: REFERENCE_STALE_MS,
    });

export const useLeaveApplications = (status?: string, employeeId?: string) =>
    useQuery({
        queryKey: hrKeys.leaveApplications(status, employeeId),
        queryFn: () => fetchLeaveApplications({ status, employeeId }),
        enabled: !!getInstituteId(),
        staleTime: LIST_STALE_MS,
    });

export const useLeaveBalances = (year: number, employeeId?: string) =>
    useQuery({
        queryKey: hrKeys.leaveBalances(year, employeeId),
        queryFn: () => fetchLeaveBalances({ year, employeeId }),
        enabled: !!getInstituteId(),
        staleTime: LIST_STALE_MS,
    });

export const useCompOffs = (employeeId?: string) =>
    useQuery({
        queryKey: hrKeys.compOffs(employeeId),
        queryFn: () => fetchCompOffs(employeeId),
        enabled: !!getInstituteId(),
        staleTime: LIST_STALE_MS,
    });

// ───────────────────────── Mutations ─────────────────────────

/**
 * Approve or reject one application.
 *
 * The backend re-checks the balance at approval time and refuses when the month
 * is payroll-locked, so callers must surface the rejection message rather than
 * assume success — see `LeaveActionDialog`.
 */
export const useActOnLeaveApplication = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({
            id,
            status,
            rejectionReason,
        }: {
            id: string;
            status: 'APPROVED' | 'REJECTED';
            rejectionReason?: string;
        }) =>
            actOnLeaveApplication(id, {
                status,
                ...(rejectionReason ? { rejection_reason: rejectionReason } : {}),
            }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: applicationsPrefix() });
            // An approval spends balance and writes ON_LEAVE attendance for the dates.
            void queryClient.invalidateQueries({ queryKey: balancesPrefix() });
            void queryClient.invalidateQueries({ queryKey: attendancePrefix() });
        },
    });
};

export const useCancelLeaveApplication = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => cancelLeaveApplication(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: applicationsPrefix() });
            // Cancelling an approved leave returns the days and clears the attendance.
            void queryClient.invalidateQueries({ queryKey: balancesPrefix() });
            void queryClient.invalidateQueries({ queryKey: attendancePrefix() });
        },
    });
};

export const useAdjustLeaveBalance = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({
            id,
            adjustment,
            reason,
        }: {
            id: string;
            adjustment: number;
            reason?: string;
        }) => adjustLeaveBalance(id, { adjustment, ...(reason ? { reason } : {}) }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: balancesPrefix() });
        },
    });
};

export const useRunLeaveAccrual = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => runLeaveAccrual(),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: balancesPrefix() });
        },
    });
};

export const useRunLeaveYearEnd = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => runLeaveYearEnd(),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: balancesPrefix() });
        },
    });
};

export const useActOnCompOff = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
            actOnCompOff(id, { status }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: compOffsPrefix() });
            // An approved comp-off credits the employee's COMP_OFF balance.
            void queryClient.invalidateQueries({ queryKey: balancesPrefix() });
        },
    });
};

export const useSaveLeaveType = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: LeaveTypeDTO) => saveLeaveType(payload),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: hrKeys.leaveTypes() });
            // Policy rows carry a denormalized leave_type_name.
            void queryClient.invalidateQueries({ queryKey: hrKeys.leavePolicies() });
        },
    });
};

export const useSaveLeavePolicy = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: LeavePolicyDTO) => saveLeavePolicy(payload),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: hrKeys.leavePolicies() });
        },
    });
};
