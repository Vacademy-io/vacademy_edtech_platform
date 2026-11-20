package vacademy.io.admin_core_service.features.commerce;

import com.fasterxml.jackson.databind.JsonNode;
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
import org.junit.jupiter.api.function.Executable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
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
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStaffOrderService;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.StaffOrderRequest;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunController;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.DayView;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.DaysAnswer;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.PlatformView;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.SaveDayRequest;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosRegisterService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosReturnService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSaleService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSessionService;
import vacademy.io.admin_core_service.features.commerce.report.controller.CommerceReportController;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommercePinService;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockCountController;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockLevelController;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockReceiptController;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostDtos.CommitResponse;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostDtos.ValidateResponse;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostImportController;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptActionRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StandardCostRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountLineInput;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountView;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningStockController;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
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
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * WP-53 switch-over against a real Postgres 16 with the whole Flyway chain and the real Spring
 * context: the item-costs import (validate writes nothing, commit sets the costs once), the cost
 * rule of opening receipts while the switch-over feature is on, the opening readiness of a
 * location with its blind recount sample rule, and the parallel-run days that compare the old
 * system's totals with the platform's. Calls go through the controllers, so each refusal is the
 * one a request would meet. With the feature off every new route is closed and an opening receipt
 * without a cost posts as before. After every test the nightly reconciliation finds no drift.
 *
 * <p>Runs only when {@code COMMERCE_IT_PG_URL} names a database on this machine; skipped in the
 * default build like the other commerce database proofs. Every tax rate is a TEST placeholder.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@SuppressWarnings("unchecked")
class CommerceSwitchoverDatabaseProofIT {

    private static final String SELLER_GSTIN = "09AAACH7409R1ZZ";
    private static final String PIN = "482917";
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final String MIGRATION = "commerce.migration";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "24");
        registry.add("commerce.order-token.secret", () -> "local-proof-only-not-a-secret");
        registry.add("commerce.turnstile.required", () -> "false");
        registry.add("commerce.payment-fetch.cron", () -> "-");
    }

    /** The JVM zone before this proof; put back after it. */
    private static final java.util.TimeZone PREVIOUS_ZONE = java.util.TimeZone.getDefault();

    static {
        // Production runs admin_core in UTC: stored timestamps are UTC wall times and the report SQL behind
        // the parallel-run figures buckets them with AT TIME ZONE 'UTC'. This proof runs the same way,
        // whatever the zone of the machine; the zone is put back after the class.
        java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
    }

    @Autowired private JdbcTemplate db;
    @Autowired private CapabilityResolver capabilityResolver;
    @Autowired private CommerceProductService productService;
    @Autowired private StockLocationService locationService;
    @Autowired private StockReceiptService receiptService;
    @Autowired private CommerceTaxSettingService taxSettingService;
    @Autowired private CommerceTaxClassService taxClassService;
    @Autowired private CommerceDocumentSeriesService seriesService;
    @Autowired private StorefrontSnapshotLoader snapshotLoader;
    @Autowired private StockReconciliationJob reconciliationJob;
    @Autowired private StockLevelRepository levelRepository;
    @Autowired private CommercePinService pinService;
    @Autowired private PosRegisterService registers;
    @Autowired private PosSessionService sessions;
    @Autowired private PosSaleService sales;
    @Autowired private PosReturnService posReturns;
    @Autowired private CommerceStaffOrderService staffOrders;
    // The routes, called as a request would call them (guard first, then the service).
    @Autowired private ItemCostImportController costImport;
    @Autowired private OpeningStockController opening;
    @Autowired private ParallelRunController parallelRun;
    @Autowired private StockReceiptController receipts;
    @Autowired private StockLevelController levelRoutes;
    @Autowired private StockCountController counts;
    @Autowired private CommerceReportController reports;

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
    private final String offInst = UUID.randomUUID().toString();   // commerce on, switch-over feature off
    private final String otherInst = UUID.randomUUID().toString(); // an outsider's institute
    private final String run = inst.substring(0, 8);
    private final AtomicInteger keys = new AtomicInteger();
    private final Map<String, String> rolesById = new HashMap<>();

    private final String adminId = "admin-" + run;
    private final String managerId = "manager-" + run;
    private final String manager2Id = "manager2-" + run;
    private final String w1Id = "wh1-" + run;
    private final String w2Id = "wh2-" + run;
    private final String wElseId = "wh3-" + run;
    private final String cashierId = "cashier-" + run;
    private final String accountantId = "accountant-" + run;
    private CustomUserDetails admin;
    private CustomUserDetails manager;     // M at L1 and L2, with a PIN
    private CustomUserDetails manager2;    // M at L2 only
    private CustomUserDetails w1;          // W at L1: counter X
    private CustomUserDetails w2;          // W at L1: recounter Y
    private CustomUserDetails wElse;       // W at L2 only
    private CustomUserDetails cashier;     // C at L1
    private CustomUserDetails accountant;  // Ac at L1
    private CustomUserDetails learner;
    private CustomUserDetails shopper;
    private CustomUserDetails otherAdmin;

    private String l1;      // store: POS, sells online
    private String l2;      // second store
    private String lOff;    // the store of the institute with the feature off
    private String r1;
    private String taxClass;

    private String shirt;   // QUANTITY 1500.00, cost 1180 incl. 18 % -> 1000.0000
    private String mug;     // QUANTITY 150.00, cost 99.99 incl. 12 % -> 89.2768
    private String bowl;    // QUANTITY 400.00, cost 250 excl. tax
    private String scarf;   // PIECE 1200.00, cost 600 excl. tax
    private String plain;   // QUANTITY 200.00, not in the cost file
    private String lamp;    // QUANTITY 400.00, sold at the counter
    private String coaster; // QUANTITY 100.00, sold and returned at the counter
    private String vase;    // QUANTITY 300.00, sold for UPI
    private String offItem; // QUANTITY at the feature-off institute, no cost
    private String offItem2; // QUANTITY at the feature-off institute, received with a typed cost
    private String cloth;   // QUANTITY sold by the metre, qty_scale 10 (base unit = a tenth of a metre)

    private LocalDate today;
    private LocalDate salesDay;

    @BeforeEach
    void local() {
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), anyString(), anyBoolean()))
                .thenAnswer(call -> {
                    UserDTO user = new UserDTO();
                    user.setId("buyer-" + run);
                    return user;
                });
        when(authService.getUsersFromAuthServiceByUserIds(any())).thenReturn(List.of());
        when(authService.getInstituteRoles(anyString(), anyList())).thenAnswer(call -> {
            List<String> ids = call.getArgument(1);
            Map<String, List<String>> roles = new HashMap<>();
            for (String id : ids) {
                String role = rolesById.get(id);
                if (role != null) {
                    roles.put(id, List.of(role));
                }
            }
            return roles;
        });
        header(inst);
        admin = staff(adminId, "ADMIN");
        manager = staff(managerId, "COMMERCE_STORE_MANAGER");
        manager2 = staff(manager2Id, "COMMERCE_STORE_MANAGER");
        w1 = staff(w1Id, "COMMERCE_WAREHOUSE_STAFF");
        w2 = staff(w2Id, "COMMERCE_WAREHOUSE_STAFF");
        wElse = staff(wElseId, "COMMERCE_WAREHOUSE_STAFF");
        cashier = staff(cashierId, "COMMERCE_POS_CASHIER");
        accountant = staff(accountantId, "COMMERCE_ACCOUNTANT");
        learner = user("learner-" + run, "STUDENT");
        shopper = user("shopper-" + run);
        otherAdmin = user("oadmin-" + run, "ADMIN");
        today = LocalDate.now(INDIA);
    }

    @AfterEach
    void reconciled() {
        header(inst);
        if (r1 != null) {
            for (String open : db.queryForList("SELECT id FROM pos_session WHERE institute_id = ? AND status = 'OPEN'",
                    String.class, inst)) {
                closeSession(open);
            }
        }
        if (l1 != null) {
            reconciliationJob.run();
            noDrift("after the test");
        }
    }

    @AfterAll
    void clear() {
        RequestContextHolder.resetRequestAttributes();
        java.util.TimeZone.setDefault(PREVIOUS_ZONE);
    }

    // ================================================================== helpers

    private static void header(String clientId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", clientId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private CustomUserDetails staff(String id, String role) {
        rolesById.put(id, role);
        return user(id, role);
    }

    private static CustomUserDetails user(String id, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(id);
        dto.setUsername(id);
        dto.setFullName("Proof " + id);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static void note(String line) {
        System.out.println("SWITCH_PROOF " + line);
    }

    private String key() {
        return "sw-" + run + "-" + keys.incrementAndGet();
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
        List<BigDecimal> found = db.queryForList(query, BigDecimal.class, args);
        return found.isEmpty() ? null : found.get(0);
    }

    private static void same(String expected, Object actual, String what) {
        assertNotNull(actual, what);
        assertEquals(0, new BigDecimal(expected).compareTo(new BigDecimal(String.valueOf(actual))), what + ": " + actual);
    }

    /** The refusal's code: the guard's code, or the text before the first colon of the message. */
    private static String code(Executable call) {
        RuntimeException e = assertThrows(RuntimeException.class, call);
        if (e instanceof CommerceAccessDeniedException denied) {
            return denied.getCode();
        }
        String message = String.valueOf(e.getMessage());
        int colon = message.indexOf(':');
        return colon > 0 ? message.substring(0, colon) : message;
    }

    private static <T> T body(ResponseEntity<T> answer) {
        return answer.getBody();
    }

    private void noDrift(String step) {
        List<StockReconciliationJob.Drift> drift = reconciliationJob.findSellableDrift().stream()
                .filter(d -> inst.equals(d.instituteId()) || offInst.equals(d.instituteId())).toList();
        assertTrue(drift.isEmpty(), "sellable drift " + step + ": " + drift);
        List<String> pieceDrift = levelRepository.findPieceDrift(10_000).stream()
                .filter(d -> inst.equals(d.getInstituteId()) || offInst.equals(d.getInstituteId()))
                .map(d -> d.getLocationId() + "/" + d.getPackageSessionId() + " on_hand " + d.getOnHand() + " pieces "
                        + d.getPieces()).toList();
        assertTrue(pieceDrift.isEmpty(), "piece drift " + step + ": " + pieceDrift);
    }

    private void institute(String id, String name, boolean migration) {
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", id, name,
                "https://learn-" + id.substring(0, 8) + ".example.com");
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)",
                id);
        if (migration) {
            grantMigration(id);
        }
        capabilityResolver.evict(id);
    }

    private void grantMigration(String id) {
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, ?, true)", id,
                MIGRATION);
        capabilityResolver.evict(id);
        assertTrue(capabilityResolver.isFeatureGranted(id, MIGRATION));
    }

    private String location(String instituteId, String code, boolean sellsOnline) {
        LocationRequest location = new LocationRequest();
        location.setCode(code + "-" + instituteId.substring(0, 6));
        location.setName(code + " " + instituteId.substring(0, 6));
        location.setAddressLine1("1 Test Road");
        location.setCity("Test City");
        location.setPincode("100001");
        location.setStateCode("09");
        location.setIsStore(true);
        location.setIsWarehouse(sellsOnline);
        location.setIsPosEnabled(sellsOnline);
        location.setSellsOnline(sellsOnline);
        return locationService.create(instituteId, adminId, true, location).getId();
    }

    private String product(String instituteId, String slug, String name, String sku, String price, boolean pieces,
                           String taxClassId) {
        return product(instituteId, slug, name, sku, price, pieces, taxClassId, "PCS", 1);
    }

    private String product(String instituteId, String slug, String name, String sku, String price, boolean pieces,
                           String taxClassId, String unit, int qtyScale) {
        ProductRequest request = ProductRequest.builder().slug(slug + "-" + run)
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name(name).build()))
                .taxClassId(taxClassId).status("ACTIVE").stockMode(pieces ? "PIECE" : "QUANTITY").unit(unit)
                .qtyScale(qtyScale)
                .variants(List.of(VariantRequest.builder().sku(sku).name("One size")
                        .price(new BigDecimal(price)).weightGrams(200).build()))
                .build();
        return productService.save(instituteId, adminId, request).getVariants().get(0).getPackageSessionId();
    }

    private String sku(String name) {
        return "TST-" + name + "-" + run;
    }

    private void assign(String userId, String... locationIds) {
        for (String locationId : locationIds) {
            db.update("INSERT INTO commerce_staff_location (id, institute_id, user_id, location_id, created_by) "
                    + "VALUES (?, ?, ?, ?, ?)", UUID.randomUUID().toString(), inst, userId, locationId, adminId);
        }
    }

    private static ReceiptRequest receipt(String locationId, String source, Object... variantQtyCost) {
        ReceiptRequest request = new ReceiptRequest();
        request.setLocationId(locationId);
        request.setSourceKind(source);
        request.setNote("proof stock");
        request.setClientRequestId("rc-" + UUID.randomUUID());
        List<ReceiptRequest.Line> lines = new ArrayList<>();
        for (int i = 0; i < variantQtyCost.length; i += 3) {
            ReceiptRequest.Line line = new ReceiptRequest.Line();
            line.setPackageSessionId((String) variantQtyCost[i]);
            line.setQuantity((Integer) variantQtyCost[i + 1]);
            line.setUnitCost(variantQtyCost[i + 2] == null ? null : new BigDecimal((String) variantQtyCost[i + 2]));
            lines.add(line);
        }
        request.setLines(lines);
        return request;
    }

    private Map<String, Object> postReceipt(CustomUserDetails who, String instituteId, ReceiptRequest request) {
        return body(receipts.create(who, instituteId, request));
    }

    private long nextGrn(String instituteId) {
        return count("SELECT COALESCE(MAX(next_value), 0) FROM commerce_counter WHERE institute_id = ? AND scope_key = "
                + "'GRN'", instituteId);
    }

    private long receiptRows(String instituteId) {
        return count("SELECT count(*) FROM stock_receipt WHERE institute_id = ?", instituteId);
    }

    private String lineCostSource(String receiptId, String variant) {
        return text("SELECT cost_source FROM stock_receipt_line WHERE receipt_id = ? AND package_session_id = ?",
                receiptId, variant);
    }

    private static MockMultipartFile csv(String... rows) {
        String content = "sku,purchase_price,includes_tax,gst_rate_percent,note\n" + String.join("\n", rows) + "\n";
        return new MockMultipartFile("file", "item-costs.csv", "text/csv", content.getBytes(StandardCharsets.UTF_8));
    }

    private ValidateResponse validate(CustomUserDetails who, MockMultipartFile file) {
        return (ValidateResponse) body(costImport.importCosts(who, inst, "validate", null, file));
    }

    private CommitResponse commit(CustomUserDetails who, MockMultipartFile file, String token) {
        return (CommitResponse) body(costImport.importCosts(who, inst, "commit", token, file));
    }

    private long adjustments() {
        return count("SELECT count(*) FROM stock_cost_adjustment WHERE institute_id = ?", inst);
    }

    private long audits(String kind) {
        return count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = ?", inst, kind);
    }

    private BigDecimal standardCost(String variant) {
        return money("SELECT standard_cost FROM commerce_variant WHERE package_session_id = ?", variant);
    }

    private BigDecimal costPrice(String variant) {
        return money("SELECT cost_price FROM commerce_variant WHERE package_session_id = ?", variant);
    }

    private Map<String, Object> readiness(CustomUserDetails who, String instituteId, String locationId) {
        return body(opening.readiness(who, instituteId, locationId));
    }

    private static Map<String, Object> part(Map<String, Object> answer, String name) {
        return (Map<String, Object>) answer.get(name);
    }

    private CountView openCount(CustomUserDetails who, String kind, String recountOf) {
        return body(counts.open(who, inst, new StockOpsDtos.CountCreateRequest(key(), l1, kind, null, recountOf, null)));
    }

    private void countLines(CustomUserDetails who, String countId, List<CountLineInput> lines) {
        counts.lines(who, inst, countId, new StockOpsDtos.CountLinesRequest(key(), lines));
    }

    private CountView finish(CustomUserDetails who, String countId) {
        return body(counts.post(who, inst, countId, new StockOpsDtos.CountPostRequest(key(), null, null, null, null)));
    }

    private void cancelOpenCounts() {
        for (String open : db.queryForList("SELECT id FROM stock_count WHERE institute_id = ? AND status = 'OPEN' "
                + "ORDER BY kind DESC", String.class, inst)) {
            counts.cancel(admin, inst, open, new StockOpsDtos.CancelRequest(key(), "Proof clean-up"));
        }
    }

    private static CountLineInput scanned(String pieceCode) {
        return new CountLineInput(null, null, null, pieceCode, null, null);
    }

    private static CountLineInput set(String variant, int quantity) {
        return new CountLineInput(variant, "SET", quantity, null, null, null);
    }

    private List<String> pieceCodes(String variant) {
        return db.queryForList("SELECT code FROM commerce_piece WHERE package_session_id = ? AND location_id = ? AND "
                + "status = 'IN_STOCK' ORDER BY code", String.class, variant, l1);
    }

    private int onHand(String locationId, String variant) {
        return (int) count("SELECT COALESCE(SUM(on_hand), 0) FROM stock_level WHERE location_id = ? AND "
                + "package_session_id = ?", locationId, variant);
    }

    private static PosDtos.Approval pin(String approver, String raw) {
        return new PosDtos.Approval(approver, raw, "Checked at the counter");
    }

    private String openSession() {
        String previous = text("SELECT (counted_cash - COALESCE(handover_amount, 0))::text FROM pos_session WHERE "
                + "institute_id = ? AND register_id = ? AND status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1", inst, r1);
        return sessions.open(cashier, inst, new PosDtos.SessionOpenRequest(key(), r1,
                new BigDecimal(previous == null ? "0.00" : previous), null)).session().id();
    }

    private void closeSession(String session) {
        sessions.close(cashier, inst, session, new PosDtos.SessionCloseRequest(key(),
                sessions.detail(admin, inst, session).summary().expectedCash(), null, null, null));
    }

    private static PosDtos.SaleLine line(String ref, String variant) {
        return new PosDtos.SaleLine(ref, variant, 1, null, null, null);
    }

    private String sell(String session, List<PosDtos.SaleLine> lines, PosDtos.Tender tender) {
        return sales.sale(cashier, inst, new PosDtos.SaleRequest(key(), session, lines, null, null, List.of(tender),
                null, null, null, null, null)).answer().sale().orderId();
    }

    private void paperBill(String session, String variant, String price, String bookNumber, LocalDate date) {
        sales.billBook(cashier, inst, new PosDtos.SaleRequest(key(), session, List.of(line("l1", variant)), null, null,
                List.of(new PosDtos.Tender("CASH", new BigDecimal(price), null, null)), null, pin(managerId, PIN), null,
                bookNumber, date.toString()));
    }

    private DaysAnswer days(CustomUserDetails who, LocalDate from, LocalDate to) {
        return body(parallelRun.days(who, inst, l1, from, to));
    }

    private DayView day(LocalDate date) {
        return days(admin, date, date).days().get(0);
    }

    private static SaveDayRequest old(long bills, BigDecimal sales, BigDecimal tax, BigDecimal cash, BigDecimal returns,
                                      String noteText, Integer version) {
        SaveDayRequest request = new SaveDayRequest();
        request.setOldBillCount((int) bills);
        request.setOldSalesValue(sales);
        request.setOldTax(tax);
        request.setOldCash(cash);
        request.setOldReturns(returns);
        request.setNote(noteText);
        request.setVersion(version);
        return request;
    }

    /** Saves the day with the old system agreeing with the platform's live figures (what PUT recomputes). */
    private DayView saveAgreeing(LocalDate date) {
        DayView now = day(date);
        PlatformView p = now.platform();
        return body(parallelRun.save(manager, inst, l1, date, old(p.bills(), p.salesValue(), p.tax(), p.cash(),
                p.returns(), null, now.version())));
    }

    // ================================================================== 1. the shop, V747

    @Test
    @Order(1)
    void migrationAppliedAndShopSeeded() {
        assertEquals(1, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version = '747' AND "
                + "script = 'V747__Commerce_parallel_run.sql'"), "V747 parallel run is applied");
        assertEquals(0, count("SELECT count(*) FROM flyway_schema_history WHERE NOT success"), "no failed migration");
        assertEquals(1, count("SELECT count(*) FROM pg_constraint WHERE conname = 'uq_parallel_run_day'"));
        assertEquals(1, count("SELECT count(*) FROM pg_constraint WHERE conname = 'ck_parallel_run_day_result'"));
        assertEquals(1, count("SELECT count(*) FROM pg_constraint WHERE conname = 'ck_parallel_run_day_counts'"));
        assertEquals(0, count("SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_parallel_run_day_location'"),
                "X13: no second index beside the unique constraint's");
        assertEquals(1, count("SELECT count(*) FROM pg_indexes WHERE tablename = 'commerce_parallel_run_day' AND "
                + "indexname = 'uq_parallel_run_day'"), "the unique constraint's index serves the reads");

        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', "
                + "'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), "
                + "('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        institute(inst, "Test Store " + run, true);
        institute(offInst, "Sample Shop " + run, false);
        institute(otherInst, "Other Shop " + run, false);
        assertFalse(capabilityResolver.isFeatureGranted(offInst, MIGRATION), "the feature is off by default");

        taxSettingService.update(inst, adminId, TaxSettingDTO.builder().taxMode("REGULAR").sellerGstin(SELLER_GSTIN)
                .sellerLegalName("Proof Seller " + run).sellerAddress("1 Test Road, Test City 100001")
                .roundTotalTo("RUPEE").build());
        taxClass = taxClassService.create(inst, adminId, TaxClassDTO.builder().code("goods_test")
                .name("goods TEST").hsnCode("0000").unit("PCS")
                .rules(List.of(TaxRateRuleDTO.builder().minUnitPrice(new BigDecimal("0"))
                        .ratePercent(new BigDecimal("5")).effectiveFrom(LocalDate.of(2020, 4, 1)).build()))
                .build()).getId();
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("TAX_INVOICE")
                .prefix("SG" + run.substring(0, 2).toUpperCase()).build());
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("CREDIT_NOTE")
                .prefix("SC" + run.substring(0, 2).toUpperCase()).build());

        l1 = location(inst, "ST1", true);
        l2 = location(inst, "ST2", false);
        lOff = location(offInst, "SO1", false);
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("TAX_INVOICE").kind("MANUAL_BOOK")
                .prefix("BB" + run.substring(0, 2).toUpperCase()).locationId(l1).bookFrom(100L).bookTo(199L).build());
        assign(managerId, l1, l2);
        assign(manager2Id, l2);
        assign(w1Id, l1);
        assign(w2Id, l1);
        assign(wElseId, l2);
        assign(cashierId, l1);
        assign(accountantId, l1);
        pinService.setPin(inst, managerId, PIN);

        shirt = product(inst, "test-shirt", "Test shirt", sku("0001"), "1500.00", false, taxClass);
        mug = product(inst, "test-mug", "Test mug", sku("0002"), "150.00", false, taxClass);
        bowl = product(inst, "test-bowl", "Test bowl", sku("0003"), "400.00", false, taxClass);
        scarf = product(inst, "test-scarf", "Test scarf", sku("0004"), "1200.00", true, taxClass);
        plain = product(inst, "test-plain", "Test plain item", sku("0005"), "200.00", false, taxClass);
        lamp = product(inst, "test-lamp", "Test lamp", sku("0006"), "400.00", false, taxClass);
        coaster = product(inst, "test-coaster", "Test coaster", sku("0007"), "100.00", false, taxClass);
        vase = product(inst, "test-vase", "Test vase", sku("0008"), "300.00", false, taxClass);
        offItem = product(offInst, "sample-item", "Sample item", "TST-0001-" + offInst.substring(0, 8), "100.00", false,
                null);
        offItem2 = product(offInst, "sample-item-2", "Sample item 2", "TST-0002-" + offInst.substring(0, 8), "100.00",
                false, null);
        cloth = product(inst, "test-cloth", "Test cloth", sku("0009"), "150.00", false, taxClass, "MTR", 10);
        // Counter stock arrives as OTHER with a typed cost (not an opening receipt).
        receiptService.create(inst, adminId, true, receipt(l1, "OTHER", lamp, 10, "200.00", coaster, 10, "40.00",
                vase, 10, "150.00"));
        snapshotLoader.evict(inst);
        r1 = registers.create(admin, inst, new PosDtos.RegisterCreateRequest(key(), l1, "r1-" + run.substring(0, 4),
                "Front counter", "R1" + run.substring(0, 2).toUpperCase(), null)).register().id();
        noDrift("seed");
    }

    // ================================================================== 2. item-costs import (A1-A3, A5, A6, A8)

    @Test
    @Order(2)
    void itemCostsValidateThenCommitOnce() {
        MockMultipartFile file = csv(sku("0001") + ",1180,yes,18,", sku("0002") + ",99.99,yes,12,",
                sku("0003") + ",250,no,,", sku("0004") + ",600,no,,");
        long adjBefore = adjustments();
        long auditBefore = audits("ITEM_COSTS_IMPORT");

        // A1: validate writes nothing.
        ValidateResponse checked = validate(accountant, file);
        assertEquals(4, checked.rows());
        assertEquals(4, checked.ok());
        assertEquals(0, checked.errorCount());
        assertEquals(4, checked.toChange());
        assertEquals(0, checked.unchanged());
        same("0", checked.sumOld(), "sum_old");
        same("1939.2768", checked.sumNew(), "sum_new = 1000 + 89.2768 + 250 + 600");
        assertEquals(4, checked.spotCheck().size(), "every row is in the spot check when there are fewer than 50");
        assertTrue(checked.missingAfter().skus().contains(sku("0005")), "the plain item still has no cost");
        assertNotNull(checked.token());
        assertEquals(adjBefore, adjustments(), "A1: validate wrote no cost adjustment");
        assertEquals(auditBefore, audits("ITEM_COSTS_IMPORT"), "A1: validate wrote no audit row");
        assertNull(standardCost(shirt));
        note("A1 validate: rows 4, to_change 4, sum_new " + checked.sumNew() + ", nothing written");

        // A6: a token of another file, and a file with a bad row: nothing written.
        MockMultipartFile other = csv(sku("0003") + ",260,no,,");
        String otherToken = validate(manager, other).token();
        assertEquals("IMPORT_CHANGED", code(() -> commit(manager, file, otherToken)));
        MockMultipartFile bad = csv(sku("0001") + ",1180,,18,", "TST-UNKNOWN-" + run + ",10,no,,");
        ValidateResponse badCheck = validate(manager, bad);
        assertEquals(2, badCheck.errorCount(), String.valueOf(badCheck.errors()));
        assertTrue(badCheck.errors().stream().anyMatch(e -> "ITEM_NOT_FOUND".equals(e.code())));
        assertEquals("IMPORT_HAS_ERRORS", code(() -> commit(manager, bad, badCheck.token())));
        assertEquals(adjBefore, adjustments(), "A6: refused commits wrote nothing");
        assertNull(standardCost(shirt));
        note("A6 other token -> IMPORT_CHANGED; bad rows -> IMPORT_HAS_ERRORS; nothing written");

        // A2 + A5: commit sets the costs (tax taken out where the price includes it).
        CommitResponse done = commit(accountant, file, checked.token());
        assertEquals(4, done.changed());
        same("1000.0000", standardCost(shirt), "A5: 1180 incl. 18 %");
        same("89.2768", standardCost(mug), "A5: 99.99 incl. 12 %");
        same("250.0000", standardCost(bowl), "excl. tax");
        same("600.0000", standardCost(scarf), "piece item");
        same("1000.0000", costPrice(shirt), "A2: QUANTITY item with no average takes the cost as its average");
        same("250.0000", costPrice(bowl), "A2");
        assertNull(costPrice(scarf), "A8: a PIECE item keeps cost_price untouched");
        assertEquals(adjBefore + 4, adjustments());
        assertEquals(4, count("SELECT count(*) FROM stock_cost_adjustment WHERE institute_id = ? AND reason = "
                + "'STANDARD_SET' AND idempotency_key LIKE ?", inst, "ITEMCOST:" + checked.token().substring(0, 16)
                + ":%"), "A2: four STANDARD_SET rows keyed by the file");
        assertEquals(auditBefore + 1, audits("ITEM_COSTS_IMPORT"), "A2: one audit row");
        note("A2 commit: changed 4, STANDARD_SET x4, audit 1; shirt 1000.0000, mug 89.2768, scarf cost_price null");

        // A3: the same file again changes nothing. The token covers today's costs, so it is a new one (X3).
        ValidateResponse again = validate(accountant, file);
        assertFalse(checked.token().equals(again.token()), "X3: the costs changed, so the token did");
        assertEquals(4, again.unchanged());
        assertEquals("IMPORT_CHANGED", code(() -> commit(accountant, file, checked.token())), "X3: stale token");
        CommitResponse repeat = commit(accountant, file, again.token());
        assertEquals(0, repeat.changed());
        assertEquals(4, repeat.unchanged() + repeat.alreadyDone());
        assertEquals(adjBefore + 4, adjustments(), "A3: no new cost adjustment");
        same("1000.0000", standardCost(shirt), "A3: unchanged");
        note("A3 repeat: changed 0, unchanged " + repeat.unchanged() + ", already_done " + repeat.alreadyDone()
                + "; audit rows now " + audits("ITEM_COSTS_IMPORT"));
    }

    // ================================================================== 3. opening receipts (A4, C1, C1c, C2)

    @Test
    @Order(3)
    void openingReceiptsCarryACost() {
        // A4: an opening receipt after the import takes the standard cost.
        Map<String, Object> shirts = postReceipt(manager, inst, receipt(l1, "OPENING", shirt, 4, null));
        String shirtReceipt = String.valueOf(shirts.get("id"));
        long shirtNumber = Long.parseLong(String.valueOf(shirts.get("receipt_number")).substring(4));
        assertEquals("STANDARD", lineCostSource(shirtReceipt, shirt), "A4: line cost_source");
        same("1000.0000", money("SELECT unit_cost FROM stock_movement WHERE institute_id = ? AND package_session_id = ? "
                + "AND type = 'RECEIPT' ORDER BY created_at DESC LIMIT 1", inst, shirt), "A4: movement unit_cost");
        note("A4 OPENING shirt x4 -> STANDARD, movement unit_cost 1000.0000");

        // C1: the plain item has no cost: refused before a number is taken, nothing written.
        long receiptsBefore = receiptRows(inst);
        long grnBefore = nextGrn(inst);
        String refused = code(() -> postReceipt(manager, inst, receipt(l1, "OPENING", plain, 3, null)));
        assertEquals("OPENING_COST_MISSING", refused);
        RuntimeException e = assertThrows(RuntimeException.class,
                () -> postReceipt(w1, inst, receipt(l1, "OPENING", plain, 3, null, shirt, 1, null)));
        assertTrue(e.getMessage().contains(sku("0005")) && !e.getMessage().contains(sku("0001")),
                "names only the item without a cost: " + e.getMessage());
        assertEquals(receiptsBefore, receiptRows(inst), "C1: no stock_receipt row");
        assertEquals(grnBefore, nextGrn(inst), "C1: no receipt number taken");
        assertEquals(0, onHand(l1, plain));
        note("C1 OPENING without cost -> 422 OPENING_COST_MISSING (" + e.getMessage() + "); counter unchanged");

        // C1c: another source with the same item posts as today.
        Map<String, Object> other = postReceipt(w1, inst, receipt(l1, "OTHER", plain, 1, null));
        String otherNumber = String.valueOf(other.get("receipt_number"));
        assertEquals("GRN-" + String.format("%06d", shirtNumber + 1), otherNumber, "no gap in the numbers");
        assertEquals(1, onHand(l1, plain));
        note("C1c OTHER of the uncosted item posts: " + otherNumber + " (no gap)");

        // C2: the cost is loaded with "set standard cost"; the opening receipt then posts STANDARD.
        StandardCostRequest set = new StandardCostRequest();
        set.setClientRequestId(key());
        StandardCostRequest.Item item = new StandardCostRequest.Item();
        item.setSku(sku("0005"));
        item.setStandardCost(new BigDecimal("80.00"));
        set.setItems(List.of(item));
        levelRoutes.standardCosts(accountant, inst, set);
        Map<String, Object> plains = postReceipt(manager, inst, receipt(l1, "OPENING", plain, 3, null));
        assertEquals("STANDARD", lineCostSource(String.valueOf(plains.get("id")), plain), "C2");
        assertEquals(4, onHand(l1, plain));
        note("C2 cost loaded -> OPENING plain x3 posts STANDARD");
    }

    // ================================================================== 4. readiness and the blind recount (C2-C5)

    @Test
    @Order(4)
    void readinessFollowsTheBlindRecount() {
        // The piece item: 19 pieces, opening, costed by the import.
        Map<String, Object> pieces = postReceipt(manager, inst, receipt(l1, "OPENING", scarf, 19, null));
        assertEquals("STANDARD", lineCostSource(String.valueOf(pieces.get("id")), scarf));
        List<String> codes = pieceCodes(scarf);
        assertEquals(19, codes.size());

        Map<String, Object> m = readiness(manager, inst, l1);
        assertEquals("RECEIVING", m.get("status"), String.valueOf(m));
        Map<String, Object> rec = part(m, "receipts");
        assertEquals(3, ((Number) rec.get("count")).intValue(), "three OPENING receipts at L1");
        assertEquals(26, ((Number) rec.get("units")).intValue(), "4 shirts + 3 plain + 19 scarves");
        assertEquals(26, ((Number) rec.get("units_costed")).intValue(), "C2: every unit costed");
        same("15640.00", rec.get("value"), "C2: value = 4 x 1000 + 3 x 80 + 19 x 600");
        assertTrue(((List<?>) rec.get("uncosted_receipts")).isEmpty());
        Map<String, Object> asW = readiness(w1, inst, l1);
        assertFalse(part(asW, "receipts").containsKey("value"), "C2: warehouse staff see no money");
        assertEquals(Boolean.FALSE, asW.get("sees_cost"));
        Map<String, Object> asAc = readiness(accountant, inst, l1);
        assertTrue(part(asAc, "receipts").containsKey("value"), "the accountant sees the value");
        Map<String, Object> items = part(m, "items");
        note("C2/C3 readiness RECEIVING: receipts " + rec + "; items " + items);

        // C3: COUNT by X scanning 19 labels + one quantity line = 20 lines; RECOUNT by Y of 2 lines, both agree.
        CountView main = openCount(w1, "COUNT", null);
        List<CountLineInput> lines = new ArrayList<>();
        codes.forEach(c -> lines.add(scanned(c)));
        lines.add(set(plain, onHand(l1, plain)));
        countLines(w1, main.id(), lines);
        assertEquals(20, count("SELECT count(*) FROM stock_count_line WHERE count_id = ?", main.id()));
        assertEquals("COUNTING", readiness(manager, inst, l1).get("status"));
        CountView recount = openCount(w2, "RECOUNT", main.id());
        countLines(w2, recount.id(), List.of(scanned(codes.get(0)), scanned(codes.get(7))));
        assertEquals("COUNTING", readiness(manager, inst, l1).get("status"), "recount still open");
        finish(w2, recount.id());
        Map<String, Object> passed = readiness(manager, inst, l1);
        // X7: the recount passed, but the count it checked is still open: not ready, not PASSED.
        assertEquals("COUNTING", passed.get("status"), String.valueOf(passed));
        assertTrue(((List<String>) passed.get("blockers")).contains("COUNT_NOT_POSTED"), String.valueOf(passed));
        assertEquals(Boolean.FALSE, passed.get("ready"));
        Map<String, Object> verdict = part(passed, "recount");
        assertEquals(20, ((Number) verdict.get("main_lines")).intValue());
        assertEquals(2, ((Number) verdict.get("compared")).intValue());
        assertEquals(2, ((Number) verdict.get("sample_needed")).intValue());
        same("10.0", verdict.get("sample_percent"), "C3 sample 10 %");
        same("100.0", verdict.get("percent"), "C3 agreement 100 %");
        assertEquals(Boolean.TRUE, verdict.get("passes"));
        assertEquals("OPEN", text("SELECT status FROM stock_count WHERE id = ?", main.id()), "main count still open");
        note("C3/X7 recount passes, main count open -> COUNTING + COUNT_NOT_POSTED: " + verdict);

        // C4: a recount of 1 line is too small a sample.
        CountView small = openCount(manager, "RECOUNT", main.id());
        countLines(manager, small.id(), List.of(scanned(codes.get(3))));
        finish(manager, small.id());
        Map<String, Object> tooSmall = readiness(manager, inst, l1);
        assertEquals("RECOUNT_FAILED", tooSmall.get("status"));
        assertTrue(((List<String>) tooSmall.get("blockers")).contains("SAMPLE_TOO_SMALL"), String.valueOf(tooSmall));
        note("C4 1 of 20 -> RECOUNT_FAILED " + tooSmall.get("blockers"));

        // C4b: 2 lines, one off -> below 98 %; then a further open recount -> COUNTING.
        CountView off = openCount(admin, "RECOUNT", main.id());
        countLines(admin, off.id(), List.of(scanned(codes.get(5)), set(plain, onHand(l1, plain) + 2)));
        finish(admin, off.id());
        Map<String, Object> below = readiness(manager, inst, l1);
        assertEquals("RECOUNT_FAILED", below.get("status"));
        assertTrue(((List<String>) below.get("blockers")).contains("AGREEMENT_BELOW_98"), String.valueOf(below));
        assertFalse(((List<String>) below.get("blockers")).contains("SAMPLE_TOO_SMALL"));
        CountView pending = openCount(w2, "RECOUNT", main.id());
        assertEquals("COUNTING", readiness(manager, inst, l1).get("status"), "C4b: an open recount");
        note("C4b 1 of 2 agree -> AGREEMENT_BELOW_98; open recount -> COUNTING");

        // X7: the open recount is finished agreeing, then the main count is posted -> PASSED.
        countLines(w2, pending.id(), List.of(scanned(codes.get(9)), scanned(codes.get(11))));
        finish(w2, pending.id());
        assertEquals("COUNTING", readiness(manager, inst, l1).get("status"), "X7: passes, main count still open");
        CountView postedMain = body(counts.post(manager, inst, main.id(),
                new StockOpsDtos.CountPostRequest(key(), "SKIP", null, null, null)));
        assertEquals("POSTED", postedMain.status());
        Map<String, Object> afterPost = readiness(manager, inst, l1);
        assertEquals("PASSED", afterPost.get("status"), String.valueOf(afterPost));
        assertFalse(((List<String>) afterPost.get("blockers")).contains("COUNT_NOT_POSTED"));
        assertEquals(main.id(), part(afterPost, "recount").get("count_id"));
        // X10: costs counted for the location's goods only (stock or opening lines here).
        Map<String, Object> goods = part(afterPost, "items");
        assertEquals(6, ((Number) goods.get("tracked")).intValue(), "shirt, plain, scarf + counter lamp, coaster, "
                + "vase: " + goods);
        assertEquals(3, ((Number) goods.get("with_cost")).intValue(), String.valueOf(goods));
        note("X7 recount of the open count passes -> COUNTING; count posted -> PASSED; X10 items here " + goods);

        // X7: a later count posted with no recount of its own -> COUNTING.
        CountView second = openCount(w1, "COUNT", null);
        countLines(w1, second.id(), List.of(set(plain, onHand(l1, plain))));
        body(counts.post(manager, inst, second.id(), new StockOpsDtos.CountPostRequest(key(), "SKIP", null, null,
                null)));
        Map<String, Object> laterCount = readiness(manager, inst, l1);
        assertEquals("COUNTING", laterCount.get("status"), String.valueOf(laterCount));
        assertNull(laterCount.get("recount"), "the earlier recount does not cover the later count");
        note("X7 later count posted without a recount -> COUNTING");

        // C5: a new opening receipt after all this sends the location back to RECEIVING.
        postReceipt(manager, inst, receipt(l1, "OPENING", bowl, 2, null));
        Map<String, Object> back = readiness(manager, inst, l1);
        assertEquals("RECEIVING", back.get("status"), String.valueOf(back));
        assertNull(back.get("recount"));
        note("C5 new OPENING receipt -> RECEIVING, recount null");
        cancelOpenCounts();
        assertEquals(0, count("SELECT count(*) FROM stock_movement WHERE reference_id IN (?, ?, ?, ?, ?, ?)",
                recount.id(), small.id(), off.id(), pending.id(), main.id(), second.id()),
                "recounts post no movement, and the counts matched the stock");
    }

    // ================================================================== 5. feature off (F1, C1b, C1d, C6, C7)

    @Test
    @Order(5)
    void featureOffKeepsTodayAndAnUncostedReceiptIsFlagged() {
        header(offInst);
        CustomUserDetails offManager = user("om-" + run, "COMMERCE_STORE_MANAGER");
        CustomUserDetails offAccountant = user("oa-" + run, "COMMERCE_ACCOUNTANT");
        MockMultipartFile file = csv("TST-0001-" + offInst.substring(0, 8) + ",50,no,,");
        LocalDate yesterday = today.minusDays(1);
        // F1 (and C7, A7): every new route answers FEATURE_DISABLED.
        int checks = 0;
        for (CustomUserDetails who : List.of(admin, offManager, offAccountant)) {
            assertEquals("FEATURE_DISABLED", code(() -> costImport.importCosts(who, offInst, "validate", null, file)));
            assertEquals("FEATURE_DISABLED", code(() -> costImport.importCosts(who, offInst, "commit", "x", file)));
            assertEquals("FEATURE_DISABLED", code(() -> costImport.template(who, offInst, "csv")));
            assertEquals("FEATURE_DISABLED", code(() -> parallelRun.days(who, offInst, lOff, yesterday, yesterday)));
            assertEquals("FEATURE_DISABLED", code(() -> parallelRun.export(who, offInst, lOff, yesterday, yesterday,
                    "csv", "en", null)));
            assertEquals("FEATURE_DISABLED", code(() -> parallelRun.save(who, offInst, lOff, yesterday,
                    old(0, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, null, null, null))));
            checks += 6;
        }
        assertEquals("FEATURE_DISABLED", code(() -> opening.readiness(admin, offInst, lOff)));
        checks++;
        assertEquals(0, count("SELECT count(*) FROM commerce_parallel_run_day WHERE institute_id = ?", offInst));
        note("F1 feature off: " + checks + " route checks -> FEATURE_DISABLED");

        // C1b: an opening receipt without a cost posts as today (one line typed, one with no cost).
        ReceiptRequest uncosted = receipt(lOff, "OPENING", offItem, 5, null, offItem2, 2, "40.00");
        Map<String, Object> posted = postReceipt(admin, offInst, uncosted);
        String receiptId = String.valueOf(posted.get("id"));
        String number = String.valueOf(posted.get("receipt_number"));
        String source = lineCostSource(receiptId, offItem);
        assertTrue(Set.of("NONE", "PROVISIONAL").contains(source), "C1b uncosted line: " + source);
        note("C1b feature off: OPENING without cost posts " + number + ", cost_source " + source);

        // C1d: with the feature turned on, a replay of that request still answers the same receipt.
        grantMigration(offInst);
        long grn = nextGrn(offInst);
        Map<String, Object> replay = postReceipt(admin, offInst, uncosted);
        assertEquals(receiptId, String.valueOf(replay.get("id")), "C1d: same receipt");
        assertEquals(grn, nextGrn(offInst), "C1d: no new number");
        assertEquals("OPENING_COST_MISSING", code(() -> postReceipt(admin, offInst, receipt(lOff, "OPENING", offItem, 1,
                null))), "a new uncosted opening receipt is now refused");
        note("C1d replay after turning the feature on -> same receipt, no number; new one refused");

        // C6: the uncosted opening receipt is a blocker until it is reversed.
        Map<String, Object> flagged = readiness(admin, offInst, lOff);
        assertTrue(((List<String>) flagged.get("blockers")).contains("UNCOSTED_OPENING_RECEIPT"), String.valueOf(flagged));
        List<Map<String, Object>> uncostedList = (List<Map<String, Object>>) part(flagged, "receipts")
                .get("uncosted_receipts");
        assertEquals(number, uncostedList.get(0).get("receipt_number"));
        // X9: flagged although one of its lines carries a cost; the counts are of the uncosted lines.
        assertEquals(1, ((Number) uncostedList.get(0).get("lines")).intValue(), String.valueOf(uncostedList));
        assertEquals(5, ((Number) uncostedList.get(0).get("units")).intValue());
        assertTrue(((List<String>) flagged.get("blockers")).contains("COSTS_MISSING"));
        ReceiptActionRequest reverse = new ReceiptActionRequest();
        reverse.setReason("Website figures replaced by counted opening stock");
        receipts.reverse(admin, offInst, receiptId, reverse);
        Map<String, Object> cleared = readiness(admin, offInst, lOff);
        assertFalse(((List<String>) cleared.get("blockers")).contains("UNCOSTED_OPENING_RECEIPT"), String.valueOf(cleared));
        assertEquals("NOT_STARTED", cleared.get("status"), "the reversed receipt no longer counts");
        assertEquals(0, onHand(lOff, offItem));
        note("C6 " + number + " flagged UNCOSTED_OPENING_RECEIPT; reversed -> gone, status NOT_STARTED");
        header(inst);
    }

    // ================================================================== 6. readiness refusals (C7)

    @Test
    @Order(6)
    void readinessRefusals() {
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> opening.readiness(wElse, inst, l1)), "W assigned elsewhere");
        assertEquals("ROLE_NOT_ALLOWED", code(() -> opening.readiness(cashier, inst, l1)), "cashier");
        assertEquals("LOCATION_NOT_FOUND", code(() -> opening.readiness(admin, inst, lOff)),
                "ADMIN with another institute's location");
        assertNotNull(readiness(wElse, inst, l2), "W at its own location");
        note("C7 W elsewhere LOCATION_NOT_ALLOWED; C ROLE_NOT_ALLOWED; other institute's location LOCATION_NOT_FOUND");
    }

    // ================================================================== 7. parallel run day figures (D2, D3)

    @Test
    @Order(7)
    void dayFiguresEqualTheSalesReport() {
        String session = openSession();
        String first = sell(session, List.of(line("l1", lamp), line("l2", coaster)),
                new PosDtos.Tender("CASH", new BigDecimal("500.00"), null, null));
        sell(session, List.of(line("l1", vase)), new PosDtos.Tender("UPI", new BigDecimal("300.00"), null, "UPI-TEST-1"));
        String coasterLine = text("SELECT id FROM commerce_order_line WHERE order_id = ? AND package_session_id = ?",
                first, coaster);
        posReturns.create(cashier, inst, new PosDtos.ReturnRequest(key(), session, first,
                List.of(new PosDtos.ReturnLine(coasterLine, 1, "RESALEABLE", null)), "DEFECTIVE", null, null,
                new PosDtos.Settle("REFUND", "CASH", null), pin(managerId, PIN)));
        closeSession(session);
        salesDay = LocalDate.parse(text("SELECT document_date::text FROM invoice WHERE commerce_order_id = ?", first));

        DayView d = day(salesDay);
        note("D2 day " + salesDay + ": " + d.platform() + ", status " + d.status());
        assertEquals(2, d.platform().bills(), "D2 bills");
        same("800.00", d.platform().salesValue(), "D2 sales value");
        same("400.00", d.platform().cash(), "D2 cash = 500 - 100 refund (UPI left out)");
        same("100.00", d.platform().returns(), "D2 returns = the credit note");
        assertEquals(0, d.platform().openSessions());
        assertEquals("NOT_SAVED", d.status());
        same(money("SELECT SUM(COALESCE(li.cgst, 0) + COALESCE(li.sgst, 0) + COALESCE(li.igst, 0) + COALESCE(li.cess, 0)) "
                + "FROM invoice i JOIN invoice_line_item li ON li.invoice_id = i.id WHERE i.institute_id = ? AND "
                + "i.location_id = ? AND i.document_date = ? AND i.document_type = 'TAX_INVOICE' AND i.cancelled_at IS NULL",
                inst, l1, salesDay).toPlainString(), d.platform().tax(), "D2 tax = the invoices' line taxes");

        // D3: the very figures of GET /reports/sales?groupBy=day&locationId=&channel=POS.
        JsonNode sold = json.valueToTree(body(reports.report(admin, "sales", inst, salesDay, salesDay, null, l1, "POS",
                null, null, null, null, null, "day", null, null, "en", null)));
        JsonNode totals = sold.path("totals");
        assertEquals(totals.path("invoices").asLong(), d.platform().bills(), "D3 bills = invoices");
        same(totals.path("net").asText(), d.platform().salesValue(), "D3 sales value = net");
        same(totals.path("tax").asText(), d.platform().tax(), "D3 tax");
        same(totals.path("returns").asText(), d.platform().returns(), "D3 returns");
        note("D3 sales report totals " + totals);
    }

    // ================================================================== 8. saving a day (D4)

    @Test
    @Order(8)
    void savingADay() {
        PlatformView p = day(salesDay).platform();
        long auditsBefore = audits("PARALLEL_RUN_DAY");
        DayView clean = body(parallelRun.save(manager, inst, l1, salesDay, old(p.bills(), p.salesValue(), p.tax(),
                p.cash(), null, null, null)));
        assertEquals("CLEAN", clean.result());
        assertEquals(0, clean.version());
        Map<String, Object> row = db.queryForMap("SELECT reviewed_by, reviewed_at, platform_json, result FROM "
                + "commerce_parallel_run_day WHERE institute_id = ? AND location_id = ? AND business_date = ?", inst, l1,
                salesDay);
        assertEquals(managerId, row.get("reviewed_by"));
        assertNotNull(row.get("reviewed_at"));
        JsonNode stored = readTree(String.valueOf(row.get("platform_json")));
        assertEquals(p.bills(), stored.path("bills").asLong());
        same(p.salesValue().toPlainString(), stored.path("sales_value").asText(), "stored platform = live read");
        same(p.cash().toPlainString(), stored.path("cash").asText(), "stored cash = live read");
        assertEquals(auditsBefore + 1, audits("PARALLEL_RUN_DAY"));
        note("D4 PUT matching -> CLEAN, reviewed_by manager, platform_json " + row.get("platform_json"));

        BigDecimal off = p.salesValue().add(new BigDecimal("2.00"));
        assertEquals("NOTE_REQUIRED", code(() -> parallelRun.save(manager, inst, l1, salesDay, old(p.bills(), off,
                p.tax(), p.cash(), null, null, 0))));
        assertEquals("CLEAN", text("SELECT result FROM commerce_parallel_run_day WHERE institute_id = ? AND "
                + "business_date = ?", inst, salesDay), "row unchanged");
        DayView different = body(parallelRun.save(manager, inst, l1, salesDay, old(p.bills(), off, p.tax(), p.cash(),
                null, "Old system keyed one item twice", 0)));
        assertEquals("DIFFERENT", different.result());
        assertEquals(1, different.version());
        assertEquals(auditsBefore + 2, audits("PARALLEL_RUN_DAY"));
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = 'PARALLEL_RUN_DAY' "
                + "AND old_value_json IS NOT NULL AND new_value_json IS NOT NULL", inst), "the replace keeps old and new");
        assertEquals("DAY_CHANGED", code(() -> parallelRun.save(manager, inst, l1, salesDay, old(p.bills(),
                p.salesValue(), p.tax(), p.cash(), null, null, 0))), "stale version");
        assertEquals("VALIDATION", code(() -> parallelRun.save(manager, inst, l1, today.plusDays(1), old(0,
                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, null, null, null))), "future date");
        assertEquals("ROLE_NOT_ALLOWED", code(() -> parallelRun.save(accountant, inst, l1, salesDay, old(p.bills(),
                p.salesValue(), p.tax(), p.cash(), null, null, 1))), "the accountant reads only");
        assertEquals(2, days(accountant, salesDay, salesDay).days().get(0).platform().bills(), "the accountant reads");
        note("D4 +2.00 no note -> NOTE_REQUIRED; with note -> DIFFERENT v1; stale -> DAY_CHANGED; future -> VALIDATION");
    }

    private JsonNode readTree(String value) {
        try {
            return json.readTree(value);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // ================================================================== 9. seven clean days (D5)

    @Test
    @Order(9)
    void sevenCleanDaysPass() {
        LocalDate d = salesDay;
        // A paper bill dated three days back makes that day a trading day.
        String session = openSession();
        paperBill(session, lamp, "400.00", "101", d.minusDays(3));
        closeSession(session);
        PlatformView paperDay = day(d.minusDays(3)).platform();
        assertEquals(1, paperDay.bills());
        same("400.00", paperDay.salesValue(), "the paper bill's sale is on its paper date");
        // X4: a paper bill's cash is counted on the bill's date (when it went into the drawer), not the day it was keyed.
        same("400.00", paperDay.cash(), "the paper bill's cash is on its paper date");
        note("X4 paper bill dated d-3: " + paperDay + "; its cash is on the bill's date");

        saveAgreeing(d);
        saveAgreeing(d.minusDays(1));
        saveAgreeing(d.minusDays(2));
        DaysAnswer three = days(admin, d.minusDays(8), d);
        assertEquals(3, three.streak(), "an unsaved trading day (d-3) ends the streak");
        assertFalse(three.passed());

        saveAgreeing(d.minusDays(3));
        saveAgreeing(d.minusDays(4));
        saveAgreeing(d.minusDays(6));
        saveAgreeing(d.minusDays(7));
        DaysAnswer seven = days(admin, d.minusDays(8), d);
        DayView skipped = seven.days().stream().filter(v -> v.date().equals(d.minusDays(5).toString())).findFirst()
                .orElseThrow();
        assertEquals("NO_SALES", skipped.status(), "d-5: no bills, no row = closed day");
        assertEquals(7, seven.streak(), "the closed day is skipped: " + seven.days().stream()
                .map(v -> v.date() + "=" + v.status()).toList());
        assertTrue(seven.passed());
        for (DayView v : seven.days()) {
            if (v.result() != null) {
                assertEquals(v.platform(), v.savedPlatform(), "stored platform figures = live read for " + v.date());
            }
        }
        note("D5 streak 3 with unsaved trading day; then 7 with a closed day skipped -> passed");

        // A paper bill keyed later for a saved day: that day reads RECHECK and the streak breaks.
        String later = openSession();
        paperBill(later, lamp, "400.00", "102", d.minusDays(1));
        closeSession(later);
        DaysAnswer after = days(admin, d.minusDays(8), d);
        DayView recheck = after.days().stream().filter(v -> v.date().equals(d.minusDays(1).toString())).findFirst()
                .orElseThrow();
        assertEquals("RECHECK", recheck.status());
        same("400.00", recheck.platform().cash(), "X4: the late paper bill's cash is on d-1");
        DayView keyedOn = after.days().stream().filter(v -> v.date().equals(d.toString())).findFirst().orElseThrow();
        assertEquals("CLEAN", keyedOn.status(), "X4: the day it was keyed is untouched");
        assertFalse(after.passed());
        assertTrue(after.streak() < 2, "streak " + after.streak());
        note("D5 late paper bill for d-1 -> RECHECK, streak " + after.streak() + ", statuses " + after.days().stream()
                .map(v -> v.date() + "=" + v.status()).toList());
    }

    // ================================================================== 10. open session (D6)

    @Test
    @Order(10)
    void anOpenSessionBlocksTheDay() {
        String session = openSession();
        long rows = count("SELECT count(*) FROM commerce_parallel_run_day WHERE institute_id = ?", inst);
        long auditRows = audits("PARALLEL_RUN_DAY");
        assertEquals("SESSION_OPEN", code(() -> parallelRun.save(manager, inst, l1, today, old(0, BigDecimal.ZERO,
                BigDecimal.ZERO, BigDecimal.ZERO, null, null, null))));
        assertEquals(rows, count("SELECT count(*) FROM commerce_parallel_run_day WHERE institute_id = ?", inst));
        assertEquals(auditRows, audits("PARALLEL_RUN_DAY"));
        assertEquals(1, day(today).platform().openSessions());
        closeSession(session);
        note("D6 open session -> SESSION_OPEN, no row, no audit");
    }

    // ================================================================== 11. outsiders (F2, A7)

    @Test
    @Order(11)
    void outsidersAreRefusedEverywhere() {
        MockMultipartFile file = csv(sku("0003") + ",250,no,,");
        LocalDate d = salesDay;
        Map<String, java.util.function.Consumer<CustomUserDetails>> routes = new java.util.LinkedHashMap<>();
        routes.put("POST /stock/standard-costs/import validate", who -> costImport.importCosts(who, inst, "validate",
                null, file));
        routes.put("POST /stock/standard-costs/import commit", who -> costImport.importCosts(who, inst, "commit", "x",
                file));
        routes.put("GET /stock/standard-costs/template", who -> costImport.template(who, inst, "xlsx"));
        routes.put("GET /stock/opening/readiness", who -> opening.readiness(who, inst, l1));
        routes.put("GET /parallel-run/days", who -> parallelRun.days(who, inst, l1, d, d));
        routes.put("PUT /parallel-run/days", who -> parallelRun.save(who, inst, l1, d, old(0, BigDecimal.ZERO,
                BigDecimal.ZERO, BigDecimal.ZERO, null, "x", 9)));
        routes.put("GET /parallel-run/export", who -> parallelRun.export(who, inst, l1, d, d, "csv", "en", null));
        Set<String> refusal = Set.of(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                CommerceAccessDeniedException.ACCESS_DENIED);
        long rows = count("SELECT count(*) FROM commerce_parallel_run_day WHERE institute_id = ?", inst);
        long adj = adjustments();
        int checks = 0;
        List<String> seen = new ArrayList<>();
        for (Map.Entry<String, java.util.function.Consumer<CustomUserDetails>> route : routes.entrySet()) {
            header(inst);
            for (CustomUserDetails who : List.of(learner, shopper, cashier)) {
                String got = code(() -> route.getValue().accept(who));
                assertTrue(refusal.contains(got), who.getUserId() + " on " + route.getKey() + ": " + got);
                seen.add(route.getKey() + " " + who.getUserId().split("-")[0] + "=" + got);
                checks++;
            }
            header(otherInst);
            String got = code(() -> route.getValue().accept(otherAdmin));
            assertEquals(CommerceAccessDeniedException.ACCESS_DENIED, got, "other institute's admin on " + route.getKey());
            checks++;
        }
        header(inst);
        // Warehouse staff: no cost import, no parallel run (readiness is theirs).
        for (String name : List.of("POST /stock/standard-costs/import validate", "GET /stock/standard-costs/template",
                "GET /parallel-run/days", "PUT /parallel-run/days", "GET /parallel-run/export")) {
            assertEquals("ROLE_NOT_ALLOWED", code(() -> routes.get(name).accept(w1)), "W on " + name);
            checks++;
        }
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> parallelRun.days(manager2, inst, l1, d, d)),
                "manager of another location");
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> parallelRun.save(manager2, inst, l1, d, old(0,
                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, null, "x", 9))));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> parallelRun.days(admin, inst, lOff, d, d)),
                "ADMIN with another institute's location");
        checks += 3;
        assertEquals(rows, count("SELECT count(*) FROM commerce_parallel_run_day WHERE institute_id = ?", inst));
        assertEquals(adj, adjustments());
        note("F2/A7 " + checks + " refusals, nothing written; " + seen);
    }

    // ================================================================== 12. cash outside a counter session (X5)

    @Test
    @Order(12)
    void cashTakenOutsideACounterSessionIsNotDayCash() {
        DayView before = day(today);
        StaffOrderRequest request = StaffOrderRequest.builder().clientRequestId(key())
                .customer(StaffOrderRequest.Customer.builder().phone("9876500001").name("Phone Buyer").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("2 Test Lane").city("Test City")
                        .pincode("200001").build())
                .lines(List.of(StaffOrderRequest.Line.builder().variantId(lamp).quantity(1).build()))
                .tenders(List.of(StaffOrderRequest.Tender.builder().mode("CASH").amount(new BigDecimal("100.00"))
                        .build()))
                .restOnCredit(true).build();
        String orderId = staffOrders.create(admin, inst, request).detail().getOrder().getId();
        assertEquals(l1, text("SELECT fulfilment_location_id FROM commerce_order WHERE id = ?", orderId),
                "the staff order is fulfilled from the store");
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND mode = 'CASH' AND "
                + "status = 'RECEIVED' AND pos_session_id IS NULL", orderId), "cash received outside a session");
        DayView after = day(today);
        same(before.platform().cash().toPlainString(), after.platform().cash(), "X5: day cash unchanged");
        assertEquals(before.platform().bills(), after.platform().bills());
        assertEquals(before.status(), after.status(), "X5: the day's verdict is unchanged");
        note("X5 staff-order cash 100 at the store outside a session: day cash " + after.platform().cash()
                + " (was " + before.platform().cash() + "), status " + after.status());
    }

    // ================================================================== 13. measured goods and re-commit (X1, X2, X3, X8)

    @Test
    @Order(13)
    void aMeasuredItemsCostIsStoredPerBaseUnitAndAnEarlierFileRestores() {
        // X8: a typed cost of 0 is no cost: refused while the switch-over is on.
        assertEquals("OPENING_COST_MISSING", code(() -> postReceipt(manager, inst, receipt(l2, "OPENING", cloth, 500,
                "0"))));

        // X1: 120 per metre at qty_scale 10 is 12.0000 per tenth of a metre.
        MockMultipartFile x = csv(sku("0009") + ",120,no,,");
        ValidateResponse checked = validate(accountant, x);
        assertEquals(0, checked.errorCount(), String.valueOf(checked.errors()));
        same("120", checked.spotCheck().get(0).price(), "sheet price per metre");
        same("120.0000", checked.spotCheck().get(0).costPerUnit(), "cost per metre");
        same("12.0000", checked.spotCheck().get(0).cost(), "cost per base unit");
        assertEquals(10, checked.spotCheck().get(0).qtyScale());
        assertEquals("MTR", checked.spotCheck().get(0).unit());
        assertEquals("REMOVE_INCLUDED_TAX", checked.taxRule(), "the proof shop is in REGULAR tax mode");
        commit(accountant, x, checked.token());
        same("12.0000", standardCost(cloth), "X1 stored per base unit");

        // 50 m opening = 500 base units at 12.0000 = 6,000.
        Map<String, Object> opened = postReceipt(manager, inst, receipt(l2, "OPENING", cloth, 500, null));
        assertEquals("STANDARD", lineCostSource(String.valueOf(opened.get("id")), cloth));
        same("12.0000", money("SELECT unit_cost FROM stock_movement WHERE institute_id = ? AND package_session_id = ? "
                + "AND type = 'RECEIPT' ORDER BY created_at DESC LIMIT 1", inst, cloth), "X1 movement unit_cost");
        Map<String, Object> atL2 = readiness(manager, inst, l2);
        same("6000.00", part(atL2, "receipts").get("value"), "X1: 50 m opening = 6,000");
        // X10: the location's goods are the cloth only; the counter items without a cost are elsewhere.
        Map<String, Object> goods = part(atL2, "items");
        assertEquals(1, ((Number) goods.get("tracked")).intValue(), String.valueOf(goods));
        assertEquals(0, ((Number) goods.get("without_cost")).intValue(), String.valueOf(goods));
        assertEquals(3, ((Number) goods.get("institute_without_cost")).intValue(), String.valueOf(goods));
        assertFalse(((List<String>) atL2.get("blockers")).contains("COSTS_MISSING"), String.valueOf(atL2));
        note("X1 cloth 120/m, scale 10 -> 12.0000; 500 base units -> value " + part(atL2, "receipts").get("value")
                + "; X10 items at L2 " + goods);

        // X3: X, then Y, then X again puts X's cost back.
        MockMultipartFile y = csv(sku("0009") + ",130,no,,");
        ValidateResponse checkedY = validate(accountant, y);
        assertEquals(1, commit(accountant, y, checkedY.token()).changed());
        same("13.0000", standardCost(cloth), "Y");
        assertEquals("IMPORT_CHANGED", code(() -> commit(accountant, x, checked.token())),
                "X's old token is stale once the cost changed");
        ValidateResponse again = validate(accountant, x);
        assertEquals(1, again.toChange());
        CommitResponse restored = commit(accountant, x, again.token());
        assertEquals(1, restored.changed());
        assertEquals(0, restored.alreadyDone());
        same("12.0000", standardCost(cloth), "X3: X restored");
        assertEquals(3, count("SELECT count(*) FROM stock_cost_adjustment WHERE institute_id = ? AND package_session_id "
                + "= ? AND reason = 'STANDARD_SET'", inst, cloth));
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = "
                + "'ITEM_COSTS_IMPORT' AND new_value_json::text LIKE ?", inst, "%" + again.token().substring(0, 16) + "%"));
        note("X3 X -> Y -> X: standard cost 12.0000 again, STANDARD_SET x3");

        // X2: an institute that is not in REGULAR tax mode keeps the tax in the cost.
        header(offInst);
        MockMultipartFile taxed = csv("TST-0001-" + offInst.substring(0, 8) + ",1180,yes,18,");
        ValidateResponse kept = (ValidateResponse) body(costImport.importCosts(admin, offInst, "validate", null,
                taxed));
        header(inst);
        assertEquals("UNREGISTERED", kept.taxMode());
        assertEquals("KEEP_TAX_IN_COST", kept.taxRule());
        same("1180.0000", kept.spotCheck().get(0).cost(), "X2: tax kept in cost");
        assertTrue(kept.warnings().stream().anyMatch(w -> "TAX_KEPT_IN_COST".equals(w.code())));
        note("X2 UNREGISTERED: 1180 incl. 18 % -> 1180.0000 with TAX_KEPT_IN_COST");
    }
}
