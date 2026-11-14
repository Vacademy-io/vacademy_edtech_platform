package vacademy.io.admin_core_service.features.erp_finance.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.List;

/**
 * Department-cost-vs-revenue finance report (Phase F4b): one calendar month's
 * collected fee revenue set against payroll employer cost, per institute.
 *
 * Conventions (v1):
 * - Month window = Asia/Kolkata calendar month, converted to UTC before being
 *   compared against student_fee_allocation_ledger.created_at (DB timestamps
 *   are stored in UTC; the admin_core JVM also runs UTC).
 * - Revenue = the canonical cash-in ledger query (see
 *   FinanceReportQueryRepository); fee amounts are assumed INR.
 * - Payroll cost = APPROVED/PAID runs of the period, HELD entries excluded.
 */
@Getter
@Setter
@NoArgsConstructor
public class PnlSnapshotDTO {

    private String instituteId;
    private Integer month;
    private Integer year;

    private RevenueBlock revenue;
    private PayrollCostBlock payrollCost;
    private DerivedBlock derived;
    private JournalBlock journal;
    private CurrencyBlock currency;

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    public static class RevenueBlock {
        /** Collected (allocated, PAID, non-refund) fee amount for the month. */
        private BigDecimal collectedAmount;
        /** Inclusive UTC start of the Asia/Kolkata calendar month window. */
        private String windowFromUtc;
        /** Exclusive UTC end of the Asia/Kolkata calendar month window. */
        private String windowToUtc;
    }

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    public static class PayrollCostBlock {
        /** SUM(gross + employer contributions) across all departments. */
        private BigDecimal totalEmployerCost;
        /** SUM(net_pay) across all departments. */
        private BigDecimal totalNetPay;
        /** Distinct employees with a non-HELD entry in APPROVED/PAID runs. */
        private Long employeeCount;
        /** Number of APPROVED/PAID payroll runs contributing to the period. */
        private Long runCount;
        private List<FinanceReportDepartmentRowDTO> byDepartment;
    }

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DerivedBlock {
        /** revenue.collectedAmount − payrollCost.totalEmployerCost. */
        private BigDecimal marginOverEmployerCost;
        /** employerCost / revenue; null when revenue is 0 (division undefined). */
        private BigDecimal costToRevenueRatio;
    }

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    public static class JournalBlock {
        /** True if any HR_PAYROLL journal entry exists for the period. */
        private boolean hrPayrollEntryExists;
        /** True if at least one of those entries is POSTED (not reversed). */
        private boolean hrPayrollEntryPosted;
        /** Total HR_PAYROLL journal entries found for the period. */
        private int hrPayrollEntryCount;
    }

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CurrencyBlock {
        /** Distinct currencies on the period's payroll entries (nulls dropped). */
        private List<String> payrollCurrencies;
        /** v1 assumption: the fee ledger has no currency column — INR assumed. */
        private String assumedFeeCurrency;
        /** True when any payroll currency differs from the assumed fee currency. */
        private boolean mismatch;
        private String note;
    }
}
