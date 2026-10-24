package vacademy.io.admin_core_service.features.learner_payment_option_operation.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption;
import vacademy.io.admin_core_service.features.fee_management.repository.ComplexPaymentOptionRepository;
import vacademy.io.admin_core_service.features.fee_management.service.CpoDuesCalculator;
import vacademy.io.admin_core_service.features.fee_management.service.StudentFeePaymentGenerationService;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDetails;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerBatchEnrollService;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerEnrollmentEntryService;
import vacademy.io.admin_core_service.features.payments.service.PaymentService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;
import vacademy.io.common.auth.dto.learner.LearnerExtraDetails;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.common.payment.enums.PaymentType;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * Strategy for {@code PaymentOptionType.CPO} (mirror PaymentOption representing
 * a ComplexPaymentOption). This unifies the school-admission CPO flow with the
 * regular learner enrollment flow.
 *
 * <p>At enrollment:
 * <ol>
 *   <li>Validates the CPO via {@link vacademy.io.admin_core_service.features.fee_management.service.CpoValidationService}.
 *   <li>Creates institute-student records with the appropriate batch status.
 *   <li>Generates StudentFeePayment rows by delegating to
 *       {@link StudentFeePaymentGenerationService#generateFeeBills(String, String, String, String)}.
 *   <li>Computes the amount currently due via {@link CpoDuesCalculator} and
 *       overrides {@code paymentInitiationRequest.amount} (unless extraData supplies
 *       {@code OVERRIDE_TOTAL_AMOUNT} — used by the v2 multi-package summer).
 *   <li>Routes payment through {@link PaymentService} with
 *       {@code PaymentType.SCHOOL} so the existing Razorpay {@code handleSchoolPayment}
 *       webhook branch handles allocation, UserPlan activation, and receipts.
 *   <li>Honors {@code SKIP_PAYMENT_INITIATION}, {@code PARENT_PAYMENT_LOG_ID},
 *       {@code IS_MANUAL_ENROLLMENT}, {@code FORCE_PAID_STATUS} the same way other
 *       strategies do, so v2 multi-package + manual/RENT enrollments work.
 * </ol>
 */
@Service
@Slf4j
public class ComplexPaymentOptionOperation implements PaymentOptionOperationStrategy {

    @Autowired
    private LearnerBatchEnrollService learnerBatchEnrollService;

    @Autowired
    private LearnerEnrollmentEntryService learnerEnrollmentEntryService;

    @Autowired
    private PaymentService paymentService;

    @Autowired
    private UserPlanService userPlanService;

    @Autowired
    private StudentFeePaymentGenerationService studentFeePaymentGenerationService;

    @Autowired
    private ComplexPaymentOptionRepository complexPaymentOptionRepository;

    @Autowired
    private CpoDuesCalculator cpoDuesCalculator;

    @Override
    public LearnerEnrollResponseDTO enrollLearnerToBatch(UserDTO userDTO,
                                                         LearnerPackageSessionsEnrollDTO enrollDTO,
                                                         String instituteId,
                                                         EnrollInvite enrollInvite,
                                                         PaymentOption paymentOption,
                                                         UserPlan userPlan,
                                                         Map<String, Object> extraData,
                                                         LearnerExtraDetails learnerExtraDetails) {
        log.info("Processing CPO enrollment for user: {}, paymentOption={}, cpoId={}",
                userDTO.getEmail(), paymentOption.getId(), paymentOption.getComplexPaymentOptionId());

        String cpoId = paymentOption.getComplexPaymentOptionId();
        if (cpoId == null) {
            throw new VacademyException(
                    "PaymentOption " + paymentOption.getId() + " is type=CPO but complexPaymentOptionId is null. "
                            + "Mirror was not synced — this should never happen.");
        }

        ComplexPaymentOption cpo = complexPaymentOptionRepository.findById(cpoId)
                .orElseThrow(() -> new VacademyException("CPO not found: " + cpoId));
        if ("PENDING_APPROVAL".equalsIgnoreCase(cpo.getStatus())) {
            throw new VacademyException("This fee structure is pending approval and cannot be used for enrollment.");
        }
        if ("DELETED".equalsIgnoreCase(cpo.getStatus())) {
            throw new VacademyException("This fee structure is no longer available.");
        }
        // A FLEXIBLE plan has no fixed dates: the institute picks each learner's schedule in the
        // admin Enroll wizard (BulkAssignmentService, which does not come through here). Learner
        // checkout still previews the plan's template, which a flexible plan does not have, so
        // self-enrollment is refused until the learner side supports it (CPO_FLEXIBLE_INSTALLMENTS.md phase 4).
        if (vacademy.io.admin_core_service.features.fee_management.enums.CpoScheduleMode
                .isFlexible(cpo.getScheduleMode())) {
            throw new VacademyException("Installments for this fee plan are set up by the institute when it "
                    + "enrolls you. Please contact the institute to enroll.");
        }

        // Step 1: Update existing ABANDONED_CART entries with userPlanId (matches OneTime/Subscription behavior).
        List<String> packageSessionIds = enrollDTO.getPackageSessionIds();
        if (packageSessionIds != null && !packageSessionIds.isEmpty()) {
            try {
                int updated = learnerEnrollmentEntryService.updateAbandonedCartEntriesWithUserPlanId(
                        userDTO.getId(), packageSessionIds, instituteId, userPlan.getId());
                log.info("Updated {} ABANDONED_CART entries for CPO enrollment user={}", updated, userDTO.getId());
            } catch (Exception e) {
                log.warn("Could not update ABANDONED_CART entries for user={}: {}", userDTO.getId(), e.getMessage());
            }
        }

        // Step 2: Build institute-student records.
        boolean willPayOnline = enrollDTO.getPaymentInitiationRequest() != null
                && !isSkipPayment(extraData);
        boolean isManual = Boolean.TRUE.equals(extraData.get("IS_MANUAL_ENROLLMENT"));
        boolean forcePaid = Boolean.TRUE.equals(extraData.get("FORCE_PAID_STATUS"));

        String batchStatus;
        if (extraData.containsKey("ENROLLMENT_STATUS")) {
            batchStatus = (String) extraData.get("ENROLLMENT_STATUS");
        } else if (paymentOption.isRequireApproval()) {
            batchStatus = LearnerStatusEnum.PENDING_FOR_APPROVAL.name();
        } else if (willPayOnline && !isManual && !forcePaid) {
            // Pay-now flow: keep learner INVITED until the webhook confirms payment.
            batchStatus = LearnerStatusEnum.INVITED.name();
        } else {
            // Offline / manual / skipped / forced-paid: activate immediately.
            batchStatus = LearnerStatusEnum.ACTIVE.name();
        }

        Date enrollmentDate = enrollDTO.getStartDate() != null ? enrollDTO.getStartDate() : new Date();
        Integer accessDays = enrollInvite != null ? enrollInvite.getLearnerAccessDays() : null;

        List<InstituteStudentDetails> instituteStudentDetails = new ArrayList<>();
        if (packageSessionIds != null) {
            for (String packageSessionId : packageSessionIds) {
                instituteStudentDetails.add(InstituteStudentDetails.builder()
                        .instituteId(instituteId)
                        .packageSessionId(packageSessionId)
                        .enrollmentStatus(batchStatus)
                        .enrollmentDate(enrollmentDate)
                        .accessDays(accessDays != null ? accessDays.toString() : null)
                        .destinationPackageSessionId(null)
                        .userPlanId(userPlan.getId())
                        .build());
            }
        }

        UserDTO user = learnerBatchEnrollService.checkAndCreateStudentAndAddToBatch(
                userDTO,
                instituteId,
                instituteStudentDetails,
                enrollDTO.getCustomFieldValues(),
                extraData,
                learnerExtraDetails,
                enrollInvite,
                userPlan);

        // Step 3: Generate StudentFeePayment rows from the CPO template.
        // Reuses the existing generator unchanged.
        try {
            studentFeePaymentGenerationService.generateFeeBills(
                    userPlan.getId(), cpoId, user.getId(), instituteId);
        } catch (Exception e) {
            log.error("Failed to generate fee bills for userPlan={}, cpo={}: {}",
                    userPlan.getId(), cpoId, e.getMessage(), e);
            throw new VacademyException("Failed to generate fee bills: " + e.getMessage());
        }

        LearnerEnrollResponseDTO response = new LearnerEnrollResponseDTO();
        response.setUser(user);
        response.setUserPlanId(userPlan.getId());

        // Step 4: Handle payment.
        PaymentInitiationRequestDTO paymentRequest = enrollDTO.getPaymentInitiationRequest();
        if (paymentRequest == null) {
            // No payment requested at enrollment time (admin-driven offline allocation will follow).
            // If the UserPlan was created in a non-active state for some reason, leave it alone here —
            // the school flow / admin-allocate path will activate via FeeLedgerAllocationService + applyOperationsOnFirstPayment.
            return response;
        }

        // Compute the amount the learner owes RIGHT NOW (sum of unpaid SFP rows due as of today).
        BigDecimal duesNow = cpoDuesCalculator.computeDuesForUserPlan(userPlan.getId());
        if (duesNow.signum() == 0) {
            // No installment is due now — fall back to the full outstanding balance so the
            // enrollment still collects something (matches legacy school behaviour for CPOs
            // that don't carry installment dates).
            duesNow = cpoDuesCalculator.computeFullOutstandingForUserPlan(userPlan.getId());
        }

        if (extraData.containsKey("OVERRIDE_TOTAL_AMOUNT")) {
            Object amountObj = extraData.get("OVERRIDE_TOTAL_AMOUNT");
            if (amountObj instanceof Number) {
                Double amount = ((Number) amountObj).doubleValue();
                log.info("Overriding CPO payment amount to {} from extraData (multi-package summing)", amount);
                paymentRequest.setAmount(amount);
            }
        } else if (paymentRequest.getAmount() != null && paymentRequest.getAmount() > 0) {
            // Learner supplied a specific amount (e.g. selected N installments) — respect it.
            log.info("Using caller-supplied CPO payment amount={} for userPlan={}", paymentRequest.getAmount(), userPlan.getId());
        } else {
            log.info("Setting CPO payment amount to currently-due figure: {}", duesNow);
            paymentRequest.setAmount(duesNow.doubleValue());
        }

        if (extraData.containsKey("PARENT_PAYMENT_LOG_ID")) {
            String parentLogId = (String) extraData.get("PARENT_PAYMENT_LOG_ID");
            paymentRequest.setOrderId(parentLogId);
        }

        // Critical: route through the existing SCHOOL webhook branch so allocation,
        // activation and receipt generation reuse the legacy infra unchanged.
        paymentRequest.setPaymentType(PaymentType.SCHOOL);
        if (paymentRequest.getCurrency() == null && enrollInvite != null && enrollInvite.getCurrency() != null) {
            paymentRequest.setCurrency(enrollInvite.getCurrency());
        }
        if (paymentRequest.getEmail() == null && user.getEmail() != null) {
            paymentRequest.setEmail(user.getEmail());
        }
        if (paymentRequest.getInstituteId() == null) {
            paymentRequest.setInstituteId(instituteId);
        }

        PaymentResponseDTO paymentResponseDTO;
        if (paymentRequest.getAmount() == null || paymentRequest.getAmount() <= 0.0) {
            // Zero-due case: skip the gateway entirely and activate immediately
            // (mirrors FREE strategy semantics for a "nothing to pay right now" CPO).
            log.info("CPO dues are zero for userPlan={}. Skipping gateway, activating UserPlan directly.",
                    userPlan.getId());
            paymentResponseDTO = paymentService.handlePaymentWithoutGateway(
                    user, enrollDTO, instituteId, enrollInvite, userPlan,
                    Map.of("FORCE_PAID_STATUS", true));
            userPlanService.applyOperationsOnFirstPayment(userPlan);
        } else if (isSkipPayment(extraData)) {
            log.info("Skipping CPO payment initiation for user={} (multi-package child or manual)", user.getId());
            paymentResponseDTO = paymentService.handlePaymentWithoutGateway(
                    user, enrollDTO, instituteId, enrollInvite, userPlan, extraData);
            if (forcePaid) {
                userPlanService.applyOperationsOnFirstPayment(userPlan);
            }
        } else {
            log.info("Initiating CPO gateway payment for user={}, amount={}, currency={}",
                    user.getId(), paymentRequest.getAmount(), paymentRequest.getCurrency());
            paymentResponseDTO = paymentService.handlePayment(
                    user, enrollDTO, instituteId, enrollInvite, userPlan);
            if (isPaymentSuccessful(paymentResponseDTO)) {
                userPlanService.applyOperationsOnFirstPayment(userPlan);
            }
        }
        response.setPaymentResponse(paymentResponseDTO);

        return response;
    }

    private boolean isSkipPayment(Map<String, Object> extraData) {
        return extraData != null
                && extraData.containsKey("SKIP_PAYMENT_INITIATION")
                && Boolean.TRUE.equals(extraData.get("SKIP_PAYMENT_INITIATION"));
    }

    private boolean isPaymentSuccessful(PaymentResponseDTO paymentResponseDTO) {
        if (paymentResponseDTO == null || paymentResponseDTO.getResponseData() == null) {
            return false;
        }
        Object paymentStatus = paymentResponseDTO.getResponseData().get("paymentStatus");
        return "PAID".equals(paymentStatus);
    }
}
