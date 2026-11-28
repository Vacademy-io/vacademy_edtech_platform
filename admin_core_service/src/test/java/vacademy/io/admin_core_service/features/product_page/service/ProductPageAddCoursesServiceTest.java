package vacademy.io.admin_core_service.features.product_page.service;

import jakarta.persistence.EntityManager;
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
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageAddCoursesRequest;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageCatalogueSyncResponse;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageInviteMappingRequest;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPageInviteMapping;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageInviteMappingRepository;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Level;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * add-courses puts the named courses on a page next to the ones it already
 * sells — never replacing them the way PUT /update does — and checks every row
 * before writing any.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ProductPageAddCoursesServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PAGE_ID = "page-1";

    @Mock private ProductPageRepository productPageRepository;
    @Mock private ProductPageInviteMappingRepository mappingRepository;
    @Mock private PackageSessionLearnerInvitationToPaymentOptionRepository bridgeRepository;
    @Mock private PaymentPlanRepository paymentPlanRepository;
    @Mock private ProductPageService productPageService;
    @Mock private InstituteAccessValidator accessValidator;
    @Mock private EntityManager entityManager;
    @Mock private CustomUserDetails user;

    @InjectMocks private ProductPageAddCoursesService service;

    private ProductPage page;
    private final List<ProductPageInviteMapping> active = new ArrayList<>();
    private final Map<String, PackageSessionLearnerInvitationToPaymentOption> bridges = new HashMap<>();
    private final Map<String, PaymentPlan> plans = new HashMap<>();

    @BeforeEach
    void setUp() {
        page = new ProductPage();
        page.setId(PAGE_ID);
        page.setInstituteId(INSTITUTE);
        page.setStatus("ACTIVE");
        page.setName("Weekly CA - November 2026");
        when(productPageRepository.lockByIdAndInstituteId(eq(PAGE_ID), anyString()))
                .thenAnswer(i -> i.getArgument(1).equals(page.getInstituteId()) ? Optional.of(page) : Optional.empty());
        when(productPageService.activeMappings(PAGE_ID)).thenAnswer(i -> new ArrayList<>(active));
        when(bridgeRepository.findById(anyString())).thenAnswer(i -> Optional.ofNullable(bridges.get(i.getArgument(0))));
        when(paymentPlanRepository.findById(anyString())).thenAnswer(i -> Optional.ofNullable(plans.get(i.getArgument(0))));
        when(mappingRepository.saveAll(any())).thenAnswer(i -> i.getArgument(0));
        when(productPageService.loadPlans(any())).thenAnswer(i -> plans);
    }

    /** Sells `session` through `vendor` at `price` in `currency`. */
    private void priced(String session, String vendor, String currency, double price) {
        PackageSessionLearnerInvitationToPaymentOption b = bridges.get("psli-" + session);
        b.getEnrollInvite().setVendor(vendor);
        b.getEnrollInvite().setCurrency(currency);
        PaymentPlan plan = plans.get("plan-" + session);
        plan.setActualPrice(price);
        plan.setCurrency(currency);
    }

    /** An enrollment-link row (and its plan) selling batch `session` for `institute`. */
    private PackageSessionLearnerInvitationToPaymentOption bridge(String session, String institute) {
        PackageEntity pkg = new PackageEntity();
        pkg.setPackageName("eBook " + session);
        Level level = new Level();
        level.setLevelName("DEFAULT");
        PackageSession ps = new PackageSession();
        ps.setId(session);
        ps.setStatus("ACTIVE");
        ps.setPackageEntity(pkg);
        ps.setLevel(level);
        EnrollInvite invite = new EnrollInvite();
        invite.setId("inv-" + session);
        invite.setInstituteId(institute);
        invite.setStatus("ACTIVE");
        PaymentOption option = new PaymentOption();
        option.setId("po-" + session);
        option.setStatus("ACTIVE");
        PackageSessionLearnerInvitationToPaymentOption b = new PackageSessionLearnerInvitationToPaymentOption();
        b.setId("psli-" + session);
        b.setStatus("ACTIVE");
        b.setEnrollInvite(invite);
        b.setPackageSession(ps);
        b.setPaymentOption(option);
        bridges.put(b.getId(), b);
        PaymentPlan plan = new PaymentPlan();
        plan.setId("plan-" + session);
        plan.setStatus("ACTIVE");
        plan.setPaymentOption(option);
        plans.put(plan.getId(), plan);
        return b;
    }

    /** A course the page already sells, at `order`. */
    private ProductPageInviteMapping onPage(String id, int order, String session) {
        ProductPageInviteMapping m = new ProductPageInviteMapping();
        m.setId(id);
        m.setProductPage(page);
        m.setPsInvitePaymentOption(bridge(session, INSTITUTE));
        m.setPaymentPlanId("plan-" + session);
        m.setDisplayOrder(order);
        m.setStatus("ACTIVE");
        active.add(m);
        return m;
    }

    private static ProductPageAddCoursesRequest request(String position, String... sessions) {
        List<ProductPageInviteMappingRequest> rows = new ArrayList<>();
        for (String s : sessions) {
            ProductPageInviteMappingRequest r = new ProductPageInviteMappingRequest();
            r.setPsInvitePaymentOptionId("psli-" + s);
            r.setPaymentPlanId("plan-" + s);
            rows.add(r);
        }
        ProductPageAddCoursesRequest req = new ProductPageAddCoursesRequest();
        req.setMappings(rows);
        req.setPosition(position);
        return req;
    }

    @SuppressWarnings("unchecked")
    private List<ProductPageInviteMapping> saved() {
        ArgumentCaptor<Collection<ProductPageInviteMapping>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(mappingRepository).saveAll(captor.capture());
        return new ArrayList<>(captor.getValue());
    }

    @Test
    @DisplayName("FIRST (default): the new course goes on top and the page's courses shift down in order")
    void addsOnTopAndShiftsTheRest() {
        ProductPageInviteMapping first = onPage("m1", 0, "a");
        ProductPageInviteMapping second = onPage("m2", 1, "b");
        bridge("new", INSTITUTE);

        ProductPageCatalogueSyncResponse res = service.addCourses(user, PAGE_ID, INSTITUTE, request(null, "new"));

        verify(accessValidator).requireInstituteAdmin(user, INSTITUTE);
        List<ProductPageInviteMapping> saved = saved();
        assertEquals(3, saved.size());
        ProductPageInviteMapping added = saved.get(2);
        assertEquals("psli-new", added.getPsInvitePaymentOption().getId());
        assertEquals("plan-new", added.getPaymentPlanId());
        assertEquals(0, added.getDisplayOrder());
        assertEquals("ACTIVE", added.getStatus());
        assertSame(page, added.getProductPage());
        assertEquals(1, first.getDisplayOrder());
        assertEquals(2, second.getDisplayOrder());
        assertEquals("ACTIVE", first.getStatus());
        verify(mappingRepository, never()).updateStatusByProductPageId(anyString(), anyString());
        verify(entityManager).clear();
        verify(productPageService).fillAdminResponseWithCustomFields(eq(res), eq(page), any());
        assertEquals(1, res.getAdded());
        assertEquals(List.of("new"), res.getAddedPackageSessionIds());
    }

    @Test
    @DisplayName("LAST: appended after the highest position; the page's courses are not touched")
    void appendsWhenLast() {
        ProductPageInviteMapping first = onPage("m1", 0, "a");
        onPage("m2", 7, "b");
        bridge("x", INSTITUTE);
        bridge("y", INSTITUTE);

        service.addCourses(user, PAGE_ID, INSTITUTE, request("last", "x", "y"));

        List<ProductPageInviteMapping> saved = saved();
        assertEquals(2, saved.size());
        assertEquals(8, saved.get(0).getDisplayOrder());
        assertEquals(9, saved.get(1).getDisplayOrder());
        assertEquals(0, first.getDisplayOrder());
    }

    @Test
    @DisplayName("a batch the page already sells is skipped, not duplicated, and nothing moves")
    void skipsWhatThePageSells() {
        ProductPageInviteMapping first = onPage("m1", 0, "a");

        ProductPageCatalogueSyncResponse res = service.addCourses(user, PAGE_ID, INSTITUTE, request(null, "a"));

        verify(mappingRepository, never()).saveAll(any());
        assertEquals(0, first.getDisplayOrder());
        assertEquals(0, res.getAdded());
        assertEquals("already_on_page", res.getSkipped().get(0).getReason());
        assertEquals("a", res.getSkipped().get(0).getPackageSessionId());
    }

    @Test
    @DisplayName("a course on another gateway or currency than the page is skipped (the catalogue sync's rule)")
    void skipsAnotherGatewayOrCurrency() {
        ProductPageInviteMapping first = onPage("m1", 0, "a");
        priced("a", "RAZORPAY", "INR", 100);
        bridge("usd", INSTITUTE);
        priced("usd", "STRIPE", "USD", 10);
        bridge("inr", INSTITUTE);
        priced("inr", "RAZORPAY", "INR", 49);

        ProductPageCatalogueSyncResponse res = service.addCourses(user, PAGE_ID, INSTITUTE, request(null, "usd", "inr"));

        List<ProductPageInviteMapping> saved = saved();
        assertEquals(2, saved.size(), "the page's own row moves down, only the INR course is added");
        assertEquals("psli-inr", saved.get(1).getPsInvitePaymentOption().getId());
        assertEquals(0, saved.get(1).getDisplayOrder());
        assertEquals(1, first.getDisplayOrder());
        assertEquals(1, res.getAdded());
        assertEquals("usd", res.getSkipped().get(0).getPackageSessionId());
        assertTrue(List.of("vendor_mismatch", "currency_mismatch").contains(res.getSkipped().get(0).getReason()));
    }

    @Test
    @DisplayName("dryRun gives the same added / skipped answer and writes nothing, not even the order")
    void dryRunWritesNothing() {
        ProductPageInviteMapping first = onPage("m1", 0, "a");
        priced("a", "RAZORPAY", "INR", 100);
        bridge("usd", INSTITUTE);
        priced("usd", "STRIPE", "USD", 10);
        bridge("inr", INSTITUTE);
        priced("inr", "RAZORPAY", "INR", 49);

        ProductPageCatalogueSyncResponse res = service.addCourses(user, PAGE_ID, INSTITUTE,
                request(null, "usd", "inr", "a"), true);

        verify(mappingRepository, never()).saveAll(any());
        verify(mappingRepository, never()).flush();
        assertEquals(0, first.getDisplayOrder());
        assertEquals(1, res.getAdded());
        assertEquals(List.of("inr"), res.getAddedPackageSessionIds());
        assertEquals(2, res.getSkipped().size());
        verify(accessValidator).requireInstituteAdmin(user, INSTITUTE);
    }

    @Test
    @DisplayName("another institute's enrollment row is refused and nothing is written")
    void refusesForeignRow() {
        onPage("m1", 0, "a");
        bridge("mine", INSTITUTE);
        bridge("theirs", "other-inst");

        assertThrows(VacademyException.class,
                () -> service.addCourses(user, PAGE_ID, INSTITUTE, request(null, "mine", "theirs")));
        verify(mappingRepository, never()).saveAll(any());
        assertEquals(0, active.get(0).getDisplayOrder());
    }

    @Test
    @DisplayName("a plan of another payment option is refused")
    void refusesPlanOfAnotherOption() {
        bridge("a", INSTITUTE);
        bridge("b", INSTITUTE);
        ProductPageInviteMappingRequest r = new ProductPageInviteMappingRequest();
        r.setPsInvitePaymentOptionId("psli-a");
        r.setPaymentPlanId("plan-b");
        ProductPageAddCoursesRequest req = new ProductPageAddCoursesRequest();
        req.setMappings(List.of(r));

        assertThrows(VacademyException.class, () -> service.addCourses(user, PAGE_ID, INSTITUTE, req));
        verify(mappingRepository, never()).saveAll(any());
    }

    @Test
    @DisplayName("another institute's page reads as missing; a non-admin is stopped before any read")
    void tenantAndAdminChecks() {
        bridge("a", INSTITUTE);
        VacademyException missing = assertThrows(VacademyException.class,
                () -> service.addCourses(user, PAGE_ID, "other-inst", request(null, "a")));
        assertTrue(missing.getMessage().contains("not found"));

        doThrow(new ForbiddenException("no")).when(accessValidator).requireInstituteAdmin(user, INSTITUTE);
        assertThrows(ForbiddenException.class,
                () -> service.addCourses(user, PAGE_ID, INSTITUTE, request(null, "a")));
        verify(mappingRepository, never()).saveAll(any());
    }

    @Test
    @DisplayName("bad requests: no mappings, an unknown position, a deleted page")
    void badRequests() {
        bridge("a", INSTITUTE);
        assertThrows(VacademyException.class,
                () -> service.addCourses(user, PAGE_ID, INSTITUTE, new ProductPageAddCoursesRequest()));
        assertThrows(VacademyException.class,
                () -> service.addCourses(user, PAGE_ID, INSTITUTE, request("middle", "a")));
        page.setStatus("DELETED");
        assertThrows(VacademyException.class,
                () -> service.addCourses(user, PAGE_ID, INSTITUTE, request(null, "a")));
        verify(mappingRepository, never()).saveAll(any());
    }
}
