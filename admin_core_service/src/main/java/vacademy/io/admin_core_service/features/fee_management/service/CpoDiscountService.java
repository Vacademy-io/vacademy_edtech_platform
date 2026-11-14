package vacademy.io.admin_core_service.features.fee_management.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.fee_management.dto.DiscountSpecDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.user_subscription.dto.UserPlanDiscountJson;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.util.PaymentOptionJsonDiscountAccessor;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Date;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Owns the math + persistence for CPO discounts and per-installment overrides.
 *
 * <p>Two layers of state:
 * <ul>
 *   <li>{@code user_plan.discount_json} — the audit/intent snapshot
 *       (whole-CPO discount, per-installment discounts, manual amount
 *       overrides, history).</li>
 *   <li>{@code student_fee_payment.amount_expected} — the net amount FIFO
 *       targets, recomputed every time the snapshot changes.</li>
 * </ul>
 *
 * <p>The single source of truth for "how much is this installment" is
 * {@code amount_expected}. The snapshot is the source of truth for "why."
 *
 * <p>Recompute pipeline applied to each SFP whenever the snapshot changes:
 * <ol>
 *   <li>Start from {@code original_amount}.</li>
 *   <li>Subtract installment-level discount (percentage of original, or flat).</li>
 *   <li>If a manual amount override exists, replace the in-flight value
 *       with the override (this supersedes the installment discount).</li>
 *   <li>Subtract this row's share of the CPO-level discount. By default the share is
 *       proportional to the row's post-step-3 value over the sum across all SFPs in the
 *       plan; a discount applied another way (see {@link CpoDiscountAllocator}) carries
 *       frozen per-row shares instead.</li>
 *   <li>Clamp at 0. Recompute status from amount_paid vs new amount_expected.</li>
 * </ol>
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class CpoDiscountService {

    private final UserPlanRepository userPlanRepository;
    private final StudentFeePaymentRepository studentFeePaymentRepository;
    private final vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService userAccountLedgerService;
    private final vacademy.io.admin_core_service.features.user_account.repository.UserAccountLedgerRepository userAccountLedgerRepository;
    private final vacademy.io.admin_core_service.features.fee_management.repository.AftInstallmentRepository aftInstallmentRepository;

    private static final int SCALE = 2;
    private static final RoundingMode RM = RoundingMode.HALF_UP;

    /**
     * source_type for the ledger rows this service posts. Deliberately NOT
     * STUDENT_FEE_PAYMENT: that belongs to the original obligation written by
     * StudentFeePaymentGenerationService, and the delta arithmetic below has to be able to
     * tell its own discount entries apart from that accrual.
     */
    private static final String DISCOUNT_LEDGER_SOURCE_TYPE = "CPO_DISCOUNT";

    /**
     * source_type for the base amount an installment split moves off the source row. Kept
     * apart from {@link #DISCOUNT_LEDGER_SOURCE_TYPE} because the discount delta sums only
     * that type — a moved base is not a discount and must not be netted against one.
     */
    private static final String SPLIT_LEDGER_SOURCE_TYPE = "CPO_SPLIT";

    // ------------------------------------------------------------------ apply

    @Transactional
    public UserPlanDiscountJson setCpoDiscount(String userPlanId, DiscountSpecDTO spec, String appliedBy) {
        return setCpoDiscount(userPlanId, spec, null, null, appliedBy);
    }

    /**
     * Applies (or, with a null spec, removes) the whole-plan discount.
     *
     * @param allocation   how to spread it ({@link CpoDiscountAllocator} modes); null = every
     *                     installment in proportion, the original behaviour
     * @param customShares sfpId → amount off, for {@link CpoDiscountAllocator#CUSTOM}
     */
    @Transactional
    public UserPlanDiscountJson setCpoDiscount(String userPlanId, DiscountSpecDTO spec, String allocation,
                                               Map<String, BigDecimal> customShares, String appliedBy) {
        UserPlan plan = loadPlan(userPlanId);
        UserPlanDiscountJson snapshot = readOrInit(plan);

        if (spec == null) {
            UserPlanDiscountJson.DiscountEntry before = snapshot.getCpoDiscount();
            snapshot.setCpoDiscount(null);
            recordHistory(snapshot, "REMOVE", "CPO", null, before, null, appliedBy);
        } else {
            UserPlanDiscountJson.DiscountEntry before = snapshot.getCpoDiscount();
            CpoDiscountPlan planned = planCpoDiscount(plan, snapshot, spec, allocation, customShares);
            UserPlanDiscountJson.DiscountEntry entry = UserPlanDiscountJson.DiscountEntry.builder()
                    .type(planned.type())
                    .value(planned.value())
                    .allocation(planned.frozen() ? planned.allocation() : null)
                    .shares(planned.frozen() ? new LinkedHashMap<>(planned.shares()) : null)
                    .reason(spec.getReason())
                    .appliedBy(appliedBy)
                    .appliedAt(LocalDateTime.now())
                    .build();
            snapshot.setCpoDiscount(entry);
            recordHistory(snapshot, before == null ? "APPLY" : "MODIFY", "CPO", null, before, entry, appliedBy);
        }

        recomputeAndPersist(plan, snapshot);
        return snapshot;
    }

    /**
     * What a whole-plan discount would take off each installment, without saving anything —
     * the side view shows it before the admin applies the discount.
     */
    @Transactional(readOnly = true)
    public CpoDiscountPlan previewCpoDiscount(String userPlanId, DiscountSpecDTO spec, String allocation,
                                               Map<String, BigDecimal> customShares) {
        UserPlan plan = loadPlan(userPlanId);
        return planCpoDiscount(plan, readOrInit(plan), spec, allocation, customShares);
    }

    /**
     * A whole-plan discount worked out against the plan as it stands.
     *
     * @param requested what the admin asked for (a percentage resolved against the plan total)
     * @param shares    sfpId → amount off; installments not listed get nothing
     * @param frozen    true when the shares are stored (every way but the original)
     */
    public record CpoDiscountPlan(String type, Double value, String allocation, BigDecimal requested,
                                   BigDecimal resolved, Map<String, BigDecimal> shares, boolean frozen) {
    }

    private CpoDiscountPlan planCpoDiscount(UserPlan plan, UserPlanDiscountJson snapshot, DiscountSpecDTO spec,
                                             String allocation, Map<String, BigDecimal> customShares) {
        if (spec == null) throw new VacademyException("Discount is required");
        String mode = CpoDiscountAllocator.normalizeMode(allocation);
        boolean custom = CpoDiscountAllocator.CUSTOM.equals(mode);
        if (!custom) validateSpec(spec);

        List<StudentFeePayment> sfps = studentFeePaymentRepository.findByUserPlanId(plan.getId());
        Map<String, BigDecimal> step3 = new LinkedHashMap<>();
        BigDecimal total = BigDecimal.ZERO;
        for (StudentFeePayment sfp : sfps) {
            BigDecimal v = step3Amount(sfp, snapshot);
            step3.put(sfp.getId(), v);
            total = total.add(v);
        }

        if (CpoDiscountAllocator.ALL_PROPORTIONAL.equals(mode)) {
            UserPlanDiscountJson.DiscountEntry probe = UserPlanDiscountJson.DiscountEntry.builder()
                    .type(spec.getType()).value(spec.getValue()).build();
            BigDecimal resolved = resolveCpoDiscount(probe, total);
            Map<String, BigDecimal> shares = proportionalShares(sfps, step3, total, resolved);
            return new CpoDiscountPlan(spec.getType(), spec.getValue(), mode,
                    requestedAmount(spec, total), resolved, shares, false);
        }

        List<CpoDiscountAllocator.Row> rows = new ArrayList<>(sfps.size());
        boolean hasDiscount = snapshot.getCpoDiscount() != null;
        for (StudentFeePayment sfp : sfps) {
            BigDecimal expected = nz(sfp.getAmountExpected());
            BigDecimal paid = nz(sfp.getAmountPaid());
            // Paid in full by the learner, or waived. A row the discount itself took to zero
            // reads PAID but nobody paid it, so it stays open to a new spread.
            boolean settled = "WAIVED".equalsIgnoreCase(sfp.getStatus())
                    || (paid.signum() > 0 && paid.compareTo(expected) >= 0);
            BigDecimal currentShare = hasDiscount
                    ? step3.get(sfp.getId()).subtract(expected).max(BigDecimal.ZERO)
                    : BigDecimal.ZERO;
            rows.add(new CpoDiscountAllocator.Row(sfp.getId(), step3.get(sfp.getId()), paid,
                    toLocalDate(sfp.getDueDate()), settled, currentShare));
        }
        BigDecimal requested = custom ? null : requestedAmount(spec, total);
        Map<String, BigDecimal> shares = CpoDiscountAllocator.allocate(mode, rows, requested, customShares);
        BigDecimal resolved = shares.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        if (custom) {
            return new CpoDiscountPlan(DiscountSpecDTO.TYPE_FLAT, resolved.doubleValue(), mode,
                    resolved, resolved, shares, true);
        }
        return new CpoDiscountPlan(spec.getType(), spec.getValue(), mode, requested, resolved, shares, true);
    }

    private static BigDecimal requestedAmount(DiscountSpecDTO spec, BigDecimal total) {
        BigDecimal value = BigDecimal.valueOf(spec.getValue() == null ? 0 : spec.getValue());
        return DiscountSpecDTO.TYPE_PERCENTAGE.equalsIgnoreCase(spec.getType())
                ? total.multiply(value).divide(BigDecimal.valueOf(100), SCALE, RM)
                : scale(value);
    }

    /**
     * The plan discount currently taken off each installment: its value before the plan
     * discount minus what it is billed at. Read-only, for the side view.
     */
    public Map<String, BigDecimal> currentPlanDiscountShares(List<StudentFeePayment> sfps, UserPlanDiscountJson snapshot) {
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        if (snapshot.getCpoDiscount() == null) return out;
        for (StudentFeePayment sfp : sfps) {
            BigDecimal share = scale(step3Amount(sfp, snapshot).subtract(nz(sfp.getAmountExpected())));
            if (share.signum() > 0) out.put(sfp.getId(), share);
        }
        return out;
    }

    @Transactional
    public UserPlanDiscountJson setInstallmentDiscount(String sfpId, DiscountSpecDTO spec, String appliedBy) {
        StudentFeePayment sfp = loadSfp(sfpId);
        UserPlan plan = loadPlan(sfp.getUserPlanId());
        UserPlanDiscountJson snapshot = readOrInit(plan);

        Map<String, UserPlanDiscountJson.InstallmentDiscountEntry> map = snapshot.getInstallmentDiscounts();
        if (map == null) {
            map = new LinkedHashMap<>();
            snapshot.setInstallmentDiscounts(map);
        }

        if (spec == null) {
            UserPlanDiscountJson.InstallmentDiscountEntry before = map.remove(sfpId);
            recordHistory(snapshot, "REMOVE", "INSTALLMENT", sfpId, before, null, appliedBy);
        } else {
            validateSpec(spec);
            UserPlanDiscountJson.InstallmentDiscountEntry before = map.get(sfpId);
            UserPlanDiscountJson.InstallmentDiscountEntry entry = UserPlanDiscountJson.InstallmentDiscountEntry.builder()
                    .aftInstallmentId(sfp.getIId())
                    .type(spec.getType())
                    .value(spec.getValue())
                    .reason(spec.getReason())
                    .appliedBy(appliedBy)
                    .appliedAt(LocalDateTime.now())
                    .build();
            map.put(sfpId, entry);
            recordHistory(snapshot, before == null ? "APPLY" : "MODIFY", "INSTALLMENT", sfpId, before, entry, appliedBy);
        }

        recomputeAndPersist(plan, snapshot);
        return snapshot;
    }

    @Transactional
    public UserPlanDiscountJson setInstallmentAmount(String sfpId, BigDecimal newAmount, String reason, String appliedBy) {
        if (newAmount == null || newAmount.signum() < 0) {
            throw new VacademyException("Installment amount must be zero or positive");
        }
        StudentFeePayment sfp = loadSfp(sfpId);
        UserPlan plan = loadPlan(sfp.getUserPlanId());
        UserPlanDiscountJson snapshot = readOrInit(plan);

        Map<String, UserPlanDiscountJson.ManualAmountOverrideEntry> map = snapshot.getManualAmountOverrides();
        if (map == null) {
            map = new LinkedHashMap<>();
            snapshot.setManualAmountOverrides(map);
        }

        UserPlanDiscountJson.ManualAmountOverrideEntry before = map.get(sfpId);
        UserPlanDiscountJson.ManualAmountOverrideEntry entry = UserPlanDiscountJson.ManualAmountOverrideEntry.builder()
                .previousAmount(sfp.getOriginalAmount())
                .newAmount(scale(newAmount))
                .reason(reason)
                .appliedBy(appliedBy)
                .appliedAt(LocalDateTime.now())
                .build();
        map.put(sfpId, entry);
        recordHistory(snapshot, "AMOUNT_OVERRIDE", "INSTALLMENT", sfpId, before, entry, appliedBy);

        recomputeAndPersist(plan, snapshot);
        return snapshot;
    }

    /**
     * Sets what the learner owes on one installment (its net, after the plan discount) to
     * {@code net} — how a package installment's new amount lands on each course exactly. The
     * amount override is chosen so the row nets to it: with the plan discount fixed per row (a
     * package's), the override is the net plus that row's share; with no plan discount it is the
     * net itself. A plan discount spread in proportion is not supported here (its shares move
     * with every amount), so that is refused rather than landing near the target.
     */
    @Transactional
    public UserPlanDiscountJson setInstallmentNetAmount(String sfpId, BigDecimal net, String reason, String appliedBy) {
        if (net == null || net.signum() < 0) {
            throw new VacademyException("Installment amount must be zero or positive");
        }
        StudentFeePayment sfp = loadSfp(sfpId);
        UserPlanDiscountJson snapshot = readOrInit(loadPlan(sfp.getUserPlanId()));
        Map<String, BigDecimal> frozen = frozenShares(snapshot);
        BigDecimal override;
        if (frozen != null) {
            override = net.add(nz(frozen.get(sfpId)));
        } else if (snapshot.getCpoDiscount() == null || snapshot.getCpoDiscount().getValue() == null
                || snapshot.getCpoDiscount().getValue() == 0d) {
            override = net;
        } else {
            throw new VacademyException("This course's discount is spread over its installments in proportion, "
                    + "so set the amount on the installment itself");
        }
        return setInstallmentAmount(sfpId, scale(override), reason, appliedBy);
    }

    @Transactional
    public UserPlanDiscountJson clearInstallmentAmountOverride(String sfpId, String appliedBy) {
        StudentFeePayment sfp = loadSfp(sfpId);
        UserPlan plan = loadPlan(sfp.getUserPlanId());
        UserPlanDiscountJson snapshot = readOrInit(plan);

        Map<String, UserPlanDiscountJson.ManualAmountOverrideEntry> map = snapshot.getManualAmountOverrides();
        if (map != null && map.containsKey(sfpId)) {
            UserPlanDiscountJson.ManualAmountOverrideEntry before = map.remove(sfpId);
            recordHistory(snapshot, "REMOVE", "INSTALLMENT", sfpId, before, null, appliedBy);
        }

        recomputeAndPersist(plan, snapshot);
        return snapshot;
    }

    /**
     * Set per-learner installment dates. Persists directly to the SFP row;
     * the snapshot only records the action for audit. Does not trigger
     * amount recompute.
     */
    @Transactional
    public void setInstallmentDates(String sfpId, LocalDate startDate, LocalDate dueDate, String appliedBy) {
        StudentFeePayment sfp = loadSfp(sfpId);
        UserPlan plan = loadPlan(sfp.getUserPlanId());
        UserPlanDiscountJson snapshot = readOrInit(plan);

        Map<String, Object> before = new LinkedHashMap<>();
        before.put("startDate", sfp.getStartDate());
        before.put("dueDate", sfp.getDueDate());

        if (startDate != null) sfp.setStartDate(Date.valueOf(startDate));
        if (dueDate != null) sfp.setDueDate(Date.valueOf(dueDate));
        studentFeePaymentRepository.save(sfp);

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("startDate", sfp.getStartDate());
        after.put("dueDate", sfp.getDueDate());
        recordHistory(snapshot, "DATE_OVERRIDE", "INSTALLMENT", sfpId, before, after, appliedBy);
        persistSnapshot(plan, snapshot);
    }

    // ------------------------------------------------------------------ split

    /**
     * Moves part of one installment's UNPAID balance onto a new installment with its own
     * dates — a learner paid 25,000 of a 65,000 one-time fee and the other 40,000 is due on a
     * date the admin now sets. The plan total never changes; only when the money falls due.
     *
     * <p>How the amounts are carried, so later edits and invoices keep working:
     * <ul>
     *   <li>SUM(original_amount) across the plan stays the same. Invoices derive the plan
     *       discount as SUM(original) - SUM(net), so a split that grew the gross would print a
     *       phantom discount on every later invoice. The base moved off the source becomes the
     *       new row's base.</li>
     *   <li>A CPO-level discount is shared across rows in proportion to their pre-discount
     *       (step 3) value. A split leaves the plan's step-3 total unchanged, so the discount
     *       itself does not move; moving {@code amount} of NET therefore moves
     *       {@code amount * total / (total - discount)} of step-3 value.</li>
     *   <li>The source keeps an explicit amount override when it already had an override or an
     *       installment discount (both are re-derived from the base, which the split shrinks).
     *       An untouched row just gets a smaller base.</li>
     * </ul>
     *
     * <p>Ledger: the base moved off the source is reversed under
     * {@link #SPLIT_LEDGER_SOURCE_TYPE} and accrued again on the new row, so every row's
     * ledger total still equals its own amount_expected and the learner's Account Summary
     * does not move.
     *
     * @return the new installment row
     */
    @Transactional
    public StudentFeePayment splitInstallment(String sfpId, BigDecimal amount,
                                              LocalDate startDate, LocalDate dueDate, String appliedBy) {
        if (amount == null || amount.signum() <= 0) {
            throw new VacademyException("Amount to move must be greater than zero");
        }
        if (dueDate == null) {
            throw new VacademyException("Due date is required for the new installment");
        }
        if (startDate != null && startDate.isAfter(dueDate)) {
            throw new VacademyException("Start date cannot be after the due date");
        }

        StudentFeePayment source = loadSfp(sfpId);
        if ("WAIVED".equalsIgnoreCase(source.getStatus())) {
            throw new VacademyException("A waived installment cannot be split");
        }
        BigDecimal moveNet = scale(amount);
        BigDecimal sourceNet = nz(source.getAmountExpected());
        BigDecimal unpaid = scale(sourceNet.subtract(nz(source.getAmountPaid())));
        if (moveNet.compareTo(unpaid) > 0) {
            throw new VacademyException("Only " + unpaid.toPlainString()
                    + " is unpaid on this installment, so that is the most that can be moved");
        }

        UserPlan plan = loadPlan(source.getUserPlanId());
        UserPlanDiscountJson snapshot = readOrInit(plan);
        List<StudentFeePayment> sfps = studentFeePaymentRepository.findByUserPlanId(plan.getId());

        BigDecimal total = BigDecimal.ZERO;
        for (StudentFeePayment sfp : sfps) {
            total = total.add(step3Amount(sfp, snapshot));
        }
        BigDecimal cpo = resolveCpoDiscount(snapshot, total);
        BigDecimal sourceStep3 = step3Amount(source, snapshot);
        Map<String, BigDecimal> frozen = frozenShares(snapshot);
        // Frozen shares stay on their installments, so the source keeps its share and the
        // moved part carries none: step-3 value moves one for one with the net.
        BigDecimal newSourceStep3 = frozen != null
                ? scale(sourceNet.subtract(moveNet).add(nz(frozen.get(source.getId()))))
                : step3ForNet(sourceNet.subtract(moveNet), total, cpo);
        BigDecimal movedStep3 = scale(sourceStep3.subtract(newSourceStep3));
        if (movedStep3.signum() <= 0) {
            throw new VacademyException("Amount is too small to split off this installment");
        }

        BigDecimal sourceBase = source.getOriginalAmount() != null ? source.getOriginalAmount() : sourceNet;
        // Never below zero: a row an admin raised above its template can move more than its base.
        BigDecimal baseMoved = scale(movedStep3.min(sourceBase).max(BigDecimal.ZERO));
        boolean sourceNeedsExplicitAmount = manualOverrideAmount(snapshot, source.getId()) != null
                || installmentDiscountAmount(sourceBase, snapshot, source.getId()).signum() != 0;

        Map<String, Object> before = new LinkedHashMap<>();
        before.put("originalAmount", sourceBase);
        before.put("amountExpected", sourceNet);
        before.put("dueDate", source.getDueDate());

        // 1. The new installment: same plan, fee value and fee type; no template installment.
        StudentFeePayment added = new StudentFeePayment();
        added.setUserId(source.getUserId());
        added.setUserPlanId(source.getUserPlanId());
        added.setCpoId(source.getCpoId());
        added.setAsvId(source.getAsvId());
        added.setIId(null);
        // Keep the position on screen and in reminders: both halves read "installment N".
        // A template bill takes N from its template row; the new half has none to look up.
        Integer number = source.getInstallmentNumber();
        if (number == null && source.getIId() != null) {
            number = aftInstallmentRepository.findById(source.getIId())
                    .map(vacademy.io.admin_core_service.features.fee_management.entity.AftInstallment::getInstallmentNumber)
                    .orElse(null);
        }
        added.setInstallmentNumber(number);
        added.setPackageSessionIds(source.getPackageSessionIds());
        added.setFeeTypeId(source.getFeeTypeId());
        added.setIsSkippable(source.getIsSkippable());
        added.setInstituteId(source.getInstituteId());
        added.setOriginalAmount(baseMoved);
        added.setAmountExpected(movedStep3); // provisional; the recompute below sets the net
        added.setAmountPaid(BigDecimal.ZERO);
        added.setStartDate(startDate != null ? Date.valueOf(startDate) : null);
        added.setDueDate(Date.valueOf(dueDate));
        added.setStatus("PENDING");
        added = studentFeePaymentRepository.save(added);

        // 2. The source gives up what moved.
        source.setOriginalAmount(scale(sourceBase.subtract(baseMoved)));
        studentFeePaymentRepository.save(source);

        String reason = "Split: " + moveNet.toPlainString() + " moved to a new installment due " + dueDate;
        if (sourceNeedsExplicitAmount) {
            snapshot.getManualAmountOverrides().put(source.getId(),
                    UserPlanDiscountJson.ManualAmountOverrideEntry.builder()
                            .previousAmount(sourceBase)
                            .newAmount(newSourceStep3)
                            .reason(reason)
                            .appliedBy(appliedBy)
                            .appliedAt(LocalDateTime.now())
                            .build());
        }
        if (baseMoved.compareTo(movedStep3) != 0) {
            snapshot.getManualAmountOverrides().put(added.getId(),
                    UserPlanDiscountJson.ManualAmountOverrideEntry.builder()
                            .previousAmount(baseMoved)
                            .newAmount(movedStep3)
                            .reason(reason)
                            .appliedBy(appliedBy)
                            .appliedAt(LocalDateTime.now())
                            .build());
        }

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("newInstallmentId", added.getId());
        after.put("movedAmount", moveNet);
        after.put("startDate", added.getStartDate());
        after.put("dueDate", added.getDueDate());
        recordHistory(snapshot, "SPLIT", "INSTALLMENT", source.getId(), before, after, appliedBy);

        // 3. Ledger: the base leaves the source and lands on the new row.
        String instituteId = source.getInstituteId();
        if (instituteId != null && !instituteId.isBlank() && baseMoved.signum() > 0) {
            LocalDate sourceDue = toLocalDate(source.getDueDate());
            userAccountLedgerService.recordDebitReversal(
                    plan.getUserId(), instituteId, baseMoved, "INR", sourceDue,
                    SPLIT_LEDGER_SOURCE_TYPE, source.getId(), null,
                    "Moved to a new installment due " + dueDate);
            userAccountLedgerService.recordDebitAccrual(
                    plan.getUserId(), instituteId, baseMoved, "INR", dueDate,
                    "STUDENT_FEE_PAYMENT", added.getId(), null,
                    "New installment split from the one due " + (sourceDue != null ? sourceDue : "earlier"));
        }

        // 4. Re-derive every row's net (and post the discount deltas) from the new snapshot.
        recomputeAndPersist(plan, snapshot, "Installment split");

        // recomputeStatus keeps OVERDUE as set elsewhere, but a source the split left fully
        // paid is not overdue any more.
        if ("OVERDUE".equals(source.getStatus())
                && nz(source.getAmountPaid()).compareTo(nz(source.getAmountExpected())) >= 0) {
            source.setStatus("PAID");
            studentFeePaymentRepository.save(source);
        }
        return added;
    }

    /**
     * A row's value after steps 2-3 of the recompute pipeline (installment discount, then a
     * manual override replacing it) — the same arithmetic as {@link #recomputeAndPersist}.
     */
    private BigDecimal step3Amount(StudentFeePayment sfp, UserPlanDiscountJson snapshot) {
        BigDecimal base = sfp.getOriginalAmount() != null
                ? sfp.getOriginalAmount()
                : nz(sfp.getAmountExpected());
        BigDecimal override = manualOverrideAmount(snapshot, sfp.getId());
        if (override != null) return override;
        BigDecimal afterInstDiscount = base.subtract(installmentDiscountAmount(base, snapshot, sfp.getId()));
        return afterInstDiscount.signum() < 0 ? BigDecimal.ZERO : afterInstDiscount;
    }

    /**
     * The step-3 value whose net, after its proportional share of the CPO discount, is
     * {@code targetNet}. The share is rounded to paise, so the exact answer can sit a paisa or
     * two either side of the straight inverse — probe those so the row lands on the target.
     */
    private BigDecimal step3ForNet(BigDecimal targetNet, BigDecimal total, BigDecimal cpo) {
        if (cpo.signum() == 0 || total.signum() == 0 || total.compareTo(cpo) <= 0) {
            return scale(targetNet);
        }
        BigDecimal guess = targetNet.multiply(total).divide(total.subtract(cpo), SCALE, RM);
        for (int paise : new int[] {0, -1, 1, -2, 2}) {
            BigDecimal candidate = guess.add(BigDecimal.valueOf(paise, SCALE));
            BigDecimal share = candidate.multiply(cpo).divide(total, SCALE, RM);
            if (candidate.subtract(share).compareTo(targetNet) == 0) return candidate;
        }
        return guess;
    }

    private static LocalDate toLocalDate(java.util.Date date) {
        // java.sql.Date.toInstant() throws, so re-wrap the epoch millis (see syncDiscountToLedger).
        return date != null ? new java.sql.Date(date.getTime()).toLocalDate() : null;
    }

    // -------------------------------------------------------------- recompute

    /**
     * Public entry point used after enrollment-time overrides write the snapshot
     * but before any side-view edits. Recomputes amount_expected + status for
     * every SFP on this plan from the snapshot.
     */
    @Transactional
    public void recomputeUserPlan(String userPlanId) {
        UserPlan plan = loadPlan(userPlanId);
        UserPlanDiscountJson snapshot = readOrInit(plan);
        recomputeAndPersist(plan, snapshot);
    }

    /**
     * Keeps the ledger's total_accrued in step with a discounted fee row, so the Account
     * Summary tiles agree with the Fee Plan block instead of reporting the pre-discount
     * gross. A discount voids part of an obligation before any money moves, which is exactly
     * DEBIT_REVERSAL — it subtracts from total_accrued rather than counting as a payment.
     *
     * <p>Written as a DELTA, not an absolute. {@code recomputeAndPersist} re-derives every
     * row from {@code original_amount} on each edit, so posting (original - net) every time
     * would stack duplicate reversals on an append-only table. Instead we compare the
     * discount owed with what has already been booked under
     * {@link #DISCOUNT_LEDGER_SOURCE_TYPE} and post only the difference — as a reversal when
     * the discount grew, or as a fresh accrual when it shrank (or was removed), since a
     * reversal can never be un-posted.
     *
     * <p>The reversal carries the row's due date so it cancels out of the past-due bucket as
     * well as the total. Best-effort: a ledger hiccup must not fail the discount edit itself.
     *
     * <p>{@code owed} is deliberately allowed to go negative. An admin can set an installment
     * ABOVE its template amount (moving money between installments at enrollment is common:
     * 21,666 / 21,666 re-cut as 40,000 / 5,000), and that increase is an obligation too. It
     * used to be clamped to zero, so the raise never reached the ledger and the Account
     * Summary reported less accrued — and less due — than the Fee Plan block beside it.
     *
     * @param remarkOverride ledger remark to use instead of the discount wording, for callers
     *                       (the installment split) whose edit is not a discount at all
     */
    private void syncDiscountToLedger(UserPlan plan, StudentFeePayment sfp,
                                      BigDecimal base, BigDecimal net, String remarkOverride) {
        try {
            if (base == null || net == null) return;
            String instituteId = sfp.getInstituteId();
            if (instituteId == null || instituteId.isBlank()) {
                log.warn("Skipping discount ledger sync for sfp={}: no instituteId", sfp.getId());
                return;
            }

            BigDecimal owed = scale(base.subtract(net));

            BigDecimal reversed = nz(userAccountLedgerRepository.sumBySourceAndEventType(
                    DISCOUNT_LEDGER_SOURCE_TYPE, sfp.getId(), "DEBIT_REVERSAL"));
            BigDecimal restored = nz(userAccountLedgerRepository.sumBySourceAndEventType(
                    DISCOUNT_LEDGER_SOURCE_TYPE, sfp.getId(), "DEBIT_ACCRUAL"));
            BigDecimal alreadyBooked = reversed.subtract(restored);

            BigDecimal delta = scale(owed.subtract(alreadyBooked));
            if (delta.signum() == 0) return;

            // Deliberately not the .toInstant() form used elsewhere in this package:
            // due_date is written as a java.sql.Date, and java.sql.Date.toInstant() throws
            // UnsupportedOperationException. Re-wrapping the epoch millis works whether the
            // instance is a java.util.Date, java.sql.Date or java.sql.Timestamp.
            LocalDate dueDate = sfp.getDueDate() != null
                    ? new java.sql.Date(sfp.getDueDate().getTime()).toLocalDate()
                    : null;
            if (delta.signum() > 0) {
                // alreadyBooked < 0 means a raise above the template was booked earlier, so this
                // reversal is that raise coming down, not a discount.
                String remark = remarkOverride != null
                        ? remarkOverride
                        : alreadyBooked.signum() < 0
                                ? "Installment amount reduced"
                                : "Discount applied to installment";
                userAccountLedgerService.recordDebitReversal(
                        plan.getUserId(), instituteId, delta, "INR", dueDate,
                        DISCOUNT_LEDGER_SOURCE_TYPE, sfp.getId(), null, remark);
            } else {
                String remark = remarkOverride != null
                        ? remarkOverride
                        : owed.signum() < 0
                                ? "Installment amount raised above its original amount"
                                : "Discount reduced on installment";
                userAccountLedgerService.recordDebitAccrual(
                        plan.getUserId(), instituteId, delta.negate(), "INR", dueDate,
                        DISCOUNT_LEDGER_SOURCE_TYPE, sfp.getId(), null, remark);
            }
        } catch (Exception e) {
            log.error("Discount ledger sync failed for sfp={}: {}", sfp.getId(), e.getMessage(), e);
        }
    }

    private void recomputeAndPersist(UserPlan plan, UserPlanDiscountJson snapshot) {
        recomputeAndPersist(plan, snapshot, null);
    }

    private void recomputeAndPersist(UserPlan plan, UserPlanDiscountJson snapshot, String ledgerRemark) {
        List<StudentFeePayment> sfps = new ArrayList<>(studentFeePaymentRepository.findByUserPlanId(plan.getId()));
        // A bill cancelled with its course stays as it was cancelled (see FeeBillCancellationService).
        sfps.removeIf(s -> FeeBillCancellationService.CANCELLED.equalsIgnoreCase(s.getStatus()));
        if (sfps.isEmpty()) {
            persistSnapshot(plan, snapshot);
            return;
        }

        Map<String, BigDecimal> postStep3 = new LinkedHashMap<>();
        // The pre-discount value each row started from, kept so the ledger sync in the
        // second pass can measure (original - net) without re-deriving it after
        // amount_expected has already been overwritten.
        Map<String, BigDecimal> baseById = new LinkedHashMap<>();
        BigDecimal totalPostStep3 = BigDecimal.ZERO;

        for (StudentFeePayment sfp : sfps) {
            // Defensive: original_amount should always be set (V238 backfill +
            // @PrePersist), but if a row somehow has it null, fall back to
            // amount_expected so we never zero out a real bill.
            BigDecimal base = sfp.getOriginalAmount() != null
                    ? sfp.getOriginalAmount()
                    : nz(sfp.getAmountExpected());

            // Step 2: installment-level discount
            BigDecimal afterInstDiscount = base.subtract(
                    installmentDiscountAmount(base, snapshot, sfp.getId()));
            if (afterInstDiscount.signum() < 0) afterInstDiscount = BigDecimal.ZERO;

            // Step 3: manual amount override (replaces)
            BigDecimal afterOverride = manualOverrideAmount(snapshot, sfp.getId());
            if (afterOverride == null) afterOverride = afterInstDiscount;

            postStep3.put(sfp.getId(), afterOverride);
            baseById.put(sfp.getId(), base);
            totalPostStep3 = totalPostStep3.add(afterOverride);
        }

        Map<String, BigDecimal> frozen = frozenShares(snapshot);
        Map<String, BigDecimal> shareById;
        BigDecimal cpoResolved;
        if (frozen != null) {
            // Applied another way than the original: the shares were fixed when it was applied.
            // A row an admin has since lowered below its share keeps no more than its value.
            shareById = new LinkedHashMap<>();
            cpoResolved = BigDecimal.ZERO;
            for (StudentFeePayment sfp : sfps) {
                BigDecimal share = nz(frozen.get(sfp.getId())).min(postStep3.get(sfp.getId())).max(BigDecimal.ZERO);
                shareById.put(sfp.getId(), share);
                cpoResolved = cpoResolved.add(share);
            }
        } else {
            cpoResolved = resolveCpoDiscount(snapshot, totalPostStep3);
            shareById = proportionalShares(sfps, postStep3, totalPostStep3, cpoResolved);
        }

        for (StudentFeePayment sfp : sfps) {
            BigDecimal step3Amount = postStep3.get(sfp.getId());
            BigDecimal cpoShare = nz(shareById.get(sfp.getId()));

            BigDecimal net = step3Amount.subtract(cpoShare);
            if (net.signum() < 0) net = BigDecimal.ZERO;
            net = scale(net);

            sfp.setAmountExpected(net);
            sfp.setStatus(recomputeStatus(sfp.getStatus(), nz(sfp.getAmountPaid()), net));
            studentFeePaymentRepository.save(sfp);

            syncDiscountToLedger(plan, sfp, baseById.get(sfp.getId()), net, ledgerRemark);

            // Write CPO share for audit if material
            if (snapshot.getCpoDiscount() != null) {
                snapshot.getCpoDiscount().setResolvedAmount(cpoResolved);
            }
        }

        // For each installment discount/manual override, populate resolvedAmount for the side-view.
        annotateResolvedAmounts(snapshot, sfps);

        persistSnapshot(plan, snapshot);
    }

    // ---------------------------------------------------------------- helpers

    /**
     * The original spread: each row's proportional share rounded to paise, with one row
     * absorbing the rounding drift so SUM(share) == resolved exactly.
     */
    private static Map<String, BigDecimal> proportionalShares(List<StudentFeePayment> sfps, Map<String, BigDecimal> step3,
                                                              BigDecimal total, BigDecimal resolved) {
        Map<String, BigDecimal> shareById = new LinkedHashMap<>();
        if (sfps.isEmpty()) return shareById;
        boolean none = total.signum() == 0 || resolved.signum() == 0;
        StudentFeePayment absorber = driftAbsorber(sfps);
        BigDecimal allocated = BigDecimal.ZERO;
        for (StudentFeePayment sfp : sfps) {
            if (sfp == absorber) continue;
            BigDecimal share = none
                    ? BigDecimal.ZERO
                    : step3.get(sfp.getId()).multiply(resolved).divide(total, SCALE, RM);
            shareById.put(sfp.getId(), share);
            allocated = allocated.add(share);
        }
        shareById.put(absorber.getId(), none ? BigDecimal.ZERO : resolved.subtract(allocated));
        return shareById;
    }

    /** The stored per-row shares, or null when the discount uses the original proportional spread. */
    private static Map<String, BigDecimal> frozenShares(UserPlanDiscountJson snapshot) {
        UserPlanDiscountJson.DiscountEntry e = snapshot.getCpoDiscount();
        return e != null && e.getAllocation() != null && e.getShares() != null ? e.getShares() : null;
    }

    /**
     * The row that takes the CPO discount's rounding remainder: the latest-due installment,
     * then the newest, then the highest id.
     *
     * <p>This used to be whichever row the database happened to return last. That is heap
     * order, which an UPDATE can reshuffle, so a plan's odd paisa could hop between installments
     * from one edit to the next — and an installment split, which adds a row, would always move
     * it. The rule here reproduces the stored amount of every production plan carrying a CPO
     * discount (all 29, checked 2026-09-25), so existing plans do not move, and it stays on the
     * same row when an earlier installment is split.
     */
    private static StudentFeePayment driftAbsorber(List<StudentFeePayment> sfps) {
        Comparator<StudentFeePayment> order = Comparator
                .comparing(StudentFeePayment::getDueDate, Comparator.nullsFirst(Comparator.<java.util.Date>naturalOrder()))
                .thenComparing(StudentFeePayment::getCreatedAt, Comparator.nullsFirst(Comparator.<LocalDateTime>naturalOrder()))
                .thenComparing(StudentFeePayment::getId, Comparator.nullsFirst(Comparator.<String>naturalOrder()));
        StudentFeePayment absorber = sfps.get(0);
        for (StudentFeePayment sfp : sfps) {
            // >= keeps the later row in list order on a full tie, as the old last-row rule did.
            if (order.compare(sfp, absorber) >= 0) absorber = sfp;
        }
        return absorber;
    }

    private BigDecimal installmentDiscountAmount(BigDecimal base, UserPlanDiscountJson snapshot, String sfpId) {
        if (snapshot.getInstallmentDiscounts() == null) return BigDecimal.ZERO;
        UserPlanDiscountJson.InstallmentDiscountEntry entry = snapshot.getInstallmentDiscounts().get(sfpId);
        if (entry == null || entry.getType() == null || entry.getValue() == null) return BigDecimal.ZERO;
        BigDecimal value = BigDecimal.valueOf(entry.getValue());
        if (DiscountSpecDTO.TYPE_PERCENTAGE.equalsIgnoreCase(entry.getType())) {
            return base.multiply(value).divide(BigDecimal.valueOf(100), SCALE, RM);
        }
        return scale(value);
    }

    private BigDecimal manualOverrideAmount(UserPlanDiscountJson snapshot, String sfpId) {
        if (snapshot.getManualAmountOverrides() == null) return null;
        UserPlanDiscountJson.ManualAmountOverrideEntry entry = snapshot.getManualAmountOverrides().get(sfpId);
        return entry == null ? null : entry.getNewAmount();
    }

    private BigDecimal resolveCpoDiscount(UserPlanDiscountJson snapshot, BigDecimal totalPostStep3) {
        return resolveCpoDiscount(snapshot.getCpoDiscount(), totalPostStep3);
    }

    private BigDecimal resolveCpoDiscount(UserPlanDiscountJson.DiscountEntry e, BigDecimal totalPostStep3) {
        if (e == null) return BigDecimal.ZERO;
        if (e.getType() == null || e.getValue() == null) return BigDecimal.ZERO;
        BigDecimal value = BigDecimal.valueOf(e.getValue());
        BigDecimal resolved;
        if (DiscountSpecDTO.TYPE_PERCENTAGE.equalsIgnoreCase(e.getType())) {
            resolved = totalPostStep3.multiply(value).divide(BigDecimal.valueOf(100), SCALE, RM);
        } else {
            resolved = scale(value);
        }
        if (resolved.compareTo(totalPostStep3) > 0) resolved = totalPostStep3;
        return resolved;
    }

    private void annotateResolvedAmounts(UserPlanDiscountJson snapshot, List<StudentFeePayment> sfps) {
        if (snapshot.getInstallmentDiscounts() == null) return;
        Map<String, BigDecimal> byId = new LinkedHashMap<>();
        for (StudentFeePayment sfp : sfps) byId.put(sfp.getId(), nz(sfp.getOriginalAmount()));
        for (Map.Entry<String, UserPlanDiscountJson.InstallmentDiscountEntry> e : snapshot.getInstallmentDiscounts().entrySet()) {
            BigDecimal base = byId.getOrDefault(e.getKey(), BigDecimal.ZERO);
            e.getValue().setResolvedAmount(installmentDiscountAmount(base, snapshot, e.getKey()));
        }
    }

    /**
     * Recomputes payment-state status from amount_paid vs new amount_expected.
     * Preserves WAIVED and OVERDUE since they're set by other subsystems
     * (waiver workflow / scheduled overdue job) on their own schedules.
     */
    private String recomputeStatus(String currentStatus, BigDecimal paid, BigDecimal expected) {
        if ("WAIVED".equals(currentStatus) || "OVERDUE".equals(currentStatus)) {
            return currentStatus;
        }
        if (expected.signum() == 0) return "PAID";
        if (paid.signum() == 0) return "PENDING";
        if (paid.compareTo(expected) >= 0) return "PAID";
        return "PARTIAL_PAID";
    }

    private void validateSpec(DiscountSpecDTO spec) {
        if (spec.getType() == null) throw new VacademyException("Discount type is required");
        if (!DiscountSpecDTO.TYPE_PERCENTAGE.equalsIgnoreCase(spec.getType())
                && !DiscountSpecDTO.TYPE_FLAT.equalsIgnoreCase(spec.getType())) {
            throw new VacademyException("Discount type must be PERCENTAGE or FLAT");
        }
        if (spec.getValue() == null || spec.getValue() < 0) {
            throw new VacademyException("Discount value must be zero or positive");
        }
        if (DiscountSpecDTO.TYPE_PERCENTAGE.equalsIgnoreCase(spec.getType()) && spec.getValue() > 100) {
            throw new VacademyException("Percentage discount must be between 0 and 100");
        }
    }

    private UserPlanDiscountJson readOrInit(UserPlan plan) {
        UserPlanDiscountJson parsed = PaymentOptionJsonDiscountAccessor.read(plan.getPaymentOptionJson());
        if (parsed.getInstallmentDiscounts() == null) parsed.setInstallmentDiscounts(new LinkedHashMap<>());
        if (parsed.getManualAmountOverrides() == null) parsed.setManualAmountOverrides(new LinkedHashMap<>());
        if (parsed.getHistory() == null) parsed.setHistory(new ArrayList<>());
        return parsed;
    }

    private void persistSnapshot(UserPlan plan, UserPlanDiscountJson snapshot) {
        plan.setPaymentOptionJson(
                PaymentOptionJsonDiscountAccessor.write(plan.getPaymentOptionJson(), snapshot));
        userPlanRepository.save(plan);
    }

    private void recordHistory(UserPlanDiscountJson snapshot, String action, String scope,
                               String targetId, Object before, Object after, String by) {
        snapshot.getHistory().add(UserPlanDiscountJson.HistoryEntry.builder()
                .action(action).scope(scope).targetId(targetId)
                .before(before).after(after)
                .by(by).at(LocalDateTime.now())
                .build());
    }

    private UserPlan loadPlan(String userPlanId) {
        return userPlanRepository.findById(userPlanId)
                .orElseThrow(() -> new VacademyException("UserPlan not found: " + userPlanId));
    }

    private StudentFeePayment loadSfp(String sfpId) {
        return studentFeePaymentRepository.findById(sfpId)
                .orElseThrow(() -> new VacademyException("StudentFeePayment not found: " + sfpId));
    }

    private static BigDecimal nz(BigDecimal b) { return b == null ? BigDecimal.ZERO : b; }
    private static BigDecimal scale(BigDecimal b) { return b.setScale(SCALE, RM); }
}
