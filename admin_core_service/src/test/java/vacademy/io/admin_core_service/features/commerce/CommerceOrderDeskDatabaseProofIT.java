package vacademy.io.admin_core_service.features.commerce;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterAll;
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
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionClient;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceCheckoutService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderQueryService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceLineCancelService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceReceiptService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStaffOrderService;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.StaffOrderRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.shipment.dto.ShipmentDtos;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
import vacademy.io.admin_core_service.features.commerce.stock.dto.AdjustmentRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.scheduler.StockReconciliationJob;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockAdjustmentService;
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
import vacademy.io.admin_core_service.features.payments.manager.RazorpayPaymentManager;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.when;

/**
 * Database-backed proof of the order desk (WP-30) on a local Postgres with the real Flyway
 * chain (V688 included) and the real Spring context. Orders are made through the built prepaid
 * checkout and paid by a signed webhook posted to this application's own port, or created by
 * staff through {@code POST /orders}. Then: pack (one invoice), ship (SALE rows and their keys,
 * counters, the hold closed, the cost of the goods), deliver; RTO and RTO received both ways
 * (gate 3, prepaid half); undo shipped and ship again (gate 24); cancel at PACKED; unpack and
 * re-pack; a line cancel on a staff credit order; receipts to PAID; races; and the stock-short
 * flag after a damage entry. The reconciliation finds no drift after every step.
 *
 * <p>Same pattern as {@link CommerceCheckoutDatabaseProofIT}: skipped unless
 * {@code COMMERCE_IT_PG_URL} names a database on this machine; nothing leaves the machine (the
 * auth service is a mock, the gateway's one remote call is stubbed). Every tax rate is a TEST
 * placeholder.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CommerceOrderDeskDatabaseProofIT {

    private static final String SELLER_GSTIN = "09AAACH7409R1ZZ";
    private static final String WEBHOOK_SECRET = "whsec-local-proof-only";
    private static final String KEY_SECRET = "key-secret-local-proof-only";
    private static final String KEY_ID = "rzp_test_localproof";
    private static final String WEBHOOK_PATH = "/admin-core-service/payments/webhook/callback/razorpay";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        registry.add("commerce.order-token.secret", () -> "local-proof-only-not-a-secret");
        registry.add("commerce.turnstile.required", () -> "false");
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "40");
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
    @Autowired private StockAdjustmentService adjustmentService;
    @Autowired private CommerceTaxSettingService taxSettingService;
    @Autowired private CommerceTaxClassService taxClassService;
    @Autowired private CommerceDocumentSeriesService seriesService;
    @Autowired private StorefrontSnapshotLoader snapshotLoader;
    @Autowired private CommerceOrderService orderService;
    @Autowired private CommerceCheckoutService checkoutService;
    @Autowired private CommerceOrderQueryService queryService;
    @Autowired private CommerceOrderDeskService desk;
    @Autowired private CommerceShipmentService shipments;
    @Autowired private CommerceLineCancelService lineCancels;
    @Autowired private CommerceReceiptService receipts;
    @Autowired private CommerceStaffOrderService staffOrders;
    @Autowired private StockReconciliationJob reconciliationJob;
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
    private final String actor = "admin-" + run;
    private final AtomicInteger users = new AtomicInteger();
    private final AtomicInteger keys = new AtomicInteger();
    private final AtomicInteger phones = new AtomicInteger(300);
    private final AtomicInteger gatewayOrders = new AtomicInteger();

    private String wh;
    private String taxClass;
    private String qtyA;     // 20 in stock, 1000.00: pack, ship, deliver; undo shipped; unpack and re-pack
    private String pieceA;   // 2 pieces, 800.00: RTO and RTO received both ways
    private String pieceB;   // 2 pieces, 600.00: cancel at PACKED
    private String credit;   // 10 in stock, 500.00: staff orders
    private String raceV;    // 10 in stock, 300.00: races
    private String shortV;   // 3 in stock, 400.00: stock short

    private CustomUserDetails admin;

    @BeforeEach
    void outsideServicesAnswerLocally() {
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), anyString(), anyBoolean()))
                .thenAnswer(call -> {
                    UserDTO user = new UserDTO();
                    user.setId("buyer-" + run + "-" + users.incrementAndGet());
                    return user;
                });
        doAnswer(call -> {
            PaymentInitiationRequestDTO asked = call.getArgument(1);
            Map<String, Object> data = new HashMap<>();
            data.put("razorpayOrderId", "order_" + run + "d" + gatewayOrders.incrementAndGet());
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
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(actor);
        dto.setUsername(actor);
        dto.setFullName("Proof Admin");
        dto.setAuthorities(List.of("ADMIN"));
        admin = new CustomUserDetails(dto);
    }

    @AfterAll
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    private void header() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", inst);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    // ------------------------------------------------------------------ helpers

    private String key() {
        return "desk-" + run + "-" + keys.incrementAndGet();
    }

    private long count(String query, Object... args) {
        Long n = db.queryForObject(query, Long.class, args);
        return n == null ? 0 : n;
    }

    private String text(String query, Object... args) {
        return db.queryForObject(query, String.class, args);
    }

    private BigDecimal money(String query, Object... args) {
        return db.queryForObject(query, BigDecimal.class, args);
    }

    private int slots(String packageSessionId) {
        return db.queryForObject("SELECT available_slots FROM package_session WHERE id = ?", Integer.class,
                packageSessionId);
    }

    private int seats(String packageSessionId) {
        return db.queryForObject("SELECT max_seats FROM package_session WHERE id = ?", Integer.class, packageSessionId);
    }

    private int onHand(String packageSessionId) {
        return db.queryForObject("SELECT on_hand FROM stock_level WHERE location_id = ? AND package_session_id = ?",
                Integer.class, wh, packageSessionId);
    }

    private int deficit(String packageSessionId) {
        return db.queryForObject("SELECT COALESCE(sellable_deficit, 0) FROM commerce_variant WHERE package_session_id = ?",
                Integer.class, packageSessionId);
    }

    private void noDrift(String step) {
        List<StockReconciliationJob.Drift> drift = reconciliationJob.findSellableDrift().stream()
                .filter(d -> inst.equals(d.instituteId())).toList();
        assertTrue(drift.isEmpty(), "drift after " + step + ": " + drift);
    }

    private String status(String orderId) {
        return text("SELECT status FROM commerce_order WHERE id = ?", orderId);
    }

    private String variant(String slug, String sku, String price, boolean pieces) {
        ProductRequest request = ProductRequest.builder().slug(slug + "-" + run)
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name(slug + " " + run).build()))
                .taxClassId(taxClass).status("ACTIVE").stockMode(pieces ? "PIECE" : "QUANTITY")
                .variants(List.of(VariantRequest.builder().sku(sku + "-" + run).name("One size")
                        .price(new BigDecimal(price)).weightGrams(200).build()))
                .build();
        return productService.save(inst, actor, request).getVariants().get(0).getPackageSessionId();
    }

    private void receive(String packageSessionId, int quantity) {
        ReceiptRequest request = new ReceiptRequest();
        request.setLocationId(wh);
        request.setSourceKind("OTHER");
        request.setNote("proof stock");
        request.setClientRequestId("rc-" + packageSessionId);
        ReceiptRequest.Line line = new ReceiptRequest.Line();
        line.setPackageSessionId(packageSessionId);
        line.setQuantity(quantity);
        line.setUnitCost(new BigDecimal("100.00"));
        request.setLines(List.of(line));
        receiptService.create(inst, actor, true, request);
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

    /** A prepaid order through the built checkout, paid by the webhook: CONFIRMED. */
    private String paidOrder(Map<String, Integer> quantities) {
        List<CartPriceRequest.Line> lines = new ArrayList<>();
        quantities.forEach((variantId, quantity) -> lines.add(CartPriceRequest.Line.builder().variantId(variantId)
                .quantity(quantity).build()));
        BigDecimal total = orderService.priceCart(inst, CartPriceRequest.builder().lines(lines).pincode("226001")
                .build()).snapshot().getTotal();
        String phone = "98765" + String.format("%05d", phones.incrementAndGet());
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, CheckoutRequest.builder()
                .clientRequestId("order-" + run + "-" + keys.incrementAndGet())
                .lines(lines).expectedTotal(total)
                .customer(CheckoutRequest.Customer.builder().name("Proof Buyer").phone(phone)
                        .email("buyer-" + phone + "@example.invalid").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("1 Proof Road").city("Lucknow")
                        .pincode("226001").build())
                .build(), "127.0.0.1");
        payByWebhook(placed.getOrderId());
        assertEquals("CONFIRMED", status(placed.getOrderId()));
        return placed.getOrderId();
    }

    private List<ShipmentDtos.PackLine> openLines(String orderId, List<String> pieceCodes) {
        List<ShipmentDtos.PackLine> out = new ArrayList<>();
        for (Map<String, Object> row : db.queryForList("SELECT id, quantity - qty_cancelled - qty_shipped AS open "
                + "FROM commerce_order_line WHERE order_id = ? AND line_type = 'ITEM' ORDER BY line_no", orderId)) {
            int open = ((Number) row.get("open")).intValue();
            if (open > 0) {
                out.add(ShipmentDtos.PackLine.builder().orderLineId(String.valueOf(row.get("id"))).quantity(open)
                        .pieceCodes(pieceCodes).build());
            }
        }
        return out;
    }

    private StaffOrderDtos.StaffOrderDetail pack(String orderId, List<String> pieceCodes) {
        return shipments.pack(admin, inst, ShipmentDtos.PackRequest.builder().clientRequestId(key()).orderId(orderId)
                .fromStatus("CONFIRMED").lines(openLines(orderId, pieceCodes)).build());
    }

    private String liveShipment(String orderId) {
        return text("SELECT id FROM commerce_shipment WHERE order_id = ? AND status <> 'CANCELLED'", orderId);
    }

    private StaffOrderDtos.StaffOrderDetail ship(String orderId, String clientKey) {
        return shipments.ship(admin, inst, liveShipment(orderId), ShipmentDtos.ShipRequest.builder()
                .clientRequestId(clientKey).carrierName("India Post").trackingNumber("EM" + run + "IN")
                .trackingUrl("https://www.indiapost.gov.in/track").build());
    }

    private StaffOrderDtos.StaffOrderDetail toStatus(String orderId, ShipmentDtos.StatusRequest.StatusRequestBuilder b) {
        return shipments.status(admin, inst, liveShipment(orderId), b.clientRequestId(key()).build());
    }

    private StaffOrderDtos.StaffOrderDetail move(String orderId, String from, String to) {
        return desk.transition(admin, inst, orderId, OrderDeskDtos.TransitionRequest.builder().clientRequestId(key())
                .fromStatus(from).toStatus(to).reason("proof").build());
    }

    private List<String> pieceCodes(String packageSessionId, int n) {
        return db.queryForList("SELECT code FROM commerce_piece WHERE package_session_id = ? AND status = 'IN_STOCK' "
                + "ORDER BY code LIMIT ?", String.class, packageSessionId, n);
    }

    private String lineOf(String orderId) {
        return text("SELECT id FROM commerce_order_line WHERE order_id = ? AND line_type = 'ITEM' ORDER BY line_no "
                + "LIMIT 1", orderId);
    }

    private long liveInvoices(String orderId) {
        return count("SELECT count(*) FROM invoice i WHERE i.commerce_order_id = ? AND i.cancelled_at IS NULL "
                + "AND i.total_amount > COALESCE((SELECT SUM(cn.total) FROM commerce_credit_note cn "
                + "WHERE cn.invoice_id = i.id), 0)", orderId);
    }

    // ------------------------------------------------------------------ seed

    @Test
    @Order(1)
    void seed_aShopWithStockAndDocumentSeries() {
        assertEquals(1, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version = '688'"),
                "V688 is in the Flyway history");
        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", inst,
                "Desk Proof " + run, "https://shop-" + run + ".example.com");
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)", inst);
        capabilityResolver.evict(inst);
        taxSettingService.update(inst, actor, TaxSettingDTO.builder().taxMode("REGULAR").sellerGstin(SELLER_GSTIN)
                .sellerLegalName("Proof Seller " + run).sellerAddress("1 Proof Road, Lucknow 226001")
                .roundTotalTo("RUPEE").build());
        taxClass = taxClassService.create(inst, actor, TaxClassDTO.builder().code("cloth_test").name("cloth TEST")
                .hsnCode("5208").unit("PCS")
                .rules(List.of(TaxRateRuleDTO.builder().minUnitPrice(new BigDecimal("0"))
                        .ratePercent(new BigDecimal("5")).effectiveFrom(LocalDate.of(2020, 4, 1)).build()))
                .build()).getId();
        seriesService.create(inst, actor, DocumentSeriesDTO.builder().documentType("TAX_INVOICE")
                .prefix("DK" + run.substring(0, 2)).build());
        seriesService.create(inst, actor, DocumentSeriesDTO.builder().documentType("CREDIT_NOTE")
                .prefix("DC" + run.substring(0, 2)).build());

        LocationRequest location = new LocationRequest();
        location.setCode("WH-" + run);
        location.setName("WH " + run);
        location.setAddressLine1("1 Proof Road");
        location.setCity("Lucknow");
        location.setPincode("226001");
        location.setStateCode("09");
        location.setGstin(SELLER_GSTIN);
        location.setIsStore(false);
        location.setIsWarehouse(true);
        location.setIsPosEnabled(false);
        location.setSellsOnline(true);
        wh = locationService.create(inst, actor, true, location).getId();

        qtyA = variant("qty-a", "QA", "1000.00", false);
        pieceA = variant("piece-a", "PA", "800.00", true);
        pieceB = variant("piece-b", "PB", "600.00", true);
        credit = variant("credit", "CR", "500.00", false);
        raceV = variant("race", "RV", "300.00", false);
        shortV = variant("short", "SV", "400.00", false);
        receive(qtyA, 20);
        receive(pieceA, 2);
        receive(pieceB, 2);
        receive(credit, 10);
        receive(raceV, 10);
        receive(shortV, 3);
        db.update("INSERT INTO institute_payment_gateway_mapping (id, vendor, institute_id, payment_gateway_specific_data, "
                        + "status) VALUES (?, 'RAZORPAY', ?, ?, 'ACTIVE')", UUID.randomUUID().toString(), inst,
                "{\"apiKey\":\"" + KEY_ID + "\",\"apiSecret\":\"" + KEY_SECRET + "\",\"keySecret\":\"" + KEY_SECRET
                        + "\",\"webhookSecret\":\"" + WEBHOOK_SECRET + "\"}");
        snapshotLoader.evict(inst);
        assertEquals(20, slots(qtyA));
        assertEquals(2, count("SELECT count(*) FROM commerce_piece WHERE package_session_id = ? AND status = 'IN_STOCK'",
                pieceA));
        noDrift("seed");
    }

    // ------------------------------------------------------------------ pack, ship, deliver

    @Test
    @Order(2)
    void prepaid_packShipDeliver() {
        String orderId = paidOrder(Map.of(qtyA, 2));
        noDrift("pay");
        int available = slots(qtyA);
        int maxSeats = seats(qtyA);
        int shelf = onHand(qtyA);

        StaffOrderDtos.StaffOrderDetail packed = pack(orderId, null);
        assertEquals("PACKED", status(orderId));
        assertEquals(1, liveInvoices(orderId), "one invoice at pack");
        String number = text("SELECT invoice_number FROM invoice WHERE commerce_order_id = ?", orderId);
        assertTrue(number.startsWith("DK"), number);
        assertEquals(0, money("SELECT total_amount FROM invoice WHERE commerce_order_id = ?", orderId)
                .compareTo(money("SELECT total FROM commerce_order WHERE id = ?", orderId)), "invoice total = order total");
        assertEquals(0, count("SELECT count(*) FROM stock_movement WHERE institute_id = ? AND type = 'SALE'", inst));
        assertTrue(packed.getNextActions().contains("SHIP"), packed.getNextActions().toString());
        assertEquals(1, packed.getShipments().size());
        assertNotNull(packed.getInvoiceId());
        noDrift("pack");

        ship(orderId, key());
        String line = lineOf(orderId);
        String shipmentLine = text("SELECT id FROM commerce_shipment_line WHERE order_line_id = ?", line);
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE institute_id = ? AND type = 'SALE' "
                + "AND idempotency_key = ? AND quantity_delta = -2 AND reference_type = 'SHIPMENT_LINE' "
                + "AND reference_id = ?", inst, "SALE:" + shipmentLine + ":1", shipmentLine));
        assertEquals(shelf - 2, onHand(qtyA));
        assertEquals(maxSeats - 2, seats(qtyA));
        assertEquals(available, slots(qtyA), "a ship does not change what may be sold");
        assertEquals(1, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.id = ? AND h.status = 'RESTORED' AND h.release_reason = 'SHIPPED'", line));
        assertEquals(0, new BigDecimal("200.00").compareTo(money("SELECT cost_total FROM commerce_order_line WHERE id = ?",
                line)), "2 x 100.00");
        assertEquals("SHIPPED", status(orderId));
        noDrift("ship");

        toStatus(orderId, ShipmentDtos.StatusRequest.builder().to("DELIVERED"));
        assertEquals("DELIVERED", status(orderId));
        assertNotNull(text("SELECT delivered_on::text FROM commerce_shipment WHERE order_id = ?", orderId));
        assertEquals(5, count("SELECT count(*) FROM commerce_order_status_history WHERE order_id = ?", orderId),
                "a history row per change: placed, confirmed, packed, shipped, delivered");
        noDrift("deliver");

        // The desk's list and queues read the same rows.
        StaffOrderDtos.StaffOrderPage page = queryService.staffList(inst, new CommerceOrderQueryService
                .StaffListFilter(null, null, null, null, null, "EM" + run + "IN", null, null), 0, 20);
        assertEquals(1, page.getTotal(), "search by tracking number");
        assertEquals("DELIVERED", page.getOrders().get(0).getShipmentStatus());
        assertNotNull(page.getOrders().get(0).getStatusSince());
    }

    // ------------------------------------------------------------------ gate 3, prepaid half

    @Test
    @Order(3)
    void gate3_rtoAndRtoReceivedResaleableThenDamaged() {
        String orderId = paidOrder(Map.of(pieceA, 1));
        pack(orderId, pieceCodes(pieceA, 1));
        String piece = text("SELECT id FROM commerce_piece WHERE order_line_id = ?", lineOf(orderId));
        assertEquals("RESERVED", text("SELECT status FROM commerce_piece WHERE id = ?", piece));
        ship(orderId, key());
        assertEquals("SOLD", text("SELECT status FROM commerce_piece WHERE id = ?", piece));
        int afterShip = slots(pieceA);
        long movements = count("SELECT count(*) FROM stock_movement WHERE institute_id = ?", inst);

        toStatus(orderId, ShipmentDtos.StatusRequest.builder().to("RTO").rtoReason("REFUSED"));
        assertEquals("RTO", status(orderId));
        assertEquals(movements, count("SELECT count(*) FROM stock_movement WHERE institute_id = ?", inst),
                "an RTO moves no stock");
        assertEquals(afterShip, slots(pieceA), "the parcel is not buyable while it travels back");
        assertEquals(0, liveInvoices(orderId), "the RTO credits the invoice in full");
        assertEquals(1, count("SELECT count(*) FROM commerce_credit_note WHERE commerce_order_id = ?", orderId));
        CartPriceDtos.CartPrice tooMany = orderService.priceCart(inst, CartPriceRequest.builder().lines(List.of(
                CartPriceRequest.Line.builder().variantId(pieceA).quantity(afterShip + 1).build())).pincode("226001")
                .build()).view();
        assertFalse(tooMany.getUnavailable().isEmpty(), "one more than the free stock cannot be bought");
        assertTrue(List.of("OUT_OF_STOCK", "INSUFFICIENT_STOCK").contains(tooMany.getUnavailable().get(0).getReason()));
        noDrift("rto");

        String line = lineOf(orderId);
        toStatus(orderId, ShipmentDtos.StatusRequest.builder().to("RTO_RECEIVED").lines(List.of(
                ShipmentDtos.StatusLine.builder().orderLineId(line).condition("RESALEABLE").quantity(1)
                        .pieceIds(List.of(piece)).build())));
        assertEquals("IN_STOCK", text("SELECT status FROM commerce_piece WHERE id = ?", piece));
        assertEquals(afterShip + 1, slots(pieceA), "back on sale");
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE institute_id = ? AND type = 'RETURN' "
                + "AND piece_id = ? AND reason IS NULL", inst, piece));
        BigDecimal paid = money("SELECT amount_paid FROM commerce_order WHERE id = ?", orderId);
        assertEquals(0, paid.compareTo(money("SELECT refund_due FROM commerce_order WHERE id = ?", orderId)));
        assertEquals(1, count("SELECT count(*) FROM commerce_payment_exception WHERE commerce_order_id = ? AND kind = "
                + "'REFUND_DUE' AND gateway_payment_id = ?", orderId, "RTO:" + liveShipment(orderId)));
        assertEquals("RTO", status(orderId));
        noDrift("rto received resaleable");

        // A second order whose parcel comes back damaged.
        String second = paidOrder(Map.of(pieceA, 1));
        pack(second, pieceCodes(pieceA, 1));
        String piece2 = text("SELECT id FROM commerce_piece WHERE order_line_id = ?", lineOf(second));
        ship(second, key());
        toStatus(second, ShipmentDtos.StatusRequest.builder().to("RTO").rtoReason("DAMAGED"));
        int before = slots(pieceA);
        int deficitBefore = deficit(pieceA);
        toStatus(second, ShipmentDtos.StatusRequest.builder().to("RTO_RECEIVED").lines(List.of(
                ShipmentDtos.StatusLine.builder().orderLineId(lineOf(second)).condition("DAMAGED").quantity(1)
                        .pieceIds(List.of(piece2)).build())));
        assertEquals("WRITTEN_OFF", text("SELECT status FROM commerce_piece WHERE id = ?", piece2));
        // The piece may be the one the first parcel brought back: count this parcel's rows only.
        String secondLine = text("SELECT id FROM commerce_shipment_line WHERE order_line_id = ?", lineOf(second));
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE institute_id = ? AND type = 'RETURN' AND "
                + "piece_id = ? AND reference_id = ? AND reason IS NULL", inst, piece2, secondLine));
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE institute_id = ? AND type = 'DAMAGE' AND "
                + "piece_id = ? AND reference_id = ? AND reason = 'DAMAGED_IN_TRANSIT'", inst, piece2, secondLine));
        assertEquals(before, slots(pieceA), "RETURN then DAMAGE: the counters net to zero");
        assertEquals(deficitBefore, deficit(pieceA));
        noDrift("rto received damaged");
    }

    // ------------------------------------------------------------------ gate 24

    @Test
    @Order(4)
    void gate24_undoShippedThenShipAgain() {
        String orderId = paidOrder(Map.of(qtyA, 2));
        pack(orderId, null);
        int available = slots(qtyA);
        int maxSeats = seats(qtyA);
        int shelf = onHand(qtyA);
        ship(orderId, key());
        String line = lineOf(orderId);
        assertEquals(maxSeats - 2, seats(qtyA));

        StaffOrderDtos.StaffOrderDetail undone = move(orderId, "SHIPPED", "PACKED");
        assertEquals("PACKED", status(orderId));
        assertEquals(maxSeats, seats(qtyA));
        assertEquals(shelf, onHand(qtyA));
        assertEquals(available, slots(qtyA));
        assertEquals(1, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.id = ? AND h.status = 'SOLD'", line), "the hold is SOLD again");
        assertNull(db.queryForObject("SELECT cost_total FROM commerce_order_line WHERE id = ?", BigDecimal.class, line));
        assertEquals(0, count("SELECT qty_shipped FROM commerce_order_line WHERE id = ?", line));
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE institute_id = ? AND reason = 'SHIP_UNDO' "
                + "AND reverses_movement_id IS NOT NULL", inst));
        assertTrue(undone.getNextActions().contains("SHIP"));
        assertEquals(1, liveInvoices(orderId), "the invoice is kept");
        noDrift("undo shipped");

        ship(orderId, key());
        String shipmentLine = text("SELECT id FROM commerce_shipment_line WHERE order_line_id = ?", line);
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE idempotency_key = ?",
                "SALE:" + shipmentLine + ":2"), "a second ship posts new keys");
        assertEquals(-2, count("SELECT COALESCE(SUM(quantity_delta), 0) FROM stock_movement WHERE type = 'SALE' "
                + "AND reference_id = ?", shipmentLine), "net SALE = -qty_shipped");
        assertEquals(2, count("SELECT qty_shipped FROM commerce_order_line WHERE id = ?", line));
        assertEquals(maxSeats - 2, seats(qtyA));
        noDrift("ship again");
    }

    // ------------------------------------------------------------------ cancel at PACKED; unpack, re-pack

    @Test
    @Order(5)
    void cancelAtPackedLeavesStockAndDocumentsRight() {
        String orderId = paidOrder(Map.of(pieceB, 1));
        int paidSlots = slots(pieceB);
        pack(orderId, pieceCodes(pieceB, 1));
        String piece = text("SELECT id FROM commerce_piece WHERE order_line_id = ?", lineOf(orderId));
        move(orderId, "PACKED", "CANCELLED");

        assertEquals("CANCELLED", status(orderId));
        assertEquals("IN_STOCK", text("SELECT status FROM commerce_piece WHERE id = ?", piece));
        assertNull(text("SELECT order_line_id FROM commerce_piece WHERE id = ?", piece));
        assertEquals(paidSlots + 1, slots(pieceB), "the unit is on sale again at once");
        assertEquals(1, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.status = 'RESTORED' AND h.release_reason = 'CANCELLED'",
                orderId));
        assertEquals(0, liveInvoices(orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_credit_note WHERE commerce_order_id = ?", orderId),
                "one credit note covers the unpack and the cancel");
        assertEquals(1, count("SELECT count(*) FROM commerce_payment_exception WHERE commerce_order_id = ? AND kind = "
                + "'REFUND_DUE'", orderId));
        assertEquals(0, count("SELECT count(*) FROM stock_movement sm JOIN commerce_shipment_line sl ON sl.id = "
                + "sm.reference_id JOIN commerce_order_line l ON l.id = sl.order_line_id WHERE l.order_id = ?", orderId));
        assertEquals(1, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.status = 'CANCELED'", orderId));
        noDrift("cancel at packed");
    }

    @Test
    @Order(6)
    void unpackThenRepackIssuesACreditNoteThenASecondInvoice() {
        String orderId = paidOrder(Map.of(qtyA, 1));
        pack(orderId, null);
        String first = text("SELECT invoice_number FROM invoice WHERE commerce_order_id = ?", orderId);
        move(orderId, "PACKED", "CONFIRMED");
        assertEquals("CONFIRMED", status(orderId));
        assertEquals(0, liveInvoices(orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_credit_note WHERE commerce_order_id = ?", orderId));
        pack(orderId, null);
        assertEquals("PACKED", status(orderId));
        assertEquals(1, liveInvoices(orderId), "exactly one live invoice");
        String second = text("SELECT invoice_number FROM invoice WHERE commerce_order_id = ? ORDER BY created_at DESC "
                + "LIMIT 1", orderId);
        assertNotEquals(first, second);
        noDrift("re-pack");
    }

    // ------------------------------------------------------------------ staff orders

    private StaffOrderRequest.StaffOrderRequestBuilder staffOrder(int quantity) {
        String phone = "98765" + String.format("%05d", phones.incrementAndGet());
        return StaffOrderRequest.builder().clientRequestId(key())
                .customer(StaffOrderRequest.Customer.builder().phone(phone).name("Phone Buyer").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("2 Proof Lane").city("Lucknow")
                        .pincode("226001").build())
                .lines(List.of(StaffOrderRequest.Line.builder().variantId(credit).quantity(quantity).build()));
    }

    private void moneyInvariants(String orderId) {
        BigDecimal paid = money("SELECT amount_paid FROM commerce_order WHERE id = ?", orderId);
        BigDecimal total = money("SELECT total FROM commerce_order WHERE id = ?", orderId);
        assertEquals(0, paid.compareTo(money("SELECT COALESCE(SUM(amount), 0) FROM commerce_order_tender WHERE "
                + "order_id = ? AND status = 'RECEIVED'", orderId)), "received tenders = amount paid");
        assertEquals(0, total.subtract(paid).compareTo(money("SELECT COALESCE(SUM(amount), 0) FROM "
                + "commerce_order_tender WHERE order_id = ? AND status = 'PENDING'", orderId)), "pending = total - paid");
        assertEquals(0, total.max(paid).compareTo(money("SELECT COALESCE(SUM(payment_amount), 0)::numeric(12,2) FROM "
                + "payment_log WHERE payment_group_id = (SELECT payment_group_id FROM commerce_order WHERE id = ?)",
                orderId)), "logs = max(total, paid)");
    }

    @Test
    @Order(7)
    void lineCancelOneOfThreeOnAStaffCreditOrder() {
        StaffOrderDtos.StaffOrderDetail created = staffOrders.create(admin, inst, staffOrder(3).restOnCredit(true)
                .build()).detail();
        String orderId = created.getOrder().getId();
        assertEquals("CONFIRMED", status(orderId));
        assertEquals("ADMIN", text("SELECT channel FROM commerce_order WHERE id = ?", orderId));
        assertEquals(3, count("SELECT h.quantity FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.status = 'SOLD'", orderId));
        assertEquals("OFFLINE", text("SELECT p.vendor FROM payment_log p JOIN commerce_order_line l ON l.payment_log_id "
                + "= p.id WHERE l.order_id = ?", orderId));
        moneyInvariants(orderId);
        BigDecimal before = money("SELECT total FROM commerce_order WHERE id = ?", orderId);
        int available = slots(credit);
        noDrift("staff order");

        String line = lineOf(orderId);
        lineCancels.cancelLine(admin, inst, orderId, line, OrderDeskDtos.LineCancelRequest.builder()
                .clientRequestId(key()).quantity(1).reason("asked on the phone").build());
        assertEquals(2, count("SELECT h.quantity FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.status = 'SOLD'", orderId));
        assertEquals(available + 1, slots(credit));
        BigDecimal value = money("SELECT cancelled_value FROM commerce_order_line WHERE id = ?", line);
        assertEquals(0, before.subtract(value).compareTo(money("SELECT total FROM commerce_order WHERE id = ?", orderId)));
        moneyInvariants(orderId);
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE reference_id = ? AND kind = 'LINE_CANCELLED'",
                line));
        noDrift("line cancel");

        pack(orderId, null);
        String invoiceId = text("SELECT id FROM invoice WHERE commerce_order_id = ?", orderId);
        assertEquals(2, count("SELECT SUM(quantity) FROM invoice_line_item WHERE invoice_id = ? AND source_id = "
                + "(SELECT line_ref FROM commerce_order_line WHERE id = ?)", invoiceId, line), "two units invoiced");
        assertEquals(0, money("SELECT total_amount FROM invoice WHERE id = ?", invoiceId)
                .compareTo(money("SELECT total FROM commerce_order WHERE id = ?", orderId)));
        noDrift("pack after line cancel");
    }

    @Test
    @Order(8)
    void staffOrderWithATypedPriceCreditAndTwoReceiptsEndsPaid() {
        StaffOrderDtos.StaffOrderDetail created = staffOrders.create(admin, inst, staffOrder(1)
                .lines(List.of(StaffOrderRequest.Line.builder().variantId(credit).quantity(1)
                        .unitPriceOverride(new BigDecimal("450.00")).build()))
                .tenders(List.of(StaffOrderRequest.Tender.builder().mode("CASH").amount(new BigDecimal("100.00"))
                        .build()))
                .restOnCredit(true).build()).detail();
        String orderId = created.getOrder().getId();
        String line = lineOf(orderId);
        assertEquals(0, new BigDecimal("450.00").compareTo(money("SELECT unit_price FROM commerce_order_line WHERE id = ?",
                line)));
        assertEquals(0, new BigDecimal("500.00").compareTo(money("SELECT list_unit_price FROM commerce_order_line WHERE "
                + "id = ?", line)));
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE reference_id = ? AND kind = "
                + "'LINE_PRICE_OVERRIDE'", line));
        assertEquals("PARTIALLY_PAID", text("SELECT payment_status FROM commerce_order WHERE id = ?", orderId));
        moneyInvariants(orderId);

        BigDecimal total = money("SELECT total FROM commerce_order WHERE id = ?", orderId);
        receipts.record(admin, inst, orderId, OrderDeskDtos.ReceiptRequest.builder().clientRequestId(key()).mode("UPI")
                .amount(new BigDecimal("200.00")).reference("UPI-1").build());
        moneyInvariants(orderId);
        receipts.record(admin, inst, orderId, OrderDeskDtos.ReceiptRequest.builder().clientRequestId(key())
                .mode("BANK_TRANSFER").amount(total.subtract(new BigDecimal("300.00"))).reference("NEFT-1").build());
        assertEquals("PAID", text("SELECT payment_status FROM commerce_order WHERE id = ?", orderId));
        assertEquals("PAID", text("SELECT p.payment_status FROM payment_log p JOIN commerce_order_line l ON "
                + "l.payment_log_id = p.id WHERE l.id = ?", line));
        assertEquals("ACTIVE", text("SELECT up.status FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = "
                + "up.id WHERE l.id = ?", line));
        moneyInvariants(orderId);
        assertEquals(2, count("SELECT count(*) FROM commerce_audit WHERE reference_id = ? AND kind = 'RECEIPT_RECORDED'",
                orderId));
        noDrift("receipts");
    }

    // ------------------------------------------------------------------ races

    private List<Object> atOnce(List<Callable<Object>> tasks) {
        ExecutorService pool = Executors.newFixedThreadPool(Math.max(4, tasks.size()));
        CountDownLatch ready = new CountDownLatch(tasks.size());
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Object>> futures = new ArrayList<>();
        for (Callable<Object> task : tasks) {
            futures.add(pool.submit(() -> {
                header();
                ready.countDown();
                go.await();
                try {
                    return task.call();
                } catch (Exception e) {
                    return e;
                } finally {
                    RequestContextHolder.resetRequestAttributes();
                }
            }));
        }
        List<Object> results = new ArrayList<>();
        try {
            assertTrue(ready.await(30, TimeUnit.SECONDS));
            go.countDown();
            for (Future<Object> future : futures) {
                results.add(future.get(120, TimeUnit.SECONDS));
            }
        } catch (Exception e) {
            throw new IllegalStateException(e);
        } finally {
            pool.shutdownNow();
        }
        return results;
    }

    @Test
    @Order(9)
    void racesShipTwiceCancelTwiceAndAReplay() {
        String orderId = paidOrder(Map.of(raceV, 2));
        pack(orderId, null);
        String keyA = key();
        String keyB = key();
        List<Object> ships = atOnce(List.of(() -> ship(orderId, keyA), () -> ship(orderId, keyB)));
        long won = ships.stream().filter(r -> r instanceof StaffOrderDtos.StaffOrderDetail).count();
        assertEquals(1, won, ships.toString());
        Object lost = ships.stream().filter(r -> !(r instanceof StaffOrderDtos.StaffOrderDetail)).findFirst()
                .orElseThrow();
        assertTrue(lost instanceof ConflictException && ((ConflictException) lost).getMessage()
                .startsWith("SHIPMENT_STATE_CHANGED"), String.valueOf(lost));
        String shipmentLine = text("SELECT id FROM commerce_shipment_line WHERE order_line_id = ?", lineOf(orderId));
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE reference_id = ? AND type = 'SALE'",
                shipmentLine), "one SALE set");
        noDrift("two ships");

        // A replay of the winning key answers the same order and posts nothing.
        String winnerKey = ships.get(0) instanceof StaffOrderDtos.StaffOrderDetail ? keyA : keyB;
        long movements = count("SELECT count(*) FROM stock_movement WHERE institute_id = ?", inst);
        StaffOrderDtos.StaffOrderDetail again = ship(orderId, winnerKey);
        assertEquals(Boolean.TRUE, again.getReplayed());
        assertEquals("SHIPPED", again.getOrder().getStatus());
        assertEquals(movements, count("SELECT count(*) FROM stock_movement WHERE institute_id = ?", inst));

        String toCancel = paidOrder(Map.of(raceV, 3));
        int available = slots(raceV);
        List<Object> cancels = atOnce(List.of(() -> move(toCancel, "CONFIRMED", "CANCELLED"),
                () -> move(toCancel, "CONFIRMED", "CANCELLED")));
        assertEquals(1, cancels.stream().filter(r -> r instanceof StaffOrderDtos.StaffOrderDetail).count(),
                cancels.toString());
        assertEquals(available + 3, slots(raceV), "one give-back");
        assertEquals(1, count("SELECT count(*) FROM commerce_payment_exception WHERE commerce_order_id = ? AND kind = "
                + "'REFUND_DUE'", toCancel));
        noDrift("two cancels");

        // A replay of a transition: same key, same body.
        String replayKey = key();
        String third = paidOrder(Map.of(raceV, 1));
        OrderDeskDtos.TransitionRequest cancel = OrderDeskDtos.TransitionRequest.builder().clientRequestId(replayKey)
                .fromStatus("CONFIRMED").toStatus("CANCELLED").build();
        desk.transition(admin, inst, third, cancel);
        int afterFirst = slots(raceV);
        StaffOrderDtos.StaffOrderDetail replay = desk.transition(admin, inst, third, cancel);
        assertEquals(Boolean.TRUE, replay.getReplayed());
        assertEquals(afterFirst, slots(raceV), "nothing new");
        assertEquals(1, count("SELECT count(*) FROM commerce_request WHERE institute_id = ? AND client_request_id = ?",
                inst, replayKey));
    }

    // ------------------------------------------------------------------ stock short

    @Test
    @Order(10)
    void aDamageThatEatsPromisedUnitsFlagsTheOrderAfterCommit() {
        String orderId = paidOrder(Map.of(shortV, 2));
        AdjustmentRequest damage = new AdjustmentRequest();
        damage.setLocationId(wh);
        damage.setPackageSessionId(shortV);
        damage.setKind("DAMAGE");
        damage.setQuantityDelta(3);
        damage.setReason("WATER");
        damage.setClientRequestId("damage-" + run);
        adjustmentService.adjust(inst, actor, true, damage);

        assertEquals(Boolean.TRUE, db.queryForObject("SELECT stock_short FROM commerce_order WHERE id = ?",
                Boolean.class, orderId));
        assertEquals(2, count("SELECT stock_short_qty FROM commerce_order_line WHERE id = ?", lineOf(orderId)));
        StaffOrderDtos.StaffOrderPage queue = queryService.staffList(inst, new CommerceOrderQueryService
                .StaffListFilter(null, null, null, null, "STOCK_SHORT", null, null, null), 0, 20);
        assertEquals(1, queue.getTotal());
        noDrift("damage");

        desk.clearStockShort(admin, inst, orderId, OrderDeskDtos.StockShortClearRequest.builder()
                .clientRequestId(key()).note("found in the back room").build());
        assertEquals(Boolean.FALSE, db.queryForObject("SELECT stock_short FROM commerce_order WHERE id = ?",
                Boolean.class, orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE reference_id = ? AND kind = "
                + "'STOCK_SHORT_CLEARED'", orderId));
    }
}
