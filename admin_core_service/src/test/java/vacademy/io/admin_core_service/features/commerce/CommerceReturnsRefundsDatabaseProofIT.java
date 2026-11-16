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
import vacademy.io.admin_core_service.features.commerce.document.job.CommerceInvoiceRetryJob;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionClient;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceCheckoutService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderPaymentService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderQueryService;
import vacademy.io.admin_core_service.features.commerce.order.cod.CommerceCodRemittanceService;
import vacademy.io.admin_core_service.features.commerce.order.cod.dto.CodRemittanceDtos;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStaffOrderService;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.StaffOrderRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.returns.dto.RefundDtos;
import vacademy.io.admin_core_service.features.commerce.returns.dto.ReturnDtos;
import vacademy.io.admin_core_service.features.commerce.returns.job.CommerceRefundPollJob;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundExecutor;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundService;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceReturnService;
import vacademy.io.admin_core_service.features.commerce.shipment.dto.ShipmentDtos;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
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
import java.math.RoundingMode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
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
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.when;

/**
 * Database-backed proof of returns, refunds, credit notes and exchanges (WP-32) on a local
 * Postgres with the real Flyway chain (V710, V711) and the real Spring context. Orders are made
 * through the built prepaid checkout and paid by a signed webhook posted to this application's own
 * port (or made by staff); the gateway's refund calls are stubbed on the spied Razorpay manager and
 * counted; refund events come back as signed webhooks over HTTP. The reconciliation finds no drift
 * after every stock step and the refund ledger invariants are checked after every money step.
 *
 * <p>Skipped unless {@code COMMERCE_IT_PG_URL} names a database on this machine; nothing leaves
 * the machine. Every tax rate is a TEST placeholder.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CommerceReturnsRefundsDatabaseProofIT {

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
        registry.add("commerce.refund-poll.cron", () -> "-");
        registry.add("commerce.cod-confirm-timeout.cron", () -> "-");
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
    @Autowired private CommerceOrderService orderService;
    @Autowired private CommerceCheckoutService checkoutService;
    @Autowired private CommerceOrderPaymentService paymentService;
    @Autowired private CommerceOrderQueryService queryService;
    @Autowired private CommerceOrderDeskService desk;
    @Autowired private CommerceShipmentService shipments;
    @Autowired private CommerceStaffOrderService staffOrders;
    @Autowired private CommerceCodRemittanceService remittances;
    @Autowired private CommerceReturnService returns;
    @Autowired private CommerceRefundService refunds;
    @Autowired private CommerceRefundExecutor executor;
    @Autowired private CommerceRefundPollJob pollJob;
    @Autowired private CommerceInvoiceRetryJob invoiceRetryJob;
    @Autowired private CommerceOrderRepository orderRepository;
    @Autowired private vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentExceptionRepository
            exceptionRepository;
    @Autowired private StockReconciliationJob reconciliationJob;
    @Autowired private PlatformTransactionManager transactionManager;
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
    private final AtomicInteger phones = new AtomicInteger(500);
    private final AtomicInteger gatewayOrders = new AtomicInteger();

    /** Every refund create the gateway was asked for: (payment, amount, receipt). */
    private final List<String> creates = java.util.Collections.synchronizedList(new ArrayList<>());
    private final AtomicInteger gatewayRefundIds = new AtomicInteger();
    /** How the stubbed gateway answers a refund create: pending, processed or throw. */
    private volatile String createMode = "pending";
    /** The buyer's network address of the next checkouts (each address has its own order limit). */
    private volatile String clientIp = "127.0.0.1";
    /** A slow gateway: each refund create takes this long. */
    private volatile long createDelayMillis = 0;
    /** The status a refund read answers, by gateway refund id (default pending). */
    private final Map<String, String> refundStatus = new ConcurrentHashMap<>();
    /** The refunds a payment lists, by payment id. */
    private final Map<String, List<Map<String, Object>>> listed = new ConcurrentHashMap<>();
    private final AtomicInteger remoteReads = new AtomicInteger();

    private String wh;
    private String store;
    private String taxClass;
    private String qtyA;     // 40 in stock, 1000.00: prepaid returns and refunds
    private String pieceM;   // 3 pieces, 700.00: a piece returned damaged at the store
    private String credit;   // 30 in stock, 500.00: staff orders, the COD return, exchanges
    private String scarce;   // 1 in stock, 300.00: the oversold order
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
            data.put("razorpayOrderId", "order_" + run + "r" + gatewayOrders.incrementAndGet());
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
        doAnswer(call -> {
            String paymentId = call.getArgument(0);
            Long amount = call.getArgument(1);
            String receipt = call.getArgument(2);
            creates.add(paymentId + "|" + amount + "|" + receipt);
            if (createDelayMillis > 0) {
                Thread.sleep(createDelayMillis);
            }
            if ("throw".equals(createMode)) {
                throw new vacademy.io.common.exceptions.VacademyException("read timed out");
            }
            Map<String, Object> answer = new HashMap<>();
            answer.put("id", "rfnd_" + run + gatewayRefundIds.incrementAndGet());
            answer.put("payment_id", paymentId);
            answer.put("amount", amount);
            answer.put("currency", "INR");
            answer.put("status", createMode);
            answer.put("receipt", receipt);
            return answer;
        }).when(razorpay).refundPayment(any(), any(), any(), any(), any());
        doAnswer(call -> {
            remoteReads.incrementAndGet();
            String paymentId = call.getArgument(0);
            Map<String, Object> payment = new HashMap<>();
            payment.put("id", paymentId);
            payment.put("status", "captured");
            payment.put("currency", "INR");
            payment.put("amount", capturedMinor(paymentId));
            payment.put("amount_refunded", 0);
            return payment;
        }).when(razorpay).fetchPayment(any(), any());
        doAnswer(call -> {
            remoteReads.incrementAndGet();
            String refundId = call.getArgument(1);
            Map<String, Object> refund = new HashMap<>();
            refund.put("id", refundId);
            refund.put("payment_id", call.getArgument(0));
            refund.put("status", refundStatus.getOrDefault(refundId, "pending"));
            refund.put("amount", db.queryForObject("SELECT (amount * 100)::bigint FROM commerce_refund WHERE "
                    + "gateway_refund_id = ?", Long.class, refundId));
            return refund;
        }).when(razorpay).fetchPaymentRefund(any(), any(), any());
        doAnswer(call -> {
            remoteReads.incrementAndGet();
            return listed.getOrDefault((String) call.getArgument(0), List.of());
        }).when(razorpay).fetchPaymentRefunds(any(), any());
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
        return "wp32-" + run + "-" + keys.incrementAndGet();
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

    private void noDrift(String step) {
        List<StockReconciliationJob.Drift> drift = reconciliationJob.findSellableDrift().stream()
                .filter(d -> inst.equals(d.instituteId())).toList();
        assertTrue(drift.isEmpty(), "drift after " + step + ": " + drift);
    }

    private String status(String orderId) {
        return text("SELECT status FROM commerce_order WHERE id = ?", orderId);
    }

    private long capturedMinor(String paymentId) {
        List<Long> rows = db.queryForList("SELECT amount_minor FROM commerce_gateway_order WHERE gateway_payment_id = ?",
                Long.class, paymentId);
        return rows.isEmpty() ? 100_000_000L : rows.get(0);
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

    private int post(Map<String, Object> root) {
        try {
            String payload = objectMapper.writeValueAsString(root);
            HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + WEBHOOK_PATH))
                    .header("Content-Type", "application/json")
                    .header("X-Razorpay-Signature", hmacHex(WEBHOOK_SECRET, payload))
                    .POST(HttpRequest.BodyPublishers.ofString(payload)).build();
            HttpResponse<String> response = HttpClient.newHttpClient().send(request,
                    HttpResponse.BodyHandlers.ofString());
            return response.statusCode();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private Map<String, Object> paymentEntity(String gatewayOrderId, String paymentId, long amount, String orderId) {
        Map<String, Object> notes = new LinkedHashMap<>();
        notes.put("orderId", orderId);
        notes.put("instituteId", inst);
        notes.put("payment_type", "INITIAL");
        Map<String, Object> entity = new LinkedHashMap<>();
        entity.put("id", paymentId);
        entity.put("entity", "payment");
        entity.put("order_id", gatewayOrderId);
        entity.put("amount", amount);
        entity.put("currency", "INR");
        entity.put("status", "captured");
        entity.put("notes", notes);
        return entity;
    }

    /** One real HTTP POST of a signed captured event for a gateway order of the order; returns the payment id. */
    private String payByWebhook(String orderId, String gatewayOrderId, long amount) {
        String paymentId = "pay_" + UUID.randomUUID().toString().substring(0, 14);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("entity", "event");
        root.put("event", "payment.captured");
        root.put("payload", Map.of("payment", Map.of("entity", paymentEntity(gatewayOrderId, paymentId, amount,
                orderId))));
        assertEquals(200, post(root));
        return paymentId;
    }

    private String payByWebhook(String orderId) {
        Map<String, Object> row = db.queryForMap("SELECT * FROM commerce_gateway_order WHERE commerce_order_id = ? "
                + "ORDER BY created_at DESC LIMIT 1", orderId);
        return payByWebhook(orderId, String.valueOf(row.get("gateway_order_id")),
                ((Number) row.get("amount_minor")).longValue());
    }

    /** A signed refund.processed or refund.failed event for one of our refunds, over HTTP. */
    private int refundEvent(String event, String refundId) {
        Map<String, Object> refund = db.queryForMap("SELECT r.*, g.gateway_order_id FROM commerce_refund r "
                + "JOIN commerce_gateway_order g ON g.gateway_payment_id = r.gateway_payment_id WHERE r.id = ?",
                refundId);
        long amount = new BigDecimal(String.valueOf(refund.get("amount"))).movePointRight(2).longValueExact();
        Map<String, Object> entity = new LinkedHashMap<>();
        entity.put("id", refund.get("gateway_refund_id"));
        entity.put("entity", "refund");
        entity.put("payment_id", refund.get("gateway_payment_id"));
        entity.put("amount", amount);
        entity.put("currency", "INR");
        entity.put("receipt", refundId);
        entity.put("status", event.endsWith("processed") ? "processed" : "failed");
        entity.put("acquirer_data", Map.of("arn", "ARN" + run));
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("entity", "event");
        root.put("event", event);
        root.put("payload", Map.of(
                "payment", Map.of("entity", paymentEntity(String.valueOf(refund.get("gateway_order_id")),
                        String.valueOf(refund.get("gateway_payment_id")), amount,
                        String.valueOf(refund.get("order_id")))),
                "refund", Map.of("entity", entity)));
        return post(root);
    }

    /** A prepaid order through the built checkout, paid by the webhook: CONFIRMED. */
    private String paidOrder(Map<String, Integer> quantities) {
        List<CartPriceRequest.Line> lines = new ArrayList<>();
        quantities.forEach((variantId, quantity) -> lines.add(CartPriceRequest.Line.builder().variantId(variantId)
                .quantity(quantity).build()));
        CheckoutDtos.Placed placed = place(lines);
        payByWebhook(placed.getOrderId());
        assertEquals("CONFIRMED", status(placed.getOrderId()));
        return placed.getOrderId();
    }

    private CheckoutDtos.Placed place(List<CartPriceRequest.Line> lines) {
        BigDecimal total = orderService.priceCart(inst, CartPriceRequest.builder().lines(lines).pincode("226001")
                .build()).snapshot().getTotal();
        String phone = "98765" + String.format("%05d", phones.incrementAndGet());
        return checkoutService.placeOrder(inst, CheckoutRequest.builder()
                .clientRequestId("order-" + run + "-" + keys.incrementAndGet())
                .lines(lines).expectedTotal(total)
                .customer(CheckoutRequest.Customer.builder().name("Proof Buyer").phone(phone)
                        .email("buyer-" + phone + "@example.invalid").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("1 Proof Road").city("Lucknow")
                        .pincode("226001").build())
                .build(), clientIp);
    }

    private List<Map<String, Object>> itemLines(String orderId) {
        return db.queryForList("SELECT id, package_session_id, quantity - qty_cancelled - qty_shipped AS open "
                + "FROM commerce_order_line WHERE order_id = ? AND line_type = 'ITEM' ORDER BY line_no", orderId);
    }

    private String lineOf(String orderId, String packageSessionId) {
        return text("SELECT id FROM commerce_order_line WHERE order_id = ? AND package_session_id = ?", orderId,
                packageSessionId);
    }

    /** Packs every open line (one-of-a-kind lines with their first free pieces), ships and delivers. */
    private void deliver(String orderId) {
        List<ShipmentDtos.PackLine> pack = new ArrayList<>();
        for (Map<String, Object> row : itemLines(orderId)) {
            int open = ((Number) row.get("open")).intValue();
            String ps = String.valueOf(row.get("package_session_id"));
            List<String> codes = ps.equals(pieceM) ? db.queryForList("SELECT code FROM commerce_piece WHERE "
                    + "package_session_id = ? AND status = 'IN_STOCK' AND location_id = ? ORDER BY code LIMIT ?",
                    String.class, ps, wh, open) : null;
            pack.add(ShipmentDtos.PackLine.builder().orderLineId(String.valueOf(row.get("id"))).quantity(open)
                    .pieceCodes(codes).build());
        }
        shipments.pack(admin, inst, ShipmentDtos.PackRequest.builder().clientRequestId(key()).orderId(orderId)
                .fromStatus("CONFIRMED").lines(pack).build());
        String shipment = text("SELECT id FROM commerce_shipment WHERE order_id = ? AND status <> 'CANCELLED'", orderId);
        shipments.ship(admin, inst, shipment, ShipmentDtos.ShipRequest.builder().clientRequestId(key())
                .carrierName("India Post").trackingNumber("EM" + keys.incrementAndGet() + "IN")
                .trackingUrl("https://www.indiapost.gov.in/track").build());
        shipments.status(admin, inst, shipment, ShipmentDtos.StatusRequest.builder().clientRequestId(key())
                .to("DELIVERED").build());
        assertEquals("DELIVERED", status(orderId));
    }

    private StaffOrderDtos.StaffOrderDetail move(String orderId, String from, String to) {
        return desk.transition(admin, inst, orderId, OrderDeskDtos.TransitionRequest.builder().clientRequestId(key())
                .fromStatus(from).toStatus(to).reason("proof").build());
    }

    /** A return asked, approved and received in one go; the lines as (order line, condition, quantity, pieces). */
    private ReturnDtos.ReturnView returnReceived(String orderId, String location, String reason,
                                                 List<ReturnDtos.ReceiveLine> named) {
        Map<String, Integer> units = new LinkedHashMap<>();
        named.forEach(n -> units.merge(n.getOrderLineId(), n.getQuantity(), Integer::sum));
        List<ReturnDtos.LineRequest> lines = new ArrayList<>();
        units.forEach((line, q) -> lines.add(ReturnDtos.LineRequest.builder().orderLineId(line).quantity(q).build()));
        ReturnDtos.ReturnView created = returns.create(admin, inst, ReturnDtos.CreateReturnRequest.builder()
                .clientRequestId(key()).orderId(orderId).locationId(location).reason(reason).lines(lines)
                .approveNow(true).build());
        assertEquals("APPROVED", created.getStatus());
        return returns.receive(admin, inst, created.getId(), ReturnDtos.ReceiveRequest.builder().clientRequestId(key())
                .fromStatus("APPROVED").lines(named).build());
    }

    private static ReturnDtos.ReceiveLine named(String line, String condition, int quantity, String... pieceIds) {
        return ReturnDtos.ReceiveLine.builder().orderLineId(line).condition(condition).quantity(quantity)
                .pieceIds(pieceIds.length == 0 ? null : List.of(pieceIds)).build();
    }

    private RefundDtos.RefundView refund(String orderId, String returnId, BigDecimal amount, String method,
                                         String reference, String clientKey) {
        return refunds.create(admin, inst, RefundDtos.CreateRefundRequest.builder().clientRequestId(clientKey)
                .orderId(orderId).returnId(returnId).amount(amount).method(method).reference(reference)
                .reason("proof refund").build());
    }

    private String refundStatus(String refundId) {
        return text("SELECT status FROM commerce_refund WHERE id = ?", refundId);
    }

    /** Invariants 1 to 3 and 9 of the contract for one order. */
    private void ledger(String orderId) {
        Map<String, Object> o = db.queryForMap("SELECT * FROM commerce_order WHERE id = ?", orderId);
        BigDecimal committed = (BigDecimal) o.get("refund_committed");
        BigDecimal refunded = (BigDecimal) o.get("amount_refunded");
        BigDecimal due = (BigDecimal) o.get("refund_due");
        BigDecimal paid = (BigDecimal) o.get("amount_paid");
        assertEquals(0, committed.compareTo(money("SELECT COALESCE(SUM(amount), 0) FROM commerce_refund WHERE "
                + "order_id = ? AND kind = 'ORDER' AND status <> 'FAILED'", orderId)), "committed = live ORDER refunds");
        assertEquals(0, refunded.compareTo(money("SELECT COALESCE(SUM(amount), 0) FROM commerce_refund WHERE "
                + "order_id = ? AND kind = 'ORDER' AND status = 'PROCESSED'", orderId)), "refunded = processed");
        assertTrue(refunded.signum() >= 0 && refunded.compareTo(committed) <= 0 && committed.compareTo(due) <= 0
                && due.compareTo(paid) <= 0, "0 <= refunded <= committed <= due <= paid: " + o);
        for (Map<String, Object> r : db.queryForList("SELECT * FROM commerce_return WHERE order_id = ?", orderId)) {
            BigDecimal live = money("SELECT COALESCE(SUM(amount), 0) FROM commerce_refund WHERE return_id = ? AND "
                    + "status <> 'FAILED'", r.get("id"));
            BigDecimal raised = (BigDecimal) r.get("due_raised");
            BigDecimal creditTotal = (BigDecimal) r.get("credit_total");
            assertTrue(live.compareTo(raised) <= 0 && raised.compareTo(creditTotal) <= 0, "per return: " + r);
            if (r.get("credit_note_id") != null) {
                assertEquals(0, creditTotal.compareTo(money("SELECT total FROM commerce_credit_note WHERE id = ?",
                        r.get("credit_note_id"))), "credit_total = its credit note");
            }
        }
    }

    private boolean inQueue(String queue, String orderId) {
        return queryService.staffList(inst, new CommerceOrderQueryService.StaffListFilter(null, null, null, null,
                queue, null, null, null), 0, 50).getOrders().stream().anyMatch(o -> o.getId().equals(orderId));
    }

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

    /** Backends of this database waiting on a lock (a row lock held elsewhere). */
    private long waitingOnLocks() {
        return count("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = "
                + "'Lock' AND pid <> pg_backend_pid()");
    }

    private void awaitWaiting(long expected) {
        long deadline = System.currentTimeMillis() + 30_000L;
        long waiting = waitingOnLocks();
        while (waiting < expected && System.currentTimeMillis() < deadline) {
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
            waiting = waitingOnLocks();
        }
        assertEquals(expected, waiting, "every request is blocked on the row held by the side connection");
    }

    /**
     * Holds {@code SELECT ... FOR UPDATE} on one row from a side connection, starts every task,
     * waits until all of them are blocked on that row, then lets go: the tasks meet at the lock
     * every time, not by chance.
     */
    private List<Object> behindRowLock(String table, String id, List<Callable<Object>> tasks) {
        ExecutorService pool = Executors.newFixedThreadPool(Math.max(4, tasks.size()));
        try (java.sql.Connection side = db.getDataSource().getConnection()) {
            side.setAutoCommit(false);
            try (java.sql.PreparedStatement lock = side.prepareStatement("SELECT id FROM " + table
                    + " WHERE id = ? FOR UPDATE")) {
                lock.setString(1, id);
                assertTrue(lock.executeQuery().next(), "the row exists");
            }
            List<Future<Object>> futures = new ArrayList<>();
            for (Callable<Object> task : tasks) {
                futures.add(pool.submit(() -> {
                    header();
                    try {
                        return task.call();
                    } catch (Exception e) {
                        return e;
                    } finally {
                        RequestContextHolder.resetRequestAttributes();
                    }
                }));
            }
            awaitWaiting(tasks.size());
            side.rollback();
            List<Object> results = new ArrayList<>();
            for (Future<Object> future : futures) {
                results.add(future.get(120, TimeUnit.SECONDS));
            }
            return results;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        } finally {
            pool.shutdownNow();
        }
    }

    /** A gateway refund written PENDING (as the request writes it, before its executor runs). */
    private String pendingGatewayRow(String orderId, BigDecimal amount) {
        String paymentId = text("SELECT gateway_payment_id FROM commerce_gateway_order WHERE commerce_order_id = ? AND "
                + "paying", orderId);
        String clientKey = "PROOF:" + key();
        return new TransactionTemplate(transactionManager).execute(tx -> refunds.insertInside(desk.lockOrder(inst,
                orderId), new CommerceRefundService.NewRefund(
                vacademy.io.admin_core_service.features.commerce.returns.enums.RefundKind.ORDER,
                vacademy.io.admin_core_service.features.commerce.returns.enums.RefundSource.STAFF,
                vacademy.io.admin_core_service.features.commerce.returns.enums.RefundMethod.GATEWAY,
                vacademy.io.admin_core_service.features.commerce.returns.enums.RefundStatus.PENDING, amount, null, null,
                paymentId, null, null, null, null, null, "proof refund", clientKey, actor)).getId());
    }

    /** What CommerceRefundService logs while {@code work} runs (the webhook thread included). */
    private List<String> refundServiceLog(Runnable work) {
        ch.qos.logback.classic.Logger logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(
                CommerceRefundService.class);
        ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender =
                new ch.qos.logback.core.read.ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            work.run();
        } finally {
            logger.detachAppender(appender);
        }
        synchronized (appender.list) {
            return appender.list.stream().map(ch.qos.logback.classic.spi.ILoggingEvent::getFormattedMessage).toList();
        }
    }

    private BigDecimal paid(String orderId) {
        return money("SELECT amount_paid FROM commerce_order WHERE id = ?", orderId);
    }

    // ------------------------------------------------------------------ seed

    @Test
    @Order(1)
    void seed_aShopWithStockTwoLocationsAndDocumentSeries() {
        assertEquals(1, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version = '710'"));
        assertEquals(1, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version = '711'"));
        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", inst,
                "Returns Proof " + run, "https://shop-" + run + ".example.com");
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)", inst);
        capabilityResolver.evict(inst);
        taxSettingService.update(inst, actor, TaxSettingDTO.builder().taxMode("REGULAR").sellerGstin(SELLER_GSTIN)
                .sellerLegalName("Proof Seller " + run).sellerAddress("1 Proof Road, Lucknow 226001")
                .roundTotalTo("RUPEE").build());
        taxClass = taxClassService.create(inst, actor, TaxClassDTO.builder().code("goods_test").name("goods TEST")
                .hsnCode("5208").unit("PCS")
                .rules(List.of(TaxRateRuleDTO.builder().minUnitPrice(new BigDecimal("0"))
                        .ratePercent(new BigDecimal("5")).effectiveFrom(LocalDate.of(2020, 4, 1)).build()))
                .build()).getId();
        seriesService.create(inst, actor, DocumentSeriesDTO.builder().documentType("TAX_INVOICE")
                .prefix("RK" + run.substring(0, 2)).build());
        seriesService.create(inst, actor, DocumentSeriesDTO.builder().documentType("CREDIT_NOTE")
                .prefix("RC" + run.substring(0, 2)).build());

        wh = locationService.create(inst, actor, true, location("WH", true, false)).getId();
        store = locationService.create(inst, actor, true, location("ST", false, true)).getId();

        qtyA = variant("qty-a", "QA", "1000.00", false);
        pieceM = variant("piece-m", "PM", "700.00", true);
        credit = variant("credit", "CR", "500.00", false);
        scarce = variant("scarce", "SC", "300.00", false);
        receive(qtyA, 40);
        receive(pieceM, 3);
        receive(credit, 30);
        receive(scarce, 1);
        db.update("INSERT INTO institute_payment_gateway_mapping (id, vendor, institute_id, payment_gateway_specific_data, "
                        + "status) VALUES (?, 'RAZORPAY', ?, ?, 'ACTIVE')", UUID.randomUUID().toString(), inst,
                "{\"apiKey\":\"" + KEY_ID + "\",\"apiSecret\":\"" + KEY_SECRET + "\",\"keySecret\":\"" + KEY_SECRET
                        + "\",\"webhookSecret\":\"" + WEBHOOK_SECRET + "\"}");
        snapshotLoader.evict(inst);
        assertEquals(40, slots(qtyA));
        noDrift("seed");
    }

    private LocationRequest location(String code, boolean sellsOnline, boolean isStore) {
        LocationRequest location = new LocationRequest();
        location.setCode(code + "-" + run);
        location.setName(code + " " + run);
        location.setAddressLine1("1 Proof Road");
        location.setCity("Lucknow");
        location.setPincode("226001");
        location.setStateCode("09");
        location.setGstin(SELLER_GSTIN);
        location.setIsStore(isStore);
        location.setIsWarehouse(!isStore);
        location.setIsPosEnabled(false);
        location.setSellsOnline(sellsOnline);
        return location;
    }

    // ------------------------------------------------------------------ 12. no-op

    @Test
    @Order(2)
    void noRefundRows_thePollMakesNoGatewayCallAndChangesNoRow() {
        long refundRows = count("SELECT count(*) FROM commerce_refund");
        String exceptionsBefore = text("SELECT COALESCE(string_agg(id || status || COALESCE(refund_id, ''), ',' "
                + "ORDER BY id), '') FROM commerce_payment_exception");
        int creates = this.creates.size();
        int reads = remoteReads.get();
        Map<String, Integer> counts = pollJob.runOnce(new Date());
        assertTrue(counts.isEmpty(), counts.toString());
        assertEquals(creates, this.creates.size());
        assertEquals(reads, remoteReads.get());
        assertEquals(refundRows, count("SELECT count(*) FROM commerce_refund"));
        assertEquals(exceptionsBefore, text("SELECT COALESCE(string_agg(id || status || COALESCE(refund_id, ''), ',' "
                + "ORDER BY id), '') FROM commerce_payment_exception"));
    }

    // ------------------------------------------------------------------ 1. gate 7

    @Test
    @Order(3)
    void gate7_returnReceivedCreditNoteGatewayRefundAndSignedRefundWebhook() {
        String orderId = paidOrder(Map.of(qtyA, 2));
        deliver(orderId);
        String line = lineOf(orderId, qtyA);
        int available = slots(qtyA);
        noDrift("delivered");

        ReturnDtos.ReturnView ret = returnReceived(orderId, null, "DEFECTIVE", List.of(named(line, "RESALEABLE", 1)));
        assertEquals("RECEIVED", ret.getStatus());
        String returnLine = text("SELECT id FROM commerce_return_line WHERE return_id = ?", ret.getId());
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE institute_id = ? AND type = 'RETURN' AND "
                + "idempotency_key = ? AND reference_type = 'RETURN_LINE' AND reference_id = ? AND quantity_delta = 1 "
                + "AND location_id = ?", inst, "RET:" + returnLine, returnLine, wh));
        assertEquals(available + 1, slots(qtyA), "back on sale at the online location");
        assertEquals(1, count("SELECT qty_returned FROM commerce_order_line WHERE id = ?", line));
        String note = text("SELECT id FROM commerce_credit_note WHERE return_id = ?", ret.getId());
        assertNotNull(note, "the credit note names the return");
        assertEquals(ret.getCreditNote().getId(), note);
        assertEquals(0, count("SELECT count(*) FROM commerce_credit_note_line WHERE credit_note_id = ? AND cost_total "
                + "IS NULL", note), "the credit lines carry the cost of the goods");
        BigDecimal creditTotal = money("SELECT total FROM commerce_credit_note WHERE id = ?", note);
        assertEquals(0, creditTotal.compareTo(money("SELECT refund_due FROM commerce_order WHERE id = ?", orderId)));
        assertEquals(0, creditTotal.compareTo(ret.getDueRaised()));
        assertEquals("DELIVERED", status(orderId), "a return never changes the order status");
        assertTrue(inQueue("REFUND_DUE", orderId));
        ledger(orderId);
        noDrift("return received");

        int before = creates.size();
        createMode = "pending";
        RefundDtos.RefundView refund = refund(orderId, ret.getId(), creditTotal, "GATEWAY", null, key());
        assertEquals("IN_PROGRESS", refund.getStatus(), "sent in the request thread; the gateway says pending");
        assertEquals(before + 1, creates.size());
        String paymentId = text("SELECT gateway_payment_id FROM commerce_gateway_order WHERE commerce_order_id = ? AND "
                + "paying", orderId);
        assertEquals(paymentId + "|" + creditTotal.movePointRight(2).longValueExact() + "|" + refund.getId(),
                creates.get(creates.size() - 1), "one create with the refund id as receipt");
        assertFalse(inQueue("REFUND_DUE", orderId), "committed: nothing open");
        ledger(orderId);

        assertEquals(200, refundEvent("refund.processed", refund.getId()));
        assertEquals("PROCESSED", refundStatus(refund.getId()));
        assertEquals(0, creditTotal.compareTo(money("SELECT amount_refunded FROM commerce_order WHERE id = ?", orderId)));
        assertEquals("CLOSED", text("SELECT status FROM commerce_return WHERE id = ?", ret.getId()));
        assertEquals("ARN" + run, text("SELECT reference FROM commerce_refund WHERE id = ?", refund.getId()));
        assertEquals("PAID", text("SELECT payment_status FROM commerce_order WHERE id = ?", orderId),
                "payment status keeps meaning collected");
        assertEquals("PART", queryService.staffDetail(inst, orderId, null, true, true).getRefundState());
        ledger(orderId);
    }

    // ------------------------------------------------------------------ 2. concurrent refunds

    @Test
    @Order(4)
    void twoConcurrentRefundsThatTogetherExceedThePaidAmount_oneIsRefused() {
        String orderId = paidOrder(Map.of(qtyA, 1));
        move(orderId, "CONFIRMED", "CANCELLED");
        BigDecimal p = paid(orderId);
        assertEquals(0, p.compareTo(money("SELECT refund_due FROM commerce_order WHERE id = ?", orderId)));
        BigDecimal part = p.multiply(new BigDecimal("0.6")).setScale(2, RoundingMode.DOWN);
        int createsBefore = creates.size();
        createMode = "pending";
        // Both requests are blocked on the order row (held from a side connection) before either goes on.
        List<Object> results = behindRowLock("commerce_order", orderId, List.of(
                () -> refund(orderId, null, part, "GATEWAY", null, key()),
                () -> refund(orderId, null, part, "BANK_TRANSFER", null, key())));
        assertEquals(1, results.stream().filter(r -> r instanceof RefundDtos.RefundView).count(), results.toString());
        Object refused = results.stream().filter(r -> !(r instanceof RefundDtos.RefundView)).findFirst().orElseThrow();
        assertTrue(refused instanceof ConflictException
                && ((ConflictException) refused).getMessage().startsWith("REFUND_ABOVE_DUE"), String.valueOf(refused));
        assertEquals(0, part.compareTo(money("SELECT refund_committed FROM commerce_order WHERE id = ?", orderId)));
        RefundDtos.RefundView winner = (RefundDtos.RefundView) results.stream()
                .filter(r -> r instanceof RefundDtos.RefundView).findFirst().orElseThrow();
        assertEquals("GATEWAY".equals(winner.getMethod()) ? createsBefore + 1 : createsBefore, creates.size(),
                "only the refund that was made reached the gateway; the refused one made no call");
        assertEquals(1, count("SELECT count(*) FROM commerce_refund WHERE order_id = ?", orderId),
                "the refused request wrote no row");
        ledger(orderId);

        String many = paidOrder(Map.of(qtyA, 1));
        move(many, "CONFIRMED", "CANCELLED");
        BigDecimal q = paid(many).multiply(new BigDecimal("0.3")).setScale(2, RoundingMode.DOWN);
        List<Callable<Object>> eight = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            eight.add(() -> refund(many, null, q, "BANK_TRANSFER", null, key()));
        }
        List<Object> outcomes = behindRowLock("commerce_order", many, eight);
        long made = outcomes.stream().filter(r -> r instanceof RefundDtos.RefundView).count();
        assertEquals(3, made, outcomes.toString());
        assertTrue(outcomes.stream().filter(r -> !(r instanceof RefundDtos.RefundView)).allMatch(r ->
                r instanceof ConflictException && ((ConflictException) r).getMessage().startsWith("REFUND_ABOVE_DUE")));
        BigDecimal committed = money("SELECT refund_committed FROM commerce_order WHERE id = ?", many);
        assertEquals(0, q.multiply(BigDecimal.valueOf(3)).compareTo(committed));
        assertTrue(committed.compareTo(paid(many)) <= 0);
        ledger(many);
    }

    // ------------------------------------------------------------------ 3. a replayed request pays once

    @Test
    @Order(5)
    void aRefundRequestReplayedWithTheSameKeyPaysOnce() {
        String orderId = paidOrder(Map.of(qtyA, 1));
        move(orderId, "CONFIRMED", "CANCELLED");
        BigDecimal amount = paid(orderId);
        String same = key();
        int before = creates.size();
        createMode = "pending";
        List<Object> twins = atOnce(List.of(() -> refund(orderId, null, amount, "GATEWAY", null, same),
                () -> refund(orderId, null, amount, "GATEWAY", null, same)));
        RefundDtos.RefundView third = refund(orderId, null, amount, "GATEWAY", null, same);
        List<RefundDtos.RefundView> answers = new ArrayList<>();
        for (Object r : twins) {
            assertTrue(r instanceof RefundDtos.RefundView, String.valueOf(r));
            answers.add((RefundDtos.RefundView) r);
        }
        answers.add(third);
        assertEquals(1, count("SELECT count(*) FROM commerce_refund WHERE order_id = ?", orderId), "one refund row");
        assertTrue(answers.stream().allMatch(a -> a.getId().equals(third.getId())), "the same id in every answer");
        assertEquals(2, answers.stream().filter(a -> Boolean.TRUE.equals(a.getReplayed())).count());
        assertEquals(before + 1, creates.size(), "one gateway create");

        // The executor on a row already sent: nothing; then the poll: still one create.
        assertEquals(CommerceRefundExecutor.Result.NOT_CLAIMED, executor.execute(third.getId()));
        pollJob.runOnce(new Date(System.currentTimeMillis() + 3 * 60_000L));
        assertEquals(before + 1, creates.size());
        assertEquals("IN_PROGRESS", refundStatus(third.getId()));

        // The processed event delivered twice raises the refunded amount once.
        assertEquals(200, refundEvent("refund.processed", third.getId()));
        assertEquals(200, refundEvent("refund.processed", third.getId()));
        assertEquals(0, amount.compareTo(money("SELECT amount_refunded FROM commerce_order WHERE id = ?", orderId)));
        assertEquals("FULL", queryService.staffDetail(inst, orderId, null, true, true).getRefundState());
        ledger(orderId);

        // The claim race on a fresh PENDING row: four executors blocked on the row, a slow
        // gateway; exactly one claims it and exactly one create is sent.
        String raced = paidOrder(Map.of(qtyA, 1));
        move(raced, "CONFIRMED", "CANCELLED");
        String pending = pendingGatewayRow(raced, paid(raced));
        assertEquals("PENDING", refundStatus(pending));
        int sent = creates.size();
        createDelayMillis = 1500;
        List<Object> claims;
        try {
            List<Callable<Object>> four = new ArrayList<>();
            for (int i = 0; i < 4; i++) {
                four.add(() -> executor.execute(pending));
            }
            claims = behindRowLock("commerce_refund", pending, four);
        } finally {
            createDelayMillis = 0;
        }
        assertEquals(3, claims.stream().filter(r -> r == CommerceRefundExecutor.Result.NOT_CLAIMED).count(),
                claims.toString());
        assertEquals(1, claims.stream().filter(r -> r == CommerceRefundExecutor.Result.PENDING_AT_GATEWAY).count(),
                claims.toString());
        assertEquals(sent + 1, creates.size(), "one create for the row");
        assertTrue(creates.get(creates.size() - 1).endsWith("|" + pending));
        assertEquals("IN_PROGRESS", refundStatus(pending));
        assertNotNull(text("SELECT gateway_refund_id FROM commerce_refund WHERE id = ?", pending));
        assertEquals(200, refundEvent("refund.processed", pending));
        assertEquals("PROCESSED", refundStatus(pending));
        ledger(raced);
    }

    // ------------------------------------------------------------------ 4. failed, then paid another way

    @Test
    @Order(6)
    void aFailedGatewayRefundOpensTheDueAgainAndABankTransferPaysIt() {
        String orderId = paidOrder(Map.of(qtyA, 1));
        move(orderId, "CONFIRMED", "CANCELLED");
        BigDecimal amount = paid(orderId);
        createMode = "pending";
        RefundDtos.RefundView gateway = refund(orderId, null, amount, "GATEWAY", null, key());
        assertEquals("IN_PROGRESS", gateway.getStatus());
        assertFalse(inQueue("REFUND_DUE", orderId));
        assertEquals(200, refundEvent("refund.failed", gateway.getId()));
        assertEquals("FAILED", refundStatus(gateway.getId()));
        assertEquals("GATEWAY_FAILED", text("SELECT failure_code FROM commerce_refund WHERE id = ?", gateway.getId()));
        assertEquals(0, BigDecimal.ZERO.compareTo(money("SELECT refund_committed FROM commerce_order WHERE id = ?",
                orderId)));
        assertTrue(inQueue("REFUND_DUE", orderId), "the due is open again");
        // A late processed event for the failed refund changes nothing, and is an alert (the buyer was paid).
        List<String> logged = refundServiceLog(() -> assertEquals(200, refundEvent("refund.processed",
                gateway.getId())));
        assertEquals("FAILED", refundStatus(gateway.getId()));
        assertTrue(logged.stream().anyMatch(line -> line.startsWith("COMMERCE_ALERT refund_outcome_conflict")
                && line.contains("refund=" + gateway.getId()) && line.contains("ours=FAILED")
                && line.contains("gateway=processed")), logged.toString());
        ledger(orderId);

        RefundDtos.RefundView bank = refund(orderId, null, amount, "BANK_TRANSFER", "UTR" + run, key());
        assertEquals("PROCESSED", bank.getStatus());
        assertEquals(0, amount.compareTo(money("SELECT amount_refunded FROM commerce_order WHERE id = ?", orderId)));
        assertFalse(inQueue("REFUND_DUE", orderId));
        ledger(orderId);
    }

    // ------------------------------------------------------------------ 5. lost create answer

    @Test
    @Order(7)
    void aLostCreateAnswerIsFoundByItsReceiptAndARefundNeverCreatedFailsAfterFifteenMinutes() {
        String orderId = paidOrder(Map.of(qtyA, 1));
        move(orderId, "CONFIRMED", "CANCELLED");
        BigDecimal amount = paid(orderId);
        createMode = "throw";
        RefundDtos.RefundView lost = refund(orderId, null, amount, "GATEWAY", null, key());
        assertEquals("IN_PROGRESS", lost.getStatus());
        assertNotNull(text("SELECT last_error FROM commerce_refund WHERE id = ?", lost.getId()));
        String paymentId = text("SELECT gateway_payment_id FROM commerce_refund WHERE id = ?", lost.getId());
        Map<String, Object> found = new HashMap<>();
        found.put("id", "rfnd_" + run + "lost");
        found.put("payment_id", paymentId);
        found.put("amount", amount.movePointRight(2).longValueExact());
        found.put("status", "processed");
        found.put("receipt", lost.getId());
        listed.put(paymentId, List.of(found));
        int before = creates.size();
        pollJob.runOnce(new Date(System.currentTimeMillis() + 3 * 60_000L));
        assertEquals("PROCESSED", refundStatus(lost.getId()));
        assertEquals("rfnd_" + run + "lost", text("SELECT gateway_refund_id FROM commerce_refund WHERE id = ?",
                lost.getId()));
        assertEquals(before, creates.size(), "the create is never sent again");
        ledger(orderId);

        String second = paidOrder(Map.of(qtyA, 1));
        move(second, "CONFIRMED", "CANCELLED");
        RefundDtos.RefundView never = refund(second, null, paid(second), "GATEWAY", null, key());
        assertEquals("IN_PROGRESS", never.getStatus());
        Date claimed = db.queryForObject("SELECT claimed_at FROM commerce_refund WHERE id = ?", Date.class,
                never.getId());
        pollJob.runOnce(new Date(claimed.getTime() + 14 * 60_000L));
        assertEquals("IN_PROGRESS", refundStatus(never.getId()), "not before 15 minutes");
        pollJob.runOnce(new Date(claimed.getTime() + 15 * 60_000L + 1000));
        assertEquals("FAILED", refundStatus(never.getId()));
        assertEquals("GATEWAY_NOT_CREATED", text("SELECT failure_code FROM commerce_refund WHERE id = ?",
                never.getId()));
        createMode = "pending";
        ledger(second);
    }

    // ------------------------------------------------------------------ 6. mixed receive

    @Test
    @Order(8)
    void mixedReceive_quantityPartDamagedOnlineAndAPieceDamagedAtTheStore() {
        String orderId = paidOrder(Map.of(qtyA, 2, pieceM, 1));
        deliver(orderId);
        String qtyLine = lineOf(orderId, qtyA);
        String pieceLine = lineOf(orderId, pieceM);
        String piece = text("SELECT id FROM commerce_piece WHERE order_line_id = ?", pieceLine);
        assertEquals("SOLD", text("SELECT status FROM commerce_piece WHERE id = ?", piece));
        int qtyAvailable = slots(qtyA);
        int pieceAvailable = slots(pieceM);

        ReturnDtos.ReturnView a = returnReceived(orderId, null, "DEFECTIVE", List.of(named(qtyLine, "RESALEABLE", 1),
                named(qtyLine, "DAMAGED", 1)));
        String la = text("SELECT id FROM commerce_return_line WHERE return_id = ?", a.getId());
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE idempotency_key = ? AND type = 'RETURN' AND "
                + "quantity_delta = 2", "RET:" + la));
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE idempotency_key = ? AND type = 'DAMAGE' AND "
                + "quantity_delta = -1 AND reason = 'RETURN_DAMAGED'", "RET_DMG:" + la));
        assertEquals(qtyAvailable + 1, slots(qtyA), "only the resaleable unit is on sale again");
        noDrift("quantity line back");

        ReturnDtos.ReturnView b = returnReceived(orderId, store, "DAMAGED_IN_TRANSIT", List.of(named(pieceLine,
                "DAMAGED", 1, piece)));
        String lb = text("SELECT id FROM commerce_return_line WHERE return_id = ?", b.getId());
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE idempotency_key = ? AND type = 'RETURN' AND "
                + "location_id = ? AND piece_id = ?", "RET:" + lb + ":" + piece, store, piece));
        assertEquals(1, count("SELECT count(*) FROM stock_movement WHERE idempotency_key = ? AND type = 'DAMAGE' AND "
                + "reason = 'RETURN_DAMAGED'", "RET_DMG:" + lb + ":" + piece));
        assertEquals("WRITTEN_OFF", text("SELECT status FROM commerce_piece WHERE id = ?", piece));
        assertEquals(pieceAvailable, slots(pieceM), "a piece back at a shop that does not sell online is not on sale");
        assertEquals("FULL", queryService.staffDetail(inst, orderId, null, true, true).getReturnState(),
                "every shipped unit came back");
        noDrift("piece back damaged at the store");
        ledger(orderId);
    }

    // ------------------------------------------------------------------ 7. COD return before remittance

    @Test
    @Order(9)
    void aCodReturnBeforeRemittanceIsDueOnlyOnceTheCourierPays() {
        String orderId = staffOrders.create(admin, inst, staffOrder(credit, 2).restOnCredit(true).build())
                .detail().getOrder().getId();
        // A cash-on-delivery order (placement with OTP is proved by the COD proof): the same rows a COD checkout writes.
        db.update("UPDATE commerce_order SET payment_method = 'COD', cod_amount = total WHERE id = ?", orderId);
        db.update("UPDATE commerce_order_tender SET mode = 'COD' WHERE order_id = ? AND status = 'PENDING'", orderId);
        deliver(orderId);
        int before = creates.size();
        ReturnDtos.ReturnView ret = returnReceived(orderId, null, "WRONG_ITEM", List.of(named(lineOf(orderId, credit),
                "RESALEABLE", 1)));
        assertEquals("RECEIVED", ret.getStatus());
        assertEquals(0, BigDecimal.ZERO.compareTo(ret.getDueRaised()));
        assertEquals(0, BigDecimal.ZERO.compareTo(money("SELECT refund_due FROM commerce_order WHERE id = ?", orderId)));
        assertTrue(ret.getCreditTotal().signum() > 0);

        BigDecimal cod = money("SELECT cod_amount FROM commerce_order WHERE id = ?", orderId);
        remittances.record(admin, inst, CodRemittanceDtos.RemittanceRequest.builder().clientRequestId(key())
                .reference("STMT-" + run).courierName("Courier").receivedOn(LocalDate.now(java.time.ZoneId.of(
                        "Asia/Kolkata"))).grossAmount(cod).deductions(BigDecimal.ZERO).netAmount(cod)
                .orderIds(List.of(orderId)).build());
        assertEquals("PAID", text("SELECT payment_status FROM commerce_order WHERE id = ?", orderId));
        assertEquals(0, ret.getCreditTotal().compareTo(money("SELECT due_raised FROM commerce_return WHERE id = ?",
                ret.getId())), "raised at the remittance");
        assertEquals(0, ret.getCreditTotal().compareTo(money("SELECT refund_due FROM commerce_order WHERE id = ?",
                orderId)));
        ledger(orderId);

        RefundDtos.RefundView upi = refund(orderId, ret.getId(), ret.getCreditTotal(), "UPI", "UPI-" + run, key());
        assertEquals("PROCESSED", upi.getStatus());
        assertEquals("CLOSED", text("SELECT status FROM commerce_return WHERE id = ?", ret.getId()));
        assertEquals(before, creates.size(), "no gateway call");
        ledger(orderId);
    }

    private StaffOrderRequest.StaffOrderRequestBuilder staffOrder(String variantId, int quantity) {
        String phone = "98765" + String.format("%05d", phones.incrementAndGet());
        return StaffOrderRequest.builder().clientRequestId(key())
                .customer(StaffOrderRequest.Customer.builder().phone(phone).name("Phone Buyer").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("2 Proof Lane").city("Lucknow")
                        .pincode("226001").build())
                .lines(List.of(StaffOrderRequest.Line.builder().variantId(variantId).quantity(quantity).build()));
    }

    // ------------------------------------------------------------------ 8. exchange

    private void exchangeInvariant(String oldOrder, String newOrder) {
        assertEquals(0, money("SELECT COALESCE(SUM(amount), 0) FROM commerce_refund WHERE applied_order_id = ? AND "
                + "method = 'EXCHANGE_CREDIT' AND status = 'PROCESSED'", newOrder).compareTo(money("SELECT "
                + "COALESCE(SUM(amount), 0) FROM commerce_order_tender WHERE order_id = ? AND mode = 'CREDIT_NOTE' AND "
                + "status = 'RECEIVED'", newOrder)), "EXCHANGE_CREDIT = the CREDIT_NOTE tender");
        for (String o : List.of(oldOrder, newOrder)) {
            assertEquals(0, paid(o).compareTo(money("SELECT COALESCE(SUM(amount), 0) FROM commerce_order_tender WHERE "
                    + "order_id = ? AND status = 'RECEIVED'", o)), "received tenders = amount paid");
        }
        assertEquals(oldOrder, text("SELECT exchange_of_order_id FROM commerce_order WHERE id = ?", newOrder));
    }

    @Test
    @Order(10)
    void exchange_creditAboveTheNewOrderWithCashRestAndBelowItWithTheRestOnCredit() {
        String oldOrder = paidOrder(Map.of(qtyA, 1));
        deliver(oldOrder);
        ReturnDtos.ReturnView ret = returnReceived(oldOrder, null, "DEFECTIVE", List.of(named(lineOf(oldOrder, qtyA),
                "RESALEABLE", 1)));
        BigDecimal c = ret.getCreditTotal();
        StaffOrderDtos.StaffOrderDetail made = staffOrders.create(admin, inst, staffOrder(credit, 1).chargeShipping(false)
                .exchange(StaffOrderRequest.Exchange.builder().returnId(ret.getId()).remainderRefund(
                        StaffOrderRequest.RemainderRefund.builder().method("CASH").build()).build()).build()).detail();
        String newOrder = made.getOrder().getId();
        BigDecimal t = money("SELECT total FROM commerce_order WHERE id = ?", newOrder);
        assertTrue(c.compareTo(t) > 0, c + " > " + t);
        assertEquals("PAID", text("SELECT payment_status FROM commerce_order WHERE id = ?", newOrder));
        assertEquals(0, t.compareTo(money("SELECT amount FROM commerce_order_tender WHERE order_id = ? AND mode = "
                + "'CREDIT_NOTE'", newOrder)));
        assertEquals(2, count("SELECT count(*) FROM commerce_refund WHERE order_id = ? AND status = 'PROCESSED'",
                oldOrder));
        assertEquals(0, c.subtract(t).compareTo(money("SELECT amount FROM commerce_refund WHERE order_id = ? AND "
                + "method = 'CASH'", oldOrder)));
        assertEquals("CLOSED", text("SELECT status FROM commerce_return WHERE id = ?", ret.getId()));
        exchangeInvariant(oldOrder, newOrder);
        ledger(oldOrder);
        noDrift("exchange with cash back");
        // One live exchange per return.
        assertThrows(ConflictException.class, () -> staffOrders.create(admin, inst, staffOrder(credit, 1)
                .chargeShipping(false).exchange(StaffOrderRequest.Exchange.builder().returnId(ret.getId()).build())
                .build()));

        String second = paidOrder(Map.of(qtyA, 1));
        deliver(second);
        ReturnDtos.ReturnView ret2 = returnReceived(second, null, "DEFECTIVE", List.of(named(lineOf(second, qtyA),
                "RESALEABLE", 1)));
        String bigger = staffOrders.create(admin, inst, staffOrder(credit, 3).chargeShipping(false).restOnCredit(true)
                .exchange(StaffOrderRequest.Exchange.builder().returnId(ret2.getId()).build()).build())
                .detail().getOrder().getId();
        BigDecimal t2 = money("SELECT total FROM commerce_order WHERE id = ?", bigger);
        assertTrue(ret2.getCreditTotal().compareTo(t2) < 0);
        assertEquals("PARTIALLY_PAID", text("SELECT payment_status FROM commerce_order WHERE id = ?", bigger));
        assertEquals(0, t2.subtract(ret2.getCreditTotal()).compareTo(money("SELECT amount FROM commerce_order_tender "
                + "WHERE order_id = ? AND mode = 'CREDIT' AND status = 'PENDING'", bigger)), "the rest on credit");
        assertEquals("CLOSED", text("SELECT status FROM commerce_return WHERE id = ?", ret2.getId()));
        exchangeInvariant(second, bigger);
        ledger(second);
        noDrift("exchange with the rest on credit");
    }

    // ------------------------------------------------------------------ 9. oversold and duplicate

    @Test
    @Order(11)
    void anOversoldPaidOrderAndADuplicatePaymentAreRefundedByThePoll() {
        CheckoutDtos.Placed late = place(List.of(CartPriceRequest.Line.builder().variantId(scarce).quantity(1).build()));
        assertTrue(paymentService.onHoldExpired(late.getOrderId()));
        snapshotLoader.evict(inst);
        String winner = paidOrder(Map.of(scarce, 1));
        assertEquals("CONFIRMED", status(winner));
        String latePayment = payByWebhook(late.getOrderId());
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE id = ? AND cancel_reason = 'OVERSOLD_PAID'",
                late.getOrderId()));
        assertEquals(0, paid(late.getOrderId()).compareTo(money("SELECT refund_due FROM commerce_order WHERE id = ?",
                late.getOrderId())), "all it paid is due back");
        // Made by the webhook request itself (the paying payment is read as a value, not from the
        // request's stale copy of the gateway row): no wait for the poll.
        assertEquals(1, count("SELECT count(*) FROM commerce_refund WHERE order_id = ?", late.getOrderId()),
                "the refund row exists right after the webhook");
        Map<String, Object> auto = db.queryForMap("SELECT * FROM commerce_refund WHERE order_id = ?", late.getOrderId());
        assertEquals("AUTO:OVERSOLD:" + late.getOrderId(), auto.get("idempotency_key"));
        assertEquals("PENDING", auto.get("status"));
        assertEquals(latePayment, auto.get("gateway_payment_id"));
        assertEquals(auto.get("id"), text("SELECT refund_id FROM commerce_payment_exception WHERE commerce_order_id = ? "
                + "AND kind = 'OVERSOLD_PAID'", late.getOrderId()));
        int before = creates.size();
        createMode = "processed";
        pollJob.runOnce(new Date(System.currentTimeMillis() + 4 * 60_000L));
        assertEquals(before + 1, creates.size());
        assertEquals("PROCESSED", refundStatus(String.valueOf(auto.get("id"))));
        assertEquals("RESOLVED", text("SELECT status FROM commerce_payment_exception WHERE commerce_order_id = ? AND "
                + "kind = 'OVERSOLD_PAID'", late.getOrderId()));
        assertEquals(0, paid(late.getOrderId()).compareTo(money("SELECT amount_refunded FROM commerce_order WHERE "
                + "id = ?", late.getOrderId())));
        ledger(late.getOrderId());

        // A second captured payment of a paid order.
        CheckoutDtos.Placed placed = place(List.of(CartPriceRequest.Line.builder().variantId(credit).quantity(1).build()));
        Map<String, Object> first = db.queryForMap("SELECT * FROM commerce_gateway_order WHERE commerce_order_id = ?",
                placed.getOrderId());
        long amount = ((Number) first.get("amount_minor")).longValue();
        String secondGatewayOrder = "order_" + run + "dup";
        db.update("INSERT INTO commerce_gateway_order (id, institute_id, commerce_order_id, vendor, gateway_order_id, "
                + "key_id, amount_minor, currency, receipt, status, status_at) VALUES (?, ?, ?, 'RAZORPAY', ?, ?, ?, "
                + "'INR', ?, 'CREATED', now())", UUID.randomUUID().toString(), inst, placed.getOrderId(),
                secondGatewayOrder, KEY_ID, amount, placed.getOrderId());
        payByWebhook(placed.getOrderId(), String.valueOf(first.get("gateway_order_id")), amount);
        String secondPayment = payByWebhook(placed.getOrderId(), secondGatewayOrder, amount);
        Map<String, Object> extra = db.queryForMap("SELECT * FROM commerce_refund WHERE order_id = ?",
                placed.getOrderId());
        assertEquals("EXTRA_PAYMENT", extra.get("kind"));
        assertEquals(secondPayment, extra.get("gateway_payment_id"));
        assertEquals(0, BigDecimal.valueOf(amount, 2).compareTo((BigDecimal) extra.get("amount")));
        pollJob.runOnce(new Date(System.currentTimeMillis() + 60_000L));
        assertEquals("PROCESSED", refundStatus(String.valueOf(extra.get("id"))));
        assertEquals("RESOLVED", text("SELECT status FROM commerce_payment_exception WHERE commerce_order_id = ? AND "
                + "kind = 'DUPLICATE_PAYMENT'", placed.getOrderId()));
        Map<String, Object> o = db.queryForMap("SELECT * FROM commerce_order WHERE id = ?", placed.getOrderId());
        assertEquals(0, BigDecimal.ZERO.compareTo((BigDecimal) o.get("refund_due")), "order money untouched");
        assertEquals(0, BigDecimal.ZERO.compareTo((BigDecimal) o.get("refund_committed")));
        assertEquals(0, BigDecimal.ZERO.compareTo((BigDecimal) o.get("amount_refunded")));
        createMode = "pending";
    }

    // ------------------------------------------------------------------ 10. policy

    @Test
    @Order(12)
    void policyWarningRefusesWithNothingWrittenAndAnOverrideIsAudited() {
        String orderId = paidOrder(Map.of(qtyA, 1));
        deliver(orderId);
        String line = lineOf(orderId, qtyA);
        long returnsBefore = count("SELECT count(*) FROM commerce_return WHERE institute_id = ?", inst);
        ConflictException warned = assertThrows(ConflictException.class, () -> returns.create(admin, inst,
                ReturnDtos.CreateReturnRequest.builder().clientRequestId(key()).orderId(orderId).reason("CHANGED_MIND")
                        .lines(List.of(ReturnDtos.LineRequest.builder().orderLineId(line).quantity(1).build())).build()));
        assertTrue(warned.getMessage().startsWith("RETURN_POLICY_WARNING"), warned.getMessage());
        assertEquals(returnsBefore, count("SELECT count(*) FROM commerce_return WHERE institute_id = ?", inst));
        ReturnDtos.ReturnView overridden = returns.create(admin, inst, ReturnDtos.CreateReturnRequest.builder()
                .clientRequestId(key()).orderId(orderId).reason("CHANGED_MIND").overrideReason("Manager agreed")
                .lines(List.of(ReturnDtos.LineRequest.builder().orderLineId(line).quantity(1).build())).build());
        assertEquals("REQUESTED", overridden.getStatus());
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE reference_id = ? AND kind = "
                + "'RETURN_POLICY_OVERRIDE'", overridden.getId()));
        returns.approve(admin, inst, overridden.getId(), ReturnDtos.ApproveRequest.builder().clientRequestId(key())
                .fromStatus("REQUESTED").build());
        returns.receive(admin, inst, overridden.getId(), ReturnDtos.ReceiveRequest.builder().clientRequestId(key())
                .fromStatus("APPROVED").lines(List.of(named(line, "RESALEABLE", 1))).build());
        ConflictException undo = assertThrows(ConflictException.class, () -> move(orderId, "DELIVERED", "SHIPPED"));
        assertTrue(undo.getMessage().startsWith("HAS_RETURNS"), undo.getMessage());
        noDrift("policy");
    }

    // ------------------------------------------------------------------ 11. follow-ups

    @Test
    @Order(13)
    void followUps_invoiceIndexBacklogLookbackAndBackoff() {
        // (a) The index exists, is valid, and the planner takes it among many legacy invoices.
        assertEquals(Boolean.TRUE, db.queryForObject("SELECT indisvalid FROM pg_index WHERE indexrelid = "
                + "'idx_invoice_commerce_order'::regclass", Boolean.class));
        String template = text("SELECT id FROM invoice WHERE institute_id = ? AND commerce_order_id IS NOT NULL LIMIT 1",
                inst);
        db.update("INSERT INTO invoice SELECT (jsonb_populate_record(i, jsonb_build_object('id', gen_random_uuid()::text, "
                + "'invoice_number', 'LEGACY-" + run + "-' || g, 'commerce_order_id', NULL))).* "
                + "FROM invoice i, generate_series(1, 5000) g WHERE i.id = ?", template);
        db.execute("ANALYZE invoice");
        String plan = String.join("\n", db.queryForList("EXPLAIN SELECT COUNT(*) FROM invoice i WHERE "
                + "i.commerce_order_id = 'no-such-order' AND i.cancelled_at IS NULL", String.class));
        assertTrue(plan.contains("idx_invoice_commerce_order"), plan);

        // (b) A CONFIRMED order of a shop invoicing at confirmation is served whatever its age; a SHIPPED one
        // older than the lookback is not read.
        db.update("UPDATE commerce_tax_setting SET invoice_at = 'CONFIRMED' WHERE institute_id = ?", inst);
        try {
            String confirmed = paidOrder(Map.of(credit, 1));
            assertEquals(0, count("SELECT count(*) FROM invoice WHERE commerce_order_id = ?", confirmed),
                    "confirming issues no invoice by itself");
            db.update("UPDATE commerce_order SET updated_at = now() - interval '9 days' WHERE id = ?", confirmed);
            String shipped = paidOrder(Map.of(credit, 1));
            String shipment = shippedWithoutInvoice(shipped);
            db.update("UPDATE commerce_order SET updated_at = now() - interval '9 days' WHERE id = ?", shipped);

            // (c) 60 orders that failed before and always fail, older than the healthy one.
            Map<String, Object> o = db.queryForMap("SELECT * FROM commerce_order WHERE id = ?", confirmed);
            db.update("INSERT INTO commerce_order SELECT (jsonb_populate_record(o, jsonb_build_object("
                    + "'id', gen_random_uuid()::text, 'order_number', 'FAIL-" + run + "-' || g, "
                    + "'payment_group_id', gen_random_uuid()::text, 'client_request_id', NULL, "
                    + "'price_snapshot_json', '{}'::jsonb, 'sweep_failures', 1, 'gateway_order_id', NULL, "
                    + "'updated_at', (now() - interval '20 days')::text))).* "
                    + "FROM commerce_order o, generate_series(1, 60) g WHERE o.id = ?", confirmed);
            assertEquals(60, count("SELECT count(*) FROM commerce_order WHERE institute_id = ? AND order_number LIKE "
                    + "'FAIL-%'", inst));
            List<String> listed = new TransactionTemplate(transactionManager).execute(tx -> orderRepository
                    .findOrderIdsMissingInvoice(new Date(System.currentTimeMillis() - 600_000L),
                            new Date(System.currentTimeMillis() - 7L * 24 * 3600 * 1000), new Date(), 50));
            assertTrue(listed.contains(confirmed), "the 9-day-old CONFIRMED order is listed");
            assertFalse(listed.contains(shipped), "a SHIPPED order older than the lookback is not");
            assertEquals(confirmed, listed.get(0), "the order that never failed comes first");

            invoiceRetryJob.runOnce();
            assertEquals(1, count("SELECT count(*) FROM invoice WHERE commerce_order_id = ? AND cancelled_at IS NULL",
                    confirmed), "the healthy order got its invoice in the first run");
            assertEquals(0, count("SELECT sweep_failures FROM commerce_order WHERE id = ?", confirmed));
            assertTrue(count("SELECT count(*) FROM commerce_order WHERE order_number LIKE 'FAIL-" + run + "-%' AND "
                    + "sweep_failures = 2") > 0, "the failing orders were tried after it and failed again");
            assertNotNull(shipment);
        } finally {
            db.update("UPDATE commerce_tax_setting SET invoice_at = 'PACKED' WHERE institute_id = ?", inst);
        }

        // The backoff: 1 h, 4 h, 16 h, then 24 h; a success (or a staff confirm) clears it.
        String target = text("SELECT id FROM commerce_order WHERE order_number = ?", "FAIL-" + run + "-1");
        db.update("UPDATE commerce_order SET sweep_failures = 0, sweep_retry_after = NULL WHERE id = ?", target);
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        Date now = new Date();
        List<Long> minutes = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            tx.executeWithoutResult(s -> orderRepository.deferSweep(target, now));
            Date after = db.queryForObject("SELECT sweep_retry_after FROM commerce_order WHERE id = ?", Date.class,
                    target);
            minutes.add((after.getTime() - now.getTime()) / 60_000L);
        }
        assertEquals(List.of(60L, 240L, 960L, 1440L, 1440L), minutes);
        tx.executeWithoutResult(s -> orderRepository.clearSweep(target));
        assertEquals(0, count("SELECT sweep_failures FROM commerce_order WHERE id = ? AND sweep_retry_after IS NULL",
                target));

        String cod = paidOrder(Map.of(credit, 1));
        db.update("UPDATE commerce_order SET status = 'COD_PENDING_CONFIRMATION', sweep_failures = 2, "
                + "sweep_retry_after = now() + interval '4 hours' WHERE id = ?", cod);
        move(cod, "COD_PENDING_CONFIRMATION", "CONFIRMED");
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE id = ? AND sweep_failures = 0 AND "
                + "sweep_retry_after IS NULL", cod), "a staff confirm clears the COD timer's deferral");
    }

    /** Packs and ships an order, then marks its invoice cancelled: a SHIPPED order with no live invoice. */
    private String shippedWithoutInvoice(String orderId) {
        List<ShipmentDtos.PackLine> pack = new ArrayList<>();
        for (Map<String, Object> row : itemLines(orderId)) {
            pack.add(ShipmentDtos.PackLine.builder().orderLineId(String.valueOf(row.get("id")))
                    .quantity(((Number) row.get("open")).intValue()).build());
        }
        shipments.pack(admin, inst, ShipmentDtos.PackRequest.builder().clientRequestId(key()).orderId(orderId)
                .fromStatus("CONFIRMED").lines(pack).build());
        String shipment = text("SELECT id FROM commerce_shipment WHERE order_id = ? AND status <> 'CANCELLED'", orderId);
        shipments.ship(admin, inst, shipment, ShipmentDtos.ShipRequest.builder().clientRequestId(key())
                .carrierName("India Post").trackingNumber("EM" + keys.incrementAndGet() + "IN")
                .trackingUrl("https://www.indiapost.gov.in/track").build());
        db.update("UPDATE invoice SET cancelled_at = now() WHERE commerce_order_id = ?", orderId);
        return shipment;
    }

    // ------------------------------------------------------------------ 13. review follow-ups

    /**
     * The executor's claim commits between a staff cancel's read (PENDING) and its update: the
     * cancel is refused, nothing is FAILED, the commitment stays, and the refund finishes.
     */
    @Test
    @Order(14)
    void aCancelRacingTheExecutorsClaimIsRefusedAndNothingIsFailed() {
        clientIp = "127.0.0.14";
        String orderId = paidOrder(Map.of(qtyA, 1));
        move(orderId, "CONFIRMED", "CANCELLED");
        BigDecimal amount = paid(orderId);
        String refundId = pendingGatewayRow(orderId, amount);
        BigDecimal committed = money("SELECT refund_committed FROM commerce_order WHERE id = ?", orderId);
        assertEquals(0, amount.compareTo(committed));
        Object answer;
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (java.sql.Connection side = db.getDataSource().getConnection()) {
            side.setAutoCommit(false);
            // The executor's claim (the same UPDATE), not yet committed.
            try (java.sql.PreparedStatement claim = side.prepareStatement("UPDATE commerce_refund SET status = "
                    + "'IN_PROGRESS', claimed_at = now(), attempt_count = attempt_count + 1, next_poll_at = now() + "
                    + "interval '2 minutes' WHERE id = ? AND method = 'GATEWAY' AND status = 'PENDING'")) {
                claim.setString(1, refundId);
                assertEquals(1, claim.executeUpdate());
            }
            Future<Object> cancel = pool.submit(() -> {
                header();
                try {
                    return refunds.cancel(admin, inst, refundId, RefundDtos.CancelRequest.builder()
                            .clientRequestId(key()).reason("proof cancel").build());
                } catch (Exception e) {
                    return e;
                } finally {
                    RequestContextHolder.resetRequestAttributes();
                }
            });
            // The cancel has read PENDING and waits on the refund row for its update.
            awaitWaiting(1);
            side.commit();
            answer = cancel.get(60, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        } finally {
            pool.shutdownNow();
        }
        assertTrue(answer instanceof ConflictException
                && ((ConflictException) answer).getMessage().startsWith("REFUND_STATE_CHANGED"), String.valueOf(answer));
        assertEquals("IN_PROGRESS", refundStatus(refundId));
        assertEquals(0, count("SELECT count(*) FROM commerce_refund WHERE order_id = ? AND status = 'FAILED'", orderId),
                "nothing is marked FAILED");
        assertEquals(0, committed.compareTo(money("SELECT refund_committed FROM commerce_order WHERE id = ?", orderId)),
                "the due is not reopened");
        assertFalse(inQueue("REFUND_DUE", orderId));
        assertEquals(0, count("SELECT count(*) FROM commerce_audit WHERE reference_id = ? AND kind = 'REFUND_CANCELLED'",
                refundId));
        ledger(orderId);

        // The claimed refund goes on: the gateway has it by its receipt; the poll's check finishes it.
        String paymentId = text("SELECT gateway_payment_id FROM commerce_refund WHERE id = ?", refundId);
        Map<String, Object> found = new HashMap<>();
        found.put("id", "rfnd_" + run + "raced");
        found.put("payment_id", paymentId);
        found.put("amount", amount.movePointRight(2).longValueExact());
        found.put("status", "processed");
        found.put("receipt", refundId);
        listed.put(paymentId, List.of(found));
        assertEquals(CommerceRefundExecutor.Result.PROCESSED, executor.check(refundId, new Date()));
        assertEquals("PROCESSED", refundStatus(refundId));
        ledger(orderId);
    }

    /**
     * An oversold order whose payment A failed and payment B was captured on the same gateway
     * order: the automatic refund is made by the webhook request, on B.
     */
    @Test
    @Order(15)
    void anOversoldOrderPaidBySecondAttemptIsRefundedOnThePaymentThatWasCaptured() {
        clientIp = "127.0.0.15";
        String scarceTwo = variant("scarce-two", "S2", "300.00", false);
        receive(scarceTwo, 1);
        snapshotLoader.evict(inst);
        CheckoutDtos.Placed late = place(List.of(CartPriceRequest.Line.builder().variantId(scarceTwo).quantity(1)
                .build()));
        Map<String, Object> row = db.queryForMap("SELECT * FROM commerce_gateway_order WHERE commerce_order_id = ?",
                late.getOrderId());
        String gatewayOrderId = String.valueOf(row.get("gateway_order_id"));
        long amount = ((Number) row.get("amount_minor")).longValue();
        String failedA = "pay_" + UUID.randomUUID().toString().substring(0, 14);
        Map<String, Object> failedEntity = paymentEntity(gatewayOrderId, failedA, amount, late.getOrderId());
        failedEntity.put("status", "failed");
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("entity", "event");
        root.put("event", "payment.failed");
        root.put("payload", Map.of("payment", Map.of("entity", failedEntity)));
        assertEquals(200, post(root));
        assertEquals(failedA, text("SELECT gateway_payment_id FROM commerce_gateway_order WHERE id = ?", row.get("id")),
                "the gateway row names the failed payment");

        assertTrue(paymentService.onHoldExpired(late.getOrderId()));
        snapshotLoader.evict(inst);
        String winner = paidOrder(Map.of(scarceTwo, 1));
        assertEquals("CONFIRMED", status(winner));
        String capturedB = payByWebhook(late.getOrderId(), gatewayOrderId, amount);
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE id = ? AND cancel_reason = 'OVERSOLD_PAID'",
                late.getOrderId()));
        Map<String, Object> auto = db.queryForMap("SELECT * FROM commerce_refund WHERE order_id = ?", late.getOrderId());
        assertEquals(capturedB, auto.get("gateway_payment_id"), "the refund is on the payment that was captured");
        assertEquals("PENDING", auto.get("status"));
        assertEquals(auto.get("id"), text("SELECT refund_id FROM commerce_payment_exception WHERE commerce_order_id = ? "
                + "AND kind = 'OVERSOLD_PAID'", late.getOrderId()));
        int before = creates.size();
        createMode = "processed";
        try {
            pollJob.runOnce(new Date(System.currentTimeMillis() + 4 * 60_000L));
        } finally {
            createMode = "pending";
        }
        assertEquals(before + 1, creates.size());
        assertTrue(creates.get(creates.size() - 1).startsWith(capturedB + "|"), creates.get(creates.size() - 1));
        assertEquals("PROCESSED", refundStatus(String.valueOf(auto.get("id"))));
        assertEquals("RESOLVED", text("SELECT status FROM commerce_payment_exception WHERE commerce_order_id = ? AND "
                + "kind = 'OVERSOLD_PAID'", late.getOrderId()));
        ledger(late.getOrderId());
        noDrift("oversold paid by a second attempt");
    }

    /**
     * Exception rows with nothing left to do are never read again, so 25 of them (older) do not
     * keep a newer one out of the 20 the poll reads; an oversold order settled another way has its
     * rows resolved.
     */
    @Test
    @Order(16)
    void exceptionRowsWithNothingLeftOwingAreNotRetriedAndDoNotBlockNewerOnes() {
        // A paid order whose whole due staff refunded in cash before any automatic refund was made;
        // its oversold rows (written, the hook's refund never made) are still OPEN.
        clientIp = "127.0.0.16";
        String settled = paidOrder(Map.of(qtyA, 1));
        move(settled, "CONFIRMED", "CANCELLED");
        assertEquals("PROCESSED", refund(settled, null, paid(settled), "CASH", null, key()).getStatus());
        assertEquals(0, paid(settled).compareTo(money("SELECT amount_refunded FROM commerce_order WHERE id = ?",
                settled)));
        for (int i = 0; i < 25; i++) {
            db.update("INSERT INTO commerce_payment_exception (id, institute_id, commerce_order_id, order_number, kind, "
                    + "gateway_payment_id, amount, currency, status, detail, created_at) VALUES (?, ?, ?, 'STUCK', "
                    + "'OVERSOLD_PAID', ?, 1.00, 'INR', 'OPEN', 'proof', now() - interval '1 day')",
                    UUID.randomUUID().toString(), inst, settled, i == 0 ? "" : "stuck-" + run + "-" + i);
        }
        String zero = UUID.randomUUID().toString();
        db.update("INSERT INTO commerce_payment_exception (id, institute_id, commerce_order_id, order_number, kind, "
                + "gateway_payment_id, amount, currency, status, detail, created_at) VALUES (?, ?, ?, 'ZERO', "
                + "'DUPLICATE_PAYMENT', ?, 0.00, 'INR', 'OPEN', 'proof', now() - interval '1 day')", zero, inst, settled,
                "pay_zero" + run);
        String newer = UUID.randomUUID().toString();
        db.update("INSERT INTO commerce_payment_exception (id, institute_id, commerce_order_id, order_number, kind, "
                + "gateway_payment_id, amount, currency, status, detail, created_at) VALUES (?, ?, ?, 'NEWER', "
                + "'DUPLICATE_PAYMENT', ?, 5.00, 'INR', 'OPEN', 'proof', now() - interval '5 minutes')", newer, inst,
                settled, "pay_newer" + run);
        try {
            List<String> read = new TransactionTemplate(transactionManager).execute(tx -> exceptionRepository
                    .findUnrefunded(new Date(System.currentTimeMillis() - 120_000L), 20).stream()
                    .map(e -> e.getId()).toList());
            assertTrue(read.contains(newer), "the newer row is read: " + read);
            assertFalse(read.contains(zero), "a duplicate of nothing is not retried");
            assertEquals(0, count("SELECT count(*) FROM commerce_payment_exception WHERE id = ANY(?::varchar[]) AND "
                    + "order_number = 'STUCK'", "{" + String.join(",", read) + "}"), "no row of the settled order");

            // The hook called again for the settled order resolves its open rows and makes no refund.
            long refundRows = count("SELECT count(*) FROM commerce_refund WHERE order_id = ?", settled);
            assertNull(refunds.autoOversold(inst, settled));
            assertEquals(refundRows, count("SELECT count(*) FROM commerce_refund WHERE order_id = ?", settled));
            assertEquals(25, count("SELECT count(*) FROM commerce_payment_exception WHERE order_number = 'STUCK' AND "
                    + "commerce_order_id = ? AND status = 'RESOLVED' AND resolution_note LIKE 'Refunded otherwise%'",
                    settled));
            ledger(settled);
        } finally {
            db.update("DELETE FROM commerce_payment_exception WHERE id IN (?, ?)", zero, newer);
        }
    }
}
