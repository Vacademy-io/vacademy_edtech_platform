package vacademy.io.admin_core_service.features.learner_payment_option_operation.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDetails;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerBatchEnrollService;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerEnrollmentEntryService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.enums.PackageStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.payments.service.PaymentService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.handler.ReferralBenefitOrchestrator;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceLock;
import vacademy.io.common.auth.dto.learner.LearnerExtraDetails;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogLineItemDTO;

import java.util.*;

@Service
public class OneTimePaymentOptionOperation implements PaymentOptionOperationStrategy {
    private static final Logger log = LoggerFactory.getLogger(OneTimePaymentOptionOperation.class);

    @Autowired
    private LearnerBatchEnrollService learnerBatchEnrollService;

    @Autowired
    private PaymentService paymentService;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private ReferralBenefitOrchestrator referralBenefitOrchestrator;

    @Autowired
    private AuthService authService;

    @Autowired
    private LearnerEnrollmentEntryService learnerEnrollmentEntryService;

    @Autowired
    private UserPlanService userPlanService;

    @Override
    public LearnerEnrollResponseDTO enrollLearnerToBatch(UserDTO userDTO,
                                                         LearnerPackageSessionsEnrollDTO learnerPackageSessionsEnrollDTO,
                                                         String instituteId,
                                                         EnrollInvite enrollInvite,
                                                         PaymentOption paymentOption,
                                                         UserPlan userPlan,
                                                         Map<String, Object> extraData, LearnerExtraDetails learnerExtraDetails) {
        log.info("Processing ONE_TIME payment enrollment for user: {}", userDTO.getEmail());

        // Step 1: Update existing ABANDONED_CART entries with userPlanId
        // (ABANDONED_CART entries are created during form-submit step via new API)
        List<String> packageSessionIds = learnerPackageSessionsEnrollDTO.getPackageSessionIds();

        int updatedCount = learnerEnrollmentEntryService.updateAbandonedCartEntriesWithUserPlanId(
                userDTO.getId(),
                packageSessionIds,
                instituteId,
                userPlan.getId());

        log.info("Updated {} ABANDONED_CART entries with userPlanId {} for ONE_TIME payment user {}",
                updatedCount, userPlan.getId(), userDTO.getId());

        String learnerSessionStatus = null;
        if (extraData.containsKey("ENROLLMENT_STATUS")) {
            learnerSessionStatus = (String) extraData.get("ENROLLMENT_STATUS");
            log.info("Using enrollment status override: {}", learnerSessionStatus);
        } else if (paymentOption.isRequireApproval()) {
            learnerSessionStatus = LearnerStatusEnum.PENDING_FOR_APPROVAL.name();
        } else {
            learnerSessionStatus = LearnerStatusEnum.INVITED.name();
        }
        PaymentPlan paymentPlan = userPlan.getPaymentPlan();
        if (Objects.isNull(paymentPlan)) {
            throw new VacademyException("Payment plan is null");
        }

        List<InstituteStudentDetails> instituteStudentDetails = buildInstituteStudentDetails(
                instituteId,
                learnerPackageSessionsEnrollDTO.getPackageSessionIds(),
                paymentPlan.getValidityInDays(),
                learnerSessionStatus,
                userPlan);

        // Mark ABANDONED_CART entries as DELETED to clean up before creating actual
        // enrollment
        for (InstituteStudentDetails detail : instituteStudentDetails) {
            learnerEnrollmentEntryService.markPreviousEntriesAsDeleted(
                    userDTO.getId(),
                    detail.getPackageSessionId(),
                    detail.getDestinationPackageSessionId(),
                    instituteId);
        }

        // Create or update user
        UserDTO user = learnerBatchEnrollService.checkAndCreateStudentAndAddToBatch(
                userDTO,
                instituteId,
                instituteStudentDetails,
                learnerPackageSessionsEnrollDTO.getCustomFieldValues(),
                extraData, learnerExtraDetails, enrollInvite, userPlan);

        if (learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest() != null) {
            // Snapshot what the FE asked the gateway to charge BEFORE we
            // overwrite it. Used by the mismatch-warning below — a divergence
            // indicates either a stale/tampered FE or a calc bug worth
            // investigating before money moves.
            Double feSuppliedAmount =
                    learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().getAmount();

            if (extraData.containsKey("OVERRIDE_TOTAL_AMOUNT")) {
                Object amountObj = extraData.get("OVERRIDE_TOTAL_AMOUNT");
                if (amountObj instanceof Number) {
                    Double amount = ((Number) amountObj).doubleValue();
                    log.info("Overriding payment amount to {} from extraData", amount);
                    learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().setAmount(amount);
                }
            } else {
                // Regional lock (if any) wins over the plan's base price — see RegionalPriceLock.
                double listPrice = RegionalPriceLock.listPrice(userPlan);
                log.info("Setting payment amount to {} from plan {}", listPrice, paymentPlan.getId());
                learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().setAmount(listPrice);
            }
            if (RegionalPriceLock.isLocked(userPlan)) {
                learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest()
                        .setCurrency(userPlan.getRegionalCurrency());
            }

            // Apply the validated coupon discount to whatever base amount we
            // settled on above. BE is authoritative for the gateway charge —
            // the FE-supplied amount is ignored. This is what turns a 10% off
            // coupon on ₹500 into a ₹450 gateway capture.
            Double currentAmount = learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().getAmount();
            double discountedAmount = RegionalPriceLock.applyDiscount(
                    userPlan, currentAmount, userPlan.getAppliedCouponDiscount());
            if (currentAmount != null && Double.compare(currentAmount, discountedAmount) != 0) {
                log.info("Coupon {} reduced gateway amount {} -> {} on plan {}",
                        userPlan.getAppliedCouponDiscount() != null
                                ? userPlan.getAppliedCouponDiscount().getName()
                                : null,
                        currentAmount, discountedAmount, paymentPlan.getId());
                learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().setAmount(discountedAmount);
            }

            // Telemetry: a >₹0.01 gap between what the FE asked for and what
            // the BE settled on means either (a) a stale/buggy client, (b) a
            // tampering attempt, or (c) a pricing/discount-calc divergence
            // worth investigating. Logged at WARN so log aggregators can
            // alert on it without polluting INFO-level traffic for the happy
            // path. No action taken — the BE-derived amount has already won
            // and the gateway will see the correct value.
            //
            // Multi-package child enrollments (PARENT_PAYMENT_LOG_ID set)
            // always mismatch by design: each child reuses the parent's
            // TOTAL amount as feSuppliedAmount but the BE narrows it to the
            // child plan's price. Suppress so the WARN remains a real signal.
            Double finalAmount = learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().getAmount();
            boolean isMultiPackageChild = extraData.containsKey("PARENT_PAYMENT_LOG_ID");
            if (!isMultiPackageChild && feSuppliedAmount != null && finalAmount != null
                    && Math.abs(feSuppliedAmount - finalAmount) > 0.01) {
                log.warn(
                        "Gateway amount mismatch: fe_supplied={} be_derived={} user={} plan={} coupon={}",
                        feSuppliedAmount,
                        finalAmount,
                        user.getId(),
                        paymentPlan.getId(),
                        userPlan.getAppliedCouponDiscount() != null
                                ? userPlan.getAppliedCouponDiscount().getName()
                                : null);
            }

            if (extraData.containsKey("PARENT_PAYMENT_LOG_ID")) {
                String parentLogId = (String) extraData.get("PARENT_PAYMENT_LOG_ID");
                log.info("Linking to parent payment log ID: {}", parentLogId);
                learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().setOrderId(parentLogId);
            }
        }
        // Process referral request if present
        List<PaymentLogLineItemDTO> referralLineItems = new ArrayList<>();
        if (learnerPackageSessionsEnrollDTO.getReferRequest() != null) {
            referralBenefitOrchestrator.processAllBenefits(
                    learnerPackageSessionsEnrollDTO,
                    paymentOption,
                    userPlan,
                    user,
                    instituteId);
        }

        // Handle payment
        LearnerEnrollResponseDTO learnerEnrollResponseDTO = new LearnerEnrollResponseDTO();
        learnerEnrollResponseDTO.setUser(user);

        if (learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest() != null) {
            PaymentInitiationRequestDTO paymentInitiationRequestDTO = learnerPackageSessionsEnrollDTO
                    .getPaymentInitiationRequest();

            // A coupon that fully covers the price (or a flat coupon larger
            // than the price) collapses gateway amount to 0 — Stripe and
            // Razorpay both reject zero-amount intents. Skip the gateway and
            // force a PAID log so the UserPlan transitions through the same
            // PAID -> applyOperationsOnFirstPayment path as a real charge.
            boolean fullyDiscountedByCoupon =
                    userPlan.getAppliedCouponDiscount() != null
                            && paymentInitiationRequestDTO.getAmount() != null
                            && paymentInitiationRequestDTO.getAmount() <= 0.0;

            PaymentResponseDTO paymentResponseDTO;
            if (fullyDiscountedByCoupon) {
                log.info("Coupon fully covers price for user {} on plan {} — skipping gateway",
                        user.getId(), paymentPlan.getId());
                Map<String, Object> paidExtras = new HashMap<>(extraData);
                paidExtras.put("FORCE_PAID_STATUS", Boolean.TRUE);
                paymentResponseDTO = paymentService.handlePaymentWithoutGateway(
                        user,
                        learnerPackageSessionsEnrollDTO,
                        instituteId,
                        enrollInvite,
                        userPlan,
                        paidExtras);
            } else if (extraData.containsKey("SKIP_PAYMENT_INITIATION")
                    && Boolean.TRUE.equals(extraData.get("SKIP_PAYMENT_INITIATION"))) {
                log.info("Skipping payment initiation for user: {}", user.getId());
                paymentResponseDTO = paymentService.handlePaymentWithoutGateway(
                        user,
                        learnerPackageSessionsEnrollDTO,
                        instituteId,
                        enrollInvite,
                        userPlan,
                        extraData);
            } else {
                log.info("Initiating payment through PaymentService for user: {}", user.getId());
                paymentResponseDTO = paymentService.handlePayment(
                        user,
                        learnerPackageSessionsEnrollDTO,
                        instituteId,
                        enrollInvite,
                        userPlan);
            }
            learnerEnrollResponseDTO.setPaymentResponse(paymentResponseDTO);

            // For synchronous payment gateways (e.g., Eway) that return PAID immediately,
            // use applyOperationsOnFirstPayment which handles:
            // 1. Terminating active sessions configured in enrollment policy
            // 2. Shifting from INVITED to ACTIVE in the destination package session
            if (isPaymentSuccessful(paymentResponseDTO)) {
                log.info("Payment successful for user: {}. Applying first payment operations.", user.getId());
                userPlanService.applyOperationsOnFirstPayment(userPlan);
            }
        } else {
            throw new VacademyException("PaymentInitiationRequest is null");
        }

        return learnerEnrollResponseDTO;
    }

    /**
     * Checks if payment was successful based on the payment response.
     * Handles synchronous payment gateways like Eway that return PAID immediately.
     */
    private boolean isPaymentSuccessful(PaymentResponseDTO paymentResponseDTO) {
        if (paymentResponseDTO == null || paymentResponseDTO.getResponseData() == null) {
            return false;
        }
        Object paymentStatus = paymentResponseDTO.getResponseData().get("paymentStatus");
        return "PAID".equals(paymentStatus);
    }

    private List<InstituteStudentDetails> buildInstituteStudentDetails(String instituteId,
                                                                       List<String> packageSessionIds,
                                                                       Integer accessDays, String learnerSessionStatus, UserPlan userPlan) {
        List<InstituteStudentDetails> detailsList = new ArrayList<>();

        for (String packageSessionId : packageSessionIds) {
            Optional<PackageSession> invitedPackageSession = packageSessionRepository
                    .findInvitedPackageSessionForPackage(
                            packageSessionId,
                            "INVITED", // levelId (placeholder — ensure correct value)
                            "INVITED", // sessionId (placeholder — ensure correct value)
                            List.of(PackageSessionStatusEnum.INVITED.name()),
                            List.of(PackageSessionStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                            List.of(PackageStatusEnum.ACTIVE.name()));

            if (invitedPackageSession.isEmpty()) {
                throw new VacademyException("Learner cannot be enrolled as there is no invited package session");
            }

            InstituteStudentDetails detail = new InstituteStudentDetails(
                    instituteId,
                    invitedPackageSession.get().getId(),
                    null,
                    learnerSessionStatus,
                    new Date(),
                    null,
                    accessDays != null ? accessDays.toString() : null,
                    packageSessionId,
                    userPlan.getId(), null, null, null);
            detailsList.add(detail);
        }
        return detailsList;
    }
}
