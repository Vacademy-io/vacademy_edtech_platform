package vacademy.io.admin_core_service.features.fee_management.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.fee_management.entity.AssignedFeeValue;
import vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption;
import vacademy.io.admin_core_service.features.fee_management.entity.FeeType;
import vacademy.io.admin_core_service.features.fee_management.enums.CpoScheduleMode;
import vacademy.io.admin_core_service.features.fee_management.repository.AssignedFeeValueRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.ComplexPaymentOptionRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.FeeTypeRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentOptionService;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.List;

/**
 * Lets a course sold at a single one-time price be paid in installments, without the admin
 * building a fee plan for it.
 *
 * <p>For each one-time {@code payment_plan} that an admin enrolls someone on with an
 * installment schedule, this keeps one hidden FLEXIBLE fee plan (CPO) with a single
 * "Course fee" of the plan's price, plus the usual mirror payment option and synthetic plan.
 * The learner's UserPlan is created on that mirror, so every CPO-specific rule applies
 * (bills accrue individually, no full-price PaymentLog, CPO discount instead of admin
 * discount). The hidden plan is marked by {@code source_payment_plan_id}, is never attached to
 * an invite, and is left out of fee-plan and payment-option listings.
 *
 * <p>If the course price changes, the next enrollment updates the hidden fee's amount.
 * Learners already enrolled keep their own bills.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class OneTimeInstallmentPlanProvisioner {

    static final String FEE_TYPE_NAME = "Course fee";
    static final String FEE_TYPE_CODE = "COURSE_FEE";

    private final ComplexPaymentOptionRepository cpoRepository;
    private final FeeTypeRepository feeTypeRepository;
    private final AssignedFeeValueRepository assignedFeeValueRepository;
    private final PaymentOptionService paymentOptionService;
    private final PaymentPlanRepository paymentPlanRepository;

    /** The hidden plan's mirror option and synthetic plan, ready to create a UserPlan on. */
    public record ProvisionedPlan(ComplexPaymentOption cpo, PaymentOption mirrorOption, PaymentPlan syntheticPlan) {
    }

    @Transactional
    public ProvisionedPlan provision(PaymentOption sourceOption, PaymentPlan sourcePlan,
                                     String instituteId, String adminUserId) {
        if (sourceOption == null || !PaymentOptionType.ONE_TIME.name().equalsIgnoreCase(sourceOption.getType())) {
            throw new VacademyException("Installments without a fee plan are only available for one-time prices");
        }
        if (sourcePlan == null || sourcePlan.getId() == null) {
            throw new VacademyException("The course's payment plan could not be resolved");
        }
        BigDecimal price = BigDecimal.valueOf(sourcePlan.getActualPrice());
        if (price.signum() <= 0) {
            throw new VacademyException("This course is free, so there is nothing to split into installments");
        }

        ComplexPaymentOption cpo = cpoRepository.findBySourcePaymentPlanId(sourcePlan.getId())
                .map(existing -> refresh(existing, sourceOption, sourcePlan, price))
                .orElseGet(() -> create(sourceOption, sourcePlan, price, instituteId, adminUserId));

        PaymentOption mirror = paymentOptionService.findOrCreateMirrorForCpo(cpo);
        PaymentPlan synthetic = paymentPlanRepository.findByPaymentOption(mirror).stream()
                .filter(p -> !StatusEnum.DELETED.name().equalsIgnoreCase(p.getStatus()))
                .findFirst()
                .orElseThrow(() -> new VacademyException(
                        "Installment plan for this course has no payment plan; please retry"));
        return new ProvisionedPlan(cpo, mirror, synthetic);
    }

    private ComplexPaymentOption create(PaymentOption sourceOption, PaymentPlan sourcePlan, BigDecimal price,
                                        String instituteId, String adminUserId) {
        ComplexPaymentOption cpo = new ComplexPaymentOption();
        cpo.setName(nameFor(sourceOption, sourcePlan));
        cpo.setInstituteId(instituteId);
        cpo.setStatus(StatusEnum.ACTIVE.name());
        cpo.setScheduleMode(CpoScheduleMode.FLEXIBLE.name());
        cpo.setSourcePaymentPlanId(sourcePlan.getId());
        cpo.setCreatedBy(adminUserId);
        cpo.setApprovedBy(adminUserId);
        cpo.setMetadataJson("{\"system\":\"ONE_TIME_INSTALLMENTS\",\"source_payment_option_id\":\""
                + sourceOption.getId() + "\"}");
        cpo = cpoRepository.save(cpo);

        FeeType feeType = new FeeType();
        feeType.setName(FEE_TYPE_NAME);
        feeType.setCode(FEE_TYPE_CODE);
        feeType.setDescription("Price of " + sourcePlan.getName());
        feeType.setCpoId(cpo.getId());
        feeType.setStatus(StatusEnum.ACTIVE.name());
        feeType.setIsSkippable(false);
        feeType = feeTypeRepository.save(feeType);

        AssignedFeeValue value = new AssignedFeeValue();
        value.setFeeTypeId(feeType.getId());
        value.setAmount(price);
        value.setOriginalAmount(price);
        value.setHasInstallment(true);
        value.setIsRefundable(false);
        value.setHasPenalty(false);
        value.setStatus(StatusEnum.ACTIVE.name());
        assignedFeeValueRepository.save(value);

        log.info("Created hidden installment plan {} for one-time plan {} ({} {})",
                cpo.getId(), sourcePlan.getId(), price, sourcePlan.getCurrency());
        return cpo;
    }

    /** Re-activates the plan and tracks the course's current name and price. */
    private ComplexPaymentOption refresh(ComplexPaymentOption cpo, PaymentOption sourceOption,
                                         PaymentPlan sourcePlan, BigDecimal price) {
        boolean changed = false;
        if (!StatusEnum.ACTIVE.name().equals(cpo.getStatus())) {
            cpo.setStatus(StatusEnum.ACTIVE.name());
            changed = true;
        }
        String name = nameFor(sourceOption, sourcePlan);
        if (!name.equals(cpo.getName())) {
            cpo.setName(name);
            changed = true;
        }
        if (changed) {
            cpo = cpoRepository.save(cpo);
        }

        List<FeeType> feeTypes = feeTypeRepository.findByCpoId(cpo.getId());
        for (FeeType feeType : feeTypes) {
            for (AssignedFeeValue value : assignedFeeValueRepository
                    .findByFeeTypeIdAndStatusNot(feeType.getId(), StatusEnum.DELETED.name())) {
                if (value.getAmount() == null || value.getAmount().compareTo(price) != 0) {
                    log.info("Course price changed for hidden installment plan {}: {} -> {}",
                            cpo.getId(), value.getAmount(), price);
                    value.setAmount(price);
                    value.setOriginalAmount(price);
                    assignedFeeValueRepository.save(value);
                }
            }
        }
        return cpo;
    }

    private static String nameFor(PaymentOption sourceOption, PaymentPlan sourcePlan) {
        String option = sourceOption.getName() != null ? sourceOption.getName() : "Course";
        String plan = sourcePlan.getName() != null ? sourcePlan.getName() : "";
        String base = plan.isBlank() || plan.equalsIgnoreCase(option) ? option : option + " - " + plan;
        return base + " (installments)";
    }
}
