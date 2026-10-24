/**
 * Wire types for the HR & Payroll APIs.
 *
 * All payloads are snake_case (the backend DTOs use @JsonNaming SnakeCase), so
 * these interfaces are written snake_case too — no mapping layer, nothing to
 * drift. Money fields arrive as strings or numbers depending on the endpoint
 * (BigDecimal serialization), hence `number | string` on amounts; pass them
 * straight to MoneyCell which normalizes.
 */

export type Money = number | string | null;

// ───────────────────────── People ─────────────────────────

export interface EmployeeProfileDTO {
    id?: string;
    user_id?: string;
    institute_id?: string;
    employee_code?: string;
    department_id?: string;
    department_name?: string;
    designation_id?: string;
    designation_name?: string;
    reporting_manager_id?: string;
    reporting_manager_name?: string;
    employment_type?: string;
    employment_status?: string;
    join_date?: string;
    probation_end_date?: string;
    confirmation_date?: string;
    notice_period_days?: number;
    resignation_date?: string;
    last_working_date?: string;
    exit_reason?: string;
    emergency_contact_name?: string;
    emergency_contact_phone?: string;
    emergency_contact_relation?: string;
    nationality?: string;
    blood_group?: string;
    marital_status?: string;
    /** Masked on read (****1234); send a fresh value to change it. */
    pan_number?: string;
    tax_id_number?: string;
    uan_number?: string;
    /** HR-admin only in responses. */
    statutory_info?: Record<string, unknown>;
    custom_fields?: Record<string, unknown>;
    full_name?: string;
    email?: string;
    mobile_number?: string;
}

export interface DepartmentDTO {
    id?: string;
    institute_id?: string;
    name?: string;
    code?: string;
    parent_id?: string;
    head_user_id?: string;
    description?: string;
    status?: string;
}

export interface DesignationDTO {
    id?: string;
    institute_id?: string;
    name?: string;
    code?: string;
    level?: number;
    grade?: string;
    description?: string;
    status?: string;
}

export interface StaffBridgeRow {
    user_id?: string;
    full_name?: string;
    email?: string;
    mobile_number?: string;
    roles?: string[];
    status?: string;
    employee_id?: string;
    employee_code?: string;
    teaches?: boolean;
    /** Set when the user already has an HR profile in a DIFFERENT institute. */
    blocked_reason?: string;
}

export interface StaffBridgeResponse {
    rows?: StaffBridgeRow[];
    page?: number;
    size?: number;
    total_elements?: number;
    total_staff?: number;
    with_hr_profile?: number;
    teaching_without_profile?: number;
}

// ───────────────────────── Salary ─────────────────────────

export type ComponentType = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';

export type CalculationType =
    | 'FIXED_AMOUNT'
    | 'PERCENTAGE_OF_BASIC'
    | 'PERCENTAGE_OF_CTC'
    | 'PERCENTAGE_OF_GROSS'
    | 'FORMULA';

export interface SalaryComponentDTO {
    id?: string;
    institute_id?: string;
    name?: string;
    code?: string;
    type?: ComponentType;
    category?: string;
    is_taxable?: boolean;
    is_statutory?: boolean;
    is_active?: boolean;
    display_order?: number;
    description?: string;
    /** GL account this component posts to in the ERP journal (V484). */
    gl_account_code?: string;
}

export interface SalaryTemplateComponentDTO {
    id?: string;
    component_id?: string;
    component_name?: string;
    component_code?: string;
    component_type?: ComponentType;
    calculation_type?: CalculationType;
    percentage_value?: Money;
    fixed_value?: Money;
    formula?: string;
    min_value?: Money;
    max_value?: Money;
    display_order?: number;
    is_mandatory?: boolean;
}

export interface SalaryTemplateDTO {
    id?: string;
    institute_id?: string;
    name?: string;
    description?: string;
    is_default?: boolean;
    status?: string;
    components?: SalaryTemplateComponentDTO[];
}

export interface EmployeeSalaryComponentDTO {
    id?: string;
    component_id?: string;
    component_name?: string;
    component_code?: string;
    component_type?: ComponentType;
    monthly_amount?: Money;
    annual_amount?: Money;
    calculation_type?: CalculationType;
    percentage_value?: Money;
    is_overridden?: boolean;
}

export interface EmployeeSalaryStructureDTO {
    id?: string;
    employee_id?: string;
    template_id?: string;
    template_name?: string;
    effective_from?: string;
    effective_to?: string;
    ctc_annual?: Money;
    ctc_monthly?: Money;
    gross_monthly?: Money;
    net_monthly?: Money;
    currency?: string;
    status?: string;
    revision_reason?: string;
    components?: EmployeeSalaryComponentDTO[];
}

export interface AssignSalaryPayload {
    employee_id: string;
    template_id?: string;
    ctc_annual: number;
    effective_from: string;
    currency?: string;
    revision_reason?: string;
}

// ───────────────────────── Payroll ─────────────────────────

export interface PayrollRunDTO {
    id?: string;
    institute_id?: string;
    month?: number;
    year?: number;
    run_date?: string;
    status?: string;
    run_type?: string;
    total_employees?: number;
    total_gross?: Money;
    total_deductions?: Money;
    total_net_pay?: Money;
    total_employer_cost?: Money;
    currency?: string;
    processed_by?: string;
    processed_at?: string;
    approved_by?: string;
    approved_at?: string;
    notes?: string;
}

export interface PayrollEntryComponentDTO {
    component_id?: string;
    component_name?: string;
    component_code?: string;
    component_type?: ComponentType;
    amount?: Money;
}

export interface PayrollEntryDTO {
    id?: string;
    payroll_run_id?: string;
    employee_id?: string;
    employee_code?: string;
    gross_salary?: Money;
    total_earnings?: Money;
    total_deductions?: Money;
    total_employer_contributions?: Money;
    net_pay?: Money;
    total_working_days?: number;
    days_present?: Money;
    days_absent?: Money;
    days_on_leave?: Money;
    days_holiday?: number;
    overtime_hours?: Money;
    arrears?: Money;
    reimbursements?: Money;
    loan_deduction?: Money;
    currency?: string;
    status?: string;
    hold_reason?: string;
    components?: PayrollEntryComponentDTO[];
}

/** Per-employee processing failure (hr_payroll_entry_error). Entity-shaped, not snake_case DTO. */
export interface PayrollEntryError {
    id?: string;
    payrollRunId?: string;
    employeeId?: string;
    errorStage?: string;
    errorMessage?: string;
    createdAt?: string;
}

export interface CreatePayrollRunPayload {
    month: number;
    year: number;
    run_type?: string;
    notes?: string;
}

export interface PayrollAdjustmentDTO {
    id?: string;
    employee_id?: string;
    month?: number;
    year?: number;
    type?: 'EARNING' | 'DEDUCTION';
    code?: string;
    label?: string;
    amount?: Money;
    currency?: string;
    run_scope?: string;
    source?: string;
    notes?: string;
    payroll_entry_id?: string;
}

// ───────────────────────── Compliance ─────────────────────────

/**
 * **Wire casing is NOT uniform across the compliance endpoints — read this before
 * adding a field.**
 *
 * Unlike the People/Salary/Payroll DTOs above, the `hr_compliance` package only
 * annotates *some* of its DTOs with `@JsonNaming(SnakeCaseStrategy)`, and the
 * service has no global Jackson naming strategy configured. So the wire shape is
 * split, verified against the Java DTOs:
 *
 * - **snake_case** (`@JsonNaming` present): tax configuration, gratuity provision,
 *   EOSB provision, bonus computation + materialization.
 * - **camelCase** (no annotation — Jackson's default): PF ECR, ESI return, PT
 *   return, Form 16, Form 24Q, WPS export, and the TDS challan (which is the JPA
 *   *entity* serialized directly, so its request body binds camelCase too).
 *
 * The interfaces below mirror that split exactly rather than pretending it away:
 * a `financial_year` key in a challan POST body binds to nothing and comes back
 * as "financial_year must look like 2025-26".
 *
 * Everything is optional. These reports are assembled from payroll data that may
 * be partly missing (no UAN, no ACTIVE salary structure, an unconfigured TAN), and
 * a half-filled report is the normal case the screens exist to surface.
 */

/** `GET /hr/tax/config` — snake_case. 4xx when the institute has no ACTIVE config at all. */
export interface TaxConfigurationDTO {
    id?: string;
    institute_id?: string;
    /** ISO country the payroll is configured under: IND, ARE/UAE, SAU/KSA, … */
    country_code?: string;
    state_code?: string;
    financial_year_start_month?: number;
    tax_rules?: Record<string, unknown>;
    employer_contributions?: Record<string, unknown>;
    /** TAN, PF establishment id, ESI employer code, MOL establishment id, … */
    statutory_settings?: Record<string, unknown>;
    status?: string;
}

/** Employee left out of a generated file, with the reason. Same shape on ECR / ESI / WPS. */
export interface ComplianceSkippedRowDTO {
    employeeCode?: string;
    employeeName?: string;
    reason?: string;
}

// ── PF ECR (camelCase) ──

export interface PfEcrRowDTO {
    employeeCode?: string;
    uan?: string;
    memberName?: string;
    grossWages?: Money;
    epfWages?: Money;
    epsWages?: Money;
    edliWages?: Money;
    epfContriRemitted?: Money;
    epsContriRemitted?: Money;
    epfEpsDiffRemitted?: Money;
    ncpDays?: number;
    refundOfAdvances?: Money;
}

export interface PfEcrResponseDTO {
    instituteId?: string;
    month?: number;
    year?: number;
    pfEstablishmentId?: string;
    rows?: PfEcrRowDTO[];
    skipped?: ComplianceSkippedRowDTO[];
    warnings?: string[];
    memberCount?: number;
    totalEpfWages?: Money;
    totalEpfContri?: Money;
    totalEpsContri?: Money;
    totalEpfEpsDiff?: Money;
}

// ── ESI return (camelCase) ──

export interface EsiReturnRowDTO {
    employeeCode?: string;
    ipNumber?: string;
    name?: string;
    daysWorked?: number;
    monthlyWage?: Money;
    ipContribution?: Money;
    employerContribution?: Money;
}

export interface EsiReturnResponseDTO {
    instituteId?: string;
    month?: number;
    year?: number;
    esiEmployerCode?: string;
    rows?: EsiReturnRowDTO[];
    skipped?: ComplianceSkippedRowDTO[];
    warnings?: string[];
    ipCount?: number;
    totalWages?: Money;
    totalIpContribution?: Money;
    totalEmployerContribution?: Money;
}

// ── PT return (camelCase) ──

export interface PtReturnRowDTO {
    employeeCode?: string;
    name?: string;
    grossSalary?: Money;
    ptAmount?: Money;
}

export interface PtReturnSlabSummaryDTO {
    ptAmount?: Money;
    employeeCount?: number;
    totalAmount?: Money;
}

export interface PtReturnResponseDTO {
    instituteId?: string;
    month?: number;
    year?: number;
    stateCode?: string;
    ptRegistrationNumber?: string;
    slabs?: PtReturnSlabSummaryDTO[];
    rows?: PtReturnRowDTO[];
    warnings?: string[];
    employeeCount?: number;
    grandTotalPt?: Money;
}

// ── Form 16 Part B (camelCase) ──

export interface Form16MonthlyRowDTO {
    month?: number;
    year?: number;
    monthName?: string;
    incomePaid?: Money;
    tdsDeducted?: Money;
}

export interface Form16DataDTO {
    employeeId?: string;
    employeeName?: string;
    employeeCode?: string;
    employeePan?: string;
    deductorName?: string;
    deductorTan?: string;
    deductorPan?: string;
    deductorAddress?: string;
    financialYear?: string;
    regime?: string;
    grossSalaryPaid?: Money;
    standardDeduction?: Money;
    hraExemption?: Money;
    totalExemptions?: Money;
    chapterVIADeductions?: Record<string, Money>;
    taxableIncome?: Money;
    slabTax?: Money;
    taxAfterRebate?: Money;
    surcharge?: Money;
    cess?: Money;
    totalTaxLiability?: Money;
    totalTdsDeducted?: Money;
    /** FY-order month of the last computation present — annual figures are projections until March. */
    lastComputedMonth?: number;
    monthlyDetails?: Form16MonthlyRowDTO[];
    warnings?: string[];
}

// ── Form 24Q (camelCase) ──

export interface Form24QDeductorDTO {
    name?: string;
    tan?: string;
    pan?: string;
    address?: string;
}

export interface Form24QChallanDTO {
    id?: string;
    depositDate?: string;
    bsrCode?: string;
    challanSerial?: string;
    amount?: Money;
    interest?: Money;
    fee?: Money;
}

export interface Form24QDeducteeRowDTO {
    employeeId?: string;
    pan?: string;
    name?: string;
    employeeCode?: string;
    month?: number;
    year?: number;
    monthName?: string;
    incomePaid?: Money;
    tdsDeducted?: Money;
    section?: string;
}

export interface Form24QResponseDTO {
    financialYear?: string;
    quarter?: string;
    deductor?: Form24QDeductorDTO;
    challans?: Form24QChallanDTO[];
    deducteeRows?: Form24QDeducteeRowDTO[];
    totalTdsDeducted?: Money;
    totalChallanAmount?: Money;
    /** True when deducted TDS and deposited challan totals differ — the reconciliation signal. */
    mismatch?: boolean;
    warnings?: string[];
}

// ── WPS salary file, Gulf only (camelCase) ──

export interface WpsEdrRowDTO {
    employeeCode?: string;
    employeeName?: string;
    personId?: string;
    agentId?: string;
    iban?: string;
    payStartDate?: string;
    payEndDate?: string;
    daysInPeriod?: number;
    fixedIncome?: Money;
    variableIncome?: Money;
    leaveDays?: number;
    netPay?: Money;
    currency?: string;
}

export interface WpsSaudiRowDTO {
    employeeCode?: string;
    employeeName?: string;
    employeeId?: string;
    iban?: string;
    bankCode?: string;
    basicSalary?: Money;
    housingAllowance?: Money;
    otherEarnings?: Money;
    deductions?: Money;
    netSalary?: Money;
    currency?: string;
}

export interface WpsExportResponseDTO {
    /** UAE_SIF or SAUDI_WPS — decides which of the two row lists is populated. */
    format?: string;
    instituteId?: string;
    month?: number;
    year?: number;
    countryCode?: string;
    establishmentId?: string;
    employerBankCode?: string;
    wpsReference?: string;
    edrRows?: WpsEdrRowDTO[];
    saudiRows?: WpsSaudiRowDTO[];
    skipped?: ComplianceSkippedRowDTO[];
    warnings?: string[];
    employeeCount?: number;
    totalNetPay?: Money;
    currency?: string;
}

// ── TDS challan register (camelCase — serialized JPA entity) ──

export interface TdsChallanDTO {
    id?: string;
    instituteId?: string;
    financialYear?: string;
    /** Q1..Q4 in FY terms (Q1 = Apr–Jun). */
    quarter?: string;
    /** Salary month the deposit relates to. Optional server-side and unused by Form 24Q. */
    month?: number;
    year?: number;
    depositDate?: string;
    bsrCode?: string;
    challanSerial?: string;
    amount?: Money;
    interest?: Money;
    fee?: Money;
    notes?: string;
    createdBy?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface CreateTdsChallanPayload {
    financialYear: string;
    quarter: string;
    depositDate: string;
    amount: number;
    month?: number;
    year?: number;
    bsrCode?: string;
    challanSerial?: string;
    interest?: number;
    fee?: number;
    notes?: string;
}

// ── Gratuity provision, India (snake_case) ──

export interface GratuityProvisionRowDTO {
    employee_id?: string;
    employee_code?: string;
    employee_name?: string;
    employment_status?: string;
    join_date?: string;
    service_end_date?: string;
    exited_in_as_of_month?: boolean;
    /** Decimal years of service (days / 365.2425). */
    raw_years?: Money;
    /** Completed years, part beyond six months rounded up once past year five. */
    rounded_years?: number;
    monthly_basic?: Money;
    /** BASIC_COMPONENT | GROSS_FALLBACK | NONE — how monthly basic was derived. */
    basic_source?: string;
    accrued_liability?: Money;
    capped_at_ceiling?: boolean;
    /** Service ≥ 4 years + 240 days — payable if the employee exits now. */
    vested?: boolean;
    monthly_run_rate?: Money;
    currency?: string;
}

export interface GratuityProvisionReportDTO {
    institute_id?: string;
    as_of_date?: string;
    employee_count?: number;
    total_accrued_liability?: Money;
    vested_accrued_liability?: Money;
    unvested_accrued_liability?: Money;
    total_monthly_run_rate?: Money;
    currency?: string;
    rows?: GratuityProvisionRowDTO[];
}

// ── EOSB provision, Gulf (snake_case) ──

export interface EosbProvisionRowDTO {
    employee_id?: string;
    employee_code?: string;
    employee_name?: string;
    employment_status?: string;
    join_date?: string;
    service_end_date?: string;
    exited_in_as_of_month?: boolean;
    service_years?: Money;
    monthly_basic?: Money;
    basic_source?: string;
    /** Payable if the employee exited on the service end date (UAE: nil under 1 year). */
    statutory_liability?: Money;
    statutory_eligible?: boolean;
    /** Day-one IAS 19 style accrual — carried in the books before statutory eligibility. */
    accounting_accrual?: Money;
    capped_at_two_years_pay?: boolean;
    monthly_run_rate?: Money;
    currency?: string;
}

export interface EosbProvisionReportDTO {
    institute_id?: string;
    /** Normalized ISO-3 country the report was computed under: ARE | SAU. */
    country_code?: string;
    as_of_date?: string;
    employee_count?: number;
    total_statutory_liability?: Money;
    total_accounting_accrual?: Money;
    total_monthly_run_rate?: Money;
    currency?: string;
    rows?: EosbProvisionRowDTO[];
}

// ── Statutory bonus, India (snake_case) ──

export interface BonusComputationRowDTO {
    employee_id?: string;
    employee_code?: string;
    employee_name?: string;
    monthly_basic?: Money;
    eligible?: boolean;
    /** Set when eligible = false (wage above the ₹21,000 ceiling, under 30 days service, …). */
    ineligible_reason?: string;
    eligible_months?: number;
    /** min(monthly basic, ₹7,000) — the s.12 calculation ceiling. */
    bonus_wage_base?: Money;
    computed_bonus?: Money;
    currency?: string;
}

export interface BonusComputationReportDTO {
    institute_id?: string;
    financial_year?: string;
    fy_start?: string;
    fy_end?: string;
    /** Applied rate after the server clamps it to 8.33 … 20. */
    bonus_pct?: Money;
    eligible_count?: number;
    total_bonus?: Money;
    currency?: string;
    rows?: BonusComputationRowDTO[];
}

export interface BonusMaterializationResultDTO {
    financial_year?: string;
    month?: number;
    year?: number;
    bonus_pct?: Money;
    created_count?: number;
    /** Employees skipped because a STATUTORY_BONUS adjustment already exists for the period. */
    skipped_existing_count?: number;
    total_amount?: Money;
}

// ───────────────────── Finance · accounting journal ─────────────────────

export type JournalEntryStatus = 'POSTED' | 'REVERSED';

/** One side of a double-entry line. Exactly one of debit/credit is non-zero. */
export interface JournalLineDTO {
    line_no?: number;
    account_code?: string;
    account_name?: string;
    debit?: Money;
    credit?: Money;
}

/**
 * A single balanced journal entry.
 *
 * Posted by the source module, never by hand: approving a payroll run writes the
 * HR_PAYROLL entry, and rejecting that run writes its reversal. `total_debit` and
 * `total_credit` are the server's own totals — the UI re-adds `lines` and compares,
 * because a mismatch between the two is a real accounting bug worth surfacing
 * rather than papering over.
 */
export interface JournalEntryDTO {
    id?: string;
    entry_date?: string;
    source_module?: string;
    reference?: string;
    memo?: string;
    status?: JournalEntryStatus | string;
    currency?: string;
    total_debit?: Money;
    total_credit?: Money;
    lines?: JournalLineDTO[];
}

// ───────────────────── Finance · P&L snapshot ─────────────────────

export interface PnlDepartmentCostDTO {
    department_id?: string;
    department_name?: string;
    headcount?: number;
    employer_cost?: Money;
}

export interface PnlRevenueDTO {
    /** Cash actually collected in the period — NOT billed/invoiced revenue. */
    total_collected?: Money;
    payment_count?: number;
    currency?: string;
}

export interface PnlPayrollCostDTO {
    total_employer_cost?: Money;
    total_net_pay?: Money;
    employee_count?: number;
    run_count?: number;
    departments?: PnlDepartmentCostDTO[];
}

export interface PnlDerivedDTO {
    margin?: Money;
    cost_to_revenue_ratio?: Money;
}

export interface PnlJournalInfoDTO {
    exists?: boolean;
    posted?: boolean;
    count?: number;
}

/**
 * The month's P&L snapshot as the endpoint returns it.
 *
 * Every field is optional and the shape is only the *documented* one: this
 * response is assembled from three subsystems (payments, payroll, GL) whose
 * nesting has already drifted once, so nothing here is load-bearing. Screens must
 * read it through `normalizePnlSnapshot` (routes/erp/finance/-hooks/pnl-shape.ts),
 * which probes the plausible key spellings and answers `undefined` — rendered as
 * "—" — rather than guessing. The index signature is what lets that normalizer
 * look at keys this interface does not know about yet.
 */
export interface PnlSnapshotDTO {
    year?: number;
    month?: number;
    revenue?: PnlRevenueDTO;
    payroll_cost?: PnlPayrollCostDTO;
    derived?: PnlDerivedDTO;
    journal?: PnlJournalInfoDTO;
    currency?: string | { code?: string };
    warnings?: string[];
    [key: string]: unknown;
}

// ───────────────────────── Payslips ─────────────────────────

/** `hr_payslip.email_status`. NOT_SENT is the state a freshly generated payslip is in. */
export type PayslipEmailStatus = 'SENT' | 'FAILED' | 'NOT_SENT' | 'PENDING';

export interface PayslipDTO {
    id?: string;
    /** The run line this PDF was rendered from — the only exact link back to a run. */
    payroll_entry_id?: string;
    employee_id?: string;
    employee_code?: string;
    institute_id?: string;
    month?: number;
    year?: number;
    file_id?: string;
    file_url?: string;
    generated_at?: string;
    emailed_at?: string;
    email_status?: string;
    currency?: string;
}

export interface PayslipEmailOutcome {
    payslip_id?: string;
    employee_code?: string;
    /** SENT / FAILED. */
    status?: string;
    /** Only present on FAILED — the actionable half of the result. */
    reason?: string;
}

/** Normalized POST /payslips/email response. Counts are always present after normalization. */
export interface PayslipEmailResult {
    total: number;
    sent: number;
    failed: number;
    outcomes: PayslipEmailOutcome[];
}

// ─────────────────────── Bank export ───────────────────────

export type BankExportFormat = 'CSV' | 'XLSX' | 'HDFC' | 'ICICI' | 'SBI';

/** One row of `hr_bank_export_log` — a file that was generated, not the file itself. */
export interface BankExportDTO {
    id?: string;
    payroll_run_id?: string;
    institute_id?: string;
    file_id?: string;
    file_name?: string;
    format?: string;
    total_records?: number;
    total_amount?: Money;
    generated_by?: string;
    generated_at?: string;
    currency?: string;
}

/**
 * An employee left OUT of the payment file. The API returns only a code and a
 * reason; `employee_name` is filled in client-side from the employee directory
 * because "EMP0142 has no bank account" is not something anyone can act on.
 */
export interface BankExportSkippedEntry {
    employee_code?: string;
    employee_name?: string;
    reason?: string;
}

/** Normalized POST /reports/bank-export response. */
export interface BankExportResult {
    export: BankExportDTO;
    skipped: BankExportSkippedEntry[];
    skipped_count: number;
    warnings: string[];
}

// ───────────────────────── Attendance ─────────────────────────
//
// hr_attendance and hr_leave DTOs use @JsonNaming(SnakeCase), like People and
// Payroll — unlike the compliance filings above.

/** TIME_TRACKING = employees check in/out; DAY_LEVEL = admins mark the day. */
export type AttendanceMode = 'TIME_TRACKING' | 'DAY_LEVEL';

export type AttendanceStatus =
    | 'PRESENT'
    | 'ABSENT'
    | 'HALF_DAY'
    | 'ON_LEAVE'
    | 'HOLIDAY'
    | 'WEEKEND'
    | 'COMP_OFF';

export interface AttendanceConfigDTO {
    id?: string;
    institute_id?: string;
    mode?: AttendanceMode;
    /** IANA zone the institute's days are bucketed by — payroll depends on this. */
    timezone?: string;
    auto_checkout_enabled?: boolean;
    auto_checkout_time?: string;
    geo_fence_enabled?: boolean;
    geo_fence_lat?: number;
    geo_fence_lng?: number;
    geo_fence_radius_m?: number;
    ip_restriction_enabled?: boolean;
    /** Exact IPs or CIDR blocks. */
    allowed_ips?: string[];
    overtime_enabled?: boolean;
    overtime_threshold_min?: number;
    half_day_threshold_min?: number;
    /** e.g. ["SATURDAY","SUNDAY"] — a Sun-Thu institute changes this. */
    weekend_days?: string[];
}

export interface AttendanceRecordDTO {
    id?: string;
    employee_id?: string;
    employee_code?: string;
    employee_name?: string;
    institute_id?: string;
    attendance_date?: string;
    shift_id?: string;
    check_in_time?: string;
    check_out_time?: string;
    total_hours?: Money;
    overtime_hours?: Money;
    break_duration_min?: number;
    status?: AttendanceStatus | string;
    source?: string;
    remarks?: string;
    is_regularized?: boolean;
}

export interface AttendanceSummaryRowDTO {
    employee_id?: string;
    employee_code?: string;
    employee_name?: string;
    total_working_days?: number;
    present?: Money;
    absent?: Money;
    half_day?: Money;
    on_leave?: Money;
    overtime_hours?: Money;
}

export interface RegularizationDTO {
    id?: string;
    attendance_id?: string;
    employee_id?: string;
    employee_code?: string;
    employee_name?: string;
    attendance_date?: string;
    original_status?: string;
    requested_status?: string;
    original_check_in?: string;
    original_check_out?: string;
    requested_check_in?: string;
    requested_check_out?: string;
    reason?: string;
    approval_status?: string;
    approved_by?: string;
    approved_at?: string;
    remarks?: string;
}

export interface ShiftDTO {
    id?: string;
    institute_id?: string;
    name?: string;
    code?: string;
    start_time?: string;
    end_time?: string;
    break_duration_min?: number;
    is_night_shift?: boolean;
    grace_period_min?: number;
    min_hours_full_day?: Money;
    min_hours_half_day?: Money;
    is_default?: boolean;
    status?: string;
}

export interface HolidayDTO {
    id?: string;
    institute_id?: string;
    name?: string;
    date?: string;
    type?: string;
    is_optional?: boolean;
    max_optional_allowed?: number;
    year?: number;
    description?: string;
}

// ───────────────────────── Leave ─────────────────────────

export interface LeaveTypeDTO {
    id?: string;
    institute_id?: string;
    name?: string;
    code?: string;
    is_paid?: boolean;
    is_carry_forward?: boolean;
    max_carry_forward?: number;
    is_encashable?: boolean;
    requires_document?: boolean;
    min_days?: Money;
    max_consecutive_days?: number;
    applicable_gender?: string;
    description?: string;
    status?: string;
}

export interface LeavePolicyDTO {
    id?: string;
    institute_id?: string;
    leave_type_id?: string;
    leave_type_name?: string;
    annual_quota?: Money;
    accrual_type?: 'YEARLY' | 'MONTHLY' | 'QUARTERLY' | string;
    accrual_amount?: Money;
    pro_rata_enabled?: boolean;
    applicable_after_days?: number;
    applicable_employment_types?: string[];
    effective_from?: string;
    effective_to?: string;
    status?: string;
}

export interface LeaveBalanceDTO {
    id?: string;
    employee_id?: string;
    employee_code?: string;
    employee_name?: string;
    leave_type_id?: string;
    leave_type_name?: string;
    year?: number;
    opening_balance?: Money;
    accrued?: Money;
    used?: Money;
    adjustment?: Money;
    carried_forward?: Money;
    encashed?: Money;
    closing_balance?: Money;
}

export interface LeaveApplicationDTO {
    id?: string;
    employee_id?: string;
    employee_code?: string;
    employee_name?: string;
    institute_id?: string;
    leave_type_id?: string;
    leave_type_name?: string;
    from_date?: string;
    to_date?: string;
    total_days?: Money;
    is_half_day?: boolean;
    half_day_type?: string;
    reason?: string;
    document_file_id?: string;
    status?: string;
    applied_to?: string;
    approved_by?: string;
    approved_at?: string;
    rejection_reason?: string;
}

export interface CompOffDTO {
    id?: string;
    employee_id?: string;
    employee_code?: string;
    employee_name?: string;
    worked_on_date?: string;
    earned_days?: Money;
    expiry_date?: string;
    used?: boolean;
    status?: string;
    approved_by?: string;
}

// ───────────────────────── Tax declaration (self-service) ─────────────────────────

export interface TaxDeclarationDTO {
    id?: string;
    employee_id?: string;
    financial_year?: string;
    /** OLD | NEW — only OLD allows the chapter VI-A deductions below. */
    regime?: string;
    /** Free-form keyed amounts the engine reads: section_80c, section_80d, hra_rent_paid, … */
    declarations?: Record<string, unknown>;
    proof_submitted?: boolean;
    proof_verified?: boolean;
    status?: string;
}

// ───────────────────── Teaching pay (LMS teaching → payroll) ─────────────────────

/**
 * The teaching endpoints answer for *people who taught*, not for people on the HR
 * roster — a teacher is a `live_session.created_by_user_id` matched against
 * `hr_employee_profile.user_id`. Someone who hosted classes but was never given an
 * HR profile still appears, flagged `no_employee_profile`, because silently
 * dropping them is how an unpaid teacher goes unnoticed for a month.
 *
 * Every field is optional here on purpose: the server builds these rows from
 * several joins and the UI must render a half-populated row rather than crash.
 */

/** One session occurrence a teacher hosted (or was scheduled to host). */
export interface TeachingOccurrenceDTO {
    schedule_id?: string;
    session_id?: string;
    session_title?: string;
    subject?: string;
    /** Local times, "HH:mm:ss". */
    start_time?: string;
    last_entry_time?: string;
    /** True when an ATTENDANCE_RECORDED log exists for this occurrence. */
    attendance_recorded?: boolean;
    /** 0 when no attendance log exists — scheduled ≠ taught. */
    taught_minutes?: number;
    scheduled_minutes?: number;
}

/** Per-date breakdown of a teacher's month. */
export interface TeachingDayDTO {
    date?: string;
    sessions_scheduled?: number;
    sessions_with_attendance?: number;
    taught_minutes?: number;
    occurrences?: TeachingOccurrenceDTO[];
}

/** One teaching person's month. */
export interface TeachingEmployeeSummaryDTO {
    /** hr_employee_profile.id — absent when the teacher has no HR profile. */
    employee_id?: string;
    user_id?: string;
    employee_name?: string;
    employee_code?: string;
    /** Taught this month but is not on the HR roster — cannot be paid until bridged. */
    no_employee_profile?: boolean;
    sessions_scheduled?: number;
    sessions_with_attendance?: number;
    total_taught_minutes?: number;
    days?: TeachingDayDTO[];
}

export interface TeachingSummaryResponseDTO {
    institute_id?: string;
    month?: number;
    year?: number;
    teachers?: TeachingEmployeeSummaryDTO[];
}

/** Counts from a teaching → hr_attendance sync run. */
export interface TeachingAttendanceSyncResultDTO {
    institute_id?: string;
    month?: number;
    year?: number;
    require_log?: boolean;
    /** New PRESENT rows inserted. */
    created?: number;
    /** Existing non-PRESENT/non-ON_LEAVE rows upgraded to PRESENT. */
    updated?: number;
    /** Already PRESENT or ON_LEAVE — deliberately left alone. */
    skipped?: number;
    dates_considered?: number;
    /** Teacher userIds with no HR profile; nothing was written for them. */
    teachers_without_profile?: string[];
}

/**
 * Why a pay line did or did not become an adjustment.
 * `UNRATED` is the one an admin has to act on: no `teaching_rate_per_session`
 * or `teaching_rate_per_hour` on the employee's custom fields, so there is no
 * rate to multiply by and the line is skipped rather than guessed at.
 */
export type TeachingPayStatus =
    | 'ELIGIBLE'
    | 'CREATED'
    | 'SKIPPED_EXISTING'
    | 'UNRATED'
    | 'ZERO_QUANTITY'
    | 'NO_EMPLOYEE_PROFILE';

/** One teacher's computed pay line: rate × quantity, plus why it was skipped. */
export interface TeachingPayLineDTO {
    employee_id?: string;
    user_id?: string;
    employee_name?: string;
    employee_code?: string;
    /** PER_SESSION | PER_HOUR — absent when unrated. */
    basis?: string;
    rate?: Money;
    sessions_with_attendance?: number;
    taught_minutes?: number;
    /** taught_minutes / 60 to 2dp — the payable quantity on the PER_HOUR basis. */
    taught_hours?: Money;
    amount?: Money;
    /** A `TeachingPayStatus`, typed loosely because the server may add cases. */
    status?: string;
    /** hr_payroll_adjustment.id once materialized. */
    adjustment_id?: string;
    note?: string;
}

export interface TeachingPayResultDTO {
    institute_id?: string;
    month?: number;
    year?: number;
    /** True for /pay/preview, false for /pay/materialize. */
    preview?: boolean;
    eligible_count?: number;
    created_count?: number;
    skipped_existing_count?: number;
    unrated_count?: number;
    total_amount?: Money;
    lines?: TeachingPayLineDTO[];
}

// ───────────────────── CRM incentives (collected revenue → payroll) ─────────────────────

/**
 * One counsellor's collected revenue and computed incentive for an EARNING month.
 * `no_employee_profile` counsellors are returned and totalled so the number is
 * honest, but materialization skips them — there is no employee to pay.
 */
export interface IncentiveRowDTO {
    counsellor_user_id?: string;
    counsellor_name?: string;
    employee_id?: string;
    no_employee_profile?: boolean;
    /** Collected revenue attributed to this counsellor (PAID payments of CONVERTED leads). */
    revenue?: Money;
    /** Distinct paying converted leads — the "conversions" the fixed component multiplies. */
    paying_leads?: number;
    payments?: number;
    commission_component?: Money;
    fixed_component?: Money;
    incentive?: Money;
}

export interface IncentivePreviewDTO {
    /** Earning period — the month the revenue was collected in. */
    month?: number;
    year?: number;
    commission_pct?: Money;
    fixed_per_conversion?: Money;
    /** The UTC window actually queried, surfaced so a disputed total can be traced. */
    window_from_utc?: string;
    window_to_utc?: string;
    rows?: IncentiveRowDTO[];
    total_revenue?: Money;
    total_paying_leads?: number;
    total_payments?: number;
    total_incentive?: Money;
    counsellor_count?: number;
    linked_counsellor_count?: number;
    unlinked_counsellor_count?: number;
}

export interface IncentiveCreatedItemDTO {
    adjustment_id?: string;
    employee_id?: string;
    counsellor_user_id?: string;
    counsellor_name?: string;
    amount?: Money;
}

export interface IncentiveSkippedItemDTO {
    employee_id?: string;
    counsellor_user_id?: string;
    counsellor_name?: string;
    /** already_materialized | zero_incentive */
    reason?: string;
}

export interface IncentiveUnlinkedCounsellorDTO {
    counsellor_user_id?: string;
    counsellor_name?: string;
    /** What they would have earned, kept for follow-up once a profile exists. */
    incentive?: Money;
}

/**
 * Outcome of writing incentives into payroll. Note the two periods: `month`/`year`
 * is when the revenue was earned, `payout_month`/`payout_year` is the payroll the
 * adjustment lands on. They are almost never the same month.
 */
export interface IncentiveMaterializeResultDTO {
    month?: number;
    year?: number;
    payout_month?: number;
    payout_year?: number;
    created?: IncentiveCreatedItemDTO[];
    skipped?: IncentiveSkippedItemDTO[];
    unlinked_counsellors?: IncentiveUnlinkedCounsellorDTO[];
    total_amount?: Money;
    created_count?: number;
    skipped_count?: number;
}
