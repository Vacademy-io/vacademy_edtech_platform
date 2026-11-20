package vacademy.io.admin_core_service.features.commerce;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.function.Executable;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
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
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsMeController;
import vacademy.io.admin_core_service.features.commerce.accounts.crypto.CommerceFieldCipher;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceAccountHead;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommercePeriodLock;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplier;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplierLedgerEntry;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplierSecret;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.SupplierLedgerType;
import vacademy.io.admin_core_service.features.commerce.accounts.head.AccountHeadController;
import vacademy.io.admin_core_service.features.commerce.accounts.head.AccountHeadDtos.HeadRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.head.AccountHeadDtos.HeadView;
import vacademy.io.admin_core_service.features.commerce.accounts.ledger.SupplierLedgerPost;
import vacademy.io.admin_core_service.features.commerce.accounts.ledger.SupplierLedgerResult;
import vacademy.io.admin_core_service.features.commerce.accounts.ledger.SupplierLedgerService;
import vacademy.io.admin_core_service.features.commerce.accounts.ledger.SupplierStatementController;
import vacademy.io.admin_core_service.features.commerce.accounts.ledger.SupplierStatementService.StatementView;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockController;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.Approval;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PeriodLockRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PeriodLockView;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PreviewItem;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockPreviewContributor;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockService;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierController;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.LookupRow;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SensitiveRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.StatusRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRow;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierView;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierService;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionClient;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceStaffController;
import vacademy.io.admin_core_service.features.commerce.security.dto.StaffPinRequest;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffScope;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockReceiptController;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptActionRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLocationService;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.platform_billing.service.IndianStates;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiConsumer;
import java.util.function.Function;

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
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * WP-60a accounts foundation against a real Postgres 16 with the whole Flyway chain and the real
 * Spring context: the schema of V735, the feature off by default (and a lock dormant while it is
 * off), the starter account heads, suppliers with the PAN encrypted by the field cipher (never in
 * a list, a log line, an audit row or a column in plain text), goods receipts that name a supplier,
 * the supplier ledger (one key, one row, also under 20 threads), the period lock racing real posts
 * on real threads, the institute-wide roles and the gate-14 outsiders. Calls go through the
 * controllers, so every refusal is the one a request would meet.
 *
 * <p>Runs only when {@code COMMERCE_IT_PG_URL} names a database on this machine; skipped in the
 * default build like the other commerce database proofs. The encryption key is a test-only value
 * built here; every PAN and GSTIN is computed by the test.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import({CommerceM1DatabaseProofIT.LocalOnly.class, CommerceAccountsDatabaseProofIT.LedgerRowsPreview.class})
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CommerceAccountsDatabaseProofIT {

    private static final String PIN = "482917";
    private static final String WRONG_PIN = "731905";
    private static final String ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    /** A test-only key: id t1 and 32 fixed bytes. Never a real key. */
    private static String testKey() {
        byte[] bytes = new byte[32];
        for (int i = 0; i < bytes.length; i++) {
            bytes[i] = (byte) (i * 7 + 3);
        }
        return "t1:" + Base64.getEncoder().encodeToString(bytes);
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "24");
        registry.add("commerce.order-token.secret", () -> "local-proof-only-not-a-secret");
        registry.add("commerce.turnstile.required", () -> "false");
        registry.add("commerce.payment-fetch.cron", () -> "-");
        registry.add("commerce.field.encryption.key", CommerceAccountsDatabaseProofIT::testKey);
        registry.add("commerce.field.encryption.previous-keys", () -> "");
    }

    // ------------------------------------------------------------ test-only preview contributor

    /** Institute and supplier whose ledger rows the test contributor counts (step 7, ledger race). */
    static volatile String ledgerRaceInstitute;
    static volatile String ledgerRaceSupplier;

    /**
     * Step 7 (ledger race): a lock preview item that counts the race supplier's ledger rows dated on
     * or before the lock date, asked by the lock after it holds the lock row. Null (skipped) for every
     * other institute.
     */
    @TestConfiguration
    static class LedgerRowsPreview {
        @Bean
        PeriodLockPreviewContributor testLedgerRows(JdbcTemplate jdbc) {
            return new PeriodLockPreviewContributor() {
                @Override
                public String kind() {
                    return "TEST_LEDGER_ROWS";
                }

                @Override
                public PreviewItem items(String instituteId, LocalDate through) {
                    if (!instituteId.equals(ledgerRaceInstitute)) {
                        return null;
                    }
                    Long n = jdbc.queryForObject("SELECT count(*) FROM commerce_supplier_ledger WHERE institute_id = ? "
                            + "AND supplier_id = ? AND book_date <= ?", Long.class, instituteId, ledgerRaceSupplier,
                            through);
                    return new PreviewItem("TEST_LEDGER_ROWS", n == null ? 0 : n, List.of());
                }
            };
        }
    }

    @Autowired private JdbcTemplate db;
    @Autowired private CapabilityResolver capabilityResolver;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private EntityManager entityManager;
    @Autowired private StockClock stockClock;
    @Autowired private StockLocationService locationService;
    @Autowired private CommerceProductService productService;
    @Autowired private SupplierService supplierService;
    @Autowired private SupplierLedgerService ledger;
    @Autowired private PeriodLockService periodLock;
    // The routes.
    @Autowired private AccountsMeController accountsMe;
    @Autowired private SupplierController suppliers;
    @Autowired private SupplierStatementController statements;
    @Autowired private AccountHeadController heads;
    @Autowired private PeriodLockController periodLocks;
    @Autowired private CommerceStaffController staff;
    @Autowired private StockReceiptController receipts;

    @SpyBean private CommerceFieldCipher cipher;

    @MockBean private AuthService authService;
    @MockBean private InvoiceService invoiceService;
    @MockBean private WorkflowTriggerService workflowTriggerService;
    @MockBean private PaymentNotificatonService paymentNotificatonService;
    @MockBean private DynamicNotificationService dynamicNotificationService;
    @MockBean private AsyncEnrollmentEmailService asyncEnrollmentEmailService;
    @MockBean private MediaService mediaService;
    @MockBean private CommerceRenditionClient renditionClient;

    private final String inst = UUID.randomUUID().toString();
    private final String offInst = UUID.randomUUID().toString();
    private final String otherInst = UUID.randomUUID().toString();
    private final String run = inst.substring(0, 8);
    private final AtomicInteger keys = new AtomicInteger();
    private final AtomicInteger skus = new AtomicInteger();
    /** Seeded, so a run can be repeated: the offsets between the two sides of a race. */
    private final java.util.Random jitter = new java.util.Random(60_734L);

    private final String adminId = "admin-" + run;
    private final String managerId = "mgr-" + run;          // M at L1 (receipts)
    private final String wideAcId = "acw-" + run;
    private final String limitedAcId = "acl-" + run;
    private final String wideMId = "mgw-" + run;
    private final String limitedMId = "mgl-" + run;
    private final String warehouseId = "wh-" + run;
    private final String cashierId = "ca-" + run;
    private final Map<String, String> rolesById = new java.util.concurrent.ConcurrentHashMap<>();

    private CustomUserDetails admin;
    private CustomUserDetails manager;
    private CustomUserDetails wideAc;
    private CustomUserDetails limitedAc;
    private CustomUserDetails wideM;
    private CustomUserDetails limitedM;
    private CustomUserDetails warehouse;
    private CustomUserDetails cashier;
    private CustomUserDetails learner;
    private CustomUserDetails shopper;
    private CustomUserDetails otherAdmin;

    private String l1;
    private String item;
    private String offL1;
    private String offItem;
    private String regularSupplier;     // REGULAR, GSTIN computed by the test, no PAN
    private String panSupplier;         // UNREGISTERED, PAN encrypted
    private String panSupplier2;        // REGULAR, a PAN that differs from the one inside its GSTIN
    private String panValue;
    private String panValue2;
    private String ledgerSupplier;
    private String rentHead;
    private String postedReceipt;       // a SUPPLIER receipt of inst (step 5)

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
        admin = staffUser(adminId, "ADMIN");
        manager = staffUser(managerId, "COMMERCE_STORE_MANAGER");
        wideAc = staffUser(wideAcId, "COMMERCE_ACCOUNTANT");
        limitedAc = staffUser(limitedAcId, "COMMERCE_ACCOUNTANT");
        wideM = staffUser(wideMId, "COMMERCE_STORE_MANAGER");
        limitedM = staffUser(limitedMId, "COMMERCE_STORE_MANAGER");
        warehouse = staffUser(warehouseId, "COMMERCE_WAREHOUSE_STAFF");
        cashier = staffUser(cashierId, "COMMERCE_POS_CASHIER");
        learner = user("learner-" + run, "STUDENT");
        shopper = user("shopper-" + run);
        otherAdmin = user("oadmin-" + run, "ADMIN");
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

    private CustomUserDetails staffUser(String id, String role) {
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
        System.out.println("ACC_PROOF " + line);
    }

    private String key() {
        return "acc-" + run + "-" + keys.incrementAndGet();
    }

    private long count(String query, Object... args) {
        Long n = db.queryForObject(query, Long.class, args);
        return n == null ? 0 : n;
    }

    private String text(String query, Object... args) {
        List<String> found = db.queryForList(query, String.class, args);
        return found.isEmpty() ? null : found.get(0);
    }

    /** The refusal's code: the guard's code, or the text before the first colon of the message. */
    private static String code(Executable call) {
        RuntimeException e = assertThrows(RuntimeException.class, call);
        return codeOf(e);
    }

    private static String codeOf(Throwable e) {
        if (e instanceof CommerceAccessDeniedException denied) {
            return denied.getCode();
        }
        String message = String.valueOf(e.getMessage());
        int colon = message.indexOf(':');
        return colon > 0 ? message.substring(0, colon) : message;
    }

    private static String message(Executable call) {
        return String.valueOf(assertThrows(RuntimeException.class, call).getMessage());
    }

    private static <T> T body(ResponseEntity<T> answer) {
        return answer.getBody();
    }

    private static String sqlState(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof SQLException sql && sql.getSQLState() != null) {
                return sql.getSQLState();
            }
            if (t.getCause() == t) {
                break;
            }
        }
        return null;
    }

    /** A PAN-shaped test value: five letters, four digits, one letter. */
    private static String pan(String letters5, int digits4, char last) {
        return letters5 + String.format("%04d", digits4) + last;
    }

    /** A GSTIN computed by the test: state, PAN, entity 1, Z, base-36 check character. */
    private static String gstin(String state, String pan) {
        String first14 = state + pan + "1Z";
        int sum = 0;
        for (int i = 0; i < first14.length(); i++) {
            int product = ALPHABET.indexOf(first14.charAt(i)) * (i % 2 == 0 ? 1 : 2);
            sum += product / 36 + product % 36;
        }
        return first14 + ALPHABET.charAt((36 - sum % 36) % 36);
    }

    private static String withWrongCheck(String good) {
        char right = good.charAt(14);
        return good.substring(0, 14) + ALPHABET.charAt((ALPHABET.indexOf(right) + 1) % 36);
    }

    private void institute(String id, String name, boolean commerce, boolean accounts) {
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                id, name, "https://learn-" + id.substring(0, 8) + ".example.com");
        if (commerce) {
            db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)",
                    id);
        }
        if (accounts) {
            grantAccounts(id);
        }
        capabilityResolver.evict(id);
    }

    private void grantAccounts(String id) {
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, "
                + "'commerce.accounts', true)", id);
        capabilityResolver.evict(id);
    }

    private String location(String instituteId, String code) {
        LocationRequest location = new LocationRequest();
        location.setCode(code + "-" + instituteId.substring(0, 6));
        location.setName(code + " " + instituteId.substring(0, 6));
        location.setAddressLine1("1 Test Road");
        location.setCity("Test City");
        location.setPincode("100001");
        location.setStateCode("09");
        location.setIsStore(true);
        location.setIsWarehouse(true);
        location.setIsPosEnabled(false);
        location.setSellsOnline(false);
        return locationService.create(instituteId, adminId, true, location).getId();
    }

    /** A counted item (QUANTITY, DRAFT, no tax class): enough for a goods receipt. */
    private String item(String instituteId) {
        int n = skus.incrementAndGet();
        ProductRequest request = ProductRequest.builder().slug("proof-item-" + n + "-" + run)
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name("Proof item " + n).build()))
                .status("DRAFT").stockMode("QUANTITY").unit("PCS").qtyScale(1)
                .variants(List.of(VariantRequest.builder().sku("PI-" + n + "-" + run).name("One size")
                        .price(new BigDecimal("100.00")).weightGrams(100).build()))
                .build();
        return productService.save(instituteId, adminId, request).getVariants().get(0).getPackageSessionId();
    }

    private void assign(String instituteId, String userId, String locationId) {
        db.update("INSERT INTO commerce_staff_location (id, institute_id, user_id, location_id, created_by) "
                + "VALUES (?, ?, ?, ?, ?)", UUID.randomUUID().toString(), instituteId, userId, locationId, adminId);
    }

    private SupplierRequest supplierRequest(String name, String gstin, String pan) {
        SupplierRequest request = new SupplierRequest();
        request.setClientRequestId(key());
        request.setName(name);
        request.setCity("Test City");
        request.setPincode("100001");
        request.setStateCode("09");
        request.setGstin(gstin);
        request.setPan(pan);
        return request;
    }

    /** A supplier made through the service (setup only), answering its id. */
    private String supplierOf(String instituteId, String name) {
        return supplierService.create(instituteId, adminId, supplierRequest(name, null, null)).getId();
    }

    private ReceiptRequest receiptRequest(String locationId, String variant, String sourceKind, String supplierId,
                                          LocalDate date) {
        ReceiptRequest request = new ReceiptRequest();
        request.setLocationId(locationId);
        request.setSourceKind(sourceKind);
        request.setSupplierId(supplierId);
        request.setReceivedDate(date);
        request.setNote("proof receipt");
        request.setClientRequestId("rc-" + key());
        ReceiptRequest.Line line = new ReceiptRequest.Line();
        line.setPackageSessionId(variant);
        line.setQuantity(1);
        request.setLines(List.of(line));
        return request;
    }

    private String receive(CustomUserDetails who, String instituteId, ReceiptRequest request) {
        return String.valueOf(body(receipts.create(who, instituteId, request)).get("id"));
    }

    private PeriodLockRequest lockRequest(LocalDate through, String reason, Approval approval) {
        PeriodLockRequest request = new PeriodLockRequest();
        request.setClientRequestId(key());
        request.setLockedThrough(through);
        request.setReason(reason);
        request.setApproval(approval);
        return request;
    }

    private static long previewCount(PeriodLockView view, String kind) {
        assertNotNull(view.getPreview(), "a LOCK answers its preview");
        return view.getPreview().getItems().stream().filter(i -> kind.equals(i.getKind()))
                .mapToLong(PreviewItem::getCount).findFirst().orElse(-1);
    }

    private long auditPreviewCount(String instituteId, LocalDate through, String kind) {
        String n = text("SELECT new_value_json->'preview_counts'->>? FROM commerce_audit WHERE institute_id = ? AND "
                + "kind = 'PERIOD_LOCK' AND new_value_json->>'locked_through' = ?", kind, instituteId, through.toString());
        return n == null ? -1 : Long.parseLong(n);
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    private SupplierLedgerPost post(String instituteId, String supplierId, LocalDate date, SupplierLedgerType type,
                                    String amount, String reverses, String idempotencyKey) {
        return new SupplierLedgerPost(instituteId, supplierId, date, type, new BigDecimal(amount), "PROOF", null,
                null, null, "proof", adminId, reverses, idempotencyKey);
    }

    private static void same(String expected, BigDecimal actual, String what) {
        assertNotNull(actual, what);
        assertEquals(0, new BigDecimal(expected).compareTo(actual), what + ": " + actual);
    }

    private static void pause(int ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    /** Runs {@code n} calls released together, each on its own thread with the clientId header set. */
    private List<Object> together(int n, String clientId, Function<Integer, Object> work) throws Exception {
        CyclicBarrier barrier = new CyclicBarrier(n);
        ExecutorService pool = Executors.newFixedThreadPool(n);
        try {
            List<Future<Object>> futures = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                int index = i;
                futures.add(pool.submit(() -> {
                    header(clientId);
                    barrier.await(30, TimeUnit.SECONDS);
                    try {
                        return work.apply(index);
                    } catch (RuntimeException e) {
                        return e;
                    }
                }));
            }
            List<Object> out = new ArrayList<>();
            for (Future<Object> f : futures) {
                out.add(f.get(120, TimeUnit.SECONDS));
            }
            return out;
        } finally {
            pool.shutdownNow();
        }
    }

    /** Two different calls released together; answers {first, second} (a value or the exception). */
    private Object[] race(String clientId, Callable<Object> first, Callable<Object> second, ExecutorService pool)
            throws Exception {
        return race(clientId, first, second, pool, 0);
    }

    /**
     * As {@link #race(String, Callable, Callable, ExecutorService)}; {@code offsetMs} &gt; 0 holds the
     * second call back that long after the barrier, &lt; 0 holds the first one back. Spreads the
     * iterations over both orders and over the overlap where one waits on the other's row lock.
     */
    private Object[] race(String clientId, Callable<Object> first, Callable<Object> second, ExecutorService pool,
                          int offsetMs) throws Exception {
        CyclicBarrier barrier = new CyclicBarrier(2);
        Future<Object> a = pool.submit(() -> {
            header(clientId);
            barrier.await(30, TimeUnit.SECONDS);
            if (offsetMs < 0) {
                Thread.sleep(-offsetMs);
            }
            try {
                return first.call();
            } catch (RuntimeException e) {
                return e;
            }
        });
        Future<Object> b = pool.submit(() -> {
            header(clientId);
            barrier.await(30, TimeUnit.SECONDS);
            if (offsetMs > 0) {
                Thread.sleep(offsetMs);
            }
            try {
                return second.call();
            } catch (RuntimeException e) {
                return e;
            }
        });
        return new Object[]{a.get(120, TimeUnit.SECONDS), b.get(120, TimeUnit.SECONDS)};
    }

    /** One WP-60a route, called as {@code user} for {@code instituteId}. */
    private record Route(String name, boolean accountsOnly, BiConsumer<CustomUserDetails, String> call) {
    }

    /** Every WP-60a route; {@code accountsOnly} false for the PIN routes (also open under POS). */
    private List<Route> routes(String supplierId, String headId) {
        List<Route> out = new ArrayList<>();
        out.add(new Route("GET /accounts/me", true, (u, i) -> accountsMe.me(u, i)));
        out.add(new Route("GET /accounts/encryption-status", true, (u, i) -> accountsMe.encryptionStatus(u, i)));
        out.add(new Route("GET /staff/scope", true, (u, i) -> staff.scope(u, i, limitedAcId)));
        out.add(new Route("PUT /staff/scope", true, (u, i) -> {
            CommerceStaffController.StaffScopeRequest request = new CommerceStaffController.StaffScopeRequest();
            request.setUserId(limitedAcId);
            request.setAllLocations(false);
            staff.setScope(u, i, request);
        }));
        out.add(new Route("GET /staff/pin", false, (u, i) -> staff.pinStatus(u, i)));
        out.add(new Route("PUT /staff/pin", false, (u, i) -> {
            StaffPinRequest request = new StaffPinRequest();
            request.setPin("905172");
            staff.setPin(u, i, request);
        }));
        out.add(new Route("GET /suppliers", true, (u, i) -> suppliers.list(u, i, null, null, null, false, 0, 20)));
        out.add(new Route("GET /suppliers/lookup", true, (u, i) -> suppliers.lookup(u, i, "Test")));
        out.add(new Route("GET /suppliers/groups", true, (u, i) -> suppliers.groups(u, i)));
        out.add(new Route("POST /suppliers", true,
                (u, i) -> suppliers.create(u, i, supplierRequest("Gate Supplier", null, null))));
        out.add(new Route("GET /suppliers/{id}", true, (u, i) -> suppliers.get(u, i, supplierId)));
        out.add(new Route("PUT /suppliers/{id}", true, (u, i) -> {
            SupplierRequest request = supplierRequest("Gate Supplier", null, null);
            request.setVersion(0L);
            suppliers.update(u, i, supplierId, request);
        }));
        out.add(new Route("POST /suppliers/{id}/status", true, (u, i) -> {
            StatusRequest request = new StatusRequest();
            request.setStatus("ACTIVE");
            suppliers.setStatus(u, i, supplierId, request);
        }));
        out.add(new Route("POST /suppliers/{id}/sensitive", true, (u, i) -> {
            SensitiveRequest request = new SensitiveRequest();
            request.setField("pan");
            suppliers.sensitive(u, i, supplierId, request);
        }));
        out.add(new Route("GET /suppliers/{id}/statement", true, (u, i) -> statements.statement(u, i, supplierId,
                null, null)));
        out.add(new Route("GET /account-heads", true, (u, i) -> heads.list(u, i, null, null)));
        out.add(new Route("POST /account-heads", true, (u, i) -> {
            HeadRequest request = new HeadRequest();
            request.setClientRequestId(key());
            request.setCode("GATE_HEAD");
            request.setNameI18n(Map.of("en", "Gate head"));
            request.setNature("EXPENSE");
            heads.create(u, i, request);
        }));
        out.add(new Route("PUT /account-heads/{id}", true, (u, i) -> {
            HeadRequest request = new HeadRequest();
            request.setNameI18n(Map.of("en", "Rent"));
            request.setNature("EXPENSE");
            heads.update(u, i, headId, request);
        }));
        out.add(new Route("GET /period-lock", true, (u, i) -> periodLocks.read(u, i)));
        out.add(new Route("GET /period-lock/preview", true,
                (u, i) -> periodLocks.preview(u, i, stockClock.today(inst).minusDays(40))));
        out.add(new Route("PUT /period-lock", true,
                (u, i) -> periodLocks.change(u, i, lockRequest(stockClock.today(inst).minusDays(40), null, null))));
        return out;
    }

    private Set<String> textsOf(ListAppender<ILoggingEvent> appender) {
        Set<String> out = new TreeSet<>();
        for (ILoggingEvent event : appender.list) {
            out.add(event.getFormattedMessage());
            if (event.getThrowableProxy() != null) {
                out.add(ThrowableProxyUtil.asString(event.getThrowableProxy()));
            }
        }
        return out;
    }

    // ================================================================== 1. schema and seed

    @Test
    @Order(1)
    void schemaOfV735AndSeed() {
        note("== 1 schema");
        assertEquals(1, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version = '735' AND "
                + "script = 'V735__Commerce_accounts_foundation.sql'"), "V735 is applied");
        assertEquals(0, count("SELECT count(*) FROM flyway_schema_history WHERE NOT success"),
                "no failed migration in the Flyway history");
        note("flyway: V735 success, latest " + text("SELECT max(version::int)::text FROM flyway_schema_history "
                + "WHERE version ~ '^[0-9]+$'") + ", failed rows 0");
        for (String table : List.of("commerce_staff_scope", "commerce_account_head", "commerce_supplier",
                "commerce_supplier_secret", "commerce_supplier_ledger", "commerce_period_lock")) {
            assertNotNull(text("SELECT to_regclass(?)::text", "public." + table), table);
        }
        List<String> constraints = List.of("uq_commerce_staff_scope", "uq_commerce_account_head_code",
                "ck_commerce_account_head_code", "ck_commerce_account_head_nature", "ck_commerce_account_head_kind",
                "ck_commerce_account_head_itc", "ck_commerce_account_head_hsn", "ck_commerce_account_head_status",
                "ck_commerce_account_head_parent", "uq_commerce_supplier_code", "uq_commerce_supplier_client_request",
                "ck_commerce_supplier_registration", "ck_commerce_supplier_gstin", "ck_commerce_supplier_status",
                "ck_commerce_supplier_terms", "uq_commerce_supplier_secret_supplier",
                "ck_commerce_supplier_secret_prefix", "uq_commerce_supplier_ledger_key",
                "ck_commerce_supplier_ledger_type", "ck_commerce_supplier_ledger_amount",
                "ck_commerce_supplier_ledger_reverses", "uq_commerce_period_lock", "fk_stock_receipt_supplier");
        for (String name : constraints) {
            assertEquals(1, count("SELECT count(*) FROM pg_constraint WHERE conname = ?", name), name);
        }
        for (String index : List.of("uq_commerce_supplier_external_ref", "idx_commerce_supplier_status_name",
                "idx_commerce_supplier_secret_hash", "idx_commerce_supplier_ledger_supplier",
                "idx_commerce_account_head_list")) {
            assertEquals(1, count("SELECT count(*) FROM pg_indexes WHERE indexname = ?", index), index);
        }
        note(constraints.size() + " constraint names present (incl. fk_stock_receipt_supplier), 5 indexes present");

        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', "
                + "'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), "
                + "('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        institute(inst, "Accounts Proof " + run, true, true);
        institute(offInst, "Accounts Off " + run, true, false);
        institute(otherInst, "Other Proof " + run, false, false);
        l1 = location(inst, "L1");
        item = item(inst);
        assign(inst, managerId, l1);
        assign(inst, limitedAcId, l1);
        assign(inst, limitedMId, l1);
        assign(inst, warehouseId, l1);
        assign(inst, cashierId, l1);
        offL1 = location(offInst, "OFF");
        offItem = item(offInst);
        assertTrue(capabilityResolver.isFeatureGranted(inst, "commerce.accounts"), "accounts on for inst");
        assertFalse(capabilityResolver.isFeatureGranted(offInst, "commerce.accounts"),
                "module row alone leaves accounts off");
        assertTrue(capabilityResolver.isFeatureGranted(offInst, "commerce.stock"), "stock is on for offInst");
    }

    // ================================================================== 2. default off

    @Test
    @Order(2)
    void featureOffByDefaultAndTheLockDormant() {
        note("== 2 default off");
        header(offInst);
        CustomUserDetails offAdmin = user("offadmin-" + run, "ADMIN");
        int refused = 0;
        for (Route route : routes("no-such-supplier", "no-such-head")) {
            if (!route.accountsOnly()) {
                continue;
            }
            assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, code(() -> route.call().accept(offAdmin, offInst)),
                    route.name() + " for an institute without accounts");
            refused++;
        }
        note(refused + " accounts routes -> FEATURE_DISABLED for ADMIN of the module-only institute");

        LocalDate today = stockClock.today(offInst);
        String first = receive(offAdmin, offInst, receiptRequest(offL1, offItem, "OTHER", null, today.minusDays(20)));
        assertNotNull(first);
        assertEquals(0, count("SELECT count(*) FROM commerce_period_lock WHERE institute_id = ?", offInst),
                "assertOpen creates no lock row while the feature is off");
        db.update("INSERT INTO commerce_period_lock (id, institute_id, locked_through) VALUES (?, ?, ?)",
                UUID.randomUUID().toString(), offInst, today.minusDays(5));
        String second = receive(offAdmin, offInst, receiptRequest(offL1, offItem, "OTHER", null, today.minusDays(10)));
        assertNotNull(second, "a receipt dated inside a hand-made lock posts while the feature is off (dormant)");
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, code(() -> receive(offAdmin, offInst,
                receiptRequest(offL1, offItem, "SUPPLIER", UUID.randomUUID().toString(), today))),
                "a SUPPLIER receipt needs the accounts feature, as before");
        note("receipt dated " + today.minusDays(10) + " posted under a hand-made lock through " + today.minusDays(5)
                + " (dormant); no lock row created by assertOpen; SUPPLIER receipt FEATURE_DISABLED");
        header(inst);
    }

    // ================================================================== 3. heads

    @Test
    @Order(3)
    void starterHeadsSeedOnceAlsoUnderConcurrency() throws Exception {
        note("== 3 heads");
        List<HeadView> first = body(heads.list(manager, inst, null, null));
        assertEquals(25, first.size(), "25 starter heads");
        assertEquals(7, first.stream().filter(h -> Boolean.TRUE.equals(h.getIsSystem())).count(), "7 system heads");
        assertTrue(first.stream().allMatch(h -> h.getNameI18n().get("hi") != null && !h.getNameI18n().get("hi").isBlank()),
                "every starter head has a Hindi name");
        assertEquals("किराया", first.stream().filter(h -> "RENT".equals(h.getCode())).findFirst().orElseThrow()
                .getNameI18n().get("hi"));
        long seeds = count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = 'ACCOUNT_HEADS_SEED'",
                inst);
        assertEquals(1, seeds);
        assertEquals(25, body(heads.list(limitedAc, inst, null, null)).size());
        assertEquals(25, count("SELECT count(*) FROM commerce_account_head WHERE institute_id = ?", inst),
                "a second GET inserts nothing");
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = "
                + "'ACCOUNT_HEADS_SEED'", inst), "and writes no second seed audit");
        rentHead = first.stream().filter(h -> "RENT".equals(h.getCode())).findFirst().orElseThrow().getId();

        String headsInst = UUID.randomUUID().toString();
        institute(headsInst, "Heads Proof " + run, true, true);
        CustomUserDetails headsAdmin = user("hadmin-" + run, "ADMIN");
        List<Object> answers = together(5, headsInst, i -> body(heads.list(headsAdmin, headsInst, null, null)));
        for (Object answer : answers) {
            assertTrue(answer instanceof List<?> list && list.size() == 25, "each concurrent first GET: " + answer);
        }
        assertEquals(25, count("SELECT count(*) FROM commerce_account_head WHERE institute_id = ?", headsInst),
                "5 concurrent first GETs insert each starter head once");
        assertEquals(25, count("SELECT COALESCE(SUM((new_value_json->>'inserted')::int), 0) FROM commerce_audit "
                + "WHERE institute_id = ? AND kind = 'ACCOUNT_HEADS_SEED'", headsInst), "seed audits add up to 25");

        HeadView system = first.stream().filter(h -> Boolean.TRUE.equals(h.getIsSystem())).findFirst().orElseThrow();
        HeadRequest change = new HeadRequest();
        change.setNameI18n(system.getNameI18n());
        change.setNature("INCOME".equals(system.getNature()) ? "EXPENSE" : "INCOME");
        assertEquals("SYSTEM_HEAD", code(() -> heads.update(admin, inst, system.getId(), change)),
                "a system head's nature cannot change");
        note("25 heads (7 system, Hindi names), second GET no insert, 5 concurrent first GETs -> 25, system "
                + system.getCode() + " nature change -> SYSTEM_HEAD");
    }

    // ================================================================== 4. suppliers and cipher

    @Test
    @Order(4)
    void suppliersAndThePanCipher() throws Exception {
        note("== 4 suppliers and cipher");
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        Logger app = (Logger) LoggerFactory.getLogger("vacademy.io");
        Level appLevel = app.getLevel();
        ListAppender<ILoggingEvent> logs = new ListAppender<>();
        logs.start();
        root.addAppender(logs);
        app.setLevel(Level.DEBUG);
        try {
            suppliersAndCipherSteps();
        } finally {
            root.detachAppender(logs);
            app.setLevel(appLevel);
        }
        Set<String> lines = textsOf(logs);
        for (String value : List.of(panValue, panValue2)) {
            for (String line : lines) {
                assertFalse(line.contains(value), "a log line holds a PAN: " + line);
            }
        }
        note("log capture (root appender, vacademy.io at DEBUG): " + logs.list.size() + " events, none holds a PAN");
    }

    private void suppliersAndCipherSteps() throws Exception {
        // A registered supplier with a GSTIN the test computed (no PAN stored).
        String regularPan = pan("TSTPR", 4321, 'K');
        String goodGstin = gstin("09", regularPan);
        SupplierView regular = body(suppliers.create(manager, inst, supplierRequest("Test Supplier One", goodGstin, null)));
        regularSupplier = regular.getId();
        assertEquals("REGULAR", regular.getRegistrationType());
        assertEquals("09", regular.getStateCode());
        assertTrue(regular.getCode().startsWith("S-"), regular.getCode());

        String wrong = withWrongCheck(gstin("09", pan("TSTPW", 5678, 'L')));
        assertTrue(IndianStates.isValidGstin(wrong), "the credits flow still accepts the wrong check character");
        assertEquals("INVALID_GSTIN", code(() -> suppliers.create(manager, inst,
                supplierRequest("Sample Traders", wrong, null))), "commerce refuses it");
        note("REGULAR supplier " + regular.getCode() + " saved; wrong check character -> INVALID_GSTIN, "
                + "IndianStates.isValidGstin = true");

        // Double tap: one key, two threads, one row.
        SupplierRequest tap = supplierRequest("Sample Traders", null, null);
        long before = count("SELECT count(*) FROM commerce_supplier WHERE institute_id = ?", inst);
        List<Object> taps = together(2, inst, i -> body(suppliers.create(manager, inst, tap)));
        assertTrue(taps.get(0) instanceof SupplierView && taps.get(1) instanceof SupplierView, "both taps answered: "
                + taps);
        assertEquals(((SupplierView) taps.get(0)).getId(), ((SupplierView) taps.get(1)).getId());
        assertEquals(before + 1, count("SELECT count(*) FROM commerce_supplier WHERE institute_id = ?", inst),
                "a double tap writes one supplier");
        ledgerSupplier = ((SupplierView) taps.get(0)).getId();

        // A PAN write with no key: 503 and nothing written; a supplier without PAN still saves; removing needs no key.
        doReturn(false).when(cipher).isConfigured();
        long suppliersBefore = count("SELECT count(*) FROM commerce_supplier WHERE institute_id = ?", inst);
        long auditsBefore = count("SELECT count(*) FROM commerce_audit WHERE institute_id = ?", inst);
        assertEquals("ENCRYPTION_NOT_CONFIGURED", code(() -> suppliers.create(manager, inst,
                supplierRequest("Test Worker", null, pan("TSTPN", 1111, 'N')))));
        assertEquals(suppliersBefore, count("SELECT count(*) FROM commerce_supplier WHERE institute_id = ?", inst),
                "no supplier row after a 503");
        assertEquals(auditsBefore, count("SELECT count(*) FROM commerce_audit WHERE institute_id = ?", inst),
                "no audit row after a 503");
        String plain = body(suppliers.create(manager, inst, supplierRequest("Test Worker", null, null))).getId();
        assertNotNull(plain, "a supplier without a PAN saves while no key is set");
        reset(cipher);
        assertTrue(cipher.isConfigured(), "the test key is configured again");
        note("no key: PAN create -> 503 ENCRYPTION_NOT_CONFIGURED, 0 rows written; supplier without PAN saved");

        // PAN of an unregistered party, encrypted at rest.
        panValue = pan("TSTPA", 1234, 'F');
        SupplierView worker = body(suppliers.create(manager, inst, supplierRequest("Test Worker One", null, panValue)));
        panSupplier = worker.getId();
        assertEquals("******234F", worker.getPanMasked());
        assertTrue(worker.isHasPan());
        String stored = text("SELECT pan_encrypted FROM commerce_supplier_secret WHERE supplier_id = ?", panSupplier);
        assertTrue(stored.startsWith("cfc1:t1:"), "stored form: " + stored.substring(0, 8));
        assertEquals("t1", text("SELECT key_id FROM commerce_supplier_secret WHERE supplier_id = ?", panSupplier));
        assertEquals("234F", text("SELECT pan_last4 FROM commerce_supplier_secret WHERE supplier_id = ?", panSupplier));

        // A registered supplier whose PAN differs from the one inside its GSTIN.
        panValue2 = pan("TSTPB", 2468, 'G');
        SupplierView registered = body(suppliers.create(manager, inst,
                supplierRequest("Sample Traders Two", gstin("09", pan("TSTPC", 1357, 'H')), panValue2)));
        panSupplier2 = registered.getId();
        assertTrue(registered.getWarnings() != null && registered.getWarnings().stream()
                .anyMatch(w -> "PAN_DIFFERS_FROM_GSTIN".equals(w.getCode())), "warning PAN_DIFFERS_FROM_GSTIN");

        // Invalid PAN: 422 without the value.
        String badPan = "TSTPQ12345";
        String badMessage = message(() -> suppliers.create(manager, inst, supplierRequest("Test Worker Two", null, badPan)));
        assertTrue(badMessage.startsWith("INVALID_PAN"), badMessage);
        assertFalse(badMessage.contains(badPan), "the refusal does not echo the value");

        // Removing a PAN needs no key.
        String removable = body(suppliers.create(manager, inst,
                supplierRequest("Test Worker Three", null, pan("TSTPR", 9753, 'J')))).getId();
        doReturn(false).when(cipher).isConfigured();
        SupplierRequest removal = supplierRequest("Test Worker Three", null, "");
        removal.setVersion(body(suppliers.get(manager, inst, removable)).getVersion());
        SupplierView removed = body(suppliers.update(manager, inst, removable, removal));
        assertFalse(removed.isHasPan(), "PAN removed without a key");
        assertEquals(0, count("SELECT count(*) FROM commerce_supplier_secret WHERE supplier_id = ?", removable));
        reset(cipher);

        // The PAN text is in no column of the supplier, secret, audit or request tables.
        for (String value : List.of(panValue, panValue2)) {
            String like = "%" + value + "%";
            assertEquals(0, count("SELECT count(*) FROM commerce_supplier_secret s WHERE s::text LIKE ?", like));
            assertEquals(0, count("SELECT count(*) FROM commerce_supplier s WHERE s::text LIKE ?", like));
            assertEquals(0, count("SELECT count(*) FROM commerce_audit a WHERE a::text LIKE ?", like));
            assertEquals(0, count("SELECT count(*) FROM commerce_request r WHERE r::text LIKE ?", like));
        }
        note("PAN stored as cfc1:t1:..., key_id t1, last4 234F; PAN text in 0 rows of commerce_supplier_secret, "
                + "commerce_supplier, commerce_audit, commerce_request (unregistered + registered-with-other-PAN)");

        // Lists, picker, detail and groups never touch the cipher.
        clearInvocations(cipher);
        Map<String, Object> wire = new LinkedHashMap<>();
        List<SupplierRow> rows = body(suppliers.list(manager, inst, null, null, null, false, 0, 50)).getContent();
        List<LookupRow> picked = body(suppliers.lookup(warehouse, inst, "Test"));
        SupplierView detail = body(suppliers.get(limitedAc, inst, panSupplier));
        List<String> groups = body(suppliers.groups(manager, inst));
        verify(cipher, never()).decrypt(anyString(), anyString());
        verify(cipher, never()).encrypt(anyString(), anyString());
        assertEquals("******234F", detail.getPanMasked());
        assertTrue(groups.containsAll(List.of("SUPPLIER", "SERVICE_PROVIDER", "OTHER")));
        wire.put("rows", rows);
        wire.put("picked", picked);
        wire.put("detail", detail);
        String json = new com.fasterxml.jackson.databind.ObjectMapper().findAndRegisterModules().writeValueAsString(wire);
        assertFalse(json.contains(panValue), "no answer of list, picker or detail holds the PAN");
        assertFalse(json.contains("\"pan\""), "no pan key on the wire");
        note("list (" + rows.size() + " rows), lookup (" + picked.size() + "), detail, groups: cipher never called, "
                + "no PAN on the wire");

        // Reveal by an institute-wide accountant.
        CommerceStaffController.StaffScopeRequest scope = new CommerceStaffController.StaffScopeRequest();
        scope.setUserId(wideAcId);
        scope.setAllLocations(true);
        staff.setScope(admin, inst, scope);
        SensitiveRequest field = new SensitiveRequest();
        field.setField("pan");
        ResponseEntity<Map<String, Object>> revealed = suppliers.sensitive(wideAc, inst, panSupplier, field);
        assertEquals(panValue, revealed.getBody().get("pan"));
        assertEquals("no-store", revealed.getHeaders().getCacheControl());
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = "
                + "'SUPPLIER_SENSITIVE_VIEW' AND reference_id = ?", inst, panSupplier));
        String viewJson = text("SELECT new_value_json::text FROM commerce_audit WHERE institute_id = ? AND kind = "
                + "'SUPPLIER_SENSITIVE_VIEW' AND reference_id = ?", inst, panSupplier);
        assertFalse(viewJson.contains(panValue), viewJson);
        assertTrue(viewJson.contains("234F"), viewJson);
        assertEquals(0, count("SELECT count(*) FROM commerce_audit a WHERE a::text LIKE ?", "%" + panValue + "%"));

        Map<String, Object> status = body(accountsMe.encryptionStatus(admin, inst));
        assertEquals(true, status.get("configured"));
        assertEquals("t1", status.get("active_key_id"));
        assertEquals(true, status.get("round_trip_ok"));
        long secrets = count("SELECT count(*) FROM commerce_supplier_secret WHERE institute_id = ?", inst);
        assertEquals(Map.of("t1", secrets), status.get("rows_by_key_id"));
        note("reveal by wide Ac -> PAN, Cache-Control no-store, one SUPPLIER_SENSITIVE_VIEW row without the PAN; "
                + "encryption-status " + status);
    }

    // ================================================================== 5. receipts name a supplier

    @Test
    @Order(5)
    void goodsReceiptsNameASupplierOfTheInstitute() {
        note("== 5 receipts");
        LocalDate today = stockClock.today(inst);
        postedReceipt = receive(manager, inst, receiptRequest(l1, item, "SUPPLIER", regularSupplier, today));
        assertEquals("UNBILLED", text("SELECT bill_status FROM stock_receipt WHERE id = ?", postedReceipt));
        assertEquals(regularSupplier, text("SELECT supplier_id FROM stock_receipt WHERE id = ?", postedReceipt));

        String inactive = supplierOf(inst, "Test Supplier Inactive");
        StatusRequest off = new StatusRequest();
        off.setStatus("INACTIVE");
        off.setReason("Proof");
        body(suppliers.setStatus(manager, inst, inactive, off));
        assertEquals("SUPPLIER_NOT_FOUND", code(() -> receive(manager, inst,
                receiptRequest(l1, item, "SUPPLIER", inactive, today))), "an INACTIVE supplier takes no receipt");
        String unknown = UUID.randomUUID().toString();
        assertEquals("SUPPLIER_NOT_FOUND", code(() -> receive(manager, inst,
                receiptRequest(l1, item, "SUPPLIER", unknown, today))));
        DataIntegrityViolationException fk = assertThrows(DataIntegrityViolationException.class, () -> db.update(
                "INSERT INTO stock_receipt (id, institute_id, receipt_number, location_id, source_kind, supplier_id, "
                        + "received_date, bill_status) VALUES (?, ?, ?, ?, 'SUPPLIER', ?, ?, 'UNBILLED')",
                UUID.randomUUID().toString(), inst, "RAW-" + run, l1, unknown, today));
        assertTrue(String.valueOf(fk.getMessage()).contains("fk_stock_receipt_supplier"), fk.getMessage());
        note("SUPPLIER receipt posted (UNBILLED); INACTIVE and unknown supplier -> SUPPLIER_NOT_FOUND; raw INSERT "
                + "with an unknown supplier_id -> fk_stock_receipt_supplier");
    }

    // ================================================================== 6. ledger

    @Test
    @Order(6)
    void ledgerOneKeyOneRow() throws Exception {
        note("== 6 ledger");
        LocalDate today = stockClock.today(inst);
        String keyA = "OPENING:a-" + run;
        SupplierLedgerResult first = tx().execute(s -> ledger.post(post(inst, ledgerSupplier, today.minusDays(30),
                SupplierLedgerType.OPENING, "1000.00", null, keyA)));
        assertTrue(first.created());
        SupplierLedgerResult again = tx().execute(s -> ledger.post(post(inst, ledgerSupplier, today.minusDays(30),
                SupplierLedgerType.OPENING, "1000.00", null, keyA)));
        assertFalse(again.created());
        assertEquals(first.entry().getId(), again.entry().getId());
        assertEquals(1, count("SELECT count(*) FROM commerce_supplier_ledger WHERE institute_id = ? AND "
                + "idempotency_key = ?", inst, keyA));
        assertEquals("IDEMPOTENCY_KEY_REUSED", code(() -> tx().execute(s -> ledger.post(post(inst, ledgerSupplier,
                today.minusDays(30), SupplierLedgerType.OPENING, "-1000.00", null, keyA)))));
        assertThrows(org.springframework.transaction.IllegalTransactionStateException.class,
                () -> ledger.post(post(inst, ledgerSupplier, today, SupplierLedgerType.OPENING, "1.00", null,
                        "OPENING:none-" + run)), "MANDATORY: no post outside a transaction");

        // 20 threads, one key, each in its own transaction.
        String keyB = "OPENING:b-" + run;
        List<Object> answers = together(20, inst, i -> tx().execute(s -> ledger.post(post(inst, ledgerSupplier,
                today.minusDays(20), SupplierLedgerType.OPENING, "500.00", null, keyB))));
        Set<String> ids = new TreeSet<>();
        int created = 0;
        for (Object answer : answers) {
            assertTrue(answer instanceof SupplierLedgerResult, "every thread answered: " + answer);
            ids.add(((SupplierLedgerResult) answer).entry().getId());
            created += ((SupplierLedgerResult) answer).created() ? 1 : 0;
        }
        assertEquals(1, ids.size(), "every thread gets the one row's id");
        assertEquals(1, created, "exactly one thread wrote it");
        assertEquals(1, count("SELECT count(*) FROM commerce_supplier_ledger WHERE institute_id = ? AND "
                + "idempotency_key = ?", inst, keyB));
        note("20 threads x key " + keyB + " -> 1 row, 1 created, 20 answers with id " + ids.iterator().next());

        // Rolled back with its transaction: nothing stays, the key is free again.
        String keyC = "OPENING:c-" + run;
        assertThrows(IllegalStateException.class, () -> tx().execute(s -> {
            ledger.post(post(inst, ledgerSupplier, today.minusDays(10), SupplierLedgerType.OPENING, "200.00", null, keyC));
            throw new IllegalStateException("the document failed");
        }));
        assertEquals(0, count("SELECT count(*) FROM commerce_supplier_ledger WHERE institute_id = ? AND "
                + "idempotency_key = ?", inst, keyC));
        assertTrue(tx().execute(s -> ledger.post(post(inst, ledgerSupplier, today.minusDays(10),
                SupplierLedgerType.OPENING, "200.00", null, keyC))).created(), "the key is usable after a rollback");

        // Reversals.
        SupplierLedgerResult bill = tx().execute(s -> ledger.post(post(inst, ledgerSupplier, today.minusDays(5),
                SupplierLedgerType.BILL, "300.00", null, "BILL:x-" + run + ":r1")));
        tx().execute(s -> ledger.post(post(inst, ledgerSupplier, today.minusDays(4), SupplierLedgerType.BILL, "-100.00",
                bill.entry().getId(), "BILL:x-" + run + ":v1")));
        assertEquals("INVALID_REVERSAL", code(() -> tx().execute(s -> ledger.post(post(inst, ledgerSupplier,
                today.minusDays(4), SupplierLedgerType.BILL, "-250.00", bill.entry().getId(), "BILL:x-" + run + ":v2")))));
        assertEquals("VALIDATION", code(() -> tx().execute(s -> ledger.post(post(inst, ledgerSupplier,
                today, SupplierLedgerType.PAYMENT, "50.00", null, "PAY:p-" + run)))), "PAYMENT must be negative");

        BigDecimal sum = db.queryForObject("SELECT SUM(amount) FROM commerce_supplier_ledger WHERE institute_id = ? AND "
                + "supplier_id = ?", BigDecimal.class, inst, ledgerSupplier);
        same("1900.00", sum, "1000 + 500 + 200 + 300 - 100");
        SupplierRow row = body(suppliers.list(manager, inst, "Sample Traders", null, null, false, 0, 50)).getContent()
                .stream().filter(r -> r.getId().equals(ledgerSupplier)).findFirst().orElseThrow();
        same(sum.toPlainString(), new BigDecimal(row.getBalance()), "list balance = sum of amounts");
        assertTrue(body(suppliers.list(manager, inst, null, null, null, true, 0, 50)).getContent().stream()
                .anyMatch(r -> r.getId().equals(ledgerSupplier)), "hasDue lists the supplier");

        StatementView statement = body(statements.statement(manager, inst, ledgerSupplier, today.minusDays(15), today));
        BigDecimal opening = db.queryForObject("SELECT COALESCE(SUM(amount), 0) FROM commerce_supplier_ledger WHERE "
                + "institute_id = ? AND supplier_id = ? AND book_date < ?", BigDecimal.class, inst, ledgerSupplier,
                today.minusDays(15));
        same(opening.toPlainString(), new BigDecimal(statement.getOpening()), "statement opening");
        same("1500.00", new BigDecimal(statement.getOpening()), "1000 + 500 before the range");
        assertEquals(3, statement.getRows().size());
        same(sum.toPlainString(), new BigDecimal(statement.getClosing()), "statement closing");
        same(statement.getClosing(), new BigDecimal(statement.getRows().get(2).getRunningBalance()), "running balance");
        note("ledger sum 1900.00 = list balance; statement opening 1500.00, 3 rows, closing 1900.00");
    }

    // ================================================================== 7. post against lock

    /** One lock-capable institute with a location, an item, a supplier and a wide manager. */
    private record RaceShop(String inst, String location, String item, String supplier, CustomUserDetails wideManager) {
    }

    private RaceShop raceShop(String label) {
        String id = UUID.randomUUID().toString();
        institute(id, label + " " + run, true, true);
        String location = location(id, "R");
        String variant = item(id);
        String supplier = supplierOf(id, "Test Supplier One");
        String managerOfShop = "rm-" + id.substring(0, 8);
        rolesById.put(managerOfShop, "COMMERCE_STORE_MANAGER");
        assign(id, managerOfShop, location);
        db.update("INSERT INTO commerce_staff_scope (id, institute_id, user_id, all_locations, set_by) VALUES (?, ?, ?, "
                + "true, ?)", UUID.randomUUID().toString(), id, managerOfShop, adminId);
        return new RaceShop(id, location, variant, supplier, user(managerOfShop, "COMMERCE_STORE_MANAGER"));
    }

    @Test
    @Order(71)
    void aPostAndALockNeverLeaveADocumentInAClosedPeriod() throws Exception {
        note("== 7a 200 iterations: SUPPLIER receipt dated D_i vs lock through D_i");
        RaceShop shop = raceShop("Race Shop");
        LocalDate today = stockClock.today(shop.inst());
        int successes = 0;
        int refused = 0;
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int i = 0; i < 200; i++) {
                LocalDate day = today.minusDays(400 - i);
                ReceiptRequest receipt = receiptRequest(shop.location(), shop.item(), "SUPPLIER", shop.supplier(), day);
                PeriodLockRequest lock = lockRequest(day, "Month closed", null);
                int offset = jitter.nextInt(-20, 61);
                Object[] outcome = race(shop.inst(),
                        () -> receive(shop.wideManager(), shop.inst(), receipt),
                        () -> body(periodLocks.change(shop.wideManager(), shop.inst(), lock)), pool, offset);
                assertTrue(outcome[1] instanceof PeriodLockView, "iteration " + i + ": the lock went through: "
                        + outcome[1]);
                PeriodLockView view = (PeriodLockView) outcome[1];
                assertEquals("LOCK", view.getDirection());
                boolean posted = !(outcome[0] instanceof Throwable);
                if (posted) {
                    successes++;
                } else {
                    refused++;
                    assertEquals("PERIOD_LOCKED", codeOf((Throwable) outcome[0]), "iteration " + i + ": "
                            + outcome[0]);
                }
                assertEquals(successes, previewCount(view, "UNBILLED_RECEIPTS"), "iteration " + i + " (posted="
                        + posted + "): the lock's preview saw every receipt committed before it");
                assertEquals(successes, auditPreviewCount(shop.inst(), day, "UNBILLED_RECEIPTS"),
                        "iteration " + i + ": the PERIOD_LOCK audit row holds the same count");
            }
        } finally {
            pool.shutdownNow();
        }
        header(shop.inst());
        LocalDate last = today.minusDays(201);
        assertEquals(last, body(periodLocks.read(shop.wideManager(), shop.inst())).getLockedThrough());
        assertEquals(successes, count("SELECT count(*) FROM stock_receipt WHERE institute_id = ? AND received_date <= ?",
                shop.inst(), last), "every receipt dated inside the closed period committed before its lock");
        assertEquals(200, count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = 'PERIOD_LOCK'",
                shop.inst()));
        note("200 iterations: receipt first " + successes + ", lock first (PERIOD_LOCKED) " + refused
                + "; invariant held every time; receipts dated <= " + last + " = " + successes);

        // After locking: create and reverse with closed dates are refused and name the first open date.
        String closedCreate = message(() -> receive(shop.wideManager(), shop.inst(), receiptRequest(shop.location(),
                shop.item(), "SUPPLIER", shop.supplier(), last)));
        assertTrue(closedCreate.startsWith("PERIOD_LOCKED"), closedCreate);
        assertTrue(closedCreate.contains(last.plusDays(1).toString()), closedCreate);
        String inside = text("SELECT id FROM stock_receipt WHERE institute_id = ? AND received_date <= ? LIMIT 1",
                shop.inst(), last);
        if (inside != null) {
            ReceiptActionRequest reverse = new ReceiptActionRequest();
            reverse.setReason("Wrong receipt");
            String closedReverse = message(() -> receipts.reverse(shop.wideManager(), shop.inst(), inside, reverse));
            assertTrue(closedReverse.startsWith("PERIOD_LOCKED"), closedReverse);
            assertTrue(closedReverse.contains(last.plusDays(1).toString()), closedReverse);
        }
        header(inst);
        note("after the lock: receipt create and reverse dated in the closed period -> PERIOD_LOCKED naming "
                + last.plusDays(1) + (inside == null ? " (no receipt inside to reverse)" : ""));
    }

    @Test
    @Order(72)
    void firstEverPostAgainstFirstEverLock() throws Exception {
        note("== 7b 20 fresh institutes: first-ever post vs first-ever lock");
        int postedFirst = 0;
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int i = 0; i < 20; i++) {
                RaceShop shop = raceShop("Fresh Shop " + i);
                assertEquals(0, count("SELECT count(*) FROM commerce_period_lock WHERE institute_id = ?", shop.inst()));
                LocalDate day = stockClock.today(shop.inst()).minusDays(10);
                ReceiptRequest receipt = receiptRequest(shop.location(), shop.item(), "SUPPLIER", shop.supplier(), day);
                PeriodLockRequest lock = lockRequest(day, null, null);
                int offset = jitter.nextInt(-20, 61);
                Object[] outcome = race(shop.inst(),
                        () -> receive(shop.wideManager(), shop.inst(), receipt),
                        () -> body(periodLocks.change(shop.wideManager(), shop.inst(), lock)), pool, offset);
                assertTrue(outcome[1] instanceof PeriodLockView, "institute " + i + ": " + outcome[1]);
                boolean posted = !(outcome[0] instanceof Throwable);
                if (!posted) {
                    assertEquals("PERIOD_LOCKED", codeOf((Throwable) outcome[0]), "institute " + i + ": " + outcome[0]);
                } else {
                    postedFirst++;
                }
                assertEquals(posted ? 1 : 0, previewCount((PeriodLockView) outcome[1], "UNBILLED_RECEIPTS"),
                        "institute " + i + " (posted=" + posted + ")");
                assertEquals(1, count("SELECT count(*) FROM commerce_period_lock WHERE institute_id = ?", shop.inst()),
                        "one lock row");
                assertEquals(posted ? 1 : 0, count("SELECT count(*) FROM stock_receipt WHERE institute_id = ? AND "
                        + "received_date <= ?", shop.inst(), day));
            }
        } finally {
            pool.shutdownNow();
        }
        note("20 fresh institutes: receipt first " + postedFirst + ", lock first " + (20 - postedFirst)
                + "; invariant held; one lock row each");
    }

    @Test
    @Order(73)
    void firstBackDatedPostsOfAnInstituteQueueOnTheLockRow() throws Exception {
        note("== 7c 10 fresh institutes: 3 first back-dated receipts and 1 first lock at the same moment");
        int deadlocks = 0;
        int posted = 0;
        int refused = 0;
        Map<String, Integer> others = new TreeMap<>();
        for (int i = 0; i < 10; i++) {
            RaceShop shop = raceShop("Queue Shop " + i);
            LocalDate day = stockClock.today(shop.inst()).minusDays(7);
            int lockDelay = jitter.nextInt(0, 61);
            List<Object> answers = together(4, shop.inst(), t -> {
                pause(t < 3 ? 0 : lockDelay);
                return t < 3
                        ? receive(shop.wideManager(), shop.inst(), receiptRequest(shop.location(), shop.item(),
                                "SUPPLIER", shop.supplier(), day))
                        : body(periodLocks.change(shop.wideManager(), shop.inst(), lockRequest(day, null, null)));
            });
            int ok = 0;
            for (int t = 0; t < 3; t++) {
                Object answer = answers.get(t);
                if (!(answer instanceof Throwable e)) {
                    ok++;
                } else if ("PERIOD_LOCKED".equals(codeOf(e))) {
                    refused++;
                } else if ("40P01".equals(sqlState(e))) {
                    deadlocks++;
                } else {
                    others.merge(e.getClass().getSimpleName() + "/" + sqlState(e) + "/" + codeOf(e), 1, Integer::sum);
                }
            }
            posted += ok;
            Object lockAnswer = answers.get(3);
            if (lockAnswer instanceof Throwable e) {
                others.merge("lock:" + e.getClass().getSimpleName() + "/" + sqlState(e) + "/" + codeOf(e), 1,
                        Integer::sum);
                continue;
            }
            assertEquals(ok, previewCount((PeriodLockView) lockAnswer, "UNBILLED_RECEIPTS"), "institute " + i);
            assertEquals(ok, count("SELECT count(*) FROM stock_receipt WHERE institute_id = ? AND received_date <= ?",
                    shop.inst(), day), "institute " + i + ": every committed receipt inside the period was seen");
            assertEquals(1, count("SELECT count(*) FROM commerce_period_lock WHERE institute_id = ?", shop.inst()));
        }
        note("30 first back-dated receipts: posted " + posted + ", PERIOD_LOCKED " + refused + ", deadlock (40P01) "
                + deadlocks + ", other " + others);
        assertTrue(others.isEmpty(), "no other failure: " + others);
    }

    @Test
    @Order(74)
    void ledgerPostAgainstLock() throws Exception {
        note("== 7d 50 iterations: assertOpen + ledger post vs lock");
        String ledgerInst = UUID.randomUUID().toString();
        institute(ledgerInst, "Ledger Race " + run, true, true);
        String supplier = supplierOf(ledgerInst, "Test Supplier One");
        ledgerRaceSupplier = supplier;
        ledgerRaceInstitute = ledgerInst;
        CustomUserDetails ledgerAdmin = user("ladmin-" + run, "ADMIN");
        LocalDate today = stockClock.today(ledgerInst);
        int successes = 0;
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int i = 0; i < 50; i++) {
                LocalDate day = today.minusDays(400 - i);
                String ledgerKey = "OPENING:race-" + i;
                PeriodLockRequest lock = lockRequest(day, null, null);
                Object[] outcome = race(ledgerInst,
                        () -> tx().execute(s -> {
                            periodLock.assertOpen(ledgerInst, day);
                            return ledger.post(post(ledgerInst, supplier, day, SupplierLedgerType.OPENING, "100.00",
                                    null, ledgerKey));
                        }),
                        () -> body(periodLocks.change(ledgerAdmin, ledgerInst, lock)), pool, jitter.nextInt(-40, 11));
                assertTrue(outcome[1] instanceof PeriodLockView, "iteration " + i + ": " + outcome[1]);
                boolean posted = !(outcome[0] instanceof Throwable);
                if (posted) {
                    successes++;
                } else {
                    assertEquals("PERIOD_LOCKED", codeOf((Throwable) outcome[0]), "iteration " + i + ": " + outcome[0]);
                }
                assertEquals(successes, previewCount((PeriodLockView) outcome[1], "TEST_LEDGER_ROWS"),
                        "iteration " + i + " (posted=" + posted + ")");
                assertEquals(successes, auditPreviewCount(ledgerInst, day, "TEST_LEDGER_ROWS"), "iteration " + i);
            }
        } finally {
            pool.shutdownNow();
            ledgerRaceInstitute = null;
        }
        assertEquals(successes, count("SELECT count(*) FROM commerce_supplier_ledger WHERE institute_id = ?", ledgerInst));
        note("50 iterations: ledger post first " + successes + ", lock first " + (50 - successes) + "; invariant held");
    }

    // ================================================================== 8. roles

    @Test
    @Order(80)
    void instituteWideRoles() {
        note("== 8 roles");
        LocalDate today = stockClock.today(inst);
        LocalDate lockDate = today.minusDays(60);
        // Limited accountant: reads, but no wide action.
        assertEquals(25, body(heads.list(limitedAc, inst, null, null)).size());
        assertFalse(body(suppliers.list(limitedAc, inst, null, null, null, false, 0, 20)).getContent().isEmpty());
        assertNotNull(body(periodLocks.read(limitedAc, inst)));
        String wideRequired = CommerceAccessDeniedException.INSTITUTE_WIDE_REQUIRED;
        assertEquals(wideRequired, code(() -> periodLocks.change(limitedAc, inst, lockRequest(lockDate, null, null))));
        assertEquals(wideRequired, code(() -> periodLocks.change(limitedAc, inst, lockRequest(null, "Reopen", null))));
        assertEquals(wideRequired, code(() -> periodLocks.preview(limitedAc, inst, lockDate)));
        HeadRequest newHead = new HeadRequest();
        newHead.setClientRequestId(key());
        newHead.setCode("RAW_MATERIAL");
        newHead.setNameI18n(Map.of("en", "Raw material", "hi", "कच्चा माल"));
        newHead.setNature("EXPENSE");
        newHead.setExpenseKind("DIRECT");
        assertEquals(wideRequired, code(() -> heads.create(limitedAc, inst, newHead)));
        HeadRequest rent = new HeadRequest();
        rent.setNameI18n(Map.of("en", "Shop rent", "hi", "दुकान किराया"));
        rent.setNature("EXPENSE");
        assertEquals(wideRequired, code(() -> heads.update(limitedAc, inst, rentHead, rent)));
        SensitiveRequest field = new SensitiveRequest();
        field.setField("pan");
        assertEquals(wideRequired, code(() -> suppliers.sensitive(limitedAc, inst, panSupplier, field)));
        note("limited Ac: reads heads/suppliers/lock; INSTITUTE_WIDE_REQUIRED on lock, unlock, preview, head "
                + "create/edit, reveal");

        // Wide accountant (scope set by the ADMIN in step 4): head edit, reveal, lock; never unlock.
        assertEquals(true, body(accountsMe.me(wideAc, inst)).get("institute_wide"));
        assertEquals(false, body(accountsMe.me(limitedAc, inst)).get("institute_wide"));
        HeadView created = body(heads.create(wideAc, inst, newHead));
        assertEquals("RAW_MATERIAL", created.getCode());
        assertEquals("Shop rent", body(heads.update(wideAc, inst, rentHead, rent)).getNameI18n().get("en"));
        assertEquals(panValue2,
                suppliers.sensitive(wideAc, inst, panSupplier2, field).getBody().get("pan"));
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = "
                + "'ACCOUNT_HEAD_EDIT' AND reference_id = ? AND old_value_json IS NULL", inst, created.getId()));
        PeriodLockView locked = body(periodLocks.change(wideAc, inst, lockRequest(lockDate, null, null)));
        assertEquals("LOCK", locked.getDirection());
        assertEquals(lockDate, locked.getLockedThrough());
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, code(() -> periodLocks.change(wideAc, inst,
                lockRequest(null, "Reopen the month", new Approval(wideAcId, PIN)))));
        note("wide Ac: head create/edit OK, reveal OK, lock through " + lockDate + " OK, unlock -> ROLE_NOT_ALLOWED");

        // Limited manager cannot unlock; wide manager unlocks with own PIN and a reason.
        assertEquals(wideRequired, code(() -> periodLocks.change(limitedM, inst,
                lockRequest(null, "Reopen the month", new Approval(limitedMId, PIN)))));
        CommerceStaffController.StaffScopeRequest scope = new CommerceStaffController.StaffScopeRequest();
        scope.setUserId(wideMId);
        scope.setAllLocations(true);
        assertEquals(true, body(staff.setScope(admin, inst, scope)).get("all_locations"));
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = 'STAFF_SCOPE_EDIT' "
                + "AND reference_id = ?", inst, wideMId));
        StaffPinRequest pinRequest = new StaffPinRequest();
        pinRequest.setPin(PIN);
        staff.setPin(wideM, inst, pinRequest);
        PeriodLockRequest unlock = lockRequest(null, "Reopen the month", new Approval(wideMId, WRONG_PIN));
        assertEquals(CommerceAccessDeniedException.PIN_INVALID, code(() -> periodLocks.change(wideM, inst, unlock)));
        assertEquals(lockDate, body(periodLocks.read(wideM, inst)).getLockedThrough(), "the date is unchanged");
        assertEquals(0, count("SELECT count(*) FROM commerce_approval WHERE institute_id = ? AND action = "
                + "'PERIOD_UNLOCK'", inst));
        unlock.setApproval(new Approval(wideMId, PIN));   // same client key: the PIN is not part of the request hash
        PeriodLockView open = body(periodLocks.change(wideM, inst, unlock));
        assertEquals("UNLOCK", open.getDirection());
        assertNull(open.getLockedThrough());
        assertEquals(1, count("SELECT count(*) FROM commerce_approval WHERE institute_id = ? AND action = "
                + "'PERIOD_UNLOCK' AND reference_type = 'PERIOD_LOCK' AND approved_by = ?", inst, wideMId));
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = 'PERIOD_UNLOCK'",
                inst));
        assertEquals(0, count("SELECT count(*) FROM commerce_request r WHERE r::text LIKE ?", "%" + PIN + "%"),
                "the PIN is in no request row");
        assertEquals(0, count("SELECT count(*) FROM commerce_audit a WHERE a::text LIKE ?", "%" + PIN + "%"),
                "nor in any audit row");
        note("limited M unlock -> INSTITUTE_WIDE_REQUIRED; wide M wrong PIN -> PIN_INVALID (date unchanged); own PIN "
                + "+ reason -> UNLOCK, one commerce_approval PERIOD_UNLOCK, one PERIOD_UNLOCK audit; PIN in no row");

        // A scope row on warehouse staff counts for nothing; scope is set by the ADMIN only.
        CommerceStaffController.StaffScopeRequest whScope = new CommerceStaffController.StaffScopeRequest();
        whScope.setUserId(warehouseId);
        whScope.setAllLocations(true);
        staff.setScope(admin, inst, whScope);
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, code(() -> periodLocks.preview(warehouse, inst,
                lockDate)));
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, code(() -> suppliers.sensitive(warehouse, inst,
                panSupplier, field)));
        assertEquals(false, body(accountsMe.me(warehouse, inst)).get("institute_wide"));
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, code(() -> staff.setScope(wideM, inst, scope)));

        // The PIN route opens under accounts alone (POS switched off).
        String pinInst = UUID.randomUUID().toString();
        institute(pinInst, "Pin Proof " + run, true, true);
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce.pos', false)",
                pinInst);
        capabilityResolver.evict(pinInst);
        assertFalse(capabilityResolver.isFeatureGranted(pinInst, "commerce.pos"));
        header(pinInst);
        CustomUserDetails pinManager = user("pm-" + run, "COMMERCE_STORE_MANAGER");
        staff.setPin(pinManager, pinInst, pinRequest);
        assertEquals(true, body(staff.pinStatus(pinManager, pinInst)).get("has_pin"));
        header(inst);
        note("scope row on W -> still ROLE_NOT_ALLOWED; PUT /staff/scope by wide M -> ROLE_NOT_ALLOWED; PUT /staff/pin "
                + "works under accounts with POS off");
    }

    // ================================================================== 9. gate 14

    @Test
    @Order(90)
    void gate14OutsidersAreRefusedEverywhere() {
        note("== 9 gate 14");
        List<Route> all = routes(panSupplier, rentHead);
        int checks = 0;
        for (Route route : all) {
            header(inst);
            assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, code(() -> route.call().accept(learner, inst)),
                    "learner on " + route.name());
            assertEquals(CommerceAccessDeniedException.ACCESS_DENIED, code(() -> route.call().accept(shopper, inst)),
                    "shopper on " + route.name());
            boolean openToAll = route.name().equals("GET /suppliers/lookup") || route.name().equals("GET /accounts/me");
            for (CustomUserDetails floor : List.of(warehouse, cashier)) {
                if (openToAll) {
                    route.call().accept(floor, inst);
                } else {
                    assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                            code(() -> route.call().accept(floor, inst)), floor.getUserId() + " on " + route.name());
                }
            }
            header(otherInst);
            assertEquals(CommerceAccessDeniedException.ACCESS_DENIED, code(() -> route.call().accept(otherAdmin, inst)),
                    "other institute's admin on " + route.name());
            assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED,
                    code(() -> route.call().accept(otherAdmin, otherInst)),
                    "other institute's admin under its own institute on " + route.name());
            checks += 6;
        }
        header(inst);
        note(all.size() + " routes x learner, shopper, W, C, other admin (both institutes): " + checks
                + " checks; W and C pass only GET /suppliers/lookup and GET /accounts/me");

        // An id of inst named under another institute that has accounts: never data.
        institute(otherInst, "Other Proof " + run, true, true);
        header(otherInst);
        String notFound = "NOT_FOUND";
        assertEquals(notFound, code(() -> suppliers.get(otherAdmin, otherInst, panSupplier)));
        assertEquals(notFound, code(() -> statements.statement(otherAdmin, otherInst, ledgerSupplier, null, null)));
        SensitiveRequest field = new SensitiveRequest();
        field.setField("pan");
        assertEquals(notFound, code(() -> suppliers.sensitive(otherAdmin, otherInst, panSupplier, field)));
        StatusRequest status = new StatusRequest();
        status.setStatus("INACTIVE");
        assertEquals(notFound, code(() -> suppliers.setStatus(otherAdmin, otherInst, panSupplier, status)));
        SupplierRequest edit = supplierRequest("Taken Over", null, null);
        edit.setVersion(0L);
        assertEquals(notFound, code(() -> suppliers.update(otherAdmin, otherInst, panSupplier, edit)));
        HeadRequest head = new HeadRequest();
        head.setNameI18n(Map.of("en", "Taken over"));
        head.setNature("EXPENSE");
        assertEquals(notFound, code(() -> heads.update(otherAdmin, otherInst, rentHead, head)));
        assertTrue(body(suppliers.list(otherAdmin, otherInst, null, null, null, false, 0, 50)).getContent().isEmpty());
        assertEquals("ACTIVE", text("SELECT status FROM commerce_supplier WHERE id = ?", panSupplier));
        header(inst);
        note("ids of inst under another accounts institute: supplier detail, statement, reveal, status, edit, head "
                + "edit -> NOT_FOUND; its list is empty; nothing changed");
    }

    // ================================================================== 10. entities

    @Test
    @Order(100)
    void everyEntityLoadsEveryColumn() {
        note("== 10 entity <-> DDL");
        Map<Class<?>, Long> loaded = new LinkedHashMap<>();
        tx().executeWithoutResult(s -> {
            for (Class<?> entity : List.of(CommerceStaffScope.class, CommerceAccountHead.class, CommerceSupplier.class,
                    CommerceSupplierSecret.class, CommerceSupplierLedgerEntry.class, CommercePeriodLock.class)) {
                List<?> rows = entityManager.createQuery("SELECT e FROM " + entity.getSimpleName()
                        + " e WHERE e.instituteId = :i", entity).setParameter("i", inst).getResultList();
                loaded.put(entity, (long) rows.size());
            }
        });
        for (Map.Entry<Class<?>, Long> entry : loaded.entrySet()) {
            String table = switch (entry.getKey().getSimpleName()) {
                case "CommerceStaffScope" -> "commerce_staff_scope";
                case "CommerceAccountHead" -> "commerce_account_head";
                case "CommerceSupplier" -> "commerce_supplier";
                case "CommerceSupplierSecret" -> "commerce_supplier_secret";
                case "CommerceSupplierLedgerEntry" -> "commerce_supplier_ledger";
                default -> "commerce_period_lock";
            };
            assertTrue(entry.getValue() > 0, table + " has rows of inst");
            assertEquals(count("SELECT count(*) FROM " + table + " WHERE institute_id = ?", inst), entry.getValue(),
                    table);
        }
        CommerceSupplier supplier = tx().execute(s -> entityManager.find(CommerceSupplier.class, panSupplier));
        assertEquals(text("SELECT search_text FROM commerce_supplier WHERE id = ?", panSupplier), supplier.getSearchText());
        note("every entity selects every mapped column of its table: " + loaded.values() + " rows of inst");
    }
}
