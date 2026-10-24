import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import {
    ERP_JOURNAL,
    ERP_JOURNAL_EXPORT,
    ERP_PNL_SNAPSHOT,
    ERP_PNL_SNAPSHOT_DOWNLOAD,
    HR_DEPARTMENTS,
    HR_DEPARTMENT_BY_ID,
    HR_DESIGNATIONS,
    HR_DESIGNATION_BY_ID,
    HR_EMPLOYEES,
    HR_EMPLOYEE_BY_ID,
    HR_EMPLOYEE_FROM_STAFF,
    HR_EMPLOYEE_STATUS,
    HR_PAYROLL_ADJUSTMENTS,
    HR_PAYROLL_ADJUSTMENT_BY_ID,
    HR_PAYROLL_ENTRY_HOLD,
    HR_PAYROLL_ENTRY_RELEASE,
    HR_PAYROLL_RUNS,
    HR_PAYROLL_RUN_APPROVE,
    HR_PAYROLL_RUN_BY_ID,
    HR_PAYROLL_RUN_ENTRIES,
    HR_PAYROLL_RUN_ERRORS,
    HR_PAYROLL_RUN_MARK_PAID,
    HR_PAYROLL_RUN_PROCESS,
    HR_PAYROLL_RUN_REJECT,
    HR_PAYSLIPS,
    HR_PAYSLIPS_EMAIL,
    HR_PAYSLIPS_GENERATE,
    HR_PAYSLIP_DOWNLOAD,
    HR_BANK_EXPORT,
    HR_BANK_EXPORT_DOWNLOAD,
    HR_SALARY_COMPONENTS,
    HR_SALARY_COMPONENT_BY_ID,
    HR_SALARY_STRUCTURES,
    HR_SALARY_TEMPLATES,
    HR_SALARY_TEMPLATE_BY_ID,
    HR_STAFF_BRIDGE,
    HR_TAX_CONFIG,
    HR_COMPLIANCE_PF_ECR,
    HR_COMPLIANCE_ESI_RETURN,
    HR_COMPLIANCE_PT_RETURN,
    HR_COMPLIANCE_WPS,
    HR_COMPLIANCE_FORM16,
    HR_COMPLIANCE_24Q,
    HR_COMPLIANCE_CHALLANS,
    HR_COMPLIANCE_CHALLAN_BY_ID,
    HR_COMPLIANCE_GRATUITY,
    HR_COMPLIANCE_EOSB,
    HR_COMPLIANCE_BONUS,
    HR_COMPLIANCE_BONUS_MATERIALIZE,
    HR_ATTENDANCE,
    HR_ATTENDANCE_CONFIG,
    HR_ATTENDANCE_MARK,
    HR_ATTENDANCE_SUMMARY,
    HR_ATTENDANCE_REGULARIZATION,
    HR_ATTENDANCE_REGULARIZATION_ACTION,
    HR_SHIFTS,
    HR_SHIFT_BY_ID,
    HR_SHIFTS_ASSIGN,
    HR_HOLIDAYS,
    HR_HOLIDAY_BY_ID,
    HR_HOLIDAYS_BULK,
    HR_LEAVE_TYPES,
    HR_LEAVE_TYPE_BY_ID,
    HR_LEAVE_POLICIES,
    HR_LEAVE_POLICY_BY_ID,
    HR_LEAVE_APPLICATIONS,
    HR_LEAVE_APPLICATION_ACTION,
    HR_LEAVE_APPLICATION_CANCEL,
    HR_LEAVE_BALANCES,
    HR_LEAVE_BALANCE_ADJUST,
    HR_LEAVE_ACCRUE,
    HR_LEAVE_YEAR_END,
    HR_COMP_OFF,
    HR_COMP_OFF_ACTION,
    HR_ATTENDANCE_CHECK_IN,
    HR_ATTENDANCE_CHECK_OUT,
    HR_LEAVE_APPLY,
    HR_TAX_DECLARATIONS,
    HR_TAX_DECLARATION_BY_ID,
    HR_REIMBURSEMENTS,
    HR_PAYROLL_LOANS,
} from '@/constants/urls';
import type {
    AssignSalaryPayload,
    BankExportDTO,
    BankExportFormat,
    BankExportResult,
    BankExportSkippedEntry,
    CreatePayrollRunPayload,
    DepartmentDTO,
    DesignationDTO,
    EmployeeProfileDTO,
    EmployeeSalaryStructureDTO,
    JournalEntryDTO,
    PnlSnapshotDTO,
    PayrollAdjustmentDTO,
    PayrollEntryDTO,
    PayrollEntryError,
    PayrollRunDTO,
    PayslipDTO,
    PayslipEmailOutcome,
    PayslipEmailResult,
    SalaryComponentDTO,
    SalaryTemplateDTO,
    StaffBridgeResponse,
    TaxConfigurationDTO,
    PfEcrResponseDTO,
    EsiReturnResponseDTO,
    PtReturnResponseDTO,
    WpsExportResponseDTO,
    Form16DataDTO,
    Form24QResponseDTO,
    TdsChallanDTO,
    CreateTdsChallanPayload,
    GratuityProvisionReportDTO,
    EosbProvisionReportDTO,
    BonusComputationReportDTO,
    BonusMaterializationResultDTO,
    AttendanceConfigDTO,
    AttendanceRecordDTO,
    AttendanceSummaryRowDTO,
    RegularizationDTO,
    ShiftDTO,
    HolidayDTO,
    LeaveTypeDTO,
    LeavePolicyDTO,
    LeaveApplicationDTO,
    LeaveBalanceDTO,
    CompOffDTO,
    TaxDeclarationDTO,
} from '@/routes/erp/-shared/hr-types';

/**
 * HR & Payroll data layer.
 *
 * One module for the whole ERP surface so the query-key namespace stays in a
 * single place — payroll mutations invalidate across module boundaries all the
 * time (approving a run changes the journal; materializing an adjustment changes
 * the next run), and scattering keys per route makes those invalidations
 * guesswork.
 *
 * Every call passes the institute as a query param (`instituteId`), never in the
 * body: the backend deliberately ignores body-supplied institute ids after a
 * cross-tenant spoofing fix, so a body field would be silently dropped.
 */

const instituteParams = (extra?: Record<string, unknown>) => ({
    params: { instituteId: getInstituteId(), ...(extra ?? {}) },
});


/**
 * Unwrap a Spring response that may be a `Page` or a plain array.
 *
 * Several HR endpoints return `Page<T>` (leave applications, reimbursements)
 * while others return a bare list, and the difference is not visible from the
 * URL. Spreading a Page yields nothing useful, so every list fetcher whose
 * endpoint paginates goes through this instead of trusting the shape.
 */
const asList = <T,>(data: unknown): T[] => {
    if (Array.isArray(data)) return data as T[];
    const content = (data as { content?: unknown } | null | undefined)?.content;
    return Array.isArray(content) ? (content as T[]) : [];
};

/** Root of every ERP query key — `queryClient.invalidateQueries({ queryKey: ERP_KEY })` clears all. */
export const ERP_KEY = ['erp'] as const;

export const hrKeys = {
    employees: (filters?: Record<string, unknown>) => [...ERP_KEY, 'employees', filters ?? {}],
    employee: (id: string) => [...ERP_KEY, 'employee', id],
    departments: () => [...ERP_KEY, 'departments'],
    designations: () => [...ERP_KEY, 'designations'],
    staffBridge: (filters?: Record<string, unknown>) => [...ERP_KEY, 'staff-bridge', filters ?? {}],
    salaryComponents: () => [...ERP_KEY, 'salary-components'],
    salaryTemplates: () => [...ERP_KEY, 'salary-templates'],
    salaryTemplate: (id: string) => [...ERP_KEY, 'salary-template', id],
    salaryStructures: (employeeId: string) => [...ERP_KEY, 'salary-structures', employeeId],
    payrollRuns: (year?: number) => [...ERP_KEY, 'payroll-runs', year ?? 'all'],
    payrollRun: (id: string) => [...ERP_KEY, 'payroll-run', id],
    payrollEntries: (runId: string) => [...ERP_KEY, 'payroll-entries', runId],
    payrollErrors: (runId: string) => [...ERP_KEY, 'payroll-errors', runId],
    adjustments: (year: number, month: number) => [...ERP_KEY, 'adjustments', year, month],
    payslips: (runId: string) => [...ERP_KEY, 'payslips', runId],
    bankExports: (runId: string) => [...ERP_KEY, 'bank-exports', runId],
    employeeDirectory: () => [...ERP_KEY, 'employee-directory'],
    journal: (year: number, month: number) => [...ERP_KEY, 'journal', year, month],
    pnlSnapshot: (year: number, month: number) => [...ERP_KEY, 'pnl-snapshot', year, month],
    taxConfig: () => [...ERP_KEY, 'tax-config'],
    challans: (fy: string, quarter?: string) => [...ERP_KEY, 'challans', fy, quarter ?? 'all'],
    gratuity: (asOf?: string) => [...ERP_KEY, 'gratuity', asOf ?? 'today'],
    eosb: (asOf?: string) => [...ERP_KEY, 'eosb', asOf ?? 'today'],
    bonus: (fy: string, pct: number) => [...ERP_KEY, 'bonus', fy, pct],
    attendanceConfig: () => [...ERP_KEY, 'attendance-config'],
    attendance: (year: number, month: number, employeeId?: string) => [
        ...ERP_KEY,
        'attendance',
        year,
        month,
        employeeId ?? 'all',
    ],
    attendanceSummary: (year: number, month: number) => [
        ...ERP_KEY,
        'attendance-summary',
        year,
        month,
    ],
    regularizations: (status?: string) => [...ERP_KEY, 'regularizations', status ?? 'all'],
    shifts: () => [...ERP_KEY, 'shifts'],
    holidays: (year: number) => [...ERP_KEY, 'holidays', year],
    leaveTypes: () => [...ERP_KEY, 'leave-types'],
    leavePolicies: () => [...ERP_KEY, 'leave-policies'],
    leaveApplications: (status?: string, employeeId?: string) => [
        ...ERP_KEY,
        'leave-applications',
        status ?? 'all',
        employeeId ?? 'all',
    ],
    leaveBalances: (year: number, employeeId?: string) => [
        ...ERP_KEY,
        'leave-balances',
        year,
        employeeId ?? 'all',
    ],
    compOffs: (employeeId?: string) => [...ERP_KEY, 'comp-offs', employeeId ?? 'all'],
    myPayslips: (employeeId: string, year: number) => [...ERP_KEY, 'my-payslips', employeeId, year],
    taxDeclaration: (employeeId: string, fy: string) => [...ERP_KEY, 'tax-declaration', employeeId, fy],
    myReimbursements: (employeeId: string) => [...ERP_KEY, 'my-reimbursements', employeeId],
    myLoans: (employeeId: string) => [...ERP_KEY, 'my-loans', employeeId],
};

// ───────────────────────── People ─────────────────────────

export interface EmployeeListFilters {
    page?: number;
    size?: number;
    status?: string;
    departmentId?: string;
    designationId?: string;
    employmentType?: string;
}

/**
 * Employees, paginated. The endpoint returns a Spring `Page`, whose field names
 * already match MyTable's TableData shape except for `content`/`totalPages` —
 * normalized here so every caller can hand the result straight to MyTable.
 */
export const fetchEmployees = async (filters: EmployeeListFilters = {}) => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_EMPLOYEES,
        instituteParams({
            page: filters.page ?? 0,
            size: filters.size ?? 10,
            status: filters.status,
            departmentId: filters.departmentId,
            designationId: filters.designationId,
            employmentType: filters.employmentType,
        })
    );
    return {
        content: (data?.content ?? []) as EmployeeProfileDTO[],
        total_pages: data?.totalPages ?? data?.total_pages ?? 1,
        page_no: data?.number ?? data?.page_no ?? 0,
        page_size: data?.size ?? data?.page_size ?? 10,
        total_elements: data?.totalElements ?? data?.total_elements ?? 0,
        last: data?.last ?? true,
    };
};

export const fetchEmployee = async (id: string): Promise<EmployeeProfileDTO> => {
    const { data } = await authenticatedAxiosInstance.get(HR_EMPLOYEE_BY_ID(id), instituteParams());
    return data;
};

export const createEmployee = async (payload: EmployeeProfileDTO): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(HR_EMPLOYEES, payload, instituteParams());
    return data;
};

export const updateEmployee = async (id: string, payload: EmployeeProfileDTO): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.put(
        HR_EMPLOYEE_BY_ID(id),
        payload,
        instituteParams()
    );
    return data;
};

export const updateEmployeeStatus = async (
    id: string,
    payload: { employment_status: string; last_working_date?: string; exit_reason?: string }
): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.put(
        HR_EMPLOYEE_STATUS(id),
        payload,
        instituteParams()
    );
    return data;
};

export const fetchDepartments = async (): Promise<DepartmentDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(HR_DEPARTMENTS, instituteParams());
    return data ?? [];
};

export const saveDepartment = async (payload: DepartmentDTO): Promise<string> => {
    const { data } = payload.id
        ? await authenticatedAxiosInstance.put(
              HR_DEPARTMENT_BY_ID(payload.id),
              payload,
              instituteParams()
          )
        : await authenticatedAxiosInstance.post(HR_DEPARTMENTS, payload, instituteParams());
    return data;
};

export const deactivateDepartment = async (id: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(HR_DEPARTMENT_BY_ID(id), instituteParams());
};

export const fetchDesignations = async (): Promise<DesignationDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(HR_DESIGNATIONS, instituteParams());
    return data ?? [];
};

export const saveDesignation = async (payload: DesignationDTO): Promise<string> => {
    const { data } = payload.id
        ? await authenticatedAxiosInstance.put(
              HR_DESIGNATION_BY_ID(payload.id),
              payload,
              instituteParams()
          )
        : await authenticatedAxiosInstance.post(HR_DESIGNATIONS, payload, instituteParams());
    return data;
};

export interface StaffBridgeFilters {
    role?: string;
    search?: string;
    page?: number;
    size?: number;
}

export const fetchStaffBridge = async (
    filters: StaffBridgeFilters = {}
): Promise<StaffBridgeResponse> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_STAFF_BRIDGE,
        instituteParams({
            role: filters.role,
            search: filters.search,
            page: filters.page ?? 0,
            size: filters.size ?? 25,
        })
    );
    return data ?? {};
};

export const createEmployeeFromStaff = async (payload: {
    user_id: string;
    employee_code?: string;
    join_date?: string;
    department_id?: string;
    designation_id?: string;
}): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_EMPLOYEE_FROM_STAFF,
        payload,
        instituteParams()
    );
    return data;
};

// ───────────────────────── Salary ─────────────────────────

export const fetchSalaryComponents = async (): Promise<SalaryComponentDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(HR_SALARY_COMPONENTS, instituteParams());
    return data ?? [];
};

export const saveSalaryComponent = async (payload: SalaryComponentDTO): Promise<string> => {
    const { data } = payload.id
        ? await authenticatedAxiosInstance.put(
              HR_SALARY_COMPONENT_BY_ID(payload.id),
              payload,
              instituteParams()
          )
        : await authenticatedAxiosInstance.post(HR_SALARY_COMPONENTS, payload, instituteParams());
    return data;
};

export const fetchSalaryTemplates = async (): Promise<SalaryTemplateDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(HR_SALARY_TEMPLATES, instituteParams());
    return data ?? [];
};

export const fetchSalaryTemplate = async (id: string): Promise<SalaryTemplateDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_SALARY_TEMPLATE_BY_ID(id),
        instituteParams()
    );
    return data;
};

export const saveSalaryTemplate = async (payload: SalaryTemplateDTO): Promise<string> => {
    const { data } = payload.id
        ? await authenticatedAxiosInstance.put(
              HR_SALARY_TEMPLATE_BY_ID(payload.id),
              payload,
              instituteParams()
          )
        : await authenticatedAxiosInstance.post(HR_SALARY_TEMPLATES, payload, instituteParams());
    return data;
};

export const fetchSalaryStructures = async (
    employeeId: string
): Promise<EmployeeSalaryStructureDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_SALARY_STRUCTURES,
        instituteParams({ employeeId })
    );
    return data ?? [];
};

export const assignSalaryStructure = async (payload: AssignSalaryPayload): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_SALARY_STRUCTURES,
        payload,
        instituteParams()
    );
    return data;
};

// ───────────────────────── Payroll ─────────────────────────

export const fetchPayrollRuns = async (year?: number): Promise<PayrollRunDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_PAYROLL_RUNS,
        instituteParams(year ? { year } : undefined)
    );
    return data ?? [];
};

export const fetchPayrollRun = async (id: string): Promise<PayrollRunDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_PAYROLL_RUN_BY_ID(id),
        instituteParams()
    );
    return data;
};

export const createPayrollRun = async (payload: CreatePayrollRunPayload): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_PAYROLL_RUNS,
        payload,
        instituteParams()
    );
    return data;
};

/**
 * Process a run. Synchronous server-side and O(employees) — the caller should
 * expect this to take a while on a large institute and must not race it. The
 * response string may carry a partial-failure note ("… N failed — see run
 * errors"), so surface it rather than assuming success means "all paid".
 */
export const processPayrollRun = async (id: string): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_PAYROLL_RUN_PROCESS(id),
        {},
        instituteParams()
    );
    return data;
};

export const approvePayrollRun = async (id: string): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.put(
        HR_PAYROLL_RUN_APPROVE(id),
        {},
        instituteParams()
    );
    return data;
};

/** PROCESSED/APPROVED → DRAFT, reversing loans, reimbursements, tax rows and the journal. */
export const rejectPayrollRun = async (id: string): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.put(
        HR_PAYROLL_RUN_REJECT(id),
        {},
        instituteParams()
    );
    return data;
};

export const markPayrollRunPaid = async (id: string): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.put(
        HR_PAYROLL_RUN_MARK_PAID(id),
        {},
        instituteParams()
    );
    return data;
};

export const cancelPayrollRun = async (id: string): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.delete(
        HR_PAYROLL_RUN_BY_ID(id),
        instituteParams()
    );
    return data;
};

export const fetchPayrollEntries = async (runId: string): Promise<PayrollEntryDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_PAYROLL_RUN_ENTRIES(runId),
        instituteParams()
    );
    return data ?? [];
};

export const fetchPayrollErrors = async (runId: string): Promise<PayrollEntryError[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_PAYROLL_RUN_ERRORS(runId),
        instituteParams()
    );
    return data ?? [];
};

export const holdPayrollEntry = async (id: string, holdReason: string): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.put(
        HR_PAYROLL_ENTRY_HOLD(id),
        { hold_reason: holdReason },
        instituteParams()
    );
    return data;
};

export const releasePayrollEntry = async (id: string): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.put(
        HR_PAYROLL_ENTRY_RELEASE(id),
        {},
        instituteParams()
    );
    return data;
};

// ─────────────────── Variable pay (adjustments) ───────────────────

export const fetchAdjustments = async (
    year: number,
    month: number
): Promise<PayrollAdjustmentDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_PAYROLL_ADJUSTMENTS,
        instituteParams({ year, month })
    );
    return data ?? [];
};

export const createAdjustment = async (payload: PayrollAdjustmentDTO): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_PAYROLL_ADJUSTMENTS,
        payload,
        instituteParams()
    );
    return data;
};

export const deleteAdjustment = async (id: string): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.delete(
        HR_PAYROLL_ADJUSTMENT_BY_ID(id),
        instituteParams()
    );
    return data;
};

// ───────────────────── Finance · journal & P&L ─────────────────────

/**
 * The month's journal entries.
 *
 * Read-only by design: nothing in this UI posts to the ledger. Entries appear
 * when a payroll run is APPROVED and are reversed when that run is rejected, so
 * an empty month is a normal state (nothing approved yet), not an error.
 */
export const fetchJournalEntries = async (
    year: number,
    month: number
): Promise<JournalEntryDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        ERP_JOURNAL,
        instituteParams({ year, month })
    );
    return Array.isArray(data) ? data : [];
};

/** Journal as CSV, shaped for a Zoho Books / Tally import. HR admin only. */
export const downloadJournalCsv = async (year: number, month: number): Promise<Blob> => {
    const { data } = await authenticatedAxiosInstance.get(ERP_JOURNAL_EXPORT, {
        ...instituteParams({ year, month }),
        responseType: 'blob',
    });
    return data as Blob;
};

/**
 * The month's P&L snapshot.
 *
 * Returned verbatim — no normalization here. The response stitches together
 * payments, payroll and the GL, and its nesting is not guaranteed stable, so the
 * shape-probing lives next to the screen that renders it
 * (routes/erp/finance/-hooks/pnl-shape.ts) rather than being baked into a
 * fetcher that would have to lie about what it returns.
 */
export const fetchPnlSnapshot = async (year: number, month: number): Promise<PnlSnapshotDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        ERP_PNL_SNAPSHOT,
        instituteParams({ year, month })
    );
    return (data ?? {}) as PnlSnapshotDTO;
};

/** P&L snapshot as CSV. HR admin only. */
export const downloadPnlSnapshotCsv = async (year: number, month: number): Promise<Blob> => {
    const { data } = await authenticatedAxiosInstance.get(ERP_PNL_SNAPSHOT_DOWNLOAD, {
        ...instituteParams({ year, month }),
        responseType: 'blob',
    });
    return data as Blob;
};

// ─────────────────── Employee name directory ───────────────────

/** One page is enough to name a payroll's worth of people; see the note below. */
export const EMPLOYEE_DIRECTORY_SIZE = 500;

/**
 * Employee ids and codes mapped to names.
 *
 * Payslip and bank-export payloads carry the employee CODE and nothing else, and
 * a table of bare codes is unusable when the actionable output is "chase these
 * people for their bank details". Rather than N profile lookups this pulls one
 * large page of the employee list and resolves locally; anyone past that page
 * degrades to a dash rather than blocking the screen. Status is deliberately
 * unfiltered — an exited employee still appears in their final run.
 */
export const fetchEmployeeDirectory = async (): Promise<EmployeeProfileDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_EMPLOYEES,
        instituteParams({ page: 0, size: EMPLOYEE_DIRECTORY_SIZE })
    );
    return (data?.content ?? []) as EmployeeProfileDTO[];
};

// ───────────────────────── Payslips ─────────────────────────

/**
 * Save bytes we already hold to the user's disk.
 *
 * Payslip and bank-export files are served by authenticated endpoints, so they
 * arrive as a blob through the axios instance and cannot go through
 * `downloadFileFromUrl` (that fetches a public S3 URL with no bearer token).
 * The object URL is revoked on the next tick rather than synchronously after
 * `click()`: Chromium copes with an immediate revoke, Safari and Firefox can
 * still be reading the URL when the download starts.
 */
const saveBlob = (blob: Blob, fileName: string) => {
    const objectUrl = URL.createObjectURL(blob);
    try {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
    } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
};

const numberOr = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Render a PDF payslip for every non-held entry on the run. Returns the server's
 * own sentence, which distinguishes freshly generated payslips from legacy rows
 * it re-rendered — so it is surfaced verbatim rather than replaced with "Done".
 * Refused by the backend unless the run is PROCESSED or later.
 */
export const generatePayslips = async (payrollRunId: string): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_PAYSLIPS_GENERATE,
        { payroll_run_id: payrollRunId },
        instituteParams()
    );
    return typeof data === 'string' ? data : ((data?.message as string | undefined) ?? '');
};

/**
 * One employee's payslips, optionally narrowed to a year.
 *
 * This is the ONLY payslip list the API offers — there is no "by payroll run"
 * endpoint — so a run's payslips are assembled by the caller from its entries.
 */
export const fetchEmployeePayslips = async (
    employeeId: string,
    year?: number
): Promise<PayslipDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_PAYSLIPS,
        instituteParams({ employeeId, year })
    );
    return data ?? [];
};

/** Fetches the PDF bytes (authenticated) and saves them as `fileName`. */
export const downloadPayslipPdf = async (payslipId: string, fileName: string): Promise<void> => {
    const { data } = await authenticatedAxiosInstance.get(HR_PAYSLIP_DOWNLOAD(payslipId), {
        ...instituteParams(),
        responseType: 'blob',
    });
    saveBlob(data as Blob, fileName);
};

/**
 * The API field is `outcomes`; `results` is accepted as well so a rename on the
 * backend degrades to a shorter result dialog instead of an empty one. Counts are
 * recomputed from the list when absent — the per-employee failures are the point
 * of this response and must never be reported as a bare number.
 */
const normalizeEmailResult = (data: unknown): PayslipEmailResult => {
    const body = (data ?? {}) as Record<string, unknown>;
    const raw = body.outcomes ?? body.results;
    const outcomes = (Array.isArray(raw) ? raw : []) as PayslipEmailOutcome[];
    const statusIs = (status: string) =>
        outcomes.filter((outcome) => (outcome.status ?? '').toUpperCase() === status).length;
    return {
        total: numberOr(body.total, outcomes.length),
        sent: numberOr(body.sent, statusIs('SENT')),
        failed: numberOr(body.failed, statusIs('FAILED')),
        outcomes,
    };
};

/** Emails every employee on the run their own payslip PDF. */
export const emailPayslips = async (payrollRunId: string): Promise<PayslipEmailResult> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_PAYSLIPS_EMAIL,
        { payroll_run_id: payrollRunId },
        instituteParams()
    );
    return normalizeEmailResult(data);
};

// ─────────────────────── Bank export ───────────────────────

/**
 * The API nests the export log under `export`; a flatter shape is tolerated by
 * falling back to the body itself, so the result panel still renders totals if
 * the response is ever flattened.
 */
const normalizeBankExportResult = (data: unknown): BankExportResult => {
    const body = (data ?? {}) as Record<string, unknown>;
    const exportLog = (body.export ?? body) as BankExportDTO;
    const skipped = (
        Array.isArray(body.skipped) ? body.skipped : []
    ) as BankExportSkippedEntry[];
    const warnings = (Array.isArray(body.warnings) ? body.warnings : []) as string[];
    return {
        export: exportLog ?? {},
        skipped,
        skipped_count: numberOr(body.skipped_count, skipped.length),
        warnings,
    };
};

/**
 * Build the payment file for a run. Returns JSON describing the file — including
 * the employees it EXCLUDED for missing bank details — not the file itself; the
 * bytes come from {@link downloadBankExportFile}. Backend accepts APPROVED or
 * PAID runs only.
 */
export const generateBankExport = async (
    payrollRunId: string,
    format: BankExportFormat
): Promise<BankExportResult> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_BANK_EXPORT,
        { payroll_run_id: payrollRunId, format },
        instituteParams()
    );
    return normalizeBankExportResult(data);
};

/** Every bank file generated for this run so far, newest first as the API returns them. */
export const fetchBankExports = async (payrollRunId: string): Promise<BankExportDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_BANK_EXPORT,
        instituteParams({ payrollRunId })
    );
    return data ?? [];
};

/** Fetches the generated file (authenticated) and saves it as `fileName`. */
export const downloadBankExportFile = async (
    exportId: string,
    fileName: string
): Promise<void> => {
    const { data } = await authenticatedAxiosInstance.get(HR_BANK_EXPORT_DOWNLOAD(exportId), {
        ...instituteParams(),
        responseType: 'blob',
    });
    saveBlob(data as Blob, fileName);
};

// ───────────────────────── Compliance ─────────────────────────
//
// NOTE the casing split documented in hr-types.ts: the statutory FILINGS
// (ECR/ESI/PT/Form 16/24Q/WPS) and the challan entity are camelCase on the
// wire, while tax config and the provision reports are snake_case. Params are
// query-string either way.

export const fetchTaxConfiguration = async (): Promise<TaxConfigurationDTO | null> => {
    try {
        const { data } = await authenticatedAxiosInstance.get(HR_TAX_CONFIG, instituteParams());
        return data ?? null;
    } catch {
        // An institute that has never configured tax 4xxs here. That is a normal
        // state (it just means "no country set yet"), not an error worth a toast:
        // the caller uses null to decide whether to offer India vs Gulf filings.
        return null;
    }
};

/** ARE | SAU | IND | null — normalized so callers can branch without alias juggling. */
export const resolveComplianceCountry = (
    config: TaxConfigurationDTO | null | undefined
): 'IND' | 'ARE' | 'SAU' | null => {
    const raw = (config?.country_code ?? '').toUpperCase();
    if (!raw) return null;
    if (['ARE', 'UAE', 'AE'].includes(raw)) return 'ARE';
    if (['SAU', 'KSA', 'SA', 'SAUDI'].includes(raw)) return 'SAU';
    if (['IND', 'IN', 'INDIA'].includes(raw)) return 'IND';
    return null;
};

// ── Monthly filings ──

export const fetchPfEcr = async (month: number, year: number): Promise<PfEcrResponseDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_COMPLIANCE_PF_ECR,
        instituteParams({ month, year })
    );
    return data ?? {};
};

export const fetchEsiReturn = async (
    month: number,
    year: number
): Promise<EsiReturnResponseDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_COMPLIANCE_ESI_RETURN,
        instituteParams({ month, year })
    );
    return data ?? {};
};

export const fetchPtReturn = async (month: number, year: number): Promise<PtReturnResponseDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_COMPLIANCE_PT_RETURN,
        instituteParams({ month, year })
    );
    return data ?? {};
};

export const fetchWpsExport = async (
    month: number,
    year: number
): Promise<WpsExportResponseDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_COMPLIANCE_WPS,
        instituteParams({ month, year })
    );
    return data ?? {};
};

// ── TDS filings ──

export const fetchForm16 = async (
    employeeId: string,
    financialYear: string
): Promise<Form16DataDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_COMPLIANCE_FORM16,
        instituteParams({ employeeId, financialYear })
    );
    return data ?? {};
};

export const fetchForm24Q = async (
    financialYear: string,
    quarter: string
): Promise<Form24QResponseDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_COMPLIANCE_24Q,
        instituteParams({ financialYear, quarter })
    );
    return data ?? {};
};

/** Downloads any compliance file endpoint (all return a blob) and saves it. */
export const downloadComplianceFile = async (
    url: string,
    params: Record<string, unknown>,
    fileName: string
): Promise<void> => {
    const { data } = await authenticatedAxiosInstance.get(url, {
        ...instituteParams(params),
        responseType: 'blob',
    });
    saveBlob(data as Blob, fileName);
};

// ── TDS challan register ──

export const fetchChallans = async (
    financialYear: string,
    quarter?: string
): Promise<TdsChallanDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_COMPLIANCE_CHALLANS,
        instituteParams({ financialYear, quarter })
    );
    return data ?? [];
};

export const createChallan = async (payload: CreateTdsChallanPayload): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_COMPLIANCE_CHALLANS,
        payload,
        instituteParams()
    );
    return data;
};

export const deleteChallan = async (id: string): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.delete(
        HR_COMPLIANCE_CHALLAN_BY_ID(id),
        instituteParams()
    );
    return data;
};

// ── Provisions ──

export const fetchGratuityProvision = async (
    asOfDate?: string
): Promise<GratuityProvisionReportDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_COMPLIANCE_GRATUITY,
        instituteParams(asOfDate ? { asOfDate } : undefined)
    );
    return data ?? {};
};

export const fetchEosbProvision = async (
    asOfDate?: string
): Promise<EosbProvisionReportDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_COMPLIANCE_EOSB,
        instituteParams(asOfDate ? { asOfDate } : undefined)
    );
    return data ?? {};
};

export const fetchBonusComputation = async (
    financialYear: string,
    bonusPct: number
): Promise<BonusComputationReportDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_COMPLIANCE_BONUS,
        instituteParams({ financialYear, bonusPct })
    );
    return data ?? {};
};

export const materializeBonus = async (args: {
    financialYear: string;
    bonusPct: number;
    month: number;
    year: number;
}): Promise<BonusMaterializationResultDTO> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_COMPLIANCE_BONUS_MATERIALIZE,
        {},
        instituteParams(args)
    );
    return data ?? {};
};

// ───────────────────────── Attendance ─────────────────────────

export const fetchAttendanceConfig = async (): Promise<AttendanceConfigDTO | null> => {
    try {
        const { data } = await authenticatedAxiosInstance.get(
            HR_ATTENDANCE_CONFIG,
            instituteParams()
        );
        return data ?? null;
    } catch {
        // An institute that has never configured attendance 4xxs here; that is a
        // starting state, not a failure. Callers fall back to TIME_TRACKING.
        return null;
    }
};

export const saveAttendanceConfig = async (
    payload: AttendanceConfigDTO
): Promise<AttendanceConfigDTO> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_ATTENDANCE_CONFIG,
        payload,
        instituteParams()
    );
    return data;
};

/** Records for a month, optionally narrowed to one employee. */
export const fetchAttendanceRecords = async (args: {
    month: number;
    year: number;
    employeeId?: string;
}): Promise<AttendanceRecordDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_ATTENDANCE,
        instituteParams({ month: args.month, year: args.year, employeeId: args.employeeId })
    );
    return data ?? [];
};

export const fetchAttendanceSummary = async (
    month: number,
    year: number
): Promise<AttendanceSummaryRowDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_ATTENDANCE_SUMMARY,
        instituteParams({ month, year })
    );
    return data ?? [];
};

/** Bulk day-level marking. Refused by the backend when the month is payroll-locked. */
export const markAttendance = async (payload: {
    attendance_date: string;
    records: Array<{ employee_id: string; status: string; remarks?: string }>;
}): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_ATTENDANCE_MARK,
        payload,
        instituteParams()
    );
    return data;
};

export const fetchRegularizations = async (
    status?: string
): Promise<RegularizationDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_ATTENDANCE_REGULARIZATION,
        instituteParams(status ? { status } : undefined)
    );
    return data ?? [];
};

export const actOnRegularization = async (
    id: string,
    payload: { approval_status: 'APPROVED' | 'REJECTED'; remarks?: string }
): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.put(
        HR_ATTENDANCE_REGULARIZATION_ACTION(id),
        payload,
        instituteParams()
    );
    return data;
};

export const fetchShifts = async (): Promise<ShiftDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(HR_SHIFTS, instituteParams());
    return data ?? [];
};

export const saveShift = async (payload: ShiftDTO): Promise<string> => {
    const { data } = payload.id
        ? await authenticatedAxiosInstance.put(HR_SHIFT_BY_ID(payload.id), payload, instituteParams())
        : await authenticatedAxiosInstance.post(HR_SHIFTS, payload, instituteParams());
    return data;
};

/**
 * Assigning a shift closes any mapping still open on/after `effective_from`, so
 * an employee only ever has one active shift — the backend enforces that too.
 */
export const assignShift = async (payload: {
    shift_id: string;
    employee_ids: string[];
    effective_from: string;
}): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_SHIFTS_ASSIGN,
        payload,
        instituteParams()
    );
    return data;
};

export const fetchHolidays = async (year: number): Promise<HolidayDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(HR_HOLIDAYS, instituteParams({ year }));
    return data ?? [];
};

export const saveHoliday = async (payload: HolidayDTO): Promise<string> => {
    const { data } = payload.id
        ? await authenticatedAxiosInstance.put(
              HR_HOLIDAY_BY_ID(payload.id),
              payload,
              instituteParams()
          )
        : await authenticatedAxiosInstance.post(HR_HOLIDAYS, payload, instituteParams());
    return data;
};

export const deleteHoliday = async (id: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(HR_HOLIDAY_BY_ID(id), instituteParams());
};

/** Bulk import. Duplicates are skipped server-side and reported in the message. */
export const bulkCreateHolidays = async (holidays: HolidayDTO[]): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_HOLIDAYS_BULK,
        { holidays },
        instituteParams()
    );
    return data;
};

// ───────────────────────── Leave ─────────────────────────

export const fetchLeaveTypes = async (): Promise<LeaveTypeDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(HR_LEAVE_TYPES, instituteParams());
    return data ?? [];
};

export const saveLeaveType = async (payload: LeaveTypeDTO): Promise<string> => {
    const { data } = payload.id
        ? await authenticatedAxiosInstance.put(
              HR_LEAVE_TYPE_BY_ID(payload.id),
              payload,
              instituteParams()
          )
        : await authenticatedAxiosInstance.post(HR_LEAVE_TYPES, payload, instituteParams());
    return data;
};

export const fetchLeavePolicies = async (): Promise<LeavePolicyDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(HR_LEAVE_POLICIES, instituteParams());
    return data ?? [];
};

export const saveLeavePolicy = async (payload: LeavePolicyDTO): Promise<string> => {
    const { data } = payload.id
        ? await authenticatedAxiosInstance.put(
              HR_LEAVE_POLICY_BY_ID(payload.id),
              payload,
              instituteParams()
          )
        : await authenticatedAxiosInstance.post(HR_LEAVE_POLICIES, payload, instituteParams());
    return data;
};

export const fetchLeaveApplications = async (args: {
    status?: string;
    employeeId?: string;
}): Promise<LeaveApplicationDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_LEAVE_APPLICATIONS,
        // pageSize is generous on purpose: these screens show a queue, not a
        // paginated grid, and the endpoint defaults to 20.
        instituteParams({ status: args.status, employeeId: args.employeeId, pageSize: 200 })
    );
    // This endpoint returns Page<LeaveApplicationDTO>, not a bare list.
    return asList<LeaveApplicationDTO>(data);
};

/**
 * Approve or reject. The backend re-checks the balance at approval time and
 * refuses if the month is payroll-locked, so surface its message verbatim.
 */
export const actOnLeaveApplication = async (
    id: string,
    payload: { status: 'APPROVED' | 'REJECTED'; rejection_reason?: string }
): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.put(
        HR_LEAVE_APPLICATION_ACTION(id),
        payload,
        instituteParams()
    );
    return data;
};

export const cancelLeaveApplication = async (id: string): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.put(
        HR_LEAVE_APPLICATION_CANCEL(id),
        {},
        instituteParams()
    );
    return data;
};

export const fetchLeaveBalances = async (args: {
    employeeId?: string;
    year: number;
}): Promise<LeaveBalanceDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_LEAVE_BALANCES,
        instituteParams({ employeeId: args.employeeId, year: args.year })
    );
    return data ?? [];
};

export const adjustLeaveBalance = async (
    id: string,
    payload: { adjustment: number; reason?: string }
): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.put(
        HR_LEAVE_BALANCE_ADJUST(id),
        payload,
        instituteParams()
    );
    return data;
};

/** Idempotent per period — the accrual ledger makes a repeat run a no-op. */
export const runLeaveAccrual = async (): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_LEAVE_ACCRUE,
        {},
        instituteParams()
    );
    return data;
};

export const runLeaveYearEnd = async (): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_LEAVE_YEAR_END,
        {},
        instituteParams()
    );
    return data;
};

export const fetchCompOffs = async (employeeId?: string): Promise<CompOffDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_COMP_OFF,
        instituteParams(employeeId ? { employeeId } : undefined)
    );
    return data ?? [];
};

export const actOnCompOff = async (
    id: string,
    payload: { status: 'APPROVED' | 'REJECTED' }
): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.put(
        HR_COMP_OFF_ACTION(id),
        payload,
        instituteParams()
    );
    return data;
};

// ───────────────────────── My HR (self-service) ─────────────────────────
//
// These call the same endpoints as the admin screens; the backend decides what
// a non-HR caller may see. Where an endpoint accepts an employeeId, the caller
// passes their OWN (from useMyEmployeeProfile) and the guard refuses anyone
// else's — the UI is not what keeps these private.

/** Check in. employeeId is omitted deliberately: the backend resolves the caller. */
export const checkIn = async (payload: {
    latitude?: number;
    longitude?: number;
}): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_ATTENDANCE_CHECK_IN,
        payload,
        instituteParams()
    );
    return data;
};

export const checkOut = async (payload: {
    latitude?: number;
    longitude?: number;
}): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_ATTENDANCE_CHECK_OUT,
        payload,
        instituteParams()
    );
    return data;
};

export const applyForLeave = async (payload: {
    employee_id: string;
    leave_type_id: string;
    from_date: string;
    to_date: string;
    is_half_day?: boolean;
    half_day_type?: string;
    reason?: string;
}): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_LEAVE_APPLY,
        payload,
        instituteParams()
    );
    return data;
};

export const fetchMyPayslips = async (
    employeeId: string,
    year: number
): Promise<PayslipDTO[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_PAYSLIPS,
        instituteParams({ employeeId, year })
    );
    return data ?? [];
};

export const fetchTaxDeclaration = async (
    employeeId: string,
    financialYear: string
): Promise<TaxDeclarationDTO | null> => {
    try {
        const { data } = await authenticatedAxiosInstance.get(
            HR_TAX_DECLARATIONS,
            instituteParams({ employeeId, fy: financialYear, financialYear })
        );
        // The endpoint may answer with a list or a single record depending on args.
        if (Array.isArray(data)) return data[0] ?? null;
        return data ?? null;
    } catch {
        // No declaration filed yet is the normal starting state.
        return null;
    }
};

export const submitTaxDeclaration = async (payload: {
    employee_id: string;
    financial_year: string;
    regime?: string;
    declarations: Record<string, unknown>;
}): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_TAX_DECLARATIONS,
        payload,
        instituteParams()
    );
    return data;
};

export const updateTaxDeclaration = async (
    id: string,
    payload: { regime?: string; declarations: Record<string, unknown> }
): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.put(
        HR_TAX_DECLARATION_BY_ID(id),
        payload,
        instituteParams()
    );
    return data;
};

export const submitReimbursement = async (payload: {
    employee_id: string;
    type: string;
    amount: number;
    description?: string;
    expense_date?: string;
    receipt_file_id?: string;
}): Promise<string> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_REIMBURSEMENTS,
        payload,
        instituteParams()
    );
    return data;
};

export const fetchMyReimbursements = async (employeeId: string) => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_REIMBURSEMENTS,
        instituteParams({ employeeId, pageSize: 200 })
    );
    // Page<ReimbursementDTO>, not a bare list.
    return asList<Record<string, unknown>>(data);
};

export const fetchMyLoans = async (employeeId: string) => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_PAYROLL_LOANS,
        instituteParams({ employeeId })
    );
    return asList<Record<string, unknown>>(data);
};

// ───────────────── Teaching pay & CRM incentives (payroll phase 2) ─────────────────

/**
 * Imports for this section live here rather than in the module's header block so
 * that this whole feature is one contiguous append — the file is edited by several
 * feature streams at once and a shared import list is where they collide.
 */
import {
    HR_TEACHING_SUMMARY,
    HR_TEACHING_ATTENDANCE_SYNC,
    HR_TEACHING_PAY_PREVIEW,
    HR_TEACHING_PAY_MATERIALIZE,
    HR_INCENTIVES_PREVIEW,
    HR_INCENTIVES_MATERIALIZE,
} from '@/constants/urls';
import type {
    IncentiveMaterializeResultDTO,
    IncentivePreviewDTO,
    TeachingAttendanceSyncResultDTO,
    TeachingPayResultDTO,
    TeachingSummaryResponseDTO,
} from '@/routes/erp/-shared/hr-types';

/**
 * Query keys for the two variable-pay sources.
 *
 * Kept beside `hrKeys` rather than inside it for the same append-safety reason as
 * the imports above; both spread `ERP_KEY`, so a blanket ERP invalidation still
 * clears them.
 *
 * The two *preview* keys carry their whole input (month, and for incentives the
 * rates) because a preview computed at 5% is a different answer from one at 10% —
 * caching them under one key would show an admin the wrong money.
 */
export const teachingKeys = {
    summary: (year: number, month: number, employeeId?: string) => [
        ...ERP_KEY,
        'teaching-summary',
        year,
        month,
        employeeId ?? 'all',
    ],
    payPreview: (year: number, month: number) => [...ERP_KEY, 'teaching-pay-preview', year, month],
};

export const incentiveKeys = {
    preview: (year: number, month: number, commissionPct?: number, fixedPerConversion?: number) => [
        ...ERP_KEY,
        'incentive-preview',
        year,
        month,
        commissionPct ?? 'none',
        fixedPerConversion ?? 'none',
    ],
};

/**
 * Who taught what, for one month. Includes teachers with no HR profile (flagged
 * `no_employee_profile`) — see the DTO note.
 */
export const fetchTeachingSummary = async (
    year: number,
    month: number,
    employeeId?: string
): Promise<TeachingSummaryResponseDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_TEACHING_SUMMARY,
        instituteParams({ month, year, ...(employeeId ? { employeeId } : {}) })
    );
    return data ?? {};
};

/**
 * Marks every day a teacher taught as PRESENT in HR attendance.
 *
 * `requireLog` defaults to the server's stricter reading — only days with an
 * attendance log count, not merely scheduled ones. Refused outright when payroll
 * for the month is locked; let that error surface with its own message, since it
 * names the run that did the locking.
 */
export const syncTeachingAttendance = async (args: {
    year: number;
    month: number;
    requireLog?: boolean;
}): Promise<TeachingAttendanceSyncResultDTO> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_TEACHING_ATTENDANCE_SYNC,
        {},
        instituteParams({
            month: args.month,
            year: args.year,
            ...(args.requireLog === undefined ? {} : { requireLog: args.requireLog }),
        })
    );
    return data ?? {};
};

/**
 * Rate × quantity per teacher, computed but not written. A POST despite being a
 * read: it is an expensive aggregation the server declines to cache.
 */
export const previewTeachingPay = async (
    year: number,
    month: number
): Promise<TeachingPayResultDTO> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_TEACHING_PAY_PREVIEW,
        {},
        instituteParams({ month, year })
    );
    return data ?? {};
};

/** Writes the previewed lines as TEACHING_PAY adjustments. Idempotent per month. */
export const materializeTeachingPay = async (
    year: number,
    month: number
): Promise<TeachingPayResultDTO> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_TEACHING_PAY_MATERIALIZE,
        {},
        instituteParams({ month, year })
    );
    return data ?? {};
};

/**
 * Per-counsellor incentive for an earning month. At least one of `commissionPct`
 * and `fixedPerConversion` must be present or every row computes to zero; the
 * caller enforces that before offering the button.
 */
export const fetchIncentivePreview = async (args: {
    year: number;
    month: number;
    commissionPct?: number;
    fixedPerConversion?: number;
}): Promise<IncentivePreviewDTO> => {
    const { data } = await authenticatedAxiosInstance.get(
        HR_INCENTIVES_PREVIEW,
        instituteParams({
            month: args.month,
            year: args.year,
            ...(args.commissionPct === undefined ? {} : { commissionPct: args.commissionPct }),
            ...(args.fixedPerConversion === undefined
                ? {}
                : { fixedPerConversion: args.fixedPerConversion }),
        })
    );
    return data ?? {};
};

/**
 * Writes CRM_INCENTIVE adjustments. Two periods, deliberately separate: the
 * earning month the incentive was computed over, and the payout month whose
 * payroll run pays it. Idempotent per payout period.
 */
export const materializeIncentives = async (args: {
    year: number;
    month: number;
    commissionPct?: number;
    fixedPerConversion?: number;
    payoutYear: number;
    payoutMonth: number;
}): Promise<IncentiveMaterializeResultDTO> => {
    const { data } = await authenticatedAxiosInstance.post(
        HR_INCENTIVES_MATERIALIZE,
        {},
        instituteParams({
            month: args.month,
            year: args.year,
            ...(args.commissionPct === undefined ? {} : { commissionPct: args.commissionPct }),
            ...(args.fixedPerConversion === undefined
                ? {}
                : { fixedPerConversion: args.fixedPerConversion }),
            payoutMonth: args.payoutMonth,
            payoutYear: args.payoutYear,
        })
    );
    return data ?? {};
};
