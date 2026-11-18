package vacademy.io.admin_core_service.features.commerce;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.function.Executable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.AdminCoreServiceApplication;
import vacademy.io.admin_core_service.features.auth_service.service.AsyncEnrollmentEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionClient;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceBuyerResolver;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStaffOrderService;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.StaffOrderRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosCatalogueService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosCorrectionService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosReceiptService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosRegisterService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosReturnService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSaleLookupService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSaleService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSessionService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSettingsService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommercePinService;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.scheduler.StockReconciliationJob;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLocationService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockReceiptService;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxClassDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxRateRuleDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxSettingDTO;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxClassService;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.stock_hold.entity.StockHold;
import vacademy.io.admin_core_service.features.stock_hold.enums.StockHoldKind;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * WP-42 POS backend (registers, sessions, sale, tenders, void, tender change, bill-book entry,
 * counter returns, close) against a real Postgres 16 with the whole Flyway chain and the real
 * Spring context: the gates 5, 6, 19, 24 (POS half) and 23 (scaled down) of the build plan, a
 * double tap, a failure after the stock step, the session races, and the cashier paths with real
 * roles and a manager's PIN. After every test the nightly reconciliation finds no drift.
 *
 * <p>Runs only when {@code COMMERCE_IT_PG_URL} names a database on this machine; skipped in the
 * default build like the other commerce database proofs. Every tax rate is a TEST placeholder.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@ExtendWith(OutputCaptureExtension.class)
class CommercePosDatabaseProofIT {

    private static final String SELLER_GSTIN = "09AAACH7409R1ZZ";
    private static final String PIN = "482917";
    private static final String WRONG_PIN = "731905";
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    /** Walk-in sales of gate 23, scaled down from 50,000 (the staging run of WP-54). */
    private static final int LOAD_SEQUENTIAL = 500;
    private static final int LOAD_THREADS = 8;
    private static final int LOAD_PER_THREAD = 5;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        // Eight sale threads each hold a connection and may open a second one (the PIN count).
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "24");
        registry.add("commerce.order-token.secret", () -> "local-proof-only-not-a-secret");
        registry.add("commerce.turnstile.required", () -> "false");
        registry.add("commerce.payment-fetch.cron", () -> "-");
    }

    @Autowired private JdbcTemplate db;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private CapabilityResolver capabilityResolver;
    @Autowired private CommerceProductService productService;
    @Autowired private StockLocationService locationService;
    @Autowired private StockReceiptService receiptService;
    @Autowired private CommerceTaxSettingService taxSettingService;
    @Autowired private CommerceTaxClassService taxClassService;
    @Autowired private CommerceDocumentSeriesService seriesService;
    @Autowired private StorefrontSnapshotLoader snapshotLoader;
    @Autowired private StockReconciliationJob reconciliationJob;
    @Autowired private StockHoldService stockHoldService;
    @Autowired private CommercePinService pinService;
    @Autowired private CommerceStaffOrderService staffOrders;
    @Autowired private CommerceBuyerResolver buyerResolver;
    @Autowired private UserPlanRepository userPlanRepository;
    @Autowired private PosRegisterService registers;
    @Autowired private PosSessionService sessions;
    @Autowired private PosSaleService sales;
    @Autowired private PosCatalogueService catalogue;
    @Autowired private PosReceiptService receipts;
    @Autowired private PosSettingsService settings;
    @Autowired private PosCorrectionService corrections;
    @Autowired private PosReturnService posReturns;
    @Autowired private PosSaleLookupService lookups;

    @MockBean private AuthService authService;
    @MockBean private InvoiceService invoiceService;
    @MockBean private WorkflowTriggerService workflowTriggerService;
    @MockBean private PaymentNotificatonService paymentNotificatonService;
    @MockBean private DynamicNotificationService dynamicNotificationService;
    @MockBean private AsyncEnrollmentEmailService asyncEnrollmentEmailService;
    @MockBean private MediaService mediaService;
    @MockBean private CommerceRenditionClient renditionClient;

    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final String inst = UUID.randomUUID().toString();
    private final String otherInst = UUID.randomUUID().toString();
    private final String run = inst.substring(0, 8);
    private final AtomicInteger keys = new AtomicInteger();
    private final AtomicInteger phones = new AtomicInteger(100);

    // People: an institute ADMIN, two cashiers (C at both locations, D at the online one only),
    // a store manager with a PIN at both locations, a warehouse hand and an accountant.
    private final String adminId = "admin-" + run;
    private final String cashierId = "cashier-" + run;
    private final String cashierBId = "cashierb-" + run;
    private final String managerId = "manager-" + run;
    private CustomUserDetails admin;
    private CustomUserDetails cashier;
    private CustomUserDetails cashierB;
    private CustomUserDetails manager;
    private CustomUserDetails warehouse;
    private CustomUserDetails accountant;

    private String online;   // L1: sells online, has a counter
    private String store;    // L2: a counter only
    private String bottle;   // QUANTITY, 450.00: 20 at L1, 40 at L2
    private String scarf;    // PIECE, 1200.00: 6 pieces at L1
    private String cup;      // QUANTITY, 300.00: 5 at L1, none at L2
    private String bag;      // PIECE, 800.00: 3 pieces at L1, gate 5 only
    private String spoon;    // QUANTITY, 50.00: 600 at L1 and 600 at L2, the load and the races
    private String generalSeries;
    private String r1;
    private String r2;
    private String r1Series;
    private String r2Series;

    @BeforeEach
    void local() {
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), anyString(), anyBoolean()))
                .thenAnswer(call -> {
                    UserDTO asked = call.getArgument(0);
                    UserDTO user = new UserDTO();
                    // One fixed id per address: the auth get-or-create is idempotent by the address.
                    user.setId("buyer-" + Integer.toHexString(String.valueOf(asked.getEmail()).hashCode()) + "-" + run);
                    return user;
                });
        when(authService.getUsersFromAuthServiceByUserIds(any())).thenReturn(List.of());
        when(authService.getInstituteRoles(anyString(), anyList())).thenAnswer(call -> {
            List<String> ids = call.getArgument(1);
            Map<String, List<String>> roles = new HashMap<>();
            for (String id : ids) {
                if (id.equals(adminId)) {
                    roles.put(id, List.of("ADMIN"));
                } else if (id.equals(managerId)) {
                    roles.put(id, List.of("COMMERCE_STORE_MANAGER"));
                } else if (id.equals(cashierId) || id.equals(cashierBId)) {
                    roles.put(id, List.of("COMMERCE_POS_CASHIER"));
                }
            }
            return roles;
        });
        header(inst);
        admin = user(adminId, "ADMIN");
        cashier = user(cashierId, "COMMERCE_POS_CASHIER");
        cashierB = user(cashierBId, "COMMERCE_POS_CASHIER");
        manager = user(managerId, "COMMERCE_STORE_MANAGER");
        warehouse = user("warehouse-" + run, "COMMERCE_WAREHOUSE_STAFF");
        accountant = user("accountant-" + run, "COMMERCE_ACCOUNTANT");
    }

    @AfterEach
    void reconciled() {
        header(inst);
        // A test that failed half-way leaves its counter open: close it so the next test starts clean.
        for (String open : db.queryForList("SELECT id FROM pos_session WHERE institute_id = ? AND status = 'OPEN'",
                String.class, inst)) {
            sessions.close(admin, inst, open, new PosDtos.SessionCloseRequest(key(), expected(open), null, null, null));
        }
        if (online != null) {
            reconciliationJob.run();
            noDrift("after the test");
        }
    }

    @AfterAll
    void clear() {
        RequestContextHolder.resetRequestAttributes();
    }

    // ================================================================== helpers

    private static void header(String clientId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", clientId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static CustomUserDetails user(String id, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(id);
        dto.setUsername(id);
        dto.setFullName("Proof " + id);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private String key() {
        return "pos-" + run + "-" + keys.incrementAndGet();
    }

    private long count(String query, Object... args) {
        Long n = db.queryForObject(query, Long.class, args);
        return n == null ? 0 : n;
    }

    private String text(String query, Object... args) {
        List<String> found = db.queryForList(query, String.class, args);
        return found.isEmpty() ? null : found.get(0);
    }

    private BigDecimal money(String query, Object... args) {
        return db.queryForObject(query, BigDecimal.class, args);
    }

    private static BigDecimal amount(String value) {
        return new BigDecimal(value);
    }

    private static void same(String expected, BigDecimal actual, String what) {
        assertNotNull(actual, what);
        assertEquals(0, new BigDecimal(expected).compareTo(actual), what + ": " + actual);
    }

    private void noDrift(String step) {
        List<StockReconciliationJob.Drift> drift = reconciliationJob.findSellableDrift().stream()
                .filter(d -> inst.equals(d.instituteId())).toList();
        assertTrue(drift.isEmpty(), "drift after " + step + ": " + drift);
        assertEquals(0, count("SELECT count(*) FROM stock_hold WHERE institute_id = ? AND status = 'SOLD' AND "
                + "payment_log_id IN (SELECT l.payment_log_id FROM commerce_order_line l JOIN commerce_order o ON "
                + "o.id = l.order_id WHERE o.institute_id = ? AND o.channel = 'POS')", inst, inst),
                "no counter sale leaves an open SOLD hold row (" + step + ")");
    }

    /** The refusal's message starts with {@code code}; returns the refusal. */
    private static RuntimeException refused(String code, Executable call) {
        RuntimeException e = assertThrows(RuntimeException.class, call);
        assertTrue(e.getMessage() != null && e.getMessage().startsWith(code), "expected " + code + ", got " + e);
        return e;
    }

    private static String denied(Executable call) {
        CommerceAccessDeniedException e = assertThrows(CommerceAccessDeniedException.class, call);
        return e.getCode();
    }

    private String location(String code, boolean sellsOnline) {
        LocationRequest location = new LocationRequest();
        location.setCode(code + "-" + run);
        location.setName(code + " " + run);
        location.setAddressLine1("1 Test Road");
        location.setCity("Test City");
        location.setPincode("100001");
        location.setStateCode("09");
        location.setGstin(SELLER_GSTIN);
        location.setIsStore(true);
        location.setIsWarehouse(sellsOnline);
        location.setIsPosEnabled(true);
        location.setSellsOnline(sellsOnline);
        return locationService.create(inst, adminId, true, location).getId();
    }

    private String variant(String slug, String name, String sku, String price, boolean pieces, String taxClass) {
        ProductRequest request = ProductRequest.builder().slug(slug + "-" + run)
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name(name).build()))
                .taxClassId(taxClass).status("ACTIVE").stockMode(pieces ? "PIECE" : "QUANTITY")
                .variants(List.of(VariantRequest.builder().sku(sku + "-" + run).name("One size")
                        .price(new BigDecimal(price)).weightGrams(200).build()))
                .build();
        return productService.save(inst, adminId, request).getVariants().get(0).getPackageSessionId();
    }

    private void receive(String locationId, String packageSessionId, int quantity, String unitCost) {
        ReceiptRequest request = new ReceiptRequest();
        request.setLocationId(locationId);
        request.setSourceKind("OTHER");
        request.setNote("proof stock");
        request.setClientRequestId("rc-" + key());
        ReceiptRequest.Line line = new ReceiptRequest.Line();
        line.setPackageSessionId(packageSessionId);
        line.setQuantity(quantity);
        line.setUnitCost(new BigDecimal(unitCost));
        request.setLines(List.of(line));
        receiptService.create(inst, adminId, true, request);
    }

    private void assign(String userId, String locationId) {
        db.update("INSERT INTO commerce_staff_location (id, institute_id, user_id, location_id, created_by) "
                + "VALUES (?, ?, ?, ?, ?)", UUID.randomUUID().toString(), inst, userId, locationId, adminId);
    }

    private static PosDtos.SaleLine line(String ref, String variant, int quantity, List<String> pieces) {
        return new PosDtos.SaleLine(ref, variant, quantity, pieces, null, null);
    }

    private static PosDtos.Tender cash(String amount) {
        return new PosDtos.Tender("CASH", amount(amount), null, null);
    }

    private static PosDtos.Tender upi(String amount, String reference) {
        return new PosDtos.Tender("UPI", amount(amount), null, reference);
    }

    private static PosDtos.Approval pin(String approver, String raw) {
        return new PosDtos.Approval(approver, raw, "Checked at the counter");
    }

    private static PosDtos.SaleRequest body(String key, String session, List<PosDtos.SaleLine> lines,
                                            List<PosDtos.Tender> tenders) {
        return new PosDtos.SaleRequest(key, session, lines, null, null, tenders, null, null, null, null, null);
    }

    private PosSaleService.Outcome sell(CustomUserDetails who, String session, List<PosDtos.SaleLine> lines,
                                        List<PosDtos.Tender> tenders) {
        return sales.sale(who, inst, body(key(), session, lines, tenders));
    }

    private PosDtos.SaleRequest paper(String session, String variant, String bookNumber, LocalDate date,
                                      PosDtos.Approval approval) {
        return new PosDtos.SaleRequest(key(), session, List.of(line("l1", variant, 1, null)), null, null,
                List.of(cash("450.00")), null, approval, null, bookNumber, date.toString());
    }

    /** Opens a register's counter; a note goes with a float that differs from the last close. */
    private String open(CustomUserDetails who, String register, String opening) {
        String previous = text("SELECT (counted_cash - COALESCE(handover_amount, 0))::text FROM pos_session WHERE "
                + "institute_id = ? AND register_id = ? AND status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1", inst,
                register);
        String note = previous != null && new BigDecimal(previous).compareTo(amount(opening)) != 0
                ? "Float changed at the start" : null;
        return sessions.open(who, inst, new PosDtos.SessionOpenRequest(key(), register, amount(opening), note))
                .session().id();
    }

    private BigDecimal expected(String session) {
        return sessions.detail(admin, inst, session).summary().expectedCash();
    }

    /** Closes with the drawer counted exactly as expected (no note, no PIN needed). */
    private PosDtos.SessionView closeEven(CustomUserDetails who, String session) {
        return sessions.close(who, inst, session, new PosDtos.SessionCloseRequest(key(), expected(session), null, null,
                null)).session();
    }

    private int onHand(String location, String variant) {
        return (int) count("SELECT COALESCE(SUM(on_hand), 0) FROM stock_level WHERE location_id = ? AND "
                + "package_session_id = ?", location, variant);
    }

    private int slots(String variant) {
        return db.queryForObject("SELECT available_slots FROM package_session WHERE id = ?", Integer.class, variant);
    }

    private int maxSeats(String variant) {
        return db.queryForObject("SELECT max_seats FROM package_session WHERE id = ?", Integer.class, variant);
    }

    private long nextValue(String series) {
        return count("SELECT next_value FROM commerce_document_series WHERE id = ?", series);
    }

    private List<String> pieces(String variant, String status) {
        return db.queryForList("SELECT id FROM commerce_piece WHERE package_session_id = ? AND status = ? "
                + "AND location_id = ? ORDER BY code", String.class, variant, status, online);
    }

    private long approvals(String action, String referenceId) {
        return count("SELECT count(*) FROM commerce_approval WHERE institute_id = ? AND action = ? AND "
                + "reference_id = ?", inst, action, referenceId);
    }

    private long ordersOf(String session) {
        return count("SELECT count(*) FROM commerce_order WHERE pos_session_id = ?", session);
    }

    private long allMovements() {
        return count("SELECT count(*) FROM stock_movement WHERE institute_id = ?", inst);
    }

    private long allHolds() {
        return count("SELECT count(*) FROM stock_hold WHERE institute_id = ?", inst);
    }

    private long allOrders() {
        return count("SELECT count(*) FROM commerce_order WHERE institute_id = ?", inst);
    }

    private void noCost(Object answer, String what) throws Exception {
        String wire = json.writeValueAsString(answer).toLowerCase();
        for (String field : List.of("\"cost", "_cost", "cost_total", "available_slots", "max_seats", "standard_cost",
                "tax_class_id")) {
            assertFalse(wire.contains(field), what + " carries " + field + ": " + wire);
        }
    }

    // ================================================================== 1. the shop

    @Test
    @Order(1)
    void seed() {
        assertEquals(1, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version = '724'"));
        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', "
                + "'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), "
                + "('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", inst,
                "Pos Proof " + run, "https://shop-" + run + ".example.com");
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", otherInst,
                "Other Proof " + run, "https://other-" + run + ".example.com");
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)",
                inst);
        capabilityResolver.evict(inst);
        capabilityResolver.evict(otherInst);
        taxSettingService.update(inst, adminId, TaxSettingDTO.builder().taxMode("REGULAR").sellerGstin(SELLER_GSTIN)
                .sellerLegalName("Proof Seller " + run).sellerAddress("1 Test Road, Test City 100001")
                .roundTotalTo("RUPEE").build());
        String taxClass = taxClassService.create(inst, adminId, TaxClassDTO.builder().code("goods_test")
                .name("goods TEST").hsnCode("0000").unit("PCS")
                .rules(List.of(TaxRateRuleDTO.builder().minUnitPrice(new BigDecimal("0"))
                        .ratePercent(new BigDecimal("5")).effectiveFrom(LocalDate.of(2020, 4, 1)).build()))
                .build()).getId();
        generalSeries = seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("TAX_INVOICE")
                .prefix("PG" + run.substring(0, 2)).build()).getId();
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("CREDIT_NOTE")
                .prefix("PC" + run.substring(0, 2)).build());
        online = location("ON", true);
        store = location("ST", false);
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("TAX_INVOICE").kind("MANUAL_BOOK")
                .prefix("BB" + run.substring(0, 2)).locationId(store).bookFrom(100L).bookTo(199L).build());
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("TAX_INVOICE").kind("MANUAL_BOOK")
                .prefix("BO" + run.substring(0, 2)).locationId(online).bookFrom(200L).bookTo(299L).build());
        bottle = variant("steel-bottle", "Steel bottle", "BOTTLE", "450.00", false, taxClass);
        scarf = variant("cotton-scarf", "Cotton scarf", "SCARF", "1200.00", true, taxClass);
        cup = variant("steel-cup", "Steel cup", "CUP", "300.00", false, taxClass);
        bag = variant("canvas-bag", "Canvas bag", "BAG", "800.00", true, taxClass);
        spoon = variant("steel-spoon", "Steel spoon", "SPOON", "50.00", false, taxClass);
        receive(online, bottle, 20, "100.00");
        receive(store, bottle, 40, "100.00");
        receive(online, scarf, 6, "500.00");
        receive(online, cup, 5, "120.00");
        receive(online, bag, 3, "300.00");
        receive(online, spoon, 600, "20.00");
        receive(store, spoon, 600, "20.00");
        snapshotLoader.evict(inst);

        assign(cashierId, online);
        assign(cashierId, store);
        assign(cashierBId, online);
        assign(managerId, online);
        assign(managerId, store);
        pinService.setPin(inst, managerId, PIN);
        assertEquals(20, maxSeats(bottle), "max_seats = units at the online location");
        assertEquals(6, slots(scarf));
        noDrift("seed");
    }

    // ================================================================== 2. registers, limits, roles

    @Test
    @Order(2)
    void registersLimitsAndRoleRefusals() throws Exception {
        PosRegisterService.Saved one = registers.create(admin, inst, new PosDtos.RegisterCreateRequest(key(), online,
                "r1-" + run.substring(0, 4), "Front counter", "R1" + run.substring(0, 2), null));
        r1 = one.register().id();
        assertFalse(one.register().setupWarnings().contains("NO_REGISTER_SERIES"), one.register().setupWarnings()
                .toString());
        assertFalse(one.register().setupWarnings().contains("NO_CREDIT_NOTE_SERIES"));
        r1Series = text("SELECT id FROM commerce_document_series WHERE register_id = ? AND channel = 'POS' AND kind = "
                + "'SYSTEM' AND location_id = ?", r1, online);
        assertNotNull(r1Series);
        r2 = registers.create(admin, inst, new PosDtos.RegisterCreateRequest(key(), store, "r2-" + run.substring(0, 4),
                "Store counter", "R2" + run.substring(0, 2), null)).register().id();
        r2Series = text("SELECT id FROM commerce_document_series WHERE register_id = ?", r2);
        assertNotNull(r2Series);

        // A cashier sees the registers of their own locations only.
        Set<String> seenByC = new HashSet<>();
        registers.list(cashier, inst, null).registers().forEach(r -> seenByC.add(r.id()));
        assertEquals(Set.of(r1, r2), seenByC);
        Set<String> seenByD = new HashSet<>();
        registers.list(cashierB, inst, null).registers().forEach(r -> seenByD.add(r.id()));
        assertEquals(Set.of(r1), seenByD, "cashier D works at the online location only");
        assertEquals("LOCATION_NOT_ALLOWED", denied(() -> catalogue.catalogue(cashierB, inst, r2, null)));
        assertEquals("LOCATION_NOT_ALLOWED", denied(() -> sessions.open(cashierB, inst,
                new PosDtos.SessionOpenRequest(key(), r2, amount("0.00"), null))));
        assertEquals(0, count("SELECT count(*) FROM pos_session WHERE register_id = ?", r2));
        // A cashier makes no register; a manager does not set the limits; warehouse and accountant stay out.
        assertEquals("ROLE_NOT_ALLOWED", denied(() -> registers.create(cashier, inst,
                new PosDtos.RegisterCreateRequest(key(), store, "r9-" + run.substring(0, 4), "No", null, null))));
        assertEquals("ROLE_NOT_ALLOWED", denied(() -> settings.update(manager, inst,
                new PosDtos.SettingsRequest(amount("50"), amount("99999"), amount("99999")))));
        for (CustomUserDetails outsider : List.of(warehouse, accountant)) {
            assertEquals("ROLE_NOT_ALLOWED", denied(() -> catalogue.catalogue(outsider, inst, r1, null)));
            assertEquals("ROLE_NOT_ALLOWED", denied(() -> registers.list(outsider, inst, null)));
        }

        // The limits: unset → 5 % / 0 / 0; only an ADMIN writes them.
        PosDtos.SettingsView unset = settings.get(cashier, inst);
        assertFalse(unset.configured());
        same("5", unset.cashierDiscountPercent(), "default discount");
        same("0", unset.cashRefundLimit(), "default cash refund limit");
        same("0", unset.cashVarianceLimit(), "default variance limit");
        PosDtos.SettingsView set = settings.update(admin, inst, new PosDtos.SettingsRequest(amount("5.00"),
                amount("500.00"), amount("0.00")));
        assertTrue(set.configured());
        same("500", settings.get(manager, inst).cashRefundLimit(), "refund limit");

        // The approvers of the online counter: the manager with a PIN; the cashier answer carries no cost.
        List<PosDtos.Approver> approvers = catalogue.approvers(cashier, inst, r1).approvers();
        assertTrue(approvers.stream().anyMatch(a -> a.userId().equals(managerId)), approvers.toString());
        PosDtos.CatalogueAnswer items = catalogue.catalogue(cashier, inst, r1, null);
        assertTrue(items.items().stream().anyMatch(i -> i.variantId().equals(bottle) && i.onHand() == 20));
        noCost(items, "the cashier's catalogue");
        String piece = text("SELECT code FROM commerce_piece WHERE package_session_id = ? ORDER BY code LIMIT 1",
                scarf);
        PosDtos.ScanAnswer scanned = catalogue.scan(cashier, inst, r1, piece);
        assertEquals("PIECE", scanned.kind());
        assertTrue(scanned.piece().here());
        noCost(scanned, "the cashier's scan");
    }

    // ================================================================== 3. sessions

    @Test
    @Order(3)
    void sessionRulesTwoCashiersRaceForOneRegister() throws Exception {
        // Two cashiers open the same register at the same moment: exactly one wins.
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CyclicBarrier start = new CyclicBarrier(2);
        List<Future<String>> results = new ArrayList<>();
        for (CustomUserDetails who : List.of(cashier, cashierB)) {
            results.add(pool.submit(() -> {
                header(inst);
                start.await(10, TimeUnit.SECONDS);
                try {
                    return "OPENED:" + sessions.open(who, inst, new PosDtos.SessionOpenRequest(key(), r1,
                            amount("200.00"), null)).session().id();
                } catch (ConflictException e) {
                    return e.getMessage();
                }
            }));
        }
        List<String> answers = new ArrayList<>();
        for (Future<String> result : results) {
            answers.add(result.get(60, TimeUnit.SECONDS));
        }
        pool.shutdown();
        assertEquals(1, answers.stream().filter(a -> a.startsWith("OPENED:")).count(), answers.toString());
        assertEquals(1, answers.stream().filter(a -> a.startsWith("SESSION_ALREADY_OPEN")).count(), answers.toString());
        assertEquals(1, count("SELECT count(*) FROM pos_session WHERE register_id = ? AND status = 'OPEN'", r1));
        String won = answers.stream().filter(a -> a.startsWith("OPENED:")).findFirst().orElseThrow().substring(7);
        String holder = text("SELECT cashier_user_id FROM pos_session WHERE id = ?", won);
        CustomUserDetails winner = holder.equals(cashierId) ? cashier : cashierB;

        // The holder is named to the next one who tries.
        refused("SESSION_ALREADY_OPEN", () -> sessions.open(winner == cashier ? cashierB : cashier, inst,
                new PosDtos.SessionOpenRequest(key(), r1, amount("0.00"), null)));
        // Cash in or out is a manager's: a cashier gets 403 on their own counter.
        assertEquals("ROLE_NOT_ALLOWED", denied(() -> sessions.cashMovement(winner, inst, won,
                new PosDtos.CashMovementRequest(key(), "CASH_IN", amount("100.00"), "Float"))));
        sessions.cashMovement(manager, inst, won, new PosDtos.CashMovementRequest(key(), "CASH_IN", amount("100.00"),
                "Float for change"));
        same("300.00", expected(won), "200 opening + 100 in");
        assertEquals("CLOSED", closeEven(winner, won).status());

        // One OPEN session per cashier: C holds R1 and cannot open R2 too.
        String c1 = open(cashier, r1, "300.00");
        RuntimeException twice = refused("SESSION_ALREADY_OPEN", () -> sessions.open(cashier, inst,
                new PosDtos.SessionOpenRequest(key(), r2, amount("0.00"), null)));
        assertTrue(twice.getMessage().contains("you already have counter"), twice.getMessage());
        // Another cashier on C's counter: 403 SESSION_NOT_YOURS.
        assertEquals("SESSION_NOT_YOURS", denied(() -> sessions.detail(cashierB, inst, c1)));
        assertEquals("SESSION_NOT_YOURS", denied(() -> sell(cashierB, c1, List.of(line("l1", spoon, 1, null)),
                List.of(cash("50.00")))));
        assertEquals(0, ordersOf(c1));
        assertEquals("CLOSED", closeEven(cashier, c1).status());

        // A float that differs from the last close needs a note.
        refused("OPENING_NOTE_REQUIRED", () -> sessions.open(cashier, inst,
                new PosDtos.SessionOpenRequest(key(), r1, amount("301.00"), null)));
        String c2 = sessions.open(cashier, inst, new PosDtos.SessionOpenRequest(key(), r1, amount("301.00"),
                "One coin found in the tray")).session().id();
        assertEquals(0, amount("300.00").compareTo(sessions.detail(cashier, inst, c2).previousCountedCash()));
        closeEven(cashier, c2);
    }

    // ================================================================== 4. gate 6

    @Test
    @Order(4)
    void gate6_cashPlusUpiThenCloseZeroVariance() throws Exception {
        String s = open(cashier, r1, "500.00");
        PosSaleService.Outcome sold = sell(cashier, s, List.of(line("l1", bottle, 2, null)),
                List.of(new PosDtos.Tender("CASH", amount("500.00"), amount("1000.00"), null),
                        upi("400.00", "UPI ref 4411")));
        assertFalse(sold.replayed());
        PosDtos.Receipt receipt = sold.answer().receipt();
        same("900.00", receipt.totals().total(), "total");
        assertEquals(2, receipt.tenders().size());
        same("1000.00", receipt.cashTendered(), "cash handed over");
        same("500.00", receipt.change(), "change");
        assertNull(receipt.customer(), "a walk-in has no customer on the bill");
        noCost(sold.answer(), "the cashier's sale answer");
        same("1000.00", expected(s), "500 opening + 500 cash");

        PosDtos.SessionView closed = closeEven(cashier, s);
        same("0", closed.variance(), "variance");
        PosDtos.ZReport z = closed.zReport();
        assertEquals(1, z.bills().count());
        same("900.00", z.bills().total(), "bills total");
        Map<String, BigDecimal> byMode = new HashMap<>();
        z.byMode().forEach(m -> byMode.put(m.mode(), m.amount()));
        assertEquals(Map.of("CASH", amount("500.00"), "UPI", amount("400.00")).keySet(), byMode.keySet());
        same("500.00", byMode.get("CASH"), "Z cash");
        same("400.00", byMode.get("UPI"), "Z UPI");
        assertEquals(receipt.document().number(), z.firstInvoiceNumber());
        assertEquals(receipt.document().number(), z.lastInvoiceNumber());
        assertEquals("CLOSED", text("SELECT status FROM pos_session WHERE id = ?", s));
        assertNotNull(text("SELECT z_report_json FROM pos_session WHERE id = ?", s));
        noCost(closed, "the cashier's close answer");
    }

    // ================================================================== 5. tenders

    @Test
    @Order(5)
    void splitTenderSumsAndChange() {
        String s = open(cashier, r2, "100.00");
        long before = allOrders();
        List<PosDtos.SaleLine> three = List.of(line("l1", bottle, 3, null));
        refused("TENDERS_SHORT", () -> sell(cashier, s, three, List.of(cash("1000.00"))));
        refused("TENDERS_OVER", () -> sell(cashier, s, three, List.of(cash("1000.00"), upi("400.00", "U1"))));
        refused("CASH_TENDERED_SHORT", () -> sell(cashier, s, three, List.of(
                new PosDtos.Tender("CASH", amount("350.00"), amount("300.00"), null), upi("1000.00", "U2"))));
        refused("PRICE_CHANGED: line l1 is now 450.00", () -> sell(cashier, s, List.of(new PosDtos.SaleLine("l1",
                bottle, 3, null, null, amount("449.00"))), List.of(cash("1347.00"))));
        refused("VALIDATION", () -> sell(cashier, s, three, List.of(cash("350.00"),
                new PosDtos.Tender("UPI", amount("1000.00"), null, null))));
        assertEquals(before, allOrders(), "no refused bill wrote anything");

        PosSaleService.Outcome sold = sell(cashier, s, three, List.of(
                new PosDtos.Tender("CASH", amount("350.00"), amount("500.00"), null), upi("500.00", "UPI 7001"),
                new PosDtos.Tender("CARD", amount("500.00"), null, "slip 3002")));
        String order = sold.answer().sale().orderId();
        same("1350.00", money("SELECT total FROM commerce_order WHERE id = ?", order), "total");
        same("1350.00", money("SELECT amount_paid FROM commerce_order WHERE id = ?", order), "amount paid");
        assertEquals("PAID", text("SELECT payment_status FROM commerce_order WHERE id = ?", order));
        same("1350.00", money("SELECT SUM(amount) FROM commerce_order_tender WHERE order_id = ? AND status = "
                + "'RECEIVED' AND pos_session_id = ?", order, s), "tenders = total, stamped with the session");
        same("500.00", money("SELECT cash_tendered FROM commerce_order_tender WHERE order_id = ? AND mode = 'CASH'",
                order), "cash tendered stored");
        assertNull(money("SELECT cash_tendered FROM commerce_order_tender WHERE order_id = ? AND mode = 'UPI'", order));
        same("150.00", sold.answer().receipt().change(), "change");
        same("150.00", sold.answer().sale().changeDue(), "change on the detail");
        assertEquals(0, count("SELECT count(*) FROM payment_log pl JOIN commerce_order_line l ON l.payment_log_id = "
                + "pl.id WHERE l.order_id = ? AND pl.payment_status <> 'PAID'", order), "logs PAID");
        assertEquals(0, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.status <> 'ACTIVE'", order), "plans ACTIVE");
        same("450.00", expected(s), "100 opening + 350 cash");
        closeEven(cashier, s);
    }

    // ================================================================== 6. double tap

    @Test
    @Order(6)
    void doubleTapMakesOneBill() throws Exception {
        String s = open(cashier, r1, "0.00");
        long next = nextValue(r1Series);
        String tapKey = key();
        PosDtos.SaleRequest tap = body(tapKey, s, List.of(line("l1", bottle, 1, null)), List.of(cash("450.00")));
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CyclicBarrier start = new CyclicBarrier(2);
        List<Future<PosSaleService.Outcome>> taps = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            taps.add(pool.submit(() -> {
                header(inst);
                start.await(10, TimeUnit.SECONDS);
                return sales.sale(cashier, inst, tap);
            }));
        }
        List<PosSaleService.Outcome> outcomes = new ArrayList<>();
        for (Future<PosSaleService.Outcome> f : taps) {
            outcomes.add(f.get(60, TimeUnit.SECONDS));
        }
        pool.shutdown();
        String orderId = outcomes.get(0).answer().sale().orderId();
        assertEquals(orderId, outcomes.get(1).answer().sale().orderId(), "both taps answer the same bill");
        assertEquals(outcomes.get(0).answer().receipt().document().number(),
                outcomes.get(1).answer().receipt().document().number());
        assertEquals(1, outcomes.stream().filter(PosSaleService.Outcome::replayed).count(), "one new, one replay");
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE institute_id = ? AND client_request_id = ?",
                inst, tapKey));
        assertEquals(1, count("SELECT count(*) FROM invoice WHERE commerce_order_id = ?", orderId));
        assertEquals(next + 1, nextValue(r1Series), "one invoice number");
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE reference_id IN (SELECT id FROM "
                + "commerce_order_line WHERE order_id = ?)", orderId), "one set of movements");
        assertEquals(1, ordersOf(s));

        PosSaleService.Outcome again = sales.sale(cashier, inst, tap);
        assertTrue(again.replayed());
        assertEquals(orderId, again.answer().sale().orderId());
        refused("IDEMPOTENCY_MISMATCH", () -> sales.sale(cashier, inst, body(tapKey, s,
                List.of(line("l1", bottle, 2, null)), List.of(cash("900.00")))));
        // A PIN added on a resend changes nothing: the hash leaves the approval out.
        PosDtos.SaleRequest withPin = new PosDtos.SaleRequest(tapKey, s, List.of(line("l1", bottle, 1, null)), null,
                null, List.of(cash("450.00")), null, pin(managerId, PIN), null, null, null);
        assertTrue(sales.sale(cashier, inst, withPin).replayed());
        assertEquals(next + 1, nextValue(r1Series));
        same("450.00", expected(s), "one bill of cash");

        // Two different bills race for the same piece: one sells it, the other is refused whole.
        String piece = pieces(scarf, "IN_STOCK").get(0);
        int scarfSlots = slots(scarf);
        long racedNext = nextValue(r1Series);
        ExecutorService racers = Executors.newFixedThreadPool(2);
        CyclicBarrier go = new CyclicBarrier(2);
        List<Future<String>> raced = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            raced.add(racers.submit(() -> {
                header(inst);
                go.await(10, TimeUnit.SECONDS);
                try {
                    return "SOLD:" + sell(cashier, s, List.of(line("l1", scarf, 1, List.of(piece))),
                            List.of(cash("1200.00"))).answer().sale().orderId();
                } catch (ConflictException e) {
                    return e.getMessage();
                }
            }));
        }
        List<String> pieceAnswers = new ArrayList<>();
        for (Future<String> f : raced) {
            pieceAnswers.add(f.get(60, TimeUnit.SECONDS));
        }
        racers.shutdown();
        assertEquals(1, pieceAnswers.stream().filter(x -> x.startsWith("SOLD:")).count(), pieceAnswers.toString());
        assertEquals(1, pieceAnswers.stream().filter(x -> x.startsWith("PIECE_STATE")).count(), pieceAnswers.toString());
        assertEquals(scarfSlots - 1, slots(scarf), "one unit left the online counters");
        assertEquals(racedNext + 1, nextValue(r1Series), "one number for one bill");
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE piece_id = ? AND type = 'POS_SALE'", piece));
        same("1650.00", expected(s), "one more bill of cash");
        closeEven(cashier, s);
    }

    // ================================================================== 7. no invoice number on a failure

    @Test
    @Order(7)
    void failureAfterStockStepUsesNoInvoiceNumber() {
        // (a) A store-only counter: line 1 has stock, line 2 has none there.
        String s2 = open(cashier, r2, "0.00");
        long r2Next = nextValue(r2Series);
        long generalNext = nextValue(generalSeries);
        int bottleAtStore = onHand(store, bottle);
        long movements = allMovements();
        long holds = allHolds();
        long orders = allOrders();
        String failKey = key();
        refused("NOT_IN_STOCK", () -> sales.sale(cashier, inst, body(failKey, s2,
                List.of(line("l1", bottle, 1, null), line("l2", cup, 1, null)), List.of(cash("750.00")))));
        assertEquals(r2Next, nextValue(r2Series), "no number taken");
        assertEquals(generalNext, nextValue(generalSeries));
        assertEquals(bottleAtStore, onHand(store, bottle), "line 1's stock is back");
        assertEquals(movements, allMovements());
        assertEquals(holds, allHolds());
        assertEquals(orders, allOrders());
        assertEquals(0, count("SELECT count(*) FROM commerce_order WHERE client_request_id = ?", failKey));
        closeEven(cashier, s2);

        // (b) The register's series closed and no other series fits: refused after the stock step.
        String s1 = open(cashier, r1, "0.00");
        seriesService.setStatus(inst, adminId, r1Series, "CLOSED");
        seriesService.setStatus(inst, adminId, generalSeries, "CLOSED");
        long r1Next = nextValue(r1Series);
        long r1Issued = count("SELECT count(*) FROM invoice WHERE series_id = ?", r1Series);
        String piece = pieces(scarf, "IN_STOCK").get(0);
        int scarfSlots = slots(scarf);
        int bottleSlots = slots(bottle);
        int bottleOnline = onHand(online, bottle);
        movements = allMovements();
        holds = allHolds();
        orders = allOrders();
        String retryKey = key();
        PosDtos.SaleRequest both = body(retryKey, s1, List.of(line("l1", scarf, 1, List.of(piece)),
                line("l2", bottle, 1, null)), List.of(cash("1650.00")));
        refused("SERIES_NOT_CONFIGURED", () -> sales.sale(cashier, inst, both));
        assertEquals("IN_STOCK", text("SELECT status FROM commerce_piece WHERE id = ?", piece));
        assertNull(text("SELECT order_line_id FROM commerce_piece WHERE id = ?", piece));
        assertEquals(scarfSlots, slots(scarf));
        assertEquals(bottleSlots, slots(bottle));
        assertEquals(bottleOnline, onHand(online, bottle));
        assertEquals(movements, allMovements(), "the POS_SALE movements rolled back");
        assertEquals(holds, allHolds(), "the SOLD hold rows rolled back");
        assertEquals(orders, allOrders(), "the order rolled back");
        assertEquals(r1Next, nextValue(r1Series));
        same("0.00", expected(s1), "no tender was kept");

        // Reopened: the same request goes through and takes the next number, with no gap.
        seriesService.setStatus(inst, adminId, r1Series, "ACTIVE");
        seriesService.setStatus(inst, adminId, generalSeries, "ACTIVE");
        PosSaleService.Outcome sold = sales.sale(cashier, inst, both);
        String invoiceSeries = text("SELECT series_id FROM invoice WHERE commerce_order_id = ?",
                sold.answer().sale().orderId());
        assertEquals(r1Series, invoiceSeries);
        assertEquals(r1Next, count("SELECT substring(invoice_number from '([0-9]+)$')::bigint FROM invoice WHERE "
                + "commerce_order_id = ?",
                sold.answer().sale().orderId()), "the number the failed sale did not use");
        assertEquals(r1Next + 1, nextValue(r1Series));
        assertEquals(r1Issued + 1, count("SELECT count(*) FROM invoice WHERE series_id = ?", r1Series));
        consecutive(r1Series);
        closeEven(cashier, s1);
    }

    /** The SYSTEM numbers of a series are 1..n with no gap and no repeat. */
    private void consecutive(String series) {
        List<Long> numbers = db.queryForList("SELECT substring(invoice_number from '([0-9]+)$')::bigint AS n "
                + "FROM invoice WHERE series_id = ? ORDER BY n", Long.class, series);
        for (int i = 0; i < numbers.size(); i++) {
            assertEquals(Long.valueOf(i + 1), numbers.get(i), "numbers of series " + series + ": " + numbers);
        }
        assertEquals(numbers.size() + 1, nextValue(series));
    }

    // ================================================================== 8. stock, holds, cost

    @Test
    @Order(8)
    void stockAndHoldRowsAtAnOnlineAndAStoreOnlyCounter() {
        String s1 = open(cashier, r1, "0.00");
        String piece = pieces(scarf, "IN_STOCK").get(0);
        int bottleSlots = slots(bottle);
        int bottleSeats = maxSeats(bottle);
        int scarfSlots = slots(scarf);
        int scarfSeats = maxSeats(scarf);
        int bottleOnline = onHand(online, bottle);
        PosSaleService.Outcome sold = sell(cashier, s1, List.of(line("l1", bottle, 2, null),
                line("l2", scarf, 1, List.of(piece))), List.of(cash("2100.00")));
        String order = sold.answer().sale().orderId();
        String bottleLine = text("SELECT id FROM commerce_order_line WHERE order_id = ? AND package_session_id = ?",
                order, bottle);
        String scarfLine = text("SELECT id FROM commerce_order_line WHERE order_id = ? AND package_session_id = ?",
                order, scarf);
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE idempotency_key = ? AND type = 'POS_SALE' "
                + "AND quantity_delta = -2 AND location_id = ? AND unit_cost = 100", "POS_SALE:" + bottleLine, online));
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE idempotency_key = ? AND type = 'POS_SALE' "
                + "AND quantity_delta = -1 AND piece_id = ? AND unit_cost = 500", "POS_SALE:" + scarfLine + ":" + piece,
                piece));
        same("200.00", money("SELECT cost_total FROM commerce_order_line WHERE id = ?", bottleLine), "bottle cost");
        same("500.00", money("SELECT cost_total FROM commerce_order_line WHERE id = ?", scarfLine), "piece cost");
        assertEquals(0, count("SELECT count(*) FROM commerce_order_line l WHERE l.order_id = ? AND l.line_type = "
                + "'ITEM' AND l.cost_total <> (SELECT SUM(m.unit_cost * -m.quantity_delta) FROM stock_movement m "
                + "WHERE m.reference_id = l.id)", order), "cost_total = Σ movement cost");
        assertEquals("SOLD", text("SELECT status FROM commerce_piece WHERE id = ?", piece));
        assertEquals(scarfLine, text("SELECT order_line_id FROM commerce_piece WHERE id = ?", piece));
        assertEquals(piece, text("SELECT piece_id FROM commerce_order_line WHERE id = ?", scarfLine));
        assertEquals(2, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.status = 'RESTORED' AND h.release_reason = 'POS_SALE'",
                order), "one closed hold row per tracked line");
        assertEquals(0, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.status IN ('SOLD', 'HELD')", order));
        assertEquals(bottleSlots - 2, slots(bottle), "online: both counters fall");
        assertEquals(bottleSeats - 2, maxSeats(bottle));
        assertEquals(scarfSlots - 1, slots(scarf));
        assertEquals(scarfSeats - 1, maxSeats(scarf));
        assertEquals(bottleOnline - 2, onHand(online, bottle));
        noDrift("online sale");
        closeEven(cashier, s1);

        // A store-only counter: its shelf falls, the online counters do not move.
        String s2 = open(cashier, r2, "0.00");
        int atStore = onHand(store, bottle);
        bottleSlots = slots(bottle);
        bottleSeats = maxSeats(bottle);
        PosSaleService.Outcome atL2 = sell(cashier, s2, List.of(line("l1", bottle, 1, null)), List.of(cash("450.00")));
        assertEquals(atStore - 1, onHand(store, bottle));
        assertEquals(bottleSlots, slots(bottle), "a store-only sale leaves available_slots");
        assertEquals(bottleSeats, maxSeats(bottle), "and max_seats");
        assertEquals(bottleOnline - 2, onHand(online, bottle), "nothing at L1 for a sale at L2");
        assertEquals(1, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.status = 'RESTORED'", atL2.answer().sale().orderId()));
        same("100.00", money("SELECT cost_total FROM commerce_order_line WHERE order_id = ? AND line_type = 'ITEM'",
                atL2.answer().sale().orderId()), "cost stamped at the store too");
        reconciliationJob.run();
        noDrift("store sale");
        closeEven(cashier, s2);
    }

    // ================================================================== 9. gate 5

    @Test
    @Order(9)
    void gate5_onlineCheckoutAndPaidOnlineBlockTheTill() {
        String s1 = open(cashier, r1, "0.00");
        List<String> bagPieces = pieces(bag, "IN_STOCK");
        assertEquals(3, bagPieces.size());
        String p1 = bagPieces.get(0);
        String p2 = bagPieces.get(1);
        long orders = allOrders();
        long movements = allMovements();

        // Every unit is in an online checkout (HELD): the till names the checkout and its end.
        List<StockHold> holdA = stockHoldService.hold(inst, Map.of(bag, 1), StockHoldKind.PURCHASE);
        stockHoldService.attach(holdA, "shopper-a-" + run, null, "loga-" + run);
        List<StockHold> holdB = stockHoldService.hold(inst, Map.of(bag, 2), StockHoldKind.PURCHASE);
        stockHoldService.attach(holdB, "shopper-b-" + run, null, "logb-" + run);
        assertEquals(0, slots(bag));
        RuntimeException held = refused("IN_ONLINE_CHECKOUT", () -> sell(cashier, s1,
                List.of(line("l1", bag, 1, List.of(p1))), List.of(cash("800.00"))));
        assertTrue(held.getMessage().matches(".* until \\d\\d:\\d\\d$"), held.getMessage());
        // The checkout's end in India time: now + the 30-minute hold.
        java.time.LocalTime until = java.time.LocalTime.parse(held.getMessage().substring(held.getMessage().length() - 5));
        long off = Math.abs(java.time.Duration.between(java.time.LocalTime.now(INDIA).plusMinutes(
                StockHoldService.HOLD_MINUTES), until).toMinutes());
        assertTrue(off <= 2 || off >= 24 * 60 - 2, "until " + until + " is the hold's end in India time");
        assertEquals("IN_STOCK", text("SELECT status FROM commerce_piece WHERE id = ?", p1));
        assertEquals(orders, allOrders());
        assertEquals(movements, allMovements());
        noDrift("checkout block");

        // Order A paid online and packed (its piece RESERVED); checkout B abandoned (2 units free).
        stockHoldService.markSoldNow(holdA);
        stockHoldService.releaseForOrder("logb-" + run);
        assertEquals(2, slots(bag));
        db.update("UPDATE commerce_piece SET status = 'RESERVED' WHERE id = ?", p1);
        RuntimeException packed = refused("SOLD_ONLINE", () -> sell(cashier, s1,
                List.of(line("l1", bag, 1, List.of(p1))), List.of(cash("800.00"))));
        assertTrue(packed.getMessage().contains("is packed for an online order"), packed.getMessage());
        assertEquals(2, slots(bag), "the slot taken before the piece refusal rolled back");
        assertEquals(orders, allOrders());
        assertEquals(movements, allMovements());

        // Two more paid online (CONFIRMED): no unit is unpromised, a free piece is still refused.
        List<StockHold> holdC = stockHoldService.hold(inst, Map.of(bag, 2), StockHoldKind.PURCHASE);
        stockHoldService.markSoldNow(holdC);
        assertEquals(0, slots(bag));
        RuntimeException sold = refused("SOLD_ONLINE", () -> sell(cashier, s1,
                List.of(line("l1", bag, 1, List.of(p2))), List.of(cash("800.00"))));
        assertTrue(sold.getMessage().contains("is sold online and awaits dispatch"), sold.getMessage());
        assertEquals("IN_STOCK", text("SELECT status FROM commerce_piece WHERE id = ?", p2));
        assertEquals(orders, allOrders(), "nothing written by the refused sales");
        assertEquals(movements, allMovements());
        assertEquals(0, ordersOf(s1));
        noDrift("gate 5");
        closeEven(cashier, s1);
    }

    // ================================================================== 10. gate 24

    @Test
    @Order(10)
    void gate24_voidInSessionAndTenderChange(CapturedOutput output) {
        String s1 = open(cashier, r1, "1000.00");
        String piece = pieces(scarf, "IN_STOCK").get(0);
        int bottleOnline = onHand(online, bottle);
        int bottleSlots = slots(bottle);
        int bottleSeats = maxSeats(bottle);
        int scarfSlots = slots(scarf);
        PosSaleService.Outcome sold = sell(cashier, s1, List.of(line("l1", bottle, 2, null),
                line("l2", scarf, 1, List.of(piece))), List.of(cash("1100.00"), upi("1000.00", "UPI 9001")));
        String orderId = sold.answer().sale().orderId();
        String number = sold.answer().receipt().document().number();
        same("2100.00", expected(s1), "1000 opening + 1100 cash");

        // A cashier's void needs a PIN; a wrong PIN is refused, counted, not stored and not logged.
        refused("APPROVAL_REQUIRED: POS_VOID", () -> corrections.voidSale(cashier, inst, orderId,
                new PosDtos.VoidRequest(key(), "Keyed twice", null)));
        assertEquals("PIN_INVALID", denied(() -> corrections.voidSale(cashier, inst, orderId,
                new PosDtos.VoidRequest(key(), "Keyed twice", pin(managerId, WRONG_PIN)))));
        assertEquals("DELIVERED", text("SELECT status FROM commerce_order WHERE id = ?", orderId));
        assertEquals(0, approvals("POS_VOID", orderId), "no approval row for a wrong PIN");
        assertEquals(1, count("SELECT failed_attempts FROM commerce_staff_pin WHERE institute_id = ? AND user_id = ?",
                inst, managerId), "the wrong try is counted");
        // Not even the cashier can approve their own void.
        assertEquals("PIN_INVALID", denied(() -> corrections.voidSale(cashier, inst, orderId,
                new PosDtos.VoidRequest(key(), "Keyed twice", pin(cashierId, PIN)))));

        PosDtos.SaleAnswer voided = corrections.voidSale(cashier, inst, orderId, new PosDtos.VoidRequest(key(),
                "Keyed twice", pin(managerId, PIN)));
        assertEquals("CANCELLED", voided.sale().status());
        assertEquals("POS_VOID", text("SELECT cancel_reason FROM commerce_order WHERE id = ?", orderId));
        assertTrue(voided.receipt().document().cancelled());
        assertEquals(number, voided.receipt().document().number(), "the void keeps the number");
        assertEquals(1, count("SELECT count(*) FROM invoice WHERE commerce_order_id = ? AND cancelled_at IS NOT NULL "
                + "AND invoice_number = ?", orderId, number));
        assertEquals(2, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = 'VOID'",
                orderId));
        same("0", money("SELECT amount_paid FROM commerce_order WHERE id = ?", orderId), "amount paid");
        assertEquals(bottleOnline, onHand(online, bottle), "stock back exactly");
        assertEquals(bottleSlots, slots(bottle), "available_slots back");
        assertEquals(bottleSeats, maxSeats(bottle), "max_seats back");
        assertEquals(scarfSlots, slots(scarf));
        assertEquals("IN_STOCK", text("SELECT status FROM commerce_piece WHERE id = ?", piece));
        assertNull(text("SELECT order_line_id FROM commerce_piece WHERE id = ?", piece));
        assertEquals(2, count("SELECT count(*) FROM stock_movement WHERE reason = 'POS_VOID' AND reverses_movement_id "
                + "IS NOT NULL AND reference_id IN (SELECT id FROM commerce_order_line WHERE order_id = ?)", orderId));
        assertEquals(0, count("SELECT count(*) FROM (SELECT m.package_session_id FROM stock_movement m WHERE "
                + "m.reference_id IN (SELECT id FROM commerce_order_line WHERE order_id = ?) GROUP BY "
                + "m.package_session_id HAVING SUM(m.quantity_delta) <> 0) x", orderId),
                "every sale movement reversed exactly");
        same("1000.00", expected(s1), "the voided cash is no longer expected");
        assertEquals(1, approvals("POS_VOID", orderId));
        assertEquals(managerId, text("SELECT approved_by FROM commerce_approval WHERE reference_id = ? AND action = "
                + "'POS_VOID'", orderId));
        assertEquals(0, count("SELECT failed_attempts FROM commerce_staff_pin WHERE institute_id = ? AND user_id = ?",
                inst, managerId), "a good PIN clears the count");
        assertFalse(output.getAll().contains(WRONG_PIN), "the wrong PIN is never logged");
        assertFalse(output.getAll().contains(PIN), "the PIN is never logged");
        for (String raw : List.of(PIN, WRONG_PIN)) {
            assertEquals(0, count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND (COALESCE("
                    + "new_value_json::text, '') LIKE ? OR COALESCE(old_value_json::text, '') LIKE ? OR COALESCE(reason, "
                    + "'') LIKE ?)", inst, "%" + raw + "%", "%" + raw + "%", "%" + raw + "%"), "no PIN in the audit");
            assertEquals(0, count("SELECT count(*) FROM commerce_approval WHERE institute_id = ? AND COALESCE(reason, "
                    + "'') LIKE ?", inst, "%" + raw + "%"), "no PIN in an approval");
        }
        assertEquals(0, count("SELECT count(*) FROM commerce_staff_pin WHERE pin_hash IN (?, ?)", PIN, WRONG_PIN));

        // Tender change by the cashier needs a PIN and moves the expected cash.
        PosSaleService.Outcome second = sell(cashier, s1, List.of(line("l1", bottle, 1, null)), List.of(cash("450.00")));
        String secondId = second.answer().sale().orderId();
        String tenderId = second.answer().sale().tenders().get(0).id();
        same("1450.00", expected(s1), "with the second bill");
        refused("APPROVAL_REQUIRED: POS_TENDER_CHANGE", () -> corrections.changeTender(cashier, inst, secondId,
                tenderId, new PosDtos.TenderChangeRequest(key(), "UPI", "UPI 9002", null)));
        PosDtos.SaleAnswer changed = corrections.changeTender(cashier, inst, secondId, tenderId,
                new PosDtos.TenderChangeRequest(key(), "UPI", "UPI 9002", pin(managerId, PIN)));
        assertEquals("VOID", changed.sale().tenders().get(0).status());
        assertEquals("UPI", changed.sale().tenders().get(1).mode());
        assertEquals(s1, text("SELECT pos_session_id FROM commerce_order_tender WHERE order_id = ? AND mode = 'UPI'",
                secondId));
        same("1000.00", expected(s1), "the cash left the expected drawer");
        assertEquals(1, approvals("POS_TENDER_CHANGE", tenderId));

        // A manager voids a bill of the cashier's session at their own location with no PIN.
        PosSaleService.Outcome third = sell(cashier, s1, List.of(line("l1", bottle, 1, null)), List.of(cash("450.00")));
        PosDtos.SaleAnswer byManager = corrections.voidSale(manager, inst, third.answer().sale().orderId(),
                new PosDtos.VoidRequest(key(), "Buyer changed their mind", null));
        assertEquals("CANCELLED", byManager.sale().status());
        assertEquals(0, approvals("POS_VOID", third.answer().sale().orderId()));
        same("1000.00", expected(s1), "after the manager's void");

        PosDtos.SessionView closed = closeEven(cashier, s1);
        assertEquals(2, closed.zReport().voided().count());
        assertEquals(1, closed.zReport().bills().count());
        refused("VOID_SESSION_CLOSED", () -> corrections.voidSale(cashier, inst, secondId,
                new PosDtos.VoidRequest(key(), "Too late", pin(managerId, PIN))));
        refused("SESSION_NOT_OPEN", () -> corrections.changeTender(manager, inst, secondId,
                changed.sale().tenders().get(1).id(), new PosDtos.TenderChangeRequest(key(), "CASH", null, null)));
    }

    // ================================================================== 11. discount limit

    @Test
    @Order(11)
    void discountAboveTheCashierLimitNeedsAManagerPin() {
        String s2 = open(cashier, r2, "0.00");
        long r2Next = nextValue(r2Series);
        // 2 bottles = 900.00 gross; 5 % = 45.00 is the cashier's limit.
        PosDtos.SaleLine atLimit = new PosDtos.SaleLine("l1", bottle, 2, null, amount("45.00"), null);
        PosDtos.Quote quote = sales.quote(cashier, inst, new PosDtos.SaleRequest(null, s2, List.of(atLimit), null, null,
                null, null, null, null, null, null, "Old customer"));
        assertTrue(quote.needsApproval().isEmpty(), quote.needsApproval().toString());
        String total = quote.totals().total().toPlainString();
        PosSaleService.Outcome ok = sales.sale(cashier, inst, new PosDtos.SaleRequest(key(), s2, List.of(atLimit), null,
                null, List.of(cash(total)), null, null, null, null, null, "Old customer"));
        assertEquals(0, approvals("POS_DISCOUNT", ok.answer().sale().orderId()));

        PosDtos.SaleLine over = new PosDtos.SaleLine("l1", bottle, 2, null, amount("45.01"), null);
        PosDtos.Quote quoteOver = sales.quote(cashier, inst, new PosDtos.SaleRequest(null, s2, List.of(over), null,
                null, null, null, null, null, null, null, "Old customer"));
        assertEquals(List.of("POS_DISCOUNT"), quoteOver.needsApproval());
        String overTotal = quoteOver.totals().total().toPlainString();
        long orders = allOrders();
        refused("APPROVAL_REQUIRED: POS_DISCOUNT", () -> sales.sale(cashier, inst, new PosDtos.SaleRequest(key(), s2,
                List.of(over), null, null, List.of(cash(overTotal)), null, null, null, null, null, "Old customer")));
        assertEquals("PIN_INVALID", denied(() -> sales.sale(cashier, inst, new PosDtos.SaleRequest(key(), s2,
                List.of(over), null, null, List.of(cash(overTotal)), null, pin(managerId, WRONG_PIN), null, null, null,
                "Old customer"))));
        assertEquals(orders, allOrders(), "a refused PIN writes no bill");
        assertEquals(r2Next + 1, nextValue(r2Series), "and takes no number");
        PosSaleService.Outcome approved = sales.sale(cashier, inst, new PosDtos.SaleRequest(key(), s2, List.of(over),
                null, null, List.of(cash(overTotal)), null, pin(managerId, PIN), null, null, null, "Old customer"));
        String approvedId = approved.answer().sale().orderId();
        assertEquals(1, approvals("POS_DISCOUNT", approvedId));
        same("45.01", money("SELECT amount FROM commerce_approval WHERE reference_id = ? AND action = 'POS_DISCOUNT'",
                approvedId), "the approval names the discount");
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE reference_id = ? AND kind = 'DISCOUNT'",
                approvedId));
        // A manager never needs a PIN, whatever the discount.
        PosDtos.SaleLine big = new PosDtos.SaleLine("l1", bottle, 1, null, amount("200.00"), null);
        String bigTotal = sales.quote(manager, inst, new PosDtos.SaleRequest(null, s2, List.of(big), null, null, null,
                null, null, null, null, null, "Damaged box")).totals().total().toPlainString();
        PosSaleService.Outcome byManager = sales.sale(manager, inst, new PosDtos.SaleRequest(key(), s2, List.of(big),
                null, null, List.of(cash(bigTotal)), null, null, null, null, null, "Damaged box"));
        assertEquals(0, approvals("POS_DISCOUNT", byManager.answer().sale().orderId()));
        consecutive(r2Series);
        closeEven(cashier, s2);
    }

    // ================================================================== 12. close with a variance

    @Test
    @Order(12)
    void closeWithAVarianceNeedsANoteAndForACashierAPin() {
        String s2 = open(cashier, r2, "0.00");
        sell(cashier, s2, List.of(line("l1", bottle, 1, null)), List.of(cash("450.00")));
        BigDecimal short50 = expected(s2).subtract(amount("50.00"));
        refused("VARIANCE_NOTE_REQUIRED", () -> sessions.close(cashier, inst, s2,
                new PosDtos.SessionCloseRequest(key(), short50, null, null, null)));
        refused("APPROVAL_REQUIRED: POS_VARIANCE", () -> sessions.close(cashier, inst, s2,
                new PosDtos.SessionCloseRequest(key(), short50, null, "Short by fifty", null)));
        assertEquals("PIN_INVALID", denied(() -> sessions.close(cashier, inst, s2,
                new PosDtos.SessionCloseRequest(key(), short50, null, "Short by fifty", pin(managerId, WRONG_PIN)))));
        assertEquals("OPEN", text("SELECT status FROM pos_session WHERE id = ?", s2));
        refused("COUNT_MISMATCH", () -> sessions.close(cashier, inst, s2, new PosDtos.SessionCloseRequest(key(),
                short50.add(amount("10.00")), Map.of("200", 2), "Short by fifty", pin(managerId, PIN))));
        PosDtos.SessionView closed = sessions.close(cashier, inst, s2, new PosDtos.SessionCloseRequest(key(), null,
                Map.of("200", 2), "Short by fifty", pin(managerId, PIN))).session();
        assertEquals("CLOSED", closed.status());
        same("-50.00", closed.variance(), "variance");
        same("400", closed.countedCash(), "counted from the notes");
        assertEquals(1, approvals("POS_VARIANCE", s2));
        assertEquals(Map.of("200", 2), closed.denominations());

        // A manager closes their own counter with a difference: a note, no PIN.
        String m2 = open(manager, r2, "400.00");
        PosDtos.SessionView managerClosed = sessions.close(manager, inst, m2, new PosDtos.SessionCloseRequest(key(),
                amount("420.00"), null, "Twenty over", null)).session();
        same("20.00", managerClosed.variance(), "manager's variance");
        assertEquals(0, approvals("POS_VARIANCE", m2));
    }

    // ================================================================== 13. counter return

    @Test
    @Order(13)
    void counterReturnCashRefundInSession() throws Exception {
        String s2 = open(cashier, r2, "420.00");
        PosSaleService.Outcome sold = sell(cashier, s2, List.of(line("l1", bottle, 2, null)), List.of(cash("900.00")));
        String orderId = sold.answer().sale().orderId();
        String lineId = sold.answer().sale().lines().get(0).orderLineId();
        int atStore = onHand(store, bottle);
        BigDecimal before = expected(s2);

        // Within the 500.00 limit: cash back with no PIN.
        PosReturnService.Outcome one = posReturns.create(cashier, inst, new PosDtos.ReturnRequest(key(), s2, orderId,
                List.of(new PosDtos.ReturnLine(lineId, 1, "RESALEABLE", null)), "DEFECTIVE", "Dent", null,
                new PosDtos.Settle("REFUND", "CASH", null), null));
        PosDtos.ReturnAnswer answer = one.answer();
        same("450.00", answer.credit(), "credit");
        assertNotNull(answer.creditNoteNumber());
        assertEquals("PROCESSED", answer.refund().status());
        assertEquals(s2, text("SELECT pos_session_id FROM commerce_refund WHERE id = ?", answer.refund().id()));
        assertEquals("CASH", text("SELECT method FROM commerce_refund WHERE id = ?", answer.refund().id()));
        assertEquals(store, text("SELECT location_id FROM commerce_return WHERE id = ?", answer.returnId()));
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE type = 'RETURN' AND location_id = ? AND "
                + "unit_cost = 100 AND reference_id IN (SELECT id FROM commerce_return_line WHERE return_id = ?)", store,
                answer.returnId()), "RETURN at the store at the sale's cost");
        assertEquals(atStore + 1, onHand(store, bottle));
        assertEquals(0, before.subtract(amount("450.00")).compareTo(expected(s2)), "the cash back left the drawer");
        assertEquals(0, count("SELECT count(*) FROM commerce_approval WHERE institute_id = ? AND action = "
                + "'POS_CASH_REFUND' AND reference_id = ?", inst, orderId));
        noCost(answer, "the cashier's return answer");

        // Above the limit: a PIN.
        PosSaleService.Outcome big = sell(cashier, s2, List.of(line("l1", bottle, 2, null)), List.of(cash("900.00")));
        String bigId = big.answer().sale().orderId();
        String bigLine = big.answer().sale().lines().get(0).orderLineId();
        PosDtos.ReturnPreview preview = posReturns.preview(cashier, inst, new PosDtos.ReturnPreviewRequest(s2, bigId,
                List.of(new PosDtos.ReturnLine(bigLine, 2, null, null)), null,
                new PosDtos.Settle("REFUND", "CASH", null)));
        assertEquals(List.of("POS_CASH_REFUND"), preview.needsApproval());
        PosDtos.ReturnRequest whole = new PosDtos.ReturnRequest(key(), s2, bigId,
                List.of(new PosDtos.ReturnLine(bigLine, 2, "RESALEABLE", null)), "DEFECTIVE", null, null,
                new PosDtos.Settle("REFUND", "CASH", null), null);
        refused("APPROVAL_REQUIRED: POS_CASH_REFUND", () -> posReturns.create(cashier, inst, whole));
        assertEquals(0, count("SELECT count(*) FROM commerce_return WHERE order_id = ?", bigId));
        BigDecimal mid = expected(s2);
        PosReturnService.Outcome two = posReturns.create(cashier, inst, new PosDtos.ReturnRequest(whole.clientRequestId(),
                s2, bigId, whole.lines(), "DEFECTIVE", null, null, whole.settle(), pin(managerId, PIN)));
        same("900.00", two.answer().credit(), "credit");
        assertEquals(1, approvals("POS_CASH_REFUND", bigId));
        assertEquals(0, mid.subtract(amount("900.00")).compareTo(expected(s2)));
        PosDtos.SessionView closed = closeEven(cashier, s2);
        assertTrue(closed.zReport().refunds().stream().anyMatch(r -> "CASH".equals(r.method()) && r.count() == 2),
                closed.zReport().refunds().toString());
        assertEquals(2, closed.zReport().returns().count());
    }

    // ================================================================== 14. exchange

    @Test
    @Order(14)
    void exchangeAtTill() {
        String s1 = open(cashier, r1, "0.00");
        String piece = pieces(scarf, "IN_STOCK").get(0);
        PosSaleService.Outcome sold = sell(cashier, s1, List.of(line("l1", scarf, 1, List.of(piece))),
                List.of(cash("1200.00")));
        String orderId = sold.answer().sale().orderId();
        String lineId = sold.answer().sale().lines().get(0).orderLineId();
        PosDtos.ReturnAnswer credit = posReturns.create(cashier, inst, new PosDtos.ReturnRequest(key(), s1, orderId,
                List.of(new PosDtos.ReturnLine(lineId, 1, "RESALEABLE", List.of(piece))), "DEFECTIVE", null, null,
                new PosDtos.Settle("EXCHANGE", null, null), null)).answer();
        assertNull(credit.refund());
        same("1200.00", credit.exchangeCredit(), "exchange credit");
        assertEquals("IN_STOCK", text("SELECT status FROM commerce_piece WHERE id = ?", piece));
        BigDecimal before = expected(s1);
        PosSaleService.Outcome swapped = sales.sale(cashier, inst, new PosDtos.SaleRequest(key(), s1,
                List.of(line("l1", bottle, 1, null)), null, null, List.of(),
                new PosDtos.Exchange(credit.returnId(), new PosDtos.RemainderRefund("CASH", null)), null, null, null,
                null));
        String newOrder = swapped.answer().sale().orderId();
        assertEquals(orderId, text("SELECT exchange_of_order_id FROM commerce_order WHERE id = ?", newOrder));
        assertEquals("CREDIT_NOTE", swapped.answer().sale().tenders().get(0).mode());
        same("450.00", swapped.answer().sale().tenders().get(0).amount(), "credit applied");
        assertEquals(s1, text("SELECT pos_session_id FROM commerce_refund WHERE idempotency_key = ?",
                "EXCH_REST:" + newOrder), "the remainder left this drawer");
        same("750.00", money("SELECT amount FROM commerce_refund WHERE idempotency_key = ?", "EXCH_REST:" + newOrder),
                "remainder");
        assertNull(text("SELECT pos_session_id FROM commerce_refund WHERE idempotency_key = ?", "EXCH:" + newOrder));
        assertEquals(0, before.subtract(amount("750.00")).compareTo(expected(s1)));
        refused("VOID_HAS_EXCHANGE", () -> corrections.voidSale(manager, inst, newOrder,
                new PosDtos.VoidRequest(key(), "No", null)));
        // Recorded, not changed: the remainder is cash out of the drawer above the cashier's refund
        // limit, and the contract asks no PIN for it (see the build record).
        assertEquals(0, count("SELECT count(*) FROM commerce_approval WHERE institute_id = ? AND reference_id IN (?, ?)",
                inst, orderId, newOrder));
        sessions.cashMovement(manager, inst, s1, new PosDtos.CashMovementRequest(key(), "CASH_IN", amount("750.00"),
                "Cover the exchange"));
        closeEven(cashier, s1);
    }

    // ================================================================== 15. gate 19

    @Test
    @Order(15)
    void gate19_billBookKeepsPaperNumberAndDate() {
        LocalDate today = LocalDate.now(INDIA);
        String s2 = open(cashier, r2, "0.00");
        long r2Next = nextValue(r2Series);
        long generalNext = nextValue(generalSeries);
        refused("APPROVAL_REQUIRED: POS_BILL_BOOK", () -> sales.billBook(cashier, inst,
                paper(s2, bottle, "123", today.minusDays(1), null)));
        PosSaleService.Outcome entered = sales.billBook(cashier, inst, paper(s2, bottle, "123", today.minusDays(1),
                pin(managerId, PIN)));
        String orderId = entered.answer().sale().orderId();
        assertEquals("123", text("SELECT external_invoice_number FROM invoice WHERE commerce_order_id = ?", orderId));
        assertEquals(today.minusDays(1).toString(), text("SELECT document_date::text FROM invoice WHERE "
                + "commerce_order_id = ?", orderId));
        assertNotEquals(generalSeries, text("SELECT series_id FROM invoice WHERE commerce_order_id = ?", orderId));
        assertEquals("MANUAL_BOOK", text("SELECT s.kind FROM invoice i JOIN commerce_document_series s ON s.id = "
                + "i.series_id WHERE i.commerce_order_id = ?", orderId));
        assertTrue(entered.answer().receipt().document().paper());
        assertEquals(r2Next, nextValue(r2Series), "no SYSTEM number taken");
        assertEquals(generalNext, nextValue(generalSeries));
        assertEquals(1, approvals("POS_BILL_BOOK", orderId));
        refused("BILL_BOOK_NUMBER_USED", () -> sales.billBook(cashier, inst, paper(s2, bottle, "123", today,
                pin(managerId, PIN))));
        refused("BILL_BOOK_NOT_REGISTERED", () -> sales.billBook(cashier, inst, paper(s2, bottle, "250", today,
                pin(managerId, PIN))));
        refused("BILL_DATE_INVALID", () -> sales.billBook(cashier, inst, paper(s2, bottle, "124", today.minusDays(5),
                pin(managerId, PIN))));
        // A paper bill keyed by mistake is voided like any bill; the store's shelf gets it back, the online
        // counters do not move, and its paper number stays used.
        PosSaleService.Outcome mistaken = sales.billBook(cashier, inst, paper(s2, bottle, "124", today,
                pin(managerId, PIN)));
        int atStore = onHand(store, bottle);
        int onlineSlots = slots(bottle);
        int onlineSeats = maxSeats(bottle);
        corrections.voidSale(cashier, inst, mistaken.answer().sale().orderId(), new PosDtos.VoidRequest(key(),
                "Wrong book", pin(managerId, PIN)));
        assertEquals(atStore + 1, onHand(store, bottle));
        assertEquals(onlineSlots, slots(bottle));
        assertEquals(onlineSeats, maxSeats(bottle));
        refused("BILL_BOOK_NUMBER_USED", () -> sales.billBook(cashier, inst, paper(s2, bottle, "124", today,
                pin(managerId, PIN))));
        PosDtos.SessionView closed = closeEven(cashier, s2);
        assertEquals(1, closed.zReport().billBook().count());
        assertEquals(1, closed.zReport().voided().count());
        assertEquals(0, closed.zReport().bills().count());

        // At the online counter with every online unit of the bottle promised to a staff order:
        // the paper sale happened, so it is accepted and the online order is flagged short.
        int promised = slots(bottle);
        assertTrue(promised > 0);
        String staffOrder = staffOrders.create(admin, inst, StaffOrderRequest.builder().clientRequestId(key())
                .customer(StaffOrderRequest.Customer.builder().phone("98765" + String.format("%05d",
                        phones.incrementAndGet())).name("Phone Buyer").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("2 Test Lane").city("Test City").stateCode("09")
                        .pincode("100001").build())
                .restOnCredit(true)
                .lines(List.of(StaffOrderRequest.Line.builder().variantId(bottle).quantity(promised).build()))
                .build()).detail().getOrder().getId();
        assertEquals(0, slots(bottle));
        String s1 = open(cashier, r1, "0.00");
        refused("SOLD_ONLINE", () -> sell(cashier, s1, List.of(line("l1", bottle, 1, null)), List.of(cash("450.00"))));
        int atOnline = onHand(online, bottle);
        PosSaleService.Outcome accepted = sales.billBook(cashier, inst, paper(s1, bottle, "205", today,
                pin(managerId, PIN)));
        assertEquals("205", text("SELECT external_invoice_number FROM invoice WHERE commerce_order_id = ?",
                accepted.answer().sale().orderId()));
        assertEquals(atOnline - 1, onHand(online, bottle));
        assertEquals(1, count("SELECT COALESCE(SUM(stock_short_qty), 0) FROM commerce_order_line WHERE order_id = ?",
                staffOrder), "the online order is flagged stock short");
        noDrift("bill-book at the online counter");
        assertEquals(0, slots(bottle), "a short take adds no slot");
        assertEquals(1, count("SELECT COALESCE(sellable_deficit, 0) FROM commerce_variant WHERE package_session_id = ?",
                bottle), "the unit taken from promised stock is a deficit");
        // Voided again (keyed at the wrong counter): the deficit is paid back, still no free slot.
        corrections.voidSale(cashier, inst, accepted.answer().sale().orderId(), new PosDtos.VoidRequest(key(),
                "Keyed at the wrong counter", pin(managerId, PIN)));
        assertEquals(atOnline, onHand(online, bottle));
        assertEquals(0, count("SELECT COALESCE(sellable_deficit, 0) FROM commerce_variant WHERE package_session_id = ?",
                bottle), "the reversal pays the deficit first");
        assertEquals(0, slots(bottle), "and gives no promised unit to the till");
        noDrift("void of a short bill-book entry");
        closeEven(cashier, s1);
    }

    // ================================================================== 16. a sale racing a close

    @Test
    @Order(16)
    void aSaleRacingACloseNeverLandsInAClosedSession() throws Exception {
        int committed = 0;
        int refusedCount = 0;
        for (int round = 0; round < 12; round++) {
            // The close starts 0 to 165 ms after the sale: early closes win, late ones wait for the sale.
            long delay = round * 15L;
            String s = open(cashier, r2, "0.00");
            String saleKey = key();
            ExecutorService pool = Executors.newFixedThreadPool(2);
            CyclicBarrier start = new CyclicBarrier(2);
            Future<String> sale = pool.submit(() -> {
                header(inst);
                start.await(10, TimeUnit.SECONDS);
                try {
                    return sales.sale(cashier, inst, body(saleKey, s, List.of(line("l1", spoon, 1, null)),
                            List.of(cash("50.00")))).answer().sale().orderId();
                } catch (ConflictException e) {
                    return e.getMessage();
                }
            });
            Future<PosDtos.SessionView> close = pool.submit(() -> {
                header(inst);
                start.await(10, TimeUnit.SECONDS);
                Thread.sleep(delay);
                return sessions.close(admin, inst, s, new PosDtos.SessionCloseRequest(key(), amount("0.00"), null,
                        "Closed during a sale", null)).session();
            });
            String saleAnswer = sale.get(60, TimeUnit.SECONDS);
            PosDtos.SessionView closed = close.get(60, TimeUnit.SECONDS);
            pool.shutdown();
            assertEquals("CLOSED", closed.status());
            long inSession = count("SELECT count(*) FROM commerce_order WHERE pos_session_id = ? AND status = "
                    + "'DELIVERED'", s);
            if (saleAnswer.startsWith("SESSION_NOT_OPEN")) {
                refusedCount++;
                assertEquals(0, inSession, "a refused sale wrote nothing");
                assertEquals(0, count("SELECT count(*) FROM commerce_order WHERE client_request_id = ?", saleKey));
                assertEquals(0, closed.zReport().bills().count());
            } else {
                committed++;
                assertEquals(s, text("SELECT pos_session_id FROM commerce_order WHERE id = ?", saleAnswer));
                assertEquals(1, inSession);
                assertEquals(1, closed.zReport().bills().count(), "the sale is in the Z-report");
                same("50.00", closed.expectedCash(), "and in the expected cash");
                same("-50.00", closed.variance(), "counted 0");
            }
            assertEquals(0, count("SELECT count(*) FROM commerce_order o JOIN pos_session p ON p.id = o.pos_session_id "
                    + "WHERE p.id = ? AND o.created_at > p.closed_at", s), "no bill after the close");
            // The next round's float equals this close's count (0).
        }
        System.out.println("POS_PROOF race rounds: committed=" + committed + " refused=" + refusedCount);
        assertEquals(12, committed + refusedCount);
    }

    // ================================================================== 17. gate 23 scaled down

    @Test
    @Order(17)
    void gate23_walkInLoadScaledDown() throws Exception {
        String walkIn = text("SELECT user_id FROM commerce_pos_walk_in WHERE institute_id = ?", inst);
        assertNotNull(walkIn, "earlier walk-in sales made the walk-in user");
        String walkInEmail = buyerResolver.walkInEmail(inst);
        long plansBefore = count("SELECT count(*) FROM user_plan WHERE user_id = ?", walkIn);
        long r1Before = count("SELECT count(*) FROM invoice WHERE series_id = ?", r1Series);
        long r2Before = count("SELECT count(*) FROM invoice WHERE series_id = ?", r2Series);
        int spoonOnline = onHand(online, spoon);
        int spoonStore = onHand(store, spoon);
        String a = open(admin, r1, "0.00");
        String b = open(cashier, r2, "0.00");

        List<Long> millis = new ArrayList<>();
        for (int i = 0; i < LOAD_SEQUENTIAL; i++) {
            long t0 = System.nanoTime();
            sales.sale(admin, inst, body(key(), i % 2 == 0 ? a : b, List.of(line("l1", spoon, 1, null)),
                    List.of(cash("50.00"))));
            millis.add((System.nanoTime() - t0) / 1_000_000);
        }
        ExecutorService pool = Executors.newFixedThreadPool(LOAD_THREADS);
        List<Callable<Integer>> work = new ArrayList<>();
        ConcurrentLinkedQueue<Throwable> failures = new ConcurrentLinkedQueue<>();
        long t0 = System.nanoTime();
        for (int t = 0; t < LOAD_THREADS; t++) {
            int thread = t;
            work.add(() -> {
                header(inst);
                int done = 0;
                for (int i = 0; i < LOAD_PER_THREAD; i++) {
                    try {
                        sales.sale(admin, inst, body(key(), (thread + i) % 2 == 0 ? a : b,
                                List.of(line("l1", spoon, 1, null)), List.of(cash("50.00"))));
                        done++;
                    } catch (Throwable e) {
                        failures.add(e);
                    }
                }
                return done;
            });
        }
        int parallel = 0;
        for (Future<Integer> f : pool.invokeAll(work, 5, TimeUnit.MINUTES)) {
            parallel += f.get();
        }
        long parallelMs = (System.nanoTime() - t0) / 1_000_000;
        pool.shutdown();
        assertTrue(failures.isEmpty(), "every parallel sale succeeds (no deadlock): " + failures);
        assertEquals(LOAD_THREADS * LOAD_PER_THREAD, parallel);

        int total = LOAD_SEQUENTIAL + LOAD_THREADS * LOAD_PER_THREAD;
        assertEquals(total, ordersOf(a) + ordersOf(b));
        assertEquals(spoonOnline + spoonStore - total, onHand(online, spoon) + onHand(store, spoon));
        assertEquals(r1Before + ordersOf(a), count("SELECT count(*) FROM invoice WHERE series_id = ?", r1Series));
        assertEquals(r2Before + ordersOf(b), count("SELECT count(*) FROM invoice WHERE series_id = ?", r2Series));
        consecutive(r1Series);
        consecutive(r2Series);

        long first = median(millis.subList(0, 100));
        long last = median(millis.subList(LOAD_SEQUENTIAL - 100, LOAD_SEQUENTIAL));
        System.out.println("POS_PROOF gate23: sequential=" + LOAD_SEQUENTIAL + " median first 100 = " + first
                + " ms, median last 100 = " + last + " ms, total " + millis.stream().mapToLong(Long::longValue).sum()
                + " ms; parallel " + parallel + " sales on " + LOAD_THREADS + " threads in " + parallelMs + " ms");
        assertTrue(last <= Math.max(2 * first, first + 20), "no slow-down: first " + first + " ms, last " + last + " ms");

        // One walk-in user, made once; its plans are one per line and invisible to the three legacy readers.
        assertEquals(1, count("SELECT count(*) FROM commerce_pos_walk_in WHERE institute_id = ?", inst));
        verify(authService, never()).createUserFromAuthServiceForLearnerEnrollment(
                argThat(u -> u != null && walkInEmail.equalsIgnoreCase(u.getEmail())), anyString(), anyBoolean());
        assertEquals(plansBefore + total, count("SELECT count(*) FROM user_plan WHERE user_id = ?", walkIn),
                "one plan per bill line, no more");
        assertEquals(0, count("SELECT count(*) FROM (SELECT payment_log_id FROM commerce_order_line WHERE order_id IN "
                + "(SELECT id FROM commerce_order WHERE pos_session_id IN (?, ?)) GROUP BY payment_log_id "
                + "HAVING count(*) > 1) x", a, b), "one payment log per line");
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        tx.setReadOnly(true);
        List<UserPlan> legacyA = tx.execute(st -> userPlanRepository.findPaidActivePlansWithoutEnrollment());
        assertTrue(legacyA.stream().noneMatch(p -> walkIn.equals(p.getUserId())), "reader 1");
        List<UserPlan> legacyB = tx.execute(st -> userPlanRepository.findAllByUserIdInAndInstituteIdAndStatusIn(
                List.of(walkIn), inst, List.of("ACTIVE", "CANCELED", "PENDING_FOR_PAYMENT")));
        assertTrue(legacyB.isEmpty(), "reader 2");
        List<UserPlan> legacyC = tx.execute(st -> userPlanRepository.findAllByStatusInAndInstituteIdIn(
                List.of("ACTIVE"), List.of(inst)));
        assertTrue(legacyC.stream().noneMatch(p -> walkIn.equals(p.getUserId())), "reader 3");

        sessions.close(admin, inst, a, new PosDtos.SessionCloseRequest(key(), expected(a), null, null, null));
        closeEven(cashier, b);
    }

    private static long median(List<Long> values) {
        List<Long> sorted = new ArrayList<>(values);
        Collections.sort(sorted);
        return sorted.get(sorted.size() / 2);
    }

    // ================================================================== 18. security

    @Test
    @Order(18)
    void securityEveryPosRouteRefusesOutsiders() throws Exception {
        String s = open(cashier, r1, "0.00");
        // The bottle's online units are all promised since gate 19: the spoon sells.
        PosSaleService.Outcome sold = sell(cashier, s, List.of(line("l1", spoon, 1, null)), List.of(cash("50.00")));
        String orderId = sold.answer().sale().orderId();
        String lineId = sold.answer().sale().lines().get(0).orderLineId();
        String tenderId = sold.answer().sale().tenders().get(0).id();
        noCost(sold.answer(), "sale answer");
        noCost(lookups.detail(cashier, inst, orderId, s), "sale detail");
        noCost(receipts.receipt(cashier, inst, orderId), "receipt");
        noCost(lookups.lookup(cashier, inst, s, sold.answer().receipt().document().number()), "lookup");
        noCost(sessions.detail(cashier, inst, s), "session view");
        noCost(sessions.sales(cashier, inst, s, 0, 50), "session bills");
        noCost(posReturns.preview(cashier, inst, new PosDtos.ReturnPreviewRequest(s, orderId,
                List.of(new PosDtos.ReturnLine(lineId, 1, null, null)), null, null)), "return preview");

        CustomUserDetails learner = user("learner-" + run, "STUDENT");
        CustomUserDetails shopper = user("shopper-" + run);
        CustomUserDetails otherAdmin = user("otheradmin-" + run, "ADMIN");
        Map<String, Executable> routes = new LinkedHashMap<>();
        long orders = allOrders();
        long sessionsBefore = count("SELECT count(*) FROM pos_session WHERE institute_id = ?", inst);
        for (CustomUserDetails outsider : List.of(learner, shopper, otherAdmin)) {
            routes.clear();
            routes.put("registers.list", () -> registers.list(outsider, inst, null));
            routes.put("registers.create", () -> registers.create(outsider, inst, new PosDtos.RegisterCreateRequest(
                    key(), store, "x" + run.substring(0, 4), "Nope", null, null)));
            routes.put("registers.update", () -> registers.update(outsider, inst, r1,
                    new PosDtos.RegisterUpdateRequest(key(), "Nope", null)));
            routes.put("settings.get", () -> settings.get(outsider, inst));
            routes.put("settings.update", () -> settings.update(outsider, inst, new PosDtos.SettingsRequest(
                    amount("100"), amount("1"), amount("1"))));
            routes.put("catalogue", () -> catalogue.catalogue(outsider, inst, r1, null));
            routes.put("scan", () -> catalogue.scan(outsider, inst, r1, "P0001"));
            routes.put("approvers", () -> catalogue.approvers(outsider, inst, r1));
            routes.put("customers.lookup", () -> catalogue.lookupCustomer(outsider, inst, s, "9876500001"));
            routes.put("sessions.open", () -> sessions.open(outsider, inst, new PosDtos.SessionOpenRequest(key(), r2,
                    amount("0.00"), null)));
            routes.put("sessions.current", () -> sessions.current(outsider, inst, r1));
            routes.put("sessions.detail", () -> sessions.detail(outsider, inst, s));
            routes.put("sessions.list", () -> sessions.list(outsider, inst, null, null, null, null, null, 0, 50));
            routes.put("sessions.sales", () -> sessions.sales(outsider, inst, s, 0, 50));
            routes.put("sessions.cashMovement", () -> sessions.cashMovement(outsider, inst, s,
                    new PosDtos.CashMovementRequest(key(), "CASH_OUT", amount("1.00"), "Nope")));
            routes.put("sessions.close", () -> sessions.close(outsider, inst, s, new PosDtos.SessionCloseRequest(key(),
                    amount("0.00"), null, "Nope", null)));
            routes.put("quote", () -> sales.quote(outsider, inst, body(null, s, List.of(line("l1", bottle, 1, null)),
                    null)));
            routes.put("sale", () -> sell(outsider, s, List.of(line("l1", bottle, 1, null)), List.of(cash("450.00"))));
            routes.put("billBook", () -> sales.billBook(outsider, inst, paper(s, bottle, "210", LocalDate.now(INDIA),
                    null)));
            routes.put("receipt", () -> receipts.receipt(outsider, inst, orderId));
            routes.put("void", () -> corrections.voidSale(outsider, inst, orderId, new PosDtos.VoidRequest(key(), "No",
                    null)));
            routes.put("tenderChange", () -> corrections.changeTender(outsider, inst, orderId, tenderId,
                    new PosDtos.TenderChangeRequest(key(), "UPI", "U9", null)));
            routes.put("sales.lookup", () -> lookups.lookup(outsider, inst, s, "9876500001"));
            routes.put("sales.detail", () -> lookups.detail(outsider, inst, orderId, s));
            routes.put("returns.preview", () -> posReturns.preview(outsider, inst, new PosDtos.ReturnPreviewRequest(s,
                    orderId, List.of(new PosDtos.ReturnLine(lineId, 1, null, null)), null, null)));
            routes.put("returns.create", () -> posReturns.create(outsider, inst, new PosDtos.ReturnRequest(key(), s,
                    orderId, List.of(new PosDtos.ReturnLine(lineId, 1, "RESALEABLE", null)), "DEFECTIVE", null, null,
                    new PosDtos.Settle("REFUND", "CASH", null), null)));
            if (outsider == otherAdmin) {
                header(otherInst);
            }
            try {
                for (Map.Entry<String, Executable> route : routes.entrySet()) {
                    CommerceAccessDeniedException e = assertThrows(CommerceAccessDeniedException.class,
                            route.getValue(), outsider.getUserId() + " on " + route.getKey());
                    String expectedCode = outsider == learner ? "ROLE_NOT_ALLOWED" : "ACCESS_DENIED";
                    assertEquals(expectedCode, e.getCode(), outsider.getUserId() + " on " + route.getKey());
                }
                if (outsider == otherAdmin) {
                    // Another institute's admin naming our ids under their own institute: not found or off.
                    for (Executable call : List.<Executable>of(
                            () -> registers.list(otherAdmin, otherInst, null),
                            () -> catalogue.catalogue(otherAdmin, otherInst, r1, null),
                            () -> sessions.detail(otherAdmin, otherInst, s),
                            () -> receipts.receipt(otherAdmin, otherInst, orderId),
                            () -> lookups.detail(otherAdmin, otherInst, orderId, s))) {
                        RuntimeException e = assertThrows(RuntimeException.class, call);
                        assertTrue(e instanceof CommerceAccessDeniedException || (e instanceof VacademyException
                                && e.getMessage().matches("^(REGISTER|SESSION|ORDER)_NOT_FOUND.*")), e.toString());
                    }
                    assertEquals("FEATURE_DISABLED", denied(() -> registers.list(otherAdmin, otherInst, null)));
                }
            } finally {
                header(inst);
            }
        }
        assertEquals(orders, allOrders(), "no outsider wrote a bill");
        assertEquals(sessionsBefore, count("SELECT count(*) FROM pos_session WHERE institute_id = ?", inst));
        assertEquals("OPEN", text("SELECT status FROM pos_session WHERE id = ?", s));
        closeEven(cashier, s);
    }
}
