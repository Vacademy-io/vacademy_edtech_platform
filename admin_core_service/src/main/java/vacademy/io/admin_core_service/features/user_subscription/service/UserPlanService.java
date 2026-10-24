package vacademy.io.admin_core_service.features.user_subscription.service;

import org.springframework.transaction.annotation.Transactional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalQuote;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceLock;
import vacademy.io.admin_core_service.features.enroll_invite.enums.EnrollInviteTag;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.enroll_invite.service.PackageSessionEnrollInviteToPaymentOptionService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption; // Added
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionSourceEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionTypeEnum;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.dto.policy.EnrollmentPolicyJsonDTOs;
import vacademy.io.common.institute.entity.session.PackageSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerBatchEnrollService;
import vacademy.io.admin_core_service.features.notification.enums.NotificationEventType;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.user_subscription.dto.*;
import vacademy.io.admin_core_service.features.user_subscription.entity.*;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanSourceEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.ReferralMappingService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.core.standard_classes.ListService;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;

import java.sql.Timestamp;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.Locale;

@Service
public class UserPlanService {

    private static final Logger logger = LoggerFactory.getLogger(UserPlanService.class);

    @Autowired
    private vacademy.io.admin_core_service.features.fee_management.service.FeeBillCancellationService feeBillCancellationService;

    @Autowired
    private UserPlanRepository userPlanRepository;

    @Autowired
    private PackageSessionEnrollInviteToPaymentOptionService packageSessionEnrollInviteToPaymentOptionService;

    @Autowired
    private vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository studentSessionInstituteGroupMappingRepository;

    @Autowired
    @Lazy
    public LearnerBatchEnrollService learnerBatchEnrollService;

    @Autowired
    private PaymentLogRepository paymentLogRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.enroll_invite.service.PhoneIdentifierInviteSubmissionGuard phoneIdentifierInviteSubmissionGuard;
    @Autowired
    private DynamicNotificationService dynamicNotificationService;

    @Autowired
    private AuthService authService;

    @Autowired
    private vacademy.io.admin_core_service.features.auth_service.service.AsyncEnrollmentEmailService asyncEnrollmentEmailService;

    @Autowired
    private StudentSessionRepository studentSessionRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.institute.repository.InstituteRepository instituteRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService instituteSettingService;

    @Autowired
    private PackageSessionLearnerInvitationToPaymentOptionRepository packageSessionLearnerInvitationRepository;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    @Lazy
    private ReferralMappingService referralMappingService;

    @Autowired
    @Lazy
    private vacademy.io.admin_core_service.features.suborg.service.SubOrgSubscriptionService subOrgSubscriptionService;

    @Autowired
    @Lazy
    private vacademy.io.admin_core_service.features.suborg.service.SubOrgPartnerOnboardingService subOrgPartnerOnboardingService;

    @Autowired
    private vacademy.io.admin_core_service.features.suborg.registration.repository.SubOrgRegistrationRepository subOrgRegistrationRepository;

    @Autowired
    @Lazy
    private vacademy.io.admin_core_service.features.packages.service.PackageSessionService packageSessionService;

    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository paymentPlanRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService workflowTriggerService;

    /**
     * @Lazy breaks a startup cycle: PlanChangeService needs PaymentService to open an
     * upgrade checkout, and PaymentService needs this service back.
     */
    @Autowired
    @Lazy
    private vacademy.io.admin_core_service.features.plan_change.service.PlanChangeService planChangeService;

    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponRedemptionService couponRedemptionService;

    @Autowired
    private vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService userAccountLedgerService;

    @Autowired
    private UserInstitutePaymentGatewayMappingService mandateService;

    public UserPlan createUserPlan(String userId,
            PaymentPlan paymentPlan,
            AppliedCouponDiscount appliedCouponDiscount,
            EnrollInvite enrollInvite,
            PaymentOption paymentOption,
            PaymentInitiationRequestDTO paymentInitiationRequestDTO,
            String status) {
        return createUserPlan(userId, paymentPlan, appliedCouponDiscount, enrollInvite,
                paymentOption, paymentInitiationRequestDTO, status, null, null, null);
    }

    /**
     * Overlays autopay / free-trial state onto a freshly created subscription
     * UserPlan (P3). Call this right after createUserPlan for paid subscription
     * enrollments when autopay is enabled. Safe no-op when autopay is off, so it
     * can be called unconditionally.
     *
     * <ul>
     *   <li>Marks the plan for the auto-charge scheduler (auto_renewal_enabled).</li>
     *   <li>Trial (trialDays &gt; 0): access now, NO first charge; end_date and
     *       next_charge_at = now + trialDays. The FIRST real debit happens on
     *       the trial-end date via RenewalChargeService.</li>
     *   <li>No trial: next_charge_at = end_date (already set to start+validity by
     *       createUserPlan), so the first renewal fires at the end of cycle 1.</li>
     * </ul>
     *
     * The mandate itself is registered by the payment step (initiateMandatePayment
     * / the gateway checkout) and persisted from the webhook — this method only
     * sets the plan's scheduler state.
     */
    /**
     * Reads the invite's AUTOPAY_SETTING (setting_json.setting.AUTOPAY_SETTING)
     * and, for a SUBSCRIPTION plan, applies autopay + trial. Central hook so
     * every enrollment entry point (school, direct, product page, applicant,
     * bulk, learner-request) gets consistent autopay behaviour via createUserPlan.
     */
    private void applyAutopayFromInvite(UserPlan userPlan, EnrollInvite enrollInvite, PaymentOption paymentOption) {
        if (userPlan == null || enrollInvite == null || paymentOption == null) {
            return;
        }
        if (!vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType.SUBSCRIPTION
                .name().equalsIgnoreCase(paymentOption.getType())) {
            return;
        }
        String settingJson = enrollInvite.getSettingJson();
        if (settingJson == null || settingJson.isBlank()) {
            return;
        }
        try {
            com.fasterxml.jackson.databind.JsonNode ap = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(settingJson).path("setting").path("AUTOPAY_SETTING");
            if (ap.path("ENABLED").asBoolean(false)) {
                Integer trialDays = ap.has("TRIAL_DAYS") ? ap.get("TRIAL_DAYS").asInt(0) : null;
                // One free trial per learner per institute. Someone who already had one and
                // comes back through the invite form enrolls as a paying member: no trial
                // window, and SubscriptionPaymentOptionOperation then charges the plan price
                // at checkout instead of the Rs 1 mandate authorisation, because that branch
                // keys off is_trial. Nothing else has to know about the rule.
                if (trialDays != null && trialDays > 0 && hasConsumedTrial(userPlan, enrollInvite)) {
                    logger.info("UserPlan {}: learner {} already used their trial at institute {} — "
                            + "enrolling as a paying member, full price at checkout",
                            userPlan.getId(), userPlan.getUserId(), enrollInvite.getInstituteId());
                    trialDays = 0;
                }
                // Optional: hold the trial clock until the day the programme actually
                // starts (e.g. "MONDAY" for an institute whose classes begin on Mondays).
                // Absent → the trial starts at enrollment, as before.
                String trialStartsOn = ap.path("TRIAL_STARTS_ON").asText(null);
                String trialZone = ap.path("TRIAL_TIMEZONE").asText(null);
                applyAutopaySetup(userPlan, true, trialDays, trialStartsOn, trialZone);
            }
        } catch (Exception e) {
            logger.warn("Could not apply autopay for plan {}: {}", userPlan.getId(), e.getMessage());
        }
    }

    /**
     * Whether this learner has already consumed a trial at the invite's institute. Any
     * failure is treated as "no" — a lookup problem must not silently charge someone the
     * full price when the institute meant to give them a trial.
     */
    private boolean hasConsumedTrial(UserPlan userPlan, EnrollInvite enrollInvite) {
        try {
            String instituteId = enrollInvite.getInstituteId();
            java.util.Date now = new java.util.Date();
            // Where the phone number IS the identity (SuchBliss), the question is whether this
            // NUMBER has had a trial, not this account: signing up again is precisely how a
            // second free trial gets taken.
            if (phoneIdentifierInviteSubmissionGuard.usesPhoneIdentifier(instituteId)) {
                return userPlanRepository.hasConsumedTrialByPhone(
                        userPlan.getUserId(), instituteId, userPlan.getId(), now);
            }
            return userPlanRepository.hasConsumedTrialAtInstitute(
                    userPlan.getUserId(), instituteId, userPlan.getId(), now);
        } catch (Exception e) {
            logger.warn("Could not check trial history for user {}: {}", userPlan.getUserId(), e.getMessage());
            return false;
        }
    }

    @Transactional
    public void applyAutopaySetup(UserPlan userPlan, boolean autopayEnabled, Integer trialDays) {
        applyAutopaySetup(userPlan, autopayEnabled, trialDays, null, null);
    }

    /**
     * As above, but the free trial can be anchored to the weekday the programme
     * actually starts instead of the moment of enrollment.
     *
     * <p>A learner who signs up on Wednesday for a course whose classes begin on
     * Monday would otherwise be charged 14 days later — having attended only nine
     * days of classes. With {@code trialStartsOn=MONDAY} the clock starts on the
     * first class day, so the trial is 14 days of the actual programme.</p>
     *
     * <p>Deliberately shares {@link WorkflowDateUtil#nextOccurrence} with the DELAY
     * node and the {@code #dates} SpEL helper — the same call that decides when the
     * drip's day-1 message goes out and what the welcome message names as the start
     * date. Billing and messaging therefore cannot drift apart. Strictly-next applies:
     * enrolling on a Monday anchors to the following Monday, because that is when the
     * learner's first class runs.</p>
     *
     * @param trialStartsOn day-of-week name ("MONDAY"), or null to start immediately
     * @param timezone      zone the weekday is evaluated in; null uses the server zone
     */
    @Transactional
    public void applyAutopaySetup(UserPlan userPlan, boolean autopayEnabled, Integer trialDays,
            String trialStartsOn, String timezone) {
        if (userPlan == null || !autopayEnabled) {
            return;
        }
        userPlan.setAutoRenewalEnabled(true);

        if (trialDays != null && trialDays > 0) {
            java.util.Calendar c = java.util.Calendar.getInstance();
            java.time.ZonedDateTime trialStart = resolveTrialStart(trialStartsOn, timezone);
            if (trialStart != null) {
                c.setTimeInMillis(trialStart.toInstant().toEpochMilli());
            }
            c.add(java.util.Calendar.DAY_OF_MONTH, trialDays);
            java.util.Date trialEnd = new java.sql.Timestamp(c.getTimeInMillis());
            userPlan.setIsTrial(true);
            userPlan.setEndDate(trialEnd);
            userPlan.setNextChargeAt(trialEnd);
        } else {
            userPlan.setIsTrial(false);
            userPlan.setNextChargeAt(userPlan.getEndDate());
        }
        userPlan.setRenewalAttemptCount(0);
        userPlanRepository.save(userPlan);
        logger.info("Autopay set on UserPlan {} (trialDays={}, trialStartsOn={}, nextChargeAt={})",
                userPlan.getId(), trialDays, trialStartsOn, userPlan.getNextChargeAt());
    }

    /**
     * Start-of-day on the next {@code trialStartsOn} weekday, or null when the trial
     * should start immediately. Resolution (including the tolerance for a malformed
     * weekday or zone, which must never block an enrollment) lives in
     * {@link vacademy.io.admin_core_service.features.user_subscription.util.TrialStartResolver}
     * so the announced start date is computed the same way.
     */
    private java.time.ZonedDateTime resolveTrialStart(String trialStartsOn, String timezone) {
        java.time.ZonedDateTime start = vacademy.io.admin_core_service.features.user_subscription.util.TrialStartResolver
                .resolveStart(trialStartsOn, timezone);
        if (start == null && trialStartsOn != null && !trialStartsOn.isBlank()) {
            logger.warn("Ignoring TRIAL_STARTS_ON='{}' — not a weekday name; trial starts now", trialStartsOn);
        }
        return start;
    }

    @Transactional
    public UserPlan createUserPlan(String userId,
            PaymentPlan paymentPlan,
            AppliedCouponDiscount appliedCouponDiscount,
            EnrollInvite enrollInvite,
            PaymentOption paymentOption,
            PaymentInitiationRequestDTO paymentInitiationRequestDTO,
            String status,
            String source,
            String subOrgId,
            Date startDate) {
        return createUserPlan(userId, paymentPlan, appliedCouponDiscount, enrollInvite, paymentOption,
                paymentInitiationRequestDTO, status, source, subOrgId, startDate, null);
    }

    /**
     * @param regionalQuote the viewer's regional price, resolved by a learner checkout
     *                      (RegionalPriceResolver). When present it is locked onto the UserPlan
     *                      so this and every later charge use it. Admin-side callers pass null.
     */
    @Transactional
    public UserPlan createUserPlan(String userId,
            PaymentPlan paymentPlan,
            AppliedCouponDiscount appliedCouponDiscount,
            EnrollInvite enrollInvite,
            PaymentOption paymentOption,
            PaymentInitiationRequestDTO paymentInitiationRequestDTO,
            String status,
            String source,
            String subOrgId,
            Date startDate,
            RegionalQuote regionalQuote) {
        logger.info("Creating UserPlan for userId={}, status={}, source={}, subOrgId={}",
                userId, status, source, subOrgId);

        UserPlan userPlan = new UserPlan();
        userPlan.setStatus(status);
        RegionalPriceLock.apply(userPlan, regionalQuote);

        // ALWAYS set userId - this is preserved for both USER and SUB_ORG sources
        // For SUB_ORG: userId represents the individual learner in the sub-organization
        // For USER: userId represents the individual user themselves
        userPlan.setUserId(userId);
        logger.debug("UserPlan userId set to: {}", userId);

        // Set source and sub_org_id if provided
        if (source != null) {
            userPlan.setSource(source);
            logger.debug("UserPlan source set to: {}", source);
        } else {
            // Default to USER if not specified
            userPlan.setSource(UserPlanSourceEnum.USER.name());
            logger.debug("UserPlan source defaulted to: USER");
        }

        // For SUB_ORG source, subOrgId must be provided
        if (subOrgId != null) {
            userPlan.setSubOrgId(subOrgId);
            logger.debug("UserPlan subOrgId set to: {}", subOrgId);

            // Additional validation: if source is SUB_ORG, subOrgId should be present
            if (UserPlanSourceEnum.SUB_ORG.name().equals(userPlan.getSource())) {
                logger.info("Creating SUB_ORG UserPlan: userId={}, subOrgId={} - Both IDs preserved for data integrity",
                        userId, subOrgId);
            }
        } else if (source != null && UserPlanSourceEnum.SUB_ORG.name().equals(source)) {
            // Warning: SUB_ORG source without subOrgId
            logger.warn("Creating SUB_ORG UserPlan without subOrgId for userId={} - This may indicate a data issue",
                    userId);
        }
        setPaymentPlan(userPlan, paymentPlan);
        setAppliedCouponDiscount(userPlan, appliedCouponDiscount);
        setEnrollInvite(userPlan, enrollInvite);
        setPaymentOption(userPlan, paymentOption);

        // --- Logic to calculate and set Start and End Dates ---
        // --- Date Logic with Timestamp ---

        // Check for existing ACTIVE or PENDING plans for stacking
        Optional<UserPlan> existingPlan = Optional.empty();

        if (enrollInvite != null) {
            existingPlan = userPlanRepository
                    .findTopByUserIdAndEnrollInviteIdAndStatusInOrderByEndDateDesc(
                            userId,
                            enrollInvite.getId(),
                            List.of(UserPlanStatusEnum.ACTIVE.name(), UserPlanStatusEnum.PENDING.name()));
        }

        // Filter out plans that only have ABANDONED_CART entries (unverified
        // enrollments)
        // These should not be considered for stacking as the user never completed
        // verification
        if (existingPlan.isPresent() && !hasRealEnrollmentEntries(existingPlan.get())) {
            logger.info("Existing UserPlan ID={} has only ABANDONED_CART entries, ignoring for stacking",
                    existingPlan.get().getId());
            existingPlan = Optional.empty();
        }

        Date effectiveStartDate;
        if (existingPlan.isPresent()) {
            // Stack the new plan after the existing one
            effectiveStartDate = existingPlan.get().getEndDate();
            if (effectiveStartDate == null) {
                effectiveStartDate = new Date(); // Fallback
            }

            // Only change status to PENDING if it was going to be ACTIVE
            // If it's PENDING_FOR_PAYMENT, let it remain so (it will be handled in
            // applyOperationsOnFirstPayment)
            if (UserPlanStatusEnum.ACTIVE.name().equals(status)) {
                status = UserPlanStatusEnum.PENDING.name();
                userPlan.setStatus(status);
            }
            logger.info("Stacking UserPlan: Found existing plan ID={}. New plan will start at {}",
                    existingPlan.get().getId(), effectiveStartDate);
        } else {
            // No existing plan, use provided startDate or now
            effectiveStartDate = startDate;
            if (effectiveStartDate != null) {
                Date currentDate = new Date();
                if (effectiveStartDate.after(currentDate)) {
                    throw new IllegalArgumentException("Start date cannot be in the future");
                }
            } else {
                effectiveStartDate = new Date();
            }
        }

        long startTimeMillis = effectiveStartDate.getTime();
        userPlan.setStartDate(new Timestamp(startTimeMillis));

        Integer validityDays = null;
        if (paymentPlan != null && paymentPlan.getValidityInDays() != null) {
            validityDays = paymentPlan.getValidityInDays();
        } else if (enrollInvite != null && enrollInvite.getLearnerAccessDays() != null) {
            validityDays = enrollInvite.getLearnerAccessDays();
        }

        if (validityDays != null) {
            // Add days to milliseconds: days * 24 * 60 * 60 * 1000
            long validityMillis = validityDays * 24L * 60L * 60L * 1000L;
            userPlan.setEndDate(new Timestamp(startTimeMillis + validityMillis));
        }
        // -----------------------------------------------------

        String paymentJson = JsonUtil.toJson(paymentInitiationRequestDTO);
        userPlan.setJsonPaymentDetails(paymentJson);

        // Atomic redemption — runs inside the @Transactional boundary of this method.
        // A race-loss or status-flipped-mid-flight throws VacademyException and
        // rolls back the entire enrollment (no UserPlan, no orphaned references).
        if (appliedCouponDiscount != null) {
            couponRedemptionService.consume(appliedCouponDiscount);
        }

        logger.debug("Saving UserPlan with details: {}", userPlan);
        UserPlan saved = userPlanRepository.save(userPlan);
        logger.info("UserPlan created with ID={}", saved.getId());

        // Ledger: record obligation when payment is required. Accrue the amount that
        // will actually be charged (the payment-initiation amount, i.e. plan price net
        // of any coupon discount) — the same figure the gateway order and payment log
        // carry — not the plan's list price. Accruing the list price inflated Due by
        // the coupon amount on every discounted enrollment.
        //
        // CPO is deliberately excluded. A CPO plan's obligation is accrued per installment
        // by StudentFeePaymentGenerationService.generateFeeBills(), which every CPO
        // enrollment path runs; the mirror's synthetic PaymentPlan carries the TOTAL
        // contract value, so also accruing it here booked the whole fee structure twice
        // (Total Accrued and Due both showed 2x, and no payment could ever clear it).
        boolean cpoPlan = paymentOption != null
                && PaymentOptionType.CPO.name().equalsIgnoreCase(paymentOption.getType());
        if (cpoPlan) {
            logger.info("Skipping plan-level ledger accrual for CPO UserPlan ID={} — per-installment "
                    + "StudentFeePayment accruals are authoritative.", saved.getId());
        }
        if (!cpoPlan
                && UserPlanStatusEnum.PENDING_FOR_PAYMENT.name().equals(saved.getStatus())
                && paymentPlan != null && paymentPlan.getActualPrice() > 0
                && enrollInvite != null && enrollInvite.getInstituteId() != null) {
            // Regional lock: accrue in the currency and list price the learner was quoted.
            // Unlocked (every plan unless regional pricing is on): the plan's own price, as before.
            boolean regionallyPriced = RegionalPriceLock.isLocked(saved);
            double planListPrice = regionallyPriced
                    ? saved.getRegionalPrice().doubleValue()
                    : paymentPlan.getActualPrice();
            double accrualAmount = planListPrice;
            if (paymentInitiationRequestDTO != null && paymentInitiationRequestDTO.getAmount() != null
                    && paymentInitiationRequestDTO.getAmount() >= 0) {
                accrualAmount = paymentInitiationRequestDTO.getAmount();
            }
            if (accrualAmount > 0) {
                // Discounted enrollment: carry the pricing breakdown on the ledger row
                // (gross list price + discount, amount = net) so the side-view
                // Transaction History can render "gross struck through → net", and name
                // the coupon in the remark.
                double listPrice = planListPrice;
                String accrualRemark = "Plan enrollment payment required";
                java.math.BigDecimal grossAmount = null;
                java.math.BigDecimal discountAmount = null;
                if (accrualAmount < listPrice) {
                    grossAmount = java.math.BigDecimal.valueOf(listPrice);
                    discountAmount = java.math.BigDecimal.valueOf(listPrice - accrualAmount);
                    String discountLabel = appliedCouponDiscount != null
                            && StringUtils.hasText(appliedCouponDiscount.getName())
                                    ? "coupon " + appliedCouponDiscount.getName()
                                    : "discount";
                    accrualRemark = String.format(
                            "Plan enrollment payment required (%s applied)", discountLabel);
                }
                userAccountLedgerService.recordDebitAccrual(
                        userId, enrollInvite.getInstituteId(),
                        java.math.BigDecimal.valueOf(accrualAmount),
                        regionallyPriced
                                ? saved.getRegionalCurrency()
                                : (paymentPlan.getCurrency() != null ? paymentPlan.getCurrency() : "INR"),
                        null,
                        "USER_PLAN", saved.getId(),
                        null, accrualRemark,
                        grossAmount, discountAmount);
            }
        }

        // Autopay (centralized for ALL enrollment entry points): SUBSCRIPTION plans
        // whose invite enabled AUTOPAY_SETTING opt into auto-renewal + free trial.
        applyAutopayFromInvite(saved, enrollInvite, paymentOption);

        // If a prior plan was detected and we stacked onto it, this is a
        // re-enrolment — fire the LEARNER_RE_ENROLLMENT trigger so the admin
        // team can welcome them back / send onboarding refresh / etc.
        // Distinct from LEARNER_BATCH_ENROLLMENT (which fires for the very
        // first enrolment via StudentRegistrationManager).
        if (existingPlan.isPresent() && enrollInvite != null
                && enrollInvite.getInstituteId() != null
                && !enrollInvite.getInstituteId().isBlank()) {
            try {
                Map<String, Object> ctx = new HashMap<>();
                ctx.put("userPlanId", saved.getId());
                ctx.put("previousUserPlanId", existingPlan.get().getId());
                ctx.put("userId", userId);
                ctx.put("enrollInviteId", enrollInvite.getId());
                ctx.put("paymentPlanId", paymentPlan != null ? paymentPlan.getId() : null);
                ctx.put("startDate", saved.getStartDate() != null ? saved.getStartDate().toString() : null);
                ctx.put("endDate", saved.getEndDate() != null ? saved.getEndDate().toString() : null);
                workflowTriggerService.handleTriggerEvents(
                        vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent.LEARNER_RE_ENROLLMENT.name(),
                        enrollInvite.getId(),
                        enrollInvite.getInstituteId(),
                        ctx);
            } catch (Exception wfe) {
                logger.warn("Failed to trigger LEARNER_RE_ENROLLMENT for plan {}: {}",
                        saved.getId(), wfe.getMessage());
            }
        }

        return saved;
    }

    /**
     * Checks if a UserPlan has any real (verified) enrollment entries.
     * Returns false if the UserPlan only has ABANDONED_CART or PAYMENT_FAILED
     * entries,
     * which represent unverified/failed enrollments that shouldn't count for
     * stacking.
     *
     * @param userPlan The UserPlan to check
     * @return true if the plan has at least one real (PACKAGE_SESSION type) ACTIVE
     *         entry
     */
    private boolean hasRealEnrollmentEntries(UserPlan userPlan) {
        if (userPlan == null || userPlan.getId() == null) {
            return false;
        }

        List<StudentSessionInstituteGroupMapping> entries = studentSessionRepository
                .findAllByUserPlanIdAndStatusIn(userPlan.getId(),
                        List.of("ACTIVE", "INVITED", "EXPIRED", "TERMINATED", "INACTIVE"));

        // Check if any entry is NOT ABANDONED_CART and NOT PAYMENT_FAILED
        for (StudentSessionInstituteGroupMapping entry : entries) {
            String type = entry.getType();
            if (type == null ||
                    (!"ABANDONED_CART".equalsIgnoreCase(type) && !"PAYMENT_FAILED".equalsIgnoreCase(type))) {
                // Found a real entry (PACKAGE_SESSION or null type which is default)
                return true;
            }
        }

        // All entries are ABANDONED_CART or PAYMENT_FAILED
        return false;
    }

    private void setPaymentPlan(UserPlan userPlan, PaymentPlan plan) {
        if (plan != null) {
            userPlan.setPaymentPlan(plan);
            userPlan.setPaymentPlanId(plan.getId());
            userPlan.setPlanJson(JsonUtil.toJson(plan));
            logger.debug("Attached PaymentPlan ID={} to UserPlan", plan.getId());
        }
    }

    private void setAppliedCouponDiscount(UserPlan userPlan, AppliedCouponDiscount discount) {
        if (discount != null) {
            userPlan.setAppliedCouponDiscount(discount);
            userPlan.setAppliedCouponDiscountId(discount.getId());
            userPlan.setAppliedCouponDiscountJson(JsonUtil.toJson(discount));
            logger.debug("Attached AppliedCouponDiscount ID={} to UserPlan", discount.getId());
        }
    }

    private void setEnrollInvite(UserPlan userPlan, EnrollInvite invite) {
        if (invite != null) {
            userPlan.setEnrollInvite(invite);
            userPlan.setEnrollInviteId(invite.getId());
            logger.debug("Attached EnrollInvite ID={} to UserPlan", invite.getId());
        }
    }

    private void setPaymentOption(UserPlan userPlan, PaymentOption option) {
        if (option != null) {
            userPlan.setPaymentOption(option);
            userPlan.setPaymentOptionId(option.getId());
            userPlan.setPaymentOptionJson(JsonUtil.toJson(option));
            logger.debug("Attached PaymentOption ID={} to UserPlan", option.getId());
        }
    }

    /**
     * Transaction-scoped claim on the credential email, so ONE checkout sends ONE.
     *
     * A multi-course order activates a UserPlan per course inside a single webhook
     * transaction, and each activation reached the credential mail — a learner who
     * bought four subjects got four identical "Course Enrollment" emails seconds
     * apart. Identical is the point: that mail is
     * createLearnerEnrollmentNewUserEmailBody(institute, name, username, password,
     * loginUrl, theme), which takes no course at all, so the copies carried nothing
     * the first one did not. The learner has one set of credentials.
     *
     * Deliberately NOT done by folding the enrollment WORKFLOW: LEARNER_BATCH_ENROLLMENT
     * triggers are matched per package session, and one institute has 16 of them
     * driving Moodle and LearnDash provisioning. Coalescing there would enrol a
     * four-course learner into one course downstream.
     *
     * Scoped to the transaction because that is exactly one checkout, and released
     * on completion — this thread is pooled, and a resource left bound would
     * swallow the NEXT learner's credentials. With no transaction active there is
     * nothing to coalesce, so the mail goes out as before.
     *
     * @return true when this caller owns the send
     */
    // Visible for testing.
    boolean claimCredentialEmail(String userId, String instituteId) {
        if (!org.springframework.transaction.support.TransactionSynchronizationManager
                .isSynchronizationActive()) {
            return true;
        }
        final String key = "credentialEmailSent:" + instituteId + '|' + userId;
        if (org.springframework.transaction.support.TransactionSynchronizationManager
                .hasResource(key)) {
            logger.info("Credential email already claimed for userId={} in this checkout; "
                    + "not sending a duplicate.", userId);
            return false;
        }
        // Register BEFORE binding. registerSynchronization is the call that can
        // throw here, and a resource bound with no synchronization to release it
        // would leak onto this pooled thread — silently swallowing the credentials
        // of every later learner it serves.
        org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                new org.springframework.transaction.support.TransactionSynchronization() {
                    @Override
                    public void afterCompletion(int status) {
                        if (org.springframework.transaction.support.TransactionSynchronizationManager
                                .hasResource(key)) {
                            org.springframework.transaction.support.TransactionSynchronizationManager
                                    .unbindResourceIfPossible(key);
                        }
                    }
                });
        org.springframework.transaction.support.TransactionSynchronizationManager
                .bindResource(key, Boolean.TRUE);
        return true;
    }

    /**
     * Makes sure an already-ACTIVE plan actually has the enrollment its learner paid for.
     *
     * <p>Idempotent by construction: it does nothing when an ACTIVE membership already exists
     * for the invite's package sessions, and otherwise performs the same INVITED -> ACTIVE
     * shift the normal first-payment path performs. Safe to run on every payment for an
     * ACTIVE plan, which is the point — the alternative is trusting that the plan's status
     * tells you whether the learner is enrolled, and it does not.
     *
     * <p>Never throws: a payment must not fail because the enrollment repair did.
     */
    public void ensureEnrollmentExists(UserPlan userPlan) {
        try {
            EnrollInvite enrollInvite = userPlan.getEnrollInvite();
            if (enrollInvite == null) {
                return;
            }
            List<String> packageSessionIds = packageSessionEnrollInviteToPaymentOptionService
                    .findPackageSessionsOfEnrollInvite(enrollInvite);
            if (packageSessionIds == null || packageSessionIds.isEmpty()) {
                return;
            }
            if (studentSessionInstituteGroupMappingRepository
                    .existsActiveMembership(userPlan.getUserId(), packageSessionIds)) {
                return;
            }
            logger.warn("UserPlan {} is ACTIVE but its learner {} holds no ACTIVE membership in {} — "
                    + "enrolling now", userPlan.getId(), userPlan.getUserId(), packageSessionIds);
            int shifted = learnerBatchEnrollService.shiftLearnerFromInvitedToActivePackageSessions(
                    packageSessionIds, userPlan.getUserId(), enrollInvite.getId(), userPlan.getId());
            if (shifted == 0) {
                // The shift only PROMOTES rows that already sit in INVITED or ABANDONED_CART. A
                // learner whose trial ran and was revoked has neither, so this repair used to
                // shift nothing and return as though the enrollment now existed — the exact
                // silent no-op it was written to prevent. Revive their lapsed row instead.
                logger.warn("Nothing to shift for plan {} — reviving the learner's lapsed enrollment",
                        userPlan.getId());
                learnerBatchEnrollService.reviveLapsedEnrollment(
                        packageSessionIds, userPlan.getUserId(), userPlan);
            }
        } catch (Exception e) {
            logger.error("Could not verify or repair the enrollment for plan {}", userPlan.getId(), e);
        }
    }

    public void applyOperationsOnFirstPayment(UserPlan userPlan) {
        logger.info("Applying operations on first payment for UserPlan ID={}", userPlan.getId());

        if (UserPlanStatusEnum.ACTIVE.name().equals(userPlan.getStatus())) {
            // Already ACTIVE does NOT mean already enrolled. Nitika Maheshwari's annual plan
            // reached ACTIVE through the RENEWAL path — handleSuccessfulRenewal activates and
            // extends whichever plan the money was paid against — minutes before this method
            // ran on the very same payment, so this early return skipped the enrollment shift
            // below. Her Rs 7,200 was recorded, the plan ran to 2027, and she held no ACTIVE
            // mapping at all: a paying member in no batch, receiving no class links.
            // Re-activation is indeed not wanted here; the enrollment still has to exist.
            logger.info("UserPlan {} already ACTIVE — verifying the enrollment exists", userPlan.getId());
            ensureEnrollmentExists(userPlan);
            return;
        }
        if (UserPlanStatusEnum.PENDING.name().equals(userPlan.getStatus())) {
            // A stacked plan is enrolled when it is promoted, not now.
            logger.info("UserPlan {} is stacked (PENDING) — enrollment happens on promotion", userPlan.getId());
            return;
        }

        EnrollInvite enrollInvite = userPlan.getEnrollInvite();

        // Fix: Handle cases where EnrollInvite is null (e.g. Direct Applicant Payments)
        if (enrollInvite == null) {
            logger.info("No EnrollInvite found for UserPlan ID={}. Marking as ACTIVE without stacking logic.",
                    userPlan.getId());
            userPlan.setStatus(UserPlanStatusEnum.ACTIVE.name());
            userPlanRepository.save(userPlan);
            return;
        }

        // Check for OTHER existing ACTIVE or PENDING plans for stacking
        // We exclude the current plan ID just in case, though it shouldn't be
        // active/pending yet
        Optional<UserPlan> existingPlan = userPlanRepository
                .findTopByUserIdAndEnrollInviteIdAndStatusInAndIdNotInOrderByEndDateDesc(
                        userPlan.getUserId(),
                        enrollInvite.getId(),
                        List.of(
                                UserPlanStatusEnum.ACTIVE.name(),
                                UserPlanStatusEnum.PENDING.name()),
                        List.of(userPlan.getId()));

        List<String> packageSessionIds = packageSessionEnrollInviteToPaymentOptionService
                .findPackageSessionsOfEnrollInvite(enrollInvite);
        // If we found a plan, and it's NOT the current plan (sanity check)
        if (existingPlan.isPresent() && !existingPlan.get().getId().equals(userPlan.getId())) {
            // Stack it!
            userPlan.setStatus(UserPlanStatusEnum.PENDING.name());
            userPlanRepository.save(userPlan);
            logger.info("UserPlan stacked as PENDING after payment. ID={}. Existing plan ID={}", userPlan.getId(),
                    existingPlan.get().getId());
            // Do NOT shift learner to active package sessions yet
        } else {
            // Activate normally

            logger.debug("Package session IDs resolved for EnrollInvite ID={}: {}", enrollInvite.getId(),
                    packageSessionIds);

            // Terminate active sessions configured in enrollment policy BEFORE shifting to
            // active
            // This is for paid enrollments where termination was deferred until payment
            // confirmation
            terminateActiveSessionsAfterPayment(userPlan.getUserId(), enrollInvite.getInstituteId(), packageSessionIds);

            // Pass the plan the payment landed on so the ACTIVE mapping references THIS
            // plan — not the plan id of whatever INVITED row is being shifted (which,
            // after a failed-then-retried checkout, is the abandoned first plan).
            int shiftedOnFirstPayment = learnerBatchEnrollService
                    .shiftLearnerFromInvitedToActivePackageSessions(packageSessionIds,
                            userPlan.getUserId(), enrollInvite.getId(), userPlan.getId());
            if (shiftedOnFirstPayment == 0) {
                // The shift PROMOTES existing INVITED / ABANDONED_CART rows and creates none, so
                // zero here means this payment enrolled nobody — while everything below (inventory,
                // ACTIVE status, invoice, confirmation email) carries on as though it had.
                // Reachable whenever the row the checkout created is not reachable from this plan's
                // user: under PHONE identity the form's row can belong to a different account on
                // the same number, which is how a paid learner lands in no batch at all.
                logger.error("First payment on plan {} shifted NOTHING for user {} in {} — repairing "
                        + "the enrollment directly", userPlan.getId(), userPlan.getUserId(), packageSessionIds);
                learnerBatchEnrollService.reviveLapsedEnrollment(
                        packageSessionIds, userPlan.getUserId(), userPlan);
            }

            // Decrement inventory (available slots) for each package session THIS payment
            // activated. The invite's full mapping list is wrong here: gap validation can
            // drop sessions at checkout, and a bundle invite may map sessions the learner
            // never bought, so decrementing all of them over-counted seats.
            List<String> activatedPackageSessionIds;
            try {
                Set<String> activeOnPlan = new HashSet<>(studentSessionInstituteGroupMappingRepository
                        .findActivePackageSessionIdsByUserPlanId(userPlan.getId()));
                activatedPackageSessionIds = packageSessionIds.stream()
                        .filter(activeOnPlan::contains)
                        .toList();
            } catch (Exception e) {
                logger.warn("Could not resolve activated sessions for plan {}; skipping inventory decrement: {}",
                        userPlan.getId(), e.getMessage());
                activatedPackageSessionIds = List.of();
            }
            if (activatedPackageSessionIds.size() != packageSessionIds.size()) {
                logger.info("Plan {} activated {} of the invite's {} package sessions; decrementing only those",
                        userPlan.getId(), activatedPackageSessionIds.size(), packageSessionIds.size());
            }
            for (String psId : activatedPackageSessionIds) {
                try {
                    packageSessionService.decrementAvailability(psId, 1);
                } catch (Exception e) {
                    logger.warn("Failed to decrement inventory for packageSession {} after payment: {}",
                            psId, e.getMessage());
                    // Don't block enrollment if inventory update fails
                }
            }

            userPlan.setStatus(UserPlanStatusEnum.ACTIVE.name());
            userPlanRepository.save(userPlan);

            logger.info("UserPlan status updated to ACTIVE and saved. ID={}", userPlan.getId());

            // Reconcile abandoned duplicate checkout attempts: earlier retries for the same
            // (user, enroll_invite) leave PENDING_FOR_PAYMENT plans whose course mappings still
            // point at them. Now that THIS attempt is the paid/active plan, move that access onto
            // it and cancel the abandoned siblings — otherwise finance/roster views (and the
            // learner's access) resolve to an unpaid plan. Scoped to SUB_ORG, the only path that
            // exhibits this retry pattern, to keep the blast radius tight.
            try {
                supersedeAbandonedSubOrgSiblings(userPlan, enrollInvite);
            } catch (Exception e) {
                logger.warn("Failed to reconcile abandoned sub-org sibling plans for paid plan {}: {}",
                        userPlan.getId(), e.getMessage());
            }

            // NOTE: the ledger CREDIT_PAYMENT used to be posted here. It has moved to
            // PaymentLogService.recordLedgerCreditForPlanPayment(), which fires on the
            // PaymentLog going PAID — the actual money event — instead of on activation.
            // This method is an activation routine and returns early when the plan is
            // already ACTIVE/PENDING, when it has no EnrollInvite, and on the stacking
            // branch; the credit sat past all three, so only the FIRST payment of a
            // still-pending plan was ever credited. Second fee installments and any other
            // charge against an already-active plan posted nothing at all.

            // Process pending referral benefits after payment confirmation
            // This sends referrer reward emails that were deferred during enrollment
            referralMappingService.processReferralBenefitsIfApplicable(userPlan);

            // B2B: For PAID SUB_ORG plans, create scoped FREE invites after payment confirmation
            if (EnrollInviteTag.SUB_ORG.name().equals(enrollInvite.getTag())
                    && enrollInvite.getSubOrgId() != null) {
                logger.info("PAID SUB_ORG plan activated. Creating scoped free invites for sub-org={}",
                        enrollInvite.getSubOrgId());
                PaymentPlan paymentPlan = null;
                if (StringUtils.hasText(userPlan.getPaymentPlanId())) {
                    paymentPlan = paymentPlanRepository.findById(userPlan.getPaymentPlanId()).orElse(null);
                }
                subOrgSubscriptionService.createScopedFreeInvites(enrollInvite, userPlan, paymentPlan);

                // Open self-registration (paid template): flip the registration row to COMPLETED
                // now that payment confirmed. Best-effort — must never break payment processing.
                try {
                    subOrgRegistrationRepository
                            .findFirstBySpawnedSubOrgIdAndStatus(enrollInvite.getSubOrgId(),
                                    vacademy.io.admin_core_service.features.suborg.registration.enums.SubOrgRegistrationStatus.PENDING_PAYMENT.name())
                            .ifPresent(reg -> {
                                reg.setStatus(vacademy.io.admin_core_service.features.suborg.registration.enums.SubOrgRegistrationStatus.COMPLETED.name());
                                subOrgRegistrationRepository.save(reg);
                                logger.info("Sub-org registration {} marked COMPLETED after payment",
                                        reg.getId());
                            });
                } catch (Exception e) {
                    logger.warn("Could not update sub-org registration status after payment: {}",
                            e.getMessage());
                }

                // Partner onboarding (opt-in per institute): affiliation certificate + welcome
                // email with credentials. This branch only runs on the FIRST activation (the
                // method returns early for an already-ACTIVE plan), so a retried webhook cannot
                // send the welcome twice. Never throws.
                subOrgPartnerOnboardingService.onPartnerActivated(
                        enrollInvite.getSubOrgId(), enrollInvite.getInstituteId(), userPlan);
            }

            // Send enrollment notifications after successful PAID enrollment

        }
        sendEnrollmentNotificationsAfterPayment(userPlan, enrollInvite, packageSessionIds);
    }

    /**
     * A sub-org admin who abandons a gateway checkout and retries accumulates duplicate
     * PENDING_FOR_PAYMENT UserPlans for the same (user, enroll_invite); the course mappings
     * created on the first attempt stay pinned to that (now abandoned) plan. When a later
     * attempt is finally paid, this moves those ACTIVE mappings onto the paid plan and cancels
     * the abandoned siblings, so the finance panel, roster, and learner access all resolve to
     * the plan that actually holds the payment. Dedupes by package session so a course already
     * covered by the paid plan never gets a duplicate mapping. Best-effort; never blocks payment.
     */
    private void supersedeAbandonedSubOrgSiblings(UserPlan paidPlan, EnrollInvite enrollInvite) {
        if (paidPlan == null || enrollInvite == null
                || !UserPlanSourceEnum.SUB_ORG.name().equals(paidPlan.getSource())
                || !StringUtils.hasText(paidPlan.getUserId())) {
            return;
        }

        List<UserPlan> siblings = userPlanRepository
                .findAllByUserIdAndEnrollInviteIdAndStatusIn(
                        paidPlan.getUserId(), enrollInvite.getId(),
                        List.of(UserPlanStatusEnum.PENDING_FOR_PAYMENT.name(),
                                UserPlanStatusEnum.PAYMENT_FAILED.name()))
                .stream()
                .filter(s -> !s.getId().equals(paidPlan.getId()))
                // Only supersede other SUB_ORG plans — never touch a plan of a different
                // source that happens to share this (user, enroll_invite).
                .filter(s -> UserPlanSourceEnum.SUB_ORG.name().equals(s.getSource()))
                .collect(Collectors.toList());
        if (siblings.isEmpty()) return;

        // Package sessions the paid plan already covers with an ACTIVE mapping — never dup these.
        Set<String> coveredPs = studentSessionRepository
                .findAllByUserPlanIdAndStatusIn(paidPlan.getId(),
                        List.of(LearnerSessionStatusEnum.ACTIVE.name()))
                .stream()
                .map(m -> m.getPackageSession() != null ? m.getPackageSession().getId() : null)
                .filter(Objects::nonNull)
                .collect(Collectors.toCollection(HashSet::new));

        for (UserPlan sibling : siblings) {
            List<StudentSessionInstituteGroupMapping> sibMaps = studentSessionRepository
                    .findAllByUserPlanIdAndStatusIn(sibling.getId(),
                            List.of(LearnerSessionStatusEnum.ACTIVE.name()));
            int moved = 0, deduped = 0;
            for (StudentSessionInstituteGroupMapping m : sibMaps) {
                String psId = m.getPackageSession() != null ? m.getPackageSession().getId() : null;
                if (psId != null && coveredPs.contains(psId)) {
                    // Paid plan already grants this course — retire the abandoned-plan duplicate.
                    m.setStatus(LearnerSessionStatusEnum.DELETED.name());
                    deduped++;
                } else {
                    // Move the access onto the plan that was actually paid.
                    m.setUserPlanId(paidPlan.getId());
                    if (psId != null) coveredPs.add(psId);
                    moved++;
                }
            }
            if (!sibMaps.isEmpty()) studentSessionRepository.saveAll(sibMaps);
            sibling.setStatus(UserPlanStatusEnum.CANCELED.name());
            userPlanRepository.save(sibling);
            logger.info("Superseded abandoned SUB_ORG sibling plan {} after payment on {} "
                    + "(mappings moved={}, deduped={})", sibling.getId(), paidPlan.getId(), moved, deduped);
        }
    }

    private void sendEnrollmentNotificationsAfterPayment(UserPlan userPlan, EnrollInvite enrollInvite,
            List<String> packageSessionIds) {
        try {
            logger.info("Sending enrollment notifications for PAID enrollment. UserPlan ID: {}", userPlan.getId());

            // Get user details
            UserDTO userDTO = authService.getUsersFromAuthServiceByUserIds(List.of(userPlan.getUserId())).get(0);

            // Get institute ID from enroll invite
            String instituteId = enrollInvite.getInstituteId();

            // Get payment option
            PaymentOption paymentOption = userPlan.getPaymentOption();

            // Get first package session ID for notification
            String firstPackageSessionId = packageSessionIds.isEmpty() ? null : packageSessionIds.get(0);

            if (firstPackageSessionId == null) {
                logger.warn("No package session ID found for UserPlan ID: {}. Skipping enrollment notification.",
                        userPlan.getId());
                return;
            }

            // Honor the COURSE_SETTING.enrollmentNotifications.{showSendCredentials,showNotifyLearners}
            // toggles that the admin display-settings page writes — the same gate bulk/v3/assign and
            // the admin "Enrol Customer" button already respect. When both are off, no enrollment
            // mail goes out at all even for paid enrollments. Default both to true for back-compat.
            boolean showSendCredentials = readCourseSettingEnrollmentFlag(instituteId, "showSendCredentials");
            boolean showNotifyLearners  = readCourseSettingEnrollmentFlag(instituteId, "showNotifyLearners");

            // Send credential email asynchronously to avoid blocking the payment webhook thread.
            // Gated by showSendCredentials so the post-payment path can't ship credentials the
            // admin disabled at the institute level.
            if (showSendCredentials && claimCredentialEmail(userDTO.getId(), instituteId)) {
                String learnerPortalUrl = resolveLearnerPortalUrl(packageSessionIds, instituteId);
                asyncEnrollmentEmailService.sendCredentialEmailForPaidEnrollment(userDTO, instituteId, learnerPortalUrl);
            } else if (!showSendCredentials) {
                logger.info("Skipping credential email after payment: COURSE_SETTING.showSendCredentials=false " +
                        "for institute {}", instituteId);
            }

            // Send dynamic enrollment notification + referral invite. Both are "learner notifications"
            // for the purposes of this gate, so they share the showNotifyLearners flag.
            if (showNotifyLearners) {
                dynamicNotificationService.sendDynamicNotification(
                        NotificationEventType.LEARNER_ENROLL,
                        firstPackageSessionId,
                        instituteId,
                        userDTO,
                        paymentOption,
                        enrollInvite);
                logger.info("Enrollment notification sent successfully for user: {}", userDTO.getId());

                dynamicNotificationService.sendReferralInvitationNotification(
                        instituteId,
                        userDTO,
                        enrollInvite);
                logger.info("Referral invitation sent successfully for user: {}", userDTO.getId());
            } else {
                logger.info("Skipping LEARNER_ENROLL + referral notification after payment: " +
                        "COURSE_SETTING.showNotifyLearners=false for institute {}", instituteId);
            }

        } catch (Exception e) {
            logger.error("Error sending enrollment notifications after payment for UserPlan ID: {}. " +
                    "Enrollment is complete but notification failed.", userPlan.getId(), e);
            // Don't throw exception - enrollment is complete, notification is secondary
        }
    }

    /**
     * Reads INSTITUTE.setting.COURSE_SETTING.data.enrollmentNotifications.{flagKey}.
     * Defaults to {@code true} when the setting block or flag is missing — matches
     * the FE DEFAULT_COURSE_SETTINGS so behavior is unchanged for institutes that
     * never touched the toggle. Failures default to true rather than false so a
     * setting-read blip can't silently swallow a payment-confirmation email.
     */
    @SuppressWarnings("unchecked")
    private boolean readCourseSettingEnrollmentFlag(String instituteId, String flagKey) {
        try {
            Object data = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, "COURSE_SETTING");
            if (!(data instanceof java.util.Map)) {
                return true;
            }
            Object enrollmentNotifications = ((java.util.Map<String, Object>) data).get("enrollmentNotifications");
            if (!(enrollmentNotifications instanceof java.util.Map)) {
                return true;
            }
            Object flag = ((java.util.Map<String, Object>) enrollmentNotifications).get(flagKey);
            return !(flag instanceof Boolean) || (Boolean) flag;
        } catch (Exception e) {
            logger.warn("Could not read COURSE_SETTING.enrollmentNotifications.{} for institute {}: {}",
                    flagKey, instituteId, e.getMessage());
            return true;
        }
    }

    /**
     * Terminates (marks as DELETED) the user's active enrollments in package
     * sessions
     * specified in the policy's terminateActiveSessions list.
     * 
     * This method is called AFTER payment confirmation for paid enrollments.
     * Use case: When user upgrades from a demo package to a paid package,
     * the demo enrollment should be automatically terminated only after payment is
     * confirmed.
     *
     * @param userId            The user ID whose sessions should be terminated
     * @param instituteId       The institute ID
     * @param packageSessionIds The package sessions the user is enrolling into (to
     *                          read their policies)
     */
    private void terminateActiveSessionsAfterPayment(String userId, String instituteId,
            List<String> packageSessionIds) {
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            return;
        }

        for (String packageSessionId : packageSessionIds) {
            try {
                PackageSession packageSession = packageSessionRepository.findById(packageSessionId).orElse(null);
                if (packageSession == null) {
                    logger.warn("Package session not found for termination check: {}", packageSessionId);
                    continue;
                }

                String policyJson = packageSession.getEnrollmentPolicySettings();
                if (policyJson == null || policyJson.isBlank()) {
                    continue;
                }

                EnrollmentPolicyJsonDTOs.EnrollmentPolicySettingsDTO policy = objectMapper.readValue(policyJson,
                        EnrollmentPolicyJsonDTOs.EnrollmentPolicySettingsDTO.class);

                if (policy == null || policy.getOnEnrollment() == null) {
                    continue;
                }

                List<String> sessionsToTerminate = policy.getOnEnrollment().getTerminateActiveSessions();
                if (sessionsToTerminate == null || sessionsToTerminate.isEmpty()) {
                    continue;
                }

                logger.info(
                        "Terminating active sessions for user {} after payment confirmation. Sessions to terminate: {}",
                        userId, sessionsToTerminate);

                // Find and terminate all matching active enrollments
                for (String sessionIdToTerminate : sessionsToTerminate) {
                    try {
                        Optional<StudentSessionInstituteGroupMapping> activeMapping = studentSessionRepository
                                .findTopByPackageSessionIdAndUserIdAndStatusIn(
                                        sessionIdToTerminate,
                                        instituteId,
                                        userId,
                                        List.of(LearnerSessionStatusEnum.ACTIVE.name(),
                                                LearnerSessionStatusEnum.INVITED.name()));

                        if (activeMapping.isPresent()) {
                            StudentSessionInstituteGroupMapping mapping = activeMapping.get();
                            mapping.setStatus(LearnerSessionStatusEnum.DELETED.name());
                            studentSessionRepository.save(mapping);
                            logger.info(
                                    "Terminated enrollment for user {} in package session {} after payment confirmation",
                                    userId, sessionIdToTerminate);
                        }
                    } catch (Exception e) {
                        logger.warn("Failed to terminate session {} for user {} after payment: {}",
                                sessionIdToTerminate, userId, e.getMessage());
                        // Continue with other sessions even if one fails
                    }
                }
            } catch (Exception e) {
                logger.error("Error processing termination policy for package session {}: {}",
                        packageSessionId, e.getMessage(), e);
                // Continue with other package sessions
            }
        }
    }

    @Cacheable(value = "userPlanWithPaymentLogs", key = "#userPlanId + '_' + #includePolicyDetails")
    @Transactional(readOnly = true)
    public UserPlanDTO getUserPlanWithPaymentLogs(String userPlanId, boolean includePolicyDetails) {
        logger.info("Getting UserPlan with payment logs for ID: {}, includePolicyDetails: {}", userPlanId,
                includePolicyDetails);

        UserPlan userPlan = userPlanRepository.findById(userPlanId)
                .orElseThrow(() -> new RuntimeException("UserPlan not found with ID: " + userPlanId));

        // Get payment logs sorted by creation date in descending order
        List<PaymentLogDTO> paymentLogs = getPaymentLogsByUserPlanId(userPlanId);

        // Convert UserPlan to DTO
        UserPlanDTO userPlanDTO = mapToDTO(userPlan);
        userPlanDTO.setPaymentLogs(paymentLogs);

        // Add policy details if requested
        if (includePolicyDetails) {
            List<PackageSessionPolicyDetailsDTO> policyDetails = buildPolicyDetailsForUserPlan(userPlan);
            userPlanDTO.setPolicyDetails(policyDetails);
        }

        logger.info("Retrieved UserPlan with {} payment logs for ID: {}", paymentLogs.size(), userPlanId);
        return userPlanDTO;
    }

    // Overloaded method for backward compatibility
    @Cacheable(value = "userPlanWithPaymentLogs", key = "#userPlanId + '_false'")
    @Transactional(readOnly = true)
    public UserPlanDTO getUserPlanWithPaymentLogs(String userPlanId) {
        return getUserPlanWithPaymentLogs(userPlanId, false);
    }

    @Cacheable(value = "userPlanById", key = "#userPlanId")
    @Transactional(readOnly = true)
    public UserPlan findById(String userPlanId) {
        logger.info("Finding UserPlan by ID: {}", userPlanId);
        return userPlanRepository.findById(userPlanId)
                .orElseThrow(() -> new RuntimeException("UserPlan not found with ID: " + userPlanId));
    }

    private List<PaymentLogDTO> getPaymentLogsByUserPlanId(String userPlanId) {
        logger.info("Getting payment logs for user plan ID: {}", userPlanId);

        List<PaymentLog> paymentLogs = paymentLogRepository.findByUserPlanIdOrderByCreatedAtDesc(userPlanId);

        List<PaymentLogDTO> paymentLogDTOs = paymentLogs.stream()
                .map(PaymentLog::mapToDTO)
                .collect(Collectors.toList());

        logger.info("Retrieved {} payment logs for user plan ID: {}", paymentLogDTOs.size(), userPlanId);
        return paymentLogDTOs;
    }

    @Cacheable(value = "userPlansByUser", key = "#userPlanFilterDTO.userId + ':' + #userPlanFilterDTO.instituteId + ':' + #pageNo + ':' + #pageSize + ':' + #userPlanFilterDTO.statuses + ':' + #userPlanFilterDTO.sortColumns")
    @Transactional(readOnly = true)
    public Page<UserPlanDTO> getUserPlansByUserIdAndInstituteId(int pageNo, int pageSize,
            UserPlanFilterDTO userPlanFilterDTO) {
        logger.info("Getting paginated UserPlans for userId={}, instituteId={}", userPlanFilterDTO.getUserId(),
                userPlanFilterDTO.getInstituteId());
        Sort thisSort = ListService.createSortObject(userPlanFilterDTO.getSortColumns());
        Pageable pageable = PageRequest.of(pageNo, pageSize, thisSort);
        List<String> status = List.of(UserPlanStatusEnum.ACTIVE.name(), UserPlanStatusEnum.PENDING.name(),
                UserPlanStatusEnum.PENDING_FOR_PAYMENT.name(), UserPlanStatusEnum.CANCELED.name(),
                UserPlanStatusEnum.EXPIRED.name(), UserPlanStatusEnum.PAYMENT_FAILED.name(),
                UserPlanStatusEnum.TERMINATED.name());
        Page<UserPlan> userPlansPage = userPlanRepository.findByUserIdAndInstituteIdWithFilters(
                userPlanFilterDTO.getUserId(), userPlanFilterDTO.getInstituteId(), status, pageable);

        // Bulk fetch Institutes for all SUB_ORG plans
        List<UserPlan> userPlans = userPlansPage.getContent();
        Map<String, Institute> instituteMap = fetchInstitutes(userPlans);

        return userPlansPage.map(userPlan -> mapToDTO(userPlan, instituteMap));
    }

    /**
     * Fetch all Institutes in bulk for UserPlans with SUB_ORG source.
     * This prevents N+1 query problem.
     */
    private Map<String, Institute> fetchInstitutes(List<UserPlan> userPlans) {
        Set<String> subOrgIds = userPlans.stream()
                .filter(up -> UserPlanSourceEnum.SUB_ORG.name().equals(up.getSource()))
                .map(UserPlan::getSubOrgId)
                .filter(StringUtils::hasText)
                .collect(Collectors.toSet());

        if (subOrgIds.isEmpty()) {
            return Collections.emptyMap();
        }

        logger.debug("Fetching {} institutes in bulk for subOrgIds: {}", subOrgIds.size(), subOrgIds);

        // findAllById returns Iterable, convert it to List
        Iterable<Institute> iterableInstitutes = instituteRepository.findAllById(subOrgIds);
        List<Institute> institutes = new ArrayList<>();
        iterableInstitutes.forEach(institutes::add);

        return institutes.stream()
                .collect(Collectors.toMap(
                        Institute::getId,
                        i -> i,
                        (existing, replacement) -> existing));
    }

    /**
     * Map UserPlan to DTO with Institute details from pre-fetched map.
     * This version is used for bulk operations to avoid N+1 queries.
     */
    private UserPlanDTO mapToDTO(UserPlan userPlan, Map<String, Institute> instituteMap) {
        // Fetch sub-org details from the pre-fetched map
        SubOrgDetailsDTO subOrgDetails = null;
        if (UserPlanSourceEnum.SUB_ORG.name().equals(userPlan.getSource()) &&
                StringUtils.hasText(userPlan.getSubOrgId())) {
            Institute institute = instituteMap.get(userPlan.getSubOrgId());
            if (institute != null) {
                subOrgDetails = SubOrgDetailsDTO.builder()
                        .id(institute.getId())
                        .name(institute.getInstituteName())
                        .address(institute.getAddress())
                        .build();
            } else {
                logger.warn("Institute not found in map for subOrgId={} in UserPlan ID={}",
                        userPlan.getSubOrgId(), userPlan.getId());
            }
        }

        return buildUserPlanDTO(userPlan, subOrgDetails);
    }

    /**
     * Map UserPlan to DTO (individual fetch version).
     * This version is used for single UserPlan operations.
     */
    private UserPlanDTO mapToDTO(UserPlan userPlan) {
        // Fetch sub-org details if source is SUB_ORG and subOrgId is present
        SubOrgDetailsDTO subOrgDetails = null;
        if (UserPlanSourceEnum.SUB_ORG.name().equals(userPlan.getSource()) &&
                StringUtils.hasText(userPlan.getSubOrgId())) {
            Optional<Institute> instituteOpt = instituteRepository.findById(userPlan.getSubOrgId());
            if (instituteOpt.isPresent()) {
                Institute institute = instituteOpt.get();
                subOrgDetails = SubOrgDetailsDTO.builder()
                        .id(institute.getId())
                        .name(institute.getInstituteName())
                        .address(institute.getAddress())
                        .build();
            } else {
                logger.warn("Institute not found for subOrgId={} in UserPlan ID={}",
                        userPlan.getSubOrgId(), userPlan.getId());
            }
        }

        return buildUserPlanDTO(userPlan, subOrgDetails);
    }

    /**
     * Build UserPlanDTO with all fields.
     * Common logic extracted to avoid duplication.
     */
    private UserPlanDTO buildUserPlanDTO(UserPlan userPlan, SubOrgDetailsDTO subOrgDetails) {
        return UserPlanDTO.builder()
                .id(userPlan.getId())
                .userId(userPlan.getUserId())
                .paymentPlanId(userPlan.getPaymentPlanId())
                .planJson(userPlan.getPlanJson())
                .appliedCouponDiscountId(userPlan.getAppliedCouponDiscountId())
                .appliedCouponDiscountJson(userPlan.getAppliedCouponDiscountJson())
                .appliedCoupon(vacademy.io.admin_core_service.features.user_subscription.dto.CouponSnapshotDTO
                        .fromJson(userPlan.getAppliedCouponDiscountJson()))
                .discountGrantedByUserId(userPlan.getDiscountGrantedByUserId())
                .discountGrantedAt(userPlan.getDiscountGrantedAt())
                .discountCyclesApplied(userPlan.getDiscountCyclesApplied())
                .enrollInviteId(userPlan.getEnrollInviteId())
                .paymentOptionId(userPlan.getPaymentOptionId())
                .paymentOptionJson(userPlan.getPaymentOptionJson())
                .status(userPlan.getStatus())
                .source(userPlan.getSource())
                .subOrgDetails(subOrgDetails)
                .createdAt(userPlan.getCreatedAt())
                .updatedAt(userPlan.getUpdatedAt())
                .startDate(userPlan.getStartDate())
                .endDate(userPlan.getEndDate())
                .enrollInvite(
                        userPlan.getEnrollInvite() != null ? userPlan.getEnrollInvite().toEnrollInviteDTO() : null)
                .paymentPlanDTO(
                        (userPlan.getPaymentPlan() != null ? userPlan.getPaymentPlan().mapToPaymentPlanDTO() : null))
                .paymentOption(
                        (userPlan.getPaymentOption() != null ? userPlan.getPaymentOption().mapToPaymentOptionDTO()
                                : null))
                .paymentLogs((userPlan.getPaymentLogs() != null
                        ? userPlan.getPaymentLogs().stream().map(PaymentLog::mapToDTO).collect(Collectors.toList())
                        : List.of()))
                .policyDetails(buildPolicyDetailsForUserPlan(userPlan))
                .build();
    }

    /**
     * Map UserPlan to DTO WITHOUT payment logs (optimized for membership details).
     * This method avoids loading payment logs for better performance.
     */
    /**
     * Map UserPlan to DTO WITHOUT payment logs (optimized for membership details).
     * This method avoids loading payment logs for better performance.
     */
    private UserPlanDTO mapToDTOWithoutPaymentLogs(UserPlan userPlan,
            List<PackageSessionPolicyDetailsDTO> policyDetails) {
        // Fetch sub-org details if source is SUB_ORG and subOrgId is present
        SubOrgDetailsDTO subOrgDetails = null;
        if (UserPlanSourceEnum.SUB_ORG.name().equals(userPlan.getSource()) &&
                StringUtils.hasText(userPlan.getSubOrgId())) {
            Optional<Institute> instituteOpt = instituteRepository.findById(userPlan.getSubOrgId());
            if (instituteOpt.isPresent()) {
                Institute institute = instituteOpt.get();
                subOrgDetails = SubOrgDetailsDTO.builder()
                        .id(institute.getId())
                        .name(institute.getInstituteName())
                        .address(institute.getAddress())
                        .build();
            } else {
                logger.warn("Institute not found for subOrgId={} in UserPlan ID={}",
                        userPlan.getSubOrgId(), userPlan.getId());
            }
        }

        // Build DTO without payment logs
        return UserPlanDTO.builder()
                .id(userPlan.getId())
                .userId(userPlan.getUserId())
                .paymentPlanId(userPlan.getPaymentPlanId())
                .planJson(userPlan.getPlanJson())
                .appliedCouponDiscountId(userPlan.getAppliedCouponDiscountId())
                .appliedCouponDiscountJson(userPlan.getAppliedCouponDiscountJson())
                .appliedCoupon(vacademy.io.admin_core_service.features.user_subscription.dto.CouponSnapshotDTO
                        .fromJson(userPlan.getAppliedCouponDiscountJson()))
                .discountGrantedByUserId(userPlan.getDiscountGrantedByUserId())
                .discountGrantedAt(userPlan.getDiscountGrantedAt())
                .discountCyclesApplied(userPlan.getDiscountCyclesApplied())
                .enrollInviteId(userPlan.getEnrollInviteId())
                .paymentOptionId(userPlan.getPaymentOptionId())
                .paymentOptionJson(userPlan.getPaymentOptionJson())
                .status(userPlan.getStatus())
                .source(userPlan.getSource())
                .subOrgDetails(subOrgDetails)
                .createdAt(userPlan.getCreatedAt())
                .updatedAt(userPlan.getUpdatedAt())
                .startDate(userPlan.getStartDate())
                .endDate(userPlan.getEndDate())
                .enrollInvite(
                        userPlan.getEnrollInvite() != null ? userPlan.getEnrollInvite().toEnrollInviteDTO() : null)
                .paymentPlanDTO(
                        (userPlan.getPaymentPlan() != null ? userPlan.getPaymentPlan().mapToPaymentPlanDTO() : null))
                .paymentOption(
                        (userPlan.getPaymentOption() != null ? userPlan.getPaymentOption().mapToPaymentOptionDTO()
                                : null))
                .paymentLogs(List.of()) // Empty list - no payment logs loaded
                .policyDetails(policyDetails) // Set policy details
                .build();
    }

    @CacheEvict(value = { "userPlanById", "userPlansByUser", "userPlanWithPaymentLogs",
            "membershipDetails" }, allEntries = true)
    public void updateUserPlanStatuses(List<String> userPlanIds, String status) {
        if (CollectionUtils.isEmpty(userPlanIds)) {
            throw new IllegalArgumentException("User plan ids must not be empty.");
        }

        if (!StringUtils.hasText(status)) {
            throw new IllegalArgumentException("Status must not be empty.");
        }

        String normalizedStatus;
        try {
            normalizedStatus = UserPlanStatusEnum.valueOf(status.trim().toUpperCase(Locale.ROOT)).name();
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Invalid user plan status: " + status);
        }

        List<UserPlan> userPlans = userPlanRepository.findAllById(userPlanIds);
        if (CollectionUtils.isEmpty(userPlans)) {
            throw new IllegalArgumentException("No user plans found for provided ids.");
        }

        userPlans.forEach(plan -> plan.setStatus(normalizedStatus));
        userPlanRepository.saveAll(userPlans);
    }

    // ── Plan change (admin side) ────────────────────────────────────────────

    /**
     * The plans an admin could move this learner onto. Same eligibility rules as the
     * learner-facing listing — an admin cannot move someone onto a plan the institute has
     * not flagged as switchable — with the proration figures included for information.
     */
    public vacademy.io.admin_core_service.features.plan_change.dto.PlanChangeOptionsDTO getPlanChangeOptions(
            String userPlanId, String instituteId) {
        return planChangeService.getChangeOptions(findById(userPlanId), instituteId);
    }

    /**
     * Admin override: swap the plan with no payment taken. The access window is untouched
     * (see {@code PlanChangeService.adminApplyChange}); the new price bills at the next
     * renewal.
     *
     * <p>Evicts the same caches as a bulk status change — the side-view membership card,
     * the plan listing and the membership roster all read through them, and a stale entry
     * would show the learner on the plan they just left.
     */
    @CacheEvict(value = { "userPlanById", "userPlansByUser", "userPlanWithPaymentLogs",
            "membershipDetails" }, allEntries = true)
    public UserPlanDTO adminChangePlan(String userPlanId, String instituteId,
            vacademy.io.admin_core_service.features.plan_change.dto.PlanChangeRequestDTO request,
            vacademy.io.common.auth.model.CustomUserDetails adminDetails) {
        UserPlan updated = planChangeService.adminApplyChange(
                findById(userPlanId), instituteId, request, adminDetails);
        return mapToDTO(updated);
    }

    /**
     * Activates a stacked PENDING plan when the current plan expires.
     * 1. Updates stacked plan status to ACTIVE.
     * 2. Sets stacked plan start/end dates based on current time and validity.
     * 3. Moves all active mappings from expired plan to stacked plan and extends
     * their expiry.
     */
    @Transactional
    public void activateStackedPlan(UserPlan stackedPlan, UserPlan expiredPlan) {
        logger.info("Activating stacked plan ID={} (replacing expired plan ID={})", stackedPlan.getId(),
                expiredPlan.getId());

        // 1. Update Stacked Plan Dates
        Date now = new Date();
        stackedPlan.setStartDate(new Timestamp(now.getTime()));

        // Calculate validity
        Integer validityDays = null;
        if (stackedPlan.getPaymentPlan() != null && stackedPlan.getPaymentPlan().getValidityInDays() != null) {
            validityDays = stackedPlan.getPaymentPlan().getValidityInDays();
        } else if (stackedPlan.getEnrollInvite() != null
                && stackedPlan.getEnrollInvite().getLearnerAccessDays() != null) {
            validityDays = stackedPlan.getEnrollInvite().getLearnerAccessDays();
        }

        if (validityDays != null) {
            Calendar calendar = Calendar.getInstance();
            calendar.setTime(now);
            calendar.add(Calendar.DAY_OF_YEAR, validityDays);
            stackedPlan.setEndDate(new Timestamp(calendar.getTimeInMillis()));
        }

        // 2. Update Status
        stackedPlan.setStatus(UserPlanStatusEnum.ACTIVE.name());
        userPlanRepository.save(stackedPlan);

        // 3. Transfer and Extend Mappings
        List<StudentSessionInstituteGroupMapping> mappings = studentSessionRepository.findAllByUserPlanIdAndStatusIn(
                expiredPlan.getId(),
                List.of(LearnerSessionStatusEnum.ACTIVE.name()));

        if (mappings.isEmpty()) {
            // Promoting a plan while transferring nothing leaves an ACTIVE plan with no
            // enrolment behind it — the learner pays (or already paid) and sits in no batch.
            // It happens whenever the expired plan's mappings were already revoked, which is
            // the normal end of a trial. Enrol against the promoted plan instead of returning
            // empty-handed.
            logger.warn("No active mappings to transfer from expired plan ID={} — enrolling the "
                    + "promoted plan {} directly", expiredPlan.getId(), stackedPlan.getId());
            ensureEnrollmentExists(stackedPlan);
            return;
        }

        for (StudentSessionInstituteGroupMapping mapping : mappings) {
            // Link to new plan
            mapping.setUserPlanId(stackedPlan.getId());

            // Extend expiry date to match the new plan's end date
            // This ensures the mapping is valid for the duration of the new plan
            if (stackedPlan.getEndDate() != null) {
                mapping.setExpiryDate(stackedPlan.getEndDate());
            }

            studentSessionRepository.save(mapping);
        }

        logger.info("Transferred {} mappings from plan {} to plan {}", mappings.size(), expiredPlan.getId(),
                stackedPlan.getId());
    }

    @Transactional
    public void cancelUserPlan(String userPlanId, boolean force) {
        logger.info("Cancelling UserPlan ID: {}, force: {}", userPlanId, force);

        UserPlan userPlan = userPlanRepository.findById(userPlanId)
                .orElseThrow(() -> new RuntimeException("UserPlan not found with ID: " + userPlanId));

        userPlan.setStatus(force ? UserPlanStatusEnum.TERMINATED.name() : UserPlanStatusEnum.CANCELED.name());
        // Cancelling has to stop autopay too. Leaving auto_renewal_enabled = true meant a
        // cancelled plan was excluded from the renewal sweep only by its status, so any later
        // reactivation (the manual "pay to continue" flow reuses the SAME UserPlan and flips it
        // back to ACTIVE) silently resumed charging someone who had cancelled. Mirrors
        // SubscriptionService.cancelSubscription, which the learner self-service path already did.
        userPlan.setAutoRenewalEnabled(false);
        userPlanRepository.save(userPlan);

        // Revoke the stored mandate for the same reason. Wrapped so a mandate failure
        // can never undo the cancel itself.
        try {
            String mandateInstituteId = userPlan.getEnrollInvite() != null
                    ? userPlan.getEnrollInvite().getInstituteId() : null;
            String mandateVendor = userPlan.getEnrollInvite() != null
                    ? userPlan.getEnrollInvite().getVendor() : null;
            if (mandateInstituteId != null && !mandateInstituteId.isBlank()
                    && mandateVendor != null && !mandateVendor.isBlank()) {
                mandateService.revokeMandate(userPlan.getUserId(), mandateInstituteId,
                        mandateVendor, userPlan.getId());
            }
        } catch (Exception me) {
            logger.warn("Failed to revoke mandate on cancel for plan {}: {}", userPlanId, me.getMessage());
        }

        // Fire the matching workflow trigger so admin/learner workflows can react
        // (welcome-back nudge on CANCEL, access-revoked email on TERMINATED, etc.).
        // Wrapped so a workflow failure can't undo the cancel. Institute is read
        // off the joined EnrollInvite — plans without one are skipped because we
        // can't route the trigger.
        try {
            String workflowInstituteId = userPlan.getEnrollInvite() != null
                    ? userPlan.getEnrollInvite().getInstituteId() : null;
            if (workflowInstituteId != null && !workflowInstituteId.isBlank()) {
                Map<String, Object> ctx = new HashMap<>();
                ctx.put("userPlanId", userPlan.getId());
                ctx.put("userId", userPlan.getUserId());
                ctx.put("enrollInviteId", userPlan.getEnrollInviteId());
                ctx.put("paymentPlanId", userPlan.getPaymentPlanId());
                ctx.put("endDate", userPlan.getEndDate() != null ? userPlan.getEndDate().toString() : null);
                String triggerName = force
                        ? vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent.SUBSCRIPTION_TERMINATED.name()
                        : vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent.SUBSCRIPTION_CANCELLED.name();
                String eventId = userPlan.getEnrollInviteId() != null
                        ? userPlan.getEnrollInviteId() : workflowInstituteId;
                workflowTriggerService.handleTriggerEvents(triggerName, eventId, workflowInstituteId, ctx);
            }
        } catch (Exception wfe) {
            logger.warn("Failed to trigger {} workflow for plan {}: {}",
                    force ? "SUBSCRIPTION_TERMINATED" : "SUBSCRIPTION_CANCELLED",
                    userPlanId, wfe.getMessage());
        }

        if (!force) {
            logger.info("UserPlan ID: {} marked as CANCELED", userPlanId);
            return;
        }

        logger.info("UserPlan ID: {} marked as TERMINATED", userPlanId);

        // The course is gone, so nothing more is owed on it: cancel its open installments
        // (money already paid stays on record). They used to stay due in the payment history.
        feeBillCancellationService.cancelOpenBills(userPlanId, "Course removed: installment cancelled");

        List<StudentSessionInstituteGroupMapping> mappings = studentSessionRepository.findAllByUserPlanIdAndStatusIn(
                userPlanId,
                List.of(LearnerSessionStatusEnum.ACTIVE.name()));

        if (mappings.isEmpty()) {
            logger.warn("No session mappings found for UserPlan ID: {}", userPlanId);
            return;
        }

        // Extract packageIds
        Set<String> packageIds = mappings.stream()
                .map(StudentSessionInstituteGroupMapping::getPackageSession)
                .filter(Objects::nonNull)
                .map(ps -> ps.getPackageEntity().getId())
                .collect(Collectors.toSet());

        if (packageIds.isEmpty()) {
            studentSessionRepository.deleteAllInBatch(mappings);
            logger.info("Deleted {} mappings (no package sessions)", mappings.size());
            return;
        }

        // Fetch all invited sessions in one query
        Map<String, PackageSession> invitedSessionByPackageId = packageSessionRepository
                .findAllInvitedByPackageIds(packageIds)
                .stream()
                .collect(Collectors.toMap(
                        ps -> ps.getPackageEntity().getId(),
                        Function.identity()));

        List<StudentSessionInstituteGroupMapping> newMappings = new ArrayList<>();

        for (StudentSessionInstituteGroupMapping mapping : mappings) {
            PackageSession activePackageSession = mapping.getPackageSession();
            if (activePackageSession == null)
                continue;

            String packageId = activePackageSession.getPackageEntity().getId();
            PackageSession invitedSession = invitedSessionByPackageId.get(packageId);

            if (invitedSession == null) {
                logger.error(
                        "INVITED package session not found for package ID: {}. Mapping ID: {}",
                        packageId, mapping.getId());
                continue;
            }

            newMappings.add(
                    StudentSessionInstituteGroupMapping.createInvitedMappingFromTerminated(
                            mapping,
                            invitedSession,
                            activePackageSession,
                            LearnerSessionSourceEnum.TERMINATED.name(),
                            LearnerSessionTypeEnum.PACKAGE_SESSION.name(),
                            LearnerSessionStatusEnum.INVITED.name()));
        }

        // Bulk delete + bulk insert
        studentSessionRepository.deleteAllInBatch(mappings);
        studentSessionRepository.saveAll(newMappings);

        logger.info("Force-cancel completed. Deleted: {}, Created INVITED mappings: {}", mappings.size(),
                newMappings.size());
    }

    /**
     * Get membership details with caching and optimizations.
     * - Uses caching to reduce database load
     * - Avoids loading payment logs for better performance
     * - Fetches only necessary associations
     */
    @Cacheable(value = "membershipDetails", key = "#filterDTO.instituteId + '_' + #pageNo + '_' + #pageSize + '_' + " +
            "#filterDTO.startDateInUtc + '_' + #filterDTO.endDateInUtc + '_' + " +
            "(#filterDTO.membershipStatuses != null ? #filterDTO.membershipStatuses.toString() : 'null') + '_' + " +
            "(#filterDTO.packageSessionIds != null ? #filterDTO.packageSessionIds.toString() : 'null') + '_' + " +
            "(#filterDTO.sortOrder != null ? #filterDTO.sortOrder.toString() : 'null')", unless = "#result == null || #result.isEmpty()")
    @Transactional(readOnly = true)
    public Page<MembershipDetailsDTO> getMembershipDetails(MembershipFilterDTO filterDTO, int pageNo, int pageSize) {
        Pageable pageable = createPageable(pageNo, pageSize, filterDTO.getSortOrder());

        // 1. Fetch Data with Dynamic Status Calculation
        Page<Object[]> results = userPlanRepository.findMembershipDetailsWithDynamicStatus(
                filterDTO.getInstituteId(),
                filterDTO.getStartDateInUtc(),
                filterDTO.getEndDateInUtc(),
                filterDTO.getMembershipStatuses(),
                filterDTO.getPackageSessionIds(),
                pageable);

        // 2. Extract User Plan IDs to fetch entities in bulk
        List<Object[]> content = results.getContent();
        List<String> userPlanIds = content.stream()
                .map(row -> (String) row[0]) // row[0] is the user_plan.id (String)
                .collect(Collectors.toList());

        // 3. Fetch UserPlan entities by IDs WITHOUT payment logs (optimized)
        Map<String, UserPlan> userPlanMap = new HashMap<>();
        if (!userPlanIds.isEmpty()) {
            List<UserPlan> userPlans = userPlanRepository.findByIdsWithoutPaymentLogs(userPlanIds);
            userPlanMap = userPlans.stream()
                    .collect(Collectors.toMap(UserPlan::getId, Function.identity()));
        }

        // 4. Extract User IDs from fetched UserPlan entities
        Set<String> userIds = userPlanMap.values().stream()
                .map(UserPlan::getUserId)
                .collect(Collectors.toSet());

        // 5. Fetch User DTOs from Auth Service
        Map<String, UserDTO> userMap = new HashMap<>();
        if (!userIds.isEmpty()) {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(userIds));
            userMap = users.stream().collect(Collectors.toMap(UserDTO::getId, Function.identity()));
        }

        // 6. Fetch Package Sessions
        Set<String> enrollInviteIds = userPlanMap.values().stream()
                .map(UserPlan::getEnrollInviteId)
                .collect(Collectors.toSet());

        Map<String, List<PackageSessionLiteDTO>> sessionMap = new HashMap<>();
        if (!enrollInviteIds.isEmpty()) {
            List<PackageSessionLearnerInvitationToPaymentOption> mappings = packageSessionEnrollInviteToPaymentOptionService
                    .findByEnrollInviteIdsWithPackageSession(new ArrayList<>(enrollInviteIds));

            Map<String, List<PackageSessionLearnerInvitationToPaymentOption>> grouped = mappings.stream()
                    .filter(m -> m.getPaymentOption() != null)
                    .collect(Collectors.groupingBy(m -> m.getPaymentOption().getId()));

            sessionMap = grouped.entrySet().stream().collect(Collectors.toMap(
                    Map.Entry::getKey,
                    entry -> entry.getValue().stream().map(m -> {
                        vacademy.io.common.institute.entity.session.PackageSession ps = m.getPackageSession();
                        return PackageSessionLiteDTO.builder()
                                .id(ps.getId())
                                .sessionName(ps.getSession() != null ? ps.getSession().getSessionName() : null)
                                .packageName(
                                        ps.getPackageEntity() != null ? ps.getPackageEntity().getPackageName() : null)
                                .levelName(ps.getLevel() != null ? ps.getLevel().getLevelName() : null)
                                .startTime(ps.getStartTime())
                                .status(ps.getStatus())
                                .isParent(ps.getIsParent())
                                .parentId(ps.getParentId())
                                .build();
                    }).collect(Collectors.toList())));
        }

        // 7. Fetch Policy Data (Bulk)
        Map<String, List<PackageSessionLearnerInvitationToPaymentOption>> enrollInviteToSessionsMap = new HashMap<>();
        if (!enrollInviteIds.isEmpty()) {
            List<PackageSessionLearnerInvitationToPaymentOption> allMappings = packageSessionLearnerInvitationRepository
                    .findByEnrollInviteIdsAndStatusWithPackageSession(
                            new ArrayList<>(enrollInviteIds),
                            List.of("ACTIVE"));

            enrollInviteToSessionsMap = allMappings.stream()
                    .collect(Collectors.groupingBy(m -> m.getEnrollInvite().getId()));
        }

        // 8. Map to MembershipDetailsDTO (without payment logs)
        Map<String, UserPlan> finalUserPlanMap = userPlanMap;
        Map<String, UserDTO> finalUserMap = userMap;
        Map<String, List<PackageSessionLiteDTO>> finalSessionMap = sessionMap;
        Map<String, List<PackageSessionLearnerInvitationToPaymentOption>> finalEnrollInviteToSessionsMap = enrollInviteToSessionsMap;

        return results.map(row -> {
            String userPlanId = (String) row[0]; // user_plan.id
            String dynamicStatus = (String) row[1]; // computedStatus
            Timestamp endDate = (Timestamp) row[2]; // actualEndDate

            UserPlan userPlan = finalUserPlanMap.get(userPlanId);
            if (userPlan == null) {
                throw new RuntimeException("UserPlan not found for id: " + userPlanId);
            }

            // Build policy details
            List<PackageSessionPolicyDetailsDTO> policyDetails = null;
            List<PackageSessionLearnerInvitationToPaymentOption> sessionMappings = finalEnrollInviteToSessionsMap
                    .getOrDefault(userPlan.getEnrollInviteId(), Collections.emptyList());

            policyDetails = sessionMappings.stream()
                    .filter(m -> m.getPackageSession() != null)
                    .map(m -> buildDetailsForSession(userPlan, m.getPackageSession()))
                    .filter(Objects::nonNull)
                    .collect(Collectors.toList());

            // Map to DTO without payment logs, passing policy details
            UserPlanDTO userPlanDTO = mapToDTOWithoutPaymentLogs(userPlan, policyDetails);

            return MembershipDetailsDTO.builder()
                    .userPlan(userPlanDTO)
                    .userDetails(finalUserMap.get(userPlan.getUserId()))
                    .membershipStatus(dynamicStatus)
                    .calculatedEndDate(endDate)
                    .packageSessions(finalSessionMap.getOrDefault(userPlan.getPaymentOptionId(), List.of()))
                    .policyDetails(policyDetails)
                    .build();
        });
    }

    // Overloaded method for backward compatibility - now just calls the main method
    @Cacheable(value = "membershipDetails", key = "#filterDTO.instituteId + '_' + #pageNo + '_' + #pageSize + '_' + " +
            "#filterDTO.startDateInUtc + '_' + #filterDTO.endDateInUtc + '_' + " +
            "(#filterDTO.membershipStatuses != null ? #filterDTO.membershipStatuses.toString() : 'null') + '_' + " +
            "(#filterDTO.packageSessionIds != null ? #filterDTO.packageSessionIds.toString() : 'null') + '_' + " +
            "(#filterDTO.sortOrder != null ? #filterDTO.sortOrder.toString() : 'null')", unless = "#result == null || #result.isEmpty()")
    @Transactional(readOnly = true)
    public Page<MembershipDetailsDTO> getMembershipDetailsCached(MembershipFilterDTO filterDTO, int pageNo,
            int pageSize) {
        return getMembershipDetails(filterDTO, pageNo, pageSize);
    }

    public Pageable createPageable(int page, int size, Map<String, String> sortCols) {
        if (sortCols != null && sortCols.containsKey("calculated_end_date")) {
            String direction = sortCols.remove("calculated_end_date");
            sortCols.put("end_date", direction);
        }
        Sort sort = ListService.createSortObject(sortCols);
        return PageRequest.of(page, size, sort);
    }

    /**
     * Builds policy details for a UserPlan.
     * Fetches all package sessions associated with the UserPlan's enrollInvite
     * and extracts policy information.
     *
     * @param userPlan The UserPlan to build policy details for
     * @return List of policy details, one per package session (empty if none)
     */
    private List<PackageSessionPolicyDetailsDTO> buildPolicyDetailsForUserPlan(UserPlan userPlan) {
        if (userPlan == null || userPlan.getEnrollInviteId() == null) {
            return Collections.emptyList();
        }

        try {
            List<PackageSessionLearnerInvitationToPaymentOption> mappings = packageSessionLearnerInvitationRepository
                    .findByEnrollInviteIdAndStatusWithPackageSession(
                            userPlan.getEnrollInviteId(),
                            List.of("ACTIVE"));

            if (mappings == null || mappings.isEmpty()) {
                return Collections.emptyList();
            }

            return mappings.stream()
                    .filter(m -> m.getPackageSession() != null)
                    .map(m -> buildDetailsForSession(userPlan, m.getPackageSession()))
                    .filter(Objects::nonNull)
                    .collect(Collectors.toList());

        } catch (Exception e) {
            logger.error("Error building policy details for UserPlan ID: {}", userPlan.getId(), e);
            return Collections.emptyList();
        }
    }

    private PackageSessionPolicyDetailsDTO buildDetailsForSession(UserPlan userPlan, PackageSession packageSession) {
        try {
            String policyJson = packageSession.getEnrollmentPolicySettings();
            if (!StringUtils.hasText(policyJson)) {
                return null;
            }

            EnrollmentPolicyJsonDTOs.EnrollmentPolicySettingsDTO settings = objectMapper.readValue(policyJson,
                    EnrollmentPolicyJsonDTOs.EnrollmentPolicySettingsDTO.class);

            List<PolicyActionDTO> actions = buildPolicyActions(userPlan, settings);
            ReenrollmentPolicyDetailsDTO reenrollment = buildReenrollmentPolicy(settings, userPlan);
            OnExpiryPolicyDetailsDTO onExpiry = buildOnExpiryPolicy(settings, userPlan);

            return PackageSessionPolicyDetailsDTO.builder()
                    .packageSessionId(packageSession.getId())
                    .packageSessionName(packageSession.getLevel().getLevelName() + " "
                            + packageSession.getPackageEntity().getPackageName() + " "
                            + packageSession.getSession().getSessionName())
                    .packageSessionStatus(packageSession.getStatus())
                    .policyActions(actions)
                    .reenrollmentPolicy(reenrollment)
                    .onExpiryPolicy(onExpiry)
                    .build();
        } catch (Exception e) {
            logger.error("Error parsing policy for session: {}", packageSession.getId(), e);
            return null;
        }
    }

    private List<PolicyActionDTO> buildPolicyActions(UserPlan userPlan,
            EnrollmentPolicyJsonDTOs.EnrollmentPolicySettingsDTO settings) {
        List<PolicyActionDTO> actions = new ArrayList<>();
        LocalDate endDate = userPlan.getEndDate() != null
                ? userPlan.getEndDate().toInstant().atZone(java.time.ZoneId.systemDefault()).toLocalDate()
                : null;

        if (endDate == null)
            return actions;

        // Notifications
        if (settings.getNotifications() != null) {
            for (EnrollmentPolicyJsonDTOs.NotificationConfigDTO config : settings.getNotifications()) {
                if ("ON_EXPIRY_DATE_REACHED".equals(config.getTrigger())) {
                    addSingleNotificationAction(actions, endDate, 0, "Expiry notification", config);
                } else if ("DURING_WAITING_PERIOD".equals(config.getTrigger())) {
                    addRecurringNotificationActions(actions, endDate, config);
                } else if ("BEFORE_EXPIRY".equals(config.getTrigger()) && config.getDaysBeforeExpiry() != null) {
                    LocalDate scheduledDate = endDate.minusDays(config.getDaysBeforeExpiry());
                    addSingleNotificationAction(actions, scheduledDate, -config.getDaysBeforeExpiry(),
                            "Reminder " + config.getDaysBeforeExpiry() + " days before expiry", config);
                }
            }
        }

        // Auto-renewal / Payment
        if (settings.getOnExpiry() != null && Boolean.TRUE.equals(settings.getOnExpiry().getEnableAutoRenewal())) {
            actions.add(PolicyActionDTO.builder()
                    .actionType("PAYMENT_ATTEMPT")
                    .scheduledDate(endDate)
                    .description("Auto-renewal payment attempt")
                    .daysPastOrBeforeExpiry(0)
                    .build());
        }

        // Final Expiry
        if (settings.getOnExpiry() != null && settings.getOnExpiry().getWaitingPeriodInDays() != null) {
            LocalDate finalExpiryDate = endDate.plusDays(settings.getOnExpiry().getWaitingPeriodInDays());
            actions.add(PolicyActionDTO.builder()
                    .actionType("FINAL_EXPIRY")
                    .scheduledDate(finalExpiryDate)
                    .description("Final expiry after waiting period")
                    .daysPastOrBeforeExpiry(settings.getOnExpiry().getWaitingPeriodInDays())
                    .build());
        }

        actions.sort(Comparator.comparing(PolicyActionDTO::getScheduledDate));
        return actions;
    }

    private void addSingleNotificationAction(List<PolicyActionDTO> actions, LocalDate scheduledDate, int daysDiff,
            String desc, EnrollmentPolicyJsonDTOs.NotificationConfigDTO config) {
        if (scheduledDate.isAfter(LocalDate.now())) {
            actions.add(PolicyActionDTO.builder()
                    .actionType("NOTIFICATION")
                    .scheduledDate(scheduledDate)
                    .description(desc)
                    .daysPastOrBeforeExpiry(daysDiff)
                    .details(buildNotificationDetails(config))
                    .build());
        }
    }

    private void addRecurringNotificationActions(List<PolicyActionDTO> actions, LocalDate endDate,
            EnrollmentPolicyJsonDTOs.NotificationConfigDTO config) {
        int interval = config.getSendEveryNDays() != null ? config.getSendEveryNDays() : 1;
        int maxSends = config.getMaxSends() != null ? config.getMaxSends() : 1;

        for (int i = 1; i <= maxSends; i++) {
            int daysAfter = i * interval;
            LocalDate scheduledDate = endDate.plusDays(daysAfter);
            if (scheduledDate.isAfter(LocalDate.now())) {
                actions.add(PolicyActionDTO.builder()
                        .actionType("NOTIFICATION")
                        .scheduledDate(scheduledDate)
                        .description("Follow-up " + daysAfter + " days after expiry")
                        .daysPastOrBeforeExpiry(daysAfter)
                        .details(buildNotificationDetails(config))
                        .build());
            }
        }
    }

    private Map<String, Object> buildNotificationDetails(EnrollmentPolicyJsonDTOs.NotificationConfigDTO config) {
        Map<String, Object> details = new HashMap<>();
        if (config.getNotificationConfig() != null) {
            details.put("type", config.getNotificationConfig().getType());
            // details.put("content", config.getNotificationConfig().getContent());
            String templateName = config.getNotificationConfig().getTemplateName();
            details.put("templateName", StringUtils.hasText(templateName) ? templateName : "DEFAULT_TEMPLATE");
        }
        return details;
    }

    private ReenrollmentPolicyDetailsDTO buildReenrollmentPolicy(
            EnrollmentPolicyJsonDTOs.EnrollmentPolicySettingsDTO settings, UserPlan userPlan) {
        if (settings.getReenrollmentPolicy() == null)
            return null;

        LocalDate nextEligible = null;
        if (userPlan.getEndDate() != null && settings.getReenrollmentPolicy().getReenrollmentGapInDays() != null) {
            nextEligible = userPlan.getEndDate().toInstant().atZone(java.time.ZoneId.systemDefault()).toLocalDate()
                    .plusDays(settings.getReenrollmentPolicy().getReenrollmentGapInDays());
        }

        return ReenrollmentPolicyDetailsDTO.builder()
                .allowReenrollmentAfterExpiry(settings.getReenrollmentPolicy().getAllowReenrollmentAfterExpiry())
                .reenrollmentGapInDays(settings.getReenrollmentPolicy().getReenrollmentGapInDays())
                .nextEligibleEnrollmentDate(nextEligible)
                .build();
    }

    private OnExpiryPolicyDetailsDTO buildOnExpiryPolicy(EnrollmentPolicyJsonDTOs.EnrollmentPolicySettingsDTO settings,
            UserPlan userPlan) {
        if (settings.getOnExpiry() == null)
            return null;

        LocalDate endDate = userPlan.getEndDate() != null
                ? userPlan.getEndDate().toInstant().atZone(java.time.ZoneId.systemDefault()).toLocalDate()
                : null;
        LocalDate finalExpiry = null;
        LocalDate nextPayment = null;

        if (endDate != null) {
            if (settings.getOnExpiry().getWaitingPeriodInDays() != null) {
                finalExpiry = endDate.plusDays(settings.getOnExpiry().getWaitingPeriodInDays());
            }
            if (Boolean.TRUE.equals(settings.getOnExpiry().getEnableAutoRenewal())) {
                nextPayment = endDate;
            }
        }

        return OnExpiryPolicyDetailsDTO.builder()
                .waitingPeriodInDays(settings.getOnExpiry().getWaitingPeriodInDays())
                .enableAutoRenewal(settings.getOnExpiry().getEnableAutoRenewal())
                .nextPaymentAttemptDate(nextPayment)
                .finalExpiryDate(finalExpiry)
                .build();
    }

    /**
     * Resolves the learner portal URL for the post-payment credential email's "Access Your Account"
     * link. Priority: package.course_setting.LMS_SETTING.learndash_base_url →
     * institute.learnerPortalBaseUrl → null.
     *
     * <p>The institute tier is not optional. Without it this path handed auth-service a null
     * loginUrl, and auth-service — seeing an already-enrolled learner with no <em>newly added</em>
     * roles — classed them as staff and linked the ADMIN portal instead. Mirrors
     * LearnerEnrollRequestService.resolveLearnerPortalUrl and
     * BulkAssignmentService.resolveLearnerPortalUrl; keep all three in sync.
     */
    private String resolveLearnerPortalUrl(List<String> packageSessionIds, String instituteId) {
        String packageUrl = getLearndashBaseUrlFromPackageSessions(packageSessionIds);
        if (StringUtils.hasText(packageUrl)) {
            return packageUrl;
        }
        if (StringUtils.hasText(instituteId)) {
            return instituteRepository.findById(instituteId)
                    .map(Institute::getLearnerPortalBaseUrl)
                    .orElse(null);
        }
        return null;
    }

    private String getLearndashBaseUrlFromPackageSessions(List<String> packageSessionIds) {
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            return null;
        }
        try {
            List<PackageSession> sessions = packageSessionRepository.findPackageSessionsByIds(packageSessionIds);
            for (PackageSession ps : sessions) {
                if (ps.getPackageEntity() == null) continue;
                String courseSetting = ps.getPackageEntity().getCourseSetting();
                if (!StringUtils.hasText(courseSetting)) continue;
                com.fasterxml.jackson.databind.JsonNode root = objectMapper.readTree(courseSetting);
                com.fasterxml.jackson.databind.JsonNode urlNode = root
                        .path("setting").path("LMS_SETTING").path("data").path("data").path("learndash_base_url");
                if (!urlNode.isMissingNode() && urlNode.isTextual() && StringUtils.hasText(urlNode.asText())) {
                    return urlNode.asText();
                }
            }
        } catch (Exception e) {
            logger.warn("Could not extract learndash_base_url from package sessions: {}", e.getMessage());
        }
        return null;
    }

    public UserPlan save(UserPlan userPlan) {
        return userPlanRepository.save(userPlan);
    }
}