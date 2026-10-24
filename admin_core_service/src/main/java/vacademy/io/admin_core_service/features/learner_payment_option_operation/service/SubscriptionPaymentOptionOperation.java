package vacademy.io.admin_core_service.features.learner_payment_option_operation.service;

import lombok.extern.slf4j.Slf4j;
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
import vacademy.io.admin_core_service.features.payments.service.MandateRequestDefaults;
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

@Slf4j
@Service
public class SubscriptionPaymentOptionOperation implements PaymentOptionOperationStrategy {

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

    @Autowired
    private MandateRequestDefaults mandateRequestDefaults;

    @Override
    public LearnerEnrollResponseDTO enrollLearnerToBatch(UserDTO userDTO,
                                                         LearnerPackageSessionsEnrollDTO learnerPackageSessionsEnrollDTO,
                                                         String instituteId,
                                                         EnrollInvite enrollInvite,
                                                         PaymentOption paymentOption,
                                                         UserPlan userPlan,
                                                         Map<String, Object> extraData, LearnerExtraDetails learnerExtraDetails) {
        log.info("Processing SUBSCRIPTION payment enrollment for user: {}", userDTO.getEmail());

        // Step 1: Update existing ABANDONED_CART entries with userPlanId
        // (ABANDONED_CART entries are created during form-submit step via new API)
        List<String> packageSessionIds = learnerPackageSessionsEnrollDTO.getPackageSessionIds();

        int updatedCount = learnerEnrollmentEntryService.updateAbandonedCartEntriesWithUserPlanId(
                userDTO.getId(),
                packageSessionIds,
                instituteId,
                userPlan.getId());

        log.info("Updated {} ABANDONED_CART entries with userPlanId {} for SUBSCRIPTION user {}",
                updatedCount, userPlan.getId(), userDTO.getId());

        // Use startDate from DTO if provided, otherwise default to current date
        Date enrollmentDate = learnerPackageSessionsEnrollDTO.getStartDate() != null
                ? learnerPackageSessionsEnrollDTO.getStartDate()
                : new Date();

        String learnerSessionStatus = null;
        if (extraData.containsKey("ENROLLMENT_STATUS")) {
            learnerSessionStatus = (String) extraData.get("ENROLLMENT_STATUS");
            log.info("Using subscription enrollment status override: {}", learnerSessionStatus);
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
                userPlan,
                enrollmentDate);

        // Create or update user
        UserDTO user = learnerBatchEnrollService.checkAndCreateStudentAndAddToBatch(
                userDTO,
                instituteId,
                instituteStudentDetails,
                learnerPackageSessionsEnrollDTO.getCustomFieldValues(),
                extraData, learnerExtraDetails, enrollInvite, userPlan);

        if (learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest() != null) {
            // Snapshot the FE-supplied amount before any BE overrides — used
            // by the mismatch-warning at the bottom of this block.
            Double feSuppliedAmount =
                    learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().getAmount();

            if (extraData.containsKey("OVERRIDE_TOTAL_AMOUNT")) {
                Object amountObj = extraData.get("OVERRIDE_TOTAL_AMOUNT");
                if (amountObj instanceof Number) {
                    Double amount = ((Number) amountObj).doubleValue();
                    log.info("Overriding subscription payment amount to {} from extraData", amount);
                    learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().setAmount(amount);
                }
            } else {
                // Regional lock (if any) wins over the plan's base price — see RegionalPriceLock.
                double listPrice = RegionalPriceLock.listPrice(userPlan);
                log.info("Setting subscription payment amount to {} from plan {}", listPrice, paymentPlan.getId());
                learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().setAmount(listPrice);
            }
            if (RegionalPriceLock.isLocked(userPlan)) {
                learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest()
                        .setCurrency(userPlan.getRegionalCurrency());
            }

            // Apply the validated coupon discount to the first-payment amount.
            // BE is authoritative for the gateway charge; the FE-supplied
            // payment_initiation_request.amount is ignored. Subsequent renewal
            // charges are full-price by design — see CouponValidationService
            // (the coupon scoping covers first-payment only).
            Double currentAmount = learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().getAmount();
            double discountedAmount = RegionalPriceLock.applyDiscount(
                    userPlan, currentAmount, userPlan.getAppliedCouponDiscount());
            if (currentAmount != null && Double.compare(currentAmount, discountedAmount) != 0) {
                log.info("Coupon {} reduced subscription first-payment amount {} -> {} on plan {}",
                        userPlan.getAppliedCouponDiscount() != null
                                ? userPlan.getAppliedCouponDiscount().getName()
                                : null,
                        currentAmount, discountedAmount, paymentPlan.getId());
                learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().setAmount(discountedAmount);
            }

            // Telemetry: warn if the FE-supplied amount and the BE-derived
            // amount disagree by more than ₹0.01. Indicates a stale/buggy
            // client, tampering, or a discount-calc divergence. Same
            // rationale as the OneTime path — BE-derived has already won;
            // the warn is purely for observability.
            // Suppressed for multi-package children (PARENT_PAYMENT_LOG_ID)
            // since FE sends the parent total but BE narrows to child plan.
            Double finalAmount = learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().getAmount();
            boolean isMultiPackageChild = extraData.containsKey("PARENT_PAYMENT_LOG_ID");
            if (!isMultiPackageChild && feSuppliedAmount != null && finalAmount != null
                    && Math.abs(feSuppliedAmount - finalAmount) > 0.01) {
                log.warn(
                        "Gateway amount mismatch (subscription): fe_supplied={} be_derived={} user={} plan={} coupon={}",
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
                log.info("Linking subscription to parent payment log ID: {}", parentLogId);
                learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().setOrderId(parentLogId);
            }
        }
        // Process referral request if present
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
            // First-payment amount fully covered by coupon → skip gateway,
            // force-paid log. Same rationale as OneTimePaymentOptionOperation:
            // Stripe/Razorpay reject 0-amount intents, so we record a paid
            // log directly and let applyOperationsOnFirstPayment activate the
            // subscription. Renewals run through the gateway normally.
            boolean fullyDiscountedByCoupon =
                    userPlan.getAppliedCouponDiscount() != null
                            && learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().getAmount() != null
                            && learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().getAmount() <= 0.0;

            PaymentResponseDTO paymentResponseDTO;
            if (fullyDiscountedByCoupon) {
                log.info("Coupon fully covers subscription first payment for user {} on plan {} — skipping gateway",
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
                paymentResponseDTO = paymentService.handlePaymentWithoutGateway(
                        user,
                        learnerPackageSessionsEnrollDTO,
                        instituteId,
                        enrollInvite,
                        userPlan,
                        extraData);
            } else if (Boolean.TRUE.equals(userPlan.getAutoRenewalEnabled())) {
                // Autopay subscription: register a recurring mandate so the learner
                // authorizes future auto-charges. Routes to initiateMandatePayment,
                // whose response carries recurring:1 + customerId for the frontend to
                // open Razorpay Checkout in mandate mode (UPI Autopay / card e-mandate).
                var mandateRequest = learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest();
                // Free trial: take only a Rs.1 authorization at signup to register the
                // mandate (cards require >= Rs.1; UPI accepts it too). The first REAL
                // plan charge happens at trial-end via RenewalChargeService, since
                // applyAutopaySetup set next_charge_at = now + trialDays. The mandate
                // cap (max_amount) still comes from AUTOPAY_SETTING below, so future
                // renewals of the full plan price are authorized.
                if (Boolean.TRUE.equals(userPlan.getIsTrial())) {
                    double authAmount = resolveTrialAuthAmount(enrollInvite);
                    mandateRequest.setAmount(authAmount);
                    log.info("Trial enrollment: taking {} mandate authorization for user {} plan {} (first real charge at trial end)",
                            authAmount, user.getId(), userPlan.getId());
                }
                applyMandateMaxAmount(mandateRequest, enrollInvite, userPlan);
                paymentResponseDTO = paymentService.handleMandatePayment(
                        user,
                        instituteId,
                        enrollInvite,
                        userPlan,
                        mandateRequest);
            } else {
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
                log.info("Subscription payment successful for user: {}. Applying first payment operations.", user.getId());
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
                                                                       Integer accessDays, String learnerSessionStatus, UserPlan userPlan, Date enrollmentDate) {
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
                    enrollmentDate,
                    null,
                    accessDays != null ? accessDays.toString() : null,
                    packageSessionId,
                    userPlan.getId(), null, null, null);
            detailsList.add(detail);
        }
        return detailsList;
    }

    /**
     * Sets the Razorpay mandate max_amount (per-charge cap) from the invite's
     * AUTOPAY_SETTING.MAX_AMOUNT (admin-configured), falling back to the plan
     * price. No-op for non-Razorpay requests (eWay tokenizes on the first card
     * payment and has no native cap).
     */
    /** Default authorization charge when the invite doesn't configure one. */
    private static final double DEFAULT_TRIAL_AUTH_AMOUNT = 1.0;

    /**
     * The token-registration charge taken at trial signup. Gateways won't register a
     * mandate on a zero-value order, so a nominal amount is debited to prove the
     * instrument. Configurable per invite via AUTOPAY_SETTING.AUTH_AMOUNT.
     */
    private double resolveTrialAuthAmount(EnrollInvite enrollInvite) {
        try {
            if (enrollInvite != null && enrollInvite.getSettingJson() != null
                    && !enrollInvite.getSettingJson().isBlank()) {
                com.fasterxml.jackson.databind.JsonNode ap = new com.fasterxml.jackson.databind.ObjectMapper()
                        .readTree(enrollInvite.getSettingJson()).path("setting").path("AUTOPAY_SETTING");
                if (!ap.path("AUTH_ENABLED").asBoolean(true)) {
                    // The gateway still needs a non-zero order to register a mandate, so we
                    // cannot honour "no authorization" on a trial — fall back to the minimum
                    // rather than silently enrolling with no usable mandate.
                    log.warn("Invite {} disables AUTH_ENABLED but a trial mandate needs a non-zero "
                            + "charge — falling back to {}",
                            enrollInvite.getId(), DEFAULT_TRIAL_AUTH_AMOUNT);
                    return DEFAULT_TRIAL_AUTH_AMOUNT;
                }
                if (ap.has("AUTH_AMOUNT") && !ap.get("AUTH_AMOUNT").isNull()) {
                    double configured = ap.get("AUTH_AMOUNT").asDouble();
                    if (configured > 0) {
                        return configured;
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Could not read AUTOPAY_SETTING.AUTH_AMOUNT for invite {}: {}",
                    enrollInvite != null ? enrollInvite.getId() : null, e.getMessage());
        }
        return DEFAULT_TRIAL_AUTH_AMOUNT;
    }

    /**
     * Per-debit ceiling + frequency come from {@link MandateRequestDefaults} so that the
     * enrolment, renewal and plan-change re-authorisations all register the same shape
     * of mandate. The authorisation method (UPI / card) is NOT set here: the learner
     * picks it on the enrol form and it arrives already on the request.
     */
    private void applyMandateMaxAmount(PaymentInitiationRequestDTO request,
                                       EnrollInvite enrollInvite, UserPlan userPlan) {
        if (RegionalPriceLock.isLocked(userPlan)) {
            // Locked regional price, so the cap matches what renewals will debit.
            mandateRequestDefaults.applyMaxAmountAndFrequency(request, enrollInvite,
                    RegionalPriceLock.listPrice(userPlan));
        } else {
            // Not regionally priced: exactly the original call.
            mandateRequestDefaults.applyMaxAmountAndFrequency(request, enrollInvite, userPlan.getPaymentPlan());
        }
    }

}
