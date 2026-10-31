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
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalQuote;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceResolver;
import vacademy.io.admin_core_service.features.stock_hold.entity.StockHold;
import vacademy.io.admin_core_service.features.stock_hold.enums.StockHoldKind;
import vacademy.io.admin_core_service.features.stock_hold.service.RepeatPurchasePolicyService;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
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

    @Autowired
    private StockHoldService stockHoldService;

    @Autowired
    private RepeatPurchasePolicyService repeatPurchasePolicyService;

    @Autowired
    private AdditionalChargeValidator additionalChargeValidator;

    @Autowired
    private PaymentLogRepository paymentLogRepository;

    /** Regional price of a whole order: its total and each item's unit price, keyed by package session. */
    private record RegionalOrderPrice(double total, Map<String, Double> unitPriceByPackageSessionId) {
    }

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
        boolean isManual = "MANUAL".equalsIgnoreCase(request.getEnrollmentType());

        // 0. One line per item, its copies in requested_quantity (null → 1).
        validateQuantities(items);

        // 0. Initialize PaymentInitiationRequest if missing
        if (request.getPaymentInitiationRequest() == null) {
            request.setPaymentInitiationRequest(new PaymentInitiationRequestDTO());
        }
        PaymentInitiationRequestDTO paymentInit = request.getPaymentInitiationRequest();

        // 0.1 Calculate Total Amount if missing
        // A negative amount is never legitimate, and the "free" checks below key off
        // amount <= 0 — so letting one through skipped payment entirely.
        if (paymentInit.getAmount() != null && paymentInit.getAmount() < 0 && !isManual) {
            throw new InvalidRequestException("Payment amount cannot be negative");
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
                        totalAmount += lineTotal(plan.getActualPrice(), item.getRequestedQuantity());
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
                            totalAmount += lineTotal(autoPlan.getActualPrice(), item.getRequestedQuantity());
                            // Pin the plan so the amount verification below checks the
                            // same plan that was priced here.
                            item.setPlanId(autoPlan.getId());
                        } else if (!PaymentOptionType.FREE.name().equalsIgnoreCase(option.getType())
                                && !isManual) {
                            // A paid option whose plan can't be resolved can't be priced; summing
                            // it as 0 would hand the course out for free.
                            throw new InvalidRequestException(
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

        // 0.3 Verify the client-supplied amount equals the sum of line totals (plan
        // price × quantity) for every enrollment item. Closes the trust gap where any
        // caller could submit an arbitrary `amount` for the v2 multi-package endpoint.
        // Skipped for free/manual enrollments — those paths bypass payment entirely.
        boolean willSkipPaymentVerification =
                isManual || (paymentInit.getAmount() != null && paymentInit.getAmount() <= 0);
        // Regional pricing for the whole order (null = base prices). Resolved before the items
        // fan out so every item enrolment sees the same decision.
        RegionalOrderPrice regionalPrice = willSkipPaymentVerification ? null : resolveRegionalTotal(items, paymentInit);
        if (!willSkipPaymentVerification && paymentInit.getAmount() != null) {
            double expectedSum = 0.0;
            for (LearnerPackageSessionEnrollmentItemDTO item : items) {
                if (!StringUtils.hasText(item.getPlanId())) {
                    throw new InvalidRequestException(
                            "Each enrollment item must include a plan_id so the amount can be verified");
                }
                vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan plan =
                        paymentPlanService.findById(item.getPlanId()).orElseThrow(
                                () -> new InvalidRequestException("PaymentPlan not found: " + item.getPlanId()));
                expectedSum += lineTotal(plan.getActualPrice(), item.getRequestedQuantity());
            }
            if (regionalPrice != null) {
                expectedSum = regionalPrice.total();
            }
            double clientAmount = paymentInit.getAmount();
            if (Math.abs(clientAmount - expectedSum) > 0.01) {
                log.warn("Amount mismatch on multi-package enroll: client sent {}, expected {} (from {} plans)",
                        clientAmount, expectedSum, items.size());
                throw new InvalidRequestException(String.format(
                        "Payment amount mismatch: submitted %.2f, expected %.2f", clientAmount, expectedSum));
            }
        }

        // Each item's own amount is its line total (unit × quantity). It used to be the ORDER
        // total on every item, so every item's ledger debit was the whole order.
        Map<String, Double> lineAmountByPackageSessionId = lineAmounts(items, regionalPrice);
        String orderInstituteId = resolveOrderInstituteId(request, items.get(0));

        // 0.4 Shipping / additional charges must match the catalogue's tier for the number
        // of copies (or its zone for the delivery PIN), and must not be dropped. Storefront
        // orders only.
        if (!isManual && paymentInit.getAmount() != null && paymentInit.getAmount() > 0) {
            additionalChargeValidator.validate(orderInstituteId, request.getCatalogueTag(), items,
                    request.getUser().getPinCode());
        }

        // 1. Ensure a consistent OrderId for the entire multi-package transaction
        if (!StringUtils.hasText(paymentInit.getOrderId())) {
            // Generate Order ID that fits PhonePe's 38-character limit
            // Format: MP{UUID without hyphens} = 34 characters (2 + 32)
            String sharedOrderId = "MP" + java.util.UUID.randomUUID().toString().replace("-", "");
            log.info("Generating shared OrderID for multi-package transaction: {}", sharedOrderId);
            paymentInit.setOrderId(sharedOrderId);
        }

        // 1.1 Hold stock for the whole order before the gateway is called, so two learners
        // can't both pay for the last copy (409 "Only N left of ..." when short; the
        // transaction rolls back every hold already taken). Admin MANUAL orders hold nothing:
        // their plans activate at once and take stock then (StockHoldService.onPlanActivated).
        Map<String, List<StockHold>> holdsByPackageSessionId = isManual
                ? Map.of()
                : holdOrderStock(orderInstituteId, items);

        // 2. Process Main Package (First Item) - This initiates the Payment
        LearnerPackageSessionEnrollmentItemDTO mainItem = items.get(0);
        double mainLineAmount = lineAmountByPackageSessionId.getOrDefault(mainItem.getPackageSessionId(), 0.0);

        LearnerEnrollRequestDTO mainRequestDTO = mapToLegacyDTO(request, mainItem, mainLineAmount);
        // Override amount to TOTAL amount for the main transaction's gateway charge; its own
        // amount (ledger debit) stays the main item's line total.

        Map<String, Object> mainExtraData = new HashMap<>();
        if (request.getPaymentInitiationRequest() != null) {
            mainExtraData.put("OVERRIDE_TOTAL_AMOUNT", request.getPaymentInitiationRequest().getAmount());
        }
        putLineExtraData(mainExtraData, mainItem, isManual, holdsByPackageSessionId);

        boolean isSkipPayment = false;
        // Check if amount is 0, if so, skip payment initiation automatically
        if (request.getPaymentInitiationRequest() != null &&
                request.getPaymentInitiationRequest().getAmount() != null &&
                request.getPaymentInitiationRequest().getAmount() <= 0) {
            log.info("Total amount is 0, enabling SKIP_PAYMENT_INITIATION and immediate activation");
            isSkipPayment = true;
        }

        // Also skip payment if enrollment type is explicitly MANUAL
        if (isManual) {
            log.info("Enrollment type is MANUAL, enabling SKIP_PAYMENT_INITIATION and immediate activation");
            isSkipPayment = true;
        }

        // Learner checkouts must not enroll through an expired / inactive link. Admin
        // MANUAL enrollment is exempt (admins can place learners on closed invites).
        boolean enforceAvailability = !isManual;
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
        // Every hold of the order is released / confirmed by the one gateway log.
        attachToOrder(holdsByPackageSessionId.get(mainItem.getPackageSessionId()), mainPaymentLogId);

        List<String> childPaymentLogIds = new ArrayList<>();

        // 2. Process Remaining Packages
        for (int i = 1; i < items.size(); i++) {
            LearnerPackageSessionEnrollmentItemDTO item = items.get(i);
            log.info("Enrolling in child package session: {}", item.getPackageSessionId());

            LearnerEnrollRequestDTO childRequestDTO = mapToLegacyDTO(request, item,
                    lineAmountByPackageSessionId.getOrDefault(item.getPackageSessionId(), 0.0));
            childRequestDTO.setUser(enrolledUser); // Ensure same user

            Map<String, Object> childExtraData = new HashMap<>();
            childExtraData.put("SKIP_PAYMENT_INITIATION", true);
            childExtraData.put("PARENT_PAYMENT_LOG_ID", mainPaymentLogId);
            if (enforceAvailability) {
                childExtraData.put(LearnerEnrollRequestService.ENFORCE_INVITE_AVAILABILITY, true);
            }
            putLineExtraData(childExtraData, item, isManual, holdsByPackageSessionId);

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
            attachToOrder(holdsByPackageSessionId.get(item.getPackageSessionId()), mainPaymentLogId);
        }

        // 3. Link Child Logs to Main Log
        if (!childPaymentLogIds.isEmpty()) {
            log.info("Linking {} child payment logs to main log {}", childPaymentLogIds.size(), mainPaymentLogId);
            paymentLogService.addChildLogsToPayment(mainPaymentLogId, childPaymentLogIds);
        }

        // 3.1 The gateway log records only the main item's own line from now on; the order
        // total it charges moves to payment_specific_data.order_total.
        if (items.size() > 1 && !isSkipPayment) {
            recordGatewayLogShare(mainPaymentLogId, mainLineAmount, paymentInit.getAmount());
        }

        // 3.2 An admin who assigned books from a level the learner had rent picks in (e.g.
        // "Rent Books") chose instead of those picks: release the picks they did not take.
        if (isManual && enrolledUser != null && StringUtils.hasText(enrolledUser.getId())) {
            List<String> assignedPackageSessionIds = items.stream()
                    .map(LearnerPackageSessionEnrollmentItemDTO::getPackageSessionId)
                    .toList();
            stockHoldService.releaseUnclaimedRentPreferences(
                    enrolledUser.getId(), orderInstituteId, assignedPackageSessionIds);
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
     * falls back to base prices. Each item counts unit price × its quantity.
     */
    private RegionalOrderPrice resolveRegionalTotal(List<LearnerPackageSessionEnrollmentItemDTO> items,
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

    private RegionalOrderPrice resolveRegionalTotalOrThrow(List<LearnerPackageSessionEnrollmentItemDTO> items,
                                                           PaymentInitiationRequestDTO paymentInit) {
        String currency = null;
        double total = 0.0;
        boolean anyRegional = false;
        boolean mixed = false;
        Map<String, Double> unitPriceByPackageSessionId = new HashMap<>();
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
            double unitPrice = quote.get().actualPrice().doubleValue();
            total += lineTotal(unitPrice, item.getRequestedQuantity());
            unitPriceByPackageSessionId.put(item.getPackageSessionId(), unitPrice);
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
        return new RegionalOrderPrice(total, unitPriceByPackageSessionId);
    }

    /**
     * Unit price × quantity, rounded to the paisa / cent. Quantity 1 (and null) returns the unit
     * price untouched, so single-copy orders price exactly as before.
     */
    private static double lineTotal(double unitPrice, Integer quantity) {
        int copies = quantity != null && quantity > 0 ? quantity : 1;
        return copies == 1 ? unitPrice : Math.round(unitPrice * copies * 100.0) / 100.0;
    }

    /**
     * Normalises and checks each item's quantity: null becomes 1; it must be at least 1; the same
     * package session may appear only once (two lines would be two plans for one title — send a
     * quantity); and above 1 only on a one-time item that is not a charge (shipping / deposit).
     * A subscription is one membership, not copies.
     */
    private void validateQuantities(List<LearnerPackageSessionEnrollmentItemDTO> items) {
        Set<String> seen = new HashSet<>();
        for (LearnerPackageSessionEnrollmentItemDTO item : items) {
            if (!StringUtils.hasText(item.getPackageSessionId())) {
                throw new InvalidRequestException("Each enrollment item must include a package_session_id");
            }
            if (!seen.add(item.getPackageSessionId())) {
                throw new InvalidRequestException("The same item appears more than once in this order. "
                        + "Send it once with a requested_quantity instead.");
            }
            Integer quantity = item.getRequestedQuantity();
            if (quantity == null) {
                item.setRequestedQuantity(1);
                continue;
            }
            if (quantity < 1) {
                throw new InvalidRequestException("requested_quantity must be at least 1");
            }
            if (quantity > 1 && !allowsQuantity(item)) {
                throw new InvalidRequestException(
                        "Only one-time purchases can be bought in a quantity above 1");
            }
        }
    }

    private boolean allowsQuantity(LearnerPackageSessionEnrollmentItemDTO item) {
        String optionType = null;
        if (StringUtils.hasText(item.getPaymentOptionId())) {
            vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption option =
                    paymentOptionService.findById(item.getPaymentOptionId());
            optionType = option != null ? option.getType() : null;
        } else if (StringUtils.hasText(item.getPlanId())) {
            optionType = paymentPlanService.findById(item.getPlanId())
                    .map(PaymentPlan::getPaymentOption)
                    .map(vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption::getType)
                    .orElse(null);
        }
        return PaymentOptionType.ONE_TIME.name().equals(optionType)
                && !repeatPurchasePolicyService.isChargePackageSession(item.getPackageSessionId());
    }

    /**
     * Each item's line total, keyed by package session (unique per order): the regional unit
     * price when the order is regionally priced, else the plan's base price, × quantity. An
     * item without a plan (free option) is 0.
     */
    private Map<String, Double> lineAmounts(List<LearnerPackageSessionEnrollmentItemDTO> items,
                                            RegionalOrderPrice regionalPrice) {
        Map<String, Double> lineAmounts = new HashMap<>();
        for (LearnerPackageSessionEnrollmentItemDTO item : items) {
            Double unitPrice = regionalPrice != null
                    ? regionalPrice.unitPriceByPackageSessionId().get(item.getPackageSessionId())
                    : null;
            if (unitPrice == null) {
                unitPrice = StringUtils.hasText(item.getPlanId())
                        ? paymentPlanService.findById(item.getPlanId()).map(PaymentPlan::getActualPrice).orElse(0.0)
                        : 0.0;
            }
            lineAmounts.put(item.getPackageSessionId(), lineTotal(unitPrice, item.getRequestedQuantity()));
        }
        return lineAmounts;
    }

    /**
     * The institute the order belongs to: the main item's invite's (LearnerEnrollRequestService
     * enrolls into that institute whatever the request says), else the request's.
     */
    private String resolveOrderInstituteId(MultiPackageLearnerEnrollRequestDTO request,
                                           LearnerPackageSessionEnrollmentItemDTO mainItem) {
        if (StringUtils.hasText(mainItem.getEnrollInviteId())) {
            String inviteInstituteId = enrollInviteRepository.findById(mainItem.getEnrollInviteId())
                    .map(EnrollInvite::getInstituteId)
                    .orElse(null);
            if (StringUtils.hasText(inviteInstituteId)) {
                return inviteInstituteId;
            }
        }
        return request.getInstituteId();
    }

    /** One PURCHASE hold call for every item of the order; the held rows grouped by package session. */
    private Map<String, List<StockHold>> holdOrderStock(String instituteId,
                                                         List<LearnerPackageSessionEnrollmentItemDTO> items) {
        Map<String, Integer> quantityByPackageSessionId = new LinkedHashMap<>();
        for (LearnerPackageSessionEnrollmentItemDTO item : items) {
            quantityByPackageSessionId.merge(item.getPackageSessionId(), item.getRequestedQuantity(), Integer::sum);
        }
        Map<String, List<StockHold>> holdsByPackageSessionId = new HashMap<>();
        for (StockHold hold : stockHoldService.hold(instituteId, quantityByPackageSessionId, StockHoldKind.PURCHASE)) {
            holdsByPackageSessionId.computeIfAbsent(hold.getPackageSessionId(), k -> new ArrayList<>()).add(hold);
        }
        return holdsByPackageSessionId;
    }

    /**
     * Per-line extraData for LearnerEnrollRequestService: the copies on the line, and — for a
     * storefront order, which held stock for every item above — that the item must not hold
     * again, plus its holds to link to its plan.
     */
    private static void putLineExtraData(Map<String, Object> extraData, LearnerPackageSessionEnrollmentItemDTO item,
                                         boolean isManual, Map<String, List<StockHold>> holdsByPackageSessionId) {
        extraData.put(LearnerEnrollRequestService.LINE_QUANTITY, item.getRequestedQuantity());
        if (!isManual) {
            extraData.put(LearnerEnrollRequestService.STOCK_HELD_BY_ORDER, true);
            List<StockHold> holds = holdsByPackageSessionId.get(item.getPackageSessionId());
            if (holds != null && !holds.isEmpty()) {
                extraData.put(LearnerEnrollRequestService.STOCK_HOLDS, holds);
            }
        }
    }

    private void attachToOrder(List<StockHold> holds, String orderPaymentLogId) {
        if (holds != null && !holds.isEmpty()) {
            stockHoldService.attach(holds, null, null, orderPaymentLogId);
        }
    }

    /**
     * A multi-item order's gateway log charged the whole order but is one line of it: record
     * its own line total as its amount (so the order's logs sum to what was paid, as the child
     * logs already record theirs) and keep the charged total in
     * {@code payment_specific_data.order_total}, which receipts and workflows read
     * (PaymentLogService). Existing keys (childPaymentLogIds, the gateway's data) are kept.
     *
     * <p>A log that is already PAID — instant gateways settle and activate inside the main
     * enrolment — is left exactly as today, and so is one whose payment_specific_data can't be
     * read, rather than losing what it holds.
     */
    @SuppressWarnings("unchecked")
    private void recordGatewayLogShare(String mainPaymentLogId, double mainLineAmount, Double orderTotal) {
        PaymentLog mainLog = paymentLogRepository.findById(mainPaymentLogId).orElse(null);
        if (mainLog == null || PaymentStatusEnum.PAID.name().equals(mainLog.getPaymentStatus())) {
            return;
        }
        Map<String, Object> data = new HashMap<>();
        if (StringUtils.hasText(mainLog.getPaymentSpecificData())) {
            Map<String, Object> existing = JsonUtil.fromJson(mainLog.getPaymentSpecificData(), Map.class);
            if (existing == null) {
                log.warn("Payment log {} has unreadable payment_specific_data; keeping the order total as its amount",
                        mainPaymentLogId);
                return;
            }
            data.putAll(existing);
        }
        Double chargedTotal = mainLog.getPaymentAmount() != null ? mainLog.getPaymentAmount() : orderTotal;
        if (chargedTotal == null) {
            return;
        }
        data.put("order_total", chargedTotal);
        mainLog.setPaymentSpecificData(JsonUtil.toJson(data));
        mainLog.setPaymentAmount(mainLineAmount);
        paymentLogRepository.save(mainLog);
        log.info("Gateway log {} now records its own line {} of order total {}",
                mainPaymentLogId, mainLineAmount, chargedTotal);
    }

    private LearnerEnrollRequestDTO mapToLegacyDTO(MultiPackageLearnerEnrollRequestDTO request,
            LearnerPackageSessionEnrollmentItemDTO item, double lineAmount) {
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
            // This item's own line total: its user_plan's ledger debit and, for a child, its
            // payment log. The main item's gateway charge is overridden to the order total
            // (OVERRIDE_TOTAL_AMOUNT).
            newInit.setAmount(lineAmount);
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
