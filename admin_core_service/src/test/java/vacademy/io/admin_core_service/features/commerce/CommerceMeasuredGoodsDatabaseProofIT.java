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
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
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
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductSummaryResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNote;
import vacademy.io.admin_core_service.features.commerce.document.pdf.CommerceDocumentHtml;
import vacademy.io.admin_core_service.features.commerce.document.pdf.CommerceDocumentPdfService;
import vacademy.io.admin_core_service.features.commerce.document.pdf.CommercePdfRenderer;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionClient;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotificationDispatcher;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CheckoutException;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceCheckoutService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStaffOrderService;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.StaffOrderRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosReceiptService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosRegisterService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosReturnService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSaleLookupService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSaleService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSessionService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSettingsService;
import vacademy.io.admin_core_service.features.commerce.returns.dto.ReturnDtos;
import vacademy.io.admin_core_service.features.commerce.security.CommercePinService;
import vacademy.io.admin_core_service.features.commerce.shipment.dto.ShipmentDtos;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.scheduler.StockReconciliationJob;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLocationService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockOverviewService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockReceiptService;
import vacademy.io.admin_core_service.features.commerce.storefront.dto.StorefrontDtos;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontCatalogService;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxClassDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxRateRuleDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxSettingDTO;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxClassService;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.payments.manager.RazorpayPaymentManager;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
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
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.when;

/**
 * WP-44 measured goods end to end (gate 21) against a real Postgres 16 with the whole Flyway chain
 * and the real Spring context. One cloth sold by the metre (qty_scale 10: a base unit is 10 cm) is
 * cut online (2.5 m through the built checkout, paid by a signed webhook, packed and shipped) and
 * at the till (3.4 m): one stock figure drops by exactly 59 base units, both invoices print the
 * length in metres with the rate per metre, the order email and the movements export read metres.
 * A second cloth sold in 0.5 m steps is refused off its step on every sales channel (online cart
 * and checkout, staff order, till sale, till exchange) with nothing written. A 1.2 m counter
 * return puts back exactly 12 base units and credits 12 × 12.34. After every test the nightly
 * reconciliation finds no drift.
 *
 * <p>Runs only when {@code COMMERCE_IT_PG_URL} names a database on this machine; skipped in the
 * default build like the other commerce database proofs. Every tax rate is a TEST placeholder.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CommerceMeasuredGoodsDatabaseProofIT {

    private static final String SELLER_GSTIN = "09AAACH7409R1ZZ";
    private static final String PIN = "482917";
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final String WEBHOOK_SECRET = "whsec-local-proof-only";
    private static final String KEY_SECRET = "key-secret-local-proof-only";
    private static final String KEY_ID = "rzp_test_localproof";
    private static final String WEBHOOK_PATH = "/admin-core-service/payments/webhook/callback/razorpay";
    private static final String PINCODE = "100001";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "24");
        registry.add("commerce.order-token.secret", () -> "local-proof-only-not-a-secret");
        registry.add("commerce.turnstile.required", () -> "false");
        registry.add("commerce.payment-fetch.cron", () -> "-");
    }

    static {
        System.setProperty("https.proxyHost", "127.0.0.1");
        System.setProperty("https.proxyPort", "9");
        System.setProperty("http.nonProxyHosts", "localhost|127.0.0.1");
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
    @Autowired private StorefrontCatalogService storefront;
    @Autowired private StockReconciliationJob reconciliationJob;
    @Autowired private CommercePinService pinService;
    @Autowired private CommerceOrderService orderService;
    @Autowired private CommerceCheckoutService checkoutService;
    @Autowired private CommerceShipmentService shipments;
    @Autowired private CommerceStaffOrderService staffOrders;
    @Autowired private CommerceOrderDeskService desk;
    @Autowired private PosRegisterService registers;
    @Autowired private PosSessionService sessions;
    @Autowired private PosSaleService sales;
    @Autowired private PosReceiptService receipts;
    @Autowired private PosSettingsService settings;
    @Autowired private PosReturnService posReturns;
    @Autowired private PosSaleLookupService lookups;
    @Autowired private CommerceDocumentPdfService pdfService;
    @Autowired private InvoiceRepository invoiceRepository;
    @Autowired private CommerceCreditNoteRepository creditNoteRepository;
    @Autowired private CommerceNotificationStore notificationStore;
    @Autowired private StockOverviewService overviewService;
    @Autowired private ObjectMapper objectMapper;
    @LocalServerPort private int port;

    @MockBean private AuthService authService;
    @SpyBean private RazorpayPaymentManager razorpay;
    @MockBean private InvoiceService invoiceService;
    @MockBean private WorkflowTriggerService workflowTriggerService;
    @MockBean private PaymentNotificatonService paymentNotificatonService;
    @MockBean private DynamicNotificationService dynamicNotificationService;
    @MockBean private AsyncEnrollmentEmailService asyncEnrollmentEmailService;
    @MockBean private MediaService mediaService;
    @MockBean private CommerceRenditionClient renditionClient;

    private final String inst = UUID.randomUUID().toString();
    private final String run = inst.substring(0, 8);
    private final AtomicInteger keys = new AtomicInteger();
    private final AtomicInteger phones = new AtomicInteger(500);
    private final AtomicInteger gatewayOrders = new AtomicInteger();

    private final String adminId = "admin-" + run;
    private final String cashierId = "cashier-" + run;
    private final String managerId = "manager-" + run;
    private CustomUserDetails admin;
    private CustomUserDetails cashier;

    private String online;      // L1: sells online, POS-enabled, the fulfilment location
    private String r1;
    private String r1Series;
    private String taxClass;    // cloth TEST, GST unit MTR (what the invoice prints)
    private String goodsClass;  // goods TEST, GST unit PCS
    private String cottonProduct;
    private String cotton;      // QUANTITY MTR, scale 10, step 1, 12.34 a base unit (123.40 a metre): 100 at L1
    private String linen;       // QUANTITY MTR, scale 10, step 5 (0.5 m), 20.00 a base unit: 100 at L1
    private String bag;         // counted, 100.00: the storefront sort
    private String cup;         // counted, 200.00: the storefront sort
    private int seatsAfterReceipt;
    private int slotsAfterReceipt;
    private String onlineOrder;     // 2.5 m of cotton
    private String posOrder;        // 3.4 m of cotton
    private String posLine;

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
                } else if (id.equals(cashierId)) {
                    roles.put(id, List.of("COMMERCE_POS_CASHIER"));
                }
            }
            return roles;
        });
        doAnswer(call -> {
            PaymentInitiationRequestDTO asked = call.getArgument(1);
            Map<String, Object> data = new HashMap<>();
            data.put("razorpayOrderId", "order_" + run + "m" + gatewayOrders.incrementAndGet());
            data.put("razorpayKeyId", KEY_ID);
            data.put("amount", Math.round(asked.getAmount() * 100));
            data.put("currency", asked.getCurrency());
            data.put("receipt", asked.getOrderId());
            data.put("status", "created");
            PaymentResponseDTO response = new PaymentResponseDTO();
            response.setOrderId(asked.getOrderId());
            response.setStatus("created");
            response.setResponseData(data);
            return response;
        }).when(razorpay).initiatePayment(any(), any(), any());
        doReturn(List.of()).when(razorpay).fetchOrderPayments(any(), any());
        header();
        admin = user(adminId, "ADMIN");
        cashier = user(cashierId, "COMMERCE_POS_CASHIER");
    }

    @AfterEach
    void reconciled() {
        header();
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

    private void header() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", inst);
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
        return "mg-" + run + "-" + keys.incrementAndGet();
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

    private static void note(String line) {
        System.out.println("MEASURED-PROOF " + line);
    }

    /** The money sign the PDFs print: the rupee sign, or "Rs. " when no font on this machine has it. */
    private static String rupee() {
        return CommercePdfRenderer.unicodeFontAvailable() ? "₹" : "Rs. ";
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

    private ProductResponse product(String slug, String name, String sku, String price, String stockMode,
                                    String unit, Integer qtyScale, Integer qtyStep) {
        ProductRequest request = ProductRequest.builder().slug(slug + "-" + run)
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name(name).build()))
                .taxClassId("MTR".equals(unit) ? taxClass : goodsClass).status("ACTIVE").stockMode(stockMode)
                .unit(unit).qtyScale(qtyScale).qtyStep(qtyStep)
                .variants(List.of(VariantRequest.builder().sku(sku + "-" + run).name("One size")
                        .price(new BigDecimal(price)).weightGrams(200).build()))
                .build();
        return productService.save(inst, adminId, request);
    }

    private static String variantOf(ProductResponse product) {
        return product.getVariants().get(0).getPackageSessionId();
    }

    private void receive(String packageSessionId, int quantity, String unitCost) {
        ReceiptRequest request = new ReceiptRequest();
        request.setLocationId(online);
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

    private static PosDtos.SaleLine line(String ref, String variant, int quantity) {
        return new PosDtos.SaleLine(ref, variant, quantity, null, null, null);
    }

    private static PosDtos.Tender cash(String amount) {
        return new PosDtos.Tender("CASH", amount(amount), null, null);
    }

    private static PosDtos.Approval pin(String approver, String raw) {
        return new PosDtos.Approval(approver, raw, "Checked at the counter");
    }

    private static PosDtos.SaleRequest body(String key, String session, List<PosDtos.SaleLine> lines,
                                            List<PosDtos.Tender> tenders, PosDtos.Exchange exchange) {
        return new PosDtos.SaleRequest(key, session, lines, null, null, tenders, exchange, null, null, null, null);
    }

    private PosSaleService.Outcome sell(String session, List<PosDtos.SaleLine> lines, List<PosDtos.Tender> tenders) {
        return sales.sale(cashier, inst, body(key(), session, lines, tenders, null));
    }

    private PosDtos.Quote quote(String session, List<PosDtos.SaleLine> lines, PosDtos.Exchange exchange) {
        return sales.quote(cashier, inst, body(null, session, lines, null, exchange));
    }

    /** Opens R1's counter; a note goes with a float that differs from the last close. */
    private String open(String opening) {
        String previous = text("SELECT (counted_cash - COALESCE(handover_amount, 0))::text FROM pos_session WHERE "
                + "institute_id = ? AND register_id = ? AND status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1", inst,
                r1);
        String noteText = previous != null && new BigDecimal(previous).compareTo(amount(opening)) != 0
                ? "Float changed at the start" : null;
        return sessions.open(cashier, inst, new PosDtos.SessionOpenRequest(key(), r1, amount(opening), noteText))
                .session().id();
    }

    private BigDecimal expected(String session) {
        return sessions.detail(admin, inst, session).summary().expectedCash();
    }

    private PosDtos.SessionView closeEven(String session) {
        return sessions.close(cashier, inst, session, new PosDtos.SessionCloseRequest(key(), expected(session), null,
                null, null)).session();
    }

    private int onHand(String variant) {
        return (int) count("SELECT COALESCE(SUM(on_hand), 0) FROM stock_level WHERE location_id = ? AND "
                + "package_session_id = ?", online, variant);
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

    private String status(String orderId) {
        return text("SELECT status FROM commerce_order WHERE id = ?", orderId);
    }

    private static String hmacHex(String secret, String text) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            StringBuilder hex = new StringBuilder();
            for (byte b : mac.doFinal(text.getBytes(StandardCharsets.UTF_8))) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** One real HTTP POST of a signed captured event for the order's gateway order and total. */
    private void payByWebhook(String orderId) {
        Map<String, Object> row = db.queryForMap("SELECT * FROM commerce_gateway_order WHERE commerce_order_id = ? "
                + "ORDER BY created_at DESC LIMIT 1", orderId);
        Map<String, Object> notes = new LinkedHashMap<>();
        notes.put("orderId", orderId);
        notes.put("instituteId", inst);
        notes.put("payment_type", "INITIAL");
        Map<String, Object> entity = new LinkedHashMap<>();
        entity.put("id", "pay_" + UUID.randomUUID().toString().substring(0, 14));
        entity.put("entity", "payment");
        entity.put("order_id", String.valueOf(row.get("gateway_order_id")));
        entity.put("amount", ((Number) row.get("amount_minor")).longValue());
        entity.put("currency", "INR");
        entity.put("status", "captured");
        entity.put("notes", notes);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("entity", "event");
        root.put("event", "payment.captured");
        root.put("payload", Map.of("payment", Map.of("entity", entity)));
        try {
            String payload = objectMapper.writeValueAsString(root);
            HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + WEBHOOK_PATH))
                    .header("Content-Type", "application/json")
                    .header("X-Razorpay-Signature", hmacHex(WEBHOOK_SECRET, payload))
                    .POST(HttpRequest.BodyPublishers.ofString(payload)).build();
            HttpResponse<String> response = HttpClient.newHttpClient().send(request,
                    HttpResponse.BodyHandlers.ofString());
            assertEquals(200, response.statusCode(), response.body());
        } catch (IOException e) {
            throw new IllegalStateException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private CartPriceRequest cart(Map<String, Integer> quantities) {
        List<CartPriceRequest.Line> lines = new ArrayList<>();
        quantities.forEach((variantId, quantity) -> lines.add(CartPriceRequest.Line.builder().variantId(variantId)
                .quantity(quantity).build()));
        return CartPriceRequest.builder().lines(lines).pincode(PINCODE).stateCode("09").build();
    }

    private CheckoutRequest checkout(Map<String, Integer> quantities, BigDecimal expectedTotal) {
        String phone = "98765" + String.format("%05d", phones.incrementAndGet());
        return CheckoutRequest.builder()
                .clientRequestId("order-" + run + "-" + keys.incrementAndGet())
                .lines(cart(quantities).getLines()).expectedTotal(expectedTotal)
                .customer(CheckoutRequest.Customer.builder().name("Proof Buyer").phone(phone)
                        .email("buyer-" + phone + "@example.invalid").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("1 Test Road").city("Test City")
                        .stateCode("09").pincode(PINCODE).build())
                .build();
    }

    /** A prepaid order through the built checkout, paid by the webhook: CONFIRMED. */
    private String paidOrder(Map<String, Integer> quantities) {
        BigDecimal total = orderService.priceCart(inst, cart(quantities)).snapshot().getTotal();
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, checkout(quantities, total), "127.0.0.1");
        payByWebhook(placed.getOrderId());
        assertEquals("CONFIRMED", status(placed.getOrderId()));
        return placed.getOrderId();
    }

    private List<ShipmentDtos.PackLine> openLines(String orderId) {
        List<ShipmentDtos.PackLine> out = new ArrayList<>();
        for (Map<String, Object> row : db.queryForList("SELECT id, quantity - qty_cancelled - qty_shipped AS open "
                + "FROM commerce_order_line WHERE order_id = ? AND line_type = 'ITEM' ORDER BY line_no", orderId)) {
            int open = ((Number) row.get("open")).intValue();
            if (open > 0) {
                out.add(ShipmentDtos.PackLine.builder().orderLineId(String.valueOf(row.get("id"))).quantity(open)
                        .build());
            }
        }
        return out;
    }

    private StaffOrderDtos.StaffOrderDetail pack(String orderId) {
        return shipments.pack(admin, inst, ShipmentDtos.PackRequest.builder().clientRequestId(key()).orderId(orderId)
                .fromStatus("CONFIRMED").lines(openLines(orderId)).build());
    }

    private StaffOrderDtos.StaffOrderDetail ship(String orderId) {
        String shipment = text("SELECT id FROM commerce_shipment WHERE order_id = ? AND status <> 'CANCELLED'",
                orderId);
        return shipments.ship(admin, inst, shipment, ShipmentDtos.ShipRequest.builder()
                .clientRequestId(key()).carrierName("Test Post").trackingNumber("TP" + run + "IN")
                .trackingUrl("https://track.example.com/").build());
    }

    private String invoiceHtml(String orderId) {
        String invoiceId = text("SELECT id FROM invoice WHERE commerce_order_id = ? AND cancelled_at IS NULL",
                orderId);
        assertNotNull(invoiceId, "an invoice for " + orderId);
        Invoice invoice = invoiceRepository.findById(invoiceId).orElseThrow();
        return CommerceDocumentHtml.build(pdfService.invoiceView(invoice));
    }

    /** What each refusal must leave untouched. */
    private Map<String, Long> written() {
        Map<String, Long> out = new LinkedHashMap<>();
        for (String table : List.of("commerce_order", "commerce_order_line", "stock_movement", "stock_hold",
                "commerce_return", "commerce_refund", "commerce_credit_note", "commerce_gateway_order")) {
            out.put(table, count("SELECT count(*) FROM " + table + " WHERE institute_id = ?", inst));
        }
        out.put("invoice", count("SELECT count(*) FROM invoice i JOIN commerce_order o ON o.id = i.commerce_order_id "
                + "WHERE o.institute_id = ?", inst));
        out.put("r1_series_next", nextValue(r1Series));
        out.put("linen_on_hand", (long) onHand(linen));
        out.put("linen_slots", (long) slots(linen));
        return out;
    }

    /** The export rows of one variant by movement type: column name → cell. */
    private List<Map<String, String>> csvRows(String variant) {
        LocalDate today = LocalDate.now(INDIA);
        StockOverviewService.Export export = overviewService.exportMovements(inst, Set.of(online), variant, null,
                today.minusDays(1), today.plusDays(1), true);
        List<String> lines = new String(export.csv(), StandardCharsets.UTF_8).lines().toList();
        List<String> head = Arrays.asList(lines.get(0).split(",", -1));
        List<Map<String, String>> rows = new ArrayList<>();
        for (String row : lines.subList(1, lines.size())) {
            String[] cells = row.split(",", -1);
            assertEquals(head.size(), cells.length, "a plain row of " + head.size() + " cells: " + row);
            Map<String, String> byName = new LinkedHashMap<>();
            for (int i = 0; i < head.size(); i++) {
                byName.put(head.get(i), cells[i]);
            }
            rows.add(byName);
        }
        note("CSV header " + lines.get(0));
        rows.forEach(r -> note("CSV row " + r));
        return rows;
    }

    // ================================================================== 1. the shop

    @Test
    @Order(1)
    void seed() {
        assertEquals("730", text("SELECT version FROM flyway_schema_history WHERE success AND version IS NOT NULL "
                + "ORDER BY installed_rank DESC LIMIT 1"), "Flyway target 730, no new migration");
        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', "
                + "'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), "
                + "('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", inst,
                "Measured Proof " + run, "https://shop-" + run + ".example.com");
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)",
                inst);
        capabilityResolver.evict(inst);
        taxSettingService.update(inst, adminId, TaxSettingDTO.builder().taxMode("REGULAR").sellerGstin(SELLER_GSTIN)
                .sellerLegalName("Proof Seller " + run).sellerAddress("1 Test Road, Test City 100001")
                .roundTotalTo("RUPEE").build());
        taxClass = taxClassService.create(inst, adminId, TaxClassDTO.builder().code("cloth_test")
                .name("cloth TEST").hsnCode("5208").unit("MTR")
                .rules(List.of(TaxRateRuleDTO.builder().minUnitPrice(new BigDecimal("0"))
                        .ratePercent(new BigDecimal("5")).effectiveFrom(LocalDate.of(2020, 4, 1)).build()))
                .build()).getId();
        goodsClass = taxClassService.create(inst, adminId, TaxClassDTO.builder().code("goods_test")
                .name("goods TEST").hsnCode("0000").unit("PCS")
                .rules(List.of(TaxRateRuleDTO.builder().minUnitPrice(new BigDecimal("0"))
                        .ratePercent(new BigDecimal("5")).effectiveFrom(LocalDate.of(2020, 4, 1)).build()))
                .build()).getId();
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("TAX_INVOICE")
                .prefix("MG" + run.substring(0, 2)).build());
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("CREDIT_NOTE")
                .prefix("MC" + run.substring(0, 2)).build());

        LocationRequest location = new LocationRequest();
        location.setCode("L1-" + run);
        location.setName("L1 " + run);
        location.setAddressLine1("1 Test Road");
        location.setCity("Test City");
        location.setPincode(PINCODE);
        location.setStateCode("09");
        location.setGstin(SELLER_GSTIN);
        location.setIsStore(true);
        location.setIsWarehouse(true);
        location.setIsPosEnabled(true);
        location.setSellsOnline(true);
        online = locationService.create(inst, adminId, true, location).getId();

        ProductResponse cottonMade = product("cotton-cloth", "Cotton cloth", "COTTON", "12.34", "QUANTITY", "MTR", 10,
                1);
        cottonProduct = cottonMade.getPackageId();
        cotton = variantOf(cottonMade);
        linen = variantOf(product("linen-cloth", "Linen cloth", "LINEN", "20.00", "QUANTITY", "MTR", 10, 5));
        bag = variantOf(product("plain-bag", "Plain bag", "BAG", "100.00", "QUANTITY", "PCS", 1, 1));
        cup = variantOf(product("steel-cup", "Steel cup", "CUP", "200.00", "QUANTITY", "PCS", 1, 1));
        receive(cotton, 100, "8.0000");
        receive(linen, 100, "10.0000");
        receive(bag, 5, "40.00");
        receive(cup, 5, "80.00");
        assertEquals(10, count("SELECT qty_scale FROM commerce_product WHERE package_id = ?", cottonProduct));
        assertEquals(5, count("SELECT p.qty_step FROM commerce_product p JOIN package_session ps ON ps.package_id = "
                + "p.package_id WHERE ps.id = ?", linen));

        db.update("INSERT INTO institute_payment_gateway_mapping (id, vendor, institute_id, "
                        + "payment_gateway_specific_data, status) VALUES (?, 'RAZORPAY', ?, ?, 'ACTIVE')",
                UUID.randomUUID().toString(), inst,
                "{\"apiKey\":\"" + KEY_ID + "\",\"apiSecret\":\"" + KEY_SECRET + "\",\"keySecret\":\"" + KEY_SECRET
                        + "\",\"webhookSecret\":\"" + WEBHOOK_SECRET + "\"}");
        snapshotLoader.evict(inst);

        db.update("INSERT INTO commerce_staff_location (id, institute_id, user_id, location_id, created_by) "
                + "VALUES (?, ?, ?, ?, ?)", UUID.randomUUID().toString(), inst, cashierId, online, adminId);
        db.update("INSERT INTO commerce_staff_location (id, institute_id, user_id, location_id, created_by) "
                + "VALUES (?, ?, ?, ?, ?)", UUID.randomUUID().toString(), inst, managerId, online, adminId);
        pinService.setPin(inst, managerId, PIN);
        settings.update(admin, inst, new PosDtos.SettingsRequest(amount("5.00"), amount("500.00"), amount("0.00")));
        PosRegisterService.Saved one = registers.create(admin, inst, new PosDtos.RegisterCreateRequest(key(), online,
                "r1-" + run.substring(0, 4), "Front counter", "R1" + run.substring(0, 2), null));
        r1 = one.register().id();
        r1Series = text("SELECT id FROM commerce_document_series WHERE register_id = ? AND channel = 'POS' AND kind = "
                + "'SYSTEM' AND location_id = ?", r1, online);
        assertNotNull(r1Series);

        assertEquals(100, onHand(cotton));
        seatsAfterReceipt = maxSeats(cotton);
        slotsAfterReceipt = slots(cotton);
        assertEquals(100, seatsAfterReceipt, "max_seats = base units at the online location");
        assertEquals(100, slotsAfterReceipt);
        noDrift("seed");
    }

    // ================================================================== 2. gate 21

    @Test
    @Order(2)
    void gate21_onlineCutAndTillCutLowerOneStockFigure() {
        String money = rupee();

        // (1) 2.5 m online: checkout, signed webhook, CONFIRMED; 25 base units held.
        onlineOrder = paidOrder(Map.of(cotton, 25));
        assertEquals(25, count("SELECT COALESCE(SUM(h.quantity), 0) FROM stock_hold h JOIN commerce_order_line l ON "
                + "l.user_plan_id = h.user_plan_id WHERE l.order_id = ? AND h.status = 'SOLD'", onlineOrder),
                "the paid order holds 25 base units");
        assertEquals(slotsAfterReceipt - 25, slots(cotton), "what may be sold drops by the hold");
        Map<String, Object> onlineLine = db.queryForMap("SELECT quantity, qty_scale, unit, unit_price, line_total "
                + "FROM commerce_order_line WHERE order_id = ? AND line_type = 'ITEM'", onlineOrder);
        assertEquals(25, ((Number) onlineLine.get("quantity")).intValue());
        assertEquals(10, ((Number) onlineLine.get("qty_scale")).intValue());
        assertEquals("MTR", onlineLine.get("unit"));
        same("308.50", (BigDecimal) onlineLine.get("line_total"), "2.5 m × 123.40 / m");

        // (2) pack issues the invoice; ship posts one SALE −25 at L1.
        pack(onlineOrder);
        assertEquals("PACKED", status(onlineOrder));
        ship(onlineOrder);
        assertEquals("SHIPPED", status(onlineOrder));
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE institute_id = ? AND package_session_id = ? "
                + "AND type = 'SALE' AND location_id = ? AND quantity_delta = -25", inst, cotton, online));
        assertEquals(75, onHand(cotton));
        noDrift("online ship");

        // (3) 3.4 m at the till: one POS_SALE −34 at L1, the bill rounded to the rupee.
        String s1 = open("500.00");
        PosDtos.Quote quoted = quote(s1, List.of(line("l1", cotton, 34)), null);
        assertTrue(quoted.unavailable() == null || quoted.unavailable().isEmpty(),
                String.valueOf(quoted.unavailable()));
        same("419.56", quoted.lines().get(0).net(), "3.4 m × 123.40 / m");
        same("420.00", quoted.totals().total(), "the counter bill rounds to the rupee");
        PosSaleService.Outcome sold = sell(s1, List.of(line("l1", cotton, 34)), List.of(cash("420.00")));
        posOrder = sold.answer().sale().orderId();
        posLine = sold.answer().sale().lines().get(0).orderLineId();
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE institute_id = ? AND package_session_id = ? "
                + "AND type = 'POS_SALE' AND location_id = ? AND quantity_delta = -34", inst, cotton, online));
        PosDtos.SaleDetailLine saleLine = sold.answer().sale().lines().get(0);
        assertEquals(34, saleLine.quantity());
        assertEquals(10, saleLine.qtyScale());
        assertEquals("MTR", saleLine.unit());
        closeEven(s1);

        // (4) one stock figure: 100 − 25 − 34 = 41; seats and slots each 59 lower than after the receipt.
        assertEquals(41, onHand(cotton), "on_hand at L1");
        assertEquals(seatsAfterReceipt - 59, maxSeats(cotton), "max_seats");
        assertEquals(slotsAfterReceipt - 59, slots(cotton), "available_slots");
        assertEquals(2, count("SELECT count(*) FROM stock_movement WHERE institute_id = ? AND package_session_id = ? "
                + "AND quantity_delta < 0", inst, cotton), "exactly two outbound movements");
        assertEquals(-59, count("SELECT COALESCE(SUM(quantity_delta), 0) FROM stock_movement WHERE institute_id = ? "
                + "AND package_session_id = ? AND quantity_delta < 0", inst, cotton));

        // (5) online invoice: one line of 25 base units of MTR at 12.34; the paper reads 2.5 m at 123.40 / m.
        Map<String, Object> onlineInvoiceLine = db.queryForMap("SELECT li.quantity, li.unit, li.unit_price, li.amount "
                + "FROM invoice_line_item li JOIN invoice i ON i.id = li.invoice_id WHERE i.commerce_order_id = ? AND "
                + "li.package_session_id = ?", onlineOrder, cotton);
        assertEquals(25, ((Number) onlineInvoiceLine.get("quantity")).intValue());
        assertEquals("MTR", onlineInvoiceLine.get("unit"));
        same("12.34", (BigDecimal) onlineInvoiceLine.get("unit_price"), "per base unit on the row");
        String onlineHtml = invoiceHtml(onlineOrder);
        assertTrue(onlineHtml.contains("<td class=\"num\">2.5 m</td>"), onlineHtml);
        assertTrue(onlineHtml.contains("<td class=\"num\">" + money + "123.40 / m</td>"), onlineHtml);
        assertTrue(onlineHtml.contains(money + "308.50"), "the line amount on the paper");
        assertFalse(onlineHtml.contains("2.5 MTR") || onlineHtml.contains(">25<"), "no raw code, no base units");
        note("online invoice row: 2.5 m | " + money + "123.40 / m | " + money + "308.50");

        // (6) POS invoice: 34 base units; 3.4 m at 123.40 / m; line 419.56; total 420.00 with the round-off read.
        Map<String, Object> posInvoiceLine = db.queryForMap("SELECT li.quantity, li.unit, li.unit_price, li.amount "
                + "FROM invoice_line_item li JOIN invoice i ON i.id = li.invoice_id WHERE i.commerce_order_id = ? AND "
                + "li.package_session_id = ?", posOrder, cotton);
        assertEquals(34, ((Number) posInvoiceLine.get("quantity")).intValue());
        same("419.56", (BigDecimal) posInvoiceLine.get("amount"), "POS line amount");
        String posHtml = invoiceHtml(posOrder);
        assertTrue(posHtml.contains("<td class=\"num\">3.4 m</td>"), posHtml);
        assertTrue(posHtml.contains("<td class=\"num\">" + money + "123.40 / m</td>"), posHtml);
        assertFalse(posHtml.contains("3.4 MTR"), "no raw code");
        BigDecimal total = money("SELECT total FROM commerce_order WHERE id = ?", posOrder);
        BigDecimal lines = money("SELECT COALESCE(SUM(line_total), 0) FROM commerce_order_line WHERE order_id = ?",
                posOrder);
        BigDecimal roundOff = money("SELECT round_off FROM commerce_order WHERE id = ?", posOrder);
        same("420.00", total, "POS order total");
        same("419.56", lines, "POS line total");
        assertEquals(0, total.subtract(lines).compareTo(roundOff), "round_off = total − lines: " + roundOff);
        same(total.toPlainString(), money("SELECT total_amount FROM invoice WHERE commerce_order_id = ?", posOrder),
                "invoice total = order total");
        note("POS invoice row: 3.4 m | " + money + "123.40 / m | line 419.56 | total " + total + " | round_off "
                + roundOff);

        // (7) the counter receipt answer carries the length in base units with its scale and unit.
        PosDtos.Receipt receipt = receipts.receipt(cashier, inst, posOrder);
        PosDtos.ReceiptLine receiptLine = receipt.lines().get(0);
        assertEquals(34, receiptLine.quantity());
        assertEquals(10, receiptLine.qtyScale());
        assertEquals("MTR", receiptLine.unit());
        same("420.00", receipt.totals().total(), "receipt total");
    }

    // ================================================================== 3. the step on every sales channel

    @Test
    @Order(3)
    void stepViolationIsRefusedOnEveryChannel() {
        Map<String, Long> before = written();

        // Online cart: 2.3 m of a cloth cut in 0.5 m steps is unavailable QUANTITY_STEP with the step.
        CommerceOrderService.CartPrice priced = orderService.priceCart(inst, cart(Map.of(linen, 23)));
        assertEquals(1, priced.view().getUnavailable().size(), String.valueOf(priced.view().getUnavailable()));
        CartPriceDtos.UnavailableLine off = priced.view().getUnavailable().get(0);
        assertEquals("QUANTITY_STEP", off.getReason());
        assertEquals(5, off.getQtyStep());
        // Checkout: CART_CHANGED, no order.
        CheckoutException changed = assertThrows(CheckoutException.class, () -> checkoutService.placeOrder(inst,
                checkout(Map.of(linen, 23), amount("460.00")), "127.0.0.1"));
        assertEquals(CheckoutException.CART_CHANGED, changed.getCode());

        String s = open("500.00");
        Map<String, Long> afterOpen = written();
        // POS quote: the line is listed unavailable.
        PosDtos.Quote quoted = quote(s, List.of(line("l1", linen, 23)), null);
        assertTrue(quoted.unavailable().stream().anyMatch(u -> "l1".equals(u.lineRef())
                && "QUANTITY_STEP".equals(u.reason())), String.valueOf(quoted.unavailable()));
        // POS sale: 400 QUANTITY_STEP naming the line and the step in metres.
        RuntimeException till = refused("QUANTITY_STEP", () -> sell(s, List.of(line("l1", linen, 23)),
                List.of(cash("460.00"))));
        assertInstanceOf(InvalidRequestException.class, till);
        assertEquals("QUANTITY_STEP: line l1 is sold in steps of 0.5 m", till.getMessage());
        // Staff order: 400 QUANTITY_STEP.
        RuntimeException staff = refused("QUANTITY_STEP", () -> staffOrders.create(admin, inst,
                StaffOrderRequest.builder().clientRequestId(key())
                        .customer(StaffOrderRequest.Customer.builder().phone("98765" + String.format("%05d",
                                phones.incrementAndGet())).name("Phone Buyer").build())
                        .shippingAddress(CheckoutRequest.Address.builder().line1("2 Test Lane").city("Test City")
                                .stateCode("09").pincode(PINCODE).build())
                        .restOnCredit(true)
                        .lines(List.of(StaffOrderRequest.Line.builder().variantId(linen).quantity(23).build()))
                        .build()));
        assertInstanceOf(InvalidRequestException.class, staff);
        assertTrue(staff.getMessage().endsWith("is sold in steps of 0.5 m"), staff.getMessage());
        assertEquals(afterOpen, written(), "no refusal wrote anything");
        assertEquals(before, written(), "nor the cart and the checkout");
        note("till refusal: " + till.getMessage());
        note("staff order refusal: " + staff.getMessage());

        // POS exchange: credit from a returned 1 m of linen; spending it on 2.3 m is refused the same way.
        PosSaleService.Outcome metre = sell(s, List.of(line("l1", linen, 10)), List.of(cash("200.00")));
        PosDtos.ReturnAnswer credit = posReturns.create(cashier, inst, new PosDtos.ReturnRequest(key(), s,
                metre.answer().sale().orderId(), List.of(new PosDtos.ReturnLine(metre.answer().sale().lines().get(0)
                .orderLineId(), 10, "RESALEABLE", null)), "DEFECTIVE", null, null,
                new PosDtos.Settle("EXCHANGE", null, null), null)).answer();
        same("200.00", credit.exchangeCredit(), "exchange credit");
        Map<String, Long> beforeExchange = written();
        PosDtos.Exchange exchange = new PosDtos.Exchange(credit.returnId(), null);
        RuntimeException swap = refused("QUANTITY_STEP", () -> sales.sale(cashier, inst, body(key(), s,
                List.of(line("l1", linen, 23)), List.of(cash("260.00")), exchange)));
        assertEquals("QUANTITY_STEP: line l1 is sold in steps of 0.5 m", swap.getMessage());
        assertEquals(beforeExchange, written(), "the refused exchange wrote nothing");
        assertEquals(0, count("SELECT count(*) FROM commerce_order WHERE exchange_of_order_id = ?",
                metre.answer().sale().orderId()));

        // On the step it sells: 2.5 m as an exchange (200.00 credit + 300.00 cash) and 2.5 m as a plain bill.
        PosDtos.Quote swapQuote = quote(s, List.of(line("l1", linen, 25)), exchange);
        same("500.00", swapQuote.totals().total(), "2.5 m × 200.00 / m");
        same("200.00", swapQuote.exchangeCredit(), "the credit");
        PosSaleService.Outcome swapped = sales.sale(cashier, inst, body(key(), s, List.of(line("l1", linen, 25)),
                List.of(cash("300.00")), exchange));
        assertEquals(metre.answer().sale().orderId(), text("SELECT exchange_of_order_id FROM commerce_order WHERE "
                + "id = ?", swapped.answer().sale().orderId()));
        PosSaleService.Outcome plain = sell(s, List.of(line("l1", linen, 25)), List.of(cash("500.00")));
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE type = 'POS_SALE' AND quantity_delta = -25 "
                + "AND package_session_id = ? AND reference_id IN (SELECT id FROM commerce_order_line WHERE "
                + "order_id = ?)",
                linen, plain.answer().sale().orderId()));
        assertEquals(100 - 10 + 10 - 25 - 25, onHand(linen));
        closeEven(s);
    }

    // ================================================================== 4. 1.2 m back at the counter

    @Test
    @Order(4)
    void partialReturnOf1point2MetresRestoresExactlyThat() {
        String money = rupee();
        String s = open("500.00");
        assertEquals(41, onHand(cotton));
        BigDecimal drawer = expected(s);
        PosDtos.ReturnPreview preview = posReturns.preview(cashier, inst, new PosDtos.ReturnPreviewRequest(s, posOrder,
                List.of(new PosDtos.ReturnLine(posLine, 12, null, null)), "DEFECTIVE",
                new PosDtos.Settle("REFUND", "CASH", null)));
        assertTrue(preview.needsApproval().isEmpty(), "148.08 is within the 500.00 cash refund limit: "
                + preview.needsApproval());

        PosReturnService.Outcome back = posReturns.create(cashier, inst, new PosDtos.ReturnRequest(key(), s, posOrder,
                List.of(new PosDtos.ReturnLine(posLine, 12, "RESALEABLE", null)), "DEFECTIVE", "Cut too long", null,
                new PosDtos.Settle("REFUND", "CASH", null), null));
        PosDtos.ReturnAnswer answer = back.answer();
        same("148.08", answer.credit(), "12 × 12.34");
        assertNotNull(answer.creditNoteId());

        // One RETURN +12 at L1 at the sale's unit cost; on_hand 41 → 53.
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE type = 'RETURN' AND location_id = ? AND "
                + "quantity_delta = 12 AND unit_cost = 8 AND package_session_id = ? AND reference_id IN "
                + "(SELECT id FROM commerce_return_line WHERE return_id = ?)", online, cotton, answer.returnId()));
        assertEquals(53, onHand(cotton));
        assertEquals(12, count("SELECT qty_returned FROM commerce_order_line WHERE id = ?", posLine));
        PosDtos.SaleDetailLine after = lookups.detail(cashier, inst, posOrder, s).lines().get(0);
        assertEquals(12, after.qtyReturned());
        assertEquals(22, after.returnable());

        // The credit note line: 12 base units, 148.08; the paper reads 1.2 m at 123.40 / m.
        Map<String, Object> noteLine = db.queryForMap("SELECT quantity, unit, unit_price, amount FROM "
                + "commerce_credit_note_line WHERE credit_note_id = ?", answer.creditNoteId());
        assertEquals(12, ((Number) noteLine.get("quantity")).intValue());
        assertEquals("MTR", noteLine.get("unit"));
        same("148.08", (BigDecimal) noteLine.get("amount"), "credit note line");
        CommerceCreditNote note = creditNoteRepository.findById(answer.creditNoteId()).orElseThrow();
        String html = CommerceDocumentHtml.build(pdfService.creditNoteView(note));
        assertTrue(html.contains("<td class=\"num\">1.2 m</td>"), html);
        assertTrue(html.contains("<td class=\"num\">" + money + "123.40 / m</td>"), html);
        assertTrue(html.contains(money + "148.08"), "the credit on the paper");
        assertFalse(html.contains("1.2 MTR") || html.contains(">12<"), "no raw code, no base units");
        note("credit note row: 1.2 m | " + money + "123.40 / m | " + money + "148.08; note total " + note.getTotal());

        // The money back is the credit note's total, out of this drawer.
        assertEquals("PROCESSED", answer.refund().status());
        assertEquals(0, note.getTotal().compareTo(answer.refund().amount()), "refund = credit note total");
        assertEquals(0, drawer.subtract(answer.refund().amount()).compareTo(expected(s)), "the cash left the drawer");

        // The order's return summary counts a measured line as one item.
        List<ReturnDtos.ReturnSummary> returns = desk.detail(inst, posOrder, admin, false).getReturns();
        assertEquals(1, returns.size());
        assertEquals(1, returns.get(0).getUnits(), "1.2 m reads as one item, not 12");

        // 2.3 m more than the 2.2 m left: refused, nothing written.
        long movements = count("SELECT count(*) FROM stock_movement WHERE institute_id = ?", inst);
        refused("RETURN_QTY_EXCEEDED", () -> posReturns.create(cashier, inst, new PosDtos.ReturnRequest(key(), s,
                posOrder, List.of(new PosDtos.ReturnLine(posLine, 23, "RESALEABLE", null)), "DEFECTIVE", null, null,
                new PosDtos.Settle("REFUND", "CASH", null), pin(managerId, PIN))));
        assertEquals(movements, count("SELECT count(*) FROM stock_movement WHERE institute_id = ?", inst));
        assertEquals(1, count("SELECT count(*) FROM commerce_return WHERE order_id = ?", posOrder));
        assertEquals(53, onHand(cotton));
        closeEven(s);
    }

    // ================================================================== 5. the catalogue rules

    @Test
    @Order(5)
    void measuredRulesOnTheCatalogue() {
        long products = count("SELECT count(*) FROM commerce_product WHERE institute_id = ?", inst);
        RuntimeException piece = refused("VALIDATION", () -> product("one-off-cloth", "One-off cloth", "ONEOFF",
                "10.00", "PIECE", "MTR", 10, 1));
        assertEquals("VALIDATION: a one-of-a-kind item is counted in pieces (qty_scale 1)", piece.getMessage());
        RuntimeException four = refused("VALIDATION", () -> product("odd-cloth", "Odd cloth", "ODD", "10.00",
                "QUANTITY", "MTR", 4, 1));
        assertEquals("VALIDATION: qty_scale is 1, 10, 100 or 1000", four.getMessage());
        assertEquals(products, count("SELECT count(*) FROM commerce_product WHERE institute_id = ?", inst));

        ProductSummaryResponse summary = productService.list(inst, null, null, null, 0, 50).getContent().stream()
                .filter(p -> p.getPackageId().equals(cottonProduct)).findFirst().orElseThrow();
        assertEquals("MTR", summary.getUnit());
        assertEquals(10, summary.getQtyScale());
        assertEquals(1, summary.getQtyStep());
        same("12.34", summary.getMinPrice(), "summary price per base unit");

        // The shop's price sort compares a metre: 100.00 < 123.40 / m < 200.00.
        snapshotLoader.evict(inst);
        List<String> ids = storefront.list(inst, new StorefrontCatalogService.ProductQuery(null, null, Map.of(), null,
                null, null, StorefrontCatalogService.SORT_PRICE_ASC, 1, 50, false, "en")).getData().stream()
                .map(StorefrontDtos.ProductCard::getDefaultVariantId).toList();
        int bagAt = ids.indexOf(bag);
        int cottonAt = ids.indexOf(cotton);
        int cupAt = ids.indexOf(cup);
        assertTrue(bagAt >= 0 && cottonAt >= 0 && cupAt >= 0, ids.toString());
        assertTrue(bagAt < cottonAt && cottonAt < cupAt, "sorted " + ids);
        List<String> band = storefront.list(inst, new StorefrontCatalogService.ProductQuery(null, null, Map.of(),
                amount("110"), amount("150"), null, StorefrontCatalogService.SORT_PRICE_ASC, 1, 50, false, "en"))
                .getData().stream().map(StorefrontDtos.ProductCard::getDefaultVariantId).toList();
        assertEquals(List.of(cotton), band, "only the 123.40 / m cloth is between 110 and 150");
        StorefrontDtos.ProductCard card = storefront.list(inst, new StorefrontCatalogService.ProductQuery(null, null,
                Map.of(), amount("110"), amount("150"), null, null, 1, 50, false, "en")).getData().get(0);
        same("12.34", card.getPrice().getAmount(), "the card keeps the per-base-unit amount");
        assertEquals(10, card.getQtyScale());
    }

    // ================================================================== 6. email and export

    @Test
    @Order(6)
    void emailAndCsvShowMetres() {
        List<Map<String, Object>> items = notificationStore.itemLines(onlineOrder);
        assertEquals(1, items.size());
        assertEquals("2.5 m", CommerceNotificationDispatcher.itemQuantity(items.get(0)),
                "the order email's quantity cell");
        note("email item quantity: " + CommerceNotificationDispatcher.itemQuantity(items.get(0)));

        List<Map<String, String>> rows = csvRows(cotton);
        Map<String, String> sale = rows.stream().filter(r -> "SALE".equals(r.get("type"))).findFirst().orElseThrow();
        assertEquals("2.5", sale.get("qty_out"));
        assertEquals("m", sale.get("unit"));
        Map<String, String> till = rows.stream().filter(r -> "POS_SALE".equals(r.get("type"))).findFirst()
                .orElseThrow();
        assertEquals("3.4", till.get("qty_out"));
        assertEquals("", till.get("qty_in"));
        assertEquals("m", till.get("unit"));
        assertEquals("4.1", till.get("balance_after"), "41 base units left after the till cut");
        assertEquals("80.0000", till.get("unit_cost"), "cost per metre");
        Map<String, String> returned = rows.stream().filter(r -> "RETURN".equals(r.get("type"))).findFirst()
                .orElseThrow();
        assertEquals("1.2", returned.get("qty_in"));
        assertEquals("5.3", returned.get("balance_after"));
        Map<String, String> received = rows.stream().filter(r -> "RECEIPT".equals(r.get("type"))).findFirst()
                .orElseThrow();
        assertEquals("10", received.get("qty_in"));

        // A counted item keeps its whole numbers and has no unit sign.
        Map<String, String> bagRow = csvRows(bag).get(0);
        assertEquals("5", bagRow.get("qty_in"));
        assertEquals("", bagRow.get("unit"));
    }

    // ================================================================== 7. fix round (WP-44 review)

    /** A measured product on the given tax class (the helper above picks the class by unit). */
    private ProductResponse measuredOn(String classId, String slug, String name, String sku, String price, int step) {
        return productService.save(inst, adminId, ProductRequest.builder().slug(slug + "-" + run)
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name(name).build()))
                .taxClassId(classId).status("ACTIVE").stockMode("QUANTITY").unit("MTR").qtyScale(10).qtyStep(step)
                .variants(List.of(VariantRequest.builder().sku(sku + "-" + run).name("One size")
                        .price(new BigDecimal(price)).weightGrams(200).build()))
                .build());
    }

    /**
     * W1: a cloth whose tax class is quoted per piece (PCS) still prints "2.5 m" at "₹123.40 / m":
     * the invoice row keeps the item's own unit (MTR), the tax class unit only for counted goods.
     */
    @Test
    @Order(7)
    void w1_aClothOnAPieceTaxClassStillPrintsMetres() {
        String money = rupee();
        String muslin = variantOf(measuredOn(goodsClass, "muslin-cloth", "Muslin cloth", "MUSLIN", "12.34", 1));
        receive(muslin, 50, "8.0000");
        snapshotLoader.evict(inst);
        String s = open("500.00");
        PosDtos.Quote quoted = quote(s, List.of(line("l1", muslin, 25)), null);
        same("308.50", quoted.lines().get(0).net(), "2.5 m × 123.40 / m");
        PosSaleService.Outcome sold = sell(s, List.of(line("l1", muslin, 25)),
                List.of(new PosDtos.Tender("CASH", quoted.totals().total(), null, null)));
        String order = sold.answer().sale().orderId();
        closeEven(s);

        Map<String, Object> row = db.queryForMap("SELECT li.quantity, li.unit FROM invoice_line_item li JOIN invoice i "
                + "ON i.id = li.invoice_id WHERE i.commerce_order_id = ? AND li.package_session_id = ?", order, muslin);
        assertEquals(25, ((Number) row.get("quantity")).intValue());
        assertEquals("MTR", row.get("unit"), "the item's unit, not the tax class's PCS");
        assertEquals("PCS", text("SELECT unit FROM commerce_tax_class WHERE id = ?", goodsClass));
        String html = invoiceHtml(order);
        assertTrue(html.contains("<td class=\"num\">2.5 m</td>"), html);
        assertTrue(html.contains("<td class=\"num\">" + money + "123.40 / m</td>"), html);
        note("PCS tax class invoice row: 2.5 m | " + money + "123.40 / m");

        // A counted item on the same class keeps the class unit as before.
        String s2 = open("500.00");
        PosSaleService.Outcome bagSale = sell(s2, List.of(line("l1", bag, 1)), List.of(cash("100.00")));
        closeEven(s2);
        assertEquals("PCS", text("SELECT li.unit FROM invoice_line_item li JOIN invoice i ON i.id = li.invoice_id "
                + "WHERE i.commerce_order_id = ?", bagSale.answer().sale().orderId()));
    }

    /** W2: a measured product whose unit is blank or a piece code is refused; nothing is written. */
    @Test
    @Order(8)
    void w2_aMeasuredProductInPiecesIsRefused() {
        long products = count("SELECT count(*) FROM commerce_product WHERE institute_id = ?", inst);
        RuntimeException pcs = refused("VALIDATION", () -> product("pcs-cloth", "Pcs cloth", "PCSCLOTH", "10.00",
                "QUANTITY", "PCS", 10, 1));
        assertEquals("VALIDATION: a measured item needs its unit (MTR, KG, …)", pcs.getMessage());
        RuntimeException none = refused("VALIDATION", () -> product("plain-cloth", "Plain cloth", "PLAINCLOTH",
                "10.00", "QUANTITY", null, 10, 1));
        assertEquals("VALIDATION: a measured item needs its unit (MTR, KG, …)", none.getMessage());
        refused("VALIDATION", () -> product("nos-cloth", "Nos cloth", "NOSCLOTH", "10.00", "QUANTITY", "PIECES", 10, 1));
        assertEquals(products, count("SELECT count(*) FROM commerce_product WHERE institute_id = ?", inst),
                "no product row written");
        note("measured product in pieces: " + pcs.getMessage());
    }

    /**
     * W8: a paper bill of 2.3 m of the linen (sold in 0.5 m) is keyed in as written: the quote marked
     * paper_bill and the bill-book entry price it, one POS_SALE −23 is posted. The till still refuses it.
     */
    @Test
    @Order(9)
    void w8_aPaperBillOffTheStepIsRecorded() {
        LocalDate today = LocalDate.now(INDIA);
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("TAX_INVOICE").kind("MANUAL_BOOK")
                .prefix("MB" + run.substring(0, 2)).locationId(online).bookFrom(300L).bookTo(399L).build());
        String s = open("500.00");
        int before = onHand(linen);
        refused("QUANTITY_STEP", () -> sell(s, List.of(line("l1", linen, 23)), List.of(cash("460.00"))));

        PosDtos.Quote tillQuote = quote(s, List.of(line("l1", linen, 23)), null);
        assertEquals("QUANTITY_STEP", tillQuote.unavailable().get(0).reason(), "the till's quote keeps the step");
        PosDtos.Quote paperQuote = sales.quote(cashier, inst, new PosDtos.SaleRequest(null, s,
                List.of(line("l1", linen, 23)), null, null, null, null, null, null, null, null, null, Boolean.TRUE));
        assertTrue(paperQuote.unavailable() == null || paperQuote.unavailable().isEmpty(),
                String.valueOf(paperQuote.unavailable()));
        same("460.00", paperQuote.totals().total(), "2.3 m × 200.00 / m");

        PosSaleService.Outcome entered = sales.billBook(cashier, inst, new PosDtos.SaleRequest(key(), s,
                List.of(line("l1", linen, 23)), null, null, List.of(cash("460.00")), null, pin(managerId, PIN), null,
                "301", today.toString()));
        String order = entered.answer().sale().orderId();
        assertEquals(23, entered.answer().sale().lines().get(0).quantity());
        assertEquals("301", text("SELECT external_invoice_number FROM invoice WHERE commerce_order_id = ?", order));
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE type = 'POS_SALE' AND quantity_delta = -23 "
                + "AND package_session_id = ? AND reference_id IN (SELECT id FROM commerce_order_line WHERE "
                + "order_id = ?)", linen, order));
        assertEquals(before - 23, onHand(linen));
        note("paper bill 2.3 m of a 0.5 m-step cloth: order " + order + ", on_hand " + before + " -> " + onHand(linen));
        closeEven(s);
    }

    /**
     * W9: less than one sale step left (0.4 m of a cloth cut in 0.5 m) is sold out in the cart, not
     * "only 0 m"; the product page reads the per-order maximum from the detail.
     */
    @Test
    @Order(10)
    void w9_lessThanOneStepLeftIsSoldOut() {
        ProductResponse made = measuredOn(taxClass, "silk-cloth", "Silk cloth", "SILK", "30.00", 5);
        String silk = variantOf(made);
        receive(silk, 4, "15.0000");
        snapshotLoader.evict(inst);
        assertEquals(4, slots(silk));

        CartPriceDtos.UnavailableLine line = orderService.priceCart(inst, cart(Map.of(silk, 5))).view()
                .getUnavailable().get(0);
        assertEquals("OUT_OF_STOCK", line.getReason());
        assertNull(line.getAvailableQuantity(), "no 'only 0 m'");
        note("0.4 m left at a 0.5 m step: " + line.getReason());

        receive(silk, 6, "15.0000");
        snapshotLoader.evict(inst);
        CartPriceDtos.UnavailableLine more = orderService.priceCart(inst, cart(Map.of(silk, 15))).view()
                .getUnavailable().get(0);
        assertEquals("INSUFFICIENT_STOCK", more.getReason(), "one step and more left: a smaller length");
        assertTrue(orderService.priceCart(inst, cart(Map.of(silk, 10))).view().getUnavailable().isEmpty());

        StorefrontDtos.ProductDetail detail = storefront.detail(inst, made.getSlug(), "en");
        assertEquals(25, detail.getMaxOrderQuantity(), "the per-order maximum in metres");
        assertEquals(10, detail.getQtyScale());
    }

    /**
     * W11 (read, not changed): a measured line returned part resaleable, part damaged is one return
     * line of that order line, so the return summary already reads 1 item.
     */
    @Test
    @Order(11)
    void w11_aSplitMeasuredReturnIsOneItem() {
        String s = open("500.00");
        PosReturnService.Outcome back = posReturns.create(cashier, inst, new PosDtos.ReturnRequest(key(), s, posOrder,
                List.of(new PosDtos.ReturnLine(posLine, 10, "RESALEABLE", null),
                        new PosDtos.ReturnLine(posLine, 2, "DAMAGED", null)), "DEFECTIVE", null, null,
                new PosDtos.Settle("REFUND", "CASH", null), pin(managerId, PIN)));
        String returnId = back.answer().returnId();
        assertEquals(1, count("SELECT count(*) FROM commerce_return_line WHERE return_id = ?", returnId),
                "one return line for the one order line");
        ReturnDtos.ReturnSummary summary = desk.detail(inst, posOrder, admin, false).getReturns().stream()
                .filter(r -> r.getId().equals(returnId)).findFirst().orElseThrow();
        assertEquals(1, summary.getUnits(), "1.0 m resaleable + 0.2 m damaged of one cloth line is one item");
        closeEven(s);
    }

    /** W12: the till's price-changed answer names the new price per metre. */
    @Test
    @Order(12)
    void w12_thePriceChangedAnswerIsPerMetre() {
        String s = open("500.00");
        RuntimeException changed = refused("PRICE_CHANGED", () -> sell(s,
                List.of(new PosDtos.SaleLine("l1", cotton, 10, null, null, new BigDecimal("12.00"))),
                List.of(cash("123.00"))));
        assertEquals("PRICE_CHANGED: line l1 is now ₹123.40 / m", changed.getMessage());
        note("price changed: " + changed.getMessage());
        closeEven(s);
    }

    private static void assertInstanceOf(Class<?> type, Object value) {
        assertTrue(type.isInstance(value), "expected " + type.getSimpleName() + ", got " + value);
    }
}
