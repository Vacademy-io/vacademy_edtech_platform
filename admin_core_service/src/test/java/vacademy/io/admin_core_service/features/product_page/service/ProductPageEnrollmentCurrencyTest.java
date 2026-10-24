package vacademy.io.admin_core_service.features.product_page.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceResolver;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.service.CustomFieldValueService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.institute_learner.manager.StudentRegistrationManager;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerEnrollmentEntryService;
import vacademy.io.admin_core_service.features.learner.service.LearnerCouponService;
import vacademy.io.admin_core_service.features.learner_payment_option_operation.service.ComplexPaymentOptionOperation;
import vacademy.io.admin_core_service.features.learner_payment_option_operation.service.OneTimePaymentOptionOperation;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.payments.service.PaymentService;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageEnrollRequest;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageEnrollResponse;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageSelectedMappingDTO;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPageInviteMapping;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageInviteMappingRepository;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogLineItemRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.utm_attribution.service.UtmAttributionService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowEngineService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollResponseDTO;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.common.payment.dto.RazorpayRequestDTO;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * One product-page order is charged in one currency, and the server decides
 * which: every course's invite currency, or its plan's when the invite names
 * none. A cart whose courses disagree is refused (409) before a user, a
 * payment log or an enrollment exists, and the request's own currency never
 * overrides one the courses name. Razorpay Phase 2 (the money is taken) and
 * free carts are never refused. The order goes through one gateway too: the
 * invite's of the first course in the cart that costs something, never a
 * free course's (the first course's when none costs anything). A genuine
 * Razorpay confirmation completes the order Phase 1 opened, whatever the
 * cart's courses cost by then.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ProductPageEnrollmentCurrencyTest {

    private static final String CODE = "store1";
    private static final String INSTITUTE = "inst-1";

    @Mock private ProductPageRepository coursePageRepository;
    @Mock private ProductPageInviteMappingRepository mappingRepository;
    @Mock private PackageSessionRepository packageSessionRepository;
    @Mock private PaymentPlanRepository paymentPlanRepository;
    @Mock private StudentRegistrationManager studentRegistrationManager;
    @Mock private LearnerEnrollmentEntryService learnerEnrollmentEntryService;
    @Mock private CustomFieldValueService customFieldValueService;
    @Mock private PaymentService paymentService;
    @Mock private UserPlanService userPlanService;
    @Mock private OneTimePaymentOptionOperation oneTimePaymentOptionOperation;
    @Mock private ComplexPaymentOptionOperation complexPaymentOptionOperation;
    @Mock private PaymentLogRepository paymentLogRepository;
    @Mock private PaymentLogLineItemRepository paymentLogLineItemRepository;
    @Mock private AppliedCouponDiscountRepository appliedCouponDiscountRepository;
    @Mock private BasketPricingCalculator basketPricingCalculator;
    @Mock private OfferCalculator offerCalculator;
    @Mock private ProductPageService coursePageService;
    @Mock private PaymentLogService paymentLogService;
    @Mock private InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;
    @Mock private AuthService authService;
    @Mock private LearnerCouponService learnerCouponService;
    @Mock private WorkflowEngineService workflowEngineService;
    @Mock private InstituteRepository instituteRepository;
    @Mock private UtmAttributionService utmAttributionService;
    // Unstubbed: quote() is empty, so every cart stays on base prices.
    @Mock private RegionalPriceResolver regionalPriceResolver;

    @InjectMocks private ProductPageEnrollmentService service;

    private final List<ProductPageInviteMapping> pageMappings = new ArrayList<>();
    private final Map<String, PaymentPlan> plans = new HashMap<>();
    private final UserDTO learner = new UserDTO();

    @BeforeEach
    void setUp() {
        ProductPage page = new ProductPage();
        page.setId("page-1");
        page.setCode(CODE);
        page.setName("Store");
        page.setInstituteId(INSTITUTE);
        page.setStatus("ACTIVE");
        when(coursePageRepository.findByCode(CODE)).thenReturn(Optional.of(page));
        when(mappingRepository.findOrderedWithBridge(eq("page-1"), any())).thenAnswer(i -> pageMappings);
        when(paymentPlanRepository.findById(anyString()))
                .thenAnswer(i -> Optional.ofNullable(plans.get((String) i.getArgument(0))));

        learner.setId("user-1");
        learner.setEmail("learner@example.com");
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), anyString(), anyBoolean()))
                .thenReturn(learner);
        when(paymentLogService.createPaymentLog(anyString(), anyDouble(), anyString(), any(), anyString(), any(), any()))
                .thenReturn("log-1");
    }

    /**
     * A course on the page, in display order, sold through an invite naming
     * {@code vendor} and {@code inviteCurrency} on a plan priced in
     * {@code planCurrency}. Any of the three may be null.
     */
    private ProductPageInviteMapping course(String id, double price, String vendor, String inviteCurrency,
                                            String planCurrency) {
        PaymentPlan plan = new PaymentPlan();
        plan.setId("plan-" + id);
        plan.setName("plan-" + id);
        plan.setStatus("ACTIVE");
        plan.setActualPrice(price);
        plan.setCurrency(planCurrency);
        plans.put(plan.getId(), plan);

        PackageEntity pkg = new PackageEntity();
        pkg.setPackageName("Course " + id);
        PackageSession ps = new PackageSession();
        ps.setId("ps-" + id);
        ps.setPackageEntity(pkg);
        EnrollInvite invite = new EnrollInvite();
        invite.setId("inv-" + id);
        invite.setVendor(vendor);
        invite.setCurrency(inviteCurrency);
        invite.setInviteCode("CODE-" + id);
        PaymentOption option = new PaymentOption();
        option.setId("po-" + id);
        option.setType("ONE_TIME");
        PackageSessionLearnerInvitationToPaymentOption bridge = new PackageSessionLearnerInvitationToPaymentOption();
        bridge.setId("psli-" + id);
        bridge.setStatus("ACTIVE");
        bridge.setEnrollInvite(invite);
        bridge.setPackageSession(ps);
        bridge.setPaymentOption(option);
        ProductPageInviteMapping m = new ProductPageInviteMapping();
        m.setId("map-" + id);
        m.setPsInvitePaymentOption(bridge);
        m.setPaymentPlanId(plan.getId());
        m.setStatus("ACTIVE");
        pageMappings.add(m);
        return m;
    }

    /** The request the learner app sends for these courses, carrying the client's currency. */
    private static ProductPageEnrollRequest checkout(String clientVendor, String clientCurrency, String... ids) {
        List<ProductPageSelectedMappingDTO> selections = new ArrayList<>();
        for (String id : ids) {
            ProductPageSelectedMappingDTO sel = new ProductPageSelectedMappingDTO();
            sel.setPsInvitePaymentOptionId("psli-" + id);
            sel.setPaymentPlanId("plan-" + id);
            sel.setAmount(0d);
            selections.add(sel);
        }
        ProductPageEnrollRequest req = new ProductPageEnrollRequest();
        req.setProductPageCode(CODE);
        req.setInstituteId(INSTITUTE);
        req.setSelectedMappings(selections);
        UserDTO user = new UserDTO();
        user.setEmail("learner@example.com");
        req.setUser(user);
        PaymentInitiationRequestDTO pay = new PaymentInitiationRequestDTO();
        pay.setVendor(clientVendor);
        pay.setCurrency(clientCurrency);
        req.setPaymentInitiationRequest(pay);
        return req;
    }

    /** What the gateway was asked to charge, for an online gateway that answers synchronously (Stripe and the like). */
    private PaymentInitiationRequestDTO charged() {
        ArgumentCaptor<PaymentInitiationRequestDTO> captor = ArgumentCaptor.forClass(PaymentInitiationRequestDTO.class);
        verify(paymentService).handlePaymentWithUser(captor.capture(), eq(INSTITUTE), any(), isNull());
        return captor.getValue();
    }

    /* ── mixed carts ───────────────────────────────────────────────────── */

    @Test
    @DisplayName("a cart mixing rupee and dollar courses is refused with 409 before anything is created")
    void mixedCurrenciesAreRefused() {
        course("x", 499, "STRIPE", "INR", "INR");
        course("y", 299, "STRIPE", "USD", "USD");

        ConflictException e = assertThrows(ConflictException.class,
                () -> service.enrollForProductPage(checkout("STRIPE", "INR", "x", "y")));

        assertEquals(ProductPageEnrollmentService.MIXED_CURRENCY_MESSAGE, e.getMessage());
        assertEquals("These courses are priced in different currencies. Please check them out separately.",
                e.getMessage());
        verifyNoInteractions(authService, studentRegistrationManager, paymentService, paymentLogService,
                paymentLogRepository, paymentLogLineItemRepository, userPlanService, oneTimePaymentOptionOperation,
                learnerEnrollmentEntryService, utmAttributionService, workflowEngineService);
    }

    @Test
    @DisplayName("the refusal does not depend on which course comes first, nor on where the currency is named")
    void mixedCurrenciesAreRefusedWhateverTheOrder() {
        // The dollar course is first in display order, and names its currency only on its plan.
        course("y", 299, "STRIPE", null, "USD");
        course("x", 499, "STRIPE", "inr", "INR");

        assertThrows(ConflictException.class,
                () -> service.enrollForProductPage(checkout("STRIPE", "USD", "x", "y")));

        verifyNoInteractions(authService, paymentService, paymentLogService, userPlanService,
                oneTimePaymentOptionOperation);
    }

    @Test
    @DisplayName("a free cart charges nothing, so mixed currencies still enroll")
    void freeMixedCartStillEnrolls() {
        course("x", 0, null, "INR", "INR");
        course("y", 0, null, "USD", "USD");

        ProductPageEnrollResponse res = service.enrollForProductPage(checkout("FREE", "INR", "x", "y"));

        assertEquals("PAID", res.getStatus());
        assertEquals(List.of("ps-x", "ps-y"), res.getEnrolledPackageSessionIds());
        verifyNoInteractions(paymentService);
    }

    /* ── free courses decide nothing ───────────────────────────────────── */

    @Test
    @DisplayName("a paid AUD course and a free course labelled INR are one AUD order, not a 409")
    void freeCourseBesideAPaidOneIsNotAMix() {
        // The server creates a free plan in INR, and a default invite copies it.
        course("a", 499, "EWAY", "AUD", "AUD");
        course("free", 0, "EWAY", "INR", "INR");

        ProductPageEnrollResponse res = service.enrollForProductPage(checkout("EWAY", "AUD", "a", "free"));

        PaymentInitiationRequestDTO charged = charged();
        assertEquals("AUD", charged.getCurrency());
        assertEquals(499.0, charged.getAmount());
        assertEquals(List.of("ps-a", "ps-free"), res.getEnrolledPackageSessionIds());
    }

    @Test
    @DisplayName("a free course first in the cart does not set the currency: the paid course's does")
    void freeCourseFirstDoesNotSetTheCurrency() {
        course("free", 0, "EWAY", "INR", "INR");
        course("a", 499, "EWAY", "AUD", "AUD");

        // The learner app sends the page's currency, read from its first course.
        service.enrollForProductPage(checkout("EWAY", "INR", "free", "a"));

        PaymentInitiationRequestDTO charged = charged();
        assertEquals("AUD", charged.getCurrency());
        assertEquals(499.0, charged.getAmount());
    }

    @Test
    @DisplayName("a basket-priced page whose courses are all free is never refused, and keeps the first course's currency")
    void basketOfFreeCoursesIsNeverRefused() {
        // FLAT basket pricing: every course is 0 and the basket sets the money.
        // Their labels disagree (the admin app writes GBP when no currency is picked).
        course("x", 0, "STRIPE", "INR", "INR");
        course("y", 0, "STRIPE", null, "GBP");
        when(basketPricingCalculator.price(any(), any())).thenReturn(new BasketPricingCalculator.BasketPrice(799, 0));

        service.enrollForProductPage(checkout("STRIPE", "INR", "x", "y"));

        PaymentInitiationRequestDTO charged = charged();
        assertEquals("INR", charged.getCurrency());
        assertEquals(799.0, charged.getAmount());
    }

    @Test
    @DisplayName("the rule ignores free courses: no plan, or a plan priced 0")
    void checkoutCurrencyIgnoresFreeCourses() {
        ProductPageInviteMapping paid = course("p", 10, null, "AUD", "AUD");
        ProductPageInviteMapping free = course("f", 0, null, "INR", "INR");
        ProductPageInviteMapping freeGbp = course("g", 0, null, null, "GBP");
        ProductPageInviteMapping noPlan = course("n", 10, null, "USD", "USD");
        Map<String, PaymentPlan> byBridge = new HashMap<>();
        for (ProductPageInviteMapping m : List.of(paid, free, freeGbp)) {
            byBridge.put(m.getPsInvitePaymentOption().getId(), plans.get(m.getPaymentPlanId()));
        }

        assertEquals("AUD", ProductPageEnrollmentService.checkoutCurrency(List.of(free, paid, freeGbp), byBridge, true));
        assertEquals("AUD", ProductPageEnrollmentService.checkoutCurrency(List.of(paid, noPlan), byBridge, true));
        // Free courses only: nothing decides, and nothing is refused.
        assertNull(ProductPageEnrollmentService.checkoutCurrency(List.of(free, freeGbp), byBridge, true));
    }

    /* ── the server decides the currency ───────────────────────────────── */

    @Test
    @DisplayName("an invite with no currency is charged in its plan's, never in the currency the request names")
    void clientCurrencyNeverOverridesThePlanCurrency() {
        course("a", 4999, "STRIPE", null, "INR");

        service.enrollForProductPage(checkout("STRIPE", "JPY", "a"));

        PaymentInitiationRequestDTO charged = charged();
        assertEquals("INR", charged.getCurrency());
        assertEquals(4999.0, charged.getAmount());
    }

    @Test
    @DisplayName("an invite's currency beats the request's, written the way gateways expect it")
    void inviteCurrencyBeatsTheRequest() {
        course("a", 59, "STRIPE", " usd ", "USD");

        service.enrollForProductPage(checkout("STRIPE", "INR", "a"));

        assertEquals("USD", charged().getCurrency());
    }

    @Test
    @DisplayName("a single-currency cart is charged exactly as before: its currency, the sum of its prices")
    void singleCurrencyCartUnchanged() {
        course("a", 4999, "STRIPE", "INR", "INR");
        course("b", 999, "STRIPE", "INR", "INR");

        service.enrollForProductPage(checkout("STRIPE", "INR", "a", "b"));

        PaymentInitiationRequestDTO charged = charged();
        assertEquals("INR", charged.getCurrency());
        assertEquals("STRIPE", charged.getVendor());
        assertEquals(5998.0, charged.getAmount());
    }

    @Test
    @DisplayName("a request that names no currency still gets the courses' one")
    void missingRequestCurrencyUsesTheCourses() {
        course("a", 4999, "STRIPE", "INR", "INR");

        service.enrollForProductPage(checkout("STRIPE", null, "a"));

        assertEquals("INR", charged().getCurrency());
    }

    @Test
    @DisplayName("a course whose invite and plan disagree is charged in its invite's currency, as a single checkout always was")
    void inviteAndPlanDisagreeing() {
        course("a", 4999, "STRIPE", "INR", "USD");

        service.enrollForProductPage(checkout("STRIPE", "USD", "a"));

        assertEquals("INR", charged().getCurrency());
    }

    @Test
    @DisplayName("when no course names a currency, the request's value and the INR fallback stand as before")
    void noServerCurrencyKeepsTodaysBehaviour() {
        course("a", 4999, "STRIPE", null, null);

        service.enrollForProductPage(checkout("STRIPE", "EUR", "a"));
        assertEquals("EUR", charged().getCurrency());
    }

    @Test
    @DisplayName("when nothing names a currency at all, the order falls back to INR as before")
    void noCurrencyAnywhereFallsBackToInr() {
        course("a", 4999, "STRIPE", null, " ");

        service.enrollForProductPage(checkout("STRIPE", null, "a"));

        assertEquals("INR", charged().getCurrency());
    }

    @Test
    @DisplayName("the rule itself: one code wins, blanks and case are ignored, a disagreement is refused or left open")
    void checkoutCurrencyRule() {
        ProductPageInviteMapping a = course("a", 1, null, "inr", "INR");
        ProductPageInviteMapping b = course("b", 1, null, null, " INR ");
        ProductPageInviteMapping c = course("c", 1, null, "", null);
        ProductPageInviteMapping d = course("d", 1, null, null, "USD");
        Map<String, PaymentPlan> byBridge = new HashMap<>();
        for (ProductPageInviteMapping m : pageMappings) {
            byBridge.put(m.getPsInvitePaymentOption().getId(), plans.get(m.getPaymentPlanId()));
        }

        assertEquals("INR", ProductPageEnrollmentService.checkoutCurrency(List.of(a, b, c), byBridge, true));
        assertNull(ProductPageEnrollmentService.checkoutCurrency(List.of(c), byBridge, true));
        assertNull(ProductPageEnrollmentService.checkoutCurrency(List.of(a, d), byBridge, false));
        ConflictException e = assertThrows(ConflictException.class,
                () -> ProductPageEnrollmentService.checkoutCurrency(List.of(a, d), byBridge, true));
        assertEquals(ProductPageEnrollmentService.MIXED_CURRENCY_MESSAGE, e.getMessage());
    }

    /* ── Razorpay ──────────────────────────────────────────────────────── */

    private static final String RAZORPAY_SECRET = "rzp-test-secret";
    private static final String ORDER = "order_ABC";
    private static final String PAYMENT = "pay_XYZ";

    /** Phase 2 as RazorpayCheckoutForm sends it: the courses plus the paid order and its signature. */
    private static ProductPageEnrollRequest phase2(String... ids) throws Exception {
        ProductPageEnrollRequest req = checkout("RAZORPAY", "INR", ids);
        RazorpayRequestDTO rzp = new RazorpayRequestDTO();
        rzp.setRazorpayOrderId(ORDER);
        rzp.setRazorpayPaymentId(PAYMENT);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(RAZORPAY_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        StringBuilder hex = new StringBuilder();
        for (byte b : mac.doFinal((ORDER + "|" + PAYMENT).getBytes(StandardCharsets.UTF_8))) {
            hex.append(String.format("%02x", b));
        }
        rzp.setRazorpaySignature(hex.toString());
        req.getPaymentInitiationRequest().setRazorpayRequest(rzp);
        return req;
    }

    /** The parent payment log a Razorpay Phase 1 left for the order, with its gateway and provisioned children. */
    private PaymentLog phase1Log() {
        PaymentLog parent = new PaymentLog();
        parent.setId("phase1-log");
        parent.setVendor("RAZORPAY");
        parent.setVendorId("rzp-account");
        parent.setCreatedAt(LocalDateTime.now().minusMinutes(3));
        parent.setPaymentSpecificData("{\"razorpayOrderId\":\"" + ORDER + "\",\"childPaymentLogIds\":[\"child-1\"]}");
        when(paymentLogRepository.findAllByOrderIdInJson(ORDER)).thenReturn(List.of(parent));
        return parent;
    }

    @Test
    @DisplayName("Razorpay Phase 2 completes a paid order even when its courses are priced in different currencies")
    void phase2IsNeverRefused() throws Exception {
        course("x", 499, "RAZORPAY", "INR", "INR");
        course("y", 299, "RAZORPAY", "USD", "USD");
        when(institutePaymentGatewayMappingService.findInstitutePaymentGatewaySpecifData("RAZORPAY", INSTITUTE))
                .thenReturn(Map.of("keySecret", RAZORPAY_SECRET));
        phase1Log();

        ProductPageEnrollResponse res = service.enrollForProductPage(phase2("x", "y"));

        assertEquals("PAID", res.getStatus());
        assertEquals("phase1-log", res.getPaymentLogId());
        verify(paymentLogService).updatePaymentLog(ORDER, "PAID", INSTITUTE);
        verifyNoInteractions(paymentService, userPlanService, oneTimePaymentOptionOperation);
    }

    @Test
    @DisplayName("Razorpay Phase 1 of a mixed cart is refused: no order is created")
    void phase1OfAMixedCartIsRefused() {
        course("x", 499, "RAZORPAY", "INR", "INR");
        course("y", 299, "RAZORPAY", "USD", "USD");

        assertThrows(ConflictException.class,
                () -> service.enrollForProductPage(checkout("RAZORPAY", "INR", "x", "y")));

        verifyNoInteractions(paymentService, paymentLogService, userPlanService, authService);
    }

    @Test
    @DisplayName("a Razorpay confirmation that cannot be verified (no key secret configured) enrolls nobody")
    void phase2WithoutASecretIsRefused() throws Exception {
        course("a", 4999, null, "INR", "INR"); // the invite names no gateway: the request's RAZORPAY is used
        when(institutePaymentGatewayMappingService.findInstitutePaymentGatewaySpecifData("RAZORPAY", INSTITUTE))
                .thenReturn(Map.of("apiKey", "rzp_live_key"));
        when(paymentLogRepository.findAllByOrderIdInJson(anyString())).thenReturn(List.of());

        VacademyException e = assertThrows(VacademyException.class,
                () -> service.enrollForProductPage(phase2("a")));

        assertEquals("Razorpay payment could not be verified", e.getMessage());
        verify(paymentLogService, never()).createPaymentLog(anyString(), anyDouble(), anyString(), any(), anyString(),
                any(), any());
        verify(paymentLogService, never()).updatePaymentLog(anyString(), anyString(), anyString());
        verifyNoInteractions(userPlanService, oneTimePaymentOptionOperation, paymentService);
    }

    @Test
    @DisplayName("a blank publishableKey falls back to keySecret, the secret the order was created with")
    void phase2ReadsTheSecretLikeOrderCreation() throws Exception {
        course("a", 4999, "RAZORPAY", "INR", "INR");
        Map<String, Object> gatewayData = new HashMap<>();
        gatewayData.put("publishableKey", " ");
        gatewayData.put("keySecret", RAZORPAY_SECRET);
        when(institutePaymentGatewayMappingService.findInstitutePaymentGatewaySpecifData("RAZORPAY", INSTITUTE))
                .thenReturn(gatewayData);
        phase1Log();

        ProductPageEnrollResponse res = service.enrollForProductPage(phase2("a"));

        assertEquals("PAID", res.getStatus());
        verify(paymentLogService).updatePaymentLog(ORDER, "PAID", INSTITUTE);
    }

    /* ── the gateway: the first priced course's ────────────────────────── */

    /** Razorpay answers Phase 1 with an order; each course's enrollment is provisioned without a child log. */
    private void razorpayOrder() {
        PaymentResponseDTO order = new PaymentResponseDTO();
        order.setResponseData(Map.of("razorpayKeyId", "rzp_key", "razorpayOrderId", ORDER));
        when(paymentService.handlePaymentWithUser(any(), eq(INSTITUTE), any(), isNull())).thenReturn(order);
        when(oneTimePaymentOptionOperation.enrollLearnerToBatch(any(), any(), anyString(), any(), any(), any(), any(),
                any())).thenReturn(new LearnerEnrollResponseDTO());
    }

    private static EnrollInvite inviteOf(ProductPageInviteMapping m) {
        return m.getPsInvitePaymentOption().getEnrollInvite();
    }

    @Test
    @DisplayName("a free course first in the cart does not pick the gateway: the first priced course's invite does")
    void freeCourseFirstDoesNotPickTheGateway() {
        // A free orientation labelled INR on a stale STRIPE invite, then paid AUD courses on Eway.
        ProductPageInviteMapping free = course("free", 0, "STRIPE", "INR", "INR");
        ProductPageInviteMapping be = course("be", 499, "EWAY", "AUD", "AUD");
        course("cb", 299, "EWAY", "AUD", "AUD");
        inviteOf(free).setVendorId("stripe-account");
        inviteOf(be).setVendorId("eway-account");

        // The learner app sends the gateway and currency by-code read off the free course.
        service.enrollForProductPage(checkout("STRIPE", "INR", "free", "be", "cb"));

        PaymentInitiationRequestDTO charged = charged();
        assertEquals("EWAY", charged.getVendor());
        assertEquals("eway-account", charged.getVendorId());
        assertEquals("AUD", charged.getCurrency());
        assertEquals(798.0, charged.getAmount());
    }

    @Test
    @DisplayName("a cart whose first course is priced is charged through that course's gateway, as before")
    void pricedFirstCourseKeepsItsGateway() {
        inviteOf(course("a", 499, "STRIPE", "INR", "INR")).setVendorId("stripe-account");
        course("free", 0, "EWAY", "INR", "INR");
        course("b", 299, "RAZORPAY", "INR", "INR");

        service.enrollForProductPage(checkout("STRIPE", "INR", "a", "free", "b"));

        PaymentInitiationRequestDTO charged = charged();
        assertEquals("STRIPE", charged.getVendor());
        assertEquals("stripe-account", charged.getVendorId());
        assertEquals("INR", charged.getCurrency());
        assertEquals(798.0, charged.getAmount());
    }

    @Test
    @DisplayName("a cart of free courses only keeps the first course's gateway, as before (a basket price goes through it)")
    void freeCartKeepsTheFirstCoursesGateway() {
        course("x", 0, "STRIPE", "INR", "INR");
        course("y", 0, "RAZORPAY", "INR", "INR");
        when(basketPricingCalculator.price(any(), any())).thenReturn(new BasketPricingCalculator.BasketPrice(799, 0));

        service.enrollForProductPage(checkout("RAZORPAY", "INR", "x", "y"));

        PaymentInitiationRequestDTO charged = charged();
        assertEquals("STRIPE", charged.getVendor());
        assertEquals(799.0, charged.getAmount());
    }

    @Test
    @DisplayName("a free STRIPE course first in a Razorpay cart: Phase 1 opens a Razorpay order for the paid course")
    void phase1GoesThroughThePricedCoursesGateway() {
        course("intro", 0, "STRIPE", "INR", "INR");
        course("bio", 999, "RAZORPAY", "INR", "INR");
        razorpayOrder();

        ProductPageEnrollResponse res = service.enrollForProductPage(checkout("STRIPE", "INR", "intro", "bio"));

        assertEquals("PAYMENT_PENDING", res.getStatus());
        assertEquals(ORDER, res.getOrderId());
        assertEquals(List.of("ps-intro", "ps-bio"), res.getEnrolledPackageSessionIds());
        PaymentInitiationRequestDTO charged = charged();
        assertEquals("RAZORPAY", charged.getVendor());
        assertEquals("INR", charged.getCurrency());
        assertEquals(999.0, charged.getAmount());
    }

    @Test
    @DisplayName("...and Phase 2 of that cart is recognised as Razorpay too, and completes the paid order")
    void phase2OfTheSameCartIsRazorpay() throws Exception {
        course("intro", 0, "STRIPE", "INR", "INR");
        course("bio", 999, "RAZORPAY", "INR", "INR");
        when(institutePaymentGatewayMappingService.findInstitutePaymentGatewaySpecifData("RAZORPAY", INSTITUTE))
                .thenReturn(Map.of("keySecret", RAZORPAY_SECRET));
        phase1Log();

        ProductPageEnrollResponse res = service.enrollForProductPage(phase2("intro", "bio"));

        assertEquals("PAID", res.getStatus());
        assertEquals("phase1-log", res.getPaymentLogId());
        verify(paymentLogService).updatePaymentLog(ORDER, "PAID", INSTITUTE);
        verifyNoInteractions(paymentService, userPlanService, oneTimePaymentOptionOperation);
    }

    @Test
    @DisplayName("Phase 2 picks the same gateway after the paid course was re-planned mid-checkout, without reading the stale plan")
    void phase2GatewaySurvivesAPlanChange() throws Exception {
        course("intro", 0, "STRIPE", "INR", "INR");
        ProductPageInviteMapping bio = course("bio", 999, "RAZORPAY", "INR", "INR");
        // The admin moved the course to plan-bio2; the browser still sends plan-bio.
        PaymentPlan now = new PaymentPlan();
        now.setId("plan-bio2");
        now.setActualPrice(899);
        now.setCurrency("INR");
        plans.put(now.getId(), now);
        bio.setPaymentPlanId(now.getId());
        when(institutePaymentGatewayMappingService.findInstitutePaymentGatewaySpecifData("RAZORPAY", INSTITUTE))
                .thenReturn(Map.of("keySecret", RAZORPAY_SECRET));
        phase1Log();

        ProductPageEnrollResponse res = service.enrollForProductPage(phase2("intro", "bio"));

        assertEquals("PAID", res.getStatus());
        verify(paymentLogService).updatePaymentLog(ORDER, "PAID", INSTITUTE);
        verify(paymentPlanRepository, never()).findById("plan-bio");
    }

    /* ── Phase 2 follows the order Phase 1 opened, whatever the courses cost now ── */

    /** The admin moves a course of the page onto a new plan at {@code price} while the Razorpay widget is open. */
    private void rePlan(ProductPageInviteMapping m, String planId, double price) {
        PaymentPlan now = new PaymentPlan();
        now.setId(planId);
        now.setActualPrice(price);
        now.setCurrency("INR");
        plans.put(planId, now);
        m.setPaymentPlanId(planId);
    }

    private void razorpaySecret() {
        when(institutePaymentGatewayMappingService.findInstitutePaymentGatewaySpecifData("RAZORPAY", INSTITUTE))
                .thenReturn(Map.of("keySecret", RAZORPAY_SECRET));
    }

    @Test
    @DisplayName("Phase 2 completes the paid order after its only paid course was moved to a free plan mid-checkout")
    void phase2CompletesAfterThePaidCourseWentFree() throws Exception {
        // Phase 1 opened a Razorpay order for bio's 999; with bio free now,
        // nothing in the cart is priced and the rule would pick intro's STRIPE.
        course("intro", 0, "STRIPE", "INR", "INR");
        rePlan(course("bio", 999, "RAZORPAY", "INR", "INR"), "plan-bio-free", 0);
        razorpaySecret();
        phase1Log();

        ProductPageEnrollResponse res = service.enrollForProductPage(phase2("intro", "bio"));

        assertEquals("PAID", res.getStatus());
        assertEquals("phase1-log", res.getPaymentLogId());
        verify(paymentLogService).updatePaymentLog(ORDER, "PAID", INSTITUTE);
        verifyNoInteractions(paymentService, userPlanService, oneTimePaymentOptionOperation);
        verify(paymentPlanRepository, never()).findById("plan-bio");
    }

    @Test
    @DisplayName("Phase 2 completes the paid order after the free course ahead of it was moved to a priced plan mid-checkout")
    void phase2CompletesAfterTheFreeCourseWentPriced() throws Exception {
        // intro, first in the cart, is priced now, so the rule would pick its STRIPE.
        rePlan(course("intro", 0, "STRIPE", "INR", "INR"), "plan-intro2", 199);
        course("bio", 999, "RAZORPAY", "INR", "INR");
        razorpaySecret();
        phase1Log();

        ProductPageEnrollResponse res = service.enrollForProductPage(phase2("intro", "bio"));

        assertEquals("PAID", res.getStatus());
        assertEquals("phase1-log", res.getPaymentLogId());
        verify(paymentLogService).updatePaymentLog(ORDER, "PAID", INSTITUTE);
        verifyNoInteractions(paymentService, userPlanService, oneTimePaymentOptionOperation);
        verify(paymentPlanRepository, never()).findById("plan-intro");
    }

    @Test
    @DisplayName("Phase 2 completes the paid order after the cart's first course, the paid Razorpay one, was moved to a free plan ahead of a paid STRIPE course")
    void phase2CompletesAfterTheFirstPaidCourseWentFree() throws Exception {
        // Phase 1 charged the whole cart through bio's Razorpay; with bio free
        // now, the first priced course is chem, so the rule would pick STRIPE.
        rePlan(course("bio", 999, "RAZORPAY", "INR", "INR"), "plan-bio-free", 0);
        course("chem", 500, "STRIPE", "INR", "INR");
        razorpaySecret();
        phase1Log();

        ProductPageEnrollResponse res = service.enrollForProductPage(phase2("bio", "chem"));

        assertEquals("PAID", res.getStatus());
        assertEquals("phase1-log", res.getPaymentLogId());
        verify(paymentLogService).updatePaymentLog(ORDER, "PAID", INSTITUTE);
        verifyNoInteractions(paymentService, userPlanService, oneTimePaymentOptionOperation);
    }

    @Test
    @DisplayName("an order Phase 1 opened through the cart's first, free course's Razorpay (the previous release) completes in Phase 2")
    void phase2CompletesAnOrderOpenedByTheFirstCourse() throws Exception {
        // The previous release took the gateway from the first course; this one
        // takes it from the priced STRIPE course, which never saw the order.
        course("orientation", 0, "RAZORPAY", "INR", "INR");
        course("maths", 499, "STRIPE", "INR", "INR");
        razorpaySecret();
        phase1Log();

        ProductPageEnrollResponse res = service.enrollForProductPage(phase2("orientation", "maths"));

        assertEquals("PAID", res.getStatus());
        assertEquals("phase1-log", res.getPaymentLogId());
        verify(paymentLogService).updatePaymentLog(ORDER, "PAID", INSTITUTE);
        verifyNoInteractions(paymentService, userPlanService, oneTimePaymentOptionOperation);
    }

    @Test
    @DisplayName("a confirmation whose signature does not verify is not taken for Phase 2, and costs no order lookup")
    void forgedConfirmationIsNotPhase2() throws Exception {
        course("intro", 0, "STRIPE", "INR", "INR");
        rePlan(course("bio", 999, "RAZORPAY", "INR", "INR"), "plan-bio-free", 0);
        razorpaySecret();
        phase1Log();
        ProductPageEnrollRequest forged = phase2("intro", "bio");
        forged.getPaymentInitiationRequest().getRazorpayRequest().setRazorpaySignature("0".repeat(64));

        // The cart's own gateway (STRIPE) refuses the stale plan, as for any request.
        assertThrows(ConflictException.class, () -> service.enrollForProductPage(forged));

        verify(paymentLogRepository, never()).findAllByOrderIdInJson(anyString());
        verifyNoInteractions(paymentService, paymentLogService, userPlanService);
    }

    @Test
    @DisplayName("a genuine confirmation of an order no Razorpay Phase 1 opened leaves the cart on its own gateway")
    void confirmationWithoutAPhase1OrderIsNotPhase2() throws Exception {
        course("intro", 0, "STRIPE", "INR", "INR");
        course("bio", 999, "STRIPE", "INR", "INR");
        razorpaySecret();
        // Another flow's order, or one a redirect gateway's checkout opened.
        PaymentLog other = phase1Log();
        other.setVendor("CASHFREE");

        service.enrollForProductPage(phase2("intro", "bio"));

        PaymentInitiationRequestDTO charged = charged();
        assertEquals("STRIPE", charged.getVendor());
        assertEquals(999.0, charged.getAmount());
        verify(paymentLogService, never()).updatePaymentLog(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("a confirmation for an institute with no Razorpay set up leaves the cart on its own gateway")
    void confirmationWithoutRazorpayIsNotPhase2() throws Exception {
        course("intro", 0, "STRIPE", "INR", "INR");
        course("bio", 999, "STRIPE", "INR", "INR");
        when(institutePaymentGatewayMappingService.findInstitutePaymentGatewaySpecifData("RAZORPAY", INSTITUTE))
                .thenThrow(new VacademyException("No configurartion found for this payment gateway type"));
        phase1Log();

        service.enrollForProductPage(phase2("intro", "bio"));

        assertEquals("STRIPE", charged().getVendor());
        verify(paymentLogRepository, never()).findAllByOrderIdInJson(anyString());
        verify(paymentLogService, never()).updatePaymentLog(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("the gateway rule itself: the first course whose plan costs something, else the first course")
    void gatewayInviteRule() {
        ProductPageInviteMapping free = course("f", 0, "STRIPE", "INR", "INR");
        ProductPageInviteMapping paid = course("p", 10, "EWAY", "AUD", "AUD");
        ProductPageInviteMapping later = course("l", 20, "CASHFREE", "USD", "USD");
        ProductPageInviteMapping noPlan = course("n", 30, "PHONEPE", "INR", "INR");
        Map<String, PaymentPlan> byBridge = new HashMap<>();
        for (ProductPageInviteMapping m : List.of(free, paid, later)) {
            byBridge.put(m.getPsInvitePaymentOption().getId(), plans.get(m.getPaymentPlanId()));
        }

        assertSame(inviteOf(paid), ProductPageEnrollmentService.gatewayInvite(List.of(free, paid, later), byBridge));
        // A course whose plan could not be read counts as free.
        assertSame(inviteOf(later), ProductPageEnrollmentService.gatewayInvite(List.of(noPlan, free, later), byBridge));
        assertSame(inviteOf(noPlan), ProductPageEnrollmentService.gatewayInvite(List.of(noPlan, free), byBridge));
        assertSame(inviteOf(free), ProductPageEnrollmentService.gatewayInvite(List.of(free), byBridge));
    }
}
