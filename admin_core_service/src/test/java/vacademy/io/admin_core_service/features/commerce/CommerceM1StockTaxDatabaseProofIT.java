package vacademy.io.admin_core_service.features.commerce;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.AdminCoreServiceApplication;
import vacademy.io.admin_core_service.features.auth_service.service.AsyncEnrollmentEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteLineDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteLineRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.pdf.CommerceDocumentPdfService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceCreditNoteService;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentGuard;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentNumberService;
import vacademy.io.admin_core_service.features.commerce.document.service.FinancialYear;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceInvoiceService;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentNumberAllocator;
import vacademy.io.admin_core_service.features.commerce.security.CommerceSetupAccess;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.stock.dto.AdjustmentRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockReceipt;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.scheduler.StockReconciliationJob;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockAdjustmentService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLocationService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPostResult;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockReceiptService;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CommerceTaxCalculator;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxClassRef;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineInput;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxRequest;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxClassDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxRateRuleDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxSettingDTO;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxClassService;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkAddCourseRequestDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkAddCourseResponseDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCourseBatchDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCourseInventoryConfigDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCourseItemDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCoursePaymentConfigDTO;
import vacademy.io.admin_core_service.features.course.service.BulkCourseService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.stock_hold.entity.StockHold;
import vacademy.io.admin_core_service.features.stock_hold.enums.StockHoldKind;
import vacademy.io.admin_core_service.features.stock_hold.repository.StockHoldRepository;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentDeletionService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentVoidService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.IntFunction;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Database-backed proof of the stock core (WP-03, WP-61) and of tax and documents (WP-04), on a
 * local Postgres with the real Flyway chain and the real Spring context. Same pattern as
 * {@link CommerceM1DatabaseProofIT}: skipped unless {@code COMMERCE_IT_PG_URL} names a database
 * on this machine, every outside URL pinned to a closed local port, no scheduled job running.
 *
 * <p>Unlike that test, {@code InvoiceService} is the real bean here, so the legacy invoice
 * generator is shown to leave a shop payment alone. The media service is a mock that keeps the
 * PDF bytes it is handed. Every tax rate, HSN code and slab limit below is a TEST placeholder.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CommerceM1StockTaxDatabaseProofIT {

    private static final String SELLER_GSTIN = "09AAACH7409R1ZZ";
    private static final String SELLER_STATE = "09";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        // 50 transactions wait on one series row at the same moment.
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "64");
    }

    @Autowired
    private JdbcTemplate db;
    @Autowired
    private PlatformTransactionManager transactionManager;
    @Autowired
    private CapabilityResolver capabilityResolver;
    @Autowired
    private CommerceProductService productService;
    @Autowired
    private BulkCourseService bulkCourseService;
    @Autowired
    private PackageSessionRepository packageSessionRepository;
    @Autowired
    private StockLocationService locationService;
    @Autowired
    private StockLedgerService ledger;
    @Autowired
    private StockReceiptService receiptService;
    @Autowired
    private StockAdjustmentService adjustmentService;
    @Autowired
    private StockReconciliationJob reconciliationJob;
    @Autowired
    private StockHoldService stockHoldService;
    @Autowired
    private CommerceTaxSettingService taxSettingService;
    @Autowired
    private CommerceTaxClassService taxClassService;
    @Autowired
    private CommerceDocumentSeriesService seriesService;
    @Autowired
    private CommerceInvoiceService commerceInvoiceService;
    @Autowired
    private CommerceCreditNoteService creditNoteService;
    @Autowired
    private CommerceDocumentPdfService pdfService;
    @Autowired
    private CommerceDocumentGuard documentGuard;
    @Autowired
    private CommerceSetupAccess setupAccess;
    @Autowired
    private DocumentClock documentClock;
    @Autowired
    private InvoiceService invoiceService;
    @Autowired
    private PaymentVoidService paymentVoidService;
    @Autowired
    private PaymentDeletionService paymentDeletionService;
    @Autowired
    private UserPlanService userPlanService;
    @Autowired
    private PaymentLogService paymentLogService;
    @Autowired
    private PaymentLogRepository paymentLogRepository;
    @Autowired
    private PaymentPlanRepository paymentPlanRepository;
    @Autowired
    private PaymentOptionRepository paymentOptionRepository;
    @Autowired
    private EnrollInviteRepository enrollInviteRepository;
    @Autowired
    private StockHoldRepository stockHoldRepository;
    @Autowired
    private InvoiceRepository invoiceRepository;
    @Autowired
    private CommerceDocumentNumberService numberService;

    // Outside services: mocked so nothing leaves this machine.
    @MockBean
    private AuthService authService;
    @MockBean
    private WorkflowTriggerService workflowTriggerService;
    @MockBean
    private PaymentNotificatonService paymentNotificatonService;
    @MockBean
    private DynamicNotificationService dynamicNotificationService;
    @MockBean
    private AsyncEnrollmentEmailService asyncEnrollmentEmailService;
    @MockBean
    private MediaService mediaService;

    private final String instA = UUID.randomUUID().toString();
    private final String run = instA.substring(0, 8);
    private final String actor = "admin-a-" + run;
    private final String buyer = "buyer-" + run;
    private CustomUserDetails adminA;

    private String wh;   // sells online
    private String shop; // counter only
    private String taxClassId;
    private String invoiceSeriesId;
    private String creditSeriesId;
    private String courseBatch;

    private VariantResponse costed;   // receipt, average, reversal
    private VariantResponse raced;    // last unit and repeated key
    private VariantResponse mixed;    // scripted mix and reconciliation
    private VariantResponse shipped;  // hold, sold, shipped

    private String invoiceId;         // the first commerce invoice (2 units)
    private String invoiceNumber;
    private String invoiceLogId;
    private TaxResult invoiceTax;

    /** PDF bytes the mocked media service was handed, by file name. */
    private final Map<String, byte[]> uploaded = new ConcurrentHashMap<>();

    private Path evidence;

    // ------------------------------------------------------------------ plumbing

    @BeforeAll
    void openEvidence() throws IOException {
        String path = System.getenv("COMMERCE_IT_EVIDENCE");
        evidence = Path.of(path != null && !path.isBlank() ? path : "target/commerce-m1-stock-tax-proof-evidence.txt");
        Files.writeString(evidence, "", StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
    }

    @AfterAll
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    /** Spring resets the mocks after every test, so their answers are set up each time. */
    @BeforeEach
    void outsideServicesAnswerLocally() throws IOException {
        when(authService.getUsersFromAuthServiceWithPasswordByUserId(anyString())).thenAnswer(call -> {
            UserDTO user = new UserDTO();
            user.setId(call.getArgument(0));
            user.setEmail(call.getArgument(0) + "@example.invalid");
            user.setFullName("Proof Buyer");
            return user;
        });
        when(mediaService.uploadFileV2(any(MultipartFile.class))).thenAnswer(call -> {
            MultipartFile file = call.getArgument(0);
            uploaded.put(file.getOriginalFilename(), file.getBytes());
            FileDetailsDTO details = new FileDetailsDTO();
            details.setId("file-" + file.getOriginalFilename());
            return details;
        });
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", instA);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private void note(String line) {
        try {
            Files.writeString(evidence, line + "\n", StandardOpenOption.APPEND);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private List<Map<String, Object>> sql(String title, String query, Object... args) {
        List<Map<String, Object>> rows = db.queryForList(query, args);
        note("-- " + title);
        note("   " + query.replaceAll("\\s+", " ").trim() + (args.length > 0 ? "   args=" + List.of(args) : ""));
        if (rows.isEmpty()) {
            note("   (0 rows)");
        }
        rows.forEach(row -> note("   " + row));
        return rows;
    }

    private long count(String query, Object... args) {
        Long n = db.queryForObject(query, Long.class, args);
        return n == null ? 0 : n;
    }

    private <T> T inTransaction(Supplier<T> work) {
        return new TransactionTemplate(transactionManager).execute(status -> work.get());
    }

    /** Runs {@code work} on {@code threads} real threads that start together; a throw is the result. */
    private List<Object> race(int threads, IntFunction<Object> work) {
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CyclicBarrier gate = new CyclicBarrier(threads);
        try {
            List<Future<Object>> futures = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                int index = i;
                futures.add(pool.submit(() -> {
                    gate.await(30, TimeUnit.SECONDS);
                    try {
                        return work.apply(index);
                    } catch (Throwable t) {
                        return t;
                    }
                }));
            }
            List<Object> results = new ArrayList<>();
            for (Future<Object> future : futures) {
                results.add(future.get(180, TimeUnit.SECONDS));
            }
            return results;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        } finally {
            pool.shutdownNow();
        }
    }

    private VariantResponse product(String code, String price, String status) {
        ProductRequest request = ProductRequest.builder().externalRef("ext-" + code + "-" + run)
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name(code + " " + run).build()))
                .taxClassId(taxClassId).status(status)
                .variants(List.of(VariantRequest.builder().sku(code + "-" + run).name("One size")
                        .price(new BigDecimal(price)).build()))
                .build();
        ProductResponse made = productService.save(instA, actor, request);
        return made.getVariants().get(0);
    }

    private StockLocation location(String code, boolean online, boolean store) {
        LocationRequest request = new LocationRequest();
        request.setCode(code + "-" + run);
        request.setName(code + " " + run);
        request.setAddressLine1("1 Proof Road");
        request.setCity("Lucknow");
        request.setPincode("226001");
        request.setStateCode(SELLER_STATE);
        request.setGstin(SELLER_GSTIN);
        request.setIsStore(store);
        request.setIsWarehouse(!store);
        request.setIsPosEnabled(store);
        request.setSellsOnline(online);
        return locationService.create(instA, actor, true, request);
    }

    private StockReceipt receive(String locationId, String packageSessionId, int quantity, String unitCost,
                                 String requestId) {
        ReceiptRequest request = new ReceiptRequest();
        request.setLocationId(locationId);
        request.setSourceKind("OTHER");
        request.setNote("proof stock");
        request.setClientRequestId(requestId);
        ReceiptRequest.Line line = new ReceiptRequest.Line();
        line.setPackageSessionId(packageSessionId);
        line.setQuantity(quantity);
        if (unitCost != null) {
            line.setUnitCost(new BigDecimal(unitCost));
        }
        request.setLines(List.of(line));
        return receiptService.create(instA, actor, true, request);
    }

    private StockPostResult post(String locationId, String packageSessionId, StockMovementType type, int delta,
                                 String key) {
        return ledger.post(StockPosting.builder().instituteId(instA).locationId(locationId)
                .packageSessionId(packageSessionId).type(type).quantityDelta(delta).actorUserId(actor)
                .referenceType("PROOF").referenceId(run).idempotencyKey(key).build());
    }

    private int onHand(String locationId, String packageSessionId) {
        Integer n = db.queryForObject("SELECT COALESCE(SUM(on_hand), 0) FROM stock_level WHERE institute_id = ? "
                + "AND location_id = ? AND package_session_id = ?", Integer.class, instA, locationId, packageSessionId);
        return n == null ? 0 : n;
    }

    /** on hand at WH, on hand at SHOP, max_seats, available_slots. */
    private List<Integer> stock(String packageSessionId) {
        Map<String, Object> row = db.queryForMap("SELECT max_seats, available_slots FROM package_session WHERE id = ?",
                packageSessionId);
        return List.of(onHand(wh, packageSessionId), onHand(shop, packageSessionId),
                ((Number) row.get("max_seats")).intValue(), ((Number) row.get("available_slots")).intValue());
    }

    private void stockIs(String step, String packageSessionId, int atWh, int atShop, int maxSeats, int available) {
        List<Integer> now = stock(packageSessionId);
        note("   after " + step + ": on hand WH " + now.get(0) + ", SHOP " + now.get(1) + ", max_seats " + now.get(2)
                + ", available_slots " + now.get(3));
        assertEquals(List.of(atWh, atShop, maxSeats, available), now, step);
    }

    private BigDecimal average(String packageSessionId) {
        return db.queryForObject("SELECT cost_price FROM commerce_variant WHERE package_session_id = ?",
                BigDecimal.class, packageSessionId);
    }

    private void averageIs(String step, String packageSessionId, String expected) {
        BigDecimal now = average(packageSessionId);
        note("   average cost after " + step + ": " + now);
        assertNotNull(now, step);
        assertEquals(0, new BigDecimal(expected).compareTo(now), step + ": expected " + expected + " but was " + now);
    }

    /** Drift the reconciliation job finds, for the variants of this run only. */
    private List<StockReconciliationJob.Drift> drift() {
        return reconciliationJob.findSellableDrift().stream().filter(d -> instA.equals(d.instituteId())).toList();
    }

    /**
     * What the order code does in the shipment transaction (WP-12): the SOLD hold of the
     * shipped units is closed and nothing is given back. Until then the units count as sold
     * and not shipped.
     */
    private void closeShipped(List<StockHold> holds) {
        inTransaction(() -> {
            holds.forEach(hold -> assertEquals(1, stockHoldRepository.closeSold(hold.getId(), "SHIPPED")));
            return null;
        });
    }

    private int deficit(String packageSessionId) {
        Integer n = db.queryForObject("SELECT COALESCE(sellable_deficit, 0) FROM commerce_variant "
                + "WHERE package_session_id = ?", Integer.class, packageSessionId);
        return n == null ? 0 : n;
    }

    private StockPostResult undo(String locationId, String packageSessionId, StockMovementType type, int delta,
                                 String movementId, String key) {
        return ledger.post(StockPosting.builder().instituteId(instA).locationId(locationId)
                .packageSessionId(packageSessionId).type(type).quantityDelta(delta).actorUserId(actor)
                .reversesMovementId(movementId).referenceType("PROOF").referenceId(run).idempotencyKey(key).build());
    }

    private void expire(List<StockHold> holds) {
        holds.forEach(hold -> db.update("UPDATE stock_hold SET expires_at = now() - interval '1 minute' WHERE id = ?",
                hold.getId()));
        stockHoldService.releaseExpired();
    }

    private void ledgerAddsUp(String packageSessionId) {
        for (Map<String, Object> row : db.queryForList("SELECT sl.location_id, sl.on_hand, "
                + "(SELECT COALESCE(SUM(m.quantity_delta), 0) FROM stock_movement m WHERE m.location_id = sl.location_id "
                + " AND m.package_session_id = sl.package_session_id) AS moved "
                + "FROM stock_level sl WHERE sl.institute_id = ? AND sl.package_session_id = ?", instA, packageSessionId)) {
            assertEquals(((Number) row.get("on_hand")).longValue(), ((Number) row.get("moved")).longValue(),
                    "on_hand equals the sum of the movements at " + row.get("location_id"));
        }
    }

    // ------------------------------------------------------------------ seed

    @Test
    @Order(1)
    void seed_instituteTaxSetupLocationsAndProducts_thePublishRuleReadsTheTaxClass() {
        note("== seed: institute " + instA);
        assertEquals(2, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version IN ('681','682')"),
                "V681 and V682 are in the Flyway history");
        sql("commerce migrations in the Flyway history",
                "SELECT version, description, success FROM flyway_schema_history WHERE version IN ('679','680','681','682') ORDER BY 1");
        db.update("INSERT INTO institutes (id, name) VALUES (?, ?)", instA, "Stock Proof Institute " + run);
        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)", instA);
        capabilityResolver.evict(instA);
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(actor);
        dto.setUsername(actor);
        dto.setFullName("Proof Admin");
        dto.setRootUser(false);
        dto.setAuthorities(List.of("ADMIN"));
        adminA = new CustomUserDetails(dto);

        // Setup screens open on any commerce feature of the institute, through the real resolver.
        setupAccess.require(adminA, instA, Set.of(CommerceRole.STORE_MANAGER));

        // Nothing saved: no field is shown as chosen.
        TaxSettingDTO empty = taxSettingService.get(instA);
        assertFalse(empty.getConfigured());
        assertNull(empty.getTaxMode());

        TaxSettingDTO saved = taxSettingService.update(instA, actor, TaxSettingDTO.builder().taxMode("REGULAR")
                .sellerGstin(SELLER_GSTIN).sellerLegalName("Proof Seller " + run)
                .sellerAddress("1 Proof Road, Lucknow 226001").roundTotalTo("RUPEE").build());
        assertEquals("REGULAR", saved.getTaxMode());
        assertEquals(SELLER_STATE, saved.getSellerStateCode());
        sql("tax settings row", "SELECT tax_mode, slab_basis, slab_compare, round_total_to, seller_gstin, seller_state_code, fy_start_month FROM commerce_tax_setting WHERE institute_id = ?", instA);

        // Publish rule, REGULAR mode: no tax class, no publish; and nothing of the product is left.
        InvalidRequestException noClass = assertThrows(InvalidRequestException.class,
                () -> product("NOCLASS", "100.00", "ACTIVE"));
        note("-- publishing without a tax class is refused: " + noClass.getMessage());
        assertEquals(0, count("SELECT count(*) FROM commerce_product WHERE institute_id = ?", instA));

        // TEST placeholders, not rates: 5 percent up to 1000.00, 12 percent above.
        LocalDate from = LocalDate.of(2020, 4, 1);
        TaxClassDTO taxClass = taxClassService.create(instA, actor, TaxClassDTO.builder().code("cloth_test")
                .name("Cloth TEST").hsnCode("5208").unit("PCS")
                .rules(List.of(
                        TaxRateRuleDTO.builder().minUnitPrice(new BigDecimal("0")).maxUnitPrice(new BigDecimal("1000.00"))
                                .ratePercent(new BigDecimal("5")).effectiveFrom(from).build(),
                        TaxRateRuleDTO.builder().minUnitPrice(new BigDecimal("1000.01"))
                                .ratePercent(new BigDecimal("12")).effectiveFrom(from).build()))
                .build());
        taxClassId = taxClass.getId();
        assertEquals(2, taxClass.getRules().size(), "the rules sent with the tax class were stored");
        sql("tax class and its rules", "SELECT c.code, c.hsn_code, r.min_unit_price, r.max_unit_price, r.rate_percent, r.cess_percent, r.effective_from, r.effective_to "
                + "FROM commerce_tax_class c JOIN commerce_tax_rate_rule r ON r.tax_class_id = c.id WHERE c.institute_id = ? ORDER BY r.min_unit_price", instA);

        // A tax class id that is not of this institute is refused.
        String mine = taxClassId;
        taxClassId = UUID.randomUUID().toString();
        assertThrows(InvalidRequestException.class, () -> product("FOREIGN", "100.00", "DRAFT"));
        taxClassId = mine;

        StockLocation warehouse = location("WH", true, false);
        StockLocation store = location("SHOP", false, true);
        wh = warehouse.getId();
        shop = store.getId();
        ConflictException second = assertThrows(ConflictException.class, () -> location("WH2", true, false));
        note("-- a second online location is refused: " + second.getMessage());
        sql("locations", "SELECT code, is_store, is_warehouse, sells_online, is_pos_enabled, state_code, status FROM stock_location WHERE institute_id = ? ORDER BY code", instA);

        costed = product("COST", "1250.00", "ACTIVE");
        raced = product("RACE", "400.00", "ACTIVE");
        mixed = product("MIX", "900.00", "ACTIVE");
        shipped = product("SHIP", "1250.00", "ACTIVE");
        sql("products of the run", "SELECT cv.sku, cv.stock_policy, cp.status, cp.tax_class_id IS NOT NULL AS has_tax_class, ps.max_seats, ps.available_slots, cv.cost_price "
                + "FROM commerce_variant cv JOIN commerce_product cp ON cp.package_id = cv.package_id JOIN package_session ps ON ps.id = cv.package_session_id "
                + "WHERE cv.institute_id = ? ORDER BY cv.sku", instA);

        // An active product cannot drop its tax class.
        ProductRequest clear = new ProductRequest();
        clear.setTaxClassId("");
        String costedPackage = db.queryForObject("SELECT package_id FROM commerce_variant WHERE package_session_id = ?",
                String.class, costed.getPackageSessionId());
        assertThrows(InvalidRequestException.class, () -> productService.update(instA, actor, costedPackage, clear));
        assertEquals(taxClassId, db.queryForObject("SELECT tax_class_id FROM commerce_product WHERE package_id = ?",
                String.class, costedPackage));

        // A legacy course with seats, to show the stock statements never touch it.
        BulkAddCourseResponseDTO made = bulkCourseService.bulkAddCourses(BulkAddCourseRequestDTO.builder()
                .courses(List.of(BulkCourseItemDTO.builder().courseName("Seated Course " + run).courseType("COURSE")
                        .paymentConfig(BulkCoursePaymentConfigDTO.builder().paymentType("ONE_TIME").price(500.0)
                                .currency("INR").validityInDays(30).build())
                        .inventoryConfig(BulkCourseInventoryConfigDTO.builder().maxSlots(10).availableSlots(10).build())
                        .batches(List.of(new BulkCourseBatchDTO())).build())).build(), instA, adminA);
        assertEquals(1, made.getSuccessCount());
        courseBatch = made.getResults().get(0).getPackageSessionIds().get(0);
    }

    // ------------------------------------------------------------------ stock

    @Test
    @Order(2)
    void stock_aReceiptPostsStockAndAverageCost_aReversalRestoresBoth() {
        note("");
        note("== receipt, average cost, reversal");
        String ps = costed.getPackageSessionId();
        stockIs("creation", ps, 0, 0, 0, 0);

        StockReceipt first = receive(wh, ps, 10, "100.00", "r1-" + run);
        stockIs("receipt of 10 at 100.00 at the online location", ps, 10, 0, 10, 10);
        averageIs("the first receipt", ps, "100");
        assertTrue(first.getReceiptNumber().startsWith("GRN-"), first.getReceiptNumber());

        // The same request again returns the first receipt and posts nothing.
        StockReceipt again = receive(wh, ps, 10, "100.00", "r1-" + run);
        assertEquals(first.getId(), again.getId());
        stockIs("the same receipt request sent again", ps, 10, 0, 10, 10);
        assertThrows(ConflictException.class, () -> receive(wh, ps, 11, "100.00", "r1-" + run),
                "the same request id with other content is refused");

        StockReceipt second = receive(wh, ps, 10, "200.00", "r2-" + run);
        stockIs("receipt of 10 at 200.00", ps, 20, 0, 20, 20);
        averageIs("the second receipt", ps, "150");

        receiptService.reverse(instA, actor, second.getId(), "wrong item counted");
        stockIs("reversal of the second receipt", ps, 10, 0, 10, 10);
        averageIs("the reversal", ps, "100");
        receiptService.reverse(instA, actor, second.getId(), "wrong item counted");
        stockIs("a second reversal call", ps, 10, 0, 10, 10);
        assertEquals("REVERSED", db.queryForObject("SELECT status FROM stock_receipt WHERE id = ?", String.class, second.getId()));

        // A counter-only location does not move the online counters.
        receive(shop, ps, 4, "100.00", "r3-" + run);
        stockIs("receipt of 4 at the counter-only location", ps, 10, 4, 10, 10);
        averageIs("a receipt at the same cost", ps, "100");

        // Goods with no cost carry the running average and are flagged provisional.
        receive(wh, ps, 5, null, "r4-" + run);
        stockIs("receipt of 5 with no cost", ps, 15, 4, 15, 15);
        averageIs("a receipt with no cost", ps, "100");

        // A sale is stamped with the cost in force.
        StockPostResult sale = post(wh, ps, StockMovementType.POS_SALE, -3, "pos-cost-" + run);
        assertEquals(0, new BigDecimal("100").compareTo(sale.movement().getUnitCost()));
        stockIs("a counter sale of 3 at the online location", ps, 12, 4, 12, 12);

        sql("ledger of the costed item", "SELECT l.code AS location, m.type, m.quantity_delta, m.balance_after, m.affects_sellable, m.unit_cost, m.cost_provisional, m.reason, (m.reverses_movement_id IS NOT NULL) AS is_reversal "
                + "FROM stock_movement m JOIN stock_location l ON l.id = m.location_id WHERE m.package_session_id = ? ORDER BY m.created_at, m.id", ps);
        sql("receipts", "SELECT receipt_number, status, bill_status, source_kind FROM stock_receipt WHERE institute_id = ? ORDER BY receipt_number", instA);
        sql("cost adjustments (the reversal)", "SELECT reason, quantity, old_unit_cost, new_unit_cost, qty_on_hand_at_change, old_average, new_average, variance_amount FROM stock_cost_adjustment WHERE package_session_id = ?", ps);
        assertEquals(6, count("SELECT count(*) FROM stock_movement WHERE package_session_id = ?", ps),
                "four receipts, one reversal, one sale: no row for the repeated request or the second reversal");
        ledgerAddsUp(ps);
        assertTrue(drift().isEmpty(), "no drift: " + drift());

        // The stock statements leave a course batch alone, and the ledger refuses it.
        Map<String, Object> before = db.queryForMap("SELECT max_seats, available_slots, version FROM package_session WHERE id = ?", courseBatch);
        int touched = inTransaction(() -> packageSessionRepository.commerceStockIn(courseBatch, 5, 5)
                + packageSessionRepository.commerceAddSellableDeficit(courseBatch, 5)
                + packageSessionRepository.commerceStockOutFloored(courseBatch, 5)
                + packageSessionRepository.commerceStockShipped(courseBatch, 5)
                + packageSessionRepository.commerceStockUnshipped(courseBatch, 5)
                + packageSessionRepository.commerceStockSoldAtCounter(courseBatch, 1)
                + (packageSessionRepository.lockCommerceStockCounters(courseBatch).isPresent() ? 1 : 0));
        assertEquals(0, touched, "no commerce stock statement matches a course batch");
        assertEquals(before, db.queryForMap("SELECT max_seats, available_slots, version FROM package_session WHERE id = ?", courseBatch));
        assertThrows(InvalidRequestException.class, () -> post(wh, courseBatch, StockMovementType.ADJUSTMENT, 1, "course-" + run));
        note("-- course batch untouched by the six stock statements: " + before);
    }

    @Test
    @Order(3)
    void stock_aRepeatedKeyPostsOnce_andTheLastUnitHasExactlyOneWinner() {
        note("");
        note("== repeated key, last unit");
        String ps = raced.getPackageSessionId();

        // One after the other.
        StockPostResult one = post(wh, ps, StockMovementType.ADJUSTMENT, 3, "key-seq-" + run);
        StockPostResult two = post(wh, ps, StockMovementType.ADJUSTMENT, 3, "key-seq-" + run);
        assertTrue(one.created());
        assertFalse(two.created());
        assertEquals(one.movement().getId(), two.movement().getId());
        stockIs("the same key posted twice", ps, 3, 0, 3, 3);

        // Eight threads, one key, at a location where the level row does not exist yet.
        List<Object> twins = race(8, i -> post(shop, ps, StockMovementType.ADJUSTMENT, 5, "key-race-" + run));
        long created = twins.stream().filter(r -> r instanceof StockPostResult p && p.created()).count();
        long repeated = twins.stream().filter(r -> r instanceof StockPostResult p && !p.created()).count();
        note("-- 8 threads with one key: created " + created + ", answered from the first " + repeated + ", other "
                + twins.stream().filter(r -> !(r instanceof StockPostResult)).toList());
        assertEquals(1, created);
        assertEquals(7, repeated);
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE institute_id = ? AND idempotency_key = ?", instA, "key-race-" + run));
        stockIs("eight deliveries of one key", ps, 3, 5, 3, 3);

        // Two deliveries of one receipt request at the same moment.
        List<Object> receipts = race(2, i -> receive(shop, ps, 2, "50.00", "receipt-race-" + run).getId());
        note("-- 2 threads with one receipt request: " + receipts);
        assertEquals(1, new TreeSet<>(receipts.stream().map(String::valueOf).toList()).size(), "both got the same receipt: " + receipts);
        stockIs("two deliveries of one receipt request", ps, 3, 7, 3, 3);

        // The last unit at the counter: ten rounds, two cashiers each.
        post(shop, ps, StockMovementType.ADJUSTMENT, -6, "to-one-" + run);
        stockIs("bringing the counter down to one unit", ps, 3, 1, 3, 3);
        for (int round = 0; round < 10; round++) {
            int r = round;
            List<Object> results = race(2, i -> post(shop, ps, StockMovementType.POS_SALE, -1, "last-" + r + "-" + i + "-" + run));
            long won = results.stream().filter(x -> x instanceof StockPostResult p && p.created()).count();
            List<Object> lost = results.stream().filter(x -> !(x instanceof StockPostResult)).toList();
            assertEquals(1, won, "round " + round + ": " + results);
            assertEquals(1, lost.size(), "round " + round + ": " + results);
            assertTrue(lost.get(0) instanceof ConflictException c && c.getMessage().startsWith("NOT_IN_STOCK"),
                    "round " + round + ": " + lost.get(0));
            assertEquals(0, onHand(shop, ps));
            post(shop, ps, StockMovementType.ADJUSTMENT, 1, "refill-" + r + "-" + run);
        }
        note("-- last unit at the counter, 10 rounds of 2 threads: one winner and one NOT_IN_STOCK every round");
        post(shop, ps, StockMovementType.ADJUSTMENT, -1, "empty-" + run);

        // Twenty counter sales against seven units at the online location.
        post(wh, ps, StockMovementType.ADJUSTMENT, 4, "to-seven-" + run);
        stockIs("seven units at the online location", ps, 7, 0, 7, 7);
        List<Object> twenty = race(20, i -> post(wh, ps, StockMovementType.POS_SALE, -1, "seven-" + i + "-" + run));
        long sold = twenty.stream().filter(x -> x instanceof StockPostResult p && p.created()).count();
        long refused = twenty.stream().filter(x -> x instanceof ConflictException).count();
        note("-- 20 threads, 7 units at the online location: sold " + sold + ", refused " + refused + ", other "
                + twenty.stream().filter(x -> !(x instanceof StockPostResult) && !(x instanceof ConflictException)).toList());
        assertEquals(7, sold);
        assertEquals(13, refused);
        stockIs("twenty sales against seven units", ps, 0, 0, 0, 0);

        // The last sellable unit: an online checkout against a counter sale, five rounds.
        int heldWins = 0;
        int counterWins = 0;
        for (int round = 0; round < 5; round++) {
            int r = round;
            post(wh, ps, StockMovementType.ADJUSTMENT, 1, "one-more-" + r + "-" + run);
            List<Object> results = race(2, i -> i == 0
                    ? stockHoldService.hold(instA, Map.of(ps, 1), StockHoldKind.PURCHASE)
                    : post(wh, ps, StockMovementType.POS_SALE, -1, "hold-vs-pos-" + r + "-" + run));
            boolean held = results.get(0) instanceof List<?> rows && !rows.isEmpty();
            boolean soldAtCounter = results.get(1) instanceof StockPostResult p && p.created();
            assertTrue(held ^ soldAtCounter, "round " + round + ": exactly one of hold and counter sale wins: " + results);
            if (held) {
                heldWins++;
            } else {
                counterWins++;
            }
        }
        note("-- last sellable unit, online hold against counter sale, 5 rounds: hold won " + heldWins + ", counter won " + counterWins);
        stockIs("the hold against counter rounds", ps, heldWins, 0, heldWins, 0);
        assertEquals(heldWins, count("SELECT COALESCE(SUM(quantity), 0) FROM stock_hold WHERE package_session_id = ? AND status = 'HELD'", ps));
        ledgerAddsUp(ps);
        assertEquals(0, count("SELECT count(*) FROM stock_level WHERE institute_id = ? AND on_hand < 0", instA));
        assertEquals(0, count("SELECT count(*) FROM package_session ps JOIN commerce_variant cv ON cv.package_session_id = ps.id "
                + "WHERE cv.institute_id = ? AND (ps.available_slots < 0 OR ps.max_seats < 0)", instA));
        assertTrue(drift().isEmpty(), "no drift after the races: " + drift());
    }

    @Test
    @Order(4)
    void stock_countersFollowTheLedger_theJobReportsNoDriftAndThenTheTamperedCounter() {
        note("");
        note("== scripted mix of events, counters, reconciliation");
        String ps = mixed.getPackageSessionId();

        receive(wh, ps, 30, "300.00", "mix-r1-" + run);
        stockIs("receipt of 30 online", ps, 30, 0, 30, 30);
        receive(shop, ps, 5, "300.00", "mix-r2-" + run);
        stockIs("receipt of 5 at the counter", ps, 30, 5, 30, 30);

        AdjustmentRequest minus = new AdjustmentRequest();
        minus.setLocationId(wh);
        minus.setPackageSessionId(ps);
        minus.setQuantityDelta(-2);
        minus.setReason("COUNT_DIFFERENCE");
        minus.setClientRequestId("mix-adj-" + run);
        adjustmentService.adjust(instA, actor, true, minus);
        stockIs("adjustment of -2 online", ps, 28, 5, 28, 28);

        AdjustmentRequest damage = new AdjustmentRequest();
        damage.setLocationId(wh);
        damage.setPackageSessionId(ps);
        damage.setKind("DAMAGE");
        damage.setQuantityDelta(1);
        damage.setReason("DAMAGED_IN_STORE");
        damage.setClientRequestId("mix-dmg-" + run);
        adjustmentService.adjust(instA, actor, true, damage);
        stockIs("damage of 1 online", ps, 27, 5, 27, 27);

        List<StockHold> open = stockHoldService.hold(instA, Map.of(ps, 3), StockHoldKind.PURCHASE);
        stockIs("a checkout holding 3", ps, 27, 5, 27, 24);
        List<StockHold> paid = stockHoldService.hold(instA, Map.of(ps, 2), StockHoldKind.PURCHASE);
        stockIs("a second checkout holding 2", ps, 27, 5, 27, 22);
        stockHoldService.markSoldNow(paid);
        stockIs("that order confirmed (HELD to SOLD)", ps, 27, 5, 27, 22);
        post(wh, ps, StockMovementType.SALE, -2, "mix-ship-" + run);
        closeShipped(paid);
        stockIs("its shipment of 2", ps, 25, 5, 25, 22);

        post(wh, ps, StockMovementType.POS_SALE, -1, "mix-pos-wh-" + run);
        stockIs("a counter sale of 1 at the online location", ps, 24, 5, 24, 21);
        post(shop, ps, StockMovementType.POS_SALE, -1, "mix-pos-shop-" + run);
        stockIs("a counter sale of 1 at the counter", ps, 24, 4, 24, 21);

        String transfer = UUID.randomUUID().toString();
        ledger.post(StockPosting.builder().instituteId(instA).locationId(wh).packageSessionId(ps)
                .type(StockMovementType.TRANSFER_OUT).quantityDelta(-4).transferId(transfer).actorUserId(actor)
                .idempotencyKey("mix-tout-" + run).build());
        stockIs("a transfer of 4 leaving the online location", ps, 20, 4, 20, 17);
        ledger.post(StockPosting.builder().instituteId(instA).locationId(shop).packageSessionId(ps)
                .type(StockMovementType.TRANSFER_IN).quantityDelta(4).transferId(transfer).actorUserId(actor)
                .idempotencyKey("mix-tin-" + run).build());
        stockIs("the transfer arriving at the counter", ps, 20, 8, 20, 17);

        post(wh, ps, StockMovementType.RETURN, 1, "mix-return-" + run);
        stockIs("a customer return of 1 to the online location", ps, 21, 8, 21, 18);

        // A counter sale cannot take units an online checkout holds: 18 are free, 19 is refused.
        ConflictException promised = assertThrows(ConflictException.class,
                () -> post(wh, ps, StockMovementType.POS_SALE, -19, "mix-too-many-" + run));
        note("-- counter sale of 19 with 18 unpromised is refused: " + promised.getMessage());
        stockIs("the refused counter sale", ps, 21, 8, 21, 18);

        ledgerAddsUp(ps);
        List<StockReconciliationJob.Drift> none = drift();
        note("-- reconciliation after the mix (3 units held): " + none);
        assertTrue(none.isEmpty(), "max_seats = on hand online, available = that minus held: " + none);

        // The open checkout runs out of time: its three units come back.
        db.update("UPDATE stock_hold SET expires_at = now() - interval '1 minute' WHERE id = ?", open.get(0).getId());
        int released = stockHoldService.releaseExpired();
        assertTrue(released >= 1, "released " + released);
        stockIs("the expiry of the open checkout", ps, 21, 8, 21, 21);
        assertTrue(drift().isEmpty(), "no drift after the release: " + drift());
        sql("holds of the mixed item", "SELECT status, quantity, release_reason FROM stock_hold WHERE package_session_id = ? ORDER BY created_at", ps);

        // Someone edits the counter by hand: the job names the variant and both numbers.
        db.update("UPDATE package_session SET available_slots = available_slots + 5 WHERE id = ?", ps);
        List<StockReconciliationJob.Drift> found = drift();
        note("-- reconciliation after available_slots was raised by 5 by hand: " + found);
        assertEquals(1, found.size(), String.valueOf(found));
        assertEquals(ps, found.get(0).packageSessionId());
        assertEquals(26, found.get(0).availableSlots());
        assertEquals(21, found.get(0).expectedAvailableSlots());
        assertEquals(21, found.get(0).expectedMaxSeats());
        db.update("UPDATE package_session SET available_slots = available_slots - 5, max_seats = max_seats - 2 WHERE id = ?", ps);
        found = drift();
        note("-- reconciliation after max_seats was lowered by 2 by hand: " + found);
        assertEquals(1, found.size(), String.valueOf(found));
        assertEquals(19, found.get(0).maxSeats());
        assertEquals(21, found.get(0).expectedMaxSeats());
        db.update("UPDATE package_session SET max_seats = max_seats + 2 WHERE id = ?", ps);
        assertTrue(drift().isEmpty(), "no drift once the counter is put back: " + drift());
        // The job itself: it reads, logs, and changes nothing.
        reconciliationJob.run();
        stockIs("the reconciliation job", ps, 21, 8, 21, 21);

        // The online switch moves the counters with it, and waits while units are promised.
        stockHoldService.hold(instA, Map.of(ps, 1), StockHoldKind.PURCHASE);
        stockIs("one more open checkout", ps, 21, 8, 21, 20);
        long held = count("SELECT COALESCE(SUM(quantity), 0) FROM stock_hold WHERE institute_id = ? AND status = 'HELD'", instA);
        ConflictException waiting = assertThrows(ConflictException.class,
                () -> locationService.setSellsOnline(instA, actor, wh, false));
        note("-- stop selling online with " + held + " unit(s) in open checkouts is refused: " + waiting.getMessage());
        assertTrue(waiting.getMessage().startsWith("LOCATION_HAS_OPEN_ORDERS"));
        stockIs("the refused switch (rolled back whole)", ps, 21, 8, 21, 20);
        assertEquals(Boolean.TRUE, db.queryForObject("SELECT sells_online FROM stock_location WHERE id = ?", Boolean.class, wh));
        assertTrue(drift().isEmpty(), "no drift after the refused switch: " + drift());
        db.update("UPDATE stock_hold SET expires_at = now() - interval '1 minute' WHERE institute_id = ? AND status = 'HELD'", instA);
        stockHoldService.releaseExpired();
        stockIs("every open checkout of the run expiring", ps, 21, 8, 21, 21);
        locationService.setSellsOnline(instA, actor, wh, false);
        stockIs("the online location stops selling online", ps, 21, 8, 0, 0);
        assertThrows(ConflictException.class, () -> stockHoldService.hold(instA, Map.of(ps, 1), StockHoldKind.PURCHASE),
                "nothing is sellable online now");
        assertTrue(drift().isEmpty(), "no drift with no online location: " + drift());
        locationService.setSellsOnline(instA, actor, wh, true);
        stockIs("it sells online again", ps, 21, 8, 21, 21);
        assertTrue(drift().isEmpty(), "no drift after switching back: " + drift());

        sql("ledger of the mixed item", "SELECT l.code AS location, m.type, m.quantity_delta, m.balance_after, m.affects_sellable "
                + "FROM stock_movement m JOIN stock_location l ON l.id = m.location_id WHERE m.package_session_id = ? ORDER BY m.created_at, m.id", ps);
    }

    @Test
    @Order(5)
    void stock_holdThenSoldThenShipped_takesTheUnitsOnce() {
        note("");
        note("== hold, sold, shipped: no double decrement");
        String ps = shipped.getPackageSessionId();
        receive(wh, ps, 5, "500.00", "ship-r1-" + run);
        stockIs("receipt of 5", ps, 5, 0, 5, 5);
        List<StockHold> hold = stockHoldService.hold(instA, Map.of(ps, 2), StockHoldKind.PURCHASE);
        stockIs("the checkout hold of 2", ps, 5, 0, 5, 3);
        stockHoldService.markSoldNow(hold);
        stockIs("the order confirmed", ps, 5, 0, 5, 3);
        // Sold and not yet shipped: the job counts the SOLD hold, so this is not drift.
        note("-- reconciliation between SOLD and shipment: " + drift());
        assertTrue(drift().isEmpty(), "units sold and not shipped are not drift: " + drift());
        ConflictException gone = assertThrows(ConflictException.class, () -> stockHoldService.markSoldNow(hold),
                "a hold is sold once");
        note("-- confirming the same hold again is refused: " + gone.getMessage());
        StockPostResult ship = post(wh, ps, StockMovementType.SALE, -2, "ship-" + run);
        assertTrue(ship.created());
        stockIs("the shipment", ps, 3, 0, 3, 3);
        assertFalse(post(wh, ps, StockMovementType.SALE, -2, "ship-" + run).created());
        stockIs("the shipment posted again with its key", ps, 3, 0, 3, 3);
        // The expiry job leaves a SOLD row alone.
        db.update("UPDATE stock_hold SET expires_at = now() - interval '1 minute' WHERE id = ?", hold.get(0).getId());
        stockHoldService.releaseExpired();
        stockIs("the expiry job passing over the SOLD row", ps, 3, 0, 3, 3);
        assertEquals("SOLD", db.queryForObject("SELECT status FROM stock_hold WHERE id = ?", String.class, hold.get(0).getId()));
        // A shipped order whose SOLD hold was left open is drift: the job would otherwise let
        // the same units count as promised for ever.
        assertEquals(1, drift().size(), "a SOLD hold left open after its shipment is reported: " + drift());
        closeShipped(hold);
        assertTrue(drift().isEmpty(), "no drift after the shipment: " + drift());
        ledgerAddsUp(ps);
    }

    @Test
    @Order(6)
    void stock_unitsThatLeaveWhilePromisedAreOwed_aCorrectionOrAReleasedHoldDoesNotResellThem() {
        note("");
        note("== promised units that leave the online location: the sellable deficit");
        // Form 1: all five promised, three written off by mistake, then the entry is undone.
        String ps = product("OWED", "400.00", "ACTIVE").getPackageSessionId();
        receive(wh, ps, 5, "100.00", "owed-r1-" + run);
        List<StockHold> sold = stockHoldService.hold(instA, Map.of(ps, 3), StockHoldKind.PURCHASE);
        stockHoldService.markSoldNow(sold);
        stockHoldService.hold(instA, Map.of(ps, 2), StockHoldKind.PURCHASE);
        stockIs("5 received, 3 sold and not shipped, 2 in a checkout", ps, 5, 0, 5, 0);
        StockPostResult damage = post(wh, ps, StockMovementType.DAMAGE, -3, "owed-dmg-" + run);
        assertEquals(3, damage.sellableShortfall());
        stockIs("a damage entry of 3", ps, 2, 0, 2, 0);
        assertEquals(3, deficit(ps), "the three units below zero are remembered");
        assertTrue(drift().isEmpty(), "available less deficit = on hand - held - sold: " + drift());
        undo(wh, ps, StockMovementType.DAMAGE, 3, damage.movement().getId(), "owed-undo-" + run);
        stockIs("the damage entry undone", ps, 5, 0, 5, 0);
        assertEquals(0, deficit(ps));
        note("-- 5 on hand and 5 promised after the correction: available_slots is 0, not 3");
        assertThrows(ConflictException.class, () -> stockHoldService.hold(instA, Map.of(ps, 1), StockHoldKind.PURCHASE),
                "every unit is promised: nothing can be held");
        assertTrue(drift().isEmpty(), "no drift after the correction: " + drift());

        // Form 2: holds of 2 and 1, four written off, then the hold of 2 runs out.
        String ps2 = product("OWED2", "400.00", "ACTIVE").getPackageSessionId();
        receive(wh, ps2, 5, "100.00", "owed2-r1-" + run);
        List<StockHold> holdA = stockHoldService.hold(instA, Map.of(ps2, 2), StockHoldKind.PURCHASE);
        List<StockHold> holdB = stockHoldService.hold(instA, Map.of(ps2, 1), StockHoldKind.PURCHASE);
        stockIs("5 received, holds of 2 and 1", ps2, 5, 0, 5, 2);
        assertEquals(2, post(wh, ps2, StockMovementType.DAMAGE, -4, "owed2-dmg-" + run).sellableShortfall());
        stockIs("a damage entry of 4", ps2, 1, 0, 1, 0);
        assertEquals(2, deficit(ps2));
        expire(holdA);
        stockIs("the hold of 2 running out", ps2, 1, 0, 1, 0);
        assertEquals(0, deficit(ps2), "the released units paid the deficit");
        note("-- 1 on hand and 1 still held: available_slots is 0, not 1");
        assertThrows(ConflictException.class, () -> stockHoldService.hold(instA, Map.of(ps2, 1), StockHoldKind.PURCHASE));
        assertTrue(drift().isEmpty(), "no drift: " + drift());
        expire(holdB);
        stockIs("the hold of 1 running out", ps2, 1, 0, 1, 1);
        assertTrue(drift().isEmpty(), "no drift: " + drift());

        // A stock receipt larger than the deficit puts only the rest on sale.
        String ps4 = product("OWED4", "400.00", "ACTIVE").getPackageSessionId();
        receive(wh, ps4, 2, "100.00", "owed4-r1-" + run);
        List<StockHold> both = stockHoldService.hold(instA, Map.of(ps4, 2), StockHoldKind.PURCHASE);
        post(wh, ps4, StockMovementType.DAMAGE, -2, "owed4-dmg-" + run);
        assertEquals(2, deficit(ps4));
        receive(wh, ps4, 10, "100.00", "owed4-r2-" + run);
        stockIs("a receipt of 10 with 2 owed", ps4, 10, 0, 10, 8);
        assertEquals(0, deficit(ps4));
        assertTrue(drift().isEmpty(), "no drift: " + drift());
        // Stopping online sales is refused while units are owed, even with nothing on the shelf.
        post(wh, ps4, StockMovementType.DAMAGE, -10, "owed4-dmg2-" + run);
        stockIs("everything written off", ps4, 0, 0, 0, 0);
        assertEquals(2, deficit(ps4));
        assertTrue(assertThrows(ConflictException.class, () -> locationService.setSellsOnline(instA, actor, wh, false))
                .getMessage().startsWith("LOCATION_HAS_OPEN_ORDERS"));
        expire(both);
        assertEquals(0, deficit(ps4));
        stockIs("the checkout running out", ps4, 0, 0, 0, 0);

        // A write-off and the release of the hold at the same moment, eight times: whichever
        // commits first, nothing promised goes back on sale and nothing unpromised is lost.
        String ps3 = product("OWED3", "400.00", "ACTIVE").getPackageSessionId();
        for (int round = 0; round < 8; round++) {
            int r = round;
            receive(wh, ps3, 3, "100.00", "owed3-r" + r + "-" + run);
            List<StockHold> two = stockHoldService.hold(instA, Map.of(ps3, 2), StockHoldKind.PURCHASE);
            db.update("UPDATE stock_hold SET expires_at = now() - interval '1 minute' WHERE id = ?", two.get(0).getId());
            List<Object> results = race(2, i -> i == 0
                    ? post(wh, ps3, StockMovementType.DAMAGE, -3, "owed3-dmg-" + r + "-" + run)
                    : (Object) stockHoldService.releaseExpired());
            assertTrue(results.stream().noneMatch(x -> x instanceof Throwable), "round " + r + ": " + results);
            assertEquals(List.of(0, 0, 0, 0), stock(ps3), "round " + r);
            assertEquals(0, deficit(ps3), "round " + r);
            assertEquals("RELEASED", db.queryForObject("SELECT status FROM stock_hold WHERE id = ?", String.class, two.get(0).getId()));
            assertTrue(drift().isEmpty(), "round " + r + ": " + drift());
        }
        note("-- 8 rounds of a write-off racing the release of a hold: counters 0/0 and no deficit every time");
        ledgerAddsUp(ps3);
    }

    @Test
    @Order(7)
    void stock_aCorrectionUndoesAMovementOnce_atTheCostOfThatMovement() {
        note("");
        note("== corrections: checked against the movement they name, costed at its cost");
        String ps = product("UNDO", "400.00", "ACTIVE").getPackageSessionId();
        receive(shop, ps, 2, "100.00", "undo-r1-" + run);
        StockPostResult sale = post(shop, ps, StockMovementType.POS_SALE, -1, "undo-sale-" + run);
        same(new BigDecimal("100"), sale.movement().getUnitCost(), "the sale is stamped at the average of its day");
        receive(shop, ps, 10, "200.00", "undo-r2-" + run);
        averageIs("a receipt of 10 at 200 with 1 left", ps, "190.9091");

        StockPostResult undone = undo(shop, ps, StockMovementType.POS_SALE, 1, sale.movement().getId(), "undo-void-a-" + run);
        assertTrue(undone.created());
        same(new BigDecimal("100"), undone.movement().getUnitCost(), "the void carries the cost of the sale, not 190.9091");
        averageIs("the void (the unit re-averages at 100)", ps, "183.3333");
        assertEquals(12, onHand(shop, ps));

        ConflictException twice = assertThrows(ConflictException.class,
                () -> undo(shop, ps, StockMovementType.POS_SALE, 1, sale.movement().getId(), "undo-void-b-" + run));
        note("-- a second undo of the same sale with another key: " + twice.getMessage());
        assertTrue(twice.getMessage().startsWith("ALREADY_REVERSED"));
        assertEquals(12, onHand(shop, ps), "nothing came back twice");

        // The movement named must be of this item, place and kind.
        String receiptMovement = db.queryForObject("SELECT id FROM stock_movement WHERE package_session_id = ? AND type = 'RECEIPT' "
                + "ORDER BY created_at LIMIT 1", String.class, ps);
        assertThrows(InvalidRequestException.class,
                () -> undo(shop, ps, StockMovementType.POS_SALE, 1, receiptMovement, "undo-wrong-kind-" + run));
        assertThrows(InvalidRequestException.class,
                () -> undo(wh, ps, StockMovementType.POS_SALE, 1, sale.movement().getId(), "undo-wrong-place-" + run));
        assertThrows(InvalidRequestException.class,
                () -> undo(shop, ps, StockMovementType.POS_SALE, 1, UUID.randomUUID().toString(), "undo-unknown-" + run));
        // A key used for another movement is refused, not answered as done.
        assertTrue(assertThrows(ConflictException.class,
                () -> post(shop, ps, StockMovementType.POS_SALE, -2, "undo-sale-" + run))
                .getMessage().startsWith("IDEMPOTENCY_KEY_REUSED"));
        assertEquals(12, onHand(shop, ps));

        // Two undo calls of one sale at the same moment, five times: one wins.
        for (int round = 0; round < 5; round++) {
            int r = round;
            StockPostResult again = post(shop, ps, StockMovementType.POS_SALE, -1, "undo-sale-r" + r + "-" + run);
            List<Object> results = race(2, i -> undo(shop, ps, StockMovementType.POS_SALE, 1, again.movement().getId(),
                    "undo-void-r" + r + "-" + i + "-" + run));
            long won = results.stream().filter(x -> x instanceof StockPostResult p && p.created()).count();
            long refused = results.stream().filter(x -> x instanceof ConflictException).count();
            assertEquals(1, won, "round " + r + ": " + results);
            assertEquals(1, refused, "round " + r + ": " + results);
            assertEquals(12, onHand(shop, ps), "round " + r);
        }
        note("-- 5 rounds of two undo calls on one sale at once: one applied, one refused, on hand 12 every time");
        sql("ledger of the item", "SELECT type, quantity_delta, balance_after, unit_cost, reverses_movement_id IS NOT NULL AS correction "
                + "FROM stock_movement WHERE package_session_id = ? ORDER BY created_at, id", ps);
        ledgerAddsUp(ps);
    }

    @Test
    @Order(8)
    void stock_theJobCountsUnitsSoldAndNotShipped_andFindsACounterThatIgnoresThem() {
        note("");
        note("== reconciliation with units sold and not shipped");
        String ps = product("RECON", "400.00", "ACTIVE").getPackageSessionId();
        receive(wh, ps, 10, "100.00", "recon-r1-" + run);
        List<StockHold> order = stockHoldService.hold(instA, Map.of(ps, 3), StockHoldKind.PURCHASE);
        stockHoldService.markSoldNow(order);
        stockIs("10 received, an order of 3 confirmed", ps, 10, 0, 10, 7);
        assertTrue(drift().isEmpty(), "sold and not shipped is not drift: " + drift());

        // The counter says 10 although 3 are sold: online 10, held 0. The old query compared
        // available_slots with online minus held and never looked at this row.
        db.update("UPDATE package_session SET available_slots = 10 WHERE id = ?", ps);
        List<StockReconciliationJob.Drift> found = drift();
        note("-- available_slots set to 10 by hand with 3 sold and not shipped: " + found);
        assertEquals(1, found.size(), String.valueOf(found));
        assertEquals(10, found.get(0).availableSlots());
        assertEquals(7, found.get(0).expectedAvailableSlots());
        db.update("UPDATE package_session SET available_slots = 7 WHERE id = ?", ps);
        assertTrue(drift().isEmpty());

        post(wh, ps, StockMovementType.SALE, -3, "recon-ship-" + run);
        closeShipped(order);
        stockIs("the shipment", ps, 7, 0, 7, 7);
        assertTrue(drift().isEmpty(), "no drift after the shipment: " + drift());

        // A deficit the counters do not explain is drift too.
        db.update("UPDATE commerce_variant SET sellable_deficit = 2 WHERE package_session_id = ?", ps);
        found = drift();
        assertEquals(1, found.size(), String.valueOf(found));
        assertEquals(2, found.get(0).sellableDeficit());
        db.update("UPDATE commerce_variant SET sellable_deficit = NULL WHERE package_session_id = ?", ps);
        assertTrue(drift().isEmpty());

        // An oversold SOLD row took nothing from available_slots, so it is not counted.
        db.update("INSERT INTO stock_hold (id, package_session_id, institute_id, kind, quantity, status, oversold) "
                + "VALUES (?, ?, ?, 'PURCHASE', 1, 'SOLD', TRUE)", UUID.randomUUID().toString(), ps, instA);
        assertTrue(drift().isEmpty(), "an oversold row is not part of the count: " + drift());
    }

    // ------------------------------------------------------------------ tax and documents

    private UserPlan plan(VariantResponse variant, int quantity) {
        return inTransaction(() -> {
            PaymentPlan plan = paymentPlanRepository.findById(variant.getPaymentPlanId()).orElseThrow();
            EnrollInvite invite = enrollInviteRepository.findById(variant.getEnrollInviteId()).orElseThrow();
            PaymentOption option = paymentOptionRepository.findById(variant.getPaymentOptionId()).orElseThrow();
            PaymentInitiationRequestDTO payment = new PaymentInitiationRequestDTO();
            payment.setAmount(plan.getActualPrice() * quantity);
            payment.setCurrency("INR");
            return userPlanService.createUserPlan(buyer, plan, null, invite, option, payment, "PENDING_FOR_PAYMENT",
                    null, null, null, null, quantity);
        });
    }

    /** A plan on the variant with one payment log, as a checkout line leaves them. */
    private String paymentLog(VariantResponse variant, int quantity, String orderId) {
        UserPlan plan = plan(variant, quantity);
        return paymentLogService.createPaymentLog(buyer, variant.getPrice().doubleValue() * quantity, "RAZORPAY",
                "RAZORPAY", "INR", plan, orderId);
    }

    private TaxResult tax(VariantResponse variant, int quantity) {
        CommerceTaxContext settings = taxSettingService.context(instA);
        TaxClassRef ref = taxClassService.loadRefs(instA, List.of(taxClassId)).get(taxClassId);
        return new CommerceTaxCalculator().calculate(TaxRequest.builder().mode(settings.getMode())
                .slabBasis(settings.getSlabBasis()).slabCompare(settings.getSlabCompare())
                .roundTotalTo(settings.getRoundTotalTo()).sellerStateCode(SELLER_STATE).placeOfSupplyState(SELLER_STATE)
                .date(documentClock.today(instA))
                .lines(List.of(
                        TaxLineInput.builder().lineRef("line-1").lineType(TaxLineType.ITEM).description(variant.getSku())
                                .unitPrice(variant.getPrice()).quantity(quantity).qtyScale(1).taxClass(ref).build(),
                        TaxLineInput.builder().lineRef("shipping").lineType(TaxLineType.SHIPPING).description("Shipping")
                                .unitPrice(new BigDecimal("79.50")).quantity(1).qtyScale(1).taxClass(ref).build()))
                .build());
    }

    private CommerceInvoiceRequest invoiceRequest(String logId, TaxResult tax, String order) {
        return CommerceInvoiceRequest.builder().commerceOrderId("order-" + order).orderNumber("ORD-" + order)
                .channel("ONLINE").locationId(wh).userId(buyer).buyerName("Proof Buyer").buyerPhone("9999999999")
                .billingAddress("2 Buyer Lane, Kanpur 208001").shippingAddress("2 Buyer Lane, Kanpur 208001")
                .tax(tax).paymentLogIds(List.of(logId)).actorUserId(actor).build();
    }

    private long nextValue(String seriesId) {
        Long next = db.queryForObject("SELECT next_value FROM commerce_document_series WHERE id = ?", Long.class, seriesId);
        return next == null ? -1 : next;
    }

    private static void same(BigDecimal expected, Object stored, String what) {
        BigDecimal value = stored == null ? BigDecimal.ZERO : new BigDecimal(String.valueOf(stored));
        BigDecimal wanted = expected == null ? BigDecimal.ZERO : expected;
        assertEquals(0, wanted.compareTo(value), what + ": expected " + wanted + " but stored " + value);
    }

    @Test
    @Order(10)
    void documents_aShopPaymentGetsItsInvoiceFromTheCommerceSeries_andTheLegacyGeneratorAddsNone() {
        note("");
        note("== invoice for a commerce payment");
        // No document can be issued before a series exists.
        String early = paymentLog(costed, 1, "early-" + run);
        TaxResult earlyTax = tax(costed, 1);
        RuntimeException noSeries = assertThrows(RuntimeException.class,
                () -> inTransaction(() -> commerceInvoiceService.issue(instA, invoiceRequest(early, earlyTax, "early-" + run))));
        note("-- issue before any series exists is refused: " + noSeries.getMessage());
        assertEquals(0, count("SELECT count(*) FROM invoice WHERE institute_id = ?", instA));

        DocumentSeriesDTO invoices = seriesService.create(instA, actor, DocumentSeriesDTO.builder()
                .documentType("TAX_INVOICE").prefix("PF" + run.substring(0, 2)).build());
        DocumentSeriesDTO credits = seriesService.create(instA, actor, DocumentSeriesDTO.builder()
                .documentType("CREDIT_NOTE").prefix("CN" + run.substring(0, 2)).build());
        invoiceSeriesId = invoices.getId();
        creditSeriesId = credits.getId();
        sql("document series", "SELECT document_type, kind, channel, prefix, financial_year, next_value, status FROM commerce_document_series WHERE institute_id = ? ORDER BY document_type", instA);

        invoiceLogId = paymentLog(costed, 2, "o1-" + run);
        paymentLogService.updatePaymentLog(invoiceLogId, "SUCCESS", "PAID", "{\"gateway\":\"proof\"}");
        assertTrue(inTransaction(() -> documentGuard.isCommerceLog(paymentLogRepository.findById(invoiceLogId).orElseThrow())),
                "the payment log of a variant plan is a commerce log");

        // The legacy generator, before the commerce document exists: it returns no invoice and writes none.
        Boolean nothing = inTransaction(() -> {
            PaymentLog log = paymentLogRepository.findById(invoiceLogId).orElseThrow();
            InvoiceService.InvoiceGenerationResult result =
                    invoiceService.generateInvoiceWithResult(log.getUserPlan(), log, instA, false);
            return result != null && result.getInvoice() == null;
        });
        assertTrue(nothing, "the legacy generator returns a result with no invoice");
        invoiceService.generateInvoiceForCommittedPayment(invoiceLogId, instA);
        assertNull(invoiceService.generateCombinedInvoiceForCommittedPayments(List.of(invoiceLogId), instA));
        assertEquals(0, count("SELECT count(*) FROM invoice WHERE institute_id = ?", instA),
                "three legacy entry points, no invoice row");
        assertEquals(0, count("SELECT count(*) FROM invoice_payment_log_mapping WHERE payment_log_id = ?", invoiceLogId));

        invoiceTax = tax(costed, 2);
        long first = nextValue(invoiceSeriesId);
        CommerceInvoiceService.Issued issued = inTransaction(
                () -> commerceInvoiceService.issue(instA, invoiceRequest(invoiceLogId, invoiceTax, "o1-" + run)));
        assertFalse(issued.alreadyExisted());
        invoiceId = issued.invoice().getId();
        invoiceNumber = issued.invoice().getInvoiceNumber();
        Map<String, Object> row = sql("the commerce invoice", "SELECT invoice_number, document_type, series_id, status, source, channel, location_id, seller_gstin, seller_state_code, place_of_supply_state, tax_head, "
                + "subtotal, discount_amount, tax_amount, round_off, total_amount, seq_no, seq_scope_key, commerce_order_id, document_date FROM invoice WHERE id = ?", invoiceId).get(0);
        assertEquals(invoiceSeriesId, row.get("series_id"));
        assertEquals("TAX_INVOICE", row.get("document_type"));
        assertEquals(DocumentNumberAllocator.format(invoices.getPrefix(), invoices.getFinancialYear(), first), invoiceNumber);
        assertEquals(first + 1, nextValue(invoiceSeriesId));
        assertNull(row.get("seq_no"), "the course numbering columns stay empty");
        assertEquals("CGST_SGST", row.get("tax_head"));

        // Calculator totals equal the stored invoice and its lines, to the paisa.
        same(invoiceTax.getTaxableValue(), row.get("subtotal"), "taxable value");
        same(invoiceTax.getTaxAmount(), row.get("tax_amount"), "tax");
        same(invoiceTax.getRoundOff(), row.get("round_off"), "round-off");
        same(invoiceTax.getTotal(), row.get("total_amount"), "total");
        List<Map<String, Object>> lines = sql("its lines", "SELECT source_id, item_type, description, quantity, unit_price, amount, hsn_code, unit, tax_rate, taxable_value, cgst, sgst, igst, cess, discount "
                + "FROM invoice_line_item WHERE invoice_id = ? ORDER BY item_type, source_id", invoiceId);
        assertEquals(invoiceTax.getLines().size(), lines.size());
        BigDecimal taxable = BigDecimal.ZERO;
        BigDecimal taxes = BigDecimal.ZERO;
        for (TaxLineResult line : invoiceTax.getLines()) {
            Map<String, Object> stored = lines.stream().filter(l -> line.getLineRef().equals(l.get("source_id"))).findFirst().orElseThrow();
            assertEquals("COMMERCE_" + line.getLineType().name(), stored.get("item_type"));
            assertEquals(line.getQuantity(), ((Number) stored.get("quantity")).intValue());
            same(line.getUnitPrice(), stored.get("unit_price"), line.getLineRef() + " unit price");
            same(line.getNet(), stored.get("amount"), line.getLineRef() + " net");
            same(line.getRatePercent(), stored.get("tax_rate"), line.getLineRef() + " rate");
            same(line.getTaxableValue(), stored.get("taxable_value"), line.getLineRef() + " taxable");
            same(line.getCgst(), stored.get("cgst"), line.getLineRef() + " cgst");
            same(line.getSgst(), stored.get("sgst"), line.getLineRef() + " sgst");
            same(line.getIgst(), stored.get("igst"), line.getLineRef() + " igst");
            same(line.getCess(), stored.get("cess"), line.getLineRef() + " cess");
            assertEquals(line.getHsnCode(), stored.get("hsn_code"));
            taxable = taxable.add(new BigDecimal(String.valueOf(stored.get("taxable_value"))));
            taxes = taxes.add(new BigDecimal(String.valueOf(stored.get("cgst")))).add(new BigDecimal(String.valueOf(stored.get("sgst"))))
                    .add(new BigDecimal(String.valueOf(stored.get("igst")))).add(new BigDecimal(String.valueOf(stored.get("cess"))));
        }
        same(taxable, row.get("subtotal"), "sum of line taxable values");
        same(taxes, row.get("tax_amount"), "sum of line taxes");
        same(taxable.add(taxes).add(invoiceTax.getRoundOff()), row.get("total_amount"), "taxable + tax + round-off");
        note("-- calculator: taxable " + invoiceTax.getTaxableValue() + ", cgst " + invoiceTax.getCgst() + ", sgst " + invoiceTax.getSgst()
                + ", round-off " + invoiceTax.getRoundOff() + ", total " + invoiceTax.getTotal() + "; lines "
                + invoiceTax.getLines().stream().map(l -> l.getLineRef() + "@" + l.getRatePercent() + "%").toList());

        // The same order again: the same document, no new number.
        CommerceInvoiceService.Issued again = inTransaction(
                () -> commerceInvoiceService.issue(instA, invoiceRequest(invoiceLogId, invoiceTax, "o1-" + run)));
        assertTrue(again.alreadyExisted());
        assertEquals(invoiceId, again.invoice().getId());
        assertEquals(first + 1, nextValue(invoiceSeriesId));

        // The legacy generator, now that the document exists: it hands back that one.
        String fromLegacy = inTransaction(() -> {
            PaymentLog log = paymentLogRepository.findById(invoiceLogId).orElseThrow();
            InvoiceService.InvoiceGenerationResult result =
                    invoiceService.generateInvoiceWithResult(log.getUserPlan(), log, instA, false);
            assertTrue(result.isAlreadyExisted());
            return result.getInvoice() == null ? null : result.getInvoice().getId();
        });
        assertEquals(invoiceId, fromLegacy);
        invoiceService.generateInvoiceForCommittedPayment(invoiceLogId, instA);
        assertEquals(1, count("SELECT count(*) FROM invoice_payment_log_mapping WHERE payment_log_id = ?", invoiceLogId),
                "one invoice for the payment, the commerce one");
        assertEquals(1, count("SELECT count(*) FROM invoice WHERE institute_id = ?", instA));
        assertEquals(0, count("SELECT count(*) FROM invoice WHERE institute_id = ? AND document_type IS NULL", instA),
                "no course-series invoice for the shop payment");
    }

    @Test
    @Order(11)
    void documents_deleteAndVoidOfACommerceInvoiceAreRefused() {
        note("");
        note("== delete and void are refused");
        VacademyException voided = assertThrows(VacademyException.class,
                () -> paymentVoidService.voidPayment(invoiceLogId, instA, "proof", actor));
        note("-- void of the payment: " + voided.getMessage());
        assertTrue(voided.getMessage().contains("shop order"), voided.getMessage());
        VacademyException voidedRow = assertThrows(VacademyException.class,
                () -> paymentVoidService.voidSingleRow(invoiceLogId, instA, "proof", actor));
        assertTrue(voidedRow.getMessage().contains("shop order"), voidedRow.getMessage());

        // The service entry points answer "turned off" first while deletion is switched off here.
        // The refusal under test is the next step, reached directly.
        VacademyException off = assertThrows(VacademyException.class,
                () -> paymentDeletionService.deleteInvoice(invoiceId, instA, actor));
        note("-- delete of the invoice with deletion switched off: " + off.getMessage());
        Object deletion = AopTestUtils.getUltimateTargetObject(paymentDeletionService);
        VacademyException invoiceDelete = assertThrows(VacademyException.class, () -> inTransaction(
                () -> ReflectionTestUtils.invokeMethod(deletion, "removeInvoice", invoiceId, instA, actor)));
        note("-- delete of the invoice: " + invoiceDelete.getMessage());
        assertTrue(invoiceDelete.getMessage().contains("shop tax document"), invoiceDelete.getMessage());
        VacademyException paymentDelete = assertThrows(VacademyException.class, () -> inTransaction(
                () -> ReflectionTestUtils.invokeMethod(deletion, "removePayment", invoiceLogId, instA, actor, true)));
        note("-- delete of the payment: " + paymentDelete.getMessage());
        assertTrue(paymentDelete.getMessage().contains("shop order"), paymentDelete.getMessage());

        Map<String, Object> still = sql("the invoice and the payment are as they were",
                "SELECT i.invoice_number, i.status, i.cancelled_at, pl.payment_status FROM invoice i JOIN invoice_payment_log_mapping m ON m.invoice_id = i.id "
                        + "JOIN payment_log pl ON pl.id = m.payment_log_id WHERE i.id = ?", invoiceId).get(0);
        assertEquals("GENERATED", still.get("status"));
        assertEquals("PAID", still.get("payment_status"));
        assertNull(still.get("cancelled_at"));
    }

    @Test
    @Order(12)
    void documents_fiftyParallelIssuesGiveFiftyConsecutiveNumbers_andARollbackLeavesNoGap() {
        note("");
        note("== 50 parallel issues on one series");
        Map<String, Object> series = db.queryForMap("SELECT prefix, financial_year FROM commerce_document_series WHERE id = ?", invoiceSeriesId);
        String prefix = String.valueOf(series.get("prefix"));
        String year = String.valueOf(series.get("financial_year"));
        TaxResult tax = tax(raced, 1);
        List<String> logs = new ArrayList<>();
        for (int i = 0; i < 81; i++) {
            logs.add(paymentLog(raced, 1, "p" + i + "-" + run));
        }

        long start = nextValue(invoiceSeriesId);
        List<Object> results = race(50, i -> new TransactionTemplate(transactionManager).execute(status ->
                commerceInvoiceService.issue(instA, invoiceRequest(logs.get(i), tax, "p" + i + "-" + run)).invoice().getInvoiceNumber()));
        List<String> expected = new ArrayList<>();
        for (long value = start; value < start + 50; value++) {
            expected.add(DocumentNumberAllocator.format(prefix, year, value));
        }
        List<Object> failures = results.stream().filter(r -> !(r instanceof String)).toList();
        assertTrue(failures.isEmpty(), "every issue succeeded: " + failures);
        List<String> numbers = results.stream().map(String::valueOf).sorted().toList();
        note("-- 50 threads: first " + numbers.get(0) + ", last " + numbers.get(49) + ", distinct " + new TreeSet<>(numbers).size());
        assertEquals(expected, numbers, "50 consecutive numbers, no gap, no repeat");
        assertEquals(start + 50, nextValue(invoiceSeriesId));

        // A rolled-back issue takes no number.
        String lost = new TransactionTemplate(transactionManager).execute(status -> {
            String number = commerceInvoiceService.issue(instA, invoiceRequest(logs.get(50), tax, "p50-" + run)).invoice().getInvoiceNumber();
            status.setRollbackOnly();
            return number;
        });
        assertEquals(DocumentNumberAllocator.format(prefix, year, start + 50), lost);
        assertEquals(0, count("SELECT count(*) FROM invoice WHERE institute_id = ? AND invoice_number = ?", instA, lost));
        assertEquals(start + 50, nextValue(invoiceSeriesId), "the counter went back with the document");
        String next = inTransaction(() -> commerceInvoiceService.issue(instA, invoiceRequest(logs.get(50), tax, "p50-" + run)).invoice().getInvoiceNumber());
        assertEquals(lost, next, "the next document takes the number of the rolled-back one");
        note("-- rolled back " + lost + ", next committed " + next);

        // Thirty more at once, every other one rolled back: the committed ones are still consecutive.
        long mixedStart = nextValue(invoiceSeriesId);
        List<Object> mixedResults = race(30, i -> new TransactionTemplate(transactionManager).execute(status -> {
            String number = commerceInvoiceService.issue(instA, invoiceRequest(logs.get(51 + i), tax, "p" + (51 + i) + "-" + run)).invoice().getInvoiceNumber();
            if (i % 2 == 1) {
                status.setRollbackOnly();
            }
            return number;
        }));
        assertTrue(mixedResults.stream().allMatch(r -> r instanceof String), String.valueOf(mixedResults));
        assertEquals(mixedStart + 15, nextValue(invoiceSeriesId));
        Map<String, Object> issuedRun = db.queryForMap("SELECT count(*) AS n, count(DISTINCT invoice_number) AS distinct_n, min(invoice_number) AS lowest, max(invoice_number) AS highest "
                + "FROM invoice WHERE series_id = ?", invoiceSeriesId);
        long total = nextValue(invoiceSeriesId) - 1;
        note("-- after 30 more threads (15 rolled back): " + issuedRun + ", next_value " + nextValue(invoiceSeriesId));
        assertEquals(total, ((Number) issuedRun.get("n")).longValue(), "as many invoices as numbers taken");
        assertEquals(total, ((Number) issuedRun.get("distinct_n")).longValue());
        assertEquals(DocumentNumberAllocator.format(prefix, year, 1), issuedRun.get("lowest"));
        assertEquals(DocumentNumberAllocator.format(prefix, year, total), issuedRun.get("highest"));
        for (long value = 1; value <= total; value++) {
            assertEquals(1, count("SELECT count(*) FROM invoice WHERE series_id = ? AND invoice_number = ?", invoiceSeriesId,
                    DocumentNumberAllocator.format(prefix, year, value)), "number " + value + " exists once");
        }
    }

    @Test
    @Order(13)
    void documents_aCreditNoteMirrorsItsInvoice() {
        note("");
        note("== credit notes");
        // Part credit: one of the two units, then the rest.
        String itemLine = db.queryForObject("SELECT id FROM invoice_line_item WHERE invoice_id = ? AND item_type = 'COMMERCE_ITEM'",
                String.class, invoiceId);
        long firstNumber = nextValue(creditSeriesId);
        CreditNoteDTO part = creditNoteService.issue(instA, actor, CreditNoteRequest.builder()
                .clientRequestId("part-" + run).invoiceId(invoiceId)
                .reason("one unit returned").lines(List.of(CreditNoteLineRequest.builder().invoiceLineItemId(itemLine).quantity(1).build())).build());
        Map<String, Object> line = db.queryForMap("SELECT taxable_value, cgst, sgst, igst, amount FROM invoice_line_item WHERE id = ?", itemLine);
        assertFalse(part.getLines().isEmpty());
        BigDecimal half = new BigDecimal(String.valueOf(line.get("taxable_value"))).divide(BigDecimal.valueOf(2));
        assertTrue(part.getTaxableValue().subtract(half).abs().compareTo(new BigDecimal("0.01")) <= 0,
                "one of two units is half the taxable value: " + part.getTaxableValue() + " of " + line.get("taxable_value"));
        assertTrue(inTransaction(() -> commerceInvoiceService.liveDocument(instA, List.of(invoiceLogId))).isPresent(),
                "a part-credited invoice is still the live document");

        CreditNoteDTO rest = creditNoteService.issue(instA, actor, CreditNoteRequest.builder()
                .clientRequestId("rest-" + run).invoiceId(invoiceId)
                .reason("order returned").full(true).build());
        assertEquals(firstNumber + 2, nextValue(creditSeriesId));
        sql("credit notes of the invoice", "SELECT credit_note_number, series_id = ? AS from_credit_series, tax_head, taxable_value, cgst, sgst, igst, cess, tax_amount, round_off, total, reason "
                + "FROM commerce_credit_note WHERE invoice_id = ? ORDER BY credit_note_number", creditSeriesId, invoiceId);
        sql("their lines", "SELECT n.credit_note_number, l.description, l.quantity, l.tax_rate, l.taxable_value, l.cgst, l.sgst, l.igst, l.amount "
                + "FROM commerce_credit_note_line l JOIN commerce_credit_note n ON n.id = l.credit_note_id WHERE n.invoice_id = ? ORDER BY 1, 2", invoiceId);

        // Together the two notes mirror the invoice exactly: every head, the round-off, the total.
        Map<String, Object> invoice = db.queryForMap("SELECT subtotal, tax_amount, round_off, total_amount, tax_head, seller_gstin, place_of_supply_state FROM invoice WHERE id = ?", invoiceId);
        Map<String, Object> credited = db.queryForMap("SELECT sum(taxable_value) AS taxable, sum(cgst) AS cgst, sum(sgst) AS sgst, sum(igst) AS igst, sum(tax_amount) AS tax, "
                + "sum(round_off) AS round_off, sum(total) AS total, count(*) AS notes, min(tax_head) AS tax_head, min(seller_gstin) AS seller_gstin, min(place_of_supply_state) AS pos "
                + "FROM commerce_credit_note WHERE invoice_id = ?", invoiceId);
        same(new BigDecimal(String.valueOf(invoice.get("subtotal"))), credited.get("taxable"), "credited taxable value");
        same(new BigDecimal(String.valueOf(invoice.get("tax_amount"))), credited.get("tax"), "credited tax");
        same(new BigDecimal(String.valueOf(invoice.get("round_off"))), credited.get("round_off"), "credited round-off");
        same(new BigDecimal(String.valueOf(invoice.get("total_amount"))), credited.get("total"), "credited total");
        same(invoiceTax.getCgst(), credited.get("cgst"), "credited CGST");
        same(invoiceTax.getSgst(), credited.get("sgst"), "credited SGST");
        same(invoiceTax.getIgst(), credited.get("igst"), "credited IGST");
        assertEquals(invoice.get("tax_head"), credited.get("tax_head"));
        assertEquals(invoice.get("seller_gstin"), credited.get("seller_gstin"));
        assertEquals(invoice.get("place_of_supply_state"), credited.get("pos"));
        // Line by line: quantity and every amount of an invoice line equal what was credited on it.
        for (Map<String, Object> pair : db.queryForList("SELECT li.id, li.quantity, li.taxable_value, li.cgst, li.sgst, li.igst, li.amount, "
                + "(SELECT sum(c.quantity) FROM commerce_credit_note_line c WHERE c.invoice_line_item_id = li.id) AS c_quantity, "
                + "(SELECT sum(c.taxable_value) FROM commerce_credit_note_line c WHERE c.invoice_line_item_id = li.id) AS c_taxable, "
                + "(SELECT sum(c.cgst) FROM commerce_credit_note_line c WHERE c.invoice_line_item_id = li.id) AS c_cgst, "
                + "(SELECT sum(c.sgst) FROM commerce_credit_note_line c WHERE c.invoice_line_item_id = li.id) AS c_sgst, "
                + "(SELECT sum(c.amount) FROM commerce_credit_note_line c WHERE c.invoice_line_item_id = li.id) AS c_amount "
                + "FROM invoice_line_item li WHERE li.invoice_id = ?", invoiceId)) {
            assertEquals(((Number) pair.get("quantity")).longValue(), ((Number) pair.get("c_quantity")).longValue());
            same(new BigDecimal(String.valueOf(pair.get("taxable_value"))), pair.get("c_taxable"), "line taxable");
            same(new BigDecimal(String.valueOf(pair.get("cgst"))), pair.get("c_cgst"), "line cgst");
            same(new BigDecimal(String.valueOf(pair.get("sgst"))), pair.get("c_sgst"), "line sgst");
            same(new BigDecimal(String.valueOf(pair.get("amount"))), pair.get("c_amount"), "line amount");
        }
        note("-- part " + part.getCreditNoteNumber() + " total " + part.getTotal() + " + rest " + rest.getCreditNoteNumber() + " total " + rest.getTotal()
                + " = invoice total " + invoice.get("total_amount"));

        // Nothing is left to credit, the invoice row is untouched, and the order has no live document.
        RuntimeException nothingLeft = assertThrows(RuntimeException.class, () -> creditNoteService.issue(instA, actor,
                CreditNoteRequest.builder().clientRequestId("third-" + run).invoiceId(invoiceId).reason("again").full(true).build()));
        note("-- a third credit note is refused: " + nothingLeft.getMessage());
        assertEquals(firstNumber + 2, nextValue(creditSeriesId), "the refused note took no number");
        assertEquals("GENERATED", db.queryForObject("SELECT status FROM invoice WHERE id = ?", String.class, invoiceId));
        assertTrue(inTransaction(() -> commerceInvoiceService.liveDocument(instA, List.of(invoiceLogId))).isEmpty());
        // A credit note of another institute's invoice is not found.
        assertThrows(RuntimeException.class, () -> creditNoteService.issue(UUID.randomUUID().toString(), actor,
                CreditNoteRequest.builder().clientRequestId("foreign-" + run).invoiceId(invoiceId).full(true).build()));
    }

    @Test
    @Order(14)
    void documents_thePdfIsDrawnFromTheStoredDocument() throws Exception {
        note("");
        note("== PDF");
        String fileId = pdfService.storeInvoicePdf(invoiceId);
        assertNotNull(fileId);
        byte[] pdf = awaitUpload("invoice_");
        Path out = evidence.resolveSibling("commerce-proof-invoice-" + run + ".pdf");
        Files.write(out, pdf);
        assertTrue(pdf.length > 1000, "PDF size " + pdf.length);
        assertEquals("%PDF", new String(pdf, 0, 4, java.nio.charset.StandardCharsets.US_ASCII));
        String text;
        try (PDDocument document = PDDocument.load(pdf)) {
            text = new PDFTextStripper().getText(document);
        }
        String flat = text.replace(",", "");
        note("-- invoice PDF " + out + " (" + pdf.length + " bytes); text:");
        text.lines().filter(l -> !l.isBlank()).forEach(l -> note("   | " + l));
        assertTrue(text.contains(invoiceNumber), "the PDF shows the number " + invoiceNumber);
        assertTrue(flat.contains(invoiceTax.getTotal().setScale(2).toPlainString()), "the PDF shows the total " + invoiceTax.getTotal());
        assertTrue(flat.contains(invoiceTax.getTaxableValue().setScale(2).toPlainString()), "the PDF shows the taxable value " + invoiceTax.getTaxableValue());
        assertTrue(flat.contains(invoiceTax.getCgst().setScale(2).toPlainString()), "the PDF shows CGST " + invoiceTax.getCgst());
        assertTrue(text.contains(SELLER_GSTIN), "the PDF shows the seller GSTIN");
        assertEquals(fileId, db.queryForObject("SELECT pdf_file_id FROM invoice WHERE id = ?", String.class, invoiceId));

        Map<String, Object> creditRow = db.queryForMap("SELECT id, credit_note_number, total FROM commerce_credit_note WHERE invoice_id = ? ORDER BY credit_note_number DESC LIMIT 1", invoiceId);
        assertNotNull(pdfService.storeCreditNotePdf(String.valueOf(creditRow.get("id"))));
        byte[] creditPdf = awaitUpload("credit_note_");
        Path creditOut = evidence.resolveSibling("commerce-proof-credit-note-" + run + ".pdf");
        Files.write(creditOut, creditPdf);
        String creditText;
        try (PDDocument document = PDDocument.load(creditPdf)) {
            creditText = new PDFTextStripper().getText(document);
        }
        note("-- credit note PDF " + creditOut + " (" + creditPdf.length + " bytes)");
        assertTrue(creditPdf.length > 1000);
        assertTrue(creditText.contains(invoiceNumber), "the credit note names its invoice");
    }

    @Test
    @Order(15)
    void documents_twoIssuersOfOneOrderGetOneInvoice_andAReturnedOrderGetsNoSecondOne() {
        note("");
        note("== one invoice per order");
        TaxResult tax = tax(raced, 1);
        for (int round = 0; round < 5; round++) {
            int r = round;
            String log = paymentLog(raced, 1, "twin" + r + "-" + run);
            long before = nextValue(invoiceSeriesId);
            // The pack step, a second click and the retry job, all at once, each in its own transaction.
            List<Object> results = race(4, i -> new TransactionTemplate(transactionManager).execute(status ->
                    commerceInvoiceService.issue(instA, invoiceRequest(log, tax, "twin" + r + "-" + run)).invoice().getId()));
            assertTrue(results.stream().allMatch(x -> x instanceof String), "round " + r + ": " + results);
            assertEquals(1, new TreeSet<>(results.stream().map(String::valueOf).toList()).size(),
                    "round " + r + ": every issuer got the same invoice " + results);
            assertEquals(1, count("SELECT count(*) FROM invoice_payment_log_mapping WHERE payment_log_id = ?", log), "round " + r);
            assertEquals(before + 1, nextValue(invoiceSeriesId), "round " + r + ": one number taken");
        }
        note("-- 5 rounds of 4 issuers on one order: one invoice and one number each round");

        // The first order was credited in full (returned). Nothing bills it again.
        ConflictException closed = assertThrows(ConflictException.class, () -> inTransaction(
                () -> commerceInvoiceService.issue(instA, invoiceRequest(invoiceLogId, invoiceTax, "o1-" + run))));
        note("-- issue for an order whose invoice was credited in full: " + closed.getMessage());
        assertTrue(closed.getMessage().startsWith("INVOICE_FULLY_CREDITED"));
        assertEquals(1, count("SELECT count(*) FROM invoice_payment_log_mapping WHERE payment_log_id = ?", invoiceLogId));
    }

    @Test
    @Order(16)
    void documents_aRepeatedCreditNoteRequestIssuesOneNote() {
        note("");
        note("== a credit note request sent twice");
        String log = paymentLog(costed, 3, "cn3-" + run);
        TaxResult tax3 = tax(costed, 3);
        String threeUnits = inTransaction(() -> commerceInvoiceService.issue(instA, invoiceRequest(log, tax3, "cn3-" + run)).invoice().getId());
        String itemLine = db.queryForObject("SELECT id FROM invoice_line_item WHERE invoice_id = ? AND item_type = 'COMMERCE_ITEM'",
                String.class, threeUnits);
        long start = nextValue(creditSeriesId);
        Supplier<CreditNoteRequest> oneUnit = () -> CreditNoteRequest.builder().clientRequestId("cn-" + run)
                .invoiceId(threeUnits).reason("one unit returned")
                .lines(List.of(CreditNoteLineRequest.builder().invoiceLineItemId(itemLine).quantity(1).build())).build();

        CreditNoteDTO first = creditNoteService.issue(instA, actor, oneUnit.get());
        CreditNoteDTO again = creditNoteService.issue(instA, actor, oneUnit.get());
        assertEquals(first.getId(), again.getId(), "the repeat is answered with the first note");
        assertEquals(first.getCreditNoteNumber(), again.getCreditNoteNumber());
        assertEquals(start + 1, nextValue(creditSeriesId), "one number for the two calls");

        // The same request four times at once, with a new key.
        List<Object> results = race(4, i -> creditNoteService.issue(instA, actor, CreditNoteRequest.builder()
                .clientRequestId("cn-race-" + run).invoiceId(threeUnits)
                .lines(List.of(CreditNoteLineRequest.builder().invoiceLineItemId(itemLine).quantity(1).build())).build()).getId());
        assertTrue(results.stream().allMatch(x -> x instanceof String), String.valueOf(results));
        assertEquals(1, new TreeSet<>(results.stream().map(String::valueOf).toList()).size(), String.valueOf(results));
        assertEquals(2, count("SELECT count(*) FROM commerce_credit_note WHERE invoice_id = ?", threeUnits));
        assertEquals(2, count("SELECT COALESCE(sum(quantity), 0) FROM commerce_credit_note_line WHERE invoice_line_item_id = ?", itemLine),
                "two units credited by six calls, not six");
        assertEquals(start + 2, nextValue(creditSeriesId));
        note("-- 2 calls with one key and 4 at once with another: 2 credit notes, 2 units, 2 numbers");

        // The key of the first note with other content.
        ConflictException reused = assertThrows(ConflictException.class, () -> creditNoteService.issue(instA, actor,
                CreditNoteRequest.builder().clientRequestId("cn-" + run).invoiceId(threeUnits).full(true).build()));
        assertTrue(reused.getMessage().startsWith("REQUEST_KEY_REUSED"), reused.getMessage());
        // No key, and a date after today (which would open next year's series).
        assertThrows(InvalidRequestException.class, () -> creditNoteService.issue(instA, actor,
                CreditNoteRequest.builder().invoiceId(threeUnits).full(true).build()));
        assertThrows(InvalidRequestException.class, () -> creditNoteService.issue(instA, actor,
                CreditNoteRequest.builder().clientRequestId("cn-future-" + run).invoiceId(threeUnits).full(true)
                        .documentDate(documentClock.today(instA).plusYears(1)).build()));
        assertEquals(start + 2, nextValue(creditSeriesId), "the refused requests took no number");
        assertEquals(1, count("SELECT count(*) FROM commerce_document_series WHERE institute_id = ? AND document_type = 'CREDIT_NOTE'", instA),
                "no series was opened for a later year");
    }

    @Test
    @Order(17)
    void documents_theOldInvoiceReadersNeverReturnAShopDocument() {
        note("");
        note("== the course invoice readers leave shop documents out");
        long shopDocuments = count("SELECT count(*) FROM invoice WHERE institute_id = ? AND user_id = ? AND document_type IS NOT NULL", instA, buyer);
        assertTrue(shopDocuments > 50, "the buyer has " + shopDocuments + " shop documents");
        java.time.LocalDateTime from = java.time.LocalDateTime.now().minusYears(1);
        java.time.LocalDateTime to = java.time.LocalDateTime.now().plusYears(1);

        assertTrue(inTransaction(() -> invoiceRepository.findByUserIdOrderByCreatedAtDesc(buyer)).isEmpty(), "by user");
        assertTrue(inTransaction(() -> invoiceRepository.findByUserIdAndInstituteIdOrderByCreatedAtDesc(buyer, instA)).isEmpty(),
                "by user and institute");
        // The institute list query (findByInstituteIdWithFilters) is not run here: as it stands
        // on main it cannot be prepared on a plain Postgres ("could not determine data type of
        // parameter" on its ":startDate IS NULL" test), commerce or not. Its exclusion of shop
        // documents is asserted from the query text in LegacyPathsRefuseCommerceDocumentsTest.
        assertTrue(inTransaction(() -> invoiceRepository.findForBulkExport(instA, from, to,
                org.springframework.data.domain.PageRequest.of(0, 20))).isEmpty(), "the bulk export");

        // The lookup by email resolves the buyer and returns nothing of the shop.
        when(authService.getUserByEmail(anyString())).thenAnswer(call -> {
            UserDTO user = new UserDTO();
            user.setId(buyer);
            user.setEmail(call.getArgument(0));
            return user;
        });
        assertEquals(0, invoiceService.getInvoicesByEmailPublic("buyer@example.invalid", instA).getTotalInvoices());
        assertEquals(0, invoiceService.getInvoicesByEmailPublic("buyer@example.invalid", null).getTotalInvoices());
        // By id: the payment-link read and the download path.
        VacademyException byId = assertThrows(VacademyException.class, () -> invoiceService.getInvoiceById(invoiceId));
        assertTrue(byId.getMessage().contains("Invoice not found"), byId.getMessage());
        assertNull(invoiceService.resolveOrRegeneratePdfUrl(invoiceId), "no PDF link through the course download path");
        note("-- " + shopDocuments + " shop documents of the buyer; the list reads, the by-email read, "
                + "the read by id and the download path return none");

        // Through the commerce endpoint service it is there as before.
        assertEquals(invoiceNumber, commerceInvoiceService.get(instA, invoiceId).getInvoiceNumber());
    }

    @Test
    @Order(18)
    void documents_atTheTurnOfTheYearEverySeriesIsCarried_soAStoreKeepsItsOwn() {
        note("");
        note("== the turn of the financial year");
        DocumentSeriesDTO general = DocumentSeriesDTO.builder().prefix(String.valueOf(
                db.queryForObject("SELECT prefix FROM commerce_document_series WHERE id = ?", String.class, invoiceSeriesId))).build();
        DocumentSeriesDTO store = seriesService.create(instA, actor, DocumentSeriesDTO.builder()
                .documentType("TAX_INVOICE").prefix("SH" + run.substring(0, 2)).locationId(shop).build());
        int startMonth = taxSettingService.context(instA).getFyStartMonth();
        String nextYear = FinancialYear.of(documentClock.today(instA).plusYears(1), startMonth);
        String yearAfter = FinancialYear.of(documentClock.today(instA).plusYears(2), startMonth);

        // The first document of the new year is an online order; the store bills later.
        String online = inTransaction(() -> numberService.allocate(instA, DocumentType.TAX_INVOICE, nextYear, SELLER_GSTIN,
                wh, null, "ONLINE").number());
        String atStore = inTransaction(() -> numberService.allocate(instA, DocumentType.TAX_INVOICE, nextYear, SELLER_GSTIN,
                shop, null, "POS").number());
        note("-- " + nextYear + ": first document online " + online + ", then the store " + atStore);
        assertEquals(DocumentNumberAllocator.format(general.getPrefix(), nextYear, 1), online);
        assertEquals(DocumentNumberAllocator.format(store.getPrefix(), nextYear, 1), atStore,
                "the store's own series was opened too, although the online order came first");
        sql("tax invoice series of " + nextYear, "SELECT prefix, location_id IS NOT NULL AS of_a_location, next_value, status "
                + "FROM commerce_document_series WHERE institute_id = ? AND document_type = 'TAX_INVOICE' AND financial_year = ? ORDER BY prefix",
                instA, nextYear);
        assertEquals(2, count("SELECT count(*) FROM commerce_document_series WHERE institute_id = ? AND document_type = 'TAX_INVOICE' "
                + "AND financial_year = ?", instA, nextYear));

        // Ten first documents of the year after, at once, online and at the store.
        List<Object> results = race(10, i -> inTransaction(() -> numberService.allocate(instA, DocumentType.TAX_INVOICE,
                yearAfter, SELLER_GSTIN, i % 2 == 0 ? wh : shop, null, i % 2 == 0 ? "ONLINE" : "POS").number()));
        assertTrue(results.stream().allMatch(x -> x instanceof String), String.valueOf(results));
        List<String> expected = new ArrayList<>();
        for (int value = 1; value <= 5; value++) {
            expected.add(DocumentNumberAllocator.format(general.getPrefix(), yearAfter, value));
            expected.add(DocumentNumberAllocator.format(store.getPrefix(), yearAfter, value));
        }
        assertEquals(new TreeSet<>(expected), new TreeSet<>(results.stream().map(String::valueOf).toList()),
                "five consecutive numbers on each series");
        assertEquals(2, count("SELECT count(*) FROM commerce_document_series WHERE institute_id = ? AND document_type = 'TAX_INVOICE' "
                + "AND financial_year = ?", instA, yearAfter));
        note("-- " + yearAfter + ": 10 first documents at once gave 1 to 5 on each of the two series");
    }

    /** The bytes handed to the media service for the first file whose name starts with the prefix and names this run's document. */
    private byte[] awaitUpload(String prefix) throws InterruptedException {
        for (int i = 0; i < 100; i++) {
            for (Map.Entry<String, byte[]> entry : uploaded.entrySet()) {
                if (entry.getKey().startsWith(prefix) && matchesFirstDocument(prefix, entry.getKey())) {
                    return entry.getValue();
                }
            }
            Thread.sleep(100);
        }
        throw new IllegalStateException("no upload starting with " + prefix + " among " + uploaded.keySet());
    }

    private boolean matchesFirstDocument(String prefix, String fileName) {
        if (prefix.startsWith("invoice")) {
            return fileName.equals("invoice_" + invoiceNumber.replaceAll("[^A-Za-z0-9_-]", "_") + ".pdf");
        }
        return true;
    }
}
