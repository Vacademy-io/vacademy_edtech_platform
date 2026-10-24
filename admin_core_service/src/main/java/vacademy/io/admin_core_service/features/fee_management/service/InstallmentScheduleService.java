package vacademy.io.admin_core_service.features.fee_management.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.fee_management.dto.FlexibleScheduleDefaultsDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.InstallmentScheduleDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.InstallmentSchedulePreviewDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.AftInstallment;
import vacademy.io.admin_core_service.features.fee_management.entity.AssignedFeeValue;
import vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption;
import vacademy.io.admin_core_service.features.fee_management.entity.FeeType;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.enums.InstallmentIntervalUnit;
import vacademy.io.admin_core_service.features.fee_management.repository.AftInstallmentRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.AssignedFeeValueRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.FeeTypeRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * Turns an installment schedule (count + gap + first due date, or explicit rows) into a
 * learner's {@code student_fee_payment} bills, as an alternative to generating them from the
 * plan's {@code aft_installments} template. See docs/CPO_FLEXIBLE_INSTALLMENTS.md.
 *
 * <p>Everything after enrollment (side view, allocation, dues, reminders, invoices, ledger)
 * reads the bills, not the template, so it works unchanged on these rows. They differ from
 * template bills only in carrying {@code i_id = null} and their own {@code installment_number},
 * the same shape "split installment" and lump-sum fees already produce.
 *
 * <p>How each fee type of the plan is treated:
 * <ul>
 *   <li><b>split</b> when it has template installments or {@code has_installment = true}:
 *       its total is spread over the schedule, one bill per installment;</li>
 *   <li><b>upfront</b> otherwise (e.g. an admission fee): one bill due on the first due date.</li>
 * </ul>
 * Amounts are whole currency units; the remainder of an uneven split goes to installment #1.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class InstallmentScheduleService {

    /** Hard upper bound on a schedule's length. A plan's flexible_defaults.max_count can be lower. */
    public static final int MAX_INSTALLMENTS = 60;

    /** Longest allowed gap in days (10 years); guards against typos like 3000 instead of 30. */
    static final int MAX_INTERVAL_DAYS = 3660;
    static final int MAX_INTERVAL_MONTHS = 120;

    private static final String DELETED = "DELETED";
    private static final String DEFAULT_CURRENCY = "INR";

    private final FeeTypeRepository feeTypeRepository;
    private final AssignedFeeValueRepository assignedFeeValueRepository;
    private final AftInstallmentRepository aftInstallmentRepository;
    private final StudentFeePaymentRepository studentFeePaymentRepository;
    private final UserAccountLedgerService userAccountLedgerService;

    // ========================= plan structure =========================

    /** One fee value of a plan and how a schedule treats it. */
    record FeePart(String feeTypeId, String feeTypeName, boolean skippable,
                   String assignedFeeValueId, BigDecimal total, boolean split) {
    }

    /**
     * Reads the plan's fee types and their gross totals. A fee value's total is the sum of its
     * template installments when it has any, otherwise its amount. DELETED rows are ignored.
     */
    List<FeePart> loadFeeParts(String cpoId) {
        List<FeePart> parts = new ArrayList<>();
        for (FeeType feeType : feeTypeRepository.findByCpoId(cpoId)) {
            if (DELETED.equalsIgnoreCase(feeType.getStatus())) continue;
            for (AssignedFeeValue afv : assignedFeeValueRepository.findByFeeTypeIdAndStatusNot(feeType.getId(), DELETED)) {
                List<AftInstallment> template = aftInstallmentRepository
                        .findByAssignedFeeValueIdOrderByInstallmentNumberAsc(afv.getId()).stream()
                        .filter(i -> !DELETED.equalsIgnoreCase(i.getStatus()))
                        .toList();
                BigDecimal total;
                if (template.isEmpty()) {
                    total = nz(afv.getAmount());
                } else {
                    total = template.stream().map(i -> nz(i.getAmount())).reduce(BigDecimal.ZERO, BigDecimal::add);
                }
                boolean split = !template.isEmpty() || Boolean.TRUE.equals(afv.getHasInstallment());
                parts.add(new FeePart(feeType.getId(), feeType.getName(),
                        Boolean.TRUE.equals(feeType.getIsSkippable()),
                        afv.getId(), total, split));
            }
        }
        return parts;
    }

    /**
     * The fee a plan contributes to an admission package. A package splits its own schedule
     * across courses, so a course's bills must be free to follow it: the plan has to bill a
     * single fee in installments, with nothing paid upfront.
     */
    public BigDecimal packageFee(String cpoId, String courseLabel) {
        String name = StringUtils.hasText(courseLabel) ? courseLabel : "A course";
        List<FeePart> parts = loadFeeParts(cpoId);
        List<FeePart> split = parts.stream().filter(FeePart::split).toList();
        if (split.size() != 1 || parts.size() != 1) {
            throw new VacademyException(name + " has a fee plan with "
                    + (split.isEmpty() ? "no fee paid in installments" : "more than one fee")
                    + ", so it cannot follow a package schedule. Enroll it on its own.");
        }
        BigDecimal total = split.get(0).total();
        if (total == null || total.signum() <= 0) {
            throw new VacademyException(name + " has no fee to include in a package");
        }
        return total;
    }

    // ========================= preview =========================

    /**
     * What {@link #generateFromSchedule} would write, without writing anything. Also the
     * validation entry point: throws {@link VacademyException} with an admin-readable message
     * when the schedule does not fit the plan.
     *
     * @param cpoId         the plan; null when previewing a one-time course whose backing plan
     *                      does not exist yet (dry run)
     * @param fallbackTotal the price to split when {@code cpoId} is null
     */
    public InstallmentSchedulePreviewDTO preview(String cpoId, BigDecimal fallbackTotal,
                                                 InstallmentScheduleDTO schedule) {
        List<FeePart> parts = cpoId != null
                ? loadFeeParts(cpoId)
                : List.of(new FeePart(null, "Course fee", false, null, nz(fallbackTotal), true));
        return buildPlan(parts, schedule, LocalDate.now()).toPreview();
    }

    // ========================= generation =========================

    /**
     * Writes the learner's bills from a schedule and posts one ledger accrual per bill, the
     * same way {@link StudentFeePaymentGenerationService#generateFeeBills} does for the
     * template. The schedule is validated and every bill saved before any accrual is posted,
     * so a validation or save failure leaves neither behind. Accruals commit on their own
     * (REQUIRES_NEW), as on the template path: a failure part-way through posting them keeps
     * the ones already posted.
     *
     * @return ids of the created bills
     */
    @Transactional
    public List<String> generateFromSchedule(String userPlanId, String cpoId, String userId,
                                             String instituteId, String currency,
                                             InstallmentScheduleDTO schedule) {
        if (!StringUtils.hasText(cpoId)) {
            throw new VacademyException("Cannot generate an installment schedule without a fee plan");
        }
        List<FeePart> parts = loadFeeParts(cpoId);
        if (parts.isEmpty()) {
            throw new VacademyException("No fee types found for fee plan: " + cpoId);
        }
        SchedulePlan plan = buildPlan(parts, schedule, LocalDate.now());
        String ccy = StringUtils.hasText(currency) ? currency : DEFAULT_CURRENCY;

        List<StudentFeePayment> bills = new ArrayList<>();
        for (PlannedBill planned : plan.bills()) {
            StudentFeePayment bill = new StudentFeePayment();
            bill.setUserId(userId);
            bill.setUserPlanId(userPlanId);
            bill.setCpoId(cpoId);
            bill.setAsvId(planned.part().assignedFeeValueId());
            bill.setFeeTypeId(planned.part().feeTypeId());
            bill.setIsSkippable(planned.part().skippable());
            bill.setIId(null);
            bill.setInstallmentNumber(planned.installmentNumber());
            bill.setAmountExpected(planned.amount());
            bill.setOriginalAmount(planned.amount());
            bill.setAmountPaid(BigDecimal.ZERO);
            bill.setStartDate(java.sql.Date.valueOf(planned.startDate()));
            bill.setDueDate(java.sql.Date.valueOf(planned.dueDate()));
            bill.setStatus("PENDING");
            bill.setInstituteId(instituteId);
            bills.add(bill);
        }
        List<StudentFeePayment> saved = studentFeePaymentRepository.saveAll(bills);
        studentFeePaymentRepository.flush();

        List<String> ids = new ArrayList<>(saved.size());
        for (int i = 0; i < saved.size(); i++) {
            StudentFeePayment bill = saved.get(i);
            ids.add(bill.getId());
            userAccountLedgerService.recordDebitAccrual(
                    userId, instituteId,
                    bill.getAmountExpected(), ccy,
                    plan.bills().get(i).dueDate(),
                    "STUDENT_FEE_PAYMENT", bill.getId(),
                    null, bill.getInstallmentNumber() != null
                            ? "Fee installment " + bill.getInstallmentNumber() + " generated (schedule)"
                            : "Fee bill generated (schedule)");
        }
        log.info("Generated {} scheduled fee bills for userPlan={}, cpo={} ({} installments)",
                ids.size(), userPlanId, cpoId, plan.dueDates().size());
        return ids;
    }

    // ========================= defaults for FLEXIBLE plans =========================

    /**
     * The schedule a FLEXIBLE plan uses when the enrollment did not supply one (learner
     * self-enroll, admissions, product pages, or an admin enrollment without a schedule).
     * Read from {@code metadata_json.flexible_defaults}; falls back to one installment.
     */
    public InstallmentScheduleDTO defaultScheduleFor(ComplexPaymentOption cpo, LocalDate firstDueDate) {
        FlexibleScheduleDefaultsDTO defaults = CpoFlexibleDefaults.read(cpo);
        int count = 1;
        String unit = InstallmentIntervalUnit.MONTHS.name();
        int value = 1;
        if (defaults != null) {
            if (defaults.getCount() != null && defaults.getCount() > 0) {
                count = Math.min(defaults.getCount(), MAX_INSTALLMENTS);
            }
            if (defaults.getInterval() != null) {
                if (StringUtils.hasText(defaults.getInterval().getUnit())) {
                    unit = defaults.getInterval().getUnit();
                }
                if (defaults.getInterval().getValue() != null && defaults.getInterval().getValue() > 0) {
                    value = defaults.getInterval().getValue();
                }
            }
        }
        return InstallmentScheduleDTO.builder()
                .count(count)
                .interval(InstallmentScheduleDTO.IntervalDTO.builder().unit(unit).value(value).build())
                .firstDueDate(firstDueDate)
                .build();
    }

    /** The plan's own cap on the number of installments, if it sets one. */
    public int maxCountFor(ComplexPaymentOption cpo) {
        FlexibleScheduleDefaultsDTO defaults = CpoFlexibleDefaults.read(cpo);
        if (defaults != null && defaults.getMaxCount() != null && defaults.getMaxCount() > 0) {
            return Math.min(defaults.getMaxCount(), MAX_INSTALLMENTS);
        }
        return MAX_INSTALLMENTS;
    }

    // ========================= pure schedule maths =========================

    record PlannedBill(FeePart part, Integer installmentNumber, LocalDate startDate,
                       LocalDate dueDate, BigDecimal amount) {
    }

    record SchedulePlan(List<LocalDate> dueDates, List<LocalDate> startDates,
                        List<PlannedBill> bills) {

        InstallmentSchedulePreviewDTO toPreview() {
            List<InstallmentSchedulePreviewDTO.Row> rows = new ArrayList<>();
            for (int k = 0; k < dueDates.size(); k++) {
                final int number = k + 1;
                BigDecimal amount = bills.stream()
                        .filter(b -> b.installmentNumber() != null && b.installmentNumber() == number)
                        .map(PlannedBill::amount)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
                rows.add(InstallmentSchedulePreviewDTO.Row.builder()
                        .installmentNumber(number)
                        .startDate(startDates.get(k))
                        .dueDate(dueDates.get(k))
                        .amount(amount)
                        .build());
            }
            List<InstallmentSchedulePreviewDTO.UpfrontFee> upfront = bills.stream()
                    .filter(b -> b.installmentNumber() == null)
                    .map(b -> InstallmentSchedulePreviewDTO.UpfrontFee.builder()
                            .feeTypeId(b.part().feeTypeId())
                            .feeTypeName(b.part().feeTypeName())
                            .dueDate(b.dueDate())
                            .amount(b.amount())
                            .build())
                    .toList();
            BigDecimal total = bills.stream().map(PlannedBill::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
            return InstallmentSchedulePreviewDTO.builder()
                    .totalAmount(total)
                    .billCount(bills.size())
                    .installments(rows)
                    .upfrontFees(upfront)
                    .build();
        }
    }

    /**
     * Validates the schedule against the plan's fee parts and lays out every bill.
     * Package-private and free of I/O so it can be unit-tested directly.
     */
    static SchedulePlan buildPlan(List<FeePart> parts, InstallmentScheduleDTO schedule, LocalDate today) {
        if (schedule == null) {
            throw new VacademyException("Installment schedule is missing");
        }
        List<FeePart> splitParts = parts.stream().filter(FeePart::split).toList();
        if (splitParts.isEmpty()) {
            throw new VacademyException("This fee plan has no fee that can be paid in installments");
        }

        List<LocalDate> dueDates = resolveDueDates(schedule);
        int count = dueDates.size();

        // Per split fee, its share of each installment (equal split, remainder on #1).
        List<List<BigDecimal>> shares = new ArrayList<>();
        for (FeePart part : splitParts) {
            shares.add(equalSplit(part.total(), count));
        }

        for (int p = 0; p < splitParts.size(); p++) {
            if (shares.get(p).stream().anyMatch(a -> a.signum() == 0) && splitParts.get(p).total().signum() > 0) {
                throw new VacademyException(splitParts.get(p).feeTypeName() + " is too small to split into "
                        + count + " installments");
            }
        }

        List<BigDecimal> rowAmounts = explicitRowAmounts(schedule);
        if (rowAmounts != null) {
            BigDecimal splitTotal = splitParts.stream().map(FeePart::total).reduce(BigDecimal.ZERO, BigDecimal::add);
            BigDecimal given = rowAmounts.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
            if (given.compareTo(splitTotal) != 0) {
                throw new VacademyException("Installment amounts add up to " + given.toPlainString()
                        + " but the fee to split is " + splitTotal.toPlainString()
                        + ". Use a discount to change the price.");
            }
            if (splitParts.size() == 1) {
                shares.set(0, rowAmounts);
            } else {
                for (int k = 0; k < count; k++) {
                    BigDecimal generated = BigDecimal.ZERO;
                    for (List<BigDecimal> s : shares) generated = generated.add(s.get(k));
                    if (generated.compareTo(rowAmounts.get(k)) != 0) {
                        throw new VacademyException("This fee plan splits more than one fee, so installment "
                                + "amounts can't be edited at enrollment. Change dates here, or edit single "
                                + "installments from the student's Fee Plan afterwards.");
                    }
                }
            }
        }

        List<BigDecimal> discounts = rowDiscounts(schedule);
        if (discounts != null) {
            if (discounts.size() != count) {
                throw new VacademyException("Give a discount for every installment row, or none");
            }
            for (int k = 0; k < count; k++) {
                BigDecimal gross = BigDecimal.ZERO;
                for (List<BigDecimal> s : shares) gross = gross.add(s.get(k));
                BigDecimal off = discounts.get(k);
                if (off.signum() < 0) {
                    throw new VacademyException("Installment " + (k + 1) + " has a negative discount");
                }
                if (off.compareTo(gross) > 0) {
                    throw new VacademyException("Installment " + (k + 1) + " has " + off.toPlainString()
                            + " off but is only " + gross.toPlainString());
                }
            }
        }

        List<LocalDate> startDates = new ArrayList<>(count);
        LocalDate first = dueDates.get(0);
        startDates.add(first.isBefore(today) ? first : today);
        for (int k = 1; k < count; k++) {
            startDates.add(dueDates.get(k - 1));
        }

        List<PlannedBill> bills = new ArrayList<>();
        for (int p = 0; p < splitParts.size(); p++) {
            for (int k = 0; k < count; k++) {
                bills.add(new PlannedBill(splitParts.get(p), k + 1, startDates.get(k), dueDates.get(k),
                        shares.get(p).get(k)));
            }
        }
        for (FeePart part : parts) {
            if (part.split()) continue;
            bills.add(new PlannedBill(part, null, startDates.get(0), first, part.total()));
        }
        return new SchedulePlan(dueDates, startDates, bills);
    }

    /**
     * The per-installment discounts of an edited schedule, in row order (null entries as 0), or
     * null when no row carries one — then the enrollment's plan discount is spread as before.
     */
    public static List<BigDecimal> rowDiscounts(InstallmentScheduleDTO schedule) {
        if (schedule == null || schedule.getRows() == null || schedule.getRows().isEmpty()) return null;
        boolean any = schedule.getRows().stream()
                .anyMatch(r -> r != null && r.getDiscount() != null && r.getDiscount().signum() != 0);
        if (!any) return null;
        List<BigDecimal> out = new ArrayList<>(schedule.getRows().size());
        for (InstallmentScheduleDTO.RowDTO r : schedule.getRows()) {
            BigDecimal d = r == null || r.getDiscount() == null ? BigDecimal.ZERO : r.getDiscount();
            out.add(d.setScale(2, java.math.RoundingMode.HALF_UP));
        }
        return out;
    }

    /** Due dates from explicit rows, or generated from count + interval + first due date. */
    static List<LocalDate> resolveDueDates(InstallmentScheduleDTO schedule) {
        List<InstallmentScheduleDTO.RowDTO> rows = schedule.getRows();
        List<LocalDate> dates = new ArrayList<>();
        if (rows != null && !rows.isEmpty()) {
            if (schedule.getCount() != null && schedule.getCount() != rows.size()) {
                throw new VacademyException("Installment count " + schedule.getCount()
                        + " does not match the " + rows.size() + " rows sent");
            }
            checkCount(rows.size());
            for (int k = 0; k < rows.size(); k++) {
                InstallmentScheduleDTO.RowDTO row = rows.get(k);
                if (row == null || row.getDueDate() == null) {
                    throw new VacademyException("Installment " + (k + 1) + " has no due date");
                }
                dates.add(row.getDueDate());
            }
        } else {
            Integer count = schedule.getCount();
            if (count == null) {
                throw new VacademyException("Choose the number of installments");
            }
            checkCount(count);
            if (schedule.getFirstDueDate() == null) {
                throw new VacademyException("Choose the first due date");
            }
            InstallmentScheduleDTO.IntervalDTO interval = schedule.getInterval();
            if (count > 1 && interval == null) {
                throw new VacademyException("Choose the gap between installments");
            }
            InstallmentIntervalUnit unit = count > 1 ? parseUnit(interval.getUnit()) : InstallmentIntervalUnit.MONTHS;
            int value = count > 1 ? checkIntervalValue(unit, interval.getValue()) : 1;
            LocalDate first = schedule.getFirstDueDate();
            for (int k = 0; k < count; k++) {
                dates.add(unit == InstallmentIntervalUnit.DAYS
                        ? first.plusDays((long) k * value)
                        : first.plusMonths((long) k * value));
            }
        }
        for (int k = 1; k < dates.size(); k++) {
            if (dates.get(k).isBefore(dates.get(k - 1))) {
                throw new VacademyException("Installment " + (k + 1) + " is due before installment " + k);
            }
        }
        return dates;
    }

    /**
     * Splits {@code total} into {@code count} whole-unit parts; the remainder (including any
     * fraction of a unit) goes on the first part. 40000 / 3 → 13334, 13333, 13333.
     */
    static List<BigDecimal> equalSplit(BigDecimal total, int count) {
        BigDecimal safeTotal = nz(total);
        BigDecimal base = safeTotal.divide(BigDecimal.valueOf(count), 0, RoundingMode.DOWN);
        BigDecimal first = safeTotal.subtract(base.multiply(BigDecimal.valueOf(count - 1L)));
        List<BigDecimal> out = new ArrayList<>(count);
        out.add(first);
        for (int k = 1; k < count; k++) out.add(base);
        return out;
    }

    /** All row amounts when every row has one, null when none has; rejects a mix. */
    private static List<BigDecimal> explicitRowAmounts(InstallmentScheduleDTO schedule) {
        List<InstallmentScheduleDTO.RowDTO> rows = schedule.getRows();
        if (rows == null || rows.isEmpty()) return null;
        long withAmount = rows.stream().filter(r -> r.getAmount() != null).count();
        if (withAmount == 0) return null;
        if (withAmount != rows.size()) {
            throw new VacademyException("Give an amount for every installment, or for none");
        }
        List<BigDecimal> amounts = new ArrayList<>(rows.size());
        for (int k = 0; k < rows.size(); k++) {
            BigDecimal amount = rows.get(k).getAmount();
            if (amount.signum() <= 0) {
                throw new VacademyException("Installment " + (k + 1) + " must have an amount above zero");
            }
            if (amount.stripTrailingZeros().scale() > 2) {
                throw new VacademyException("Installment " + (k + 1) + " has more than 2 decimal places");
            }
            amounts.add(amount);
        }
        return amounts;
    }

    private static void checkCount(int count) {
        if (count < 1 || count > MAX_INSTALLMENTS) {
            throw new VacademyException("Number of installments must be between 1 and " + MAX_INSTALLMENTS);
        }
    }

    private static InstallmentIntervalUnit parseUnit(String unit) {
        try {
            return InstallmentIntervalUnit.valueOf(unit == null ? "" : unit.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new VacademyException("Gap between installments must be in DAYS or MONTHS");
        }
    }

    private static int checkIntervalValue(InstallmentIntervalUnit unit, Integer value) {
        int max = unit == InstallmentIntervalUnit.DAYS ? MAX_INTERVAL_DAYS : MAX_INTERVAL_MONTHS;
        if (value == null || value < 1 || value > max) {
            throw new VacademyException("Gap between installments must be between 1 and " + max + " "
                    + unit.name().toLowerCase());
        }
        return value;
    }

    private static BigDecimal nz(BigDecimal v) {
        return v != null ? v : BigDecimal.ZERO;
    }
}
