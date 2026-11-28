package vacademy.io.admin_core_service.features.hr_teaching.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_payroll.dto.PayrollAdjustmentDTO;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollAdjustment;
import vacademy.io.admin_core_service.features.hr_payroll.service.HrMonthLockService;
import vacademy.io.admin_core_service.features.hr_payroll.service.PayrollAdjustmentService;
import vacademy.io.admin_core_service.features.hr_teaching.dto.TeachingPayLineDTO;
import vacademy.io.admin_core_service.features.hr_teaching.dto.TeachingPayResultDTO;
import vacademy.io.admin_core_service.features.hr_teaching.repository.HrTeachingAdjustmentRepository;
import vacademy.io.admin_core_service.features.hr_teaching.service.TeachingActivityService.MonthActivity;
import vacademy.io.admin_core_service.features.hr_teaching.service.TeachingActivityService.Occurrence;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Month;
import java.time.YearMonth;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Teaching pay computation + materialization (Phase F2 "LMS teaching → pay").
 *
 * <p>Rate configuration, v1: until a proper rate table exists, per-teacher
 * rates live on the HR profile as {@code EmployeeProfile.customFields} keys —
 * {@code teaching_rate_per_session} (paid per occurrence that has the
 * teacher's ATTENDANCE_RECORDED log) and {@code teaching_rate_per_hour}
 * (paid per taught hour, taught minutes as computed by
 * {@link TeachingActivityService}). When both keys are present the per-session
 * rate wins. Values may be numbers or numeric strings; anything else (or a
 * non-positive value) makes the employee UNRATED and skipped.
 *
 * <p>Materialize writes one REGULAR-scope EARNING adjustment (code
 * TEACHING_PAY, source SYSTEM) per rated employee via
 * {@link PayrollAdjustmentService}, which the next REGULAR payroll run
 * consumes. Idempotent: an employee already holding a TEACHING_PAY adjustment
 * for that month — consumed by a run or not — is skipped.
 */
@Service
public class TeachingPayService {

    public static final String CODE_TEACHING_PAY = "TEACHING_PAY";
    public static final String RATE_KEY_PER_SESSION = "teaching_rate_per_session";
    public static final String RATE_KEY_PER_HOUR = "teaching_rate_per_hour";

    public static final String STATUS_ELIGIBLE = "ELIGIBLE";
    public static final String STATUS_CREATED = "CREATED";
    public static final String STATUS_SKIPPED_EXISTING = "SKIPPED_EXISTING";
    public static final String STATUS_UNRATED = "UNRATED";
    public static final String STATUS_ZERO_QUANTITY = "ZERO_QUANTITY";
    public static final String STATUS_NO_EMPLOYEE_PROFILE = "NO_EMPLOYEE_PROFILE";

    @Autowired
    private TeachingActivityService teachingActivityService;

    @Autowired
    private HrTeachingAdjustmentRepository adjustmentRepository;

    @Autowired
    private PayrollAdjustmentService payrollAdjustmentService;

    @Autowired
    private HrMonthLockService hrMonthLockService;

    @Transactional(readOnly = true)
    public TeachingPayResultDTO preview(String instituteId, int month, int year) {
        TeachingActivityService.validateMonthYear(month, year);
        return buildResult(instituteId, month, year, computeLines(instituteId, month, year), true);
    }

    @Transactional
    public TeachingPayResultDTO materialize(String instituteId, int month, int year, CustomUserDetails user) {
        TeachingActivityService.validateMonthYear(month, year);
        // Judgment call: an adjustment created after the REGULAR run has already
        // processed the month would sit unconsumed forever, so materialize obeys
        // the same month lock as attendance mutations.
        hrMonthLockService.requireUnlocked(instituteId, YearMonth.of(year, month).atDay(1),
                "materialize teaching pay");

        List<TeachingPayLineDTO> lines = computeLines(instituteId, month, year);
        String label = "Teaching Pay " + monthLabel(month, year);

        for (TeachingPayLineDTO line : lines) {
            if (!STATUS_ELIGIBLE.equals(line.getStatus())) {
                continue;
            }
            PayrollAdjustmentDTO dto = PayrollAdjustmentDTO.builder()
                    .employeeId(line.getEmployeeId())
                    .month(month)
                    .year(year)
                    .type("EARNING")
                    .code(CODE_TEACHING_PAY)
                    .label(label)
                    .amount(line.getAmount())
                    .runScope("REGULAR")
                    .notes(line.getNote())
                    .build();
            String adjustmentId = payrollAdjustmentService.createAdjustment(dto, instituteId, user, "SYSTEM");
            line.setAdjustmentId(adjustmentId);
            line.setStatus(STATUS_CREATED);
        }

        return buildResult(instituteId, month, year, lines, false);
    }

    private List<TeachingPayLineDTO> computeLines(String instituteId, int month, int year) {
        MonthActivity activity = teachingActivityService.loadMonthActivity(instituteId, month, year);

        List<String> employeeIds = activity.getProfileByUserId().values().stream()
                .map(EmployeeProfile::getId)
                .collect(Collectors.toList());
        Set<String> alreadyMaterialized = employeeIds.isEmpty() ? Set.of()
                : adjustmentRepository
                        .findByInstituteIdAndYearAndMonthAndCodeAndEmployeeIdIn(
                                instituteId, year, month, CODE_TEACHING_PAY, employeeIds)
                        .stream().map(PayrollAdjustment::getEmployeeId)
                        .collect(Collectors.toCollection(HashSet::new));

        List<TeachingPayLineDTO> lines = new ArrayList<>();
        for (Map.Entry<String, List<Occurrence>> entry : activity.getByTeacherUserId().entrySet()) {
            String userId = entry.getKey();
            lines.add(computeLine(userId, entry.getValue(),
                    activity.getProfileByUserId().get(userId),
                    activity.getNameByUserId().getOrDefault(userId, "Unknown"),
                    alreadyMaterialized));
        }
        lines.sort(Comparator.comparing(l -> l.getEmployeeName() == null ? "" : l.getEmployeeName(),
                String.CASE_INSENSITIVE_ORDER));
        return lines;
    }

    private TeachingPayLineDTO computeLine(String userId, List<Occurrence> occurrences,
                                           EmployeeProfile profile, String name,
                                           Set<String> alreadyMaterialized) {
        int sessionsWithAttendance = TeachingActivityService.countSessionsWithAttendance(occurrences);
        long taughtSeconds = TeachingActivityService.totalTaughtSeconds(occurrences);
        long taughtMinutes = TeachingActivityService.secondsToRoundedMinutes(taughtSeconds);
        BigDecimal taughtHours = BigDecimal.valueOf(taughtSeconds)
                .divide(BigDecimal.valueOf(3600), 2, RoundingMode.HALF_UP);

        TeachingPayLineDTO.TeachingPayLineDTOBuilder line = TeachingPayLineDTO.builder()
                .userId(userId)
                .employeeName(name)
                .sessionsWithAttendance(sessionsWithAttendance)
                .taughtMinutes(taughtMinutes)
                .taughtHours(taughtHours);

        if (profile == null) {
            return line.status(STATUS_NO_EMPLOYEE_PROFILE)
                    .note("No HR employee profile matches this session creator")
                    .build();
        }
        line.employeeId(profile.getId()).employeeCode(profile.getEmployeeCode());

        BigDecimal perSession = readRate(profile, RATE_KEY_PER_SESSION);
        BigDecimal perHour = readRate(profile, RATE_KEY_PER_HOUR);

        if (perSession == null && perHour == null) {
            return line.status(STATUS_UNRATED)
                    .note("Set " + RATE_KEY_PER_SESSION + " or " + RATE_KEY_PER_HOUR
                            + " in the employee profile custom fields")
                    .build();
        }

        BigDecimal amount;
        String note;
        if (perSession != null) {
            line.basis("PER_SESSION").rate(perSession);
            amount = perSession.multiply(BigDecimal.valueOf(sessionsWithAttendance))
                    .setScale(2, RoundingMode.HALF_UP);
            note = "Auto (teaching): " + sessionsWithAttendance + " session(s) x "
                    + perSession.toPlainString() + "/session";
        } else {
            line.basis("PER_HOUR").rate(perHour);
            amount = perHour.multiply(taughtHours).setScale(2, RoundingMode.HALF_UP);
            note = "Auto (teaching): " + taughtHours.toPlainString() + " h x "
                    + perHour.toPlainString() + "/hour";
        }
        line.amount(amount).note(note);

        if (amount.compareTo(BigDecimal.ZERO) <= 0) {
            return line.status(STATUS_ZERO_QUANTITY)
                    .note("Rated but no attended sessions or taught time this month")
                    .build();
        }
        if (alreadyMaterialized.contains(profile.getId())) {
            return line.status(STATUS_SKIPPED_EXISTING)
                    .note("A TEACHING_PAY adjustment already exists for this month")
                    .build();
        }
        return line.status(STATUS_ELIGIBLE).build();
    }

    /** Numeric or numeric-string custom-field value, positive; anything else is null. */
    static BigDecimal readRate(EmployeeProfile profile, String key) {
        Map<String, Object> customFields = profile.getCustomFields();
        if (customFields == null) {
            return null;
        }
        Object raw = customFields.get(key);
        if (raw == null) {
            return null;
        }
        try {
            BigDecimal rate = new BigDecimal(raw.toString().trim());
            return rate.compareTo(BigDecimal.ZERO) > 0 ? rate : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private TeachingPayResultDTO buildResult(String instituteId, int month, int year,
                                             List<TeachingPayLineDTO> lines, boolean preview) {
        BigDecimal totalAmount = lines.stream()
                .filter(l -> STATUS_ELIGIBLE.equals(l.getStatus()) || STATUS_CREATED.equals(l.getStatus()))
                .map(TeachingPayLineDTO::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        return TeachingPayResultDTO.builder()
                .instituteId(instituteId)
                .month(month)
                .year(year)
                .preview(preview)
                .eligibleCount((int) lines.stream().filter(l -> STATUS_ELIGIBLE.equals(l.getStatus())).count())
                .createdCount((int) lines.stream().filter(l -> STATUS_CREATED.equals(l.getStatus())).count())
                .skippedExistingCount((int) lines.stream()
                        .filter(l -> STATUS_SKIPPED_EXISTING.equals(l.getStatus())).count())
                .unratedCount((int) lines.stream().filter(l -> STATUS_UNRATED.equals(l.getStatus())).count())
                .totalAmount(totalAmount.setScale(2, RoundingMode.HALF_UP))
                .lines(lines)
                .build();
    }

    private static String monthLabel(int month, int year) {
        return Month.of(month).getDisplayName(TextStyle.FULL, Locale.ENGLISH) + " " + year;
    }
}
