package vacademy.io.admin_core_service.features.erp_finance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.erp_finance.dto.FinanceReportDepartmentRowDTO;
import vacademy.io.admin_core_service.features.erp_finance.dto.PnlSnapshotDTO;
import vacademy.io.admin_core_service.features.erp_finance.entity.JournalEntry;
import vacademy.io.admin_core_service.features.erp_finance.repository.FinanceReportQueryRepository;
import vacademy.io.admin_core_service.features.erp_finance.repository.JournalEntryRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

/**
 * Department-cost-vs-revenue P&L snapshot (Phase F4b).
 *
 * Revenue side: the canonical collected-fees ledger query (see
 * {@link FinanceReportQueryRepository#collectedRevenue}) over one calendar
 * month. Cost side: payroll employer cost (gross + employer contributions)
 * from APPROVED/PAID runs of that month, HELD entries excluded, broken down
 * by department.
 *
 * TZ convention (v1): the "month" is the Asia/Kolkata calendar month.
 * sal.created_at is a DB timestamp stored in UTC (the admin_core JVM is kept
 * UTC by convention), so the IST month bounds are converted to UTC before
 * being bound as query parameters. Payroll runs carry explicit month/year
 * columns, so no conversion applies on the cost side.
 */
@Service
public class FinanceReportService {

    private static final ZoneId REPORT_ZONE = ZoneId.of("Asia/Kolkata");
    private static final String ASSUMED_FEE_CURRENCY = "INR";
    private static final String UNASSIGNED_DEPARTMENT = "Unassigned";
    private static final String SOURCE_MODULE_HR_PAYROLL = "HR_PAYROLL";
    private static final String JOURNAL_STATUS_POSTED = "POSTED";

    @Autowired
    private FinanceReportQueryRepository financeReportQueryRepository;

    @Autowired
    private JournalEntryRepository journalEntryRepository;

    @Transactional(readOnly = true)
    public PnlSnapshotDTO buildSnapshot(String instituteId, int month, int year) {
        validatePeriod(month, year);

        // --- month window: Asia/Kolkata calendar month -> UTC timestamps ---
        ZonedDateTime fromIst = LocalDate.of(year, month, 1).atStartOfDay(REPORT_ZONE);
        ZonedDateTime toIst = fromIst.plusMonths(1);
        LocalDateTime fromUtc = fromIst.withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime();
        LocalDateTime toUtc = toIst.withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime();

        // --- (a) revenue ---
        BigDecimal revenue = nz(financeReportQueryRepository.collectedRevenue(instituteId, fromUtc, toUtc));

        // --- (b) payroll cost by department ---
        List<FinanceReportDepartmentRowDTO> deptRows =
                financeReportQueryRepository.payrollCostByDepartment(instituteId, month, year);
        deptRows.forEach(r -> {
            if (r.getDepartmentName() == null || r.getDepartmentName().isBlank()) {
                r.setDepartmentName(UNASSIGNED_DEPARTMENT);
            }
            r.setEmployerCost(nz(r.getEmployerCost()));
            r.setNetPay(nz(r.getNetPay()));
            if (r.getHeadcount() == null) r.setHeadcount(0L);
        });
        // "Unassigned" last, otherwise alphabetical.
        deptRows.sort(Comparator
                .comparing((FinanceReportDepartmentRowDTO r) -> UNASSIGNED_DEPARTMENT.equals(r.getDepartmentName()))
                .thenComparing(FinanceReportDepartmentRowDTO::getDepartmentName, String.CASE_INSENSITIVE_ORDER));

        BigDecimal totalEmployerCost = deptRows.stream()
                .map(FinanceReportDepartmentRowDTO::getEmployerCost)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalNetPay = deptRows.stream()
                .map(FinanceReportDepartmentRowDTO::getNetPay)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        // An employee belongs to exactly one department group, so the sum of
        // per-department distinct headcounts is the overall distinct headcount.
        long employeeCount = deptRows.stream().mapToLong(FinanceReportDepartmentRowDTO::getHeadcount).sum();
        long runCount = financeReportQueryRepository.approvedOrPaidRunCount(instituteId, month, year);

        // --- (c) derived, null-safe on zero revenue ---
        BigDecimal margin = revenue.subtract(totalEmployerCost);
        BigDecimal ratio = revenue.signum() == 0
                ? null
                : totalEmployerCost.divide(revenue, 4, RoundingMode.HALF_UP);

        // --- (d) journal presence (read-only via existing JournalEntryRepository) ---
        List<JournalEntry> periodEntries = journalEntryRepository
                .findByInstituteIdAndPeriodYearAndPeriodMonthOrderByEntryDateAsc(instituteId, year, month);
        List<JournalEntry> hrPayrollEntries = periodEntries.stream()
                .filter(e -> SOURCE_MODULE_HR_PAYROLL.equals(e.getSourceModule()))
                .toList();
        boolean journalExists = !hrPayrollEntries.isEmpty();
        boolean journalPosted = hrPayrollEntries.stream()
                .anyMatch(e -> JOURNAL_STATUS_POSTED.equals(e.getStatus()));

        // --- (e) currency note ---
        List<String> payrollCurrencies = financeReportQueryRepository
                .payrollCurrencies(instituteId, month, year).stream()
                .filter(Objects::nonNull)
                .filter(c -> !c.isBlank())
                .map(String::toUpperCase)
                .distinct()
                .sorted()
                .toList();
        boolean mismatch = payrollCurrencies.stream().anyMatch(c -> !ASSUMED_FEE_CURRENCY.equals(c));
        String note;
        if (payrollCurrencies.isEmpty()) {
            note = "No payroll currency recorded for the period; fee ledger amounts assumed "
                    + ASSUMED_FEE_CURRENCY + ".";
        } else if (mismatch) {
            note = "CURRENCY MISMATCH: payroll entries are in " + String.join(", ", payrollCurrencies)
                    + " but fee ledger amounts are assumed " + ASSUMED_FEE_CURRENCY
                    + " (ledger has no currency column). Margin/ratio mix currencies — interpret with care.";
        } else {
            note = "Payroll and fee amounts both treated as " + ASSUMED_FEE_CURRENCY
                    + " (fee ledger currency is assumed, not stored).";
        }

        PnlSnapshotDTO dto = new PnlSnapshotDTO();
        dto.setInstituteId(instituteId);
        dto.setMonth(month);
        dto.setYear(year);
        dto.setRevenue(new PnlSnapshotDTO.RevenueBlock(revenue, fromUtc + "Z", toUtc + "Z"));
        dto.setPayrollCost(new PnlSnapshotDTO.PayrollCostBlock(
                totalEmployerCost, totalNetPay, employeeCount, runCount, deptRows));
        dto.setDerived(new PnlSnapshotDTO.DerivedBlock(margin, ratio));
        dto.setJournal(new PnlSnapshotDTO.JournalBlock(journalExists, journalPosted, hrPayrollEntries.size()));
        dto.setCurrency(new PnlSnapshotDTO.CurrencyBlock(
                payrollCurrencies, ASSUMED_FEE_CURRENCY, mismatch, note));
        return dto;
    }

    /** CSV rendering of the snapshot: department rows, then a summary block. */
    @Transactional(readOnly = true)
    public String buildSnapshotCsv(String instituteId, int month, int year) {
        PnlSnapshotDTO snap = buildSnapshot(instituteId, month, year);
        StringBuilder csv = new StringBuilder();
        csv.append("Section,Department,Headcount,Employer Cost,Net Pay\r\n");
        for (FinanceReportDepartmentRowDTO row : snap.getPayrollCost().getByDepartment()) {
            csv.append("DEPARTMENT,")
                    .append(sanitize(row.getDepartmentName())).append(',')
                    .append(row.getHeadcount()).append(',')
                    .append(row.getEmployerCost().toPlainString()).append(',')
                    .append(row.getNetPay().toPlainString()).append("\r\n");
        }
        csv.append("\r\n");
        csv.append("Summary Metric,Value\r\n");
        appendSummary(csv, "Period", month + "/" + year + " (Asia/Kolkata calendar month)");
        appendSummary(csv, "Collected Revenue", snap.getRevenue().getCollectedAmount().toPlainString());
        appendSummary(csv, "Total Employer Cost", snap.getPayrollCost().getTotalEmployerCost().toPlainString());
        appendSummary(csv, "Total Net Pay", snap.getPayrollCost().getTotalNetPay().toPlainString());
        appendSummary(csv, "Employee Count", String.valueOf(snap.getPayrollCost().getEmployeeCount()));
        appendSummary(csv, "Payroll Runs Counted", String.valueOf(snap.getPayrollCost().getRunCount()));
        appendSummary(csv, "Margin (Revenue - Employer Cost)", snap.getDerived().getMarginOverEmployerCost().toPlainString());
        appendSummary(csv, "Cost/Revenue Ratio", snap.getDerived().getCostToRevenueRatio() == null
                ? "N/A (zero revenue)" : snap.getDerived().getCostToRevenueRatio().toPlainString());
        appendSummary(csv, "HR_PAYROLL Journal Present", snap.getJournal().isHrPayrollEntryExists()
                ? (snap.getJournal().isHrPayrollEntryPosted() ? "YES (POSTED)" : "YES (not posted)") : "NO");
        appendSummary(csv, "Currency Note", snap.getCurrency().getNote());
        return csv.toString();
    }

    private static void appendSummary(StringBuilder csv, String metric, String value) {
        csv.append(sanitize(metric)).append(',').append(sanitize(value)).append("\r\n");
    }

    private static void validatePeriod(int month, int year) {
        if (month < 1 || month > 12) {
            throw new VacademyException("month must be between 1 and 12");
        }
        if (year < 2000 || year > 2100) {
            throw new VacademyException("year must be between 2000 and 2100");
        }
    }

    private static BigDecimal nz(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }

    /** Same CSV field convention as JournalController's export. */
    private static String sanitize(String v) {
        return v == null ? "" : v.replace(',', ';').replace('\n', ' ').replace('\r', ' ');
    }
}
