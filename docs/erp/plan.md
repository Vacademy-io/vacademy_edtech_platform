HR & Payroll Management System — Implementation Plan
Context
Vacademy is a multi-tenant EdTech platform. Institutes (tenants) manage students, courses, assessments, and staff. Currently, staff are represented only as User + UserRole with no HR capabilities — no departments, designations, salary structures, attendance, leave, or payroll. This plan adds a production-grade, multi-country HR & Payroll system inside admin_core_service.
Key decisions:
Lives inside admin_core_service as new feature packages
EmployeeProfile linked 1:1 to existing User (non-invasive)
Attendance: configurable per institute (time-tracking OR day-level)
Salary: CTC-based with configurable components
Tax: pluggable multi-country engine (Strategy pattern)
Disbursement: payslips (PDF) + bank-ready file export (CSV/Excel)

Package Structure
admin_core_service/src/main/java/vacademy/io/admin_core_service/features/
├── hr_employee/          # Employee profiles, departments, designations
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── dto/
│   ├── entity/
│   └── enums/
├── hr_attendance/        # Attendance, shifts, holidays, regularization
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── dto/
│   ├── entity/
│   └── enums/
├── hr_leave/             # Leave types, policies, applications, balances
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── dto/
│   ├── entity/
│   └── enums/
├── hr_salary/            # Salary templates, components, structures
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── dto/
│   ├── entity/
│   └── enums/
├── hr_payroll/           # Payroll runs, entries, loans, reimbursements
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── dto/
│   ├── entity/
│   └── enums/
├── hr_tax/               # Tax engine, declarations, computations
│   ├── controller/
│   ├── service/
│   │   ├── engine/       # TaxRegime strategy implementations
│   │   └── ...
│   ├── repository/
│   ├── dto/
│   ├── entity/
│   └── enums/
├── hr_payslip/           # Payslip generation, bank export, reports
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── dto/
│   ├── entity/
│   └── enums/
└── hr_approval/          # Generic workflow/approval engine
    ├── controller/
    ├── service/
    ├── repository/
    ├── dto/
    ├── entity/
    └── enums/


A. Entity Design
A1. Employee Management (hr_employee)
Department — hr_department
id              UUID PK
institute_id    UUID NOT NULL (FK → institutes)
name            VARCHAR(255) NOT NULL
code            VARCHAR(50)
parent_id       UUID (FK → hr_department, self-ref for hierarchy)
head_user_id    UUID (FK → users, department head)
description     TEXT
status          VARCHAR(20) DEFAULT 'ACTIVE'   -- ACTIVE, INACTIVE
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(institute_id, code)

Designation — hr_designation
id              UUID PK
institute_id    UUID NOT NULL
name            VARCHAR(255) NOT NULL
code            VARCHAR(50)
level           INT           -- seniority level (1=entry, 10=C-suite)
grade           VARCHAR(50)   -- pay grade (A, B, C or custom)
description     TEXT
status          VARCHAR(20) DEFAULT 'ACTIVE'
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(institute_id, code)

EmployeeProfile — hr_employee_profile
id                  UUID PK
user_id             UUID NOT NULL UNIQUE (FK → users, 1:1)
institute_id        UUID NOT NULL
employee_code       VARCHAR(50)
department_id       UUID (FK → hr_department)
designation_id      UUID (FK → hr_designation)
reporting_manager_id UUID (FK → hr_employee_profile, self-ref)
employment_type     VARCHAR(20)    -- FULL_TIME, PART_TIME, CONTRACT, INTERN
employment_status   VARCHAR(20)    -- ACTIVE, PROBATION, NOTICE_PERIOD, RELIEVED, TERMINATED, ABSCONDING
join_date           DATE NOT NULL
probation_end_date  DATE
confirmation_date   DATE
notice_period_days  INT DEFAULT 30
resignation_date    DATE
last_working_date   DATE
exit_reason         TEXT
emergency_contact_name    VARCHAR(255)
emergency_contact_phone   VARCHAR(25)
emergency_contact_relation VARCHAR(50)
nationality         VARCHAR(100)
blood_group         VARCHAR(5)
marital_status      VARCHAR(20)
pan_number          VARCHAR(20)    -- India tax ID (generic: tax_id_number)
tax_id_number       VARCHAR(50)    -- country-agnostic tax identifier
uan_number          VARCHAR(20)    -- India PF universal account (generic via JSON)
statutory_info      JSONB          -- country-specific IDs: { "epf_number": "...", "esi_number": "...", "ssn": "..." }
custom_fields       JSONB          -- institute-defined custom fields
created_at          TIMESTAMP
updated_at          TIMESTAMP
UNIQUE(institute_id, employee_code)

EmployeeBankDetail — hr_employee_bank_detail
id              UUID PK
employee_id     UUID NOT NULL (FK → hr_employee_profile)
account_holder_name VARCHAR(255)
account_number  VARCHAR(50) NOT NULL
bank_name       VARCHAR(255)
branch_name     VARCHAR(255)
ifsc_code       VARCHAR(20)     -- India-specific
swift_code      VARCHAR(20)     -- international
routing_number  VARCHAR(20)     -- US/other
iban            VARCHAR(50)     -- international
is_primary      BOOLEAN DEFAULT TRUE
status          VARCHAR(20) DEFAULT 'ACTIVE'
created_at      TIMESTAMP
updated_at      TIMESTAMP

EmployeeDocument — hr_employee_document
id              UUID PK
employee_id     UUID NOT NULL (FK → hr_employee_profile)
document_type   VARCHAR(50)   -- OFFER_LETTER, APPOINTMENT_LETTER, ID_PROOF, PAN_CARD, AADHAAR, PASSPORT, DEGREE, EXPERIENCE_LETTER, RELIEVING_LETTER, PAYSLIP, FORM16, OTHER
document_name   VARCHAR(255)
file_id         VARCHAR(255)  -- S3 file reference (existing media_service pattern)
file_url        TEXT
expiry_date     DATE
verified        BOOLEAN DEFAULT FALSE
verified_by     UUID
verified_at     TIMESTAMP
notes           TEXT
created_at      TIMESTAMP
updated_at      TIMESTAMP

A2. Attendance Management (hr_attendance)
AttendanceConfig — hr_attendance_config
id              UUID PK
institute_id    UUID NOT NULL UNIQUE
mode            VARCHAR(20) NOT NULL  -- TIME_TRACKING, DAY_LEVEL
auto_checkout_enabled  BOOLEAN DEFAULT FALSE
auto_checkout_time     TIME
geo_fence_enabled      BOOLEAN DEFAULT FALSE
geo_fence_lat          DOUBLE
geo_fence_lng          DOUBLE
geo_fence_radius_m     INT
ip_restriction_enabled BOOLEAN DEFAULT FALSE
allowed_ips            JSONB           -- ["192.168.1.0/24", ...]
overtime_enabled       BOOLEAN DEFAULT FALSE
overtime_threshold_min INT DEFAULT 480 -- minutes after which OT starts
half_day_threshold_min INT DEFAULT 240 -- min minutes for half day
weekend_days           JSONB DEFAULT '["SATURDAY","SUNDAY"]'
settings               JSONB           -- additional config
created_at             TIMESTAMP
updated_at             TIMESTAMP

Shift — hr_shift
id              UUID PK
institute_id    UUID NOT NULL
name            VARCHAR(100) NOT NULL
code            VARCHAR(20)
start_time      TIME NOT NULL
end_time        TIME NOT NULL
break_duration_min INT DEFAULT 60
is_night_shift  BOOLEAN DEFAULT FALSE
grace_period_min INT DEFAULT 15
min_hours_full_day DECIMAL(4,2) DEFAULT 8.0
min_hours_half_day DECIMAL(4,2) DEFAULT 4.0
is_default      BOOLEAN DEFAULT FALSE
status          VARCHAR(20) DEFAULT 'ACTIVE'
created_at      TIMESTAMP
updated_at      TIMESTAMP

EmployeeShiftMapping — hr_employee_shift_mapping
id              UUID PK
employee_id     UUID NOT NULL (FK → hr_employee_profile)
shift_id        UUID NOT NULL (FK → hr_shift)
effective_from  DATE NOT NULL
effective_to    DATE
created_at      TIMESTAMP

AttendanceRecord — hr_attendance_record
id              UUID PK
employee_id     UUID NOT NULL (FK → hr_employee_profile)
institute_id    UUID NOT NULL
attendance_date DATE NOT NULL
shift_id        UUID (FK → hr_shift)
-- Time tracking fields
check_in_time   TIMESTAMP
check_out_time  TIMESTAMP
total_hours     DECIMAL(5,2)
overtime_hours  DECIMAL(5,2) DEFAULT 0
break_duration_min INT
-- Day-level fields
status          VARCHAR(20) NOT NULL  -- PRESENT, ABSENT, HALF_DAY, ON_LEAVE, HOLIDAY, WEEKEND, COMP_OFF
-- Metadata
check_in_lat    DOUBLE
check_in_lng    DOUBLE
check_out_lat   DOUBLE
check_out_lng   DOUBLE
check_in_ip     VARCHAR(45)
check_out_ip    VARCHAR(45)
source          VARCHAR(20) DEFAULT 'MANUAL'  -- MANUAL, BIOMETRIC, GEO, ADMIN
remarks         TEXT
is_regularized  BOOLEAN DEFAULT FALSE
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(employee_id, attendance_date)

AttendanceRegularization — hr_attendance_regularization
id                  UUID PK
attendance_id       UUID NOT NULL (FK → hr_attendance_record)
employee_id         UUID NOT NULL
original_status     VARCHAR(20)
requested_status    VARCHAR(20)
original_check_in   TIMESTAMP
original_check_out  TIMESTAMP
requested_check_in  TIMESTAMP
requested_check_out TIMESTAMP
reason              TEXT NOT NULL
approval_status     VARCHAR(20) DEFAULT 'PENDING'  -- PENDING, APPROVED, REJECTED
approved_by         UUID
approved_at         TIMESTAMP
remarks             TEXT
created_at          TIMESTAMP
updated_at          TIMESTAMP

HolidayCalendar — hr_holiday
id              UUID PK
institute_id    UUID NOT NULL
name            VARCHAR(255) NOT NULL
date            DATE NOT NULL
type            VARCHAR(20)  -- NATIONAL, REGIONAL, OPTIONAL, RESTRICTED
is_optional     BOOLEAN DEFAULT FALSE
max_optional_allowed INT    -- per year for optional holidays
year            INT NOT NULL
description     TEXT
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(institute_id, date)

A3. Leave Management (hr_leave)
LeaveType — hr_leave_type
id              UUID PK
institute_id    UUID NOT NULL
name            VARCHAR(100) NOT NULL  -- Casual Leave, Sick Leave, Earned Leave, etc.
code            VARCHAR(20) NOT NULL
is_paid         BOOLEAN DEFAULT TRUE
is_carry_forward BOOLEAN DEFAULT FALSE
max_carry_forward INT DEFAULT 0
is_encashable   BOOLEAN DEFAULT FALSE
requires_document BOOLEAN DEFAULT FALSE  -- medical certificate for sick leave
min_days        DECIMAL(3,1) DEFAULT 0.5 -- minimum 0.5 for half-day
max_consecutive_days INT
applicable_gender VARCHAR(10)  -- ALL, MALE, FEMALE (for maternity/paternity)
description     TEXT
status          VARCHAR(20) DEFAULT 'ACTIVE'
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(institute_id, code)

LeavePolicy — hr_leave_policy
id                  UUID PK
institute_id        UUID NOT NULL
leave_type_id       UUID NOT NULL (FK → hr_leave_type)
annual_quota        DECIMAL(5,1) NOT NULL  -- total days per year
accrual_type        VARCHAR(20)  -- YEARLY, MONTHLY, QUARTERLY
accrual_amount      DECIMAL(5,2) -- days per accrual period
pro_rata_enabled    BOOLEAN DEFAULT TRUE  -- for mid-year joiners
applicable_after_days INT DEFAULT 0 -- apply after N days from joining
applicable_employment_types JSONB DEFAULT '["FULL_TIME"]'
effective_from      DATE NOT NULL
effective_to        DATE
status              VARCHAR(20) DEFAULT 'ACTIVE'
created_at          TIMESTAMP
updated_at          TIMESTAMP

LeaveBalance — hr_leave_balance
id              UUID PK
employee_id     UUID NOT NULL (FK → hr_employee_profile)
leave_type_id   UUID NOT NULL (FK → hr_leave_type)
year            INT NOT NULL
opening_balance DECIMAL(5,1) DEFAULT 0
accrued         DECIMAL(5,1) DEFAULT 0
used            DECIMAL(5,1) DEFAULT 0
adjustment      DECIMAL(5,1) DEFAULT 0  -- manual admin adjustment
carried_forward DECIMAL(5,1) DEFAULT 0
encashed        DECIMAL(5,1) DEFAULT 0
closing_balance DECIMAL(5,1) GENERATED ALWAYS AS (opening_balance + accrued + carried_forward + adjustment - used - encashed) STORED
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(employee_id, leave_type_id, year)

LeaveApplication — hr_leave_application
id              UUID PK
employee_id     UUID NOT NULL (FK → hr_employee_profile)
institute_id    UUID NOT NULL
leave_type_id   UUID NOT NULL (FK → hr_leave_type)
from_date       DATE NOT NULL
to_date         DATE NOT NULL
total_days      DECIMAL(5,1) NOT NULL
is_half_day     BOOLEAN DEFAULT FALSE
half_day_type   VARCHAR(10)  -- FIRST_HALF, SECOND_HALF
reason          TEXT
document_file_id VARCHAR(255)  -- supporting document (S3)
status          VARCHAR(20) DEFAULT 'PENDING' -- PENDING, APPROVED, REJECTED, CANCELLED, REVOKED
applied_to      UUID   -- manager user_id
approved_by     UUID
approved_at     TIMESTAMP
rejection_reason TEXT
created_at      TIMESTAMP
updated_at      TIMESTAMP

CompensatoryOff — hr_comp_off
id              UUID PK
employee_id     UUID NOT NULL (FK → hr_employee_profile)
worked_on_date  DATE NOT NULL  -- the holiday/weekend they worked
earned_days     DECIMAL(3,1) DEFAULT 1.0
expiry_date     DATE           -- comp offs expire
used            BOOLEAN DEFAULT FALSE
used_leave_application_id UUID (FK → hr_leave_application)
approved_by     UUID
status          VARCHAR(20) DEFAULT 'PENDING' -- PENDING, APPROVED, REJECTED, USED, EXPIRED
created_at      TIMESTAMP
updated_at      TIMESTAMP

A4. Salary Structure (hr_salary)
SalaryComponent — hr_salary_component
id              UUID PK
institute_id    UUID NOT NULL
name            VARCHAR(100) NOT NULL  -- Basic Salary, HRA, DA, Special Allowance, PF, ESI, TDS...
code            VARCHAR(30) NOT NULL
type            VARCHAR(30) NOT NULL   -- EARNING, DEDUCTION, EMPLOYER_CONTRIBUTION
category        VARCHAR(30)            -- FIXED, VARIABLE, STATUTORY
is_taxable      BOOLEAN DEFAULT TRUE
is_statutory    BOOLEAN DEFAULT FALSE
is_active       BOOLEAN DEFAULT TRUE
display_order   INT DEFAULT 0
description     TEXT
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(institute_id, code)

SalaryTemplate — hr_salary_template
id              UUID PK
institute_id    UUID NOT NULL
name            VARCHAR(255) NOT NULL
description     TEXT
is_default      BOOLEAN DEFAULT FALSE
status          VARCHAR(20) DEFAULT 'ACTIVE'
created_at      TIMESTAMP
updated_at      TIMESTAMP

SalaryTemplateComponent — hr_salary_template_component
id              UUID PK
template_id     UUID NOT NULL (FK → hr_salary_template)
component_id    UUID NOT NULL (FK → hr_salary_component)
calculation_type VARCHAR(30) NOT NULL  -- FIXED_AMOUNT, PERCENTAGE_OF_BASIC, PERCENTAGE_OF_CTC, PERCENTAGE_OF_GROSS, FORMULA
percentage_value DECIMAL(8,4)          -- e.g., 40.0000 for 40%
fixed_value     DECIMAL(15,2)          -- used when calculation_type = FIXED_AMOUNT
formula         TEXT                    -- custom formula expression (advanced)
min_value       DECIMAL(15,2)          -- floor
max_value       DECIMAL(15,2)          -- ceiling cap
display_order   INT DEFAULT 0
is_mandatory    BOOLEAN DEFAULT TRUE
created_at      TIMESTAMP
updated_at      TIMESTAMP

EmployeeSalaryStructure — hr_employee_salary_structure
id              UUID PK
employee_id     UUID NOT NULL (FK → hr_employee_profile)
template_id     UUID (FK → hr_salary_template)
effective_from  DATE NOT NULL
effective_to    DATE
ctc_annual      DECIMAL(15,2) NOT NULL
ctc_monthly     DECIMAL(15,2) GENERATED ALWAYS AS (ctc_annual / 12) STORED
gross_monthly   DECIMAL(15,2)
net_monthly     DECIMAL(15,2)  -- estimated (before variable deductions)
status          VARCHAR(20) DEFAULT 'ACTIVE'  -- ACTIVE, SUPERSEDED, DRAFT
revision_reason TEXT
approved_by     UUID
approved_at     TIMESTAMP
created_at      TIMESTAMP
updated_at      TIMESTAMP

EmployeeSalaryComponent — hr_employee_salary_component
id                      UUID PK
salary_structure_id     UUID NOT NULL (FK → hr_employee_salary_structure)
component_id            UUID NOT NULL (FK → hr_salary_component)
monthly_amount          DECIMAL(15,2) NOT NULL
annual_amount           DECIMAL(15,2) NOT NULL
calculation_type        VARCHAR(30)   -- override from template
percentage_value        DECIMAL(8,4)
is_overridden           BOOLEAN DEFAULT FALSE  -- manually adjusted?
created_at              TIMESTAMP
updated_at              TIMESTAMP

SalaryRevisionHistory — hr_salary_revision
id                  UUID PK
employee_id         UUID NOT NULL (FK → hr_employee_profile)
old_structure_id    UUID (FK → hr_employee_salary_structure)
new_structure_id    UUID NOT NULL (FK → hr_employee_salary_structure)
old_ctc             DECIMAL(15,2)
new_ctc             DECIMAL(15,2)
increment_pct       DECIMAL(5,2)
reason              TEXT
effective_date      DATE NOT NULL
approved_by         UUID
created_at          TIMESTAMP

A5. Payroll Processing (hr_payroll)
PayrollRun — hr_payroll_run
id              UUID PK
institute_id    UUID NOT NULL
month           INT NOT NULL (1-12)
year            INT NOT NULL
run_date        DATE
status          VARCHAR(20) DEFAULT 'DRAFT'  -- DRAFT, PROCESSING, PROCESSED, APPROVED, PAID, CANCELLED
total_employees INT
total_gross     DECIMAL(18,2)
total_deductions DECIMAL(18,2)
total_net_pay   DECIMAL(18,2)
total_employer_cost DECIMAL(18,2) -- gross + employer contributions
processed_by    UUID
processed_at    TIMESTAMP
approved_by     UUID
approved_at     TIMESTAMP
paid_at         TIMESTAMP
notes           TEXT
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(institute_id, month, year)

PayrollEntry — hr_payroll_entry
id              UUID PK
payroll_run_id  UUID NOT NULL (FK → hr_payroll_run)
employee_id     UUID NOT NULL (FK → hr_employee_profile)
salary_structure_id UUID (FK → hr_employee_salary_structure)
-- Summary
gross_salary    DECIMAL(15,2) NOT NULL
total_earnings  DECIMAL(15,2)
total_deductions DECIMAL(15,2)
total_employer_contributions DECIMAL(15,2)
net_pay         DECIMAL(15,2) NOT NULL
-- Attendance-based
total_working_days INT
days_present    DECIMAL(5,1)
days_absent     DECIMAL(5,1)
days_on_leave   DECIMAL(5,1)
days_holiday    INT
overtime_hours  DECIMAL(5,2) DEFAULT 0
-- Adjustments
arrears         DECIMAL(15,2) DEFAULT 0
reimbursements  DECIMAL(15,2) DEFAULT 0
loan_deduction  DECIMAL(15,2) DEFAULT 0
other_earnings  DECIMAL(15,2) DEFAULT 0
other_deductions DECIMAL(15,2) DEFAULT 0
-- Status
status          VARCHAR(20) DEFAULT 'CALCULATED'  -- CALCULATED, HELD, PAID
hold_reason     TEXT
-- Bank
bank_account_id UUID (FK → hr_employee_bank_detail)
payment_ref     VARCHAR(255)  -- UTR / transaction reference
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(payroll_run_id, employee_id)

PayrollEntryComponent — hr_payroll_entry_component
id              UUID PK
payroll_entry_id UUID NOT NULL (FK → hr_payroll_entry)
component_id    UUID NOT NULL (FK → hr_salary_component)
component_type  VARCHAR(30)  -- EARNING, DEDUCTION, EMPLOYER_CONTRIBUTION
amount          DECIMAL(15,2) NOT NULL
created_at      TIMESTAMP

EmployeeLoan — hr_employee_loan
id              UUID PK
employee_id     UUID NOT NULL (FK → hr_employee_profile)
institute_id    UUID NOT NULL
loan_type       VARCHAR(30)  -- SALARY_ADVANCE, PERSONAL_LOAN, OTHER
principal_amount DECIMAL(15,2) NOT NULL
interest_rate   DECIMAL(5,2) DEFAULT 0
tenure_months   INT NOT NULL
emi_amount      DECIMAL(15,2) NOT NULL
disbursed_amount DECIMAL(15,2)
balance_amount  DECIMAL(15,2)
start_month     INT
start_year      INT
status          VARCHAR(20) DEFAULT 'PENDING'  -- PENDING, APPROVED, ACTIVE, CLOSED, REJECTED
approved_by     UUID
approved_at     TIMESTAMP
notes           TEXT
created_at      TIMESTAMP
updated_at      TIMESTAMP

LoanRepayment — hr_loan_repayment
id              UUID PK
loan_id         UUID NOT NULL (FK → hr_employee_loan)
payroll_entry_id UUID (FK → hr_payroll_entry)
amount          DECIMAL(15,2) NOT NULL
repayment_date  DATE
month           INT
year            INT
balance_after   DECIMAL(15,2)
created_at      TIMESTAMP

Reimbursement — hr_reimbursement
id              UUID PK
employee_id     UUID NOT NULL (FK → hr_employee_profile)
institute_id    UUID NOT NULL
type            VARCHAR(50)  -- TRAVEL, MEDICAL, FOOD, PHONE, INTERNET, OTHER
amount          DECIMAL(15,2) NOT NULL
description     TEXT
receipt_file_id VARCHAR(255)  -- S3 reference
expense_date    DATE
status          VARCHAR(20) DEFAULT 'PENDING'  -- PENDING, APPROVED, REJECTED, PAID
approved_by     UUID
approved_at     TIMESTAMP
payroll_entry_id UUID (FK → hr_payroll_entry)  -- linked when paid
rejection_reason TEXT
created_at      TIMESTAMP
updated_at      TIMESTAMP

A6. Tax Engine (hr_tax)
TaxConfiguration — hr_tax_configuration
id              UUID PK
institute_id    UUID NOT NULL
country_code    VARCHAR(3) NOT NULL   -- IND, USA, GBR, UAE, etc.
state_code      VARCHAR(10)           -- for state-level tax (professional tax in India)
financial_year_start_month INT DEFAULT 4  -- April for India, January for US
tax_rules       JSONB                 -- country-specific slab/rules configuration
employer_contributions JSONB          -- PF/ESI/SSN employer rates
statutory_settings JSONB              -- additional country-specific settings
status          VARCHAR(20) DEFAULT 'ACTIVE'
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(institute_id, country_code)

TaxDeclaration — hr_tax_declaration
id              UUID PK
employee_id     UUID NOT NULL (FK → hr_employee_profile)
financial_year  VARCHAR(10) NOT NULL  -- "2025-26"
regime          VARCHAR(20)           -- OLD, NEW (India-specific; stored generically)
declarations    JSONB NOT NULL        -- { "section_80c": 150000, "section_80d": 25000, "hra_rent_paid": 240000, ... }
proof_submitted BOOLEAN DEFAULT FALSE
proof_verified  BOOLEAN DEFAULT FALSE
verified_by     UUID
verified_at     TIMESTAMP
status          VARCHAR(20) DEFAULT 'DRAFT'  -- DRAFT, SUBMITTED, VERIFIED, LOCKED
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(employee_id, financial_year)

TaxComputation — hr_tax_computation
id                  UUID PK
employee_id         UUID NOT NULL (FK → hr_employee_profile)
financial_year      VARCHAR(10) NOT NULL
month               INT NOT NULL
year                INT NOT NULL
-- Projected
projected_annual_income   DECIMAL(15,2)
projected_annual_tax      DECIMAL(15,2)
projected_monthly_tax     DECIMAL(15,2)
-- Actual
actual_income_till_date   DECIMAL(15,2)
actual_tax_deducted       DECIMAL(15,2)
-- Exemptions
total_exemptions          DECIMAL(15,2)
total_deductions_80c      DECIMAL(15,2)
computation_details       JSONB  -- full breakdown
created_at                TIMESTAMP
updated_at                TIMESTAMP

A7. Payslip & Reports (hr_payslip)
Payslip — hr_payslip
id              UUID PK
payroll_entry_id UUID NOT NULL (FK → hr_payroll_entry)
employee_id     UUID NOT NULL
institute_id    UUID NOT NULL
month           INT NOT NULL
year            INT NOT NULL
file_id         VARCHAR(255)  -- S3 PDF reference
file_url        TEXT
generated_at    TIMESTAMP
emailed_at      TIMESTAMP
email_status    VARCHAR(20)  -- PENDING, SENT, FAILED
created_at      TIMESTAMP
UNIQUE(payroll_entry_id)

BankExportLog — hr_bank_export_log
id              UUID PK
payroll_run_id  UUID NOT NULL (FK → hr_payroll_run)
institute_id    UUID NOT NULL
file_id         VARCHAR(255)  -- S3 reference
file_name       VARCHAR(255)
format          VARCHAR(20)   -- CSV, XLSX, HDFC_FORMAT, SBI_FORMAT, ICICI_FORMAT
total_records   INT
total_amount    DECIMAL(18,2)
generated_by    UUID
generated_at    TIMESTAMP
created_at      TIMESTAMP

A8. Approval Workflow (hr_approval)
ApprovalChain — hr_approval_chain
id              UUID PK
institute_id    UUID NOT NULL
entity_type     VARCHAR(50) NOT NULL  -- LEAVE_APPLICATION, ATTENDANCE_REGULARIZATION, REIMBURSEMENT, LOAN, SALARY_REVISION
approval_levels INT DEFAULT 1
level_config    JSONB  -- [{ "level": 1, "approver_type": "REPORTING_MANAGER" }, { "level": 2, "approver_type": "HR_ADMIN" }]
auto_approve_after_days INT  -- auto-approve if no action
status          VARCHAR(20) DEFAULT 'ACTIVE'
created_at      TIMESTAMP
updated_at      TIMESTAMP
UNIQUE(institute_id, entity_type)

ApprovalRequest — hr_approval_request
id              UUID PK
institute_id    UUID NOT NULL
entity_type     VARCHAR(50) NOT NULL
entity_id       UUID NOT NULL          -- FK to the entity (leave_application_id, etc.)
requester_id    UUID NOT NULL           -- employee who requested
current_level   INT DEFAULT 1
total_levels    INT DEFAULT 1
status          VARCHAR(20) DEFAULT 'PENDING'  -- PENDING, APPROVED, REJECTED, CANCELLED
created_at      TIMESTAMP
updated_at      TIMESTAMP

ApprovalAction — hr_approval_action
id              UUID PK
request_id      UUID NOT NULL (FK → hr_approval_request)
level           INT NOT NULL
action          VARCHAR(20) NOT NULL    -- APPROVED, REJECTED
actor_id        UUID NOT NULL
comments        TEXT
acted_at        TIMESTAMP NOT NULL
created_at      TIMESTAMP


B. Enums
// hr_employee
EmploymentType      { FULL_TIME, PART_TIME, CONTRACT, INTERN }
EmploymentStatus    { ACTIVE, PROBATION, NOTICE_PERIOD, RELIEVED, TERMINATED, ABSCONDING }
DocumentType        { OFFER_LETTER, APPOINTMENT_LETTER, ID_PROOF, PAN_CARD, AADHAAR, PASSPORT, DEGREE, EXPERIENCE_LETTER, RELIEVING_LETTER, OTHER }

// hr_attendance
AttendanceMode      { TIME_TRACKING, DAY_LEVEL }
AttendanceStatus    { PRESENT, ABSENT, HALF_DAY, ON_LEAVE, HOLIDAY, WEEKEND, COMP_OFF }
AttendanceSource    { MANUAL, BIOMETRIC, GEO, ADMIN }

// hr_leave
LeaveStatus         { PENDING, APPROVED, REJECTED, CANCELLED, REVOKED }
HalfDayType         { FIRST_HALF, SECOND_HALF }
AccrualType         { YEARLY, MONTHLY, QUARTERLY }

// hr_salary
ComponentType       { EARNING, DEDUCTION, EMPLOYER_CONTRIBUTION }
ComponentCategory   { FIXED, VARIABLE, STATUTORY }
CalculationType     { FIXED_AMOUNT, PERCENTAGE_OF_BASIC, PERCENTAGE_OF_CTC, PERCENTAGE_OF_GROSS, FORMULA }

// hr_payroll
PayrollStatus       { DRAFT, PROCESSING, PROCESSED, APPROVED, PAID, CANCELLED }
PayrollEntryStatus  { CALCULATED, HELD, PAID }
LoanType            { SALARY_ADVANCE, PERSONAL_LOAN, OTHER }
LoanStatus          { PENDING, APPROVED, ACTIVE, CLOSED, REJECTED }
ReimbursementType   { TRAVEL, MEDICAL, FOOD, PHONE, INTERNET, OTHER }

// hr_tax
TaxRegime           { OLD, NEW }  // India; extensible per country
DeclarationStatus   { DRAFT, SUBMITTED, VERIFIED, LOCKED }

// hr_approval
ApprovalEntityType  { LEAVE_APPLICATION, ATTENDANCE_REGULARIZATION, REIMBURSEMENT, LOAN, SALARY_REVISION }
ApprovalStatus      { PENDING, APPROVED, REJECTED, CANCELLED }
ApproverType        { REPORTING_MANAGER, DEPARTMENT_HEAD, HR_ADMIN, CUSTOM }


C. Tax Engine — Strategy Pattern
TaxRegime (interface)
├── calculateMonthlyTax(employee, month, year, income) → TaxBreakdown
├── calculateAnnualProjection(employee, year) → AnnualTaxProjection
├── getEmployerContributions(employee, grossSalary) → Map<String, BigDecimal>
├── getStatutoryDeductions(employee, grossSalary) → Map<String, BigDecimal>
└── getSupportedComponents() → List<SalaryComponent>

IndiaTaxRegime implements TaxRegime
├── TDS calculation (old regime 5-slab, new regime 6-slab)
├── EPF: 12% employee + 12% employer (capped at ₹15,000 basic)
├── ESI: 0.75% employee + 3.25% employer (if gross ≤ ₹21,000)
├── Professional Tax: state-wise monthly slabs
├── Section 80C/80D/HRA exemption processing
└── Form 16 data preparation

USATaxRegime implements TaxRegime
├── Federal income tax brackets
├── Social Security (6.2% employee + 6.2% employer)
├── Medicare (1.45% + 1.45%)
├── State income tax (configurable per state)
└── W-2 data preparation

UAETaxRegime implements TaxRegime
├── No income tax
├── Gratuity calculation
└── WPS (Wage Protection System) compliance

TaxRegimeFactory
└── getRegime(countryCode) → TaxRegime

Follows the exact pattern used by PaymentServiceFactory in admin_core_service.

D. API Endpoints (RESTful)
Base path: /admin-core-service/api/v1/hr
Employee Management
POST   /employees                          - Create employee profile
GET    /employees?instituteId=&page=&size=&dept=&status=  - List employees (paginated, filtered)
GET    /employees/{id}                     - Get employee detail
PUT    /employees/{id}                     - Update employee profile
PUT    /employees/{id}/status              - Change employment status (terminate, relieve, etc.)
GET    /employees/{id}/org-chart           - Get reporting hierarchy

POST   /departments                        - Create department
GET    /departments?instituteId=           - List departments (tree)
PUT    /departments/{id}                   - Update department
DELETE /departments/{id}                   - Deactivate department

POST   /designations                       - Create designation
GET    /designations?instituteId=          - List designations
PUT    /designations/{id}                  - Update designation

POST   /employees/{id}/bank-details       - Add bank detail
PUT    /employees/{id}/bank-details/{bid} - Update bank detail
GET    /employees/{id}/bank-details       - List bank details

POST   /employees/{id}/documents          - Upload document
GET    /employees/{id}/documents          - List documents
DELETE /employees/{id}/documents/{did}    - Remove document

Attendance
POST   /attendance/check-in               - Employee check-in (with geo/IP)
POST   /attendance/check-out              - Employee check-out
POST   /attendance/mark                   - Admin marks day-level attendance (bulk)
GET    /attendance?instituteId=&month=&year=&employeeId=  - Get attendance records
GET    /attendance/summary?instituteId=&month=&year=      - Monthly summary (all employees)
PUT    /attendance/{id}                    - Admin edit attendance record

POST   /attendance/regularization         - Request regularization
PUT    /attendance/regularization/{id}/approve  - Approve/reject regularization

POST   /attendance/config                 - Set attendance config
GET    /attendance/config?instituteId=     - Get attendance config

POST   /shifts                            - Create shift
GET    /shifts?instituteId=               - List shifts
PUT    /shifts/{id}                       - Update shift
POST   /shifts/assign                     - Assign shift to employees (bulk)

POST   /holidays                          - Create holiday
GET    /holidays?instituteId=&year=       - List holidays
PUT    /holidays/{id}                     - Update holiday
DELETE /holidays/{id}                     - Remove holiday
POST   /holidays/bulk                     - Bulk create holidays

Leave
POST   /leaves/types                      - Create leave type
GET    /leaves/types?instituteId=         - List leave types
PUT    /leaves/types/{id}                 - Update leave type

POST   /leaves/policies                   - Create leave policy
GET    /leaves/policies?instituteId=      - List leave policies
PUT    /leaves/policies/{id}              - Update leave policy

POST   /leaves/apply                      - Apply for leave
GET    /leaves/applications?instituteId=&status=&employeeId=  - List applications
PUT    /leaves/applications/{id}/action   - Approve/reject leave
PUT    /leaves/applications/{id}/cancel   - Cancel leave application

GET    /leaves/balances?employeeId=&year= - Get leave balances
PUT    /leaves/balances/{id}/adjust       - Admin adjust balance

POST   /leaves/comp-off                   - Request comp off
PUT    /leaves/comp-off/{id}/action       - Approve/reject comp off
POST   /leaves/accrue                     - Trigger monthly accrual (scheduled/manual)
POST   /leaves/year-end-process           - Year-end carry forward + encashment

Salary
POST   /salary/components                 - Create salary component
GET    /salary/components?instituteId=    - List components
PUT    /salary/components/{id}            - Update component

POST   /salary/templates                  - Create salary template
GET    /salary/templates?instituteId=     - List templates
GET    /salary/templates/{id}             - Get template with components
PUT    /salary/templates/{id}             - Update template

POST   /salary/structures                 - Assign salary structure to employee
GET    /salary/structures?employeeId=     - Get employee salary history
GET    /salary/structures/{id}            - Get structure with component breakdown
PUT    /salary/structures/{id}            - Revise salary structure

GET    /salary/revisions?employeeId=      - Get revision history

Payroll
POST   /payroll/runs                      - Create payroll run (month/year)
GET    /payroll/runs?instituteId=&year=   - List payroll runs
GET    /payroll/runs/{id}                 - Get payroll run detail
POST   /payroll/runs/{id}/process         - Process payroll (calculate all entries)
PUT    /payroll/runs/{id}/approve         - Approve payroll
PUT    /payroll/runs/{id}/mark-paid       - Mark as paid
DELETE /payroll/runs/{id}                 - Cancel payroll run

GET    /payroll/runs/{id}/entries         - List all entries in a run
GET    /payroll/entries/{id}              - Get single entry detail with components
PUT    /payroll/entries/{id}/hold         - Hold employee payment
PUT    /payroll/entries/{id}/release      - Release held payment

POST   /payroll/loans                     - Create loan/advance
GET    /payroll/loans?employeeId=         - List loans
PUT    /payroll/loans/{id}/approve        - Approve loan
GET    /payroll/loans/{id}/repayments     - Get repayment schedule

POST   /payroll/reimbursements            - Submit reimbursement
GET    /payroll/reimbursements?employeeId=&status=  - List reimbursements
PUT    /payroll/reimbursements/{id}/action - Approve/reject reimbursement

Tax
POST   /tax/config                        - Set tax configuration for institute
GET    /tax/config?instituteId=           - Get tax config

POST   /tax/declarations                  - Submit tax declaration
GET    /tax/declarations?employeeId=&fy=  - Get declarations
PUT    /tax/declarations/{id}             - Update declaration
PUT    /tax/declarations/{id}/verify      - Verify declaration (HR)

GET    /tax/computation?employeeId=&fy=   - Get tax computation summary

Payslip & Reports
POST   /payslips/generate                 - Generate payslips for a payroll run
GET    /payslips?employeeId=&year=        - List payslips
GET    /payslips/{id}/download            - Download payslip PDF
POST   /payslips/email                    - Email payslips to all employees

POST   /reports/bank-export               - Generate bank disbursement file
GET    /reports/bank-export/{id}/download - Download bank file
GET    /reports/payroll-summary?instituteId=&month=&year=  - Payroll summary
GET    /reports/department-cost?instituteId=&month=&year=  - Dept-wise cost
GET    /reports/attendance-summary?instituteId=&month=&year= - Attendance report
GET    /reports/leave-balance?instituteId=&year=           - Leave balance report
GET    /reports/tax-summary?instituteId=&fy=               - Tax deduction report

Approval Workflow
POST   /approvals/chains                  - Configure approval chain
GET    /approvals/chains?instituteId=     - List approval chains
PUT    /approvals/chains/{id}             - Update chain

GET    /approvals/pending?approverId=     - List pending approvals for a manager
POST   /approvals/{id}/action             - Approve/reject
GET    /approvals/history?entityType=&entityId=  - Approval audit trail


E. Service Layer Design
Service
Responsibility
EmployeeService
CRUD for employee profiles, status transitions, org chart queries
DepartmentService
Department CRUD, hierarchy traversal
DesignationService
Designation CRUD
EmployeeBankService
Bank detail management (encrypted storage)
EmployeeDocumentService
Document upload/download via media_service
AttendanceService
Check-in/out, day marking, bulk operations, summary calculation
AttendanceConfigService
Per-institute attendance configuration
ShiftService
Shift CRUD and employee assignment
HolidayService
Holiday calendar management
RegularizationService
Attendance correction requests
LeaveTypeService
Leave type and policy management
LeaveApplicationService
Apply, approve, reject, cancel leaves
LeaveBalanceService
Balance tracking, accrual, year-end processing
CompOffService
Compensatory off management
SalaryComponentService
Component definitions
SalaryTemplateService
Template CRUD with component config
SalaryStructureService
Assign/revise salary, compute component amounts from CTC
PayrollRunService
Create, process, approve payroll runs
PayrollCalculationService
Core payroll engine — attendance-based proration, component calculation, deductions, net pay
LoanService
Loan/advance lifecycle, EMI scheduling
ReimbursementService
Reimbursement lifecycle
TaxRegimeFactory
Returns correct TaxRegime impl based on country_code
IndiaTaxRegime
Indian tax/statutory calculations
TaxDeclarationService
Employee tax declaration management
TaxComputationService
Monthly/annual tax projection
PayslipService
PDF generation (OpenHtmlToPdf, same pattern as InvoiceService)
BankExportService
Generate CSV/XLSX in bank-specific formats
HrReportService
Aggregate reports (payroll summary, dept cost, etc.)
ApprovalService
Generic approval workflow engine
HrNotificationService
Sends leave/payroll/approval notifications via notification_service


F. Flyway Migrations (starting at V128)
Order respecting FK dependencies:
V128 — hr_department, hr_designation
V129 — hr_employee_profile (depends on department, designation)
V130 — hr_employee_bank_detail, hr_employee_document (depends on employee_profile)
V131 — hr_attendance_config, hr_shift
V132 — hr_employee_shift_mapping (depends on employee_profile, shift)
V133 — hr_attendance_record (depends on employee_profile, shift)
V134 — hr_attendance_regularization (depends on attendance_record)
V135 — hr_holiday
V136 — hr_leave_type, hr_leave_policy
V137 — hr_leave_balance, hr_leave_application (depends on leave_type, employee_profile)
V138 — hr_comp_off (depends on employee_profile, leave_application)
V139 — hr_salary_component
V140 — hr_salary_template, hr_salary_template_component
V141 — hr_employee_salary_structure, hr_employee_salary_component
V142 — hr_salary_revision
V143 — hr_payroll_run
V144 — hr_payroll_entry, hr_payroll_entry_component
V145 — hr_employee_loan, hr_loan_repayment
V146 — hr_reimbursement
V147 — hr_tax_configuration, hr_tax_declaration, hr_tax_computation
V148 — hr_payslip, hr_bank_export_log
V149 — hr_approval_chain, hr_approval_request, hr_approval_action


G. Security / Authorization
New roles to add to the system:
HR_ADMIN — full access to all HR & payroll features for the institute
HR_MANAGER — can manage employees, approve leaves/reimbursements, view payroll
EMPLOYEE (existing) — self-service: own profile, attendance, leave apply, payslip view, tax declaration
Access matrix:
Feature
HR_ADMIN
HR_MANAGER
EMPLOYEE (self)
ADMIN
Employee CRUD
Full
View + Edit
View own
Full
Department/Designation
Full
View
-
Full
Attendance Config
Full
View
-
Full
Attendance Mark
Full
Own team
Own check-in/out
Full
Leave Types/Policies
Full
View
View
Full
Leave Apply
Full (on behalf)
Full (on behalf)
Own
Own
Leave Approve
Full
Own team
-
Full
Salary Templates
Full
View
-
Full
Salary Structures
Full
View team
View own
Full
Payroll Process
Full
View
-
Full
Payslip View
Full
Own team
Own
Full
Tax Declarations
Full
View team
Own
Full
Reports
Full
Department
-
Full
Loans/Reimbursements
Full
Approve team
Own requests
Full


H. Integration Points
System
Integration
auth_service
Validate JWT, extract user_id + institute_id + roles. New HR roles added via existing role system
notification_service
Email payslips, leave approval/rejection notifications, payroll processed alerts, attendance reminders. Via existing NotificationService (RestTemplate + HMAC)
media_service
Upload payslip PDFs, employee documents, bank export files to S3. Via existing S3 upload pattern
Existing Invoice system
Payslip PDF uses same OpenHtmlToPdf pattern as InvoiceService
Existing Payment Gateways
Not used for payroll (bank export instead), but could be extended for reimbursement payouts


I. Implementation Order
Phase 1: Foundation (Migrations + Entities)
All Flyway migrations (V128–V149)
All JPA entities with relationships
All enums
All repositories with key queries
Phase 2: Employee Management
Department/Designation CRUD
EmployeeProfile CRUD + status management
Bank details + Document management
Org chart / reporting hierarchy
Phase 3: Attendance & Leave
Attendance config + Shifts + Holidays
Attendance recording (both modes)
Attendance regularization
Leave types + policies
Leave application + approval
Leave balance + accrual
Compensatory off
Phase 4: Salary & Payroll
Salary components + templates
Salary structure assignment + CTC breakdown
Payroll run + processing engine
Payroll calculation (attendance proration, deductions)
Loans + reimbursements
Phase 5: Tax & Payslip
Tax engine (India first, then pluggable)
Tax declarations + computation
Payslip PDF generation
Bank export file generation
Reports
Phase 6: Workflow & Polish
Generic approval workflow
Notification integration
API documentation (OpenAPI/Swagger annotations)

J. Verification Plan
Unit tests for each service (especially PayrollCalculationService, TaxRegime implementations)
Integration tests for payroll flow: create employee → assign salary → run payroll → verify net pay
API tests via Swagger UI at /admin-core-service/swagger-ui.html
Manual verification:
Create department + designation
Create employee with salary structure
Mark attendance for a month
Process payroll → verify component-wise calculation
Generate payslip PDF → verify formatting
Export bank file → verify CSV format
Tax verification: Compare TDS calculation against manual computation for known scenarios

K. Key Files to Modify/Reference
File
Purpose
admin_core_service/pom.xml
Add Apache POI dependency for Excel export
admin_core_service/src/main/resources/db/migration/
New V128–V149 migrations
admin_core_service/.../features/invoice/service/InvoiceService.java
Reference for PDF generation pattern
admin_core_service/.../features/payments/manager/PaymentServiceFactory.java
Reference for TaxRegimeFactory pattern
admin_core_service/.../features/notification_service/service/NotificationService.java
Integration for email/WhatsApp notifications
common_service/.../auth/entity/User.java
EmployeeProfile links to this 1:1
common_service/.../institute/entity/Institute.java
Institute reference for multi-tenancy

User approved the plan
Plan approved. Let me set up the todo list and start implementing. This is a massive system — I'll begin with Phase 1 (Foundation: migrations + entities + enums + repositories).
Update Todos
Create all Flyway migrations V128–V149 (34 tables)
Create all enums (20+ enum classes)
Create Employee Management entities (Department, Designation, EmployeeProfile, BankDetail, Document)
Create Attendance entities (Config, Shift, ShiftMapping, Record, Regularization, Holiday)
Create Leave entities (LeaveType, LeavePolicy, LeaveBalance, LeaveApplication, CompOff)
Create Salary entities (Component, Template, TemplateComponent, Structure, EmployeeComponent, Revision)
Create Payroll entities (Run, Entry, EntryComponent, Loan, LoanRepayment, Reimbursement)
Create Tax entities (Configuration, Declaration, Computation)
Create Payslip entities (Payslip, BankExportLog)
Create Approval entities (Chain, Request, Action)
Create all JPA Repositories with key queries
Create Employee Management services + controllers + DTOs
Create Attendance services + controllers + DTOs
Create Leave services + controllers + DTOs
Create Salary services + controllers + DTOs
Create Payroll services + controllers + DTOs (including PayrollCalculationService)
Create Tax engine (TaxRegime interface, IndiaTaxRegime, TaxRegimeFactory) + services + controllers
Create Payslip + BankExport + Reports services + controllers
Create Approval workflow services + controllers
Add Apache POI dependency to pom.xml

