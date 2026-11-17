package vacademy.io.admin_core_service.features.commerce;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.AdminCoreServiceApplication;
import vacademy.io.admin_core_service.features.auth_service.service.AsyncEnrollmentEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.customer.controller.CommerceCustomerController;
import vacademy.io.admin_core_service.features.commerce.customer.dto.CustomerDtos;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionClient;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Database-backed proof of the staff customer views (WP-34, B2) on a local Postgres with the real
 * Flyway chain and the real Spring context, through the controller and the real commerce guard.
 * One customer of the shop has a paid online order, a cancelled order that took no money, an order
 * still waiting for payment, a part-paid staff order on credit and a refunded order; another
 * institute holds a customer with the same phone and name, and an order that names the first
 * customer's id. The list and the profile must add up exactly, never show the other institute's
 * rows, and treat {@code _} in a name search as a letter. Nothing is written by a read.
 *
 * <p>Skipped unless {@code COMMERCE_IT_PG_URL} names a database on this machine (same pattern as
 * {@link CommerceCheckoutDatabaseProofIT}); nothing leaves the machine.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CommerceCustomersDatabaseProofIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        registry.add("commerce.order-token.secret", () -> "local-proof-only-not-a-secret");
    }

    @Autowired private JdbcTemplate db;
    @Autowired private CapabilityResolver capabilityResolver;
    @Autowired private CommerceCustomerController controller;

    @MockBean private AuthService authService;
    @MockBean private WorkflowTriggerService workflowTriggerService;
    @MockBean private InvoiceService invoiceService;
    @MockBean private PaymentNotificatonService paymentNotificatonService;
    @MockBean private DynamicNotificationService dynamicNotificationService;
    @MockBean private AsyncEnrollmentEmailService asyncEnrollmentEmailService;
    @MockBean private MediaService mediaService;
    @MockBean private CommerceRenditionClient renditionClient;

    private final String inst = UUID.randomUUID().toString();
    private final String other = UUID.randomUUID().toString();
    private final String run = inst.substring(0, 8);
    private final String phone = "9198" + String.format("%08d", Math.abs(inst.hashCode()) % 100_000_000);
    private final String buyer = UUID.randomUUID().toString();
    private final String lookalike = UUID.randomUUID().toString();
    private final String stranger = UUID.randomUUID().toString();
    private String refundedOrder;
    private int orders;

    @BeforeAll
    void seed() {
        for (String id : List.of(inst, other)) {
            db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", id,
                    "Customers Proof " + id.substring(0, 8), "https://shop-" + id.substring(0, 8) + ".example.com");
        }
        // The shop has the module; the other institute does not.
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)",
                inst);
        capabilityResolver.evict(inst);
        capabilityResolver.evict(other);

        customer(buyer, inst, phone, "Asha_" + run, true, 1, "2026-11-01 08:00:00");
        // Would match "asha_<run>" if "_" were a wildcard.
        customer(lookalike, inst, "9197" + phone.substring(4), "AshaX" + run, false, 0, "2026-11-02 08:00:00");
        // Another institute: the same phone and name.
        customer(stranger, other, phone, "Asha_" + run, false, 0, "2026-11-01 08:00:00");

        order(inst, buyer, "ONLINE", "PREPAID", "PAID", "DELIVERED", "1000.00", "1000.00", "0", "2026-11-03 10:00:00");
        order(inst, buyer, "ONLINE", "PREPAID", "UNPAID", "CANCELLED", "500.00", "0", "0", "2026-11-04 10:00:00");
        order(inst, buyer, "ADMIN", "OFFLINE", "PARTIALLY_PAID", "CONFIRMED", "800.00", "300.00", "0",
                "2026-11-05 10:00:00");
        refundedOrder = order(inst, buyer, "ONLINE", "PREPAID", "PAID", "CANCELLED", "600.00", "600.00", "600.00",
                "2026-11-06 10:00:00");
        // The newest order is still waiting for payment: it must not count anywhere.
        order(inst, buyer, "ONLINE", "PREPAID", "UNPAID", "PENDING_PAYMENT", "700.00", "0", "0", "2026-11-07 10:00:00");
        // Another institute's orders, one of them naming the shop's customer id.
        order(other, stranger, "ONLINE", "PREPAID", "PAID", "DELIVERED", "9999.00", "9999.00", "0",
                "2026-11-08 10:00:00");
        order(other, buyer, "ADMIN", "OFFLINE", "UNPAID", "CONFIRMED", "5000.00", "0", "0", "2026-11-08 11:00:00");

        address(buyer, inst, "Home", "ACTIVE", true);
        address(buyer, inst, "Old", "DELETED", false);
        address(stranger, other, "Theirs", "ACTIVE", true);
    }

    @AfterAll
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    private void customer(String id, String institute, String phoneNumber, String name, boolean consent,
                          int codRefusals, String createdAt) {
        db.update("INSERT INTO commerce_customer (id, institute_id, phone, name, email, marketing_consent, consent_at, "
                        + "consent_source, cod_refusals, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, institute, phoneNumber, name, consent ? "buyer-" + run + "@example.com" : null, consent,
                consent ? Timestamp.valueOf("2026-11-01 09:00:00") : null, consent ? "CHECKOUT" : null, codRefusals,
                consent ? "Calls before delivery" : null, Timestamp.valueOf(createdAt));
    }

    private String order(String institute, String customerId, String channel, String method, String paymentStatus,
                         String status, String total, String paid, String refunded, String createdAt) {
        String id = UUID.randomUUID().toString();
        BigDecimal back = new BigDecimal(refunded);
        db.update("INSERT INTO commerce_order (id, institute_id, order_number, payment_group_id, channel, customer_id, "
                        + "customer_name, customer_phone, total, amount_paid, currency, payment_method, payment_status, "
                        + "status, refund_due, refund_committed, amount_refunded, created_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?)",
                id, institute, "CP-" + run + "-" + (++orders), UUID.randomUUID().toString(), channel, customerId,
                "Asha", phone, new BigDecimal(total), new BigDecimal(paid), method, paymentStatus, status, back, back,
                back, Timestamp.valueOf(createdAt));
        return id;
    }

    private void address(String customerId, String institute, String label, String status, boolean isDefault) {
        db.update("INSERT INTO commerce_customer_address (id, institute_id, customer_id, label, name, line1, city, "
                        + "state_code, pincode, is_default, status) VALUES (?, ?, ?, ?, 'Asha', '1 Test Road', "
                        + "'Test City', 'ZZ', '100001', ?, ?)",
                UUID.randomUUID().toString(), institute, customerId, label, isDefault, status);
    }

    private static CustomUserDetails user(String authority) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("staff-proof");
        dto.setUsername("staff-proof");
        dto.setFullName("Proof Staff");
        dto.setAuthorities(List.of(authority));
        return new CustomUserDetails(dto);
    }

    private static void header(String instituteId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", instituteId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private CustomerDtos.CustomerPage list(String search) {
        header(inst);
        return controller.list(inst, search, 0, 50, user("COMMERCE_ACCOUNTANT")).getBody();
    }

    private Map<String, Object> fingerprint() {
        return db.queryForMap("SELECT (SELECT count(*) FROM commerce_customer) AS customers, "
                + "(SELECT max(updated_at) FROM commerce_customer) AS customers_at, "
                + "(SELECT count(*) FROM commerce_order) AS orders, "
                + "(SELECT max(updated_at) FROM commerce_order) AS orders_at, "
                + "(SELECT count(*) FROM commerce_customer_address) AS addresses");
    }

    private static void money(String expected, BigDecimal actual, String what) {
        assertEquals(0, new BigDecimal(expected).compareTo(actual), what + ": " + actual);
    }

    @Test
    void theListAddsUpTheShopsOrdersOnlyAndNeverShowsAnotherInstitute() {
        Map<String, Object> before = fingerprint();

        CustomerDtos.CustomerPage page = list(null);

        assertEquals(2, page.getTotal(), "the shop's two customers, not the other institute's");
        assertEquals(List.of(buyer, lookalike), page.getCustomers().stream().map(CustomerDtos.CustomerRow::getId)
                .toList(), "the latest buyer first, then a customer with no order");
        CustomerDtos.CustomerRow row = page.getCustomers().get(0);
        assertEquals(3L, row.getOrdersCount(), "paid + staff credit + refunded; not the unpaid cancel or the pending");
        money("1300.00", row.getTotalSpent(), "1000 + 300 + (600 - 600)");
        money("500.00", row.getDues(), "800 - 300 on the staff order");
        String refundedAt = db.queryForObject("SELECT created_at FROM commerce_order WHERE id = ?", Timestamp.class,
                refundedOrder).toInstant().toString();
        assertEquals(refundedAt, row.getLastOrderAt(), "the newest order not waiting for payment");
        assertEquals(phone, row.getPhone());
        assertEquals(1, row.getCodRefusals());
        assertEquals(Boolean.TRUE, row.getMarketingConsent());
        assertEquals(Boolean.FALSE, row.getAnonymised());
        assertNull(row.getNotes(), "notes are on the profile only");

        CustomerDtos.CustomerRow none = page.getCustomers().get(1);
        assertEquals(0L, none.getOrdersCount());
        money("0", none.getTotalSpent(), "no orders");
        money("0", none.getDues(), "no orders");
        assertNull(none.getLastOrderAt());

        assertEquals(before, fingerprint(), "a read writes nothing");
    }

    @Test
    void theSearchMatchesAPhoneAsTypedAndTakesAnUnderscoreLiterally() {
        String typed = "+91 " + phone.substring(2, 7) + " " + phone.substring(7);
        assertEquals(List.of(buyer), list(typed).getCustomers().stream().map(CustomerDtos.CustomerRow::getId).toList());

        CustomerDtos.CustomerPage byName = list("ASHA_" + run);
        assertEquals(1, byName.getTotal());
        assertEquals(buyer, byName.getCustomers().get(0).getId());

        assertEquals(0, list("%").getTotal(), "% is a letter too");
        assertEquals(2, list("asha").getTotal());
    }

    @Test
    void theProfileHasTheNotesConsentAndActiveAddressesAndAnotherInstitutesCustomerIsNotFound() {
        header(inst);
        CustomerDtos.CustomerProfile profile = controller.profile(buyer, inst, user("COMMERCE_STORE_MANAGER"))
                .getBody();
        assertEquals("Calls before delivery", profile.getCustomer().getNotes());
        assertEquals("CHECKOUT", profile.getCustomer().getConsentSource());
        assertTrue(profile.getCustomer().getConsentAt() != null);
        assertEquals(3L, profile.getCustomer().getOrdersCount());
        money("500.00", profile.getCustomer().getDues(), "profile dues");
        assertEquals(List.of("Home"), profile.getAddresses().stream().map(CustomerDtos.AddressView::getLabel).toList(),
                "ACTIVE addresses only");

        VacademyException missing = assertThrows(VacademyException.class,
                () -> controller.profile(stranger, inst, user("ADMIN")));
        assertEquals(HttpStatus.NOT_FOUND, missing.getStatus());
        assertTrue(missing.getMessage().startsWith("CUSTOMER_NOT_FOUND:"));
    }

    @Test
    void warehouseStaffAndAnInstituteWithoutTheModuleAreRefused() {
        header(inst);
        CommerceAccessDeniedException role = assertThrows(CommerceAccessDeniedException.class,
                () -> controller.list(inst, null, 0, 50, user("COMMERCE_WAREHOUSE_STAFF")));
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, role.getCode());

        header(other);
        CommerceAccessDeniedException feature = assertThrows(CommerceAccessDeniedException.class,
                () -> controller.list(other, null, 0, 50, user("ADMIN")));
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, feature.getCode());
    }
}
