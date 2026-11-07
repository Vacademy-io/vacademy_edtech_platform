package vacademy.io.admin_core_service.features.fee_management.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.fee_management.dto.DiscountSpecDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.learner_management.dto.CpoEnrollmentConfigDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.InstallmentOverrideDTO;

import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Glue between the structured {@link CpoEnrollmentConfigDTO} on a bulk-assign
 * payload and the freshly-generated StudentFeePayment rows.
 *
 * <p>Called <em>after</em>
 * {@code StudentFeePaymentGenerationService.generateFeeBills(...)} has
 * materialized the template, and <em>before</em> any offline payment
 * allocation. Translates {@code aftInstallmentId}-keyed overrides into
 * SFP-id-keyed mutations and routes them through {@link CpoDiscountService}.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class CpoEnrollmentConfigApplier {

    private final StudentFeePaymentRepository studentFeePaymentRepository;
    private final CpoDiscountService cpoDiscountService;

    @Transactional
    public void apply(String userPlanId, CpoEnrollmentConfigDTO config, String appliedBy) {
        if (config == null) return;

        List<StudentFeePayment> sfps = studentFeePaymentRepository.findByUserPlanId(userPlanId);
        if (sfps.isEmpty()) {
            log.warn("apply() called for userPlan={} but no SFP rows exist; config ignored", userPlanId);
            return;
        }

        // Map aft_installment id -> SFP id. Multiple SFPs sharing one aft_installment
        // shouldn't happen in the current generator (one SFP per installment), but
        // if it ever does, the first wins — we log a warning so anyone hunting
        // a discrepancy has a thread to pull.
        Map<String, String> sfpByAftId = new HashMap<>();
        for (StudentFeePayment sfp : sfps) {
            if (sfp.getIId() == null) continue;
            sfpByAftId.putIfAbsent(sfp.getIId(), sfp.getId());
        }

        // A one-off fee type (has_installment = false) has no AftInstallment, so its SFP
        // row carries i_id = null and can never appear in the map above. The enrollment UI
        // still needs to target it — it synthesises a virtual installment row keyed on the
        // AssignedFeeValue id — so accept that id as an alias. Only rows with a null i_id
        // are indexed here, keeping real installment ids authoritative on the map above.
        Map<String, String> sfpByAsvIdForLumpSum = new HashMap<>();
        for (StudentFeePayment sfp : sfps) {
            if (sfp.getIId() != null || sfp.getAsvId() == null) continue;
            sfpByAsvIdForLumpSum.putIfAbsent(sfp.getAsvId(), sfp.getId());
        }

        if (config.getInstallmentOverrides() != null) {
            for (InstallmentOverrideDTO ov : config.getInstallmentOverrides()) {
                if (ov == null || ov.getAftInstallmentId() == null) continue;
                String sfpId = sfpByAftId.get(ov.getAftInstallmentId());
                if (sfpId == null) {
                    sfpId = sfpByAsvIdForLumpSum.get(ov.getAftInstallmentId());
                }
                if (sfpId == null) {
                    log.warn("Override for aft_installment={} ignored — no matching SFP on userPlan={}",
                            ov.getAftInstallmentId(), userPlanId);
                    continue;
                }
                applyInstallmentOverride(sfpId, ov, appliedBy);
            }
        }

        List<BigDecimal> rowDiscounts = InstallmentScheduleService.rowDiscounts(config.getInstallmentSchedule());
        if (rowDiscounts != null) {
            applyScheduleDiscounts(userPlanId, sfps, rowDiscounts, config.getCpoDiscount(), appliedBy);
        } else if (config.getCpoDiscount() != null) {
            cpoDiscountService.setCpoDiscount(userPlanId, config.getCpoDiscount(), appliedBy);
        }
    }

    /**
     * The admin set how much comes off each installment of the schedule (what the enrollment
     * screen showed as "To pay"). Stored as the plan discount with fixed per-bill shares, so
     * every bill is billed at exactly that. An installment made of several fees' bills shares
     * its discount between them in proportion to their amounts; fees paid upfront (no
     * installment number) take none.
     */
    private void applyScheduleDiscounts(String userPlanId, List<StudentFeePayment> sfps, List<BigDecimal> rowDiscounts,
                                        DiscountSpecDTO spec, String appliedBy) {
        Map<String, BigDecimal> shares = new java.util.LinkedHashMap<>();
        BigDecimal total = BigDecimal.ZERO;
        for (int k = 0; k < rowDiscounts.size(); k++) {
            BigDecimal off = rowDiscounts.get(k);
            if (off.signum() <= 0) continue;
            final int number = k + 1;
            List<StudentFeePayment> bills = sfps.stream()
                    .filter(s -> s.getInstallmentNumber() != null && s.getInstallmentNumber() == number)
                    .toList();
            if (bills.isEmpty()) {
                throw new VacademyException("No bill for installment " + number + " to take the discount off");
            }
            BigDecimal gross = bills.stream().map(s -> nz(s.getOriginalAmount())).reduce(BigDecimal.ZERO, BigDecimal::add);
            BigDecimal allocated = BigDecimal.ZERO;
            for (int i = 0; i < bills.size(); i++) {
                StudentFeePayment bill = bills.get(i);
                BigDecimal share = i == bills.size() - 1 || gross.signum() == 0
                        ? off.subtract(allocated)
                        : nz(bill.getOriginalAmount()).multiply(off).divide(gross, 2, java.math.RoundingMode.HALF_UP);
                shares.merge(bill.getId(), share, BigDecimal::add);
                allocated = allocated.add(share);
            }
            total = total.add(off);
        }
        DiscountSpecDTO flat = DiscountSpecDTO.builder()
                .type(DiscountSpecDTO.TYPE_FLAT)
                .value(total.doubleValue())
                .reason(spec != null ? spec.getReason() : null)
                .build();
        cpoDiscountService.setCpoDiscount(userPlanId, flat, CpoDiscountAllocator.CUSTOM, shares, appliedBy);
    }

    private static BigDecimal nz(BigDecimal b) { return b == null ? BigDecimal.ZERO : b; }

    private void applyInstallmentOverride(String sfpId, InstallmentOverrideDTO ov, String appliedBy) {
        // Dates: independent of amount math, always safe to apply.
        if (ov.getStartDate() != null || ov.getDueDate() != null) {
            cpoDiscountService.setInstallmentDates(sfpId, ov.getStartDate(), ov.getDueDate(), appliedBy);
        }
        // Amount: explicit override wins over discount on the same row.
        if (ov.getAmount() != null) {
            cpoDiscountService.setInstallmentAmount(
                    sfpId, BigDecimal.valueOf(ov.getAmount()),
                    ov.getDiscount() != null ? ov.getDiscount().getReason() : null, appliedBy);
        } else if (ov.getDiscount() != null) {
            cpoDiscountService.setInstallmentDiscount(sfpId, ov.getDiscount(), appliedBy);
        }
    }
}
