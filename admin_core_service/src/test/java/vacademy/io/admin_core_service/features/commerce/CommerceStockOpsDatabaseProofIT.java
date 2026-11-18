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
import org.junit.jupiter.api.function.Executable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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
import vacademy.io.admin_core_service.features.commerce.catalogue.controller.CommerceQuickAddController;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.CollectionDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceCollectionService;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceQuickAddService;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.label.controller.LabelController;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionClient;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceBuyerResolver;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStaffOrderService;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.StaffOrderRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosCatalogueService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosRegisterService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSaleService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSessionService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommercePinService;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockCountController;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockLevelController;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockOverviewController;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockPieceController;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockTransferController;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReorderLevelRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Approval;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountLineInput;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountView;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.ReceiveLineInput;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferLineInput;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferView;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.scheduler.StockReconciliationJob;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockChallanPdfService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLocationService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockReceiptService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockTransferService;
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
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
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
 * WP-40 stock operations (transfers with a delivery challan, counts while trading, blind recount,
 * the label queue and its print data, quick add, low stock and the overview) against a real
 * Postgres 16 with the whole Flyway chain and the real Spring context. The calls go through the
 * controllers, so every refusal of the location guard is the one a request would meet. Gate 20
 * (a count posted while the shop trades), the scanner half of gate 10 (a label's code resolves
 * at the till and at the pack station), a short transfer that the ledger explains unit by unit,
 * the challan number taken last, double taps and races. After every test the nightly
 * reconciliation finds no sellable or piece drift and every unit in transit is on a DISPATCHED
 * transfer.
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
class CommerceStockOpsDatabaseProofIT {

    private static final String SELLER_GSTIN = "09AAACH7409R1ZZ";
    private static final String OTHER_STATE_GSTIN = "27AAACH7409R1ZZ";
    private static final String PIN = "482917";
    private static final String WRONG_PIN = "731905";
    private static final String LINK_BASE = "https://shop.example";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "24");
        registry.add("commerce.order-token.secret", () -> "local-proof-only-not-a-secret");
        registry.add("commerce.turnstile.required", () -> "false");
        registry.add("commerce.payment-fetch.cron", () -> "-");
    }

    @Autowired private JdbcTemplate db;
    @Autowired private CapabilityResolver capabilityResolver;
    @Autowired private CommerceProductService productService;
    @Autowired private CommerceCollectionService collectionService;
    @Autowired private StockLocationService locationService;
    @Autowired private StockReceiptService receiptService;
    @Autowired private CommerceTaxSettingService taxSettingService;
    @Autowired private CommerceTaxClassService taxClassService;
    @Autowired private CommerceDocumentSeriesService seriesService;
    @Autowired private StorefrontSnapshotLoader snapshotLoader;
    @Autowired private StockReconciliationJob reconciliationJob;
    @Autowired private StockLevelRepository levelRepository;
    @Autowired private StockHoldService stockHoldService;
    @Autowired private CommercePinService pinService;
    @Autowired private CommerceStaffOrderService staffOrders;
    @Autowired private CommerceBuyerResolver buyerResolver;
    @Autowired private PosRegisterService registers;
    @Autowired private PosSessionService sessions;
    @Autowired private PosSaleService sales;
    @Autowired private PosCatalogueService posCatalogue;
    @Autowired private StockChallanPdfService challanPdf;
    @Autowired private StockTransferService transferService;
    // The routes, called as a request would call them (guard first, then the service).
    @Autowired private StockTransferController transfers;
    @Autowired private StockCountController counts;
    @Autowired private StockOverviewController overview;
    @Autowired private LabelController labels;
    @Autowired private CommerceQuickAddController quickAdd;
    @Autowired private StockPieceController pieceRoutes;
    @Autowired private StockLevelController levelRoutes;

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
    private final AtomicInteger phones = new AtomicInteger(300);

    private final String adminId = "admin-" + run;
    private final String managerId = "manager-" + run;
    private final String w1Id = "wh1-" + run;
    private final String w2Id = "wh2-" + run;
    private final String cashierId = "cashier-" + run;
    private final String accountantId = "accountant-" + run;
    private CustomUserDetails admin;
    private CustomUserDetails manager;   // M: L1, L2, L3, L4, with a PIN
    private CustomUserDetails w1;        // warehouse staff at L1
    private CustomUserDetails w2;        // warehouse staff at L2
    private CustomUserDetails cashier;   // C at L1
    private CustomUserDetails accountant;

    private String l1;   // store, sells online, POS register R1
    private String l2;   // warehouse, institute GSTIN (none of its own)
    private String l3;   // store with its own GSTIN of another state
    private String l4;   // spare warehouse: the deactivation race
    private String r1;
    private String challanSeries;
    private String taxClass;
    private String corner;   // collection: Steel plate, Steel tray

    private String scarf;   // PIECE 1200.00: 4 pieces at L2
    private String bottle;  // QUANTITY 450.00: 50 at L2, 10 at L1
    private String bag;     // QUANTITY 300.00: 12 at L1
    private String cloth;   // QUANTITY MTR, qty_scale 10, 25.00 a base unit: 200 base units at L1
    private String cup;     // QUANTITY 300.00: 6 at L1, promised online
    private String spoon;   // QUANTITY 50.00: 300 at L1, the race
    private String plate;   // QUANTITY 200.00: 5 at L1, in the collection
    private String tray;    // QUANTITY 250.00: 3 at L1, in the collection

    @BeforeEach
    void local() {
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), anyString(), anyBoolean()))
                .thenAnswer(call -> {
                    UserDTO asked = call.getArgument(0);
                    UserDTO user = new UserDTO();
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
                } else if (id.equals(w1Id) || id.equals(w2Id)) {
                    roles.put(id, List.of("COMMERCE_WAREHOUSE_STAFF"));
                } else if (id.equals(cashierId)) {
                    roles.put(id, List.of("COMMERCE_POS_CASHIER"));
                }
            }
            return roles;
        });
        header(inst);
        admin = user(adminId, "ADMIN");
        manager = user(managerId, "COMMERCE_STORE_MANAGER");
        w1 = user(w1Id, "COMMERCE_WAREHOUSE_STAFF");
        w2 = user(w2Id, "COMMERCE_WAREHOUSE_STAFF");
        cashier = user(cashierId, "COMMERCE_POS_CASHIER");
        accountant = user(accountantId, "COMMERCE_ACCOUNTANT");
    }

    @AfterEach
    void reconciled() {
        header(inst);
        for (String open : db.queryForList("SELECT id FROM pos_session WHERE institute_id = ? AND status = 'OPEN'",
                String.class, inst)) {
            sessions.close(admin, inst, open, new PosDtos.SessionCloseRequest(key(), sessions.detail(admin, inst, open)
                    .summary().expectedCash(), null, null, null));
        }
        // A test that stopped half-way leaves a count open: cancel it so the next test can open one.
        for (String open : db.queryForList("SELECT id FROM stock_count WHERE institute_id = ? AND status = 'OPEN' "
                + "ORDER BY kind DESC", String.class, inst)) {
            counts.cancel(admin, inst, open, new StockOpsDtos.CancelRequest(key(), "Proof clean-up"));
        }
        if (l1 != null) {
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

    private static void note(String line) {
        System.out.println("INV_PROOF " + line);
    }

    private String key() {
        return "inv-" + run + "-" + keys.incrementAndGet();
    }

    private long count(String query, Object... args) {
        Long n = db.queryForObject(query, Long.class, args);
        return n == null ? 0 : n;
    }

    private String text(String query, Object... args) {
        List<String> found = db.queryForList(query, String.class, args);
        return found.isEmpty() ? null : found.get(0);
    }

    private static void same(String expected, BigDecimal actual, String what) {
        assertNotNull(actual, what);
        assertEquals(0, new BigDecimal(expected).compareTo(actual), what + ": " + actual);
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
                .filter(d -> inst.equals(d.instituteId())).toList();
        assertTrue(drift.isEmpty(), "sellable drift " + step + ": " + drift);
        List<String> pieceDrift = levelRepository.findPieceDrift(10_000).stream()
                .filter(d -> inst.equals(d.getInstituteId()))
                .map(d -> d.getLocationId() + "/" + d.getPackageSessionId() + " on_hand " + d.getOnHand() + " pieces "
                        + d.getPieces()).toList();
        assertTrue(pieceDrift.isEmpty(), "piece drift " + step + ": " + pieceDrift);
        // Fact 11: in transit = −Σ TRANSFER_OUT/IN deltas = Σ qty_sent of DISPATCHED lines, per variant.
        List<String> transit = db.queryForList("""
                SELECT COALESCE(m.v, d.v) || ' ledger ' || COALESCE(m.a, 0) || ' lines ' || COALESCE(d.b, 0)
                FROM (SELECT package_session_id v, -SUM(quantity_delta) a FROM stock_movement
                      WHERE institute_id = ? AND type IN ('TRANSFER_OUT', 'TRANSFER_IN') GROUP BY 1) m
                FULL JOIN (SELECT l.package_session_id v, SUM(l.qty_sent) b FROM stock_transfer_line l
                           JOIN stock_transfer t ON t.id = l.transfer_id
                           WHERE t.institute_id = ? AND t.status = 'DISPATCHED' GROUP BY 1) d ON d.v = m.v
                WHERE COALESCE(m.a, 0) <> COALESCE(d.b, 0)
                """, String.class, inst, inst);
        assertTrue(transit.isEmpty(), "in transit off the DISPATCHED lines " + step + ": " + transit);
        // A piece in transit has no location and sits on a DISPATCHED transfer line.
        assertEquals(0, count("""
                SELECT count(*) FROM commerce_piece p WHERE p.institute_id = ? AND p.status = 'IN_TRANSIT'
                  AND (p.location_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM stock_transfer_line l JOIN stock_transfer t
                       ON t.id = l.transfer_id WHERE l.piece_id = p.id AND t.status = 'DISPATCHED'))
                """, inst), "every piece in transit is on a dispatched transfer (" + step + ")");
    }

    private void noCost(Object answer, String what) throws Exception {
        String wire = answer instanceof String s ? s.toLowerCase() : json.writeValueAsString(answer).toLowerCase();
        for (String field : List.of("\"cost", "_cost", "cost_price", "standard_cost", "value_up", "value_down")) {
            assertFalse(wire.contains(field), what + " carries " + field + ": " + wire);
        }
    }

    private String location(String code, boolean store, boolean sellsOnline, String gstin, String state) {
        LocationRequest location = new LocationRequest();
        location.setCode(code + "-" + run);
        location.setName(code + " " + run);
        location.setAddressLine1("1 Test Road");
        location.setCity("Test City");
        location.setPincode("100001");
        location.setStateCode(state);
        location.setGstin(gstin);
        location.setIsStore(store);
        location.setIsWarehouse(!store || sellsOnline);
        location.setIsPosEnabled(sellsOnline);
        location.setSellsOnline(sellsOnline);
        return locationService.create(inst, adminId, true, location).getId();
    }

    private String product(String slug, String en, String hi, String sku, String price, boolean pieces, String unit,
                           int qtyScale, List<String> collections) {
        List<ProductTranslationDTO> names = new ArrayList<>();
        names.add(ProductTranslationDTO.builder().locale("en").name(en).build());
        if (hi != null) {
            names.add(ProductTranslationDTO.builder().locale("hi").name(hi).build());
        }
        ProductRequest request = ProductRequest.builder().slug(slug + "-" + run).translations(names)
                .taxClassId(taxClass).status("ACTIVE").stockMode(pieces ? "PIECE" : "QUANTITY").unit(unit)
                .qtyScale(qtyScale).collectionIds(collections)
                .variants(List.of(VariantRequest.builder().sku(sku + "-" + run).name("One size")
                        .price(new BigDecimal(price)).weightGrams(200).build()))
                .build();
        return productService.save(inst, adminId, request).getVariants().get(0).getPackageSessionId();
    }

    private String receive(String actor, String locationId, String variant, int quantity, String unitCost) {
        ReceiptRequest request = new ReceiptRequest();
        request.setLocationId(locationId);
        request.setSourceKind("OTHER");
        request.setNote("proof stock");
        request.setClientRequestId("rc-" + key());
        List<ReceiptRequest.Line> lines = new ArrayList<>();
        ReceiptRequest.Line line = new ReceiptRequest.Line();
        line.setPackageSessionId(variant);
        line.setQuantity(quantity);
        line.setUnitCost(unitCost == null ? null : new BigDecimal(unitCost));
        lines.add(line);
        request.setLines(lines);
        return receiptService.create(inst, actor, unitCost != null, request).getId();
    }

    private void assign(String userId, String... locationIds) {
        for (String locationId : locationIds) {
            db.update("INSERT INTO commerce_staff_location (id, institute_id, user_id, location_id, created_by) "
                    + "VALUES (?, ?, ?, ?, ?)", UUID.randomUUID().toString(), inst, userId, locationId, adminId);
        }
    }

    private int onHand(String locationId, String variant) {
        return (int) count("SELECT COALESCE(SUM(on_hand), 0) FROM stock_level WHERE location_id = ? AND "
                + "package_session_id = ?", locationId, variant);
    }

    private int slots(String variant) {
        return db.queryForObject("SELECT available_slots FROM package_session WHERE id = ?", Integer.class, variant);
    }

    private int maxSeats(String variant) {
        return db.queryForObject("SELECT max_seats FROM package_session WHERE id = ?", Integer.class, variant);
    }

    private long nextChallan() {
        return count("SELECT next_value FROM commerce_document_series WHERE id = ?", challanSeries);
    }

    private long movements() {
        return count("SELECT count(*) FROM stock_movement WHERE institute_id = ?", inst);
    }

    private List<String> pieces(String variant, String locationId, String status) {
        return db.queryForList("SELECT id FROM commerce_piece WHERE package_session_id = ? AND location_id = ? AND "
                + "status = ? ORDER BY code", String.class, variant, locationId, status);
    }

    private String pieceStatus(String pieceId) {
        return text("SELECT status FROM commerce_piece WHERE id = ?", pieceId);
    }

    private String pieceLocation(String pieceId) {
        return text("SELECT location_id FROM commerce_piece WHERE id = ?", pieceId);
    }

    private String transferStatus(String id) {
        return text("SELECT status FROM stock_transfer WHERE id = ?", id);
    }

    private static TransferLineInput qty(String variant, int quantity) {
        return new TransferLineInput(variant, quantity, null, null, null);
    }

    private static TransferLineInput piece(String pieceId) {
        return new TransferLineInput(null, null, pieceId, null, null);
    }

    private static Approval pin(String approver, String raw) {
        return new Approval(approver, raw, "Checked by the manager");
    }

    private TransferView draft(CustomUserDetails who, String from, String to, List<TransferLineInput> lines) {
        return body(transfers.create(who, inst, new StockOpsDtos.TransferCreateRequest(key(), from, to, null, lines)));
    }

    private TransferView dispatch(CustomUserDetails who, String transferId) {
        return body(transfers.dispatch(who, inst, transferId,
                new StockOpsDtos.TransferDispatchRequest(key(), null, null, null, null)));
    }

    /** Every line arrives in full. */
    private TransferView receiveAll(CustomUserDetails who, TransferView sent) {
        List<ReceiveLineInput> lines = new ArrayList<>();
        sent.lines().forEach(line -> lines.add(new ReceiveLineInput(line.id(), line.qtySent(), null)));
        return body(transfers.receive(who, inst, sent.id(),
                new StockOpsDtos.TransferReceiveRequest(key(), lines, null, null)));
    }

    private StockOpsDtos.TransferLineView lineOf(TransferView view, String variant, String pieceId) {
        return view.lines().stream().filter(l -> l.packageSessionId().equals(variant)
                && (pieceId == null || pieceId.equals(l.pieceId()))).findFirst().orElseThrow();
    }

    private CountView openCount(CustomUserDetails who, String locationId, String kind, String scope, String recountOf) {
        return body(counts.open(who, inst, new StockOpsDtos.CountCreateRequest(key(), locationId, kind, scope, recountOf,
                null)));
    }

    private StockOpsDtos.CountLinesAnswer countLines(CustomUserDetails who, String countId, CountLineInput... lines) {
        return body(counts.lines(who, inst, countId, new StockOpsDtos.CountLinesRequest(key(), List.of(lines))));
    }

    private static CountLineInput set(String variant, int quantity) {
        return new CountLineInput(variant, "SET", quantity, null, null);
    }

    private static CountLineInput add(String variant, int quantity) {
        return new CountLineInput(variant, "ADD", quantity, null, null);
    }

    private static CountLineInput scanned(String pieceCode) {
        return new CountLineInput(null, null, null, pieceCode, null);
    }

    private String pieceCode(String pieceId) {
        return text("SELECT code FROM commerce_piece WHERE id = ?", pieceId);
    }

    /** Opens R1 with the float the last close left in the drawer (so no opening note is needed). */
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

    private String sell(String session, String variant, int quantity, String total) {
        return sales.sale(cashier, inst, new PosDtos.SaleRequest(key(), session,
                List.of(new PosDtos.SaleLine("l1", variant, quantity, null, null, null)), null, null,
                List.of(new PosDtos.Tender("CASH", new BigDecimal(total), null, null)), null, null, null, null, null))
                .answer().sale().orderId();
    }

    private List<LabelDtos.LabelRow> labelRows(CustomUserDetails who, String sourceId) {
        return body(labels.list(who, inst, null, null, null, "STOCK_RECEIPT", sourceId, 0, 100)).requests();
    }

    // ================================================================== 1. the shop

    @Test
    @Order(1)
    void migrationAppliedAndShopSeeded() throws Exception {
        assertEquals(1, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version = '725'"));
        assertEquals("725", text("SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC "
                + "LIMIT 1"), "Flyway target 725");
        for (String table : List.of("stock_transfer", "stock_transfer_line", "stock_count", "stock_count_line",
                "commerce_label_request")) {
            assertNotNull(text("SELECT to_regclass(?)::text", "public." + table), table);
        }
        assertEquals(2, count("SELECT count(*) FROM pg_indexes WHERE tablename = 'stock_count' AND indexdef LIKE "
                + "'%UNIQUE%' AND indexdef LIKE '%WHERE%'"), "the two partial unique indexes of open counts");

        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', "
                + "'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), "
                + "('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", inst,
                "Stock Proof " + run, "https://learn-" + run + ".example.com");
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", otherInst,
                "Other Proof " + run, "https://other-" + run + ".example.com");
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)",
                inst);
        // The shop's one verified website: the label QR holds https://shop.example/q/<code>.
        db.update("INSERT INTO institute_website (id, institute_id, host, status, verification_token, verified_at) "
                + "VALUES (?, ?, 'shop.example', 'VERIFIED', ?, now())", UUID.randomUUID().toString(), inst,
                "token-" + run);
        capabilityResolver.evict(inst);
        capabilityResolver.evict(otherInst);
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

        l1 = location("ST1", true, true, SELLER_GSTIN, "09");
        l2 = location("WH2", false, false, null, "09");
        l3 = location("ST3", true, false, OTHER_STATE_GSTIN, "27");
        l4 = location("WH4", false, false, null, "09");
        assign(managerId, l1, l2, l3, l4);
        assign(w1Id, l1);
        assign(w2Id, l2);
        assign(cashierId, l1);
        assign(accountantId, l1, l2);
        pinService.setPin(inst, managerId, PIN);

        // The challan series: a manager without a location and warehouse staff are refused; ADMIN adds it.
        assertEquals("ROLE_NOT_ALLOWED", code(() -> transfers.createChallanSeries(w2, inst,
                new StockOpsDtos.ChallanSeriesRequest("DX/", l2, null, null))));
        assertEquals("ROLE_NOT_ALLOWED", code(() -> transfers.createChallanSeries(manager, inst,
                new StockOpsDtos.ChallanSeriesRequest("DX/", null, null, null))));
        challanSeries = body(transfers.createChallanSeries(admin, inst,
                new StockOpsDtos.ChallanSeriesRequest("DC/", null, null, null))).getId();
        assertEquals(1, nextChallan());
        assertEquals(1, body(transfers.challanSeries(w2, inst)).size(), "warehouse staff read the challan series");

        corner = collectionService.create(inst, adminId, CollectionDTO.builder()
                .nameI18n(Map.of("en", "Count corner " + run)).build()).getId();
        scarf = product("cotton-scarf", "Cotton scarf", "सूती स्कार्फ", "SCARF", "1200.00", true, "PCS", 1, null);
        bottle = product("steel-bottle", "Steel bottle", "स्टील की बोतल", "BOTTLE", "450.00", false, "PCS", 1, null);
        bag = product("canvas-bag", "Canvas bag", "कैनवस थैला", "BAG", "300.00", false, "PCS", 1, null);
        cloth = product("cotton-cloth", "Cotton cloth", "सूती कपड़ा", "CLOTH", "25.00", false, "MTR", 10, null);
        cup = product("steel-cup", "Steel cup", null, "CUP", "300.00", false, "PCS", 1, null);
        spoon = product("steel-spoon", "Steel spoon", null, "SPOON", "50.00", false, "PCS", 1, null);
        plate = product("steel-plate", "Steel plate", null, "PLATE", "200.00", false, "PCS", 1, List.of(corner));
        tray = product("steel-tray", "Steel tray", null, "TRAY", "250.00", false, "PCS", 1, List.of(corner));
        receive(adminId, l2, scarf, 4, "500.00");
        receive(adminId, l2, bottle, 50, "100.00");
        receive(adminId, l1, bottle, 10, "100.00");
        receive(adminId, l1, bag, 12, "120.00");
        receive(adminId, l1, cloth, 200, "10.00");
        receive(adminId, l1, cup, 6, "120.00");
        receive(adminId, l1, spoon, 300, "20.00");
        receive(adminId, l1, plate, 5, "80.00");
        receive(adminId, l1, tray, 3, "90.00");
        snapshotLoader.evict(inst);

        r1 = registers.create(admin, inst, new PosDtos.RegisterCreateRequest(key(), l1, "r1-" + run.substring(0, 4),
                "Front counter", "R1" + run.substring(0, 2).toUpperCase(), null)).register().id();
        assertEquals(10, maxSeats(bottle), "max_seats = units at the online location");
        assertEquals(0, maxSeats(scarf), "no scarf at the online location yet");
        assertEquals(4, pieces(scarf, l2, "IN_STOCK").size());
        noDrift("seed");
    }

    // ================================================================== 2. a transfer in full

    @Test
    @Order(2)
    void transferHappyPathWithChallan() throws Exception {
        List<String> atL2 = pieces(scarf, l2, "IN_STOCK");
        String s1 = atL2.get(0);
        String s2 = atL2.get(1);
        int bottlesL2 = onHand(l2, bottle);
        int bottlesL1 = onHand(l1, bottle);
        int bottleSlots = slots(bottle);
        int scarfSlots = slots(scarf);

        // Refusals that write nothing.
        assertEquals("TRANSFER_SAME_LOCATION", code(() -> draft(w2, l2, l2, List.of())));
        assertEquals("PIECE_SCAN_REQUIRED", code(() -> draft(w2, l2, l1, List.of(qty(scarf, 2)))));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> draft(w1, l2, l1, List.of(qty(bottle, 1)))),
                "W1 does not work at the source");
        assertEquals("ROLE_NOT_ALLOWED", code(() -> draft(cashier, l1, l2, List.of(qty(bottle, 1)))));
        assertEquals(0, count("SELECT count(*) FROM stock_transfer WHERE institute_id = ?", inst));

        // A draft, a replay of it, and the same key with another body.
        String createKey = key();
        StockOpsDtos.TransferCreateRequest create = new StockOpsDtos.TransferCreateRequest(createKey, l2, l1, null,
                List.of(qty(bottle, 3)));
        ResponseEntity<TransferView> made = transfers.create(w2, inst, create);
        assertEquals(HttpStatus.CREATED, made.getStatusCode());
        TransferView draft = made.getBody();
        assertEquals("DRAFT", draft.status());
        assertTrue(draft.transferNumber().matches("TRF-\\d{6}"), draft.transferNumber());
        assertFalse(draft.warnings().contains("NO_CHALLAN_SERIES"), draft.warnings().toString());
        assertTrue(draft.nextActions().contains("DISPATCH"), draft.nextActions().toString());
        ResponseEntity<TransferView> again = transfers.create(w2, inst, create);
        assertEquals(HttpStatus.OK, again.getStatusCode());
        assertEquals(Boolean.TRUE, again.getBody().replayed());
        assertEquals(draft.id(), again.getBody().id());
        assertEquals("IDEMPOTENCY_MISMATCH", code(() -> transfers.create(w2, inst,
                new StockOpsDtos.TransferCreateRequest(createKey, l2, l1, null, List.of(qty(bottle, 4))))));
        assertEquals(1, count("SELECT count(*) FROM stock_transfer WHERE institute_id = ?", inst));

        // Header saved after the lines are replaced (risky spot: native delete + entity save).
        TransferView edited = body(transfers.update(w2, inst, draft.id(), new StockOpsDtos.TransferUpdateRequest(key(),
                null, "Weekly refill", List.of(piece(s1), piece(s2), qty(bottle, 5)))));
        assertEquals(3, edited.lines().size());
        assertEquals("Weekly refill", text("SELECT note FROM stock_transfer WHERE id = ?", draft.id()));
        assertEquals(3, count("SELECT count(*) FROM stock_transfer_line WHERE transfer_id = ?", draft.id()));
        assertEquals(0, movementsOf(draft.id()), "a draft moves nothing");
        noCost(edited, "a draft for warehouse staff");

        // The lists with every filter empty (risky spot: null parameters in the JPQL search).
        assertTrue(body(transfers.list(admin, inst, null, null, null, null, 0, 50)).transfers().stream()
                .anyMatch(t -> t.id().equals(draft.id())));
        assertTrue(body(transfers.list(w2, inst, null, null, null, null, 0, 50)).transfers().stream()
                .anyMatch(t -> t.id().equals(draft.id())));
        assertTrue(body(transfers.list(w1, inst, "DRAFT", "IN", l1, 7, 0, 50)).transfers().stream()
                .anyMatch(t -> t.id().equals(draft.id())), "W1 sees the transfer coming in");
        assertEquals(0, body(transfers.list(w1, inst, null, "OUT", l1, null, 0, 50)).total());

        // Dispatch: W1 is not at the source; W2 sends.
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> dispatch(w1, draft.id())));
        long before = movements();
        TransferView sent = dispatch(w2, draft.id());
        assertEquals("DISPATCHED", sent.status());
        assertEquals("DISPATCHED", transferStatus(draft.id()), "header saved after the line stamps");
        assertEquals("DELIVERY_CHALLAN", sent.documentType());
        assertTrue(sent.documentNumber().startsWith("DC/") && sent.documentNumber().endsWith("-00001"),
                sent.documentNumber());
        assertEquals(challanSeries, text("SELECT document_series_id FROM stock_transfer WHERE id = ?", draft.id()));
        assertEquals(2, nextChallan(), "one number taken");
        assertEquals(before + 3, movements());
        assertEquals(3, count("SELECT count(*) FROM stock_movement WHERE transfer_id = ? AND type = 'TRANSFER_OUT' "
                + "AND location_id = ? AND reference_type = 'STOCK_TRANSFER'", draft.id(), l2));
        for (String p : List.of(s1, s2)) {
            assertEquals("IN_TRANSIT", pieceStatus(p));
            assertNull(pieceLocation(p), "a piece on the way has no location");
        }
        assertEquals(bottlesL2 - 5, onHand(l2, bottle));
        same("450.00", lineOf(sent, bottle, null).unitValue(), "unit value copied");
        assertEquals("0000", lineOf(sent, bottle, null).hsnCode());
        assertEquals("0000", text("SELECT hsn_code FROM stock_transfer_line WHERE transfer_id = ? AND piece_id IS NULL",
                draft.id()));
        assertEquals(7, sent.totals().qtySent());
        assertEquals(7, count("SELECT -SUM(quantity_delta) FROM stock_movement WHERE transfer_id = ?", draft.id()),
                "in transit 7");
        assertEquals("TRANSFER_DISPATCHED", code(() -> transfers.cancel(w2, inst, draft.id(),
                new StockOpsDtos.CancelRequest(key(), null))));
        noDrift("on the way");

        // The challan, read at the destination.
        byte[] pdf = body(transfers.challan(w1, inst, draft.id()));
        assertTrue(new String(pdf, 0, 5, StandardCharsets.ISO_8859_1).startsWith("%PDF"));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> transfers.receive(w2, inst, draft.id(),
                new StockOpsDtos.TransferReceiveRequest(key(), List.of(), null, null))), "receive is at the destination");

        TransferView got = receiveAll(w1, sent);
        assertEquals("RECEIVED", got.status());
        assertEquals("RECEIVED", transferStatus(draft.id()));
        assertEquals(3, count("SELECT count(*) FROM stock_movement WHERE transfer_id = ? AND type = 'TRANSFER_IN' "
                + "AND location_id = ?", draft.id(), l1));
        for (String p : List.of(s1, s2)) {
            assertEquals("IN_STOCK", pieceStatus(p));
            assertEquals(l1, pieceLocation(p));
        }
        assertEquals(bottlesL1 + 5, onHand(l1, bottle));
        assertEquals(bottleSlots + 5, slots(bottle), "the online location sells what arrived");
        assertEquals(scarfSlots + 2, slots(scarf));
        assertEquals(0, count("SELECT COALESCE(-SUM(quantity_delta), 0) FROM stock_movement WHERE transfer_id = ?",
                draft.id()), "in transit back to 0");
        noCost(got, "the received transfer for warehouse staff");
        note("transfer " + sent.transferNumber() + " challan " + sent.documentNumber() + " pdf " + pdf.length + " bytes");
    }

    private long movementsOf(String transferId) {
        return count("SELECT count(*) FROM stock_movement WHERE transfer_id = ?", transferId);
    }

    // ================================================================== 3. a short transfer

    @Test
    @Order(3)
    void shortTransferLedgerExplainsEveryUnit() throws Exception {
        List<String> atL2 = pieces(scarf, l2, "IN_STOCK");
        String keep = atL2.get(0);
        String broken = atL2.get(1);
        int bottlesL1 = onHand(l1, bottle);
        TransferView sent = dispatch(w2, draft(w2, l2, l1, List.of(qty(bottle, 10), piece(keep), piece(broken))).id());
        String id = sent.id();
        String bottleLine = lineOf(sent, bottle, null).id();
        String keepLine = lineOf(sent, scarf, keep).id();
        String brokenLine = lineOf(sent, scarf, broken).id();

        // The receive sheet's rules.
        assertEquals("SHORTFALL_REASON_REQUIRED", code(() -> transfers.receive(w1, inst, id,
                new StockOpsDtos.TransferReceiveRequest(key(), List.of(new ReceiveLineInput(bottleLine, 7, null),
                        new ReceiveLineInput(keepLine, 1, null), new ReceiveLineInput(brokenLine, 1, null)), null,
                        null))));
        assertEquals("RECEIVED_ABOVE_SENT", code(() -> transfers.receive(w1, inst, id,
                new StockOpsDtos.TransferReceiveRequest(key(), List.of(new ReceiveLineInput(bottleLine, 11, null),
                        new ReceiveLineInput(keepLine, 1, null), new ReceiveLineInput(brokenLine, 1, null)), null,
                        null))));
        assertEquals("VALIDATION", code(() -> transfers.receive(w1, inst, id,
                new StockOpsDtos.TransferReceiveRequest(key(), List.of(new ReceiveLineInput(bottleLine, 10, "LOST"),
                        new ReceiveLineInput(keepLine, 1, null), new ReceiveLineInput(brokenLine, 1, null)), null,
                        null))), "a full line takes no reason");
        assertEquals("VALIDATION", code(() -> transfers.receive(w1, inst, id,
                new StockOpsDtos.TransferReceiveRequest(key(), List.of(new ReceiveLineInput(bottleLine, 10, null)),
                        null, null))), "every line once");

        // 3 bottles lost, the second scarf damaged: warehouse staff need a PIN (limits unset = 0).
        String receiveKey = key();
        List<ReceiveLineInput> sheet = List.of(new ReceiveLineInput(bottleLine, 7, "LOST"),
                new ReceiveLineInput(keepLine, 1, null), new ReceiveLineInput(brokenLine, 0, "DAMAGED_IN_TRANSIT"));
        long before = movements();
        assertEquals("APPROVAL_REQUIRED", code(() -> transfers.receive(w1, inst, id,
                new StockOpsDtos.TransferReceiveRequest(receiveKey, sheet, "Box torn", null))));
        assertEquals(before, movements(), "nothing written");
        assertEquals("DISPATCHED", transferStatus(id));
        assertEquals("PIN_INVALID", code(() -> transfers.receive(w1, inst, id,
                new StockOpsDtos.TransferReceiveRequest(receiveKey, sheet, "Box torn", pin(managerId, WRONG_PIN)))));
        assertEquals(before, movements());
        assertEquals("DISPATCHED", transferStatus(id));
        // The same key with the PIN (the hash leaves the approval out).
        TransferView got = body(transfers.receive(w1, inst, id,
                new StockOpsDtos.TransferReceiveRequest(receiveKey, sheet, "Box torn", pin(managerId, PIN))));
        assertEquals("RECEIVED", got.status());
        assertEquals(1, count("SELECT count(*) FROM commerce_approval WHERE institute_id = ? AND action = "
                + "'STOCK_TRANSFER_SHORT' AND reference_id = ?", inst, id));

        // Every unit explained: source −12; destination +12 in, then −4 with the reasons.
        assertEquals(-12, count("SELECT SUM(quantity_delta) FROM stock_movement WHERE transfer_id = ? AND location_id = ?",
                id, l2));
        assertEquals(12, count("SELECT SUM(quantity_delta) FROM stock_movement WHERE transfer_id = ? AND type = "
                + "'TRANSFER_IN' AND location_id = ?", id, l1));
        assertEquals(-3, count("SELECT SUM(quantity_delta) FROM stock_movement WHERE transfer_id = ? AND type = "
                + "'DAMAGE' AND reason = 'LOST' AND location_id = ?", id, l1));
        assertEquals(-1, count("SELECT SUM(quantity_delta) FROM stock_movement WHERE transfer_id = ? AND type = "
                + "'DAMAGE' AND reason = 'DAMAGED_IN_TRANSIT' AND piece_id = ?", id, broken));
        assertEquals(0, count("SELECT count(*) FROM stock_movement WHERE transfer_id = ? AND unit_cost IS NULL", id),
                "costs stamped on every movement");
        // TRANSFER_IN before its DAMAGE on the one level row.
        List<Map<String, Object>> bottleRows = db.queryForList("SELECT type, balance_after FROM stock_movement WHERE "
                + "transfer_id = ? AND location_id = ? AND package_session_id = ? ORDER BY balance_after DESC", id, l1,
                bottle);
        assertEquals("TRANSFER_IN", bottleRows.get(0).get("type"));
        assertEquals(bottlesL1 + 10, ((Number) bottleRows.get(0).get("balance_after")).intValue());
        assertEquals("DAMAGE", bottleRows.get(1).get("type"));
        assertEquals(bottlesL1 + 7, ((Number) bottleRows.get(1).get("balance_after")).intValue());
        assertEquals(bottlesL1 + 7, onHand(l1, bottle));
        assertEquals("IN_STOCK", pieceStatus(keep));
        assertEquals(l1, pieceLocation(keep));
        assertEquals("WRITTEN_OFF", pieceStatus(broken));
        assertEquals(7, count("SELECT qty_received FROM stock_transfer_line WHERE id = ?", bottleLine));
        assertEquals("LOST", text("SELECT shortfall_reason FROM stock_transfer_line WHERE id = ?", bottleLine));
        assertEquals("Box torn", text("SELECT receive_note FROM stock_transfer WHERE id = ?", id));
        assertEquals(0, count("SELECT -SUM(quantity_delta) FROM stock_movement WHERE transfer_id = ? AND type IN "
                + "('TRANSFER_OUT', 'TRANSFER_IN')", id), "in transit back to 0");
        noCost(got, "the short transfer for warehouse staff");

        // A manager receives a short line with no PIN.
        TransferView next = dispatch(w2, draft(w2, l2, l1, List.of(qty(bottle, 2))).id());
        TransferView managerGot = body(transfers.receive(manager, inst, next.id(),
                new StockOpsDtos.TransferReceiveRequest(key(), List.of(new ReceiveLineInput(next.lines().get(0).id(), 1,
                        "LOST")), null, null)));
        assertEquals("RECEIVED", managerGot.status());
        assertEquals(0, count("SELECT count(*) FROM commerce_approval WHERE reference_id = ?", next.id()));
    }

    // ================================================================== 4. two GSTINs

    @Test
    @Order(4)
    void gstinDifferenceBlocksDispatchUnlessAManagerGivesTheDocument() throws Exception {
        TransferView draft = draft(w2, l2, l3, List.of(qty(bottle, 2)));
        assertTrue(draft.gstinDiffers());
        assertTrue(draft.warnings().contains("NEEDS_DOCUMENT"), draft.warnings().toString());
        assertFalse(draft.nextActions().contains("DISPATCH"), "warehouse staff cannot send it");
        long before = movements();
        long series = nextChallan();
        assertEquals("TRANSFER_NEEDS_DOCUMENT", code(() -> dispatch(w2, draft.id())));
        assertEquals("ROLE_NOT_ALLOWED", code(() -> transfers.dispatch(w2, inst, draft.id(),
                new StockOpsDtos.TransferDispatchRequest(key(), null, "EXTERNAL_INVOICE", "EXT/77", null))));
        assertEquals("TRANSFER_NEEDS_DOCUMENT", code(() -> dispatch(manager, draft.id())),
                "a manager without the document is refused too");
        assertEquals(before, movements());
        assertEquals(series, nextChallan());
        assertEquals("DRAFT", transferStatus(draft.id()));

        TransferView sent = body(transfers.dispatch(manager, inst, draft.id(),
                new StockOpsDtos.TransferDispatchRequest(key(), "EWB12345", "EXTERNAL_INVOICE", "EXT/77", null)));
        assertEquals("DISPATCHED", sent.status());
        assertEquals("EXTERNAL_INVOICE", sent.documentType());
        assertEquals("EXT/77", text("SELECT document_number FROM stock_transfer WHERE id = ?", draft.id()));
        assertNull(text("SELECT document_series_id FROM stock_transfer WHERE id = ?", draft.id()));
        assertEquals(SELLER_GSTIN, text("SELECT from_gstin FROM stock_transfer WHERE id = ?", draft.id()));
        assertEquals(OTHER_STATE_GSTIN, text("SELECT to_gstin FROM stock_transfer WHERE id = ?", draft.id()));
        assertEquals(series, nextChallan(), "no challan number taken");
        byte[] pdf = body(transfers.challan(manager, inst, draft.id()));
        assertTrue(new String(pdf, 0, 5, StandardCharsets.ISO_8859_1).startsWith("%PDF"));
        receiveAll(manager, sent);

        // Same GSTIN: no external document.
        TransferView same = draft(manager, l2, l1, List.of(qty(bottle, 1)));
        assertFalse(same.gstinDiffers());
        assertEquals("TRANSFER_DOCUMENT_NOT_ALLOWED", code(() -> transfers.dispatch(manager, inst, same.id(),
                new StockOpsDtos.TransferDispatchRequest(key(), null, "EXTERNAL_INVOICE", "EXT/78", null))));
        assertEquals("VALIDATION", code(() -> transfers.dispatch(manager, inst, same.id(),
                new StockOpsDtos.TransferDispatchRequest(key(), "EWB-1", null, null, null))), "e-way bill shape");
        body(transfers.cancel(manager, inst, same.id(), new StockOpsDtos.CancelRequest(key(), "Not needed")));
        assertEquals("CANCELLED", transferStatus(same.id()));
    }

    // ================================================================== 5. failures, double tap, deactivation

    @Test
    @Order(5)
    void dispatchFailureTakesNoChallanNumberAndADoubleTapDispatchesOnce() throws Exception {
        // (a) More than on hand: NOT_IN_STOCK, nothing moved, no number.
        int atL2 = onHand(l2, bottle);
        TransferView draft = draft(w2, l2, l1, List.of(qty(bottle, atL2 + 1)));
        long before = movements();
        long series = nextChallan();
        assertEquals("NOT_IN_STOCK", code(() -> dispatch(w2, draft.id())));
        assertEquals(before, movements());
        assertEquals(series, nextChallan());
        assertEquals("DRAFT", transferStatus(draft.id()));
        assertEquals(atL2, onHand(l2, bottle));

        // (b) The series closed: SERIES_NOT_CONFIGURED after the stock step rolls the stock back.
        body(transfers.update(w2, inst, draft.id(), new StockOpsDtos.TransferUpdateRequest(key(), null, null,
                List.of(qty(bottle, 2)))));
        db.update("UPDATE commerce_document_series SET status = 'CLOSED' WHERE id = ?", challanSeries);
        String dispatchKey = key();
        StockOpsDtos.TransferDispatchRequest send = new StockOpsDtos.TransferDispatchRequest(dispatchKey, null, null,
                null, null);
        assertEquals("SERIES_NOT_CONFIGURED", code(() -> transfers.dispatch(w2, inst, draft.id(), send)));
        assertEquals(before, movements(), "the stock step rolled back");
        assertEquals(atL2, onHand(l2, bottle));
        assertEquals("DRAFT", transferStatus(draft.id()));
        assertEquals(series, nextChallan());
        assertNull(text("SELECT unit_value::text FROM stock_transfer_line WHERE transfer_id = ?", draft.id()),
                "the line stamps rolled back");
        db.update("UPDATE commerce_document_series SET status = 'ACTIVE' WHERE id = ?", challanSeries);
        TransferView sent = body(transfers.dispatch(w2, inst, draft.id(), send));
        assertTrue(sent.documentNumber().endsWith(String.format("-%05d", series)), "no gap: " + sent.documentNumber());
        assertEquals(series + 1, nextChallan());
        receiveAll(w1, sent);

        // (c) A double tap: two threads, one key → one dispatch, one number.
        for (boolean sameKey : List.of(true, false)) {
            TransferView tap = draft(w2, l2, l1, List.of(qty(bottle, 1)));
            long numbers = nextChallan();
            String k1 = key();
            String k2 = sameKey ? k1 : key();
            ExecutorService pool = Executors.newFixedThreadPool(2);
            CyclicBarrier start = new CyclicBarrier(2);
            List<Future<String>> results = new ArrayList<>();
            for (String k : List.of(k1, k2)) {
                results.add(pool.submit(() -> {
                    header(inst);
                    start.await(10, TimeUnit.SECONDS);
                    try {
                        TransferView v = body(transfers.dispatch(w2, inst, tap.id(),
                                new StockOpsDtos.TransferDispatchRequest(k, null, null, null, null)));
                        return v.status() + (Boolean.TRUE.equals(v.replayed()) ? ":REPLAYED" : ":FIRST");
                    } catch (RuntimeException e) {
                        return "REFUSED:" + e.getMessage();
                    }
                }));
            }
            List<String> answers = new ArrayList<>();
            for (Future<String> f : results) {
                answers.add(f.get(60, TimeUnit.SECONDS));
            }
            pool.shutdownNow();
            note("double tap dispatch (same key " + sameKey + "): " + answers);
            assertEquals(1, answers.stream().filter(a -> a.equals("DISPATCHED:FIRST")).count(), answers.toString());
            if (sameKey) {
                assertTrue(answers.contains("DISPATCHED:REPLAYED"), answers.toString());
            } else {
                assertTrue(answers.stream().anyMatch(a -> a.startsWith("REFUSED:TRANSFER_NOT_DRAFT")),
                        answers.toString());
            }
            assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE transfer_id = ?", tap.id()));
            assertEquals(numbers + 1, nextChallan(), "one number");
            if (!sameKey) {
                receiveAll(w1, body(transfers.get(w1, inst, tap.id())));
                continue;
            }
            // The receive tapped twice too: one TRANSFER_IN, one RECEIVED.
            TransferView onTheWay = body(transfers.get(w1, inst, tap.id()));
            StockOpsDtos.TransferReceiveRequest arrive = new StockOpsDtos.TransferReceiveRequest(key(),
                    List.of(new ReceiveLineInput(onTheWay.lines().get(0).id(), 1, null)), null, null);
            ExecutorService receivers = Executors.newFixedThreadPool(2);
            CyclicBarrier together = new CyclicBarrier(2);
            List<Future<String>> got = new ArrayList<>();
            for (int i = 0; i < 2; i++) {
                got.add(receivers.submit(() -> {
                    header(inst);
                    together.await(10, TimeUnit.SECONDS);
                    TransferView v = body(transfers.receive(w1, inst, tap.id(), arrive));
                    return v.status() + (Boolean.TRUE.equals(v.replayed()) ? ":REPLAYED" : ":FIRST");
                }));
            }
            List<String> received = new ArrayList<>();
            for (Future<String> f : got) {
                received.add(f.get(60, TimeUnit.SECONDS));
            }
            receivers.shutdownNow();
            note("double tap receive: " + received);
            assertTrue(received.contains("RECEIVED:FIRST") && received.contains("RECEIVED:REPLAYED"),
                    received.toString());
            assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE transfer_id = ? AND type = 'TRANSFER_IN'",
                    tap.id()));
        }

        // (d) Cancel: a dispatched transfer cannot; a draft can, once.
        TransferView onTheWay = dispatch(w2, draft(w2, l2, l1, List.of(qty(bottle, 1))).id());
        assertEquals("TRANSFER_DISPATCHED", code(() -> transfers.cancel(w2, inst, onTheWay.id(),
                new StockOpsDtos.CancelRequest(key(), null))));
        // (e) Neither place goes INACTIVE while it is on the way.
        LocationRequest off = new LocationRequest();
        off.setStatus("INACTIVE");
        assertEquals("LOCATION_HAS_TRANSFER_IN_TRANSIT", code(() -> locationService.update(inst, adminId, l2, off)));
        assertEquals("LOCATION_HAS_TRANSFER_IN_TRANSIT", code(() -> locationService.update(inst, adminId, l1, off)));
        assertEquals("ACTIVE", text("SELECT status FROM stock_location WHERE id = ?", l2));
        receiveAll(w1, onTheWay);
        TransferView dropped = draft(w2, l2, l1, List.of(qty(bottle, 1)));
        assertEquals("CANCELLED", body(transfers.cancel(w2, inst, dropped.id(),
                new StockOpsDtos.CancelRequest(key(), "Typed twice"))).status());
        assertEquals("TRANSFER_NOT_DRAFT", code(() -> transfers.cancel(w2, inst, dropped.id(),
                new StockOpsDtos.CancelRequest(key(), null))));
        assertEquals("TRANSFER_NOT_DRAFT", code(() -> dispatch(w2, dropped.id())));

        // (f) A deactivation racing a dispatch to that place: exactly one of them wins.
        LocationRequest on = new LocationRequest();
        on.setStatus("ACTIVE");
        int dispatchedFirst = 0;
        int deactivatedFirst = 0;
        for (int round = 0; round < 8; round++) {
            long delay = (round % 4) * 10L;
            TransferView toL4 = draft(manager, l2, l4, List.of(qty(bottle, 1)));
            ExecutorService pool = Executors.newFixedThreadPool(2);
            CyclicBarrier start = new CyclicBarrier(2);
            Future<String> sending = pool.submit(() -> {
                header(inst);
                start.await(10, TimeUnit.SECONDS);
                try {
                    return dispatch(manager, toL4.id()).status();
                } catch (RuntimeException e) {
                    return e.getMessage();
                }
            });
            Future<String> close = pool.submit(() -> {
                header(inst);
                start.await(10, TimeUnit.SECONDS);
                Thread.sleep(delay);
                try {
                    return locationService.update(inst, adminId, l4, off).getStatus();
                } catch (RuntimeException e) {
                    return e.getMessage();
                }
            });
            String sendAnswer = sending.get(60, TimeUnit.SECONDS);
            String closeAnswer = close.get(60, TimeUnit.SECONDS);
            pool.shutdownNow();
            if ("DISPATCHED".equals(sendAnswer)) {
                assertTrue(closeAnswer.startsWith("LOCATION_HAS_TRANSFER_IN_TRANSIT"), "round " + round + ": "
                        + closeAnswer);
                assertEquals("ACTIVE", text("SELECT status FROM stock_location WHERE id = ?", l4));
                receiveAll(manager, body(transfers.get(manager, inst, toL4.id())));
                dispatchedFirst++;
            } else {
                assertTrue(sendAnswer.startsWith("LOCATION_INACTIVE"), "round " + round + ": " + sendAnswer);
                assertEquals("INACTIVE", closeAnswer, "round " + round);
                assertEquals("DRAFT", transferStatus(toL4.id()));
                assertEquals(0, count("SELECT count(*) FROM stock_movement WHERE transfer_id = ?", toL4.id()));
                locationService.update(inst, adminId, l4, on);
                body(transfers.cancel(manager, inst, toL4.id(), new StockOpsDtos.CancelRequest(key(), null)));
                deactivatedFirst++;
            }
            noDrift("deactivation race round " + round);
        }
        note("deactivation race: dispatched first " + dispatchedFirst + ", deactivated first " + deactivatedFirst);
    }

    // ================================================================== 6. units promised online

    @Test
    @Order(6)
    void promisedOnlineNeedsAManager() throws Exception {
        assertEquals(6, slots(cup));
        List<StockHold> held = stockHoldService.hold(inst, Map.of(cup, 2), StockHoldKind.PURCHASE);
        stockHoldService.attach(held, "shopper-" + run, null, "cuplog-" + run);
        String staffOrder = staffOrders.create(admin, inst, StaffOrderRequest.builder().clientRequestId(key())
                .customer(StaffOrderRequest.Customer.builder().phone("98765" + String.format("%05d",
                        phones.incrementAndGet())).name("Phone Buyer").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("2 Test Lane").city("Test City").stateCode("09")
                        .pincode("100001").build())
                .restOnCredit(true)
                .lines(List.of(StaffOrderRequest.Line.builder().variantId(cup).quantity(4).build()))
                .build()).detail().getOrder().getId();
        assertEquals(0, slots(cup), "every cup at the online place is held or sold online");

        TransferView draft = draft(w1, l1, l2, List.of(qty(cup, 2)));
        long before = movements();
        long series = nextChallan();
        RuntimeException refused = assertThrows(RuntimeException.class, () -> dispatch(w1, draft.id()));
        assertTrue(refused.getMessage().startsWith("PROMISED_ONLINE: 2 unit(s) of CUP-"), refused.getMessage());
        assertEquals(before, movements(), "rolled back");
        assertEquals(series, nextChallan());
        assertEquals(6, onHand(l1, cup));
        assertEquals("ROLE_NOT_ALLOWED", code(() -> transfers.dispatch(w1, inst, draft.id(),
                new StockOpsDtos.TransferDispatchRequest(key(), null, null, null, true))));

        TransferView sent = body(transfers.dispatch(manager, inst, draft.id(),
                new StockOpsDtos.TransferDispatchRequest(key(), null, null, null, true)));
        assertEquals("DISPATCHED", sent.status());
        assertNotNull(sent.sellableShortfall());
        assertEquals(2, sent.sellableShortfall().get(0).units());
        assertEquals(2, count("SELECT COALESCE(sellable_deficit, 0) FROM commerce_variant WHERE package_session_id = ?",
                cup));
        assertEquals(0, slots(cup));
        long flagged = count("SELECT COALESCE(SUM(stock_short_qty), 0) FROM commerce_order_line WHERE order_id = ?",
                staffOrder);
        note("promised online: staff order flagged short " + flagged);
        assertTrue(flagged >= 1 && flagged <= 2, "the online order is flagged stock short after commit: " + flagged);
        assertEquals(4, onHand(l1, cup));
        noDrift("promised units sent");
        receiveAll(manager, sent);
        stockHoldService.releaseForOrder("cuplog-" + run);
    }

    // ================================================================== 7. gate 20

    @Test
    @Order(7)
    void gate20_countWhileTrading() throws Exception {
        String session = openSession();
        CountView open = openCount(manager, l1, null, null, null);
        assertEquals("OPEN", open.status());
        assertTrue(open.countNumber().matches("CNT-\\d{6}"), open.countNumber());
        // Risky spot: started_at read back after the insert (database default).
        assertNotNull(open.startedAt(), "started_at read back");
        Timestamp started = db.queryForObject("SELECT started_at FROM stock_count WHERE id = ?", Timestamp.class,
                open.id());
        assertEquals(started.toLocalDateTime().toString(), open.startedAt());
        assertEquals("COUNT_ALREADY_OPEN", code(() -> openCount(w1, l1, null, null, null)));
        assertTrue(body(counts.list(admin, inst, null, null, null, 0, 50)).counts().stream()
                .anyMatch(c -> c.id().equals(open.id())), "list with every filter empty");
        assertTrue(body(counts.list(w1, inst, l1, "OPEN", "COUNT", 0, 50)).counts().stream()
                .anyMatch(c -> c.id().equals(open.id())));

        // The bag shelf is counted first; then the shop sells 2 and receives 5 of it.
        int bagsBefore = onHand(l1, bag);
        countLines(manager, open.id(), set(bag, bagsBefore));
        Timestamp countedAt = db.queryForObject("SELECT counted_at FROM stock_count_line WHERE count_id = ? AND "
                + "package_session_id = ?", Timestamp.class, open.id(), bag);
        Thread.sleep(5);
        sell(session, bag, 2, "600.00");
        String bagReceipt = receive(adminId, l1, bag, 5, "120.00");
        Timestamp saleAt = db.queryForObject("SELECT max(created_at) FROM stock_movement WHERE package_session_id = ? "
                + "AND type = 'POS_SALE'", Timestamp.class, bag);
        assertTrue(saleAt.after(countedAt), "database time on both sides: sale " + saleAt + " after count " + countedAt);
        assertNotNull(bagReceipt);

        // Cloth: 150 base units on the shelf against 200 (SET, then a SET + ADD gives the same).
        countLines(manager, open.id(), set(cloth, 100));
        StockOpsDtos.CountLinesAnswer clothLine = countLines(manager, open.id(), add(cloth, 50));
        assertEquals(150, clothLine.lines().get(0).countedQty());
        assertEquals("PIECE_SCAN_REQUIRED", code(() -> countLines(manager, open.id(), set(scarf, 1))));
        assertEquals("VALIDATION", code(() -> countLines(manager, open.id(), add(cloth, 0))));

        // Scarves at L1: all but one IN_STOCK scanned, the one written off on the way scanned (found),
        // and one received during the count left on the shelf unscanned.
        List<String> inStock = pieces(scarf, l1, "IN_STOCK");
        assertTrue(inStock.size() >= 2, inStock.toString());
        String missing = inStock.get(inStock.size() - 1);
        String writtenOff = text("SELECT id FROM commerce_piece WHERE package_session_id = ? AND status = 'WRITTEN_OFF' "
                + "ORDER BY code LIMIT 1", scarf);
        assertNotNull(writtenOff);
        for (String p : inStock.subList(0, inStock.size() - 1)) {
            countLines(manager, open.id(), scanned(pieceCode(p)));
        }
        countLines(manager, open.id(), scanned(pieceCode(inStock.get(0))));  // scanned twice, counted once
        countLines(manager, open.id(), scanned(pieceCode(writtenOff).toLowerCase()));
        assertEquals("CODE_NOT_FOUND", code(() -> countLines(manager, open.id(), scanned("PZZZZZZZZZ"))));
        receive(adminId, l1, scarf, 1, "500.00");
        List<String> after = new ArrayList<>(pieces(scarf, l1, "IN_STOCK"));
        after.removeAll(inStock);
        assertEquals(1, after.size());
        String arrived = after.get(0);
        long lines = count("SELECT count(*) FROM stock_count_line WHERE count_id = ?", open.id());
        assertEquals(2 + inStock.size(), lines, "bag, cloth, scanned pieces once each, the found piece");

        // The review: the bag needs nothing, the cloth −50, one missing, one found, one arrived.
        StockOpsDtos.CountReview review = body(counts.review(manager, inst, open.id()));
        StockOpsDtos.ReviewLine bagRow = review.lines().stream().filter(l -> bag.equals(l.packageSessionId()))
                .findFirst().orElseThrow();
        assertEquals(0, bagRow.adjustment());
        assertEquals(bagsBefore, bagRow.expectedAtCount());
        assertEquals(3, bagRow.movedSince(), "−2 sold + 5 received after the count");
        StockOpsDtos.ReviewLine clothRow = review.lines().stream().filter(l -> cloth.equals(l.packageSessionId()))
                .findFirst().orElseThrow();
        assertEquals(-50, clothRow.adjustment());
        assertEquals(List.of(missing), review.missingPieces().stream().map(StockOpsDtos.ReviewPiece::pieceId).toList());
        assertEquals(List.of(writtenOff), review.foundPieces().stream().map(StockOpsDtos.ReviewPiece::pieceId).toList());
        assertEquals(List.of(arrived), review.arrivedDuringCount().stream().map(StockOpsDtos.ReviewPiece::pieceId)
                .toList());
        assertTrue(review.uncounted().stream().anyMatch(u -> bottle.equals(u.packageSessionId())));
        assertNotNull(review.totals().valueDown(), "a manager sees the value");
        StockOpsDtos.CountReview staffReview = body(counts.review(w1, inst, open.id()));
        noCost(staffReview, "the count review for warehouse staff");
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> counts.review(w2, inst, open.id())));
        noCost(body(counts.get(w1, inst, open.id())), "the count for warehouse staff");

        assertEquals("VALIDATION", code(() -> counts.post(manager, inst, open.id(),
                new StockOpsDtos.CountPostRequest(key(), null, null))), "the uncounted choice is required");
        int bottleBefore = onHand(l1, bottle);
        String postKey = key();
        CountView posted = body(counts.post(manager, inst, open.id(),
                new StockOpsDtos.CountPostRequest(postKey, "SKIP", null)));
        assertEquals("POSTED", posted.status());
        assertEquals("POSTED", text("SELECT status FROM stock_count WHERE id = ?", open.id()),
                "header saved after the line stamps");
        assertEquals("SKIP", text("SELECT uncounted_choice FROM stock_count WHERE id = ?", open.id()));
        assertEquals(bagsBefore - 2 + 5, onHand(l1, bag), "the sale after the count is not reversed");
        assertEquals(0, count("SELECT count(*) FROM stock_movement WHERE reference_id = ? AND package_session_id = ?",
                open.id(), bag), "no bag adjustment");
        assertEquals(-50, count("SELECT SUM(quantity_delta) FROM stock_movement WHERE reference_id = ? AND "
                + "reference_type = 'STOCK_COUNT' AND type = 'ADJUSTMENT' AND reason = 'COUNT_DIFFERENCE' AND "
                + "package_session_id = ?", open.id(), cloth));
        assertEquals(150, onHand(l1, cloth));
        assertEquals("WRITTEN_OFF", pieceStatus(missing));
        assertEquals("IN_STOCK", pieceStatus(writtenOff));
        assertEquals(l1, pieceLocation(writtenOff));
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE reference_id = ? AND piece_id = ? AND reason = "
                + "'FOUND' AND quantity_delta = 1", open.id(), writtenOff));
        assertEquals("IN_STOCK", pieceStatus(arrived), "a piece that arrived during the count is untouched");
        assertEquals(bottleBefore, onHand(l1, bottle), "SKIP leaves uncounted items");
        assertEquals(-50, count("SELECT adjustment FROM stock_count_line WHERE count_id = ? AND package_session_id = ? "
                + "AND piece_id IS NULL", open.id(), cloth));
        assertEquals(3, count("SELECT moved_since FROM stock_count_line WHERE count_id = ? AND package_session_id = ? "
                + "AND piece_id IS NULL", open.id(), bag));
        assertNotNull(text("SELECT movement_id FROM stock_count_line WHERE count_id = ? AND package_session_id = ? "
                + "AND piece_id IS NULL", open.id(), cloth));
        assertNotNull(posted.summary());
        assertEquals("COUNT_NOT_OPEN", code(() -> counts.post(manager, inst, open.id(),
                new StockOpsDtos.CountPostRequest(key(), "SKIP", null))));
        CountView replay = body(counts.post(manager, inst, open.id(),
                new StockOpsDtos.CountPostRequest(postKey, "SKIP", null)));
        assertEquals(Boolean.TRUE, replay.replayed());
        // The stored review once posted.
        StockOpsDtos.CountReview stored = body(counts.review(manager, inst, open.id()));
        assertEquals(1, stored.missingPieces().size());
        closeSession(session);
    }

    // ================================================================== 8. a post racing a sale

    @Test
    @Order(8)
    void countPostRacesASale() throws Exception {
        String session = openSession();
        for (int round = 0; round < 10; round++) {
            int shelf = onHand(l1, spoon);
            CountView open = openCount(manager, l1, null, null, null);
            int counted = shelf - 2;
            countLines(manager, open.id(), set(spoon, counted));
            long delay = (round % 5) * 5L;
            ExecutorService pool = Executors.newFixedThreadPool(2);
            CyclicBarrier start = new CyclicBarrier(2);
            Future<String> sale = pool.submit(() -> {
                header(inst);
                start.await(10, TimeUnit.SECONDS);
                Thread.sleep(delay);
                return sell(session, spoon, 1, "50.00");
            });
            Future<String> post = pool.submit(() -> {
                header(inst);
                start.await(10, TimeUnit.SECONDS);
                return body(counts.post(manager, inst, open.id(), new StockOpsDtos.CountPostRequest(key(), "SKIP",
                        null))).status();
            });
            String order = sale.get(60, TimeUnit.SECONDS);
            String status = post.get(60, TimeUnit.SECONDS);
            pool.shutdownNow();
            assertNotNull(order);
            assertEquals("POSTED", status);
            assertEquals(counted - 1, onHand(l1, spoon), "round " + round + ": counted − the sale after counting");
            noDrift("race round " + round);
        }
        note("count post vs sale: 10 rounds, no deadlock, final = counted − sales after counting");
        closeSession(session);
    }

    // ================================================================== 9. approvals, uncounted, blind recount

    @Test
    @Order(9)
    void countApprovalUncountedAndBlindRecount() throws Exception {
        CountView main = openCount(w1, l1, "COUNT", corner, null);
        assertEquals("COUNT_ALREADY_OPEN", code(() -> openCount(manager, l1, null, null, null)),
                "one open count a location");
        assertEquals("COUNT_OUT_OF_SCOPE", code(() -> countLines(w1, main.id(), set(bag, 1))));
        countLines(w1, main.id(), set(plate, onHand(l1, plate) - 1));
        int plates = onHand(l1, plate);
        int trays = onHand(l1, tray);

        // Location scoping: W2 neither reads nor counts at L1.
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> counts.get(w2, inst, main.id())));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> countLines(w2, main.id(), set(plate, 1))));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> counts.post(w2, inst, main.id(),
                new StockOpsDtos.CountPostRequest(key(), "SKIP", null))));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> openCount(w2, l1, null, null, null)));

        // The blind recount.
        assertEquals("RECOUNT_SAME_PERSON", code(() -> openCount(w1, l1, "RECOUNT", null, main.id())));
        CountView recount = openCount(manager, l1, "RECOUNT", null, main.id());
        assertEquals(corner, recount.scopeCollection().id(), "scope copied");
        assertEquals("RECOUNT_BLIND", code(() -> counts.get(manager, inst, main.id())));
        assertEquals("RECOUNT_BLIND", code(() -> counts.review(manager, inst, main.id())));
        String recountWire = json.writeValueAsString(body(counts.get(manager, inst, recount.id())));
        StockOpsDtos.CountLinesAnswer recounted = countLines(manager, recount.id(), set(plate, plates - 1));
        String linesWire = json.writeValueAsString(recounted) + recountWire;
        for (String hidden : List.of("on_hand", "expected", "moved_since", "adjustment")) {
            assertFalse(linesWire.contains(hidden), "the recounter sees no " + hidden + ": " + linesWire);
        }
        assertEquals("RECOUNT_NOT_FINISHED", code(() -> counts.review(manager, inst, recount.id())));
        assertEquals("RECOUNT_OPEN", code(() -> counts.post(w1, inst, main.id(),
                new StockOpsDtos.CountPostRequest(key(), "ZERO", pin(managerId, PIN)))));
        assertEquals("COUNT_ALREADY_OPEN", code(() -> openCount(admin, l1, "RECOUNT", null, main.id())));
        CountView finished = body(counts.post(manager, inst, recount.id(), new StockOpsDtos.CountPostRequest(key(),
                null, null)));
        assertEquals("POSTED", finished.status());
        Map<String, Object> agreement = (Map<String, Object>) finished.summary().get("agreement");
        note("recount agreement (agrees): " + agreement);
        assertEquals(1, ((Number) agreement.get("compared")).intValue());
        assertEquals(0, new BigDecimal(String.valueOf(agreement.get("percent"))).compareTo(new BigDecimal("100")));
        assertEquals(Boolean.TRUE, agreement.get("passes"));
        assertEquals(main.id(), body(counts.get(manager, inst, main.id())).id(), "seen once the recount is finished");
        assertEquals(0, count("SELECT count(*) FROM stock_movement WHERE reference_id = ?", recount.id()),
                "a recount posts no movement");
        // A second recount by another person (ADMIN) that disagrees: below 98 %.
        CountView second = openCount(admin, l1, "RECOUNT", null, main.id());
        countLines(admin, second.id(), set(plate, plates + 3));
        Map<String, Object> disagree = (Map<String, Object>) body(counts.post(admin, inst, second.id(),
                new StockOpsDtos.CountPostRequest(key(), null, null))).summary().get("agreement");
        note("recount agreement (disagrees): " + disagree);
        assertEquals(Boolean.FALSE, disagree.get("passes"));
        assertTrue(new BigDecimal(String.valueOf(disagree.get("percent"))).compareTo(new BigDecimal("98")) < 0);

        // W1 posts a difference with limits unset: a PIN for any difference.
        long before = movements();
        String postKey = key();
        assertEquals("APPROVAL_REQUIRED", code(() -> counts.post(w1, inst, main.id(),
                new StockOpsDtos.CountPostRequest(postKey, "ZERO", null))));
        assertEquals("PIN_INVALID", code(() -> counts.post(w1, inst, main.id(),
                new StockOpsDtos.CountPostRequest(postKey, "ZERO", pin(managerId, WRONG_PIN)))));
        assertEquals(before, movements());
        assertEquals("OPEN", text("SELECT status FROM stock_count WHERE id = ?", main.id()));
        CountView posted = body(counts.post(w1, inst, main.id(),
                new StockOpsDtos.CountPostRequest(postKey, "ZERO", pin(managerId, PIN))));
        assertEquals("POSTED", posted.status());
        assertEquals(1, count("SELECT count(*) FROM commerce_approval WHERE institute_id = ? AND action = "
                + "'STOCK_COUNT_POST' AND reference_id = ?", inst, main.id()));
        assertEquals(plates - 1, onHand(l1, plate));
        assertEquals(0, onHand(l1, tray), "ZERO writes off the uncounted tray");
        assertEquals(-trays, count("SELECT SUM(quantity_delta) FROM stock_movement WHERE reference_id = ? AND "
                + "package_session_id = ? AND idempotency_key LIKE 'COUNT_ZERO:%'", main.id(), tray));
        assertEquals("ZERO", text("SELECT uncounted_choice FROM stock_count WHERE id = ?", main.id()));

        // A manager posts a difference with no PIN, and a double tap posts once.
        int bags = onHand(l1, bag);
        CountView tap = openCount(manager, l1, null, null, null);
        countLines(manager, tap.id(), set(bag, bags + 1));
        String tapKey = key();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CyclicBarrier start = new CyclicBarrier(2);
        List<Future<String>> results = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            results.add(pool.submit(() -> {
                header(inst);
                start.await(10, TimeUnit.SECONDS);
                CountView v = body(counts.post(manager, inst, tap.id(),
                        new StockOpsDtos.CountPostRequest(tapKey, "SKIP", null)));
                return v.status() + (Boolean.TRUE.equals(v.replayed()) ? ":REPLAYED" : ":FIRST");
            }));
        }
        List<String> answers = new ArrayList<>();
        for (Future<String> f : results) {
            answers.add(f.get(60, TimeUnit.SECONDS));
        }
        pool.shutdownNow();
        note("double tap count post: " + answers);
        assertTrue(answers.contains("POSTED:FIRST") && answers.contains("POSTED:REPLAYED"), answers.toString());
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE reference_id = ?", tap.id()));
        assertEquals(bags + 1, onHand(l1, bag));
        assertEquals(0, count("SELECT count(*) FROM commerce_approval WHERE reference_id = ?", tap.id()));

        // Cancel: neither the starter nor a manager can cancel a posted count; another staff member
        // cannot cancel someone else's open one.
        CountView mine = openCount(manager, l1, null, null, null);
        assertEquals("ROLE_NOT_ALLOWED", code(() -> counts.cancel(w1, inst, mine.id(),
                new StockOpsDtos.CancelRequest(key(), null))));
        assertEquals("CANCELLED", body(counts.cancel(manager, inst, mine.id(),
                new StockOpsDtos.CancelRequest(key(), "Started by mistake"))).status());
        assertEquals("COUNT_NOT_OPEN", code(() -> counts.cancel(manager, inst, tap.id(),
                new StockOpsDtos.CancelRequest(key(), null))));
    }

    // ================================================================== 10. gate 10, the scanner half

    @Test
    @Order(10)
    void labelsRoundTripScanAtTillAndPackStation() throws Exception {
        ReceiptRequest request = new ReceiptRequest();
        request.setLocationId(l1);
        request.setSourceKind("OTHER");
        request.setNote("labels proof");
        request.setClientRequestId("rc-" + key());
        ReceiptRequest.Line scarves = new ReceiptRequest.Line();
        scarves.setPackageSessionId(scarf);
        scarves.setQuantity(2);
        ReceiptRequest.Line bottles = new ReceiptRequest.Line();
        bottles.setPackageSessionId(bottle);
        bottles.setQuantity(3);
        request.setLines(List.of(scarves, bottles));
        String receiptId = receiptService.create(inst, w1Id, false, request).getId();

        List<LabelDtos.LabelRow> rows = labelRows(w1, receiptId);
        assertEquals(3, rows.size(), "two piece rows and one row of three");
        assertEquals(2, rows.stream().filter(r -> r.pieceId() != null && r.quantity() == 1).count());
        assertEquals(1, rows.stream().filter(r -> r.pieceId() == null && r.quantity() == 3).count());
        assertTrue(rows.stream().allMatch(r -> "PENDING".equals(r.status()) && "NEW_RECEIPT".equals(r.reason())));
        assertTrue(body(labels.list(admin, inst, null, null, null, null, null, 0, 100)).total() >= 3,
                "the list with every filter empty");
        assertEquals(3, body(labels.list(w1, inst, l1, "PENDING", "NEW_RECEIPT", "STOCK_RECEIPT", receiptId, 0, 100))
                .requests().size());
        assertTrue(labelRows(w2, receiptId).isEmpty(), "W2 does not see the rows of L1");
        noCost(rows, "label rows");

        List<String> ids = rows.stream().map(LabelDtos.LabelRow::id).toList();
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> labels.printData(w2, inst,
                new LabelDtos.PrintDataRequest(ids, null, null))));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> labels.printData(w2, inst,
                new LabelDtos.PrintDataRequest(null, receiptId, null))));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> labels.list(w2, inst, l1, null, null, null, null, 0, 50)));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> labels.markPrinted(w2, inst,
                new LabelDtos.LabelIdsRequest(key(), ids))));
        assertEquals("VALIDATION", code(() -> labels.printData(w1, inst,
                new LabelDtos.PrintDataRequest(ids, receiptId, null))));

        LabelDtos.PrintDataAnswer print = body(labels.printData(w1, inst,
                new LabelDtos.PrintDataRequest(null, receiptId, null)));
        assertEquals("STICKER_50X25", print.size());
        assertEquals(3, print.labels().size());
        assertEquals(5, print.totalCopies());
        noCost(print, "print data");
        String pieceOne = null;
        for (LabelDtos.PrintLabel label : print.labels()) {
            assertNotNull(label.code());
            assertEquals(LINK_BASE + "/q/" + label.code(), label.qrValue());
            // The scan box's normaliser: the last path segment after /q/ is the code.
            String normalised = label.qrValue().substring(label.qrValue().lastIndexOf("/q/") + 3);
            assertEquals(label.code(), normalised);
            Map<String, Object> packStation = body(pieceRoutes.scan(w1, inst, normalised));
            PosDtos.ScanAnswer till = posCatalogue.scan(cashier, inst, r1, normalised);
            Map<String, Object> variant = (Map<String, Object>) packStation.get("variant");
            assertEquals(label.pieceId() == null ? "VARIANT" : "PIECE", packStation.get("kind"));
            assertEquals(packStation.get("kind"), till.kind());
            assertEquals(variant.get("package_session_id"), till.item().variantId(), "same variant at both scans");
            if (label.pieceId() != null) {
                pieceOne = label.pieceId();
                assertEquals(scarf, till.item().variantId());
                assertEquals(label.pieceId(), ((Map<String, Object>) packStation.get("piece")).get("id"));
                assertEquals(label.pieceId(), till.piece().id());
                assertTrue(till.piece().here(), "the piece is at the till's location");
                assertEquals(1, label.copies());
                assertEquals("Cotton scarf", label.productName().en());
                assertEquals("सूती स्कार्फ", label.productName().hi());
                same("1200.00", label.price(), "scarf price");
            } else {
                assertEquals(bottle, till.item().variantId());
                assertEquals(text("SELECT label_code FROM commerce_variant WHERE package_session_id = ?", bottle),
                        label.code());
                assertEquals(3, label.copies());
                assertEquals("Steel bottle", label.productName().en());
                assertEquals("स्टील की बोतल", label.productName().hi());
                assertEquals("One size", label.variantName().en());
                same("450.00", label.price(), "bottle price");
            }
        }
        assertNotNull(pieceOne);
        String reprinted = pieceOne;
        // By ids, on the A4 sheet; nothing changed by print data.
        LabelDtos.PrintDataAnswer sheet = body(labels.printData(w1, inst,
                new LabelDtos.PrintDataRequest(ids, null, "A4_65")));
        assertEquals("A4_65", sheet.size());
        assertEquals(5, sheet.totalCopies());
        assertEquals(3, count("SELECT count(*) FROM commerce_label_request WHERE source_id = ? AND status = 'PENDING'",
                receiptId));
        // Measured cloth: one label per roll, price per metre.
        String clothReceipt = receive(w1Id, l1, cloth, 30, null);
        LabelDtos.PrintDataAnswer metre = body(labels.printData(w1, inst,
                new LabelDtos.PrintDataRequest(null, clothReceipt, null)));
        assertEquals(1, metre.totalCopies());
        assertEquals("MTR", metre.labels().get(0).unit());
        assertEquals(10, metre.labels().get(0).qtyScale());
        same("250.00", metre.labels().get(0).price(), "price per metre");

        // Mark printed (once), then print data refuses the printed rows.
        String markKey = key();
        assertEquals(3, body(labels.markPrinted(w1, inst, new LabelDtos.LabelIdsRequest(markKey, ids))).printed());
        LabelDtos.PrintedAnswer replayed = body(labels.markPrinted(w1, inst, new LabelDtos.LabelIdsRequest(markKey, ids)));
        assertEquals(Boolean.TRUE, replayed.replayed());
        assertEquals(3, count("SELECT count(*) FROM commerce_label_request WHERE source_id = ? AND status = 'PRINTED' "
                + "AND printed_price IS NOT NULL AND printed_mrp IS NOT NULL AND printed_by = ?", receiptId, w1Id));
        assertEquals("LABEL_NOT_PENDING", code(() -> labels.printData(w1, inst,
                new LabelDtos.PrintDataRequest(ids, null, null))));

        // A reprint needs its reason and is audited.
        assertEquals("VALIDATION", code(() -> labels.request(w1, inst, new LabelDtos.LabelRequestsRequest(key(), l1,
                "REPRINT", null, null, List.of(new LabelDtos.LabelLineInput(null, null, reprinted, null))))));
        LabelDtos.LabelsAnswer reprint = body(labels.request(w1, inst, new LabelDtos.LabelRequestsRequest(key(), l1,
                "REPRINT", "TORN", null, List.of(new LabelDtos.LabelLineInput(null, null, reprinted, null)))));
        assertEquals(1, reprint.requests().size());
        assertTrue(count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = 'LABEL_REPRINT'",
                inst) >= 1, "reprint audited");
        assertEquals(1, body(labels.printData(w1, inst, new LabelDtos.PrintDataRequest(
                List.of(reprint.requests().get(0).id()), null, null))).totalCopies());
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> labels.request(w2, inst, new LabelDtos.LabelRequestsRequest(
                key(), l1, "REPRINT", "TORN", null, List.of(new LabelDtos.LabelLineInput(null, null, reprinted, null))))));
        assertEquals("PIECE_SCAN_REQUIRED", code(() -> labels.request(w1, inst, new LabelDtos.LabelRequestsRequest(
                key(), l1, "PRICE_CHANGE", null, null, List.of(new LabelDtos.LabelLineInput(scarf, 1, null, null))))));
        // More than 500 labels at once.
        LabelDtos.LabelsAnswer many = body(labels.request(w1, inst, new LabelDtos.LabelRequestsRequest(key(), l1,
                "PRICE_CHANGE", null, null, List.of(new LabelDtos.LabelLineInput(bottle, 501, null, null)))));
        assertEquals("LABELS_TOO_MANY", code(() -> labels.printData(w1, inst, new LabelDtos.PrintDataRequest(
                List.of(many.requests().get(0).id()), null, null))));
        assertEquals(1, body(labels.cancel(w1, inst, new LabelDtos.LabelIdsRequest(key(),
                List.of(many.requests().get(0).id(), ids.get(0))))).cancelled());

        // A receipt reversed cancels its pending labels.
        String mistaken = receive(w1Id, l1, plate, 2, null);
        assertEquals(1, labelRows(w1, mistaken).size());
        receiptService.reverse(inst, managerId, mistaken, "=Wrong delivery");
        assertEquals(1, count("SELECT count(*) FROM commerce_label_request WHERE source_id = ? AND status = 'CANCELLED' "
                + "AND cancelled_at IS NOT NULL", mistaken));
        assertEquals(0, count("SELECT count(*) FROM commerce_label_request WHERE source_id = ? AND status = 'PENDING'",
                mistaken));

        // Tags to replace after a price change.
        productService.updateVariant(inst, adminId, bottle, VariantRequest.builder().price(new BigDecimal("500.00"))
                .build());
        snapshotLoader.evict(inst);
        LabelDtos.ReplaceAnswer replace = body(labels.toReplace(w1, inst, l1));
        LabelDtos.ReplaceRow bottleRow = replace.rows().stream().filter(r -> bottle.equals(r.packageSessionId()))
                .findFirst().orElseThrow(() -> new AssertionError("bottle not listed: " + replace.rows()));
        same("450.00", bottleRow.printedMrp(), "printed");
        same("500.00", bottleRow.currentMrp(), "current");
        noCost(replace, "tags to replace");
    }

    // ================================================================== 11. low stock, overview, export

    @Test
    @Order(11)
    void lowStockOverviewAndExport() throws Exception {
        receive(adminId, l2, plate, 2, "80.00");
        ReorderLevelRequest reorder = new ReorderLevelRequest();
        reorder.setLocationId(l1);
        reorder.setPackageSessionId(plate);
        reorder.setReorderLevel(onHand(l1, plate) + 2);
        assertEquals("ROLE_NOT_ALLOWED", code(() -> levelRoutes.reorderLevel(w1, inst, reorder)));
        levelRoutes.reorderLevel(manager, inst, reorder);
        String session = openSession();
        sell(session, plate, 1, "200.00");
        closeSession(session);
        int shelf = onHand(l1, plate);
        Timestamp soldAt = db.queryForObject("SELECT max(created_at) FROM stock_movement WHERE package_session_id = ? "
                + "AND type = 'POS_SALE' AND location_id = ?", Timestamp.class, plate, l1);

        StockOpsDtos.LowAnswer low = body(overview.low(w1, inst, l1, "REORDER", 0, 50));
        StockOpsDtos.LowRow plateRow = low.rows().stream().filter(r -> plate.equals(r.packageSessionId())).findFirst()
                .orElseThrow(() -> new AssertionError("plate not low: " + low.rows()));
        assertEquals(shelf, plateRow.onHand());
        assertEquals(3, plateRow.shortage());
        assertEquals(soldAt.toLocalDateTime().toString(), plateRow.lastSaleAt());
        assertTrue(plateRow.elsewhere().isEmpty(), "W1 sees no other place: " + plateRow.elsewhere());
        StockOpsDtos.LowRow managerRow = body(overview.low(manager, inst, l1, "REORDER", 0, 50)).rows().stream()
                .filter(r -> plate.equals(r.packageSessionId())).findFirst().orElseThrow();
        assertEquals(l2, managerRow.elsewhere().get(0).locationId());
        assertEquals(2, managerRow.elsewhere().get(0).onHand());
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> overview.low(w2, inst, l1, "REORDER", 0, 50)));
        StockOpsDtos.LowAnswer outOnline = body(overview.low(w1, inst, null, "OUT_ONLINE", 0, 50));
        assertEquals("OUT_ONLINE", outOnline.kind());
        assertTrue(outOnline.rows().stream().anyMatch(r -> cup.equals(r.packageSessionId())),
                "the cup is promised online: " + outOnline.rows());
        noCost(low, "low stock");

        // The overview with a transfer on the way; every optional filter empty first.
        TransferView onTheWay = dispatch(w2, draft(w2, l2, l1, List.of(qty(bottle, 1))).id());
        StockOpsDtos.OverviewAnswer all = body(overview.overview(manager, inst, l1 + "," + l2, null, null, null, 0, 50));
        assertEquals(2, all.locations().size());
        StockOpsDtos.OverviewRow bottleRow = all.rows().stream().filter(r -> bottle.equals(r.packageSessionId()))
                .findFirst().orElseThrow();
        assertEquals(1, bottleRow.inTransit());
        assertEquals(onHand(l1, bottle), bottleRow.levels().stream().filter(c -> l1.equals(c.locationId())).findFirst()
                .orElseThrow().onHand());
        assertEquals(onHand(l2, bottle), bottleRow.levels().stream().filter(c -> l2.equals(c.locationId()))
                .findFirst().orElseThrow().onHand());
        assertTrue(body(overview.overview(manager, inst, null, "bottle", "LOW", null, 0, 50)).rows().stream()
                .noneMatch(r -> spoon.equals(r.packageSessionId())));
        assertTrue(body(overview.overview(manager, inst, l1, null, null, corner, 0, 50)).rows().stream()
                .allMatch(r -> plate.equals(r.packageSessionId()) || tray.equals(r.packageSessionId())));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> overview.overview(w1, inst, l1 + "," + l2, null, null, null, 0,
                50)));
        StockOpsDtos.OverviewAnswer mine = body(overview.overview(w1, inst, null, null, null, null, 0, 50));
        noCost(mine, "the overview for warehouse staff");
        receiveAll(w1, onTheWay);

        // The variant picker: a blank q, then an exact label code first.
        assertFalse(body(overview.variants(w1, inst, null, l1, false)).items().isEmpty());
        String labelCode = text("SELECT label_code FROM commerce_variant WHERE package_session_id = ?", bottle);
        StockOpsDtos.VariantsAnswer picked = body(overview.variants(w1, inst, labelCode, l1, false));
        assertEquals(bottle, picked.items().get(0).packageSessionId());
        noCost(picked, "the variant picker");
        assertTrue(body(overview.approvers(w1, inst, l1)).approvers().stream()
                .anyMatch(a -> managerId.equals(a.userId())), "the manager with a PIN approves at L1");

        // Movements: enriched, and the export.
        Map<String, Object> first = body(levelRoutes.movements(w1, inst, l1, plate, null, null, null, 0, 50))
                .getContent().get(0);
        assertNotNull(first.get("sku"));
        assertNotNull(first.get("reference"));
        noCost(body(levelRoutes.movements(w1, inst, l1, null, null, null, null, 0, 50)), "movements for staff");
        LocalDate today = LocalDate.now();
        String staffCsv = new String(body(overview.export(w1, inst, l1, null, null, today.minusDays(2),
                today.plusDays(1))), StandardCharsets.UTF_8);
        String managerCsv = new String(body(overview.export(manager, inst, l1, null, null, today.minusDays(2),
                today.plusDays(1))), StandardCharsets.UTF_8);
        String header = staffCsv.lines().findFirst().orElse("");
        assertFalse(header.toLowerCase().contains("cost"), header);
        assertTrue(managerCsv.lines().findFirst().orElse("").contains("unit_cost"));
        assertTrue(staffCsv.lines().count() > 10, "rows in the export");
        assertTrue(staffCsv.contains("'=Wrong delivery"), "a formula-like text cell is prefixed");
        assertFalse(staffCsv.contains(",=Wrong"), staffCsv.lines().filter(l -> l.contains("Wrong")).toList().toString());
        assertEquals("VALIDATION", code(() -> overview.export(manager, inst, l1, null, null, today.minusDays(400),
                today)));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> overview.export(w2, inst, l1, null, null, today, today)));
    }

    // ================================================================== 12. quick add

    @Test
    @Order(12)
    void quickAddReceiveAndLabel() throws Exception {
        String quickKey = key();
        CommerceQuickAddService.QuickAddRequest ask = new CommerceQuickAddService.QuickAddRequest(quickKey,
                Map.of("en", "Jute mat", "hi", "जूट की चटाई"), taxClass, "pcs", "QUANTITY", null, null, null);
        assertEquals("ROLE_NOT_ALLOWED", code(() -> quickAdd.quickAdd(cashier, inst, ask)));
        assertEquals("VALIDATION", code(() -> quickAdd.quickAdd(w2, inst, new CommerceQuickAddService.QuickAddRequest(
                key(), Map.of("en", "Jute mat"), null, null, null, null, null, null))), "REGULAR needs a tax class");
        CommerceQuickAddService.QuickAddAnswer made = body(quickAdd.quickAdd(w2, inst, ask));
        assertEquals("DRAFT", made.status());
        assertTrue(made.sku().matches("QA-\\d{6}"), made.sku());
        assertEquals("PCS", made.unit());
        CommerceQuickAddService.QuickAddAnswer repeat = body(quickAdd.quickAdd(w2, inst, ask));
        assertEquals(made.productId(), repeat.productId(), "a repeat updates the same product");
        assertEquals(made.sku(), repeat.sku());
        assertEquals(1, count("SELECT count(*) FROM commerce_variant WHERE institute_id = ? AND sku = ?", inst,
                made.sku()));
        String mat = made.packageSessionId();

        String matReceipt = receive(w2Id, l2, mat, 4, null);
        List<LabelDtos.LabelRow> rows = labelRows(w2, matReceipt);
        assertEquals(1, rows.size());
        assertEquals(4, rows.get(0).quantity());
        assertFalse(rows.get(0).hasPrice());
        assertEquals("LABEL_NO_PRICE", code(() -> labels.printData(w2, inst,
                new LabelDtos.PrintDataRequest(null, matReceipt, null))));

        productService.updateVariant(inst, managerId, mat, VariantRequest.builder().price(new BigDecimal("150.00"))
                .build());
        snapshotLoader.evict(inst);
        LabelDtos.PrintDataAnswer print = body(labels.printData(w2, inst,
                new LabelDtos.PrintDataRequest(null, matReceipt, null)));
        assertEquals(4, print.totalCopies());
        LabelDtos.PrintLabel label = print.labels().get(0);
        assertEquals("जूट की चटाई", label.productName().hi());
        assertEquals("Jute mat", label.productName().en());
        same("150.00", label.price(), "the price the manager set");
        Map<String, Object> scanned = body(pieceRoutes.scan(w2, inst, label.code()));
        noCost(scanned, "the pack-station scan for warehouse staff");
        noCost(made, "the quick add answer");
        assertEquals("VARIANT", scanned.get("kind"));
        assertEquals(mat, ((Map<String, Object>) scanned.get("variant")).get("package_session_id"));
        assertEquals(4, onHand(l2, mat));
    }

    // ================================================================== 13. outsiders and scoping

    @Test
    @Order(13)
    void securityEveryNewRouteRefusesOutsiders() throws Exception {
        CustomUserDetails learner = user("learner-" + run, "STUDENT");
        CustomUserDetails shopper = user("shopper-" + run);
        CustomUserDetails otherAdmin = user("otheradmin-" + run, "ADMIN");
        TransferView l1l3 = draft(manager, l1, l3, List.of(qty(spoon, 1)));
        CountView open = openCount(manager, l2, null, null, null);
        String anyLabel = text("SELECT id FROM commerce_label_request WHERE institute_id = ? AND location_id = ? "
                + "AND status = 'PENDING' LIMIT 1", inst, l2);
        assertNotNull(anyLabel);
        long transfersBefore = count("SELECT count(*) FROM stock_transfer WHERE institute_id = ?", inst);
        long countsBefore = count("SELECT count(*) FROM stock_count WHERE institute_id = ?", inst);
        long labelsBefore = count("SELECT count(*) FROM commerce_label_request WHERE institute_id = ?", inst);

        for (CustomUserDetails who : List.of(learner, shopper, otherAdmin, cashier, accountant)) {
            boolean reader = who == accountant;
            List<Executable> writes = List.of(
                    () -> draft(who, l1, l2, List.of(qty(spoon, 1))),
                    () -> transfers.update(who, inst, l1l3.id(), new StockOpsDtos.TransferUpdateRequest(key(), null,
                            "x", null)),
                    () -> transfers.cancel(who, inst, l1l3.id(), new StockOpsDtos.CancelRequest(key(), null)),
                    () -> dispatch(who, l1l3.id()),
                    () -> transfers.receive(who, inst, l1l3.id(), new StockOpsDtos.TransferReceiveRequest(key(),
                            List.of(), null, null)),
                    () -> transfers.createChallanSeries(who, inst, new StockOpsDtos.ChallanSeriesRequest("DZ/", l1,
                            null, null)),
                    () -> openCount(who, l2, null, null, null),
                    () -> countLines(who, open.id(), set(spoon, 1)),
                    () -> counts.post(who, inst, open.id(), new StockOpsDtos.CountPostRequest(key(), "SKIP", null)),
                    () -> counts.cancel(who, inst, open.id(), new StockOpsDtos.CancelRequest(key(), null)),
                    () -> counts.deleteLine(who, inst, open.id(), "x"),
                    () -> counts.review(who, inst, open.id()),
                    () -> labels.request(who, inst, new LabelDtos.LabelRequestsRequest(key(), l2, "PRICE_CHANGE", null,
                            null, List.of(new LabelDtos.LabelLineInput(bottle, 1, null, null)))),
                    () -> labels.printData(who, inst, new LabelDtos.PrintDataRequest(List.of(anyLabel), null, null)),
                    () -> labels.markPrinted(who, inst, new LabelDtos.LabelIdsRequest(key(), List.of(anyLabel))),
                    () -> labels.cancel(who, inst, new LabelDtos.LabelIdsRequest(key(), List.of(anyLabel))),
                    () -> labels.list(who, inst, null, null, null, null, null, 0, 50),
                    () -> labels.toReplace(who, inst, l2),
                    () -> overview.approvers(who, inst, l2));
            String expected = who == shopper || who == otherAdmin ? "ACCESS_DENIED" : "ROLE_NOT_ALLOWED";
            // Another institute's admin arrives with their own institute in the header.
            header(who == otherAdmin ? otherInst : inst);
            try {
                for (int i = 0; i < writes.size(); i++) {
                    assertEquals(expected, code(writes.get(i)), who.getUsername() + " write route #" + i);
                }
            List<Executable> reads = List.of(
                    () -> transfers.list(who, inst, null, null, null, null, 0, 50),
                    () -> transfers.get(who, inst, l1l3.id()),
                    () -> transfers.challanSeries(who, inst),
                    () -> counts.list(who, inst, null, null, null, 0, 50),
                    () -> counts.get(who, inst, open.id()),
                    () -> overview.overview(who, inst, null, null, null, null, 0, 50),
                    () -> overview.low(who, inst, l1, "REORDER", 0, 50),
                    () -> overview.variants(who, inst, null, null, false));
                for (int i = 0; i < reads.size(); i++) {
                    if (reader) {
                        try {
                            reads.get(i).execute();
                        } catch (Throwable t) {
                            throw new AssertionError("the accountant reads route #" + i, t);
                        }
                        continue;
                    }
                    assertEquals(expected, code(reads.get(i)), who.getUsername() + " read route #" + i);
                }
            } finally {
                header(inst);
            }
        }
        // Another institute's admin under its own institute: the module is off there.
        header(otherInst);
        assertEquals("FEATURE_DISABLED", code(() -> transfers.list(otherAdmin, otherInst, null, null, null, null, 0, 50)));
        assertEquals("FEATURE_DISABLED", code(() -> counts.list(otherAdmin, otherInst, null, null, null, 0, 50)));
        assertEquals("FEATURE_DISABLED", code(() -> labels.list(otherAdmin, otherInst, null, null, null, null, null, 0,
                50)));
        assertEquals("FEATURE_DISABLED", code(() -> overview.overview(otherAdmin, otherInst, null, null, null, null, 0,
                50)));
        header(inst);
        // An id of this institute named under another institute is not found there.
        assertEquals("TRANSFER_NOT_FOUND", code(() -> transferService.get(otherInst, l1l3.id())));

        // W2 reads no L1↔L3 transfer; the accountant reads without cost.
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> transfers.get(w2, inst, l1l3.id())));
        assertTrue(body(transfers.list(w2, inst, null, null, null, null, 0, 100)).transfers().stream()
                .noneMatch(t -> t.id().equals(l1l3.id())));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> transfers.challan(w2, inst, l1l3.id())));
        noCost(body(transfers.get(accountant, inst, l1l3.id())), "a transfer for the accountant");

        assertEquals(transfersBefore, count("SELECT count(*) FROM stock_transfer WHERE institute_id = ?", inst));
        assertEquals(countsBefore, count("SELECT count(*) FROM stock_count WHERE institute_id = ?", inst));
        assertEquals(labelsBefore, count("SELECT count(*) FROM commerce_label_request WHERE institute_id = ?", inst));
        assertEquals("DRAFT", transferStatus(l1l3.id()));
        assertEquals("OPEN", text("SELECT status FROM stock_count WHERE id = ?", open.id()));
        body(transfers.cancel(manager, inst, l1l3.id(), new StockOpsDtos.CancelRequest(key(), null)));
        body(counts.cancel(manager, inst, open.id(), new StockOpsDtos.CancelRequest(key(), null)));
    }
}
