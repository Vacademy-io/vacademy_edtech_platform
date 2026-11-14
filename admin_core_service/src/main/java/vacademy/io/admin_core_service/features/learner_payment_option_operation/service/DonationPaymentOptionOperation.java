package vacademy.io.admin_core_service.features.learner_payment_option_operation.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDetails;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerBatchEnrollService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.enums.PackageStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.payments.service.PaymentService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.handler.ReferralBenefitOrchestrator;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;
import vacademy.io.common.auth.dto.learner.LearnerExtraDetails;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.payment.dto.PaymentResponseDTO;

import java.util.*;

@Service
public class DonationPaymentOptionOperation implements PaymentOptionOperationStrategy {

    @Autowired
    private LearnerBatchEnrollService learnerBatchEnrollService;

    @Autowired
    private PaymentService paymentService;

    @Autowired
    private PaymentLogService paymentLogService;

    @Autowired
    private PaymentNotificatonService paymentNotificatonService;

    @Autowired
    private PaymentGatewaySpecificPaymentDetailService paymentGatewaySpecificPaymentDetailService;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private ReferralBenefitOrchestrator referralBenefitOrchestrator;

    @Autowired
    private AuthService authService;

    @Override
    public LearnerEnrollResponseDTO enrollLearnerToBatch(UserDTO userDTO,
                                                         LearnerPackageSessionsEnrollDTO learnerPackageSessionsEnrollDTO,
                                                         String instituteId,
                                                         EnrollInvite enrollInvite,
                                                         PaymentOption paymentOption,
                                                         UserPlan userPlan,
                                                         Map<String, Object> extraData, LearnerExtraDetails learnerExtraDetails) {
        // Use startDate from DTO if provided, otherwise default to current date
        Date enrollmentDate = learnerPackageSessionsEnrollDTO.getStartDate() != null
                ? learnerPackageSessionsEnrollDTO.getStartDate()
                : new Date();

        List<InstituteStudentDetails> instituteStudentDetails = new ArrayList<>();
        if (paymentOption.isRequireApproval()) {
            String status = LearnerStatusEnum.PENDING_FOR_APPROVAL.name();
            for (String packageSessionId : learnerPackageSessionsEnrollDTO.getPackageSessionIds()) {
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
                        status,
                        enrollmentDate,
                        null,
                        enrollInvite.getLearnerAccessDays() != null ? enrollInvite.getLearnerAccessDays().toString()
                                : null,
                        packageSessionId, userPlan.getId(), null, null, null);
                instituteStudentDetails.add(detail);
            }
        } else {
            String status = LearnerStatusEnum.ACTIVE.name();
            Integer accessDays = enrollInvite.getLearnerAccessDays();
            List<String> packageSessionIds = learnerPackageSessionsEnrollDTO.getPackageSessionIds();
            for (String packageSessionId : packageSessionIds) {
                InstituteStudentDetails instituteStudentDetail = new InstituteStudentDetails(instituteId,
                        packageSessionId, null, status, enrollmentDate, null,
                        (accessDays != null ? accessDays.toString() : null), null, userPlan.getId(), null, null, null);
                instituteStudentDetails.add(instituteStudentDetail);
            }
        }
        UserDTO user = learnerBatchEnrollService.checkAndCreateStudentAndAddToBatch(userDTO, instituteId,
                instituteStudentDetails, learnerPackageSessionsEnrollDTO.getCustomFieldValues(), extraData,
                learnerExtraDetails, enrollInvite, userPlan);

        // Process referral request if present - for donation payments, benefits are
        // activated immediately
        if (learnerPackageSessionsEnrollDTO.getReferRequest() != null) {
            referralBenefitOrchestrator.processAllBenefits(
                    learnerPackageSessionsEnrollDTO,
                    paymentOption,
                    userPlan,
                    user,
                    instituteId);
        }

        LearnerEnrollResponseDTO learnerEnrollResponseDTO = new LearnerEnrollResponseDTO();
        if (learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest() != null) {

            if (extraData.containsKey("OVERRIDE_TOTAL_AMOUNT")) {
                Object amountObj = extraData.get("OVERRIDE_TOTAL_AMOUNT");
                if (amountObj instanceof Number) {
                    Double amount = ((Number) amountObj).doubleValue();
                    learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().setAmount(amount);
                }
            }

            if (extraData.containsKey("PARENT_PAYMENT_LOG_ID")) {
                String parentLogId = (String) extraData.get("PARENT_PAYMENT_LOG_ID");
                learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().setOrderId(parentLogId);
            }

            PaymentResponseDTO paymentResponseDTO;
            if (extraData.containsKey("SKIP_PAYMENT_INITIATION")
                    && Boolean.TRUE.equals(extraData.get("SKIP_PAYMENT_INITIATION"))) {
                // Only the order link: this path has never applied the other extras.
                paymentResponseDTO = paymentService.handlePaymentWithoutGateway(
                        user,
                        learnerPackageSessionsEnrollDTO,
                        instituteId,
                        enrollInvite,
                        userPlan,
                        extraData.containsKey("PARENT_PAYMENT_LOG_ID")
                                ? Map.of("PARENT_PAYMENT_LOG_ID", extraData.get("PARENT_PAYMENT_LOG_ID"))
                                : Map.of());
            } else {
                paymentResponseDTO = paymentService.handlePayment(
                        user,
                        learnerPackageSessionsEnrollDTO,
                        instituteId,
                        enrollInvite,
                        userPlan);
            }
            learnerEnrollResponseDTO.setPaymentResponse(paymentResponseDTO);
        }
        learnerEnrollResponseDTO.setUser(user);
        return learnerEnrollResponseDTO;
    }
}
