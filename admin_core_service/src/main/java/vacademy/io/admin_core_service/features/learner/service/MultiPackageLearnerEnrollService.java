package vacademy.io.admin_core_service.features.learner.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.learner.dto.v2.LearnerPackageSessionEnrollmentItemDTO;
import vacademy.io.admin_core_service.features.learner.dto.v2.MultiPackageLearnerEnrollRequestDTO;
import vacademy.io.admin_core_service.features.audience.service.UserLeadProfileService;
import vacademy.io.admin_core_service.features.course_settings.service.LeadConversionPolicyService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalQuote;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceResolver;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.util.StringUtils;

@Slf4j
@Service
public class MultiPackageLearnerEnrollService {

    @Autowired
    private LearnerEnrollRequestService learnerEnrollRequestService;

    @Autowired
    private PaymentLogService paymentLogService;

    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.service.PaymentPlanService paymentPlanService;

    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.service.PaymentOptionService paymentOptionService;

    @Autowired
    private AuthService authService;

    @Autowired
    private UserLeadProfileService userLeadProfileService;

    @Autowired
    private LeadConversionPolicyService leadConversionPolicyService;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private EnrollInviteRepository enrollInviteRepository;

    @Autowired
    private RegionalPriceResolver regionalPriceResolver;

    /**
     * Courses (packages) behind the enrolled package sessions, for the conversion-policy lookup.
     * A session whose package can't be resolved is simply left out — the policy service then
     * falls back to the institute default, i.e. today's convert-on-enrollment behaviour.
     */
    private List<String> resolvePackageIds(List<LearnerPackageSessionEnrollmentItemDTO> items) {
        List<String> packageSessionIds = items.stream()
                .map(LearnerPackageSessionEnrollmentItemDTO::getPackageSessionId)
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
        if (packageSessionIds.isEmpty()) {
            return List.of();
        }
        return packageSessionRepository.findAllById(packageSessionIds).stream()
                .map(ps -> ps.getPackageEntity() != null ? ps.getPackageEntity().getId() : null)
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
    }

    @Transactional
    public LearnerEnrollResponseDTO enrollMultiPackage(MultiPackageLearnerEnrollRequestDTO request) {

        // Handle case where only userId is provided
        if (request.getUser() == null && StringUtils.hasText(request.getUserId())) {
            log.info("Fetching user details for userId: {}", request.getUserId());
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(request.getUserId()));
            if (users.isEmpty()) {
                throw new VacademyException("User not found with ID: " + request.getUserId());
            }
            request.setUser(users.get(0));
        }

        if (request.getUser() == null) {
            throw new VacademyException("User details, or a valid userId, are required for enrollment");
        }
        log.info("Processing multi-package enrollment for user: {}", request.getUser().getEmail());

        List<LearnerPackageSessionEnrollmentItemDTO> items = request.getLearnerPackageSessionEnrollments();
        if (items == null || items.isEmpty()) {
            throw new VacademyException("No package sessions provided for enrollment");
        }

        // 0. Initialize PaymentInitiationRequest if missing
        if (request.getPaymentInitiationRequest() == null) {
            request.setPaymentInitiationRequest(new PaymentInitiationRequestDTO());
        }
        PaymentInitiationRequestDTO paymentInit = request.getPaymentInitiationRequest();

        // 0.1 Calculate Total Amount if missing
        // A negative amount is never legitimate, and the "free" checks below key off
        // amount <= 0 — so letting one through skipped payment entirely.
        if (paymentInit.getAmount() != null && paymentInit.getAmount() < 0
                && !"MANUAL".equalsIgnoreCase(request.getEnrollmentType())) {
            throw new VacademyException("Payment amount cannot be negative");
        }
        if (paymentInit.getAmount() == null || paymentInit.getAmount() == 0.0) {
            double totalAmount = 0.0;
            for (LearnerPackageSessionEnrollmentItemDTO item : items) {
                if (StringUtils.hasText(item.getPlanId())) {
                    vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan plan = paymentPlanService
                            .findById(item.getPlanId()).orElse(null);
                    // This loop used to fetch the plan and never add its price, so an omitted
                    // amount summed to 0 and the request was treated as FREE (skip payment +
                    // force PAID) — a paid enrollment for nothing.
                    if (plan != null) {
                        totalAmount += plan.getActualPrice();
                    }

                } else if (StringUtils.hasText(item.getPaymentOptionId())) {
                    // Fallback to auto-select active plan if planId is missing but paymentOption is
                    // present
                    // This matches the fallback logic in LearnerEnrollRequestService
                    vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption option = paymentOptionService
                            .findById(item.getPaymentOptionId());
                    if (option != null) {
                        List<vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan> relatedPlans = paymentPlanService
                                .findByPaymentOption(option);
                        List<vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan> activePlans = relatedPlans
                                .stream()
                                .filter(p -> "ACTIVE".equalsIgnoreCase(p.getStatus()))
                                .toList();
                        if (activePlans.size() == 1) {
                            vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan autoPlan = activePlans
                                    .get(0);
                            log.info("Auto-calculated price from single ACTIVE plan: {}", autoPlan.getId());
                            totalAmount += autoPlan.getActualPrice();
                            // Pin the plan so the amount verification below checks the
                            // same plan that was priced here.
                            item.setPlanId(autoPlan.getId());
                        } else if (!PaymentOptionType.FREE.name().equalsIgnoreCase(option.getType())
                                && !"MANUAL".equalsIgnoreCase(request.getEnrollmentType())) {
                            // A paid option whose plan can't be resolved can't be priced; summing
                            // it as 0 would hand the course out for free.
                            throw new VacademyException(
                                    "plan_id is required for payment option " + option.getId());
                        }
                    }
                }
            }
            log.info("Calculated total amount for multi-package enrollment: {}", totalAmount);
            paymentInit.setAmount(totalAmount);
        }

        // 0.2 Set User Email if missing
        if (!StringUtils.hasText(paymentInit.getEmail()) && request.getUser() != null) {
            paymentInit.setEmail(request.getUser().getEmail());
        }

        // 0.3 Verify the client-supplied amount equals the sum of plan prices for
        // every enrollment item. Closes the trust gap where any caller could submit
        // an arbitrary `amount` for the v2 multi-package endpoint. Skipped for
        // free/manual enrollments — those paths bypass payment entirely.
        boolean willSkipPaymentVerification =
                "MANUAL".equalsIgnoreCase(request.getEnrollmentType())
                        || (paymentInit.getAmount() != null && paymentInit.getAmount() <= 0);
        // Regional pricing for the whole order (null = base prices). Resolved before the items
        // fan out so every item enrolment sees the same decision.
        Double regionalTotal = willSkipPaymentVerification ? null : resolveRegionalTotal(items, paymentInit);
        if (!willSkipPaymentVerification && paymentInit.getAmount() != null) {
            double expectedSum = 0.0;
            for (LearnerPackageSessionEnrollmentItemDTO item : items) {
                if (!StringUtils.hasText(item.getPlanId())) {
                    throw new VacademyException(
                            "Each enrollment item must include a plan_id so the amount can be verified");
                }
                vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan plan =
                        paymentPlanService.findById(item.getPlanId()).orElseThrow(
                                () -> new VacademyException("PaymentPlan not found: " + item.getPlanId()));
                expectedSum += plan.getActualPrice();
            }
            if (regionalTotal != null) {
                expectedSum = regionalTotal;
            }
            double clientAmount = paymentInit.getAmount();
            if (Math.abs(clientAmount - expectedSum) > 0.01) {
                log.warn("Amount mismatch on multi-package enroll: client sent {}, expected {} (from {} plans)",
                        clientAmount, expectedSum, items.size());
                throw new VacademyException(String.format(
                        "Payment amount mismatch: submitted %.2f, expected %.2f", clientAmount, expectedSum));
            }
        }

        // 1. Ensure a consistent OrderId for the entire multi-package transaction
        if (!StringUtils.hasText(paymentInit.getOrderId())) {
            // Generate Order ID that fits PhonePe's 38-character limit
            // Format: MP{UUID without hyphens} = 34 characters (2 + 32)
            String sharedOrderId = "MP" + java.util.UUID.randomUUID().toString().replace("-", "");
            log.info("Generating shared OrderID for multi-package transaction: {}", sharedOrderId);
            paymentInit.setOrderId(sharedOrderId);
        }

        // 2. Process Main Package (First Item) - This initiates the Payment
        LearnerPackageSessionEnrollmentItemDTO mainItem = items.get(0);

        LearnerEnrollRequestDTO mainRequestDTO = mapToLegacyDTO(request, mainItem);
        // Override amount to TOTAL amount for the main transaction

        Map<String, Object> mainExtraData = new HashMap<>();
        if (request.getPaymentInitiationRequest() != null) {
            mainExtraData.put("OVERRIDE_TOTAL_AMOUNT", request.getPaymentInitiationRequest().getAmount());
        }

        boolean isSkipPayment = false;
        // Check if amount is 0, if so, skip payment initiation automatically
        if (request.getPaymentInitiationRequest() != null &&
                request.getPaymentInitiationRequest().getAmount() != null &&
                request.getPaymentInitiationRequest().getAmount() <= 0) {
            log.info("Total amount is 0, enabling SKIP_PAYMENT_INITIATION and immediate activation");
            isSkipPayment = true;
        }

        // Also skip payment if enrollment type is explicitly MANUAL
        if ("MANUAL".equalsIgnoreCase(request.getEnrollmentType())) {
            log.info("Enrollment type is MANUAL, enabling SKIP_PAYMENT_INITIATION and immediate activation");
            isSkipPayment = true;
        }

        // Learner checkouts must not enroll through an expired / inactive link. Admin
        // MANUAL enrollment is exempt (admins can place learners on closed invites).
        boolean enforceAvailability = !"MANUAL".equalsIgnoreCase(request.getEnrollmentType());
        if (enforceAvailability) {
            mainExtraData.put(LearnerEnrollRequestService.ENFORCE_INVITE_AVAILABILITY, true);
        }

        if (isSkipPayment) {
            mainExtraData.put("SKIP_PAYMENT_INITIATION", true);
            mainExtraData.put("IS_MANUAL_ENROLLMENT", true);
            mainExtraData.put("FORCE_PAID_STATUS", true);
        }

        log.info("Enrolling in primary package session: {}", mainItem.getPackageSessionId());
        LearnerEnrollResponseDTO mainResponse = learnerEnrollRequestService.recordLearnerRequest(mainRequestDTO,
                mainExtraData);

        if (mainResponse.getPaymentResponse() == null || mainResponse.getPaymentResponse().getOrderId() == null) {
            // If payment was skipped, getPaymentResponse() might be non-null but we need to
            // ensure we handled it
            if (Boolean.TRUE.equals(mainExtraData.get("SKIP_PAYMENT_INITIATION"))) {
                log.info("Payment initiation skipped for primary package as requested.");
                // We need to ensure we have a valid OrderId (paymentLogId) even if skipped,
                // which handlePaymentWithoutGateway should provide.
                if (mainResponse.getPaymentResponse() == null
                        || mainResponse.getPaymentResponse().getOrderId() == null) {
                    throw new VacademyException("Failed to generate payment log for skipped payment enrollment");
                }
            } else {
                throw new VacademyException("Failed to initiate payment for primary package");
            }
        }

        String mainPaymentLogId = mainResponse.getPaymentResponse().getOrderId();
        log.info("Main payment initiated. PaymentLogId/OrderId: {}. Total Amount: {}",
                mainPaymentLogId, request.getPaymentInitiationRequest().getAmount());
        UserDTO enrolledUser = mainResponse.getUser(); // Use the confirmed/created user ID for subsequent calls

        List<String> childPaymentLogIds = new ArrayList<>();

        // 2. Process Remaining Packages
        for (int i = 1; i < items.size(); i++) {
            LearnerPackageSessionEnrollmentItemDTO item = items.get(i);
            log.info("Enrolling in child package session: {}", item.getPackageSessionId());

            LearnerEnrollRequestDTO childRequestDTO = mapToLegacyDTO(request, item);
            childRequestDTO.setUser(enrolledUser); // Ensure same user

            Map<String, Object> childExtraData = new HashMap<>();
            childExtraData.put("SKIP_PAYMENT_INITIATION", true);
            childExtraData.put("PARENT_PAYMENT_LOG_ID", mainPaymentLogId);
            if (enforceAvailability) {
                childExtraData.put(LearnerEnrollRequestService.ENFORCE_INVITE_AVAILABILITY, true);
            }

            // Inherit Manual/Skip flags from main if applicable
            if (isSkipPayment) {
                log.info("Applying Manual/Skip flags to child enrollment");
                childExtraData.put("IS_MANUAL_ENROLLMENT", true);
                childExtraData.put("FORCE_PAID_STATUS", true);
            }

            // Handle Rent Case status
            if ("RENT".equalsIgnoreCase(request.getEnrollmentType())) {
                log.info("Marking child enrollment as RENT_REQUESTED");
                childExtraData.put("ENROLLMENT_STATUS", "RENT_REQUESTED");
            }

            LearnerEnrollResponseDTO childResponse = learnerEnrollRequestService.recordLearnerRequest(childRequestDTO,
                    childExtraData);

            if (childResponse.getPaymentResponse() != null) {
                childPaymentLogIds.add(childResponse.getPaymentResponse().getOrderId());
            }
        }

        // 3. Link Child Logs to Main Log
        if (!childPaymentLogIds.isEmpty()) {
            log.info("Linking {} child payment logs to main log {}", childPaymentLogIds.size(), mainPaymentLogId);
            paymentLogService.addChildLogsToPayment(mainPaymentLogId, childPaymentLogIds);
        }

        // 4. Auto-mark conversion if this user came in as a lead — unless every course in this
        // enrollment opted out of counting as a conversion (a free course / trial / lead magnet
        // keeps the lead open). See LeadConversionPolicyService; defaults to converting.
        // Best-effort: failures here must not roll back the enrollment.
        try {
            String enrolledUserId = enrolledUser != null ? enrolledUser.getId() : null;
            String instituteId = request.getInstituteId();
            if (StringUtils.hasText(enrolledUserId) && StringUtils.hasText(instituteId)
                    && leadConversionPolicyService.anyCountsAsConversion(
                            instituteId, resolvePackageIds(items))) {
                boolean converted = userLeadProfileService.markConvertedIfExists(enrolledUserId, instituteId);
                if (converted) {
                    log.info("Auto-marked lead as CONVERTED on enrollment: userId={}, instituteId={}",
                            enrolledUserId, instituteId);
                }
            }
        } catch (Exception e) {
            log.warn("Failed to auto-mark lead conversion after enrollment", e);
        }

        return mainResponse;
    }

    /**
     * Regional price of the whole order, or null when it stays on base prices. All or
     * nothing: every paid ONE_TIME / SUBSCRIPTION item must price regionally in one currency.
     * A mix (some regional, some not, or two currencies) would make one gateway order carry
     * two currencies, so regional pricing is switched off for this request instead and every
     * item enrolment — including the ones LearnerEnrollRequestService resolves on its own —
     * falls back to base prices.
     */
    private Double resolveRegionalTotal(List<LearnerPackageSessionEnrollmentItemDTO> items,
                                        PaymentInitiationRequestDTO paymentInit) {
        try {
            return resolveRegionalTotalOrThrow(items, paymentInit);
        } catch (Exception e) {
            // Never fail a checkout over regional pricing: the whole order (every item
            // enrolment included) falls back to base prices, the pre-regional flow.
            log.warn("Regional pricing skipped for multi-package order: {}", e.getMessage());
            regionalPriceResolver.suppressForCurrentRequest();
            return null;
        }
    }

    private Double resolveRegionalTotalOrThrow(List<LearnerPackageSessionEnrollmentItemDTO> items,
                                               PaymentInitiationRequestDTO paymentInit) {
        String currency = null;
        double total = 0.0;
        boolean anyRegional = false;
        boolean mixed = false;
        for (LearnerPackageSessionEnrollmentItemDTO item : items) {
            PaymentPlan plan = StringUtils.hasText(item.getPlanId())
                    ? paymentPlanService.findById(item.getPlanId()).orElse(null) : null;
            if (plan == null || plan.getActualPrice() <= 0) {
                continue;
            }
            String type = plan.getPaymentOption() != null ? plan.getPaymentOption().getType() : null;
            boolean eligible = (PaymentOptionType.ONE_TIME.name().equals(type)
                    || PaymentOptionType.SUBSCRIPTION.name().equals(type))
                    && Boolean.TRUE.equals(plan.getPaymentOption().getRegionalPricingEnabled());
            String vendor = eligible && StringUtils.hasText(item.getEnrollInviteId())
                    ? enrollInviteRepository.findById(item.getEnrollInviteId()).map(EnrollInvite::getVendor).orElse(null)
                    : null;
            Optional<RegionalQuote> quote = eligible ? regionalPriceResolver.quote(plan, vendor) : Optional.empty();
            if (quote.isEmpty() || (currency != null && !currency.equals(quote.get().currency()))) {
                mixed = true;
                continue;
            }
            currency = quote.get().currency();
            total += quote.get().actualPrice().doubleValue();
            anyRegional = true;
        }
        if (!anyRegional) {
            return null;
        }
        if (mixed) {
            log.info("Multi-package order mixes regional and base prices — using base prices for all items");
            regionalPriceResolver.suppressForCurrentRequest();
            return null;
        }
        paymentInit.setCurrency(currency);
        return total;
    }

    private LearnerEnrollRequestDTO mapToLegacyDTO(MultiPackageLearnerEnrollRequestDTO request,
            LearnerPackageSessionEnrollmentItemDTO item) {
        LearnerEnrollRequestDTO dto = new LearnerEnrollRequestDTO();
        dto.setUser(request.getUser());
        dto.setInstituteId(request.getInstituteId());
        dto.setLearnerExtraDetails(request.getLearnerExtraDetails());

        LearnerPackageSessionsEnrollDTO enrollDTO = new LearnerPackageSessionsEnrollDTO();
        enrollDTO.setPackageSessionIds(List.of(item.getPackageSessionId()));
        enrollDTO.setPlanId(item.getPlanId());
        enrollDTO.setPaymentOptionId(item.getPaymentOptionId());
        enrollDTO.setEnrollInviteId(item.getEnrollInviteId());
        enrollDTO.setCustomFieldValues(item.getCustomFieldValues());
        enrollDTO.setReferRequest(item.getReferRequest());

        // Copy payment initiation request details if available
        if (request.getPaymentInitiationRequest() != null) {
            PaymentInitiationRequestDTO newInit = new PaymentInitiationRequestDTO();
            PaymentInitiationRequestDTO orig = request.getPaymentInitiationRequest();
            newInit.setAmount(orig.getAmount()); // Will be overridden for Main, but good to have
            newInit.setCurrency(orig.getCurrency());
            newInit.setVendor(orig.getVendor());
            newInit.setVendorId(orig.getVendorId());
            newInit.setEmail(orig.getEmail());
            newInit.setOrderId(orig.getOrderId()); // Sync the shared orderId
            newInit.setInstituteId(request.getInstituteId());
            newInit.setPhonePeRequest(orig.getPhonePeRequest()); // IMPORTANT
            // Add other fields as necessary

            enrollDTO.setPaymentInitiationRequest(newInit);
        }

        dto.setLearnerPackageSessionEnroll(enrollDTO);
        return dto;
    }
}
