package vacademy.io.admin_core_service.features.product_page.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.service.CustomFieldValueService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.institute_learner.manager.StudentRegistrationManager;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerEnrollmentEntryService;
import vacademy.io.admin_core_service.features.learner.service.LearnerCouponService;
import vacademy.io.admin_core_service.features.learner.service.PublicEnrollRoleGuard;
import vacademy.io.admin_core_service.features.learner_payment_option_operation.service.ComplexPaymentOptionOperation;
import vacademy.io.admin_core_service.features.learner_payment_option_operation.service.OneTimePaymentOptionOperation;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.payments.service.PaymentService;
import vacademy.io.admin_core_service.features.product_page.controller.OpenProductPageController;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageCpoEnrollRequest;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageEnrollRequest;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageFormSubmitRequest;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageSelectedMappingDTO;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPageInviteMapping;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageInviteMappingRepository;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageRepository;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceResolver;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogLineItemRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.utm_attribution.service.UtmAttributionService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowEngineService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The catalogue checkout routes need no login. Their body's user went to auth-service as
 * written, so a body naming ADMIN made the account an admin of the institute; and the user
 * auth-service answered with, which lists the account's roles in every institute, was posted
 * again for this one. Both lists are now learner roles only.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ProductPagePublicRolesTest {

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
    @Mock private RegionalPriceResolver regionalPriceResolver;
    @Mock private ProductPageAutoLoginService autoLoginService;

    @InjectMocks private ProductPageEnrollmentService service;

    private final List<ProductPageInviteMapping> pageMappings = new ArrayList<>();
    private final Map<String, PaymentPlan> plans = new HashMap<>();
    /** What auth-service answers: the account is ADMIN of an institute of its own. */
    private final UserDTO answered = new UserDTO();

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
        Institute institute = new Institute();
        institute.setSetting("{\"setting\":{}}");
        when(instituteRepository.findById(INSTITUTE)).thenReturn(Optional.of(institute));

        answered.setId("user-1");
        answered.setEmail("owner@example.com");
        answered.setRoles(new ArrayList<>(List.of("ADMIN", "STUDENT")));
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), anyString(), anyBoolean()))
                .thenReturn(answered);
        when(paymentLogService.createPaymentLog(anyString(), anyDouble(), anyString(), any(), anyString(), any(), any()))
                .thenReturn("log-1");
    }

    private static UserDTO body(String... roles) {
        UserDTO user = new UserDTO();
        user.setEmail("owner@example.com");
        user.setRoles(roles == null ? null : new ArrayList<>(Arrays.asList(roles)));
        return user;
    }

    private void mapping(String bridgeId, String planId, String optionType, double price) {
        PackageEntity pkg = new PackageEntity();
        pkg.setPackageName("Course " + bridgeId);
        PackageSession ps = new PackageSession();
        ps.setId("ps-" + bridgeId);
        ps.setPackageEntity(pkg);
        EnrollInvite invite = new EnrollInvite();
        invite.setId("inv-" + bridgeId);
        invite.setCurrency("INR");
        invite.setInviteCode("CODE-" + bridgeId);
        PaymentOption option = new PaymentOption();
        option.setId("po-" + bridgeId);
        option.setType(optionType);
        PackageSessionLearnerInvitationToPaymentOption bridge = new PackageSessionLearnerInvitationToPaymentOption();
        bridge.setId(bridgeId);
        bridge.setStatus("ACTIVE");
        bridge.setEnrollInvite(invite);
        bridge.setPackageSession(ps);
        bridge.setPaymentOption(option);
        ProductPageInviteMapping m = new ProductPageInviteMapping();
        m.setId("map-" + bridgeId + "-" + planId);
        m.setPsInvitePaymentOption(bridge);
        m.setPaymentPlanId(planId);
        m.setStatus("ACTIVE");
        pageMappings.add(m);
        PaymentPlan p = new PaymentPlan();
        p.setId(planId);
        p.setName(planId);
        p.setStatus("ACTIVE");
        p.setActualPrice(price);
        p.setCurrency("INR");
        plans.put(planId, p);
    }

    private OpenProductPageController controller(ProductPageEnrollmentService enrollmentService) {
        PublicEnrollRoleGuard guard = new PublicEnrollRoleGuard();
        ReflectionTestUtils.setField(guard, "instituteRepository", instituteRepository);
        OpenProductPageController controller = new OpenProductPageController();
        ReflectionTestUtils.setField(controller, "enrollmentService", enrollmentService);
        ReflectionTestUtils.setField(controller, "publicEnrollRoleGuard", guard);
        return controller;
    }

    private ProductPageEnrollRequest enrollRequest(UserDTO user) {
        ProductPageSelectedMappingDTO sel = new ProductPageSelectedMappingDTO();
        sel.setPsInvitePaymentOptionId("psli-a");
        sel.setPaymentPlanId("plan-a");
        sel.setAmount(0d);
        ProductPageEnrollRequest req = new ProductPageEnrollRequest();
        req.setProductPageCode(CODE);
        req.setInstituteId(INSTITUTE);
        req.setSelectedMappings(List.of(sel));
        req.setUser(user);
        req.setPaymentInitiationRequest(new PaymentInitiationRequestDTO());
        return req;
    }

    private ProductPageCpoEnrollRequest cpoRequest(UserDTO user) {
        ProductPageCpoEnrollRequest req = new ProductPageCpoEnrollRequest();
        req.setProductPageCode(CODE);
        req.setInstituteId(INSTITUTE);
        req.setPsInvitePaymentOptionId("psli-cpo");
        req.setPaymentPlanId("plan-cpo");
        req.setUserDetails(user);
        UserPlan userPlan = new UserPlan();
        userPlan.setId("up-1");
        when(userPlanService.createUserPlan(anyString(), any(), any(), any(), any(), any(), anyString()))
                .thenReturn(userPlan);
        return req;
    }

    // ── the three public doors: the body's role names ───────────────────────

    @Test
    void formSubmitReducesTheBodyBeforeTheService() {
        ProductPageEnrollmentService enrollmentService = mock(ProductPageEnrollmentService.class);
        ProductPageFormSubmitRequest request = new ProductPageFormSubmitRequest();
        request.setProductPageCode(CODE);
        request.setInstituteId(INSTITUTE);
        request.setUserDetails(body("ADMIN"));

        controller(enrollmentService).formSubmit(request);

        ArgumentCaptor<ProductPageFormSubmitRequest> sent = ArgumentCaptor.forClass(ProductPageFormSubmitRequest.class);
        verify(enrollmentService).submitProductPageForm(sent.capture());
        assertEquals(List.of(), sent.getValue().getUserDetails().getRoles());
    }

    @Test
    void enrollReducesTheBodyBeforeTheService() {
        ProductPageEnrollmentService enrollmentService = mock(ProductPageEnrollmentService.class);

        controller(enrollmentService).enroll(enrollRequest(body("ADMIN", "STUDENT", "TEACHER")));

        ArgumentCaptor<ProductPageEnrollRequest> sent = ArgumentCaptor.forClass(ProductPageEnrollRequest.class);
        verify(enrollmentService).enrollForProductPage(sent.capture());
        assertEquals(List.of("STUDENT"), sent.getValue().getUser().getRoles());
    }

    @Test
    void cpoEnrollReducesTheBodyBeforeTheService() {
        ProductPageEnrollmentService enrollmentService = mock(ProductPageEnrollmentService.class);

        controller(enrollmentService).cpoEnroll(cpoRequest(body("ADMIN")));

        ArgumentCaptor<ProductPageCpoEnrollRequest> sent = ArgumentCaptor.forClass(ProductPageCpoEnrollRequest.class);
        verify(enrollmentService).enrollCpoForProductPage(sent.capture());
        assertEquals(List.of(), sent.getValue().getUserDetails().getRoles());
    }

    /** Through the door and the real service: what auth-service is asked to save. */
    @Test
    void formSubmitNamingAdminAsksAuthServiceForALearner() {
        mapping("psli-a", "plan-a", "ONE_TIME", 0);
        ProductPageFormSubmitRequest request = new ProductPageFormSubmitRequest();
        request.setProductPageCode(CODE);
        request.setInstituteId(INSTITUTE);
        request.setSelectedPsInvitePaymentOptionIds(List.of());
        request.setUserDetails(body("ADMIN"));

        try {
            controller(service).formSubmit(request);
        } catch (RuntimeException afterTheUserIsCreated) {
            // the rest of the form step is not under test
        }

        ArgumentCaptor<UserDTO> relayed = ArgumentCaptor.forClass(UserDTO.class);
        verify(authService).createUserFromAuthServiceForLearnerEnrollment(relayed.capture(), eq(INSTITUTE), eq(false));
        assertEquals(List.of("STUDENT"), relayed.getValue().getRoles());
    }

    // ── the answer from auth-service is not posted again as it came ─────────

    @Test
    void cpoEnrollPostsAnAdminOfAnotherInstituteAgainAsALearnerOnly() {
        mapping("psli-cpo", "plan-cpo", "CPO", 90000);

        controller(service).cpoEnroll(cpoRequest(body("STUDENT")));

        ArgumentCaptor<UserDTO> enrolled = ArgumentCaptor.forClass(UserDTO.class);
        verify(complexPaymentOptionOperation).enrollLearnerToBatch(enrolled.capture(), any(), eq(INSTITUTE),
                any(), any(), any(), any(), any());
        assertEquals("user-1", enrolled.getValue().getId());
        assertEquals(List.of("STUDENT"), enrolled.getValue().getRoles());
        // the credential mail goes through get-or-create too
        ArgumentCaptor<UserDTO> mailed = ArgumentCaptor.forClass(UserDTO.class);
        verify(authService).createUserFromAuthServiceForLearnerEnrollment(mailed.capture(), eq(INSTITUTE), eq(true),
                any());
        assertEquals(List.of("STUDENT"), mailed.getValue().getRoles());
    }

    @Test
    void enrollPostsAnAdminOfAnotherInstituteAgainAsALearnerOnly() {
        mapping("psli-a", "plan-a", "ONE_TIME", 0);

        // a body with no role list: the service names STUDENT itself
        controller(service).enroll(enrollRequest(body((String[]) null)));

        ArgumentCaptor<UserDTO> enrolled = ArgumentCaptor.forClass(UserDTO.class);
        verify(oneTimePaymentOptionOperation, atLeastOnce()).enrollLearnerToBatch(enrolled.capture(), any(),
                eq(INSTITUTE), any(), any(), any(), any(), any());
        enrolled.getAllValues().forEach(u -> assertEquals(List.of("STUDENT"), u.getRoles()));
        ArgumentCaptor<UserDTO> mailed = ArgumentCaptor.forClass(UserDTO.class);
        verify(authService).createUserFromAuthServiceForLearnerEnrollment(mailed.capture(), eq(INSTITUTE),
                anyBoolean(), any());
        assertEquals(List.of("STUDENT"), mailed.getValue().getRoles());
    }
}
