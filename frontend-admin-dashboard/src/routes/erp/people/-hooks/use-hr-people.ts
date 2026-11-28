import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import {
    createEmployee,
    createEmployeeFromStaff,
    deactivateDepartment,
    fetchDepartments,
    fetchDesignations,
    fetchEmployee,
    fetchEmployees,
    fetchSalaryStructures,
    fetchStaffBridge,
    hrKeys,
    saveDepartment,
    saveDesignation,
    updateEmployee,
    updateEmployeeStatus,
    type EmployeeListFilters,
    type StaffBridgeFilters,
} from '@/routes/erp/-shared/hr-service';
import type {
    DepartmentDTO,
    DesignationDTO,
    EmployeeProfileDTO,
} from '@/routes/erp/-shared/hr-types';

/**
 * Query/mutation layer for ERP → People.
 *
 * Fetchers and query keys both live in `erp/-shared/hr-service`; this module only
 * binds them to TanStack Query so the screens contain no cache plumbing.
 */

/** How long each kind of record stays fresh. */
const REFERENCE_STALE_MS = 5 * 60 * 1000; // departments/designations barely change
const RECORD_STALE_MS = 60 * 1000; // an employee or their salary
const LIST_STALE_MS = 30 * 1000; // lists an admin edits and expects to see move

/**
 * Prefix for every paginated employees key. `hrKeys.employees(filters)` embeds the
 * filters as the last segment, so invalidating the exact key would leave every
 * OTHER filter combination in the cache stale — dropping the trailing segment
 * invalidates the whole family. Derived from the factory so it cannot drift.
 */
const employeesPrefix = () => hrKeys.employees().slice(0, -1);
const staffBridgePrefix = () => hrKeys.staffBridge().slice(0, -1);

// ───────────────────────── Reads ─────────────────────────

export const useEmployees = (filters: EmployeeListFilters) =>
    useQuery({
        queryKey: hrKeys.employees({ ...filters }),
        queryFn: () => fetchEmployees(filters),
        enabled: !!getInstituteId(),
        staleTime: LIST_STALE_MS,
    });

/**
 * A single (large) page of employees, for the "reporting manager" picker. The
 * endpoint has no name-search mode, so the picker needs the list up front.
 */
export const useEmployeeOptions = (enabled = true) =>
    useQuery({
        queryKey: hrKeys.employees({ purpose: 'options' }),
        queryFn: () => fetchEmployees({ page: 0, size: 200 }),
        enabled: enabled && !!getInstituteId(),
        staleTime: REFERENCE_STALE_MS,
    });

export const useEmployee = (id: string) =>
    useQuery({
        queryKey: hrKeys.employee(id),
        queryFn: () => fetchEmployee(id),
        enabled: !!id && !!getInstituteId(),
        staleTime: RECORD_STALE_MS,
    });

export const useDepartments = () =>
    useQuery({
        queryKey: hrKeys.departments(),
        queryFn: fetchDepartments,
        enabled: !!getInstituteId(),
        staleTime: REFERENCE_STALE_MS,
    });

export const useDesignations = () =>
    useQuery({
        queryKey: hrKeys.designations(),
        queryFn: fetchDesignations,
        enabled: !!getInstituteId(),
        staleTime: REFERENCE_STALE_MS,
    });

export const useStaffBridge = (filters: StaffBridgeFilters) =>
    useQuery({
        queryKey: hrKeys.staffBridge({ ...filters }),
        queryFn: () => fetchStaffBridge(filters),
        enabled: !!getInstituteId(),
        staleTime: LIST_STALE_MS,
    });

export const useSalaryStructures = (employeeId: string) =>
    useQuery({
        queryKey: hrKeys.salaryStructures(employeeId),
        queryFn: () => fetchSalaryStructures(employeeId),
        enabled: !!employeeId && !!getInstituteId(),
        staleTime: RECORD_STALE_MS,
    });

// ───────────────────────── Mutations ─────────────────────────

export const useCreateEmployee = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: EmployeeProfileDTO) => createEmployee(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: employeesPrefix() });
            // A new profile removes a row from "staff without an HR profile".
            queryClient.invalidateQueries({ queryKey: staffBridgePrefix() });
        },
    });
};

export const useUpdateEmployee = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, payload }: { id: string; payload: EmployeeProfileDTO }) =>
            updateEmployee(id, payload),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: hrKeys.employee(variables.id) });
            queryClient.invalidateQueries({ queryKey: employeesPrefix() });
        },
    });
};

export const useUpdateEmployeeStatus = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({
            id,
            payload,
        }: {
            id: string;
            payload: {
                employment_status: string;
                last_working_date?: string;
                exit_reason?: string;
            };
        }) => updateEmployeeStatus(id, payload),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: hrKeys.employee(variables.id) });
            queryClient.invalidateQueries({ queryKey: employeesPrefix() });
        },
    });
};

export const useSaveDepartment = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: DepartmentDTO) => saveDepartment(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: hrKeys.departments() });
            // Employee rows carry a denormalized department_name.
            queryClient.invalidateQueries({ queryKey: employeesPrefix() });
        },
    });
};

export const useDeactivateDepartment = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => deactivateDepartment(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: hrKeys.departments() });
            queryClient.invalidateQueries({ queryKey: employeesPrefix() });
        },
    });
};

export const useSaveDesignation = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: DesignationDTO) => saveDesignation(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: hrKeys.designations() });
            queryClient.invalidateQueries({ queryKey: employeesPrefix() });
        },
    });
};

export const useCreateEmployeeFromStaff = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: {
            user_id: string;
            employee_code?: string;
            join_date?: string;
            department_id?: string;
            designation_id?: string;
        }) => createEmployeeFromStaff(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: staffBridgePrefix() });
            queryClient.invalidateQueries({ queryKey: employeesPrefix() });
        },
    });
};
