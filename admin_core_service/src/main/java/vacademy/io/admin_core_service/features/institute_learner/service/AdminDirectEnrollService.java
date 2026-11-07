package vacademy.io.admin_core_service.features.institute_learner.service;

import jakarta.transaction.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.service.EnrollInviteService;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDetails;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerStatusEnum;
import vacademy.io.admin_core_service.features.notification.enums.NotificationEventType;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.payments.service.PaymentService;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentOptionService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentPlanService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountService;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponDiscountUtil;
import vacademy.io.admin_core_service.features.learner.dto.SubOrgEnrollRequestDTO;
import vacademy.io.admin_core_service.features.learner.dto.SubOrgEnrollResponseDTO;
import vacademy.io.admin_core_service.features.learner.service.SubOrgLearnerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.ManualPaymentDTO;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

import java.util.*;

@Service
@Transactional
@Slf4j
public class AdminDirectEnrollService {

    @Autowired
    private EnrollInviteService enrollInviteService;

    @Autowired
    private PaymentOptionService paymentOptionService;

    @Autowired
    private PaymentPlanService paymentPlanService;

    @Autowired
    private UserPlanService userPlanService;

    @Autowired
    private LearnerBatchEnrollService learnerBatchEnrollService;

    @Autowired
    private PaymentLogService paymentLogService;

    @Autowired
    private AuthService authService;

    @Autowired
    private EnrollmentCredentialPolicyService enrollmentCredentialPolicyService;

    @Autowired
    private DynamicNotificationService dynamicNotificationService;

    @Autowired
    private SubOrgLearnerService subOrgLearnerService;

    @Autowired
    private AdminDiscountService adminDiscountService;

    @Autowired
    @org.springframework.context.annotation.Lazy
    private PaymentService paymentService;

    @Transactional
    public LearnerEnrollResponseDTO adminEnrollLearner(LearnerEnrollRequestDTO request, CustomUserDetails admin) {
        // If subOrgId is present, delegate to SubOrgLearnerService for each package session
        if (StringUtils.hasText(request.getSubOrgId())) {
            if (request.getLearnerPackageSessionEnroll() != null
                    && AdminDiscountService.isRequested(request.getLearnerPackageSessionEnroll().getAdminDiscount())) {
                throw new VacademyException("A discount can't be applied to a sub-organisation enrollment");
            }
            return adminEnrollLearnerToSubOrg(request, admin);
        }
        return adminEnrollLearnerDirect(request, admin);
    }

    /**
     * Enroll learner through sub-org flow — delegates to SubOrgLearnerService
     * for seat validation, UserPlan creation, and student_sub_org entry.
     */
    private LearnerEnrollResponseDTO adminEnrollLearnerToSubOrg(LearnerEnrollRequestDTO request, CustomUserDetails admin) {
        LearnerPackageSessionsEnrollDTO enrollDTO = request.getLearnerPackageSessionEnroll();
        List<String> packageSessionIds = enrollDTO.getPackageSessionIds();
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            throw new VacademyException("packageSessionIds are required");
        }

        SubOrgEnrollResponseDTO lastResponse = null;
        for (String packageSessionId : packageSessionIds) {
            SubOrgEnrollRequestDTO subOrgRequest = SubOrgEnrollRequestDTO.builder()
                    .user(request.getUser())
                    .packageSessionId(packageSessionId)
                    .subOrgId(request.getSubOrgId())
                    .instituteId(request.getInstituteId())
                    .enrolledDate(enrollDTO.getStartDate() != null ? enrollDTO.getStartDate() : new Date())
                    .status("ACTIVE")
                    .commaSeparatedOrgRoles("LEARNER")
                    .customFieldValues(enrollDTO.getCustomFieldValues())
                    .build();
            lastResponse = subOrgLearnerService.enrollLearnerToSubOrg(subOrgRequest, admin);
        }

        LearnerEnrollResponseDTO response = new LearnerEnrollResponseDTO();
        if (lastResponse != null) {
            response.setUser(lastResponse.getUser());
        }
        return response;
    }

    private LearnerEnrollResponseDTO adminEnrollLearnerDirect(LearnerEnrollRequestDTO request, CustomUserDetails admin) {
        UserDTO user = createUserOrGetExistingUser(request.getUser(),request.getInstituteId());
        LearnerPackageSessionsEnrollDTO enrollDTO = request.getLearnerPackageSessionEnroll();
        String instituteId = request.getInstituteId();

        validate(enrollDTO, user, instituteId);

        EnrollInvite enrollInvite = enrollInviteService.findById(enrollDTO.getEnrollInviteId());
        PaymentOption paymentOption = paymentOptionService.findById(enrollDTO.getPaymentOptionId());
        PaymentPlan paymentPlan = null;
        if (enrollDTO.getPlanId() != null) {
            paymentPlan = paymentPlanService.findById(enrollDTO.getPlanId()).orElse(null);
        }

        // Discount the admin gives on this enrollment (ad-hoc % / flat, or an existing
        // coupon). Resolved before anything is sent so an invalid discount fails cleanly.
        // The admin is recorded as the one who granted it.
        String adminUserId = admin != null ? admin.getUserId() : null;
        AppliedCouponDiscount adminDiscount = adminDiscountService.resolveForCharge(
                enrollDTO.getAdminDiscount(),
                instituteId,
                paymentPlan,
                paymentOption,
                enrollDTO.getPackageSessionIds().get(0),
                enrollDTO.getEnrollInviteId(),
                user.getEmail(),
                adminUserId);

		sendNotificationsForEnrollment(
				instituteId,
				user,
				paymentOption,
				enrollInvite,
				enrollDTO.getPackageSessionIds().get(0)
		);
		
		// Extract startDate from enrollDTO, default to current date if not provided
		Date enrollmentStartDate = enrollDTO.getStartDate() != null ? enrollDTO.getStartDate() : new Date();

        UserPlan userPlan = userPlanService.createUserPlan(
                user.getId(),
                paymentPlan,
                adminDiscount,
                enrollInvite,
                paymentOption,
                enrollDTO.getPaymentInitiationRequest(),
                UserPlanStatusEnum.ACTIVE.name(),
                null,
                null,
                enrollmentStartDate);
        if (adminDiscount != null) {
            adminDiscountService.stampGrantedBy(userPlan, adminDiscount, adminUserId);
            userPlan = userPlanService.save(userPlan);
        }

        List<InstituteStudentDetails> instituteStudentDetails = new ArrayList<>();
        for (String packageSessionId : enrollDTO.getPackageSessionIds()) {
            instituteStudentDetails.add(InstituteStudentDetails.builder()
                    .instituteId(instituteId)
                    .packageSessionId(packageSessionId)
                    .enrollmentStatus(LearnerStatusEnum.ACTIVE.name())
                    .enrollmentDate(enrollmentStartDate)
                    .accessDays(resolveAccessDays(enrollDTO, paymentPlan, enrollInvite))
                    .destinationPackageSessionId(null)
                    .userPlanId(userPlan.getId())
                    .build());
        }

        UserDTO createdUser = learnerBatchEnrollService.checkAndCreateStudentAndAddToBatch(
                user,
                instituteId,
                instituteStudentDetails,
                enrollDTO.getCustomFieldValues(),
                Map.of(),
                request.getLearnerExtraDetails(),enrollInvite);

        handleManualPaymentIfAny(enrollDTO.getPaymentInitiationRequest(), createdUser, userPlan, paymentPlan,
                enrollInvite);

        LearnerEnrollResponseDTO response = new LearnerEnrollResponseDTO();
        response.setUser(createdUser);
        return response;
    }

    /**
     * Days of access this enrollment grants, as the string
     * {@link InstituteStudentDetails} carries. Precedence is
     * <b>explicit &gt; plan &gt; invite</b>, mirroring
     * {@code DefaultInviteResolver.resolveAccessDays} so manual and bulk enrollment
     * cannot disagree.
     *
     * <p>The explicit value is what the admin typed on the enrollment form. It has to
     * win: previously only the invite was consulted, so a number entered here was
     * discarded and the learner silently got the invite's window (usually none at all,
     * i.e. unlimited).
     *
     * @return null for unlimited access, which leaves expiry_date unset.
     */
    private String resolveAccessDays(LearnerPackageSessionsEnrollDTO enrollDTO,
                                     PaymentPlan paymentPlan,
                                     EnrollInvite enrollInvite) {
        if (enrollDTO.getAccessDays() != null) {
            return enrollDTO.getAccessDays().toString();
        }
        if (paymentPlan != null && paymentPlan.getValidityInDays() != null) {
            return paymentPlan.getValidityInDays().toString();
        }
        if (enrollInvite != null && enrollInvite.getLearnerAccessDays() != null) {
            return enrollInvite.getLearnerAccessDays().toString();
        }
        return null;
    }

	private void sendNotificationsForEnrollment(
			String instituteId,
			UserDTO user,
			PaymentOption paymentOption,
			EnrollInvite enrollInvite,
			String packageSessionId) {

		try {
			dynamicNotificationService.sendDynamicNotification(
					NotificationEventType.LEARNER_ENROLL,
					packageSessionId,
					instituteId,
					user,
					paymentOption,
					enrollInvite
			);
		} catch (Exception e) {
			log.error("Error sending dynamic notification for admin enroll", e);
		}

		try {
			dynamicNotificationService.sendReferralInvitationNotification(
					instituteId,
					user,
					enrollInvite
			);
		} catch (Exception e) {
			log.error("Error sending referral invitation notification for admin enroll", e);
		}
	}

    private void validate(LearnerPackageSessionsEnrollDTO enrollDTO, UserDTO user, String instituteId) {
        if (enrollDTO == null || user == null || !StringUtils.hasText(instituteId)) {
            throw new VacademyException("learnerPackageSessionEnroll, user and instituteId are required");
        }
        if (enrollDTO.getPackageSessionIds() == null || enrollDTO.getPackageSessionIds().isEmpty()) {
            throw new VacademyException("packageSessionIds are required");
        }
        if (!StringUtils.hasText(enrollDTO.getEnrollInviteId()) ||
                !StringUtils.hasText(enrollDTO.getPaymentOptionId())) {
            throw new VacademyException("enrollInviteId, paymentOptionId are required");
        }
    }

    private void handleManualPaymentIfAny(PaymentInitiationRequestDTO pir,
            UserDTO createdUser,
            UserPlan userPlan,
            PaymentPlan paymentPlan,
            EnrollInvite enrollInvite) {
        if (pir == null)
            return;
        ManualPaymentDTO manual = pir.getManualRequest();
        if (manual == null)
            return;

        Double grossAmount = paymentPlan != null ? paymentPlan.getActualPrice() : pir.getAmount();
        // The admin's discount reduces what the learner paid offline.
        Double amount = userPlan.getAppliedCouponDiscount() != null && grossAmount != null
                ? CouponDiscountUtil.applyDiscount(grossAmount, userPlan.getAppliedCouponDiscount())
                : grossAmount;
        String currency = paymentPlan != null ? paymentPlan.getCurrency() : enrollInvite.getCurrency();

        String paymentLogId = paymentLogService.createPaymentLog(
                createdUser.getId(),
                amount != null ? amount : 0.0,
                PaymentGateway.MANUAL.name(),
                PaymentGateway.MANUAL.name(),
                currency,
                userPlan);

        if (userPlan.getAppliedCouponDiscount() != null) {
            paymentService.recordFirstPaymentDiscountLineItem(paymentLogId, userPlan, grossAmount);
        }

        Map<String, Object> paymentSpecificData = new HashMap<>();
        paymentSpecificData.put("originalRequest", pir);
        paymentSpecificData.put("manual", manual);

        paymentLogService.updatePaymentLog(
                paymentLogId,
                PaymentLogStatusEnum.SUCCESS.name(),
                PaymentStatusEnum.PAID.name(),
                JsonUtil.toJson(paymentSpecificData));
    }

    private UserDTO createUserOrGetExistingUser(UserDTO user,String instituteId) {
        // Same gate as the other enrollment paths: an institute that sends its own
        // enrollment email suppresses auth-service's built-in credential mail.
        return authService.createUserFromAuthService(user, instituteId,
                enrollmentCredentialPolicyService.shouldSendCredentialEmail(instituteId));
    }
}
