package vacademy.io.admin_core_service.features.product_page.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.dto.InstituteCustomFieldDTO;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldTypeEnum;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageAggregatedFieldDTO;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageInviteMappingResponse;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageResponse;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPageInviteMapping;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageInviteMappingRepository;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageReadRepository;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Level;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.institute.entity.session.Session;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * by-code (and the admin reads) now load a page's courses, plans and form
 * fields in a fixed handful of queries instead of three per course. The JSON
 * a learner's browser receives must not change by a single byte, so the
 * assembly as it was before the batching is kept below, verbatim, as the
 * reference: both are fed the same rows and their JSON compared.
 *
 * The reference reads custom fields through the REAL
 * InstituteCustomFiledService, so a change to that service's DTO mapping
 * that the batched copy (ProductPageCustomFieldLoader) does not follow fails
 * here.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ProductPageByCodeResponseTest {

    private static final String INSTITUTE = "inst-1";
    private static final String CODE = "abc123";
    private static final String ENROLL_INVITE = CustomFieldTypeEnum.ENROLL_INVITE.name();

    @Mock private ProductPageRepository coursePageRepository;
    @Mock private ProductPageInviteMappingRepository mappingRepository;
    @Mock private ProductPageReadRepository readRepository;
    @Mock private InstituteSettingService instituteSettingService;
    @Mock private InstituteCustomFiledService customFieldService;
    @Mock private PaymentPlanRepository paymentPlanRepository;
    @Mock private InstituteCustomFieldRepository instituteCustomFieldRepository;

    @InjectMocks private ProductPageService service;

    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final List<ProductPageInviteMapping> mappings = new ArrayList<>();
    private final Map<String, PaymentPlan> plans = new LinkedHashMap<>();
    /** institute_custom_fields x custom_fields, as the database holds them. */
    private final List<Object[]> fieldRows = new ArrayList<>();
    private ProductPage page;
    private LegacyByCode legacy;

    @BeforeEach
    void setUp() {
        ProductPageCustomFieldLoader loader = new ProductPageCustomFieldLoader();
        ReflectionTestUtils.setField(loader, "readRepository", readRepository);
        ReflectionTestUtils.setField(service, "customFieldLoader", loader);

        InstituteCustomFiledService realFieldService = new InstituteCustomFiledService();
        ReflectionTestUtils.setField(realFieldService, "instituteCustomFieldRepository", instituteCustomFieldRepository);
        legacy = new LegacyByCode(coursePageRepository, mappingRepository, paymentPlanRepository, realFieldService,
                instituteSettingService);

        page = new ProductPage();
        page.setId("page-1");
        page.setName("Class 10 store");
        page.setCode(CODE);
        page.setInstituteId(INSTITUTE);
        page.setStatus("ACTIVE");
        page.setPageJson("{\"components\":[]}");
        page.setSettingsJson("{\"defaultStep\":\"CATALOG\"}");
        page.setShortUrl("https://u.vacademy.io/x");
        when(coursePageRepository.findByCode(CODE)).thenReturn(Optional.of(page));
        when(coursePageRepository.findById("page-1")).thenReturn(Optional.of(page));
        when(coursePageRepository.findByInstituteIdAndStatusIn(eq(INSTITUTE), any())).thenReturn(List.of(page));

        when(instituteSettingService.getSettingByInstituteIdAndKey(INSTITUTE, "GTM_SETTING"))
                .thenReturn(Map.of("enabled", true, "containerId", "GTM-TEST"));

        // New path.
        when(mappingRepository.findOrderedWithBridge(eq("page-1"), any())).thenAnswer(i -> mappings);
        when(readRepository.findPlansWithOptionByIdIn(any())).thenAnswer(i -> {
            Collection<?> ids = i.getArgument(0);
            return plans.values().stream().filter(p -> ids.contains(p.getId())).collect(Collectors.toList());
        });
        when(readRepository.findCustomFieldsWithDetailsForTypeIds(eq(INSTITUTE), eq(ENROLL_INVITE), any(), eq("ACTIVE")))
                .thenAnswer(i -> batchedRows(i.getArgument(2)));

        // Old path.
        when(mappingRepository.findByProductPageIdAndStatusIn(eq("page-1"), any())).thenAnswer(i -> mappings);
        when(paymentPlanRepository.findById(anyString()))
                .thenAnswer(i -> Optional.ofNullable(plans.get((String) i.getArgument(0))));
        when(instituteCustomFieldRepository.findInstituteCustomFieldsWithDetails(eq(INSTITUTE), eq(ENROLL_INVITE),
                anyString())).thenAnswer(i -> perInviteRows(i.getArgument(2)));

        buildPage();
    }

    /* ── fixtures ──────────────────────────────────────────────────────── */

    private void buildPage() {
        EnrollInvite inviteA = invite("inv-a", "RAZORPAY", "INR");
        EnrollInvite inviteB = invite("inv-b", "CASHFREE", "INR");

        PackageEntity physics = pkg("pkg-phy", "Physics");
        physics.setCoursePreviewImageMediaId("media-preview");
        physics.setAboutTheCourse("<p>Mechanics and waves</p>");
        physics.setTags("CBSE,Hindi");
        PackageEntity chemistry = pkg("pkg-chem", "Chemistry");
        chemistry.setCourseBannerMediaId("media-banner");
        chemistry.setAboutTheCourse("<p></p>");
        chemistry.setCourseHtmlDescription("<p>Organic&nbsp;chemistry</p>");
        PackageEntity maths = pkg("pkg-math", "Maths");
        maths.setThumbnailFileId("media-thumb");
        maths.setAboutTheCourse("<p>&nbsp;</p>");

        mappings.add(mapping("m-1", 0, bridge("psli-1", inviteA, session("ps-1", physics, "Hindi", "2026-27"),
                option("po-1", "ONE_TIME")), "plan-1", true));
        mappings.add(mapping("m-2", 1, bridge("psli-2", inviteB, session("ps-2", chemistry, "English", null),
                option("po-2", "FREE")), "plan-2", false));
        // Same invite as m-1 (its fields aggregate onto both), and a plan that no longer exists.
        mappings.add(mapping("m-3", 2, bridge("psli-3", inviteA, session("ps-3", maths, null, null),
                option("po-3", "ONE_TIME")), "plan-gone", false));

        plan("plan-1", "Yearly", 499, 999, "[\"Live classes\",\"Notes\"]");
        plan("plan-2", "Free", 0, 0, null);

        field("icf-1", "inv-a", "cf-name", "Full Name", 1, null, "ACTIVE", 1000);
        field("icf-2", "inv-a", "cf-email", "Email", 2, null, "ACTIVE", 2000);
        field("icf-3", "inv-a", "cf-school", "School Name", 9, 3, "ACTIVE", 3000);
        field("icf-4", "inv-b", "cf-email", "Email", 2, 1, "ACTIVE", 4000);
        field("icf-5", "inv-b", "cf-city", "City", 5, null, "ACTIVE", 5000);
        field("icf-6", "inv-b", "cf-old", "Old field", 0, null, "DELETED", 6000);
    }

    private static EnrollInvite invite(String id, String vendor, String currency) {
        EnrollInvite invite = new EnrollInvite();
        invite.setId(id);
        invite.setVendor(vendor);
        invite.setCurrency(currency);
        invite.setStatus("ACTIVE");
        invite.setTag("DEFAULT");
        return invite;
    }

    private static PackageEntity pkg(String id, String name) {
        PackageEntity pkg = new PackageEntity();
        pkg.setId(id);
        pkg.setPackageName(name);
        return pkg;
    }

    private static PackageSession session(String id, PackageEntity pkg, String levelName, String sessionName) {
        PackageSession ps = new PackageSession();
        ps.setId(id);
        ps.setPackageEntity(pkg);
        if (levelName != null) {
            Level level = new Level();
            level.setId("lvl-" + id);
            level.setLevelName(levelName);
            ps.setLevel(level);
        }
        if (sessionName != null) {
            Session session = new Session();
            session.setId("ses-" + id);
            session.setSessionName(sessionName);
            ps.setSession(session);
        }
        return ps;
    }

    private static PaymentOption option(String id, String type) {
        PaymentOption option = new PaymentOption();
        option.setId(id);
        option.setType(type);
        option.setStatus("ACTIVE");
        return option;
    }

    private static PackageSessionLearnerInvitationToPaymentOption bridge(String id, EnrollInvite invite,
                                                                         PackageSession ps, PaymentOption option) {
        PackageSessionLearnerInvitationToPaymentOption bridge = new PackageSessionLearnerInvitationToPaymentOption();
        bridge.setId(id);
        bridge.setEnrollInvite(invite);
        bridge.setPackageSession(ps);
        bridge.setPaymentOption(option);
        bridge.setStatus("ACTIVE");
        return bridge;
    }

    private ProductPageInviteMapping mapping(String id, int order, PackageSessionLearnerInvitationToPaymentOption bridge,
                                             String planId, boolean preselected) {
        ProductPageInviteMapping m = new ProductPageInviteMapping();
        m.setId(id);
        m.setProductPage(page);
        m.setPsInvitePaymentOption(bridge);
        m.setPaymentPlanId(planId);
        m.setPreselected(preselected);
        m.setDisplayOrder(order);
        m.setStatus("ACTIVE");
        return m;
    }

    private void plan(String id, String name, double price, double elevated, String features) {
        PaymentPlan plan = new PaymentPlan();
        plan.setId(id);
        plan.setName(name);
        plan.setStatus("ACTIVE");
        plan.setValidityInDays(365);
        plan.setActualPrice(price);
        plan.setElevatedPrice(elevated);
        plan.setCurrency("INR");
        plan.setDescription(name + " plan");
        plan.setTag("default");
        plan.setFeatureJson(features);
        plans.put(id, plan);
    }

    private void field(String icfId, String inviteId, String fieldId, String name, int formOrder,
                       Integer individualOrder, String status, long createdAt) {
        CustomFields cf = new CustomFields();
        cf.setId(fieldId);
        cf.setFieldKey(fieldId.replace("cf-", "") + "_inst_1");
        cf.setFieldName(name);
        cf.setFieldType("text");
        cf.setFormOrder(formOrder);
        cf.setIsMandatory(true);
        cf.setConfig("{}");
        cf.setCreatedAt(new Date(1_700_000_000_000L));
        cf.setUpdatedAt(new Date(1_700_000_500_000L));
        InstituteCustomField icf = new InstituteCustomField();
        icf.setId(icfId);
        icf.setInstituteId(INSTITUTE);
        icf.setCustomFieldId(fieldId);
        icf.setType(ENROLL_INVITE);
        icf.setTypeId(inviteId);
        icf.setIndividualOrder(individualOrder);
        icf.setIsMandatory(true);
        icf.setStatus(status);
        icf.setCreatedAt(new java.sql.Date(createdAt));
        fieldRows.add(new Object[]{icf, cf});
    }

    private static int formPosition(Object[] row) {
        InstituteCustomField icf = (InstituteCustomField) row[0];
        CustomFields cf = (CustomFields) row[1];
        return icf.getIndividualOrder() != null ? icf.getIndividualOrder() : cf.getFormOrder();
    }

    /** What findInstituteCustomFieldsWithDetails returns for one invite (all statuses, per-form order). */
    private List<Object[]> perInviteRows(String inviteId) {
        return fieldRows.stream()
                .filter(r -> inviteId.equals(((InstituteCustomField) r[0]).getTypeId()))
                .sorted(Comparator.comparingInt(ProductPageByCodeResponseTest::formPosition)
                        .thenComparingInt(r -> ((CustomFields) r[1]).getFormOrder()))
                .collect(Collectors.toList());
    }

    /**
     * What the batched query returns: every invite's rows interleaved in one
     * global order. The DELETED row is left in on purpose; the loader must drop it.
     */
    private List<Object[]> batchedRows(Collection<?> inviteIds) {
        return fieldRows.stream()
                .filter(r -> inviteIds.contains(((InstituteCustomField) r[0]).getTypeId()))
                .sorted(Comparator.comparingInt(ProductPageByCodeResponseTest::formPosition)
                        .thenComparingInt(r -> ((CustomFields) r[1]).getFormOrder())
                        .thenComparing(r -> ((InstituteCustomField) r[0]).getCreatedAt())
                        .thenComparing(r -> ((InstituteCustomField) r[0]).getId()))
                .collect(Collectors.toList());
    }

    /* ── tests ─────────────────────────────────────────────────────────── */

    @Test
    @DisplayName("by-code JSON is byte-identical to the pre-batching assembly")
    void byCodeJsonUnchanged() throws Exception {
        ProductPageResponse now = service.getProductPageByCode(CODE, INSTITUTE);
        ProductPageResponse before = legacy.getProductPageByCode(CODE, INSTITUTE);

        assertEquals(json.writeValueAsString(before), json.writeValueAsString(now));

        // Not vacuous: every part of the payload is populated.
        assertEquals(List.of("m-1", "m-2", "m-3"),
                now.getMappings().stream().map(ProductPageInviteMappingResponse::getId).toList());
        assertEquals("Yearly", now.getMappings().get(0).getPaymentPlan().getName());
        assertNull(now.getMappings().get(2).getPaymentPlan());
        assertEquals("<p>Organic&nbsp;chemistry</p>", now.getMappings().get(1).getAboutTheCourseHtml());
        assertEquals(List.of("cf-name", "cf-email", "cf-school", "cf-city"), now.getAggregatedCustomFields().stream()
                .map(f -> f.getField().getFieldId()).toList());
        ProductPageAggregatedFieldDTO email = now.getAggregatedCustomFields().get(1);
        assertEquals(List.of("inv-a", "inv-b"), email.getEnrollInviteIds());
        assertEquals("RAZORPAY", now.getVendor());
        assertEquals("GTM-TEST", now.getGtmContainerId());
    }

    @Test
    @DisplayName("the admin reads return the same JSON as before too")
    void adminReadsUnchanged() throws Exception {
        assertEquals(json.writeValueAsString(legacy.getProductPageById("page-1")),
                json.writeValueAsString(service.getProductPageById("page-1")));
        assertEquals(json.writeValueAsString(legacy.getAllProductPages(INSTITUTE)),
                json.writeValueAsString(service.getAllProductPages(INSTITUTE)));
    }

    @Test
    @DisplayName("by-code costs one mapping query, one plan query and one form query, whatever the page size")
    void byCodeQueryCount() {
        service.getProductPageByCode(CODE, INSTITUTE);

        verify(mappingRepository, times(1)).findOrderedWithBridge("page-1", List.of("ACTIVE"));
        verify(mappingRepository, never()).findByProductPageIdAndStatusIn(any(), any());
        verify(readRepository, times(1)).findPlansWithOptionByIdIn(any());
        verify(readRepository, times(1)).findCustomFieldsWithDetailsForTypeIds(eq(INSTITUTE), eq(ENROLL_INVITE),
                eq(List.of("inv-a", "inv-b")), eq("ACTIVE"));
        verify(customFieldService, never()).findCustomFieldsAsJson(any(), any(), any());
        verify(paymentPlanRepository, never()).findById(any());
    }

    @Test
    @DisplayName("mappings come back in the order the ordered query returns them")
    void keepsTheRepositoryOrder() {
        java.util.Collections.reverse(mappings);

        ProductPageResponse now = service.getProductPageByCode(CODE, INSTITUTE);

        assertEquals(List.of("m-3", "m-2", "m-1"),
                now.getMappings().stream().map(ProductPageInviteMappingResponse::getId).toList());
        // The vendor and currency follow the first priced mapping in that order
        // (m-3's plan is gone and m-2 is free, so m-1's invite).
        assertEquals("RAZORPAY", now.getVendor());
    }

    /* ── vendor and currency: the first priced course's ──────────────── */

    /** Adds a course to the page on its own invite (vendor, currency) and plan (price, in that currency). */
    private void course(String id, int order, String vendor, String currency, double price) {
        EnrollInvite invite = invite("inv-" + id, vendor, currency);
        mappings.add(mapping("m-" + id, order, bridge("psli-" + id, invite,
                session("ps-" + id, pkg("pkg-" + id, "Course " + id), null, null), option("po-" + id, "ONE_TIME")),
                "plan-" + id, false));
        plan("plan-" + id, "plan-" + id, price, price, null);
        plans.get("plan-" + id).setCurrency(currency);
    }

    /** The response as JSON with vendor and currency left out, to show nothing else differs. */
    private String withoutVendorAndCurrency(ProductPageResponse response) throws Exception {
        response.setVendor(null);
        response.setCurrency(null);
        return json.writeValueAsString(response);
    }

    @Test
    @DisplayName("a page whose first course is free takes its gateway and currency from the first priced course")
    void freeFirstCourseDoesNotSetTheGatewayOrCurrency() throws Exception {
        mappings.clear();
        // A free orientation labelled INR on a stale STRIPE invite heads the page;
        // the paid courses are AUD on Eway, then USD on Cashfree.
        course("free", 0, "STRIPE", "INR", 0);
        course("be", 1, "EWAY", "AUD", 499);
        course("cb", 2, "CASHFREE", "USD", 299);
        // A course whose plan is gone is not priced either.
        mappings.add(0, mapping("m-gone", 0, bridge("psli-gone", invite("inv-gone", "PHONEPE", "EUR"),
                session("ps-gone", pkg("pkg-gone", "Gone"), null, null), option("po-gone", "ONE_TIME")),
                "plan-gone", false));

        ProductPageResponse now = service.getProductPageByCode(CODE, INSTITUTE);

        assertEquals("EWAY", now.getVendor());
        assertEquals("AUD", now.getCurrency());
        // The courses themselves are listed exactly as before, free one included.
        assertEquals(List.of("m-gone", "m-free", "m-be", "m-cb"),
                now.getMappings().stream().map(ProductPageInviteMappingResponse::getId).toList());
        ProductPageResponse before = legacy.getProductPageByCode(CODE, INSTITUTE);
        assertEquals("PHONEPE", before.getVendor());
        assertEquals(withoutVendorAndCurrency(before), withoutVendorAndCurrency(now));
        // Read from the plans the course list already loads: still one plan query.
        verify(readRepository, times(1)).findPlansWithOptionByIdIn(any());
    }

    @Test
    @DisplayName("a page whose first course is priced answers exactly as before, whatever follows it")
    void pricedFirstCourseUnchanged() throws Exception {
        mappings.clear();
        course("a", 0, "RAZORPAY", "INR", 499);
        course("free", 1, "STRIPE", "GBP", 0);
        course("b", 2, "CASHFREE", "USD", 299);

        ProductPageResponse now = service.getProductPageByCode(CODE, INSTITUTE);

        assertEquals(json.writeValueAsString(legacy.getProductPageByCode(CODE, INSTITUTE)),
                json.writeValueAsString(now));
        assertEquals("RAZORPAY", now.getVendor());
        assertEquals("INR", now.getCurrency());
    }

    @Test
    @DisplayName("a page with no priced course keeps the first course's gateway and currency, as before")
    void noPricedCourseKeepsTheFirstCourse() throws Exception {
        mappings.clear();
        course("x", 0, "STRIPE", "INR", 0);
        course("y", 1, "RAZORPAY", "USD", 0);

        ProductPageResponse now = service.getProductPageByCode(CODE, INSTITUTE);

        assertEquals(json.writeValueAsString(legacy.getProductPageByCode(CODE, INSTITUTE)),
                json.writeValueAsString(now));
        assertEquals("STRIPE", now.getVendor());
        assertEquals("INR", now.getCurrency());
    }

    @Test
    @DisplayName("the rule itself: the first mapping whose plan costs something, else the first; none for no mappings")
    void gatewayMappingRule() {
        mappings.clear();
        course("free", 0, "STRIPE", "INR", 0);
        course("paid", 1, "EWAY", "AUD", 10);
        course("later", 2, "CASHFREE", "USD", 20);
        ProductPageInviteMapping noPlanId = mapping("m-noplan", 3, bridge("psli-noplan", invite("inv-noplan", "X", "Y"),
                session("ps-noplan", pkg("pkg-noplan", "No plan"), null, null), option("po-noplan", "ONE_TIME")),
                null, false);
        ProductPageInviteMapping free = mappings.get(0);
        ProductPageInviteMapping paid = mappings.get(1);
        ProductPageInviteMapping later = mappings.get(2);

        assertSame(paid, ProductPageService.gatewayMapping(List.of(free, paid, later), plans));
        assertSame(later, ProductPageService.gatewayMapping(List.of(noPlanId, free, later), plans));
        assertSame(free, ProductPageService.gatewayMapping(List.of(free, noPlanId), plans));
        assertSame(noPlanId, ProductPageService.gatewayMapping(List.of(noPlanId, free), Map.of()));
        assertNull(ProductPageService.gatewayMapping(List.of(), plans));
    }

    @Test
    @DisplayName("a page with no courses still answers without running the batched reads")
    void emptyPage() throws Exception {
        mappings.clear();

        ProductPageResponse now = service.getProductPageByCode(CODE, INSTITUTE);

        assertEquals(json.writeValueAsString(legacy.getProductPageByCode(CODE, INSTITUTE)),
                json.writeValueAsString(now));
        assertTrue(now.getMappings().isEmpty());
        verify(readRepository, never()).findCustomFieldsWithDetailsForTypeIds(any(), any(), any(), any());
    }

    @Test
    @DisplayName("every column of a form-field row reaches the DTO exactly as InstituteCustomFiledService maps it")
    void fieldDtoMatchesTheServiceForEveryColumn() throws Exception {
        // Every field of both entities set to a distinct value, so a column the
        // service starts mapping (and the batched copy does not) shows up here
        // even though no fixture above fills it.
        InstituteCustomField icf = new InstituteCustomField();
        CustomFields cf = new CustomFields();
        fillEveryField(icf, 1);
        fillEveryField(cf, 100);
        icf.setInstituteId(INSTITUTE);
        icf.setType(ENROLL_INVITE);
        icf.setTypeId("inv-full");
        icf.setStatus("ACTIVE"); // the service keeps ACTIVE rows only
        Object[] row = {icf, cf};
        List<Object[]> rows = new ArrayList<>();
        rows.add(row);
        when(instituteCustomFieldRepository.findInstituteCustomFieldsWithDetails(INSTITUTE, ENROLL_INVITE, "inv-full"))
                .thenReturn(rows);
        InstituteCustomFiledService realFieldService = new InstituteCustomFiledService();
        ReflectionTestUtils.setField(realFieldService, "instituteCustomFieldRepository", instituteCustomFieldRepository);

        List<InstituteCustomFieldDTO> expected =
                realFieldService.findCustomFieldsAsJson(INSTITUTE, ENROLL_INVITE, "inv-full");

        assertEquals(1, expected.size());
        assertEquals(json.writeValueAsString(expected),
                json.writeValueAsString(List.of(ProductPageCustomFieldLoader.toDto(row))));
    }

    /** Sets every instance field to a distinct non-null value; fails on a field type it cannot fill. */
    private static void fillEveryField(Object target, int seed) throws IllegalAccessException {
        int n = seed;
        for (Field f : target.getClass().getDeclaredFields()) {
            if (Modifier.isStatic(f.getModifiers())) continue;
            f.setAccessible(true);
            Class<?> type = f.getType();
            long millis = 1_700_000_000_000L + n * 60_000L;
            Object value;
            if (type == String.class) value = f.getName() + "-" + n;
            else if (type == Integer.class || type == int.class) value = n;
            else if (type == Long.class || type == long.class) value = (long) n;
            else if (type == Double.class || type == double.class) value = (double) n;
            else if (type == Boolean.class || type == boolean.class) value = Boolean.TRUE;
            else if (type == java.sql.Timestamp.class) value = new java.sql.Timestamp(millis);
            else if (type == java.sql.Date.class) value = new java.sql.Date(millis);
            else if (type == Date.class) value = new Date(millis);
            else throw new AssertionError("Cannot fill " + target.getClass().getSimpleName() + "." + f.getName()
                        + " (" + type.getName() + "): teach fillEveryField this type");
            f.set(target, value);
            n++;
        }
    }

    /**
     * ProductPageService's by-code / admin read assembly as of 6092aff3e9,
     * before the batching, copied verbatim (only the class wrapper is new).
     * Do not "fix" it: it is the reference the new code is compared against.
     */
    static final class LegacyByCode {
        private static final String STATUS_ACTIVE = "ACTIVE";
        private static final String STATUS_DRAFT = "DRAFT";
        private static final String STATUS_DELETED = "DELETED";

        private final ProductPageRepository coursePageRepository;
        private final ProductPageInviteMappingRepository mappingRepository;
        private final PaymentPlanRepository paymentPlanRepository;
        private final InstituteCustomFiledService customFieldService;
        private final InstituteSettingService instituteSettingService;

        LegacyByCode(ProductPageRepository coursePageRepository, ProductPageInviteMappingRepository mappingRepository,
                     PaymentPlanRepository paymentPlanRepository, InstituteCustomFiledService customFieldService,
                     InstituteSettingService instituteSettingService) {
            this.coursePageRepository = coursePageRepository;
            this.mappingRepository = mappingRepository;
            this.paymentPlanRepository = paymentPlanRepository;
            this.customFieldService = customFieldService;
            this.instituteSettingService = instituteSettingService;
        }

        List<ProductPageResponse> getAllProductPages(String instituteId) {
            List<ProductPage> pages = coursePageRepository.findByInstituteIdAndStatusIn(
                    instituteId, List.of(STATUS_ACTIVE, STATUS_DRAFT));
            return pages.stream().map(this::buildAdminResponse).collect(Collectors.toList());
        }

        ProductPageResponse getProductPageById(String coursePageId) {
            ProductPage page = coursePageRepository.findById(coursePageId)
                    .orElseThrow(() -> new VacademyException("Course page not found: " + coursePageId));
            return buildAdminResponseWithCustomFields(page);
        }

        ProductPageResponse getProductPageByCode(String code, String instituteId) {
            ProductPage page = coursePageRepository.findByCode(code)
                    .orElseThrow(() -> new VacademyException("Course page not found for code: " + code));

            if (!page.getInstituteId().equals(instituteId)) {
                throw new VacademyException("Course page does not belong to this institute");
            }
            if (STATUS_DELETED.equals(page.getStatus())) {
                throw new VacademyException("Course page is not available");
            }

            return buildAdminResponseWithCustomFields(page);
        }

        ProductPageResponse buildAdminResponse(ProductPage page) {
            ProductPageResponse resp = new ProductPageResponse();
            resp.setId(page.getId());
            resp.setName(page.getName());
            resp.setCode(page.getCode());
            resp.setInstituteId(page.getInstituteId());
            resp.setStatus(page.getStatus());
            resp.setPageJson(page.getPageJson());
            resp.setSettingsJson(page.getSettingsJson());
            resp.setShortUrl(page.getShortUrl());

            List<ProductPageInviteMapping> activeMappings = mappingRepository
                    .findByProductPageIdAndStatusIn(page.getId(), List.of(STATUS_ACTIVE));
            resp.setMappings(activeMappings.stream().map(this::toMappingResponse).collect(Collectors.toList()));

            return resp;
        }

        private ProductPageResponse buildAdminResponseWithCustomFields(ProductPage page) {
            List<ProductPageInviteMapping> activeMappings = mappingRepository
                    .findByProductPageIdAndStatusIn(page.getId(), List.of(STATUS_ACTIVE));
            return buildAdminResponseWithCustomFields(page, activeMappings);
        }

        private ProductPageResponse buildAdminResponseWithCustomFields(
                ProductPage page, List<ProductPageInviteMapping> activeMappings) {
            ProductPageResponse resp = buildAdminResponse(page);

            resp.setAggregatedCustomFields(aggregateCustomFields(page.getInstituteId(), activeMappings));

            if (!activeMappings.isEmpty()) {
                EnrollInvite firstInvite = activeMappings.get(0).getPsInvitePaymentOption().getEnrollInvite();
                resp.setVendor(firstInvite.getVendor());
                resp.setCurrency(firstInvite.getCurrency());
            }

            // Populate GTM container ID from institute settings
            try {
                Object gtmSetting = instituteSettingService.getSettingByInstituteIdAndKey(page.getInstituteId(),
                        "GTM_SETTING");
                if (gtmSetting instanceof Map) {
                    Map<?, ?> gtmMap = (Map<?, ?>) gtmSetting;
                    if (Boolean.TRUE.equals(gtmMap.get("enabled"))
                            && gtmMap.get("containerId") != null
                            && StringUtils.hasText(gtmMap.get("containerId").toString())) {
                        resp.setGtmContainerId(gtmMap.get("containerId").toString());
                    }
                }
            } catch (Exception e) {
                // ignored, as before
            }

            return resp;
        }

        List<ProductPageAggregatedFieldDTO> aggregateCustomFields(
                String instituteId, List<ProductPageInviteMapping> activeMappings) {

            Map<String, ProductPageAggregatedFieldDTO> deduped = new LinkedHashMap<>();

            for (ProductPageInviteMapping mapping : activeMappings) {
                String enrollInviteId = mapping.getPsInvitePaymentOption().getEnrollInvite().getId();

                List<InstituteCustomFieldDTO> fields = customFieldService.findCustomFieldsAsJson(
                        instituteId, CustomFieldTypeEnum.ENROLL_INVITE.name(), enrollInviteId);

                for (InstituteCustomFieldDTO field : fields) {
                    String fieldId = field.getFieldId() != null
                            ? field.getFieldId()
                            : field.getId();
                    if (deduped.containsKey(fieldId)) {
                        deduped.get(fieldId).addInviteId(enrollInviteId);
                    } else {
                        deduped.put(fieldId, new ProductPageAggregatedFieldDTO(field, enrollInviteId));
                    }
                }
            }

            return new ArrayList<>(deduped.values());
        }

        private ProductPageInviteMappingResponse toMappingResponse(ProductPageInviteMapping m) {
            ProductPageInviteMappingResponse r = new ProductPageInviteMappingResponse();
            r.setId(m.getId());
            r.setPsInvitePaymentOptionId(m.getPsInvitePaymentOption().getId());
            r.setEnrollInviteId(m.getPsInvitePaymentOption().getEnrollInvite().getId());
            r.setPackageSessionId(m.getPsInvitePaymentOption().getPackageSession().getId());
            r.setPaymentOptionId(m.getPsInvitePaymentOption().getPaymentOption().getId());
            r.setPaymentPlanId(m.getPaymentPlanId());
            r.setPreselected(m.isPreselected());
            r.setDisplayOrder(m.getDisplayOrder());
            r.setStatus(m.getStatus());

            paymentPlanRepository.findById(m.getPaymentPlanId())
                    .ifPresent(plan -> r.setPaymentPlan(plan.mapToPaymentPlanDTO()));

            if (m.getPsInvitePaymentOption().getPaymentOption() != null) {
                r.setPaymentOptionType(m.getPsInvitePaymentOption().getPaymentOption().getType());
            }

            PackageSession ps = m.getPsInvitePaymentOption().getPackageSession();
            if (ps != null) {
                if (ps.getPackageEntity() != null) {
                    PackageEntity pkg = ps.getPackageEntity();
                    r.setPackageId(pkg.getId());
                    r.setPackageName(pkg.getPackageName());
                    r.setCoursePreviewImageMediaId(firstNonBlank(
                            pkg.getCoursePreviewImageMediaId(),
                            pkg.getCourseBannerMediaId(),
                            pkg.getThumbnailFileId()));
                    r.setAboutTheCourseHtml(firstNonBlankHtml(
                            pkg.getAboutTheCourse(),
                            pkg.getCourseHtmlDescription()));
                    r.setTags(pkg.getTags());
                }
                if (ps.getLevel() != null)
                    r.setLevelName(ps.getLevel().getLevelName());
                if (ps.getSession() != null)
                    r.setSessionName(ps.getSession().getSessionName());
            }

            return r;
        }

        private String firstNonBlankHtml(String... values) {
            if (values == null)
                return null;
            for (String v : values) {
                if (v == null)
                    continue;
                String text = v.replaceAll("<[^>]*>", " ")
                        .replace("&nbsp;", " ")
                        .replace("&#160;", " ");
                if (StringUtils.hasText(text))
                    return v;
            }
            return null;
        }

        private String firstNonBlank(String... values) {
            if (values == null)
                return null;
            for (String v : values) {
                if (StringUtils.hasText(v))
                    return v;
            }
            return null;
        }
    }
}
