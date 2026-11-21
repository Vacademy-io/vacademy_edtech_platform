package vacademy.io.admin_core_service.features.hr_incentive.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_incentive.dto.IncentiveMaterializeResultDTO;
import vacademy.io.admin_core_service.features.hr_incentive.dto.IncentivePreviewDTO;
import vacademy.io.admin_core_service.features.hr_incentive.dto.IncentiveRowDTO;
import vacademy.io.admin_core_service.features.hr_incentive.repository.CrmIncentiveEmployeeRepository;
import vacademy.io.admin_core_service.features.hr_incentive.repository.CrmIncentiveRevenueRepository;
import vacademy.io.admin_core_service.features.hr_payroll.dto.PayrollAdjustmentDTO;
import vacademy.io.admin_core_service.features.hr_payroll.service.PayrollAdjustmentService;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.Month;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * CRM incentives → payroll (Phase F3): computes per-counsellor sales incentives from
 * collected revenue and materializes them as CRM_INCENTIVE payroll adjustments, which
 * the REGULAR payroll run for the payout period then consumes as variable pay.
 *
 * <p><b>Revenue attribution</b> reuses the canonical query from
 * {@code features/audience/service/RevenueReportService.java} (reproduced verbatim in
 * {@link CrmIncentiveRevenueRepository}): PAID payment_log rows of this institute's
 * CONVERTED leads, grouped by resolved counsellor auth-userId.
 *
 * <p><b>Month bounds</b>: the earning period is the calendar month in Asia/Kolkata,
 * converted to UTC wall-clock timestamps and applied half-open to
 * {@code payment_log.created_at} — the same local-date→UTC convention as
 * {@code RevenueReportService.toUtc} ({@code atStartOfDay(zone) → withZoneSameInstant(UTC)};
 * columns store UTC in timestamp-without-time-zone). RevenueReportService derives its zone
 * from the institute's report settings with an Asia/Kolkata fallback; this feature pins
 * Asia/Kolkata per the F3 spec, so previews match the Reports Center for IST institutes.
 *
 * <p><b>Formula</b>: incentive = revenue × commissionPct/100 + fixedPerConversion × payingLeads
 * (distinct paying converted leads = "conversions"). Either parameter is optional; at least
 * one is required; commissionPct is capped at 0..50.
 */
@Slf4j
@Service
public class CrmIncentiveService {

    private static final ZoneId EARNING_ZONE = ZoneId.of("Asia/Kolkata");
    private static final BigDecimal MAX_COMMISSION_PCT = BigDecimal.valueOf(50);
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    static final String ADJUSTMENT_CODE = "CRM_INCENTIVE";
    static final String ADJUSTMENT_SOURCE = "CRM_INCENTIVE";

    @Autowired
    private CrmIncentiveRevenueRepository revenueRepository;

    @Autowired
    private CrmIncentiveEmployeeRepository employeeRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PayrollAdjustmentService payrollAdjustmentService;

    @Transactional(readOnly = true)
    public IncentivePreviewDTO preview(String instituteId, Integer month, Integer year,
                                       BigDecimal commissionPct, BigDecimal fixedPerConversion) {
        validateParams(month, year, commissionPct, fixedPerConversion);
        return compute(instituteId, month, year, commissionPct, fixedPerConversion);
    }

    /**
     * Creates one CRM_INCENTIVE EARNING adjustment per linked counsellor-employee with
     * incentive > 0, dated to the payout period. Idempotent: employees already holding a
     * CRM_INCENTIVE adjustment for the payout period are skipped regardless of consumed
     * state (consumed = already paid). All-or-nothing: any failure rolls back every
     * adjustment created in this call.
     */
    @Transactional
    public IncentiveMaterializeResultDTO materialize(String instituteId, Integer month, Integer year,
                                                     BigDecimal commissionPct, BigDecimal fixedPerConversion,
                                                     Integer payoutMonth, Integer payoutYear,
                                                     CustomUserDetails user) {
        validateParams(month, year, commissionPct, fixedPerConversion);
        validateMonthYear(payoutMonth, payoutYear, "payout");

        IncentivePreviewDTO preview = compute(instituteId, month, year, commissionPct, fixedPerConversion);

        Set<String> alreadyMaterialized = new HashSet<>(
                revenueRepository.findEmployeeIdsWithCrmIncentive(instituteId, payoutYear, payoutMonth));

        String label = "Sales Incentive " + monthName(month) + " " + year;
        List<IncentiveMaterializeResultDTO.CreatedItem> created = new ArrayList<>();
        List<IncentiveMaterializeResultDTO.SkippedItem> skipped = new ArrayList<>();
        List<IncentiveMaterializeResultDTO.UnlinkedCounsellor> unlinked = new ArrayList<>();
        BigDecimal totalAmount = BigDecimal.ZERO;

        for (IncentiveRowDTO row : preview.getRows()) {
            if (row.isNoEmployeeProfile()) {
                unlinked.add(IncentiveMaterializeResultDTO.UnlinkedCounsellor.builder()
                        .counsellorUserId(row.getCounsellorUserId())
                        .counsellorName(row.getCounsellorName())
                        .incentive(row.getIncentive())
                        .build());
                continue;
            }
            if (row.getIncentive() == null || row.getIncentive().compareTo(BigDecimal.ZERO) <= 0) {
                skipped.add(skippedItem(row, "zero_incentive"));
                continue;
            }
            if (alreadyMaterialized.contains(row.getEmployeeId())) {
                skipped.add(skippedItem(row, "already_materialized"));
                continue;
            }

            PayrollAdjustmentDTO dto = PayrollAdjustmentDTO.builder()
                    .employeeId(row.getEmployeeId())
                    .month(payoutMonth)
                    .year(payoutYear)
                    .type("EARNING")
                    .code(ADJUSTMENT_CODE)
                    .label(label)
                    .amount(row.getIncentive())
                    .runScope("REGULAR")
                    .notes(buildNotes(row, month, year, commissionPct, fixedPerConversion))
                    .build();
            String adjustmentId = payrollAdjustmentService.createAdjustment(
                    dto, instituteId, user, ADJUSTMENT_SOURCE);

            created.add(IncentiveMaterializeResultDTO.CreatedItem.builder()
                    .adjustmentId(adjustmentId)
                    .employeeId(row.getEmployeeId())
                    .counsellorUserId(row.getCounsellorUserId())
                    .counsellorName(row.getCounsellorName())
                    .amount(row.getIncentive())
                    .build());
            totalAmount = totalAmount.add(row.getIncentive());
        }

        log.info("[CrmIncentive] materialized {} adjustments (skipped {}, unlinked {}) "
                        + "for institute {} earning {}/{} payout {}/{}",
                created.size(), skipped.size(), unlinked.size(),
                instituteId, month, year, payoutMonth, payoutYear);

        return IncentiveMaterializeResultDTO.builder()
                .month(month).year(year)
                .payoutMonth(payoutMonth).payoutYear(payoutYear)
                .created(created)
                .skipped(skipped)
                .unlinkedCounsellors(unlinked)
                .totalAmount(totalAmount.setScale(2, RoundingMode.HALF_UP))
                .createdCount(created.size())
                .skippedCount(skipped.size())
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Computation
    // ─────────────────────────────────────────────────────────────────────

    private IncentivePreviewDTO compute(String instituteId, Integer month, Integer year,
                                        BigDecimal commissionPct, BigDecimal fixedPerConversion) {
        LocalDate firstDay = LocalDate.of(year, month, 1);
        Timestamp fromTs = toUtc(firstDay);
        Timestamp toTs = toUtc(firstDay.plusMonths(1));

        List<CrmIncentiveRevenueRepository.CounsellorRevenueProjection> revenueRows =
                revenueRepository.findCounsellorRevenue(instituteId, fromTs, toTs, null);

        List<String> counsellorIds = revenueRows.stream()
                .map(CrmIncentiveRevenueRepository.CounsellorRevenueProjection::getCounsellorId)
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .collect(Collectors.toList());

        Map<String, String> nameMap = buildUserNameMap(counsellorIds);
        Map<String, EmployeeProfile> employeeByUserId = counsellorIds.isEmpty()
                ? Map.of()
                : employeeRepository.findByInstituteIdAndUserIdIn(instituteId, counsellorIds).stream()
                        .collect(Collectors.toMap(EmployeeProfile::getUserId, Function.identity(), (a, b) -> a));

        List<IncentiveRowDTO> rows = new ArrayList<>();
        BigDecimal totalRevenue = BigDecimal.ZERO;
        BigDecimal totalIncentive = BigDecimal.ZERO;
        long totalPayingLeads = 0;
        long totalPayments = 0;
        int linked = 0;

        for (CrmIncentiveRevenueRepository.CounsellorRevenueProjection r : revenueRows) {
            BigDecimal revenue = r.getRevenue() == null ? BigDecimal.ZERO
                    : r.getRevenue().setScale(2, RoundingMode.HALF_UP);
            long payingLeads = r.getPayingLeads() == null ? 0 : r.getPayingLeads();
            long payments = r.getPayments() == null ? 0 : r.getPayments();

            BigDecimal commissionComponent = commissionPct == null ? BigDecimal.ZERO
                    : revenue.multiply(commissionPct).divide(HUNDRED, 2, RoundingMode.HALF_UP);
            BigDecimal fixedComponent = fixedPerConversion == null ? BigDecimal.ZERO
                    : fixedPerConversion.multiply(BigDecimal.valueOf(payingLeads))
                            .setScale(2, RoundingMode.HALF_UP);
            BigDecimal incentive = commissionComponent.add(fixedComponent);

            EmployeeProfile employee = employeeByUserId.get(r.getCounsellorId());
            if (employee != null) linked++;

            rows.add(IncentiveRowDTO.builder()
                    .counsellorUserId(r.getCounsellorId())
                    .counsellorName(nameMap.getOrDefault(r.getCounsellorId(), r.getCounsellorId()))
                    .employeeId(employee != null ? employee.getId() : null)
                    .noEmployeeProfile(employee == null)
                    .revenue(revenue)
                    .payingLeads(payingLeads)
                    .payments(payments)
                    .commissionComponent(commissionComponent)
                    .fixedComponent(fixedComponent)
                    .incentive(incentive)
                    .build());

            totalRevenue = totalRevenue.add(revenue);
            totalIncentive = totalIncentive.add(incentive);
            totalPayingLeads += payingLeads;
            totalPayments += payments;
        }

        return IncentivePreviewDTO.builder()
                .month(month).year(year)
                .commissionPct(commissionPct)
                .fixedPerConversion(fixedPerConversion)
                .windowFromUtc(fromTs.toInstant().toString())
                .windowToUtc(toTs.toInstant().toString())
                .rows(rows)
                .totalRevenue(totalRevenue.setScale(2, RoundingMode.HALF_UP))
                .totalPayingLeads(totalPayingLeads)
                .totalPayments(totalPayments)
                .totalIncentive(totalIncentive.setScale(2, RoundingMode.HALF_UP))
                .counsellorCount(rows.size())
                .linkedCounsellorCount(linked)
                .unlinkedCounsellorCount(rows.size() - linked)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    private void validateParams(Integer month, Integer year,
                                BigDecimal commissionPct, BigDecimal fixedPerConversion) {
        validateMonthYear(month, year, "earning");
        if (commissionPct == null && fixedPerConversion == null) {
            throw new VacademyException("At least one of commissionPct or fixedPerConversion is required");
        }
        if (commissionPct != null
                && (commissionPct.compareTo(BigDecimal.ZERO) < 0
                        || commissionPct.compareTo(MAX_COMMISSION_PCT) > 0)) {
            throw new VacademyException("commissionPct must be between 0 and 50");
        }
        if (fixedPerConversion != null && fixedPerConversion.compareTo(BigDecimal.ZERO) < 0) {
            throw new VacademyException("fixedPerConversion must not be negative");
        }
    }

    private void validateMonthYear(Integer month, Integer year, String which) {
        if (month == null || month < 1 || month > 12
                || year == null || year < 2000 || year > 2100) {
            throw new VacademyException("Valid " + which + " month (1-12) and year are required");
        }
    }

    /** Calendar-month start in Asia/Kolkata as a UTC wall-clock Timestamp (RevenueReportService.toUtc convention). */
    private static Timestamp toUtc(LocalDate localDate) {
        return Timestamp.valueOf(localDate.atStartOfDay(EARNING_ZONE)
                .withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime());
    }

    private static String monthName(int month) {
        return Month.of(month).getDisplayName(TextStyle.FULL, Locale.ENGLISH);
    }

    private String buildNotes(IncentiveRowDTO row, Integer month, Integer year,
                              BigDecimal commissionPct, BigDecimal fixedPerConversion) {
        StringBuilder sb = new StringBuilder("CRM incentive for ")
                .append(monthName(month)).append(' ').append(year)
                .append(": revenue ").append(row.getRevenue());
        if (commissionPct != null) {
            sb.append(" x ").append(commissionPct).append("% = ").append(row.getCommissionComponent());
        }
        if (fixedPerConversion != null) {
            sb.append(commissionPct != null ? " + " : ", ")
                    .append(fixedPerConversion).append(" x ").append(row.getPayingLeads())
                    .append(" paying leads = ").append(row.getFixedComponent());
        }
        sb.append("; total ").append(row.getIncentive())
                .append(" (counsellor ").append(row.getCounsellorUserId()).append(')');
        return sb.toString();
    }

    /** Same pattern as hr_attendance/service/AttendanceService.buildUserNameMap. */
    private Map<String, String> buildUserNameMap(List<String> userIds) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        List<User> users = userRepository.findByIdIn(userIds);
        return users.stream()
                .collect(Collectors.toMap(
                        User::getId,
                        u -> u.getFullName() != null ? u.getFullName() : u.getUsername(),
                        (a, b) -> a
                ));
    }

    private static IncentiveMaterializeResultDTO.SkippedItem skippedItem(IncentiveRowDTO row, String reason) {
        return IncentiveMaterializeResultDTO.SkippedItem.builder()
                .employeeId(row.getEmployeeId())
                .counsellorUserId(row.getCounsellorUserId())
                .counsellorName(row.getCounsellorName())
                .reason(reason)
                .build();
    }
}
