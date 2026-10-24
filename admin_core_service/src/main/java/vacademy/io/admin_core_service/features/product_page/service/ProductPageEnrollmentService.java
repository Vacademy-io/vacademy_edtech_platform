package vacademy.io.admin_core_service.features.product_page.service;

import jakarta.transaction.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.utm_attribution.service.UtmAttributionService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldValueSourceTypeEnum;
import vacademy.io.admin_core_service.features.common.service.CustomFieldValueService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.product_page.dto.*;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPageInviteMapping;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageInviteMappingRepository;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.manager.StudentRegistrationManager;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerEnrollmentEntryService;
import vacademy.io.admin_core_service.features.learner.service.LearnerCouponService;
import vacademy.io.admin_core_service.features.learner_payment_option_operation.service.ComplexPaymentOptionOperation;
import vacademy.io.admin_core_service.features.learner_payment_option_operation.service.OneTimePaymentOptionOperation;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.payments.service.PaymentService;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalQuote;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceResolver;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLogLineItem;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogLineItemRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowEngineService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerExtraDetails;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;
import vacademy.io.common.common.dto.CustomFieldValueDTO;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.session.PackageSession;
import org.springframework.util.StringUtils;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.common.payment.dto.RazorpayRequestDTO;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
public class ProductPageEnrollmentService {

    private static final String STATUS_ACTIVE = "ACTIVE";
    private static final String LINE_ITEM_TYPE = "PRODUCT_PAGE_ALLOCATION";

    @Autowired
    private ProductPageRepository coursePageRepository;

    @Autowired
    private ProductPageInviteMappingRepository mappingRepository;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private PaymentPlanRepository paymentPlanRepository;

    @Autowired
    private StudentRegistrationManager studentRegistrationManager;

    @Autowired
    private LearnerEnrollmentEntryService learnerEnrollmentEntryService;

    @Autowired
    private CustomFieldValueService customFieldValueService;

    @Autowired
    private PaymentService paymentService;

    @Autowired
    private UserPlanService userPlanService;

    @Autowired
    private OneTimePaymentOptionOperation oneTimePaymentOptionOperation;

    @Autowired
    private ComplexPaymentOptionOperation complexPaymentOptionOperation;

    @Autowired
    private PaymentLogRepository paymentLogRepository;

    @Autowired
    private PaymentLogLineItemRepository paymentLogLineItemRepository;

    @Autowired
    private AppliedCouponDiscountRepository appliedCouponDiscountRepository;

    @Autowired
    private BasketPricingCalculator basketPricingCalculator;

    @Autowired
    private OfferCalculator offerCalculator;

    @Autowired
    private ProductPageService coursePageService;

    @Autowired
    private PaymentLogService paymentLogService;

    @Autowired
    private InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;

    @Autowired
    private AuthService authService;

    @Autowired
    private LearnerCouponService learnerCouponService;

    @Autowired
    private WorkflowEngineService workflowEngineService;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private UtmAttributionService utmAttributionService;

    @Autowired
    private RegionalPriceResolver regionalPriceResolver;

    @Autowired
    private ProductPageAutoLoginService autoLoginService;

    /**
     * Regional pricing for one product-page order. All or nothing: the basket is regionally
     * priced only when every paid course in it resolves to a regional price in the SAME
     * currency, and the page has no basket pricing or offers (those amounts are written in
     * the base currency). Otherwise the whole order stays on base prices.
     */
    private record RegionalBasket(Map<String, RegionalQuote> quoteByMappingId, String currency) {
        static final RegionalBasket NONE = new RegionalBasket(Map.of(), null);

        boolean active() {
            return currency != null;
        }

        RegionalQuote quote(String mappingId) {
            return quoteByMappingId.get(mappingId);
        }

        /** The course's list price for this order: regional when the basket is, else the plan's. */
        double listPrice(String mappingId, PaymentPlan plan) {
            RegionalQuote q = quoteByMappingId.get(mappingId);
            if (q != null) {
                return q.actualPrice().doubleValue();
            }
            return plan != null ? plan.getActualPrice() : 0d;
        }
    }

    /**
     * Never fails a checkout: any error resolving regional prices leaves the order on base
     * prices, i.e. exactly the flow that ran before regional pricing existed.
     *
     * @param vendor the gateway this order is charged through (already settled from the cart)
     */
    private RegionalBasket resolveRegionalBasket(Map<String, PaymentPlan> planByMappingId, ProductPage page,
                                                 String vendor) {
        try {
            return resolveRegionalBasketOrThrow(planByMappingId, page, vendor);
        } catch (Exception e) {
            log.warn("Regional pricing skipped for product page {}: {}", page.getCode(), e.getMessage());
            return RegionalBasket.NONE;
        }
    }

    private RegionalBasket resolveRegionalBasketOrThrow(Map<String, PaymentPlan> planByMappingId, ProductPage page,
                                                        String vendor) {
        if (regionalPriceResolver.hasCurrencyBoundSettings(page.getSettingsJson())) {
            return RegionalBasket.NONE;
        }
        Map<String, RegionalQuote> quotes = new LinkedHashMap<>();
        String currency = null;
        for (Map.Entry<String, PaymentPlan> e : planByMappingId.entrySet()) {
            if (e.getValue() == null || e.getValue().getActualPrice() <= 0) {
                continue;
            }
            Optional<RegionalQuote> q = regionalPriceResolver.quote(e.getValue(), vendor);
            if (q.isEmpty() || (currency != null && !currency.equals(q.get().currency()))) {
                return RegionalBasket.NONE;
            }
            currency = q.get().currency();
            quotes.put(e.getKey(), q.get());
        }
        return quotes.isEmpty() ? RegionalBasket.NONE : new RegionalBasket(quotes, currency);
    }

    // -------------------------------------------------------------------------
    // Step 1: form-submit — create user + ABANDONED_CART entries per invite
    // -------------------------------------------------------------------------

    @Transactional
    public ProductPageFormSubmitResponse submitProductPageForm(ProductPageFormSubmitRequest request) {
        log.info("Course page form submit for code={}, institute={}",
                request.getProductPageCode(), request.getInstituteId());

        List<ProductPageInviteMapping> selectedMappings = resolveMappings(
                request.getProductPageCode(), request.getInstituteId(),
                request.getSelectedPsInvitePaymentOptionIds());

        // Create / update user — ensure STUDENT role is assigned
        if (request.getUserDetails().getRoles() == null || request.getUserDetails().getRoles().isEmpty()) {
            request.getUserDetails().setRoles(java.util.List.of("STUDENT"));
        }
        UserDTO user = authService.createUserFromAuthServiceForLearnerEnrollment(
                request.getUserDetails(), request.getInstituteId(), false);

        studentRegistrationManager.createStudentFromRequest(
                user, mapToStudentExtraDetails(request.getLearnerExtraDetails()));

        // Create ABANDONED_CART entry for each selected invite's package session
        List<String> abandonedCartEntryIds = new ArrayList<>();
        for (ProductPageInviteMapping mapping : selectedMappings) {
            String packageSessionId = mapping.getPsInvitePaymentOption().getPackageSession().getId();

            PackageSession invitedSession = learnerEnrollmentEntryService
                    .findInvitedPackageSession(packageSessionId);

            PackageSession actualSession = packageSessionRepository.findById(packageSessionId)
                    .orElseThrow(() -> new VacademyException("PackageSession not found: " + packageSessionId));

            learnerEnrollmentEntryService.markPreviousEntriesAsDeleted(
                    user.getId(), invitedSession.getId(), packageSessionId, request.getInstituteId());

            // Pass the full UserDTO so the ABANDONED_CART workflow's webhook gets
            // #ctx['user'] populated — same shape as LEARNER_BATCH_ENROLLMENT.
            StudentSessionInstituteGroupMapping entry = learnerEnrollmentEntryService
                    .createOnlyDetailsFilledEntry(user.getId(), invitedSession, actualSession,
                            request.getInstituteId(), null, user);

            abandonedCartEntryIds.add(entry.getId());
        }

        // Save custom field values
        if (request.getCustomFieldValues() != null && !request.getCustomFieldValues().isEmpty()) {
            customFieldValueService.addCustomFieldValue(
                    request.getCustomFieldValues(),
                    CustomFieldValueSourceTypeEnum.USER.name(),
                    user.getId());
        }

        // Record the campaign that produced this person, HERE rather than after
        // payment: the next thing the browser does is leave for the gateway, so
        // a client-side beacon fired later would be lost on every abandoned
        // cart — precisely the population a campaign report needs to see.
        utmAttributionService.record(
                request.getInstituteId(),
                user.getId(),
                user.getEmail(),
                user.getMobileNumber(),
                "PRODUCT_PAGE",
                request.getProductPageCode(),
                request.getUtmParams());

        log.info("Form submitted for user={}, {} ABANDONED_CART entries created", user.getId(),
                abandonedCartEntryIds.size());
        return ProductPageFormSubmitResponse.builder()
                .userId(user.getId())
                .abandonedCartEntryIds(abandonedCartEntryIds)
                .message("Form submitted. Please proceed to payment.")
                .build();
    }

    // -------------------------------------------------------------------------
    // Step 2: enroll — combined payment + split fulfillment
    // Razorpay two-phase flow:
    // Phase 1 (razorpayPaymentId is absent): create order, return key+orderId, DO
    // NOT enroll yet
    // Phase 2 (razorpayPaymentId present): verify signature, create PAID log,
    // enroll
    // All other vendors: single call (FREE, Cashfree redirect, etc.)
    // -------------------------------------------------------------------------

    @Transactional
    public ProductPageEnrollResponse enrollForProductPage(ProductPageEnrollRequest request) {
        log.info("Course page enroll for code={}, institute={}",
                request.getProductPageCode(), request.getInstituteId());

        List<ProductPageInviteMapping> selectedMappings = resolveMappings(
                request.getProductPageCode(), request.getInstituteId(),
                request.getSelectedMappings().stream()
                        .map(ProductPageSelectedMappingDTO::getPsInvitePaymentOptionId)
                        .collect(Collectors.toList()));

        // Override vendor/vendorId from the invite of the first course in the cart
        // that costs something (gatewayInvite), and currency from the first
        // EnrollInvite (checkoutCurrency below replaces it with the priced
        // courses' one), so we always use the invites' configured payment gateway,
        // ignoring whatever the client sends. Settled before pricing, which has to
        // know whether this call is Razorpay Phase 2, so the courses' plans are
        // read here by the rule pricing locks them with, which Phase 1 and Phase 2
        // share (gatewayPlans): on an unchanged page the same cart picks the same
        // gateway in both. A page changed mid-payment is handled below.
        PaymentInitiationRequestDTO payReq = request.getPaymentInitiationRequest();
        EnrollInvite firstInvite = null;
        if (!selectedMappings.isEmpty()) {
            firstInvite = selectedMappings.get(0).getPsInvitePaymentOption().getEnrollInvite();
            EnrollInvite gatewayInvite = gatewayInvite(selectedMappings,
                    gatewayPlans(request.getSelectedMappings(), selectedMappings));
            if (gatewayInvite != firstInvite && !Objects.equals(gatewayInvite.getVendor(), firstInvite.getVendor())) {
                log.info("Product page checkout: the cart's first course (invite {}, gateway {}) is free; charging "
                        + "through the first priced course's gateway {} (invite {})", firstInvite.getId(),
                        firstInvite.getVendor(), gatewayInvite.getVendor(), gatewayInvite.getId());
            }
            if (gatewayInvite.getVendor() != null)
                payReq.setVendor(gatewayInvite.getVendor());
            if (gatewayInvite.getVendorId() != null)
                payReq.setVendorId(gatewayInvite.getVendorId());
            if (firstInvite.getCurrency() != null)
                payReq.setCurrency(firstInvite.getCurrency());
        }

        // Razorpay Phase 2 is the call the browser makes AFTER Razorpay has
        // captured the money for the order Phase 1 created (see below).
        boolean confirmsRazorpayPayment = payReq.getRazorpayRequest() != null
                && payReq.getRazorpayRequest().getRazorpayPaymentId() != null
                && !payReq.getRazorpayRequest().getRazorpayPaymentId().isBlank();
        // Phase 1 chose Razorpay by the plans the cart's courses were on then.
        // An admin who moves one of them between a free and a priced plan while
        // the Razorpay widget is open can make the rule above name another
        // course's gateway now, and so can an order opened by the release that
        // took the gateway from the cart's first course. The order is on record,
        // though: a genuine confirmation of an order a product-page Razorpay
        // Phase 1 opened is that order's Phase 2, through Razorpay and the
        // account the order was opened with, so the paid checkout completes
        // instead of being refused or sent to another gateway.
        if (confirmsRazorpayPayment && !"RAZORPAY".equalsIgnoreCase(payReq.getVendor())) {
            PaymentLog razorpayOrder = razorpayPhase1Order(payReq.getRazorpayRequest(), request.getInstituteId());
            if (razorpayOrder != null) {
                log.info("Product page checkout: completing Razorpay order {} (payment log {}) that Phase 1 opened, "
                        + "although the cart's courses now pick gateway {}",
                        payReq.getRazorpayRequest().getRazorpayOrderId(), razorpayOrder.getId(), payReq.getVendor());
                payReq.setVendor("RAZORPAY");
                payReq.setVendorId(razorpayOrder.getVendorId());
            }
        }
        boolean isRazorpay = "RAZORPAY".equalsIgnoreCase(payReq.getVendor());
        boolean isRazorpayPhase2 = isRazorpay && confirmsRazorpayPayment;

        // Validate + compute total server-side. Every line is priced on the plan
        // locked on its mapping, never on a plan the request picks (lockedPlanId).
        // Phase 2 never refuses a plan: the learner has already paid the price
        // Phase 1 checked. An admin who re-plans a course while the Razorpay
        // widget is open must not turn that paid checkout into an error, so a
        // stale plan resolves to the mapping's current one instead.
        double serverTotal = 0.0;
        Map<String, PaymentPlan> planByMappingId = new LinkedHashMap<>();
        for (ProductPageSelectedMappingDTO sel : request.getSelectedMappings()) {
            String planId = lockedPlanId(
                    sel.getPsInvitePaymentOptionId(), sel.getPaymentPlanId(), selectedMappings,
                    !isRazorpayPhase2);
            PaymentPlan plan = paymentPlanRepository.findById(planId)
                    .orElseThrow(() -> new VacademyException("PaymentPlan not found: " + planId));
            planByMappingId.put(sel.getPsInvitePaymentOptionId(), plan);
            serverTotal += plan.getActualPrice();
        }

        // Basket pricing. On a page that sells "any 3 for ₹799" the money is a
        // function of HOW MANY courses were picked, not of what each costs — so
        // when it is configured it REPLACES the sum above rather than
        // discounting it. Recomputed here because the client's figure is never
        // trusted; see BasketPricingCalculator.
        ProductPage pricingPage = coursePageRepository.findByCode(request.getProductPageCode())
                .orElseThrow(() -> new VacademyException(
                        "Course page not found: " + request.getProductPageCode()));

        // Regional pricing, resolved server-side from the viewer's country. When it applies,
        // every list price below is the regional one and the order is charged in its currency.
        RegionalBasket regional = resolveRegionalBasket(planByMappingId, pricingPage, payReq.getVendor());
        double baseTotal = serverTotal;
        if (regional.active()) {
            serverTotal = 0.0;
            for (Map.Entry<String, PaymentPlan> e : planByMappingId.entrySet()) {
                serverTotal += regional.listPrice(e.getKey(), e.getValue());
            }
            log.info("Product page {} priced regionally in {}: {} (base {})",
                    request.getProductPageCode(), regional.currency(), serverTotal, baseTotal);
        }

        // Each course's own price rides along: a DISCOUNT-basis page reduces
        // that sum rather than replacing it, so the single-subject rate is read
        // from the enroll invite's payment plan instead of being written down a
        // second time in the page settings.
        List<BasketPricingCalculator.BasketItem> basketItems = selectedMappings.stream()
                .map(m -> {
                    var ps = m.getPsInvitePaymentOption().getPackageSession();
                    PaymentPlan plan = planByMappingId.get(m.getPsInvitePaymentOption().getId());
                    return new BasketPricingCalculator.BasketItem(
                            ps.getLevel() != null ? ps.getLevel().getLevelName() : null,
                            ps.getPackageEntity() != null ? ps.getPackageEntity().getPackageName() : null,
                            regional.listPrice(m.getPsInvitePaymentOption().getId(), plan));
                })
                .collect(Collectors.toList());

        BasketPricingCalculator.BasketPrice basketPrice = basketPricingCalculator.price(
                pricingPage.getSettingsJson(), basketItems);

        double afterBundle = basketPrice != null ? basketPrice.getTotal() : serverTotal;

        // Predefined page offers ("₹99 off above ₹500"). Best one only, applied
        // before any coupon so a coupon discounts what would actually be paid.
        OfferCalculator.AppliedOffer offer = offerCalculator.bestOffer(
                pricingPage.getSettingsJson(), afterBundle, request.getSelectedMappings().size());
        double offerDiscount = offer != null ? offer.getAmount() : 0.0;
        double afterOffer = Math.max(0.0, afterBundle - offerDiscount);

        // Apply coupon discount if provided
        AppliedCouponDiscount couponDiscount = null;
        double discountAmount = 0.0;
        if (request.getCouponCode() != null && !request.getCouponCode().isBlank()) {
            // Coupon amounts and thresholds are in the base currency: on a regional basket
            // validate against the base total (no basket/offer ran, so afterOffer == serverTotal)
            // and scale the discount into the regional currency.
            double couponScale = regional.active() && baseTotal > 0 ? afterOffer / baseTotal : 1.0;
            ProductPageCouponValidateResponse couponResp = coursePageService.validateCoupon(
                    request.getProductPageCode(), request.getCouponCode(),
                    regional.active() ? baseTotal : afterOffer,
                    request.getSelectedMappings().size());
            if (!couponResp.isValid()) {
                throw new VacademyException("Coupon invalid: " + couponResp.getMessage());
            }
            couponDiscount = appliedCouponDiscountRepository.findById(couponResp.getAppliedCouponDiscountId())
                    .orElse(null);
            if (regional.active()) {
                discountAmount = couponResp.getDiscountValue() != null
                        ? Math.round(couponResp.getDiscountValue() * couponScale * 100.0) / 100.0
                        : 0.0;
            } else {
                // Exactly the pre-regional-pricing behaviour: the validator's figure, unrounded.
                discountAmount = couponResp.getDiscountValue() != null ? couponResp.getDiscountValue() : 0.0;
            }
        }

        double finalTotal = Math.max(0.0, afterOffer - discountAmount);

        payReq.setAmount(finalTotal);

        // One order is charged in one currency, and the server decides which.
        // A cart whose courses are priced in different currencies used to add
        // their prices up and charge the sum in the first course's currency
        // (₹299 for a $299 course), so it is refused here, before a user, a
        // payment log or an enrollment exists. Nothing is refused once the
        // money is taken (Razorpay Phase 2) or when nothing is charged (a free
        // cart). Free courses decide nothing (their currency is often just a
        // default label). When the priced courses name one currency it
        // replaces whatever the request carries; when none does (a cart of
        // free courses only, say), the request's value and the fallback below
        // stand as before.
        String serverCurrency = checkoutCurrency(selectedMappings, planByMappingId,
                !isRazorpayPhase2 && finalTotal > 0.0);
        if (serverCurrency != null) {
            payReq.setCurrency(serverCurrency);
        }
        if (regional.active()) {
            payReq.setCurrency(regional.currency());
        }

        // Defensive: ensure currency always has a value (Razorpay gateway requires it).
        // Fall back to any plan's currency, then to "INR".
        if (!StringUtils.hasText(payReq.getCurrency())) {
            String planCurrency = planByMappingId.values().stream()
                    .map(vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan::getCurrency)
                    .filter(c -> c != null && !c.isBlank())
                    .findFirst().orElse("INR");
            payReq.setCurrency(planCurrency);
            log.warn("Currency was missing from request; defaulted to {}", planCurrency);
        }

        // What each course actually costs, once the basket price, the page offer
        // and the coupon have all been applied, and the rule that got it there.
        // Computed here rather than beside finalTotal because the split rounds
        // to the CURRENCY's own minor unit, and the currency is only settled
        // above.
        OrderAllocation allocation = allocateOrder(
                request.getSelectedMappings(), selectedMappings, planByMappingId, regional,
                basketPrice, pricingPage, finalTotal, payReq.getCurrency());

        // Create / find user — use addLearnerRoute (same as learner/enroll) so the
        // STUDENT role is assigned in the auth-service user_role table.
        if (request.getUser().getRoles() == null || request.getUser().getRoles().isEmpty()) {
            request.getUser().setRoles(java.util.List.of("STUDENT"));
        }
        UserDTO user = authService.createUserFromAuthServiceForLearnerEnrollment(
                request.getUser(), request.getInstituteId(), false);
        payReq.setEmail(user.getEmail());

        // ── Razorpay Phase 1: order creation ──────────────────────────────────
        // (isRazorpay / isRazorpayPhase2 are settled above, before pricing.)

        // Free payment options (amount = 0) must never reach a payment gateway
        if (isRazorpay && !isRazorpayPhase2 && finalTotal > 0.0) {
            // Phase 1: create the Razorpay order + payment log (PAYMENT_PENDING), then
            // provision the enrollment in INVITED state — exactly like the redirect-gateway
            // branch below, and like /v1/learner/enroll does for the invite flow.
            //
            // Fulfilment used to live ONLY in Phase 2, which the learner's browser calls
            // after Razorpay Checkout succeeds. If that call never happened — tab closed,
            // redirect lost, network dropped between capture and callback — the money was
            // collected and nothing else: no UserPlan, an unlinked PaymentLog (so the
            // payment was invisible in Manage Payments), and the learner left sitting in the
            // ABANDONED_CART placeholder session with no course. The webhook could not
            // repair it either, because handlePostPaymentLogic() keys post-payment
            // processing off paymentLog.getUserPlan(), which was null.
            //
            // Creating the plan up-front makes the webhook self-sufficient: order.paid /
            // payment.captured now finds a linked plan and completes the enrollment on its
            // own. The Phase 2 callback stays the fast path, but it is no longer the only
            // path, so a lost browser can no longer cost a learner their course.
            PaymentResponseDTO gatewayResponse = paymentService.handlePaymentWithUser(
                    payReq, request.getInstituteId(), user, null);

            String paymentLogId = payReq.getOrderId();
            log.info("Razorpay Phase 1: order created, paymentLogId={}", paymentLogId);

            List<String> pendingEnrolledSessionIds = provisionPendingEnrollments(
                    request, selectedMappings, planByMappingId, regional, couponDiscount, discountAmount,
                    offer, offerDiscount, basketPrice, allocation, user, payReq, paymentLogId);

            String razorpayKeyId = null;
            String razorpayOrderId = null;
            if (gatewayResponse != null && gatewayResponse.getResponseData() != null) {
                Object k = gatewayResponse.getResponseData().get("razorpayKeyId");
                if (k instanceof String)
                    razorpayKeyId = (String) k;
                Object o = gatewayResponse.getResponseData().get("razorpayOrderId");
                if (o instanceof String)
                    razorpayOrderId = (String) o;
            }

            return ProductPageEnrollResponse.builder()
                    .paymentLogId(paymentLogId)
                    .userId(user.getId())
                    .status(PaymentStatusEnum.PAYMENT_PENDING.name())
                    .orderId(razorpayOrderId)
                    .razorpayKeyId(razorpayKeyId)
                    .enrolledPackageSessionIds(pendingEnrolledSessionIds)
                    .message("Razorpay order created. Please complete payment.")
                    .build();
        }

        // ── Razorpay Phase 2 / gateway-specific payment handling ─────────────
        boolean isManualVendor = "MANUAL".equalsIgnoreCase(payReq.getVendor());
        // True when payment is already confirmed synchronously (no webhook needed)
        boolean isGatewayPaidSync = false;
        String parentPaymentLogId;
        if (isRazorpayPhase2) {
            verifyRazorpaySignature(payReq, request.getInstituteId(), firstInvite);

            // Phase 1 already created the plan and linked it to the order's payment log, so
            // this callback must COMPLETE that enrollment rather than start a second one —
            // otherwise every paid learner ends up with a duplicate UserPlan and an orphan
            // gateway order. Mirrors completeGatewayPaymentConfirmation() in
            // LearnerEnrollRequestService, which solves the same problem for the invite flow.
            String gatewayOrderRef = payReq.getRazorpayRequest().getRazorpayOrderId();
            PaymentLog phase1Log = findPhase1PaymentLog(gatewayOrderRef);
            if (phase1Log != null) {
                log.info("Razorpay Phase 2: completing Phase 1 enrollment, parentPaymentLog={}", phase1Log.getId());

                // Drive this through the gateway order reference, exactly as the webhook
                // does, so the parent AND every child log it registered are marked PAID and
                // each child activates its own UserPlan. Idempotent with the webhook:
                // whichever of the two arrives second is a no-op, because
                // updatePaymentLogsByOrderId claims the PAID transition conditionally.
                paymentLogService.updatePaymentLog(
                        gatewayOrderRef, PaymentStatusEnum.PAID.name(), request.getInstituteId());

                // Activation (batch shift, credential mail, enrollment notifications, workflow)
                // is driven from applyOperationsOnFirstPayment via the line above. The coupon
                // code is the one post-enrollment action it does not cover, and generating it
                // is idempotent, so issue it here.
                try {
                    String inviteCode = selectedMappings.isEmpty() ? null
                            : selectedMappings.get(0).getPsInvitePaymentOption().getEnrollInvite().getInviteCode();
                    learnerCouponService.generateCouponCodeForLearner(
                            user.getId(), request.getInstituteId(), inviteCode);
                } catch (Exception e) {
                    log.error("Failed to generate coupon code for user={}: {}", user.getId(), e.getMessage(), e);
                }

                return ProductPageEnrollResponse.builder()
                        .paymentLogId(phase1Log.getId())
                        .userId(user.getId())
                        .status(PaymentStatusEnum.PAID.name())
                        .enrolledPackageSessionIds(selectedMappings.stream()
                                .map(m -> m.getPsInvitePaymentOption().getPackageSession().getId())
                                .collect(Collectors.toList()))
                        .message("Enrollment successful")
                        .loginCode(autoLoginService.issue(
                                pricingPage, phase1Log.getId(), user, request.getInstituteId()))
                        .build();
            }

            // No provisioned Phase 1 checkout to complete. Every product-page Razorpay
            // checkout provisions its enrollments in Phase 1, in the same transaction that
            // opens the order (provisionPendingEnrollments), so a paid order of THIS
            // checkout always has one. A confirmation without it carries a payment made
            // somewhere else - another flow's order, replayed here with its valid
            // signature - and enrolling from it handed out any cart, as PAID, for the
            // price of whatever was paid there. Refuse, as
            // LearnerEnrollRequestService.completeGatewayPaymentConfirmation does for the
            // invite flow; nothing has been created for this call yet.
            String razorpayPaymentId = payReq.getRazorpayRequest().getRazorpayPaymentId();
            log.warn("Razorpay Phase 2: no provisioned Phase 1 enrollment for razorpayOrderId={} "
                    + "(payment {}); refusing to enrol from the confirmation call.",
                    gatewayOrderRef, razorpayPaymentId);
            throw new VacademyException("We could not match this payment to your checkout. "
                    + "If money was taken, please contact the institute with payment id "
                    + razorpayPaymentId + ".");

        } else if (finalTotal <= 0.0) {
            // Free enrollment: bypass gateway entirely, create a PAID log directly
            parentPaymentLogId = paymentLogService.createPaymentLog(
                    user.getId(), 0.0, "MANUAL", null,
                    StringUtils.hasText(payReq.getCurrency()) ? payReq.getCurrency() : "INR",
                    null, null);
            paymentLogService.updatePaymentLog(parentPaymentLogId, "ACTIVE", PaymentStatusEnum.PAID.name(), "{}");
            appendUtmToPaymentLog(parentPaymentLogId, request.getUtmParams());
            payReq.setOrderId(parentPaymentLogId);
            isGatewayPaidSync = true;
            log.info("Free enrollment: gateway bypassed, created PAID log={}", parentPaymentLogId);
        } else if (isManualVendor) {
            // MANUAL payment: no online gateway; admin will confirm payment offline
            parentPaymentLogId = paymentLogService.createPaymentLog(
                    user.getId(), finalTotal, "MANUAL", null,
                    StringUtils.hasText(payReq.getCurrency()) ? payReq.getCurrency() : "INR",
                    null, null);
            paymentLogService.updatePaymentLog(parentPaymentLogId, "ACTIVE", PaymentStatusEnum.PAYMENT_PENDING.name(), "{}");
            appendUtmToPaymentLog(parentPaymentLogId, request.getUtmParams());
            payReq.setOrderId(parentPaymentLogId);
            log.info("MANUAL payment: gateway bypassed, PENDING log={}", parentPaymentLogId);
        } else {
            // Online paid gateway (Cashfree/PhonePe redirect, Stripe, Eway, etc.)
            PaymentResponseDTO gatewayResponse = paymentService.handlePaymentWithUser(
                    payReq, request.getInstituteId(), user, null);
            parentPaymentLogId = payReq.getOrderId();
            log.info("Combined payment initiated, parentPaymentLogId={}", parentPaymentLogId);

            // For redirect-based gateways (Cashfree etc.) return immediately
            String paymentUrl = null;
            if (gatewayResponse != null && gatewayResponse.getResponseData() != null) {
                Object urlObj = gatewayResponse.getResponseData().get("paymentUrl");
                if (urlObj instanceof String)
                    paymentUrl = (String) urlObj;
                // Detect synchronous PAID (Stripe charge_automatically, Eway, etc.)
                Object statusObj = gatewayResponse.getResponseData().get("paymentStatus");
                if (PaymentStatusEnum.PAID.name().equals(statusObj)) {
                    isGatewayPaidSync = true;
                }
            }
            if (paymentUrl != null) {
                // Redirect-based gateway (Cashfree/PhonePe): create UserPlan + SSIGM entries
                // in INVITED status now so the webhook can activate them when the gateway
                // confirms payment via applyOperationsOnFirstPayment().
                List<String> redirectEnrolledSessionIds = provisionPendingEnrollments(
                        request, selectedMappings, planByMappingId, regional, couponDiscount, discountAmount,
                        offer, offerDiscount, basketPrice, allocation, user, payReq,
                        parentPaymentLogId);

                log.info("Redirect gateway: created {} enrollment entries, linked userPlan to paymentLog={}",
                        redirectEnrolledSessionIds.size(), parentPaymentLogId);

                return ProductPageEnrollResponse.builder()
                        .paymentLogId(parentPaymentLogId)
                        .userId(user.getId())
                        .status("PAYMENT_PENDING")
                        .paymentUrl(paymentUrl)
                        .enrolledPackageSessionIds(redirectEnrolledSessionIds)
                        .message("Redirect to payment gateway")
                        .build();
            }
        }

        // ── Enroll per invite (shared by Phase 2 + non-Razorpay paid flows) ──
        List<String> enrolledSessionIds = new ArrayList<>();
        for (ProductPageSelectedMappingDTO sel : request.getSelectedMappings()) {
            ProductPageInviteMapping mapping = selectedMappings.stream()
                    .filter(m -> m.getPsInvitePaymentOption().getId().equals(sel.getPsInvitePaymentOptionId()))
                    .findFirst()
                    .orElseThrow();

            PackageSessionLearnerInvitationToPaymentOption bridge = mapping.getPsInvitePaymentOption();
            EnrollInvite invite = bridge.getEnrollInvite();
            PaymentPlan plan = planByMappingId.get(sel.getPsInvitePaymentOptionId());

            double charged = allocation.chargedFor(
                    sel.getPsInvitePaymentOptionId(), regional.listPrice(sel.getPsInvitePaymentOptionId(), plan));

            PaymentInitiationRequestDTO invitePayReq = clonePaymentRequest(payReq);
            invitePayReq.setAmount(charged);

            LearnerPackageSessionsEnrollDTO enrollDTO = new LearnerPackageSessionsEnrollDTO();
            enrollDTO.setPackageSessionIds(List.of(bridge.getPackageSession().getId()));
            enrollDTO.setPlanId(plan.getId());
            enrollDTO.setPaymentOptionId(bridge.getPaymentOption().getId());
            enrollDTO.setEnrollInviteId(invite.getId());
            enrollDTO.setReferRequest(request.getReferRequest());
            enrollDTO.setCustomFieldValues(filterFieldsForInvite(request.getCustomFieldValues(), invite.getId()));
            enrollDTO.setPaymentInitiationRequest(invitePayReq);

            vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan userPlan = userPlanService
                    .createUserPlan(
                            user.getId(), plan,
                            couponDiscount, invite,
                            bridge.getPaymentOption(), invitePayReq,
                            "INVITED", null, null, null,
                            regional.quote(sel.getPsInvitePaymentOptionId()));

            Map<String, Object> extraData = new HashMap<>();
            extraData.put("SKIP_PAYMENT_INITIATION", true);
            if (parentPaymentLogId != null) {
                extraData.put("PARENT_PAYMENT_LOG_ID", parentPaymentLogId);
            }
            if (isRazorpayPhase2 || isGatewayPaidSync) {
                // Payment already confirmed — activate enrollment immediately
                extraData.put("FORCE_PAID_STATUS", true);
            }

            LearnerEnrollResponseDTO enrollResp = oneTimePaymentOptionOperation.enrollLearnerToBatch(
                    user, enrollDTO, request.getInstituteId(),
                    invite, bridge.getPaymentOption(), userPlan, extraData,
                    request.getLearnerExtraDetails());

            enrolledSessionIds.add(bridge.getPackageSession().getId());
            log.info("Enrolled user={} in session={} for invite={}",
                    user.getId(), bridge.getPackageSession().getId(), invite.getId());

            if (enrollResp != null && enrollResp.getPaymentResponse() != null) {
                recordBasketAdjustment(enrollResp.getPaymentResponse().getOrderId(),
                        regional.listPrice(sel.getPsInvitePaymentOptionId(), plan), charged,
                        allocation.ruleFor(sel.getPsInvitePaymentOptionId()));
            }

            if (parentPaymentLogId != null) {
                createLineItem(parentPaymentLogId, invite.getId(), (int) Math.round(charged));
            }
        }

        if (parentPaymentLogId != null && basketPrice != null) {
            createLineItem(parentPaymentLogId,
                    "BASKET:" + request.getSelectedMappings().size() + "_COURSES",
                    (int) Math.round(basketPrice.getTotal()));
        }

        if (parentPaymentLogId != null && discountAmount > 0 && request.getCouponCode() != null) {
            createLineItem(parentPaymentLogId, "COUPON:" + request.getCouponCode(), -(int) Math.round(discountAmount));
        }

        boolean sendCredentialsNow = isRazorpayPhase2 || isGatewayPaidSync;
        triggerPostEnrollmentActions(user, request.getInstituteId(), selectedMappings, enrolledSessionIds,
                sendCredentialsNow);

        return ProductPageEnrollResponse.builder()
                .paymentLogId(parentPaymentLogId)
                .userId(user.getId())
                .status(isRazorpayPhase2 || isGatewayPaidSync ? PaymentStatusEnum.PAID.name() : "INITIATED")
                .enrolledPackageSessionIds(enrolledSessionIds)
                .message("Enrollment successful")
                .loginCode(isGatewayPaidSync
                        ? autoLoginService.issue(pricingPage, parentPaymentLogId, user, request.getInstituteId())
                        : null)
                .build();
    }

    // -------------------------------------------------------------------------
    // CPO enrollment without payment: creates UserPlan + SFP rows so the learner
    // can then select and pay individual installments via the open CPO fee endpoints.
    // -------------------------------------------------------------------------

    @Transactional
    public ProductPageEnrollResponse enrollCpoForProductPage(ProductPageCpoEnrollRequest request) {
        log.info("CPO enroll for product page code={}, institute={}",
                request.getProductPageCode(), request.getInstituteId());

        var page = coursePageRepository.findByCode(request.getProductPageCode())
                .orElseThrow(() -> new VacademyException("Product page not found: " + request.getProductPageCode()));
        if (!page.getInstituteId().equals(request.getInstituteId())) {
            throw new VacademyException("Product page does not belong to this institute");
        }

        List<ProductPageInviteMapping> pageMappings = mappingRepository
                .findOrderedWithBridge(page.getId(), List.of(STATUS_ACTIVE));
        ProductPageInviteMapping mapping = pageMappings
                .stream()
                .filter(m -> m.getPsInvitePaymentOption().getId().equals(request.getPsInvitePaymentOptionId()))
                .findFirst()
                .orElseThrow(() -> new VacademyException("Mapping not found: " + request.getPsInvitePaymentOptionId()));

        PackageSessionLearnerInvitationToPaymentOption bridge = mapping.getPsInvitePaymentOption();
        EnrollInvite invite = bridge.getEnrollInvite();

        // Validate that the payment option is actually CPO type
        if (!"CPO".equalsIgnoreCase(bridge.getPaymentOption().getType())) {
            throw new VacademyException("Payment option " + bridge.getPaymentOption().getId() + " is not CPO type");
        }

        // The plan locked on the mapping, as for one-time checkout (lockedPlanId).
        String planId = lockedPlanId(
                request.getPsInvitePaymentOptionId(), request.getPaymentPlanId(), pageMappings);
        PaymentPlan plan = paymentPlanRepository.findById(planId)
                .orElseThrow(() -> new VacademyException("PaymentPlan not found: " + planId));

        // Create / find user — ensure STUDENT role is assigned
        if (request.getUserDetails().getRoles() == null || request.getUserDetails().getRoles().isEmpty()) {
            request.getUserDetails().setRoles(java.util.List.of("STUDENT"));
        }
        UserDTO user = authService.createUserFromAuthServiceForLearnerEnrollment(
                request.getUserDetails(), request.getInstituteId(), false);

        studentRegistrationManager.createStudentFromRequest(
                user, mapToStudentExtraDetails(request.getLearnerExtraDetails()));

        // Save custom field values
        if (request.getCustomFieldValues() != null && !request.getCustomFieldValues().isEmpty()) {
            List<CustomFieldValueDTO> filteredFields = filterFieldsForInvite(
                    request.getCustomFieldValues(), invite.getId());
            customFieldValueService.addCustomFieldValue(
                    filteredFields, CustomFieldValueSourceTypeEnum.USER.name(), user.getId());
        }

        // Build the enroll DTO with no payment initiation request → CPO creates UserPlan + SFP rows
        LearnerPackageSessionsEnrollDTO enrollDTO = new LearnerPackageSessionsEnrollDTO();
        enrollDTO.setPackageSessionIds(List.of(bridge.getPackageSession().getId()));
        enrollDTO.setPlanId(plan.getId());
        enrollDTO.setPaymentOptionId(bridge.getPaymentOption().getId());
        enrollDTO.setEnrollInviteId(invite.getId());
        enrollDTO.setCustomFieldValues(
                filterFieldsForInvite(request.getCustomFieldValues(), invite.getId()));
        enrollDTO.setPaymentInitiationRequest(null); // no payment now

        vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan userPlan =
                userPlanService.createUserPlan(user.getId(), plan, null, invite,
                        bridge.getPaymentOption(), null, "ACTIVE");

        Map<String, Object> extraData = new HashMap<>();
        complexPaymentOptionOperation.enrollLearnerToBatch(
                user, enrollDTO, request.getInstituteId(),
                invite, bridge.getPaymentOption(), userPlan, extraData,
                request.getLearnerExtraDetails());

        // Send credentials (user was just created)
        try {
            String learnerPortalUrl = instituteRepository.findById(request.getInstituteId())
                    .map(Institute::getLearnerPortalBaseUrl)
                    .orElse(null);
            authService.createUserFromAuthServiceForLearnerEnrollment(user, request.getInstituteId(), true, learnerPortalUrl);
        } catch (Exception e) {
            log.error("Failed to send credentials for CPO product page user={}: {}", user.getId(), e.getMessage(), e);
        }

        log.info("CPO enrollment done (no payment) for user={}, userPlan={}", user.getId(), userPlan.getId());
        return ProductPageEnrollResponse.builder()
                .userId(user.getId())
                .userPlanId(userPlan.getId())
                .status("CPO_ENROLLED")
                .message("CPO enrollment created. Please select installments to pay.")
                .build();
    }

    /**
     * Creates the UserPlan + enrollment entries for a payment that has been initiated
     * but not yet confirmed, and links the first plan to the order's PaymentLog.
     *
     * <p>Plans are created in {@code INVITED} rather than {@code PENDING_FOR_PAYMENT}
     * deliberately: the learner has no access and no ledger obligation until the gateway
     * confirms, so an abandoned checkout leaves no phantom Due behind. The link to the
     * PaymentLog is what makes the payment webhook self-sufficient — without it
     * {@code handlePostPaymentLogic()} sees a null UserPlan, treats the payment as a
     * donation, and skips {@code applyOperationsOnFirstPayment()} entirely.
     *
     * @return the package session ids the learner was provisionally enrolled into
     */
    private List<String> provisionPendingEnrollments(
            ProductPageEnrollRequest request,
            List<ProductPageInviteMapping> selectedMappings,
            Map<String, PaymentPlan> planByMappingId,
            RegionalBasket regional,
            AppliedCouponDiscount couponDiscount,
            double discountAmount,
            OfferCalculator.AppliedOffer offer,
            double offerDiscount,
            BasketPricingCalculator.BasketPrice basketPrice,
            OrderAllocation allocation,
            UserDTO user,
            PaymentInitiationRequestDTO payReq,
            String parentPaymentLogId) {

        List<String> enrolledSessionIds = new ArrayList<>();
        List<String> childPaymentLogIds = new ArrayList<>();

        for (ProductPageSelectedMappingDTO sel : request.getSelectedMappings()) {
            ProductPageInviteMapping mapping = selectedMappings.stream()
                    .filter(m -> m.getPsInvitePaymentOption().getId().equals(sel.getPsInvitePaymentOptionId()))
                    .findFirst().orElseThrow();

            PackageSessionLearnerInvitationToPaymentOption bridge = mapping.getPsInvitePaymentOption();
            EnrollInvite invite = bridge.getEnrollInvite();
            PaymentPlan plan = planByMappingId.get(sel.getPsInvitePaymentOptionId());

            double charged = allocation.chargedFor(
                    sel.getPsInvitePaymentOptionId(), regional.listPrice(sel.getPsInvitePaymentOptionId(), plan));

            PaymentInitiationRequestDTO invitePayReq = clonePaymentRequest(payReq);
            invitePayReq.setAmount(charged);

            LearnerPackageSessionsEnrollDTO enrollDTO = new LearnerPackageSessionsEnrollDTO();
            enrollDTO.setPackageSessionIds(List.of(bridge.getPackageSession().getId()));
            enrollDTO.setPlanId(plan.getId());
            enrollDTO.setPaymentOptionId(bridge.getPaymentOption().getId());
            enrollDTO.setEnrollInviteId(invite.getId());
            enrollDTO.setReferRequest(request.getReferRequest());
            enrollDTO.setCustomFieldValues(
                    filterFieldsForInvite(request.getCustomFieldValues(), invite.getId()));
            enrollDTO.setPaymentInitiationRequest(invitePayReq);

            vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan userPlan =
                    userPlanService.createUserPlan(
                            user.getId(), plan, couponDiscount, invite,
                            bridge.getPaymentOption(), invitePayReq, "INVITED", null, null, null,
                            regional.quote(sel.getPsInvitePaymentOptionId()));

            Map<String, Object> extraData = new HashMap<>();
            extraData.put("SKIP_PAYMENT_INITIATION", true);
            extraData.put("PARENT_PAYMENT_LOG_ID", parentPaymentLogId);

            LearnerEnrollResponseDTO enrollResp = oneTimePaymentOptionOperation.enrollLearnerToBatch(
                    user, enrollDTO, request.getInstituteId(),
                    invite, bridge.getPaymentOption(), userPlan, extraData,
                    request.getLearnerExtraDetails());

            enrolledSessionIds.add(bridge.getPackageSession().getId());

            // Register EVERY child PaymentLog — including the first mapping's — on the
            // parent, so updatePaymentLogsByOrderId cascades the PAID transition to all
            // of them and each one activates its own UserPlan.
            //
            // The parent is deliberately left unlinked to a plan. It is tempting to link
            // it (that is what the redirect-gateway branch used to do for its first
            // mapping), but a linked PAID log posts a ledger CREDIT_PAYMENT, and
            // recordCreditPayment de-duplicates on the PaymentLog id — not the plan. A
            // linked parent carrying the ORDER TOTAL plus one linked child per course
            // therefore credits the learner total + every extra course price on a
            // multi-course checkout. Crediting only the children sums to exactly the
            // order total, and leaves the same row shape a successful checkout produces
            // today: parent PAID/unlinked, one PAID/linked child per course.
            //
            // That "sums to exactly the order total" only became true once the
            // children stopped carrying the plan's LIST price: a ₹949 basket of
            // four ₹349 subjects credited ₹1,396. They now carry their allocated
            // share instead — see allocateOrderTotal.
            if (enrollResp.getPaymentResponse() != null
                    && StringUtils.hasText(enrollResp.getPaymentResponse().getOrderId())) {
                childPaymentLogIds.add(enrollResp.getPaymentResponse().getOrderId());
                recordBasketAdjustment(enrollResp.getPaymentResponse().getOrderId(),
                        regional.listPrice(sel.getPsInvitePaymentOptionId(), plan), charged,
                        allocation.ruleFor(sel.getPsInvitePaymentOptionId()));
            }

            if (parentPaymentLogId != null) {
                createLineItem(parentPaymentLogId, invite.getId(), (int) Math.round(charged));
            }
        }

        // Pricing breakdown on the parent, in the order the money was computed:
        // basket total, then the page offer, then the coupon.
        if (parentPaymentLogId != null && basketPrice != null) {
            createLineItem(parentPaymentLogId,
                    "BASKET:" + request.getSelectedMappings().size() + "_COURSES",
                    (int) Math.round(basketPrice.getTotal()));
        }

        if (parentPaymentLogId != null && offer != null && offerDiscount > 0) {
            createLineItem(parentPaymentLogId, "OFFER:" + offer.getId(),
                    -(int) Math.round(offerDiscount));
        }

        if (parentPaymentLogId != null && discountAmount > 0 && request.getCouponCode() != null) {
            createLineItem(parentPaymentLogId, "COUPON:" + request.getCouponCode(),
                    -(int) Math.round(discountAmount));
        }

        appendUtmToPaymentLog(parentPaymentLogId, request.getUtmParams());

        // Record the children on the parent. This is what lets the payment webhook reach
        // them: updatePaymentLogsByOrderId resolves the parent from the gateway order
        // reference, reads childPaymentLogIds out of its payment_specific_data, and marks
        // the whole set PAID — at which point each child drives applyOperationsOnFirstPayment
        // for its own UserPlan. Without this the webhook would see a parent with no plan,
        // treat the payment as a donation, and enrol nobody.
        if (!childPaymentLogIds.isEmpty() && parentPaymentLogId != null) {
            paymentLogRepository.findById(parentPaymentLogId).ifPresent(parentLog -> {
                String existingData = parentLog.getPaymentSpecificData();
                Map<String, Object> data = existingData != null
                        ? JsonUtil.fromJson(existingData, Map.class) : new HashMap<>();
                if (data == null) data = new HashMap<>();
                data.put("childPaymentLogIds", childPaymentLogIds);
                parentLog.setPaymentSpecificData(JsonUtil.toJson(data));
                paymentLogRepository.save(parentLog);
            });
        }

        return enrolledSessionIds;
    }

    /**
     * Finds the parent PaymentLog of a gateway order that already carries a provisioned
     * enrollment, so the confirmation call can complete it instead of duplicating it.
     *
     * <p>The gateway order reference lives inside {@code payment_specific_data}, and the
     * parent is the earliest log mentioning it. Provisioning is recognised by the
     * {@code childPaymentLogIds} entry that {@link #provisionPendingEnrollments} writes
     * there — that, not a linked UserPlan, is what the parent carries.
     *
     * <p>Returns {@code null} when there is nothing to complete - the order was not
     * opened by a product-page checkout. The caller then refuses the confirmation.
     */
    private PaymentLog findPhase1PaymentLog(String gatewayOrderRef) {
        if (!StringUtils.hasText(gatewayOrderRef)) {
            return null;
        }
        try {
            return paymentLogRepository.findAllByOrderIdInJson(gatewayOrderRef)
                    .stream()
                    .filter(pl -> hasProvisionedChildren(pl))
                    .min(Comparator.comparing(PaymentLog::getCreatedAt))
                    .orElse(null);
        } catch (Exception e) {
            log.warn("Could not look up the originating payment log for gateway order {}: {}",
                    gatewayOrderRef, e.getMessage());
            return null;
        }
    }

    private boolean hasProvisionedChildren(PaymentLog paymentLog) {
        if (!StringUtils.hasText(paymentLog.getPaymentSpecificData())) {
            return false;
        }
        try {
            Map<String, Object> data = JsonUtil.fromJson(paymentLog.getPaymentSpecificData(), Map.class);
            if (data == null) {
                return false;
            }
            Object children = data.get("childPaymentLogIds");
            return children instanceof List && !((List<?>) children).isEmpty();
        } catch (Exception e) {
            return false;
        }
    }

    private void verifyRazorpaySignature(PaymentInitiationRequestDTO payReq, String instituteId,
            EnrollInvite firstInvite) {
        try {
            Map<String, Object> gatewayData = institutePaymentGatewayMappingService
                    .findInstitutePaymentGatewaySpecifData(payReq.getVendor(), instituteId);
            // The secret Phase 1 created the order with, read the way
            // RazorpayPaymentManager reads it. Without one no order can have
            // been created, so a confirmation that cannot be verified is
            // refused. Skipping the check instead enrolled a made-up payment
            // id whenever the institute's Razorpay mapping had no secret -
            // also on pages whose invite names no gateway, where the request
            // names RAZORPAY itself.
            String keySecret = razorpayKeySecret(gatewayData);
            if (keySecret == null) {
                log.warn("Razorpay key secret not configured for institute {}; refusing an unverifiable payment",
                        instituteId);
                throw new VacademyException("Razorpay payment could not be verified");
            }
            String razorpayOrderId = payReq.getRazorpayRequest().getRazorpayOrderId();
            String razorpayPaymentId = payReq.getRazorpayRequest().getRazorpayPaymentId();
            String signature = payReq.getRazorpayRequest().getRazorpaySignature();
            if (razorpayOrderId == null || razorpayPaymentId == null || signature == null) {
                throw new VacademyException("Missing Razorpay verification fields");
            }
            if (!razorpaySignatureMatches(keySecret, razorpayOrderId, razorpayPaymentId, signature)) {
                throw new VacademyException("Razorpay payment signature verification failed");
            }
            log.info("Razorpay signature verified for orderId={}", razorpayOrderId);
        } catch (VacademyException ve) {
            throw ve;
        } catch (Exception e) {
            throw new VacademyException("Razorpay signature verification error: " + e.getMessage());
        }
    }

    /**
     * Whether a signature is the one Razorpay gives a payment of an order:
     * the hex HMAC-SHA256 of "orderId|paymentId" under the key secret,
     * compared in constant time.
     */
    private static boolean razorpaySignatureMatches(String keySecret, String razorpayOrderId,
                                                    String razorpayPaymentId, String signature) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(keySecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] hash = mac.doFinal((razorpayOrderId + "|" + razorpayPaymentId).getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : hash)
            hex.append(String.format("%02x", b));
        return MessageDigest.isEqual(hex.toString().getBytes(StandardCharsets.UTF_8),
                signature.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * The parent payment log of the Razorpay order a confirmation call pays,
     * when the call is genuine and the order is a product-page checkout's:
     * the signature verifies with the institute's Razorpay secret, and a
     * Razorpay Phase 1 opened the order and provisioned its enrollments
     * (findPhase1PaymentLog). Null otherwise. Nothing is refused or changed
     * here; the Phase 2 branch verifies the call again before it completes
     * anything. The signature is checked first, so a made-up confirmation
     * never costs the order lookup, which searches the payment logs' JSON.
     */
    private PaymentLog razorpayPhase1Order(RazorpayRequestDTO confirmation, String instituteId) {
        String orderId = confirmation.getRazorpayOrderId();
        String paymentId = confirmation.getRazorpayPaymentId();
        String signature = confirmation.getRazorpaySignature();
        if (!StringUtils.hasText(orderId) || !StringUtils.hasText(paymentId) || !StringUtils.hasText(signature)) {
            return null;
        }
        try {
            String keySecret = razorpayKeySecret(institutePaymentGatewayMappingService
                    .findInstitutePaymentGatewaySpecifData("RAZORPAY", instituteId));
            if (keySecret == null || !razorpaySignatureMatches(keySecret, orderId, paymentId, signature)) {
                return null;
            }
        } catch (Exception e) {
            // No Razorpay set up for the institute: no order of its can be confirmed.
            return null;
        }
        PaymentLog phase1Log = findPhase1PaymentLog(orderId);
        return phase1Log != null && "RAZORPAY".equalsIgnoreCase(phase1Log.getVendor()) ? phase1Log : null;
    }

    /** publishableKey, else keySecret: the precedence RazorpayPaymentManager creates orders with. */
    private static String razorpayKeySecret(Map<String, Object> gatewayData) {
        if (gatewayData == null) {
            return null;
        }
        for (String key : List.of("publishableKey", "keySecret")) {
            Object value = gatewayData.get(key);
            if (value instanceof String && StringUtils.hasText((String) value)) {
                return (String) value;
            }
        }
        return null;
    }

    private void triggerPostEnrollmentActions(
            UserDTO user,
            String instituteId,
            List<ProductPageInviteMapping> enrolledMappings,
            List<String> enrolledPackageSessionIds,
            boolean sendCredentials) {

        // Resolve learner portal URL the same way learner/v1/enroll does it
        String learnerPortalUrl = instituteRepository.findById(instituteId)
                .map(Institute::getLearnerPortalBaseUrl)
                .orElse(null);

        // 1. Credential email — honours the sendCredentials flag.
        // For PAID enrollments the webhook will call this again with
        // sendCredentials=true
        // once payment is confirmed; for FREE / Razorpay-Phase2 we send it now.
        try {
            authService.createUserFromAuthServiceForLearnerEnrollment(
                    user, instituteId, sendCredentials, learnerPortalUrl);
            log.info("Post-enrollment credential email triggered for user={}, sendCredentials={}",
                    user.getId(), sendCredentials);
        } catch (Exception e) {
            log.error("Failed to send credential email for user={}: {}", user.getId(), e.getMessage(), e);
        }

        // 2. Coupon code — idempotent; safe to call even if user was created earlier
        if (sendCredentials) {
            try {
                String inviteCode = enrolledMappings.isEmpty() ? null
                        : enrolledMappings.get(0).getPsInvitePaymentOption().getEnrollInvite().getInviteCode();
                learnerCouponService.generateCouponCodeForLearner(user.getId(), instituteId, inviteCode);
                log.info("Coupon code generated for user={}", user.getId());
            } catch (Exception e) {
                log.error("Failed to generate coupon code for user={}: {}", user.getId(), e.getMessage(), e);
            }
        }

        // 3. Workflow trigger — one run per package session (same as learner/v1/enroll)
        if (!sendCredentials) {
            // Paid enrollment: workflow will fire after payment webhook confirms
            return;
        }
        for (String packageSessionId : enrolledPackageSessionIds) {
            try {
                PackageSession ps = packageSessionRepository.findById(packageSessionId).orElse(null);
                if (ps == null || !learnerEnrollmentEntryService.hasWorkflowConfiguration(ps)) {
                    continue;
                }
                List<String> workflowIds = learnerEnrollmentEntryService.getWorkflowIds(ps);
                for (String workflowId : workflowIds) {
                    try {
                        Map<String, Object> ctx = new HashMap<>();
                        ctx.put("instituteIdForWhatsapp", instituteId);
                        ctx.put("package_session_id", packageSessionId);
                        ctx.put("destination_package_session_id", packageSessionId);
                        ctx.put("name", user.getFullName());

                        Map<String, Object> userMap = new HashMap<>();
                        userMap.put("phone_number", user.getMobileNumber());
                        userMap.put("name", user.getFullName());
                        userMap.put("username", user.getEmail() != null
                                ? user.getEmail().split("@")[0]
                                : user.getId());
                        userMap.put("user_id", user.getId());
                        userMap.put("email", user.getEmail());
                        ctx.put("users", List.of(userMap));

                        workflowEngineService.run(workflowId, ctx);
                        log.info("Workflow {} triggered for user={}, session={}",
                                workflowId, user.getId(), packageSessionId);
                    } catch (Exception e) {
                        log.error("Workflow {} failed for user={}: {}",
                                workflowId, user.getId(), e.getMessage(), e);
                    }
                }
            } catch (Exception e) {
                log.error("Post-enrollment workflow step failed for session={}: {}", packageSessionId, e.getMessage(),
                        e);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    private List<ProductPageInviteMapping> resolveMappings(
            String coursePageCode, String instituteId, List<String> psInvitePoIds) {

        var page = coursePageRepository.findByCode(coursePageCode)
                .orElseThrow(() -> new VacademyException("Course page not found: " + coursePageCode));

        if (!page.getInstituteId().equals(instituteId)) {
            throw new VacademyException("Course page does not belong to this institute");
        }

        // In display order, with each bridge row loaded in the same query. The
        // first selected course that costs something decides the gateway below
        // (gatewayInvite), so the order must be the page's own rather than
        // whatever the database returns.
        List<ProductPageInviteMapping> activeMappings = mappingRepository
                .findOrderedWithBridge(page.getId(), List.of(STATUS_ACTIVE));

        Set<String> activePoIds = activeMappings.stream()
                .map(m -> m.getPsInvitePaymentOption().getId())
                .collect(Collectors.toSet());

        for (String id : psInvitePoIds) {
            if (!activePoIds.contains(id)) {
                throw new VacademyException("Mapping " + id + " is not part of this course page");
            }
        }

        return activeMappings.stream()
                .filter(m -> psInvitePoIds.contains(m.getPsInvitePaymentOption().getId()))
                .collect(Collectors.toList());
    }

    static final String PRICE_CHANGED_MESSAGE =
            "The price of a course in your cart has changed. Please reload the page and try again.";

    static final String MIXED_CURRENCY_MESSAGE =
            "These courses are priced in different currencies. Please check them out separately.";

    /**
     * The currency a product-page order is charged in, decided by the server
     * rather than the request.
     *
     * Each course that costs something is charged in its invite's currency,
     * or its plan's when the invite names none: the rule this checkout has
     * always used for the first course, now applied to every priced course in
     * the cart. When they all agree (ignoring case and blanks) that one code
     * is the order's currency. When none names a currency the answer is null,
     * and the caller keeps what it did before. When they disagree there is no
     * single currency to charge: with refuseMixed that is a 409
     * (ConflictException), otherwise null.
     *
     * A free course (no plan, or a plan priced 0) decides nothing. It adds
     * nothing to the order (allocateOrderTotal gives it no share of a priced
     * cart), and its currency is often only a default label: a free plan is
     * created in INR by the server and in GBP by the admin app when no
     * currency is picked. A paid AUD course and a free orientation labelled
     * INR are one AUD order, whichever comes first. A cart of free courses
     * only (also on a basket-priced page whose courses are all 0, where the
     * basket sets the money) gets null, so today's fallback stands for it.
     *
     * A priced course whose invite and plan name different currencies is
     * charged in its invite's, exactly as a single-course checkout of it is
     * charged today; that misconfiguration is logged, not refused.
     *
     * Visible for testing.
     *
     * @param selectedMappings the courses in the order, with their bridge rows
     * @param planByBridgeId   each course's plan, by bridge row id
     * @param refuseMixed      true refuses courses in different currencies
     */
    static String checkoutCurrency(List<ProductPageInviteMapping> selectedMappings,
                                   Map<String, PaymentPlan> planByBridgeId, boolean refuseMixed) {
        Set<String> currencies = new TreeSet<>();
        for (ProductPageInviteMapping m : selectedMappings) {
            PackageSessionLearnerInvitationToPaymentOption bridge = m.getPsInvitePaymentOption();
            PaymentPlan plan = planByBridgeId.get(bridge.getId());
            if (plan == null || plan.getActualPrice() <= 0) {
                continue;
            }
            EnrollInvite invite = bridge.getEnrollInvite();
            String inviteCurrency = currencyCode(invite != null ? invite.getCurrency() : null);
            String planCurrency = currencyCode(plan.getCurrency());
            if (inviteCurrency != null && planCurrency != null && !inviteCurrency.equals(planCurrency)) {
                log.warn("Product page checkout: bridge {} is charged in its invite's currency {} "
                        + "although its plan {} is priced in {}", bridge.getId(), inviteCurrency,
                        plan.getId(), planCurrency);
            }
            String code = inviteCurrency != null ? inviteCurrency : planCurrency;
            if (code != null) {
                currencies.add(code);
            }
        }
        if (currencies.size() == 1) {
            return currencies.iterator().next();
        }
        if (currencies.size() > 1 && refuseMixed) {
            log.warn("Product page checkout refused: the cart mixes currencies {}", currencies);
            throw new ConflictException(MIXED_CURRENCY_MESSAGE);
        }
        return null;
    }

    /** A currency code as gateways expect it (trimmed, upper case); null when blank. */
    private static String currencyCode(String raw) {
        return StringUtils.hasText(raw) ? raw.trim().toUpperCase(Locale.ROOT) : null;
    }

    /**
     * The invite whose payment gateway charges a product-page order: the
     * first selected course, in display order, that costs something (a plan
     * priced above 0), else the first selected course.
     *
     * A free course adds nothing to the order, and its gateway is often a
     * fallback its invite got before the institute set one up, so it never
     * decides how the priced courses are paid: a free STRIPE orientation
     * first in a cart of RAZORPAY courses used to send the whole order to
     * Stripe. This is the rule checkoutCurrency applies to the currency, and
     * the one by-code shows the page's gateway by
     * (ProductPageService.gatewayMapping). A cart of free courses only (also
     * a basket-priced one, whose courses are all 0) keeps the first course's
     * invite, as before; so does a cart whose first course is priced.
     *
     * Visible for testing.
     *
     * @param selectedMappings the courses in the order, in display order, with their bridge rows; not empty
     * @param planByBridgeId   each course's plan, by bridge row id
     */
    static EnrollInvite gatewayInvite(List<ProductPageInviteMapping> selectedMappings,
                                      Map<String, PaymentPlan> planByBridgeId) {
        for (ProductPageInviteMapping m : selectedMappings) {
            PaymentPlan plan = planByBridgeId.get(m.getPsInvitePaymentOption().getId());
            if (plan != null && plan.getActualPrice() > 0) {
                return m.getPsInvitePaymentOption().getEnrollInvite();
            }
        }
        return selectedMappings.get(0).getPsInvitePaymentOption().getEnrollInvite();
    }

    /**
     * Each selected course's plan by bridge row id, read before pricing so
     * gatewayInvite can tell the priced courses from the free ones: the plan
     * pricedPlanId resolves, which is the plan pricing locks the course on
     * for every request it accepts, in Razorpay Phase 1 and Phase 2 alike.
     * Nothing is refused here; pricing below still refuses what it refused
     * before, in the same order. A course whose plan cannot be read counts
     * as free.
     */
    private Map<String, PaymentPlan> gatewayPlans(List<ProductPageSelectedMappingDTO> selections,
                                                  List<ProductPageInviteMapping> selectedMappings) {
        Map<String, PaymentPlan> plans = new HashMap<>();
        for (ProductPageSelectedMappingDTO sel : selections) {
            String bridgeId = sel.getPsInvitePaymentOptionId();
            String planId = pricedPlanId(bridgeId, sel.getPaymentPlanId(), selectedMappings);
            if (planId != null) {
                paymentPlanRepository.findById(planId).ifPresent(plan -> plans.put(bridgeId, plan));
            }
        }
        return plans;
    }

    /**
     * The plan a selected course is priced and enrolled on: the plan the page
     * locked on that course's mapping, never one the request picks.
     *
     * Nothing in the learner app lets a visitor choose among a payment
     * option's plans. The cart sends each mapping's own payment_plan_id back,
     * and plan tiles choose between MAPPINGS, each still on its locked plan
     * (PlanTiles groups mappings by payment_plan_id). The server used to price
     * whatever plan id arrived, so a crafted request could buy any course on
     * any plan it could name, at that plan's price and validity.
     *
     * A request naming no plan gets the locked one. A page that maps one
     * bridge row more than once, on different plans, accepts each of those
     * plans as it always has. Anything else is refused before any user,
     * payment or enrollment is created. It is refused with 409 Conflict
     * (ConflictException, logged as a warning rather than an error), so a
     * client can tell "the page changed under you: reload it" from other errors.
     *
     * Visible for testing.
     *
     * @param pageMappings the page's ACTIVE mappings (at least every one on this bridge row)
     */
    static String lockedPlanId(String psInvitePaymentOptionId, String requestedPlanId,
                               List<ProductPageInviteMapping> pageMappings) {
        return lockedPlanId(psInvitePaymentOptionId, requestedPlanId, pageMappings, true);
    }

    /**
     * {@link #lockedPlanId(String, String, List)}, with a choice for a plan the
     * mapping does not sell (any more).
     *
     * @param refuseUnlocked true refuses such a plan with 409. False resolves it
     *                       to the mapping's current locked plan instead: for a
     *                       call that must not fail because the money is
     *                       already taken (Razorpay Phase 2). Pricing stays on
     *                       locked plans either way.
     */
    static String lockedPlanId(String psInvitePaymentOptionId, String requestedPlanId,
                               List<ProductPageInviteMapping> pageMappings, boolean refuseUnlocked) {
        Set<String> locked = lockedPlanIds(psInvitePaymentOptionId, pageMappings);
        if (locked.isEmpty()) {
            throw new VacademyException("Mapping " + psInvitePaymentOptionId + " is not part of this course page");
        }
        if (!StringUtils.hasText(requestedPlanId)) {
            return locked.iterator().next();
        }
        String requested = requestedPlanId.trim();
        if (locked.contains(requested)) {
            return requested;
        }
        if (!refuseUnlocked) {
            String current = locked.iterator().next();
            log.warn("Product page checkout: plan {} for bridge {} is no longer the one the page sells ({}); "
                    + "the payment is already taken, so the line completes on {}",
                    requested, psInvitePaymentOptionId, locked, current);
            return current;
        }
        log.warn("Product page checkout refused plan {} for bridge {}: the page sells it on {}",
                requested, psInvitePaymentOptionId, locked);
        throw new ConflictException(PRICE_CHANGED_MESSAGE);
    }

    /**
     * The plan a course is priced on when lockedPlanId accepts the request:
     * the requested plan when the page locks it on that course's mapping,
     * else the mapping's own locked plan (what Razorpay Phase 2 resolves a
     * stale plan to). It never refuses and never logs, and never names a plan
     * the page does not lock; null when the page locks no plan on the row.
     *
     * Visible for testing.
     */
    static String pricedPlanId(String psInvitePaymentOptionId, String requestedPlanId,
                               List<ProductPageInviteMapping> pageMappings) {
        Set<String> locked = lockedPlanIds(psInvitePaymentOptionId, pageMappings);
        if (locked.isEmpty()) {
            return null;
        }
        String requested = StringUtils.hasText(requestedPlanId) ? requestedPlanId.trim() : null;
        return requested != null && locked.contains(requested) ? requested : locked.iterator().next();
    }

    /** The plans the page locks on a bridge row's mappings, in page order. */
    private static Set<String> lockedPlanIds(String psInvitePaymentOptionId,
                                             List<ProductPageInviteMapping> pageMappings) {
        Set<String> locked = new LinkedHashSet<>();
        for (ProductPageInviteMapping m : pageMappings) {
            if (m.getPsInvitePaymentOption() != null
                    && Objects.equals(m.getPsInvitePaymentOption().getId(), psInvitePaymentOptionId)
                    && StringUtils.hasText(m.getPaymentPlanId())) {
                locked.add(m.getPaymentPlanId());
            }
        }
        return locked;
    }

    private PaymentInitiationRequestDTO clonePaymentRequest(PaymentInitiationRequestDTO source) {
        PaymentInitiationRequestDTO clone = new PaymentInitiationRequestDTO();
        clone.setVendor(source.getVendor());
        clone.setVendorId(source.getVendorId());
        clone.setCurrency(source.getCurrency());
        clone.setInstituteId(source.getInstituteId());
        clone.setEmail(source.getEmail());
        clone.setStripeRequest(source.getStripeRequest());
        clone.setRazorpayRequest(source.getRazorpayRequest());
        clone.setEwayRequest(source.getEwayRequest());
        clone.setCashfreeRequest(source.getCashfreeRequest());
        clone.setPhonePeRequest(source.getPhonePeRequest());
        clone.setChargeAutomatically(source.isChargeAutomatically());
        clone.setIncludePendingItems(source.isIncludePendingItems());
        return clone;
    }

    private List<CustomFieldValueDTO> filterFieldsForInvite(
            List<CustomFieldValueDTO> allValues, String inviteId) {
        if (allValues == null)
            return Collections.emptyList();
        return allValues.stream()
                .filter(v -> v.getEnrollInviteIds() == null
                        || v.getEnrollInviteIds().isEmpty()
                        || v.getEnrollInviteIds().contains(inviteId))
                .collect(Collectors.toList());
    }

    private void createLineItem(String paymentLogId, String sourceId, double amount) {
        paymentLogRepository.findById(paymentLogId).ifPresent(log -> {
            PaymentLogLineItem item = new PaymentLogLineItem();
            item.setPaymentLog(log);
            item.setType(LINE_ITEM_TYPE);
            item.setSource("ENROLL_INVITE");
            item.setSourceId(sourceId);
            item.setAmount(amount);
            paymentLogLineItemRepository.save(item);
        });
    }

    private void createLineItem(String paymentLogId, String type, String source, String sourceId, double amount) {
        paymentLogRepository.findById(paymentLogId).ifPresent(log -> {
            PaymentLogLineItem item = new PaymentLogLineItem();
            item.setPaymentLog(log);
            item.setType(type);
            item.setSource(source);
            item.setSourceId(sourceId);
            item.setAmount(amount);
            paymentLogLineItemRepository.save(item);
        });
    }

    /**
     * What one product-page order charged for each course, and the pricing rule
     * that arrived at it.
     *
     * Both travel together because both are per-course facts about the SAME
     * split, and both are needed at the same two places — the money on the
     * course's payment log, the rule as the label on its invoice's discount row.
     */
    private record OrderAllocation(
            Map<String, Double> chargedByMapping,
            Map<String, String> ruleByMapping,
            String fallbackRule) {

        double chargedFor(String psInvitePaymentOptionId, double listPrice) {
            return chargedByMapping.getOrDefault(psInvitePaymentOptionId, listPrice);
        }

        String ruleFor(String psInvitePaymentOptionId) {
            return ruleByMapping.getOrDefault(psInvitePaymentOptionId, fallbackRule);
        }
    }

    /**
     * Builds the per-course split for one order: what each course was charged,
     * and the label of the rule that priced it.
     *
     * The rule label comes from the pricing engine itself ("Class 5 — EMS combo
     * + 1 more", "Class 5 — full pack"), so the reduction booked on a learner's
     * invoice names the rule the admin actually configured rather than a fixed
     * phrase invented here. When the page prices per course and no basket rule
     * ran, the page's own name stands in.
     */
    private OrderAllocation allocateOrder(
            List<ProductPageSelectedMappingDTO> selections,
            List<ProductPageInviteMapping> selectedMappings,
            Map<String, PaymentPlan> planByMappingId,
            RegionalBasket regional,
            BasketPricingCalculator.BasketPrice basketPrice,
            ProductPage page,
            double orderTotal,
            String currency) {

        Map<String, String> ruleByMapping = new LinkedHashMap<>();
        // Parallel to the item list handed to the calculator, which was built
        // from selectedMappings in this same order — so zip by position rather
        // than assuming the request's ordering matches.
        List<String> ruleLabels = basketPrice != null ? basketPrice.getItemLabels() : List.of();
        for (int i = 0; i < selectedMappings.size() && i < ruleLabels.size(); i++) {
            ruleByMapping.put(
                    selectedMappings.get(i).getPsInvitePaymentOption().getId(), ruleLabels.get(i));
        }

        String fallback = page != null && StringUtils.hasText(page.getName())
                ? page.getName()
                : "Bundle";

        return new OrderAllocation(
                allocateOrderTotal(selections, planByMappingId, regional, orderTotal, currency),
                ruleByMapping,
                fallback);
    }

    /**
     * Splits the ORDER TOTAL across the courses that order bought.
     *
     * Every downstream record of a product-page order is PER COURSE — one child
     * PaymentLog, one invoice, one ledger credit, one UserPlan payment amount —
     * and every one of them used to be stamped with the payment plan's LIST
     * price. On a page that prices the basket as a whole that records more money
     * than the gateway ever took: a real ₹949 checkout for four ₹349 subjects
     * produced four ₹349 invoices (₹1,396), four confirmation emails quoting
     * ₹349, and credited the learner's ledger ₹1,396. The learner sees "₹349
     * paid" against each subject and cannot reconcile it with their bank.
     *
     * Allocated in proportion to list price, in minor units, with the remainder
     * handed to the largest lines — so the parts sum EXACTLY to what was
     * charged, whatever the basket price, page offer and coupon did to it.
     * Courses with no list price share the total evenly, which is the only
     * meaningful split when nothing distinguishes them.
     *
     * @return psInvitePaymentOptionId → what that course actually cost
     */
    private Map<String, Double> allocateOrderTotal(
            List<ProductPageSelectedMappingDTO> selections,
            Map<String, PaymentPlan> planByMappingId,
            RegionalBasket regional,
            double orderTotal,
            String currency) {

        Map<String, Double> out = new LinkedHashMap<>();
        int n = selections.size();
        if (n == 0) {
            return out;
        }

        double[] listPrices = new double[n];
        double listTotal = 0;
        for (int i = 0; i < n; i++) {
            String mappingId = selections.get(i).getPsInvitePaymentOptionId();
            listPrices[i] = regional.listPrice(mappingId, planByMappingId.get(mappingId));
            listTotal += listPrices[i];
        }

        double[] shares = splitProportionally(listPrices, orderTotal, minorUnitScale(currency));
        for (int i = 0; i < n; i++) {
            out.put(selections.get(i).getPsInvitePaymentOptionId(), shares[i]);
        }
        return out;
    }

    /**
     * The money arithmetic behind {@link #allocateOrderTotal}, kept separate
     * from the entities so it can be tested for the one property that matters:
     * the parts sum to the whole, exactly, for every basket.
     *
     * Visible for testing.
     */
    static double[] splitProportionally(double[] weights, double total, int scale) {
        int n = weights.length;
        double[] out = new double[n];
        if (n == 0) {
            return out;
        }
        double weightTotal = 0;
        for (double w : weights) {
            weightTotal += Math.max(0d, w);
        }

        // The smallest unit this currency can actually be paid in. Splitting a
        // JPY order into hundredths would invent money that no gateway can
        // charge and no invoice can print; a KWD order rounded to hundredths
        // would lose a real decimal place.
        long factor = (long) Math.pow(10, Math.max(0, scale));
        long totalMinor = Math.round(Math.max(0d, total) * factor);
        long[] shares = new long[n];
        long assigned = 0;
        for (int i = 0; i < n; i++) {
            // An even split when nothing is priced — proportional to zero is
            // undefined, and handing the whole total to one course is worse.
            double weight = weightTotal > 0 ? Math.max(0d, weights[i]) / weightTotal : 1d / n;
            shares[i] = (long) Math.floor(totalMinor * weight);
            assigned += shares[i];
        }

        // Flooring loses up to n-1 minor units. Give them to the most expensive
        // lines first, so the rounding lands where it is least visible.
        double[] ranking = weights.clone();
        long remainder = totalMinor - assigned;
        while (remainder > 0) {
            int pick = 0;
            for (int i = 1; i < n; i++) {
                if (ranking[i] > ranking[pick]) {
                    pick = i;
                }
            }
            // Charge the picked line and take it out of the running so the next
            // unit goes elsewhere; equal prices are then served in order.
            shares[pick] += 1;
            ranking[pick] = Double.NEGATIVE_INFINITY;
            remainder--;
        }

        for (int i = 0; i < n; i++) {
            out[i] = (double) shares[i] / factor;
        }
        return out;
    }

    /**
     * How many decimal places this currency is actually paid in — 2 for INR and
     * USD, 0 for JPY, 3 for KWD. Read from the JDK's own currency table rather
     * than assumed, so a page selling in any of them allocates in units that
     * exist. Unknown or missing codes fall back to 2, which is what the rest of
     * this flow already assumes when it rounds.
     *
     * Visible for testing.
     */
    static int minorUnitScale(String currency) {
        if (!StringUtils.hasText(currency)) {
            return 2;
        }
        try {
            int digits = java.util.Currency.getInstance(currency.trim().toUpperCase())
                    .getDefaultFractionDigits();
            // -1 marks a pseudo-currency (XXX, XAU); those have no minor unit.
            return Math.max(0, digits);
        } catch (Exception e) {
            log.warn("Unknown currency '{}' — allocating order total to 2 decimal places", currency);
            return 2;
        }
    }

    /**
     * Records, on the COURSE's own payment log, the gap between its list price
     * and what the order actually charged for it.
     *
     * The invoice prints the plan's gross price as the course line and subtracts
     * discount line items from it, so without this a ₹349 course on a ₹238 line
     * renders as "Course ₹349 … Total ₹238" — arithmetic that reads as a bug to
     * the parent holding the receipt.
     */
    private void recordBasketAdjustment(String childPaymentLogId, double listPrice, double charged,
            String priceRuleLabel) {
        if (childPaymentLogId == null) {
            return;
        }
        int reduction = (int) Math.round(listPrice) - (int) Math.round(charged);
        if (reduction <= 0) {
            return;
        }
        // Net off whatever the enrolment path has ALREADY written to this log —
        // handlePaymentWithoutGateway records a coupon line item of its own, and
        // that coupon is also inside `charged`. Booking the whole gap on top of
        // it would print two discounts on one invoice that together overshoot
        // the plan price. Netting makes the lines sum to exactly list − paid,
        // whichever discounts got there first.
        int alreadyRecorded = paymentLogRepository.findById(childPaymentLogId)
                .map(paymentLogLineItemRepository::findByPaymentLog)
                .map(existing -> existing.stream()
                        .filter(item -> item.getAmount() != null && item.getAmount() < 0)
                        .mapToDouble(item -> -item.getAmount())
                        .sum())
                .map(sum -> (int) Math.round(sum))
                .orElse(0);
        reduction -= alreadyRecorded;
        if (reduction <= 0) {
            return;
        }
        // Negative is the canonical convention for this column (see
        // calculateDiscountAmount); the type must contain DISCOUNT to be listed.
        createLineItem(childPaymentLogId, "BASKET_DISCOUNT", priceRuleLabel, null, -reduction);
    }

    private void appendUtmToPaymentLog(String paymentLogId, Map<String, String> utmParams) {
        if (paymentLogId == null || utmParams == null || utmParams.isEmpty()) return;
        try {
            paymentLogRepository.findById(paymentLogId).ifPresent(paymentLog -> {
                String existing = paymentLog.getPaymentSpecificData();
                Map<String, Object> data = (existing != null && !existing.isBlank())
                        ? JsonUtil.fromJson(existing, Map.class) : new HashMap<>();
                if (data == null) data = new HashMap<>();
                data.putAll(utmParams);
                paymentLog.setPaymentSpecificData(JsonUtil.toJson(data));
                paymentLogRepository.save(paymentLog);
            });
        } catch (Exception e) {
            log.warn("Failed to append UTM params to paymentLog={}: {}", paymentLogId, e.getMessage());
        }
    }

    private vacademy.io.admin_core_service.features.institute_learner.dto.StudentExtraDetails mapToStudentExtraDetails(
            LearnerExtraDetails extra) {
        if (extra == null)
            return null;
        var d = new vacademy.io.admin_core_service.features.institute_learner.dto.StudentExtraDetails();
        d.setFathersName(extra.getFathersName());
        d.setMothersName(extra.getMothersName());
        d.setParentsMobileNumber(extra.getParentsMobileNumber());
        d.setParentsEmail(extra.getParentsEmail());
        return d;
    }
}
