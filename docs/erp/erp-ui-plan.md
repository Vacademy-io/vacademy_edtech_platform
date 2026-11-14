# ERP UI Plan — HR & Payroll in the Admin Dashboard

Date: 2026-08-27. Backend: everything through Phase F is built (see `hr-payroll-review-and-gap-plan.md`); Waves 1–E deployed, Phase F awaiting push. This spec maps every built API onto screens in `frontend-admin-dashboard`, following its existing conventions exactly.

**Decisions (user-confirmed):** a new top-level **ERP** rail category beside CRM/LMS/AI; **My HR** (employee self-service) lives inside ERP as a non-adminOnly module; **payroll ops ship first**; written spec is the deliverable.

---

## 1. Navigation & registration

The sidebar rail categories are a typed union (`'LMS' | 'CRM' | 'AI'` on `SidebarItemsType.category`). Adding ERP touches:

1. `src/types/layout-container/layout-container-types.ts` — extend the category union with `'ERP'`.
2. `src/components/common/layout-container/sidebar/category-rail.tsx` (+ `collapsed-category-flyout.tsx`, `sidebar-colors.ts`) — ERP rail entry (icon: `Buildings` or `Bank` from phosphor), color.
3. `src/components/common/layout-container/sidebar/utils.ts` — the nav entries (below).
4. `src/components/common/layout-container/sidebar/constant.ts` — add module ids to `controlledTabs` (admin-toggleable).
5. `src/constants/display-settings/admin-defaults.ts` — add ids to `OPT_IN_TAB_IDS` (**ships hidden until the institute opts in** — the safe rollout switch) + default tab configs.
6. `src/components/common/layout-container/sidebar/mySidebar.tsx` — strip self-service items when the user has no employee profile (same pattern as the `mentorship-my-mentorship` strip via `useIsMentor()`).
7. `src/constants/urls.ts` — `HR_*` endpoint constants (one banner-grouped block; ~60 endpoints).
8. `src/routes/settings/-constants/terms.ts` + `-utils/utils.ts` + `-components/ErpSettings.tsx` — settings tab (domain "Operations").
9. `src/routeTree.gen.ts` regenerates itself.

**ERP nav tree** (one `SidebarItemsType` per module; sub-items role-gated):

| id | title | sub-items (→ route) | visible to |
|---|---|---|---|
| `erp-my-hr` | My HR | Overview `/erp/my-hr` · My Leave `/erp/my-hr/leave` · My Payslips `/erp/my-hr/payslips` · My Tax `/erp/my-hr/tax` · My Claims `/erp/my-hr/claims` | any staff with an employee profile (`useMyEmployeeProfile`) |
| `erp-people` | People | Employees `/erp/people` · Departments & Designations `/erp/people/org` · Staff Coverage `/erp/people/staff-bridge` | HR staff |
| `erp-attendance` | Attendance | Daily Board `/erp/attendance` · Regularizations `/erp/attendance/regularizations` · Shifts & Holidays `/erp/attendance/setup` | HR staff |
| `erp-leave` | Leave | Requests `/erp/leave` · Balances `/erp/leave/balances` · Types & Policies `/erp/leave/setup` (adminOnly) | HR staff |
| `erp-payroll` | Payroll | Runs `/erp/payroll` · Variable Pay `/erp/payroll/adjustments` · Loans & Claims `/erp/payroll/loans` · Salary Setup `/erp/payroll/salary-setup` (adminOnly) | HR staff; mutations HR admin |
| `erp-compliance` | Compliance | Filings `/erp/compliance` · Challans `/erp/compliance/challans` · Provisions `/erp/compliance/provisions` | HR admin (adminOnly) |
| `erp-finance` | Finance | Journal `/erp/finance/journal` · P&L Snapshot `/erp/finance/pnl` | HR staff view / admin export |

Teaching Pay and Incentives live as tabs inside Payroll → Variable Pay (they are producers of adjustments, not standalone modules).

## 2. Roles & visibility model

JWT authorities already carry `HR_ADMIN` / `HR_MANAGER` per institute (`getRolesForCurrentInstitute()`); backend enforces regardless — UI gating is UX, not security.

New hooks (pattern: `use-is-mentor.ts`):
- `useHrRole()` → `{ isHrAdmin, isHrStaff }` from JWT roles (`ADMIN | HR_ADMIN | HR_MANAGER`).
- `useMyEmployeeProfile()` → TanStack query on `GET /hr/employees/staff-bridge`-lite or a `GET /employees?userId=me` self-resolve; drives My HR visibility + employeeId for self-service calls. Cache 5 min.

Gating rules: `erp-people/attendance/leave/payroll/finance` require `isHrStaff`; `erp-compliance` and all mutating actions require `isHrAdmin` (buttons hidden/disabled with tooltip, not error-on-click); `erp-my-hr` requires an employee profile only. `filterSidebarByRole` gets an HR clause mirroring these.

## 3. Screen inventory (mapped to built APIs)

Conventions everywhere: `LayoutContainer` + `setNavHeading`; `MyTable`/`MyPagination` (server-side, `TableData<T>` shape adapted client-side where APIs return arrays); `FilterChips` + `StatusChip`; `MyDialog`/`Sheet`; RHF+zod, snake_case payloads, `getInstituteId()` as `instituteId` param; `reportApiError` + sonner; `getTerminology` for renamable nouns; phosphor icons; design-lint clean.

### 3.1 Payroll — Runs (`/erp/payroll`) — THE FLAGSHIP, ships first
- **Runs list**: `GET /hr/payroll/runs?instituteId[&year]`. Columns: period (Month YYYY), type chip (REGULAR/OFF_CYCLE/FNF/BONUS), status `StatusChip` (DRAFT→INFO, PROCESSING→WARNING, PROCESSED→INFO, APPROVED→SUCCESS, PAID→SUCCESS, CANCELLED→DANGER), employees, net pay (currency), actions. "New run" dialog: **MonthPicker (new shared component — none exists)** + run-type select + notes → `POST /runs`.
- **Run detail** (`/erp/payroll/$runId`): header = period + status **stepper** (Draft → Processed → Approved → Paid) with the transition buttons rendered by state: Process (`POST /runs/{id}/process`, confirm dialog, poll/refetch on completion), Approve (`PUT /approve` — copy notes it posts the accounting journal), Reject (`PUT /reject`, AlertDialog explaining full reversal), Mark Paid (`PUT /mark-paid`), Cancel (`DELETE`, AlertDialog: reverses loans/reimbursements). KPI cards: gross / deductions / net / employer cost (reuse `PaymentKpiCards` pattern).
  - **Entries tab**: `GET /runs/{id}/entries`. Columns: employee, days (present/absent/leave), gross, deductions, net, status. Row expand → component breakdown (`components[]`: earnings vs deductions vs employer, TDS highlighted). Row actions: Hold (dialog w/ reason → `PUT /entries/{id}/hold`), Release. Held rows visually muted with reason tooltip.
  - **Errors tab** (badge with count): `GET /runs/{id}/errors` — employee, stage, message; empty-state "all employees processed".
  - **Payslips tab**: Generate (`POST /payslips/generate`), per-entry Download (`GET /payslips/{id}/download`, `downloadFileFromUrl`), Email all (`POST /payslips/email` → result dialog with SENT/FAILED per employee).
  - **Bank file tab**: format select (CSV/XLSX/HDFC/ICICI/SBI) → `POST /reports/bank-export` → result panel showing `skipped` list (employee + reason — the thing admins must fix) + Download (`GET /reports/bank-export/{id}/download`).
  - **Journal chip** in header once APPROVED: links to Finance → Journal filtered to the period.

### 3.2 Payroll — Variable Pay (`/erp/payroll/adjustments`)
Tabs: **Adjustments** (list `GET /payroll/adjustments?year&month`, MonthPicker; create dialog: employee picker (new shared `EmployeePicker` combobox over employees list), type EARNING/DEDUCTION, code/label, amount, run-scope select; delete unconsumed; consumed rows show payroll-entry link) · **Teaching Pay** (`GET /hr/teaching/summary` table + Preview/Materialize buttons → `POST /pay/preview|materialize`; rate-missing rows flagged `unrated` with a link to the employee's custom fields) · **Incentives** (`GET /hr/incentives/preview` with commissionPct/fixedPerConversion inputs → preview table (revenue, paying leads, incentive, unlinked flags) → Materialize with payout-month picker) · **F&F** (exiting-employee picker → `POST /payroll/fnf/prepare` (notice-recovery input) → summary panel → "Create FNF run" shortcut).

### 3.3 Payroll — Loans & Claims (`/erp/payroll/loans`)
Tabs: **Loans** (list/create `POST /payroll/loans`, approve, repayment schedule sheet `GET /loans/{id}/repayments`) · **Reimbursements** (queue `GET /payroll/reimbursements?status=`, approve/reject dialog).

### 3.4 Payroll — Salary Setup (`/erp/payroll/salary-setup`, adminOnly)
Tabs: **Components** (CRUD; columns type/category/taxable/statutory + **GL account code** column — the journal mapping) · **Templates** (list; template editor dialog: component rows with calculation type FIXED/%CTC/%BASIC/%GROSS/FORMULA + SpEL formula input with the variable hints, min/max; tie-out note: "Special Allowance auto-balances to CTC") · **Assign** (employee picker + template + CTC + effective-from + currency → `POST /salary/structures`; preview of computed breakdown; revision history sheet per employee `GET /salary/structures?employeeId` + `/revisions`).

### 3.5 People (`/erp/people`)
- **Employees list**: `GET /hr/employees` (+ filter dialog dept/designation/status/type). Columns: code, name, dept, designation, status chip, join date. "Add employee" full-form dialog (`POST /employees`) AND "Add from staff" (opens Staff Coverage).
- **Employee detail** (`/erp/people/$employeeId`, Sheet-or-page with tabs): Profile (edit; masked PAN/UAN with the ignore-masked-round-trip semantics already server-side) · Bank (masked accounts, add/edit) · Documents (upload via `use-file-upload`, list, expiry badges) · Salary (current structure + history + revise) · Leave balances (`GET /leaves/balances?employeeId`) · Loans · Status action (dialog: status + dates → `PUT /employees/{id}/status`; TERMINATED/RELIEVED flows prompt "prepare F&F?").
- **Departments & Designations** (`/erp/people/org`): two simple CRUD tables; link to existing Org Chart at `manage-institute/teams`.
- **Staff Coverage** (`/erp/people/staff-bridge`): `GET /hr/employees/staff-bridge` — coverage cards (total staff / with HR profile / teaching without profile), roster table with roles + `teaches` + blocked-reason, row action "Create HR profile" → `POST /from-staff` (minimal dialog: code/join date/dept/designation).

### 3.6 Attendance (`/erp/attendance`)
- **Daily Board**: date picker (default today, institute TZ) — grid of employees × status for the day; bulk-mark bar (`POST /attendance/mark`); month-lock banner when the month's payroll is processed. Summary strip from `GET /attendance/summary`.
- **Regularizations**: pending queue → approve/reject dialog (`PUT /regularization/{id}/approve`).
- **Shifts & Holidays**: shift CRUD + assign dialog; holiday calendar (year view, bulk-import dialog with duplicate-skip report); **Config** section (mode TIME_TRACKING/DAY_LEVEL, timezone select, weekend days, geo-fence map-less lat/lng/radius inputs, IP allowlist w/ CIDR hint, auto-checkout, thresholds) → `POST /attendance/config`.

### 3.7 Leave (`/erp/leave`)
- **Requests**: queue (`GET /leaves/applications?status=PENDING` default; filters). Approve/reject dialog shows balance check; month-lock and insufficient-balance errors surfaced verbatim (backend messages are good).
- **Balances**: employee × leave-type matrix for the year; admin adjust dialog; comp-off sub-tab (pending approvals + expiry dates); accrual/year-end buttons (adminOnly, AlertDialog explaining idempotency).
- **Types & Policies** (adminOnly): two CRUD tables (paid/carry-forward/encashable flags; policy quota/accrual/pro-rata).

### 3.8 Compliance (`/erp/compliance`, adminOnly)
- **Filings hub**: MonthPicker + FY selector; card grid, one per filing with status-of-data warnings from the APIs: PF ECR (preview table + skipped + download `.txt`), ESI return, PT return, WPS (shown only for Gulf institutes — country from tax config; SIF/Mudad download), Form 24Q (per-quarter: deductor block, challan match indicator w/ mismatch DANGER chip, annexure table, CSV), Form 16 (employee picker + FY → JSON view + PDF download; also surfaced in My HR).
- **Challans**: CRUD table (`/hr/compliance/challans`), quarter totals vs TDS deducted comparison.
- **Provisions**: Gratuity report table + CSV (India) / EOSB (Gulf — statutory vs accounting split, capped flags); Bonus computation (pct input → table → Materialize into BONUS adjustments).

### 3.9 Finance (`/erp/finance`)
- **Journal**: period browser (`GET /erp/finance/journal?year&month`) — entries with expandable balanced lines (Dr/Cr columns, `tabular-nums`), REVERSED badge, Export CSV (admin).
- **P&L Snapshot**: `GET /pnl-snapshot` — revenue vs payroll-cost cards, margin, dept cost table, journal-presence indicator, currency-mismatch warning, CSV.

### 3.10 My HR (`/erp/my-hr`) — self-service, phase 2
- **Overview**: my profile card (read-only + emergency-contact edit), check-in/out button when TIME_TRACKING (`POST /attendance/check-in|check-out` — employeeId omitted, backend resolves self), this-month attendance strip, leave balance cards, latest payslip shortcut.
- **My Leave**: balances + apply dialog (`POST /leaves/apply`) + my applications list + cancel; comp-off request.
- **My Payslips**: list + PDF download; **My Tax**: regime picker + declarations form (80C/80D/HRA rent/metro fields keyed to the engine's declaration keys) → submit/update; status chip (SUBMITTED/VERIFIED); Form 16 download per FY. **My Claims**: submit reimbursement (receipt upload), my loans + repayment schedule, my teaching summary (teachers).

### 3.11 ERP Settings (settings tab)
Tax configuration (country, state, FY start month, statutory toggles, declaration identifiers: TAN/PAN/PF establishment/ESI code/PT registration — the `statutory_settings` keys), HR role assignment shortcut (links to Teams), module opt-in note.

## 4. Key flows

1. **Run a month's payroll**: Runs → New run → Process (watch errors tab) → fix (hold/release, reject-recalculate loop) → Approve (journal posts) → Payslips generate + email → Bank file download → Mark Paid. The run-detail stepper is the backbone; every state shows exactly its legal next actions.
2. **Onboard an employee**: Staff Coverage → Create from staff → employee detail → assign salary structure → appears in next run. Coverage cards measure progress.
3. **Month close**: process locks attendance/leave — surface the lock as a banner on Attendance/Leave screens with a link to the run.
4. **Exit**: employee status → RELIEVED (+ last working date) → F&F prepare → FNF run.

## 5. New shared components

- **`MonthPicker`** (none exists — build once in `@/components/design-system/month-picker.tsx`, used by Payroll/Compliance/Finance/Adjustments).
- **`EmployeePicker`** — searchable combobox over the employees API (used by adjustments, loans, salary assign, F&F, Form 16).
- **`RunStatusStepper`** — payroll lifecycle visual.
- **`MoneyCell`** — `formatCurrency` + currency code + `tabular-nums` right-aligned.
- Reuse: `PaymentKpiCards` pattern, `DateRangeDropdown`, `export-dialog-pdf-csv`, `simple-pdf-viewer` (payslips/Form16), `StatusChip`, org-chart canvas.

## 6. Phased build plan (payroll ops first)

| Phase | Scope | Outcome |
|---|---|---|
| **U1 — Foundation + Payroll core** | ERP category plumbing (§1), hooks (§2), urls.ts block, MonthPicker/EmployeePicker/MoneyCell/Stepper, People (list/detail/departments/staff-bridge), Salary Setup, Payroll Runs + Run detail (entries/errors/hold), Adjustments tab | An HR admin runs a real payroll end-to-end in the UI |
| **U2 — Pay it + prove it** | Payslips tab (generate/download/email), Bank file tab, Loans & Claims, F&F, Compliance hub (ECR/ESI/PT/24Q/challans/Form 16), Finance (journal + P&L) | Payout + statutory outputs all UI-driven |
| **U3 — Attendance & Leave** | Daily board, regularizations, shifts/holidays/config, Leave requests/balances/setup, month-lock banners | Daily-ops adoption; LOP feeds payroll visibly |
| **U4 — My HR** | Self-service overview, leave, payslips, tax declarations, claims, check-in | Every employee touches the system |
| **U5 — Connected + polish** | Teaching Pay + Incentives tabs, Provisions (gratuity/EOSB/bonus), WPS (Gulf), ERP dashboard widget(s), Capacitor check-in ergonomics | The connected-ERP story visible |

Per-phase definition of done: `pnpm build` (tsc) clean, design-lint clean, naming-lint clean, co-located tests for hooks/utils (vitest), loading/empty/error states on every table, both themes checked.

## 7. Guardrails

Follow `CLAUDE.md` + `docs/design-system/*` strictly: tokens only (no raw hex/arbitrary values), phosphor icons only, `getTerminology` for renamable nouns, snake_case payloads, `reportApiError` for failures, `MyButton onAsyncClick` for mutations (double-submit guard), zero-indexed pagination, ship behind `OPT_IN_TAB_IDS` until QA'd on a pilot institute.
