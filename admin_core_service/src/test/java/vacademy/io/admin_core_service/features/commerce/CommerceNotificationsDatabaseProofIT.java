package vacademy.io.admin_core_service.features.commerce;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
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
import vacademy.io.admin_core_service.features.commerce.customer.CommercePhones;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionClient;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotificationDispatcher;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotificationJob;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotificationOutbox;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotificationTrigger;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceWhatsAppTemplateStatus;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceCheckoutService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderLinkService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderLinkTokens;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderEvents;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.ShippingRuleDTO;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceShippingRuleService;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpService;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpTransport;
import vacademy.io.admin_core_service.features.commerce.returns.dto.RefundDtos;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundService;
import vacademy.io.admin_core_service.features.commerce.shipment.dto.ShipmentDtos;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.scheduler.StockReconciliationJob;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLocationService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockReceiptService;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceCheckoutSettingsService;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxClassDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxRateRuleDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxSettingDTO;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxClassService;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.institute_api.dto.IssueApiKeyRequest;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiKey;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiKeyService;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.payments.manager.RazorpayPaymentManager;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
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
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Database-backed proof of the buyer's order messages (WP-33) on a local Postgres with the real
 * Flyway chain (V721 included) and the real Spring context. Orders are made through the built
 * checkout (a real OTP round trip proves the phone; the stub transport records the code) and paid
 * by a signed {@code payment.captured} webhook posted to this application's own port; COD orders
 * go through the COD placement; shipments, cancels, refunds and the COD confirm are the real staff
 * services.
 *
 * <p><b>Nothing is sent anywhere.</b> {@link NotificationService#sendUnified} is a spy answered
 * by this class (every request is recorded and must never reach a server); the WhatsApp template
 * status is a mock set per step; the workflow engine is a mock.
 *
 * <p><b>Determinism.</b> The listener that sends right after a commit hands its work to the
 * executor {@code commerceNotifyExecutor}; here that executor is a mock that only queues the task
 * (proving the hand-off happened after the commit), and the proof runs the queued tasks itself on
 * the test thread, outside any transaction ({@link #drain}), or drives {@link
 * CommerceNotificationJob#runOnce()} and the dispatcher directly. The scheduled job never runs
 * (cron "-" and no scheduler). Times that matter are moved with SQL {@code now()}-relative
 * updates, never with Java dates (the app's connections and the JVM may disagree on the zone).
 *
 * <p>Skipped unless {@code COMMERCE_IT_PG_URL} names a database on this machine. Every tax rate is
 * a TEST placeholder.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CommerceNotificationsDatabaseProofIT {

    private static final String SELLER_GSTIN = "09AAACH7409R1ZZ";
    private static final String WEBHOOK_SECRET = "whsec-local-proof-only";
    private static final String KEY_SECRET = "key-secret-local-proof-only";
    private static final String KEY_ID = "rzp_test_localproof";
    private static final String WEBHOOK_PATH = "/admin-core-service/payments/webhook/callback/razorpay";
    private static final String OPEN = "/admin-core-service/open/commerce/v1";
    private static final Pattern DEVANAGARI = Pattern.compile("\\p{IsDevanagari}");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        registry.add("commerce.order-token.secret", () -> "local-proof-only-not-a-secret");
        registry.add("commerce.order-link.secret", () -> "local-proof-only-link-not-a-secret");
        registry.add("commerce.turnstile.required", () -> "false");
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "40");
        registry.add("commerce.notify.cron", () -> "-");
        // Off by default (production stays off until the first messages are checked); on for this proof.
        registry.add("commerce.notifications.enabled", () -> "true");
        registry.add("commerce.payment-fetch.cron", () -> "-");
        registry.add("commerce.refund-poll.cron", () -> "-");
        registry.add("commerce.cod-confirm-timeout.cron", () -> "-");
        registry.add("commerce.cod.placement-enabled", () -> "true");
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
    @Autowired private CommerceShippingRuleService shippingRuleService;
    @Autowired private CommerceCheckoutSettingsService checkoutSettings;
    @Autowired private StorefrontSnapshotLoader snapshotLoader;
    @Autowired private CommerceOrderService orderService;
    @Autowired private CommerceCheckoutService checkoutService;
    @Autowired private CommerceOtpService otpService;
    @Autowired private CommerceOrderDeskService desk;
    @Autowired private CommerceShipmentService shipments;
    @Autowired private CommerceRefundService refunds;
    @Autowired private CommerceOrderEvents events;
    @Autowired private CommerceNotificationOutbox outbox;
    @Autowired private CommerceNotificationDispatcher dispatcher;
    @Autowired private CommerceNotificationJob job;
    @Autowired private CommerceNotificationStore store;
    @Autowired private CommerceOrderLinkTokens linkTokens;
    @Autowired private CommerceOrderLinkService linkService;
    @Autowired private InstituteApiKeyService apiKeys;
    @Autowired private StockReconciliationJob reconciliationJob;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private ObjectMapper objectMapper;
    @LocalServerPort private int port;

    @MockBean private AuthService authService;
    @SpyBean private RazorpayPaymentManager razorpay;
    @SpyBean private NotificationService notificationService;
    @MockBean private CommerceWhatsAppTemplateStatus templates;
    @MockBean private WorkflowTriggerService workflowTriggerService;
    @MockBean(name = "commerceNotifyExecutor") private ThreadPoolTaskExecutor notifyExecutor;
    @MockBean private CommerceOtpTransport otpTransport;
    @MockBean private InvoiceService invoiceService;
    @MockBean private PaymentNotificatonService paymentNotificatonService;
    @MockBean private DynamicNotificationService dynamicNotificationService;
    @MockBean private AsyncEnrollmentEmailService asyncEnrollmentEmailService;
    @MockBean private MediaService mediaService;
    @MockBean private CommerceRenditionClient renditionClient;

    private final String inst = UUID.randomUUID().toString();
    private final String run = inst.substring(0, 8);
    private final String instB = UUID.randomUUID().toString();
    private final String actor = "admin-" + run;
    private final String host = "shop-" + run + ".example.com";
    private final AtomicInteger users = new AtomicInteger();
    private final AtomicInteger keys = new AtomicInteger();
    private final AtomicInteger phones = new AtomicInteger(500);
    private final AtomicInteger ips = new AtomicInteger(10);
    private final AtomicInteger gatewayOrders = new AtomicInteger();
    private final AtomicInteger messageIds = new AtomicInteger();
    private final Map<String, String> lastCode = new ConcurrentHashMap<>();

    /** Every request the send API was asked for, in order. Never reaches a server. */
    private final List<UnifiedSendRequest> sent = java.util.Collections.synchronizedList(new ArrayList<>());
    /** Requests made while a transaction was open on the calling thread (must stay 0). */
    private final AtomicInteger sentInsideTransaction = new AtomicInteger();
    /** Every e-mail the account service was asked to get-or-create. */
    private final List<String> accountEmails = java.util.Collections.synchronizedList(new ArrayList<>());
    /** The tasks the after-commit listener handed to the (mock) notification executor. */
    private final ConcurrentLinkedQueue<Runnable> listenerTasks = new ConcurrentLinkedQueue<>();
    /** What the template status read answers for every template (per step). */
    private volatile String templateStatus = "PENDING";

    private String wh;
    private String taxClass;
    private String itemA;   // 200 in stock, 1000.00
    private String big;     // 10 in stock, 3500.00: above the COD confirmation amount
    private String keyA;    // Catalogue API key of the shop
    private String keyB;    // Catalogue API key of another shop
    private CustomUserDetails admin;

    // carried from gate 1 (language) to gate 1 (link)
    private String hiOrder;
    private String hiShippedLink;

    @BeforeEach
    void outsideServicesAnswerLocally() {
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), anyString(), anyBoolean()))
                .thenAnswer(call -> {
                    UserDTO asked = call.getArgument(0);
                    accountEmails.add(String.valueOf(asked.getEmail()));
                    UserDTO user = new UserDTO();
                    user.setId("buyer-" + run + "-" + users.incrementAndGet());
                    return user;
                });
        doAnswer(call -> {
            lastCode.put(call.getArgument(1), call.getArgument(2));
            return null;
        }).when(otpTransport).send(anyString(), anyString(), anyString());
        doAnswer(call -> {
            PaymentInitiationRequestDTO asked = call.getArgument(1);
            Map<String, Object> data = new HashMap<>();
            data.put("razorpayOrderId", "order_" + run + "n" + gatewayOrders.incrementAndGet());
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
        // The send API: recorded and answered here; it never reaches a server.
        doAnswer(call -> {
            UnifiedSendRequest request = call.getArgument(0);
            if (TransactionSynchronizationManager.isActualTransactionActive()) {
                sentInsideTransaction.incrementAndGet();
            }
            sent.add(request);
            return UnifiedSendResponse.builder().total(1).accepted(1).failed(0).status("COMPLETED")
                    .results(List.of(UnifiedSendResponse.RecipientResult.builder().success(true).status("SENT")
                            .messageId("msg-" + run + "-" + messageIds.incrementAndGet()).build()))
                    .build();
        }).when(notificationService).sendUnified(any());
        when(templates.status(anyString(), anyString(), anyString())).thenAnswer(call -> templateStatus);
        when(templates.category(anyString(), anyString(), anyString()))
                .thenReturn(CommerceWhatsAppTemplateStatus.UTILITY);
        // The listener's executor only queues; the proof runs the tasks itself.
        doAnswer(call -> {
            listenerTasks.add(call.getArgument(0));
            return null;
        }).when(notifyExecutor).execute(any(Runnable.class));
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
        return "wp33-" + run + "-" + keys.incrementAndGet();
    }

    private long count(String query, Object... args) {
        Long n = db.queryForObject(query, Long.class, args);
        return n == null ? 0 : n;
    }

    private String text(String query, Object... args) {
        return db.queryForObject(query, String.class, args);
    }

    private void noDrift(String step) {
        List<StockReconciliationJob.Drift> drift = reconciliationJob.findSellableDrift().stream()
                .filter(d -> inst.equals(d.instituteId())).toList();
        assertTrue(drift.isEmpty(), "drift after " + step + ": " + drift);
    }

    private String status(String orderId) {
        return text("SELECT status FROM commerce_order WHERE id = ?", orderId);
    }

    private String newPhone() {
        return "98767" + String.format("%05d", phones.incrementAndGet());
    }

    private String nextIp() {
        return "203.0.113." + ips.incrementAndGet();
    }

    /** The verified-phone token of a real OTP round trip on this database. */
    private String phoneToken(String phone) {
        String ip = nextIp();
        otpService.requestOtp(inst, phone, "CHECKOUT", ip);
        String code = lastCode.get("91" + phone);
        assertNotNull(code, "the stub transport recorded the code");
        return otpService.verifyOtp(inst, phone, code, "CHECKOUT", ip);
    }

    private String variant(String slug, String sku, String price) {
        ProductRequest request = ProductRequest.builder().slug(slug + "-" + run)
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name(slug + " " + run).build()))
                .taxClassId(taxClass).status("ACTIVE").stockMode("QUANTITY")
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

    private void settings(String json) {
        try {
            checkoutSettings.update(inst, actor, objectMapper.readTree(json));
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        snapshotLoader.evict(inst);
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

    private HttpResponse<String> http(HttpRequest request) {
        try {
            return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new IllegalStateException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    /** One real HTTP POST of a signed captured event for the order's latest gateway order. */
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
            HttpResponse<String> response = http(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port
                            + WEBHOOK_PATH))
                    .header("Content-Type", "application/json")
                    .header("X-Razorpay-Signature", hmacHex(WEBHOOK_SECRET, payload))
                    .POST(HttpRequest.BodyPublishers.ofString(payload)).build());
            assertEquals(200, response.statusCode(), response.body());
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private List<CartPriceRequest.Line> lines(Map<String, Integer> quantities) {
        List<CartPriceRequest.Line> lines = new ArrayList<>();
        quantities.forEach((variantId, quantity) -> lines.add(CartPriceRequest.Line.builder().variantId(variantId)
                .quantity(quantity).build()));
        return lines;
    }

    /**
     * A prepaid order through the built checkout. {@code phoneProved}: a real OTP token of the
     * phone goes with it. {@code typedEmail}: the buyer typed buyer-…@example.com (deliverable).
     */
    private CheckoutDtos.Placed place(String locale, boolean phoneProved, boolean typedEmail,
                                      Map<String, Integer> quantities) {
        BigDecimal total = orderService.priceCart(inst, CartPriceRequest.builder().lines(lines(quantities))
                .pincode("226001").build()).snapshot().getTotal();
        String phone = newPhone();
        return checkoutService.placeOrder(inst, CheckoutRequest.builder()
                .clientRequestId("order-" + run + "-" + keys.incrementAndGet())
                .locale(locale)
                .phoneToken(phoneProved ? phoneToken(phone) : null)
                .lines(lines(quantities)).expectedTotal(total)
                .customer(CheckoutRequest.Customer.builder().name("Proof Buyer").phone(phone)
                        .email(typedEmail ? "buyer-" + phone + "@example.com" : null).build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("1 Proof Road").city("Lucknow")
                        .pincode("226001").build())
                .build(), nextIp());
    }

    /** Placed and paid by the webhook: CONFIRMED; the listener's task of ORDER_CONFIRMED is queued. */
    private String paidOrder(String locale, boolean phoneProved, boolean typedEmail) {
        CheckoutDtos.Placed placed = place(locale, phoneProved, typedEmail, Map.of(itemA, 1));
        payByWebhook(placed.getOrderId());
        assertEquals("CONFIRMED", status(placed.getOrderId()));
        return placed.getOrderId();
    }

    /** A COD order with a fresh OTP of a new phone and a typed example.com address. */
    private String codOrder(Map<String, Integer> quantities) {
        String phone = newPhone();
        BigDecimal total = orderService.priceCart(inst, CartPriceRequest.builder().lines(lines(quantities))
                .pincode("226001").paymentMethod("COD").build()).snapshot().getTotal();
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, CheckoutRequest.builder()
                .clientRequestId(key())
                .paymentMethod("COD")
                .locale("en")
                .phoneToken(phoneToken(phone))
                .lines(lines(quantities)).expectedTotal(total)
                .customer(CheckoutRequest.Customer.builder().name("Proof Buyer").phone(phone)
                        .email("buyer-" + phone + "@example.com").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("1 Proof Road").city("Lucknow")
                        .pincode("226001").build())
                .build(), null);
        assertNull(placed.getPayment());
        return placed.getOrderId();
    }

    private void pack(String orderId) {
        List<ShipmentDtos.PackLine> pack = new ArrayList<>();
        for (Map<String, Object> row : db.queryForList("SELECT id, quantity - qty_cancelled - qty_shipped AS open "
                + "FROM commerce_order_line WHERE order_id = ? AND line_type = 'ITEM' ORDER BY line_no", orderId)) {
            int open = ((Number) row.get("open")).intValue();
            if (open > 0) {
                pack.add(ShipmentDtos.PackLine.builder().orderLineId(String.valueOf(row.get("id"))).quantity(open)
                        .build());
            }
        }
        shipments.pack(admin, inst, ShipmentDtos.PackRequest.builder().clientRequestId(key()).orderId(orderId)
                .fromStatus("CONFIRMED").lines(pack).build());
        assertEquals("PACKED", status(orderId));
    }

    private String liveShipment(String orderId) {
        return text("SELECT id FROM commerce_shipment WHERE order_id = ? AND status <> 'CANCELLED'", orderId);
    }

    /** Packed and shipped with India Post; the shipment id. */
    private String ship(String orderId) {
        pack(orderId);
        String shipment = liveShipment(orderId);
        shipments.ship(admin, inst, shipment, ShipmentDtos.ShipRequest.builder().clientRequestId(key())
                .carrierName("India Post").trackingNumber("EM" + run.substring(0, 4) + keys.incrementAndGet() + "IN")
                .trackingUrl("https://www.indiapost.gov.in/track").build());
        assertEquals("SHIPPED", status(orderId));
        return shipment;
    }

    private void delivered(String orderId) {
        shipments.status(admin, inst, liveShipment(orderId), ShipmentDtos.StatusRequest.builder()
                .clientRequestId(key()).to("DELIVERED").build());
        assertEquals("DELIVERED", status(orderId));
    }

    private void move(String orderId, String from, String to) {
        desk.transition(admin, inst, orderId, OrderDeskDtos.TransitionRequest.builder().clientRequestId(key())
                .fromStatus(from).toStatus(to).reason("proof").build());
    }

    /** Waits until the listener queued at least {@code n} tasks (the after-commit hand-off). */
    private void awaitTasks(int n) {
        long deadline = System.currentTimeMillis() + 10_000L;
        while (listenerTasks.size() < n && System.currentTimeMillis() < deadline) {
            sleep(20);
        }
        assertTrue(listenerTasks.size() >= n, "the listener handed " + listenerTasks.size() + " task(s), expected " + n);
    }

    /** Runs the queued listener tasks on this thread (no transaction is open here). */
    private int drain() {
        assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
        int n = 0;
        Runnable task;
        while ((task = listenerTasks.poll()) != null) {
            task.run();
            n++;
        }
        return n;
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    /** The send requests of one order (by the delivery id carried as sourceId). */
    private List<UnifiedSendRequest> calls(String orderId) {
        Set<String> ids = new HashSet<>(db.queryForList("SELECT id FROM commerce_notification_delivery WHERE "
                + "order_id = ?", String.class, orderId));
        synchronized (sent) {
            return sent.stream().filter(r -> r.getOptions() != null && ids.contains(r.getOptions().getSourceId()))
                    .toList();
        }
    }

    private List<UnifiedSendRequest> calls(String orderId, String trigger, String channel) {
        Set<String> ids = new HashSet<>(db.queryForList("SELECT id FROM commerce_notification_delivery WHERE "
                + "order_id = ? AND trigger_code = ? AND channel = ?", String.class, orderId, trigger, channel));
        synchronized (sent) {
            return sent.stream().filter(r -> r.getOptions() != null && ids.contains(r.getOptions().getSourceId()))
                    .toList();
        }
    }

    private List<Map<String, Object>> eventsOf(String orderId, String trigger) {
        return db.queryForList("SELECT * FROM commerce_notification_event WHERE order_id = ? AND trigger_code = ? "
                + "ORDER BY created_at, id", orderId, trigger);
    }

    private Map<String, Object> delivery(String orderId, String trigger, String channel) {
        List<Map<String, Object>> rows = db.queryForList("SELECT * FROM commerce_notification_delivery WHERE "
                + "order_id = ? AND trigger_code = ? AND channel = ?", orderId, trigger, channel);
        assertEquals(1, rows.size(), "one " + channel + " row of " + trigger + ": " + rows);
        return rows.get(0);
    }

    private String eventId(String orderId, String trigger) {
        List<Map<String, Object>> rows = eventsOf(orderId, trigger);
        assertEquals(1, rows.size(), "one " + trigger + " event: " + rows);
        return String.valueOf(rows.get(0).get("id"));
    }

    private Map<String, Object> order(String orderId) {
        return db.queryForMap("SELECT * FROM commerce_order WHERE id = ?", orderId);
    }

    private HttpResponse<String> exchange(String apiKey, String linkToken) {
        try {
            String body = objectMapper.writeValueAsString(Map.of("link_token", linkToken));
            return http(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + OPEN + "/orders/link"))
                    .header("Content-Type", "application/json").header("X-API-Key", apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(body)).build());
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private HttpResponse<String> view(String apiKey, String orderToken) {
        return http(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + OPEN + "/orders/view"))
                .header("X-API-Key", apiKey).header("X-Commerce-Order-Token", orderToken).GET().build());
    }

    private JsonNode json(String body) {
        try {
            return objectMapper.readTree(body);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private String catalogKey(String instituteId) {
        IssueApiKeyRequest request = new IssueApiKeyRequest();
        request.setProduct(InstituteApiKeyService.PRODUCT_CATALOG);
        request.setName("proof " + run);
        return apiKeys.issue(instituteId, request, admin, InstituteApiKey.VIA_DASHBOARD).plaintext();
    }

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
                    try {
                        return task.call();
                    } catch (Exception e) {
                        return e;
                    }
                }));
            }
            long deadline = System.currentTimeMillis() + 30_000L;
            long waiting = waitingOnLocks();
            while (waiting < tasks.size() && System.currentTimeMillis() < deadline) {
                sleep(50);
                waiting = waitingOnLocks();
            }
            assertEquals(tasks.size(), waiting, "every sender is blocked on the row held by the side connection");
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

    private long waitingOnLocks() {
        return count("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = "
                + "'Lock' AND pid <> pg_backend_pid()");
    }

    private List<String> outboxLog(Runnable work) {
        ch.qos.logback.classic.Logger logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(
                CommerceNotificationOutbox.class);
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
            return appender.list.stream().map(e -> e.getLevel() + " " + e.getFormattedMessage()).toList();
        }
    }

    // ------------------------------------------------------------------ seed

    @Test
    @Order(1)
    void seed_aShopWithStockAVerifiedWebsiteCatalogueKeysAndCod() {
        assertEquals(1, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version = '721'"),
                "V721 is in the Flyway history");
        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", inst,
                "Notify Proof " + run, "https://" + host);
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)", inst);
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", instB,
                "Other Proof " + run, "https://other-" + run + ".example.com");
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)",
                instB);
        capabilityResolver.evict(inst);
        capabilityResolver.evict(instB);
        // One verified website: the link base of the messages is https://<host>.
        db.update("INSERT INTO institute_website (id, institute_id, host, status, verification_token, verified_at, "
                + "created_by, created_at) VALUES (?, ?, ?, 'VERIFIED', ?, now(), ?, now())",
                UUID.randomUUID().toString(), inst, host, "proof-token-" + run, actor);
        taxSettingService.update(inst, actor, TaxSettingDTO.builder().taxMode("REGULAR").sellerGstin(SELLER_GSTIN)
                .sellerLegalName("Proof Seller " + run).sellerAddress("1 Proof Road, Lucknow 226001")
                .roundTotalTo("RUPEE").build());
        taxClass = taxClassService.create(inst, actor, TaxClassDTO.builder().code("goods_test").name("goods TEST")
                .hsnCode("5208").unit("PCS")
                .rules(List.of(TaxRateRuleDTO.builder().minUnitPrice(new BigDecimal("0"))
                        .ratePercent(new BigDecimal("5")).effectiveFrom(LocalDate.of(2020, 4, 1)).build()))
                .build()).getId();
        seriesService.create(inst, actor, DocumentSeriesDTO.builder().documentType("TAX_INVOICE")
                .prefix("NK" + run.substring(0, 2)).build());
        seriesService.create(inst, actor, DocumentSeriesDTO.builder().documentType("CREDIT_NOTE")
                .prefix("NC" + run.substring(0, 2)).build());

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

        itemA = variant("item-a", "IA", "1000.00");
        big = variant("big", "BG", "3500.00");
        receive(itemA, 200);
        receive(big, 10);
        db.update("INSERT INTO institute_payment_gateway_mapping (id, vendor, institute_id, payment_gateway_specific_data, "
                        + "status) VALUES (?, 'RAZORPAY', ?, ?, 'ACTIVE')", UUID.randomUUID().toString(), inst,
                "{\"apiKey\":\"" + KEY_ID + "\",\"apiSecret\":\"" + KEY_SECRET + "\",\"keySecret\":\"" + KEY_SECRET
                        + "\",\"webhookSecret\":\"" + WEBHOOK_SECRET + "\"}");
        Map<String, Object> tier = new HashMap<>();
        tier.put("up_to", null);
        tier.put("charge", BigDecimal.ZERO);
        shippingRuleService.save(inst, actor, ShippingRuleDTO.builder().basis("FLAT").tiers(List.of(tier))
                .codCharge(new BigDecimal("40.00")).taxClassId(taxClass).build());
        settings("""
                {"cod": {"enabled": true, "max_order_value": 5000, "staff_confirm_threshold": 3000,
                         "max_open_orders_per_phone": 2, "max_refusals": 2, "confirm_within_hours": 48}}""");
        snapshotLoader.evict(inst);
        keyA = catalogKey(inst);
        keyB = catalogKey(instB);
        assertTrue(keyA.startsWith("vak_pub_") && keyB.startsWith("vak_pub_"));
        assertEquals(0, count("SELECT count(*) FROM commerce_notification_event"));
        noDrift("seed");
    }

    // ------------------------------------------------------------------ 1. outbox is atomic

    @Test
    @Order(2)
    void proof1_theOutboxRowCommitsWithTheChangeOrNotAtAll() throws Exception {
        String orderId = paidOrder("en", true, true);
        awaitTasks(1);
        drain();
        String number = text("SELECT order_number FROM commerce_order WHERE id = ?", orderId);
        String ref = "proof-ref-" + run;
        CommerceOrderEvents.OrderEvent rto = new CommerceOrderEvents.OrderEvent(CommerceOrderEvents.ORDER_RTO, inst,
                orderId, number, ref, true);
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        String countRto = "SELECT count(*) FROM commerce_notification_event WHERE order_id = ? AND trigger_code = "
                + "'ORDER_RTO' AND ref_id = ?";

        // Rolled back: no row, and nothing handed to the listener (it only hears of commits).
        tx.executeWithoutResult(status -> {
            events.afterCommit(rto);
            assertEquals(1, count(countRto, orderId, ref), "visible inside its own transaction");
            status.setRollbackOnly();
        });
        assertEquals(0, count(countRto, orderId, ref), "rolled back with the change");
        assertTrue(listenerTasks.isEmpty(), "no after-commit hand-off for a rollback");

        // Committed: one row, written on the transaction's own connection (another connection does
        // not see it before the commit).
        tx.executeWithoutResult(status -> {
            events.afterCommit(rto);
            try (java.sql.Connection side = db.getDataSource().getConnection();
                 java.sql.PreparedStatement q = side.prepareStatement(countRto)) {
                q.setString(1, orderId);
                q.setString(2, ref);
                try (java.sql.ResultSet rs = q.executeQuery()) {
                    rs.next();
                    assertEquals(0, rs.getLong(1), "not visible outside the transaction before the commit");
                }
            } catch (java.sql.SQLException e) {
                throw new IllegalStateException(e);
            }
        });
        assertEquals(1, count(countRto, orderId, ref));
        assertEquals(1, listenerTasks.size(), "handed to the listener after the commit");
        listenerTasks.clear();

        // The same event twice in one transaction, and once more later: still one row.
        tx.executeWithoutResult(status -> {
            events.afterCommit(rto);
            events.afterCommit(rto);
        });
        tx.executeWithoutResult(status -> events.afterCommit(rto));
        assertEquals(1, count(countRto, orderId, ref), "one row per order, trigger and ref");
        listenerTasks.clear();
        // notify=false writes nothing.
        tx.executeWithoutResult(status -> events.afterCommit(new CommerceOrderEvents.OrderEvent(
                CommerceOrderEvents.ORDER_RTO, inst, orderId, number, ref + "-quiet", false)));
        assertEquals(0, count(countRto, orderId, ref + "-quiet"));
        listenerTasks.clear();
        // Not a real return to sender: the row is removed before any job sees it.
        db.update("DELETE FROM commerce_notification_event WHERE order_id = ? AND trigger_code = 'ORDER_RTO'", orderId);
        noDrift("proof 1");
    }

    // ------------------------------------------------------------------ 2. outbox failure never fails the sale

    @Test
    @Order(3)
    void proof2_aFailedOutboxInsertRollsBackToItsSavepointAndTheOrderChangeCommits() {
        String orderId = paidOrder("en", true, true);
        awaitTasks(1);
        drain();
        String number = text("SELECT order_number FROM commerce_order WHERE id = ?", orderId);
        String note = "proof note " + run;
        List<String> logged = outboxLog(() -> new TransactionTemplate(transactionManager).executeWithoutResult(s -> {
            db.update("UPDATE commerce_order SET customer_note = ? WHERE id = ?", note, orderId);
            // Not in the CHECK list of trigger_code: the insert fails inside the transaction.
            outbox.recordInside(new CommerceOrderEvents.OrderEvent("NOT_A_TRIGGER", inst, orderId, number, null,
                    true));
            // The transaction is still usable after the savepoint rollback.
            assertEquals(note, text("SELECT customer_note FROM commerce_order WHERE id = ?", orderId));
        }));
        assertEquals(note, text("SELECT customer_note FROM commerce_order WHERE id = ?", orderId),
                "the order change committed");
        assertEquals(0, count("SELECT count(*) FROM commerce_notification_event WHERE order_id = ? AND "
                + "trigger_code = 'NOT_A_TRIGGER'", orderId));
        assertTrue(logged.stream().anyMatch(l -> l.startsWith("WARN COMMERCE_NOTIFY outbox insert failed inside the "
                + "transaction") && l.contains("order=" + orderId)), logged.toString());
        // The log line names ids and the type only.
        assertTrue(logged.stream().noneMatch(l -> l.contains("Proof Buyer") || l.contains("@example.com")),
                logged.toString());
        noDrift("proof 2");
    }

    // ------------------------------------------------------------------ 3. gate 1, language

    @Test
    @Order(4)
    void proof3_gate1_hindiAndEnglishOnEmailAndWhatsAppOncePerTrigger() {
        templateStatus = "PENDING";
        String orderId = paidOrder("hi", true, true);
        hiOrder = orderId;
        assertEquals("hi", text("SELECT locale FROM commerce_order WHERE id = ?", orderId));
        awaitTasks(1);
        assertEquals(1, drain(), "one hand-off for the webhook's commit");
        Map<String, Object> o = order(orderId);
        String number = String.valueOf(o.get("order_number"));

        List<Map<String, Object>> confirmed = eventsOf(orderId, "ORDER_CONFIRMED");
        assertEquals(1, confirmed.size());
        assertEquals("PLANNED", confirmed.get(0).get("status"));
        assertEquals("", confirmed.get(0).get("ref_id"));
        Map<String, Object> email = delivery(orderId, "ORDER_CONFIRMED", "EMAIL");
        assertEquals("SENT", email.get("status"));
        assertEquals("hi", email.get("locale"));
        assertNotNull(email.get("sent_at"));
        assertTrue(String.valueOf(email.get("provider_message_id")).startsWith("msg-" + run));
        assertTrue(String.valueOf(email.get("recipient_masked")).endsWith("@example.com"));
        assertEquals(64, String.valueOf(email.get("recipient_hash")).length());
        Map<String, Object> wa = delivery(orderId, "ORDER_CONFIRMED", "WHATSAPP");
        assertEquals("SKIPPED", wa.get("status"));
        assertEquals("TEMPLATE_NOT_APPROVED", wa.get("error_code"));
        assertEquals("commerce_order_confirmed", wa.get("template_name"));

        List<UnifiedSendRequest> mails = calls(orderId);
        assertEquals(1, mails.size(), "one request: the email");
        UnifiedSendRequest mail = mails.get(0);
        assertEquals("EMAIL", mail.getChannel());
        assertEquals(inst, mail.getInstituteId());
        assertEquals(1, mail.getRecipients().size());
        assertEquals(o.get("customer_email"), mail.getRecipients().get(0).getEmail());
        assertTrue(mail.getRecipients().get(0).getEmail().endsWith("@example.com"));
        assertEquals(o.get("user_id"), mail.getRecipients().get(0).getUserId());
        assertNull(mail.getRecipients().get(0).getPhone());
        assertEquals("UTILITY_EMAIL", mail.getOptions().getEmailType());
        assertEquals("COMMERCE_ORDER", mail.getOptions().getSource());
        assertEquals(email.get("id"), mail.getOptions().getSourceId());
        assertNull(mail.getOptions().getFromEmail());
        assertNull(mail.getOptions().getFromName());
        assertNull(mail.getOptions().getCc());
        String subject = mail.getOptions().getEmailSubject();
        String body = mail.getOptions().getEmailBody();
        assertTrue(DEVANAGARI.matcher(subject).find(), "Hindi subject: " + subject);
        assertTrue(DEVANAGARI.matcher(body).find(), "Hindi body");
        assertTrue(body.contains(number), "the order number is in the body");
        assertTrue(body.contains("₹"), "money in rupees");
        assertFalse(subject.contains("{{") || body.contains("{{"), "no placeholder left");
        assertTrue(body.contains("https://" + host + "/order#l=l1."), "the email carries the signed link");

        // A second run of the job sends nothing more.
        int before = sent.size();
        job.runOnce();
        assertEquals(before, sent.size());

        // Templates approved; the order ships: WhatsApp in Hindi with the named variables.
        templateStatus = "APPROVED";
        String shipment = ship(orderId);
        awaitTasks(1);
        drain();
        List<Map<String, Object>> shippedEvents = eventsOf(orderId, "ORDER_SHIPPED");
        assertEquals(1, shippedEvents.size());
        assertEquals(shipment, shippedEvents.get(0).get("ref_id"), "the shipment is the ref");
        List<UnifiedSendRequest> was = calls(orderId, "ORDER_SHIPPED", "WHATSAPP");
        assertEquals(1, was.size());
        UnifiedSendRequest w = was.get(0);
        assertEquals("WHATSAPP", w.getChannel());
        assertEquals("commerce_order_shipped", w.getTemplateName());
        assertEquals("hi", w.getLanguageCode());
        assertEquals(1, w.getRecipients().size());
        assertEquals(CommercePhones.normalise(String.valueOf(o.get("customer_phone"))), w.getRecipients().get(0).getPhone());
        assertEquals(o.get("user_id"), w.getRecipients().get(0).getUserId());
        assertNull(w.getRecipients().get(0).getEmail());
        Map<String, String> vars = w.getRecipients().get(0).getVariables();
        assertEquals(new HashSet<>(CommerceNotificationTrigger.ORDER_SHIPPED.variables()), vars.keySet());
        assertEquals(number, vars.get("order_number"));
        assertEquals("India Post", vars.get("courier"));
        assertEquals("₹0", vars.get("amount_due"), "prepaid: nothing to pay the courier");
        assertEquals("Proof Buyer", vars.get("customer_name"));
        assertEquals("Notify Proof " + run, vars.get("shop_name"));
        assertTrue(vars.get("order_link").startsWith("https://" + host + "/order#l=l1."), vars.get("order_link"));
        vars.values().forEach(v -> assertFalse(v.contains("{{") || v.contains("\n"), v));
        assertEquals("COMMERCE_ORDER", w.getOptions().getSource());
        assertEquals("COMMERCE", w.getOptions().getOriginType());
        assertEquals("ORDER_SHIPPED", w.getOptions().getOriginName());
        assertEquals(delivery(orderId, "ORDER_SHIPPED", "WHATSAPP").get("id"), w.getOptions().getSourceId());
        assertEquals("SENT", delivery(orderId, "ORDER_SHIPPED", "WHATSAPP").get("status"));
        assertEquals("SENT", delivery(orderId, "ORDER_SHIPPED", "EMAIL").get("status"));
        UnifiedSendRequest shippedMail = calls(orderId, "ORDER_SHIPPED", "EMAIL").get(0);
        assertTrue(DEVANAGARI.matcher(shippedMail.getOptions().getEmailSubject()).find());
        hiShippedLink = vars.get("order_link");

        before = sent.size();
        job.runOnce();
        assertEquals(before, sent.size(), "a second job run sends nothing");
        assertEquals(3, calls(orderId).size(), "confirmed email, shipped WhatsApp and email: once each");

        // The same with an English order: English on both channels.
        String en = paidOrder("en", true, true);
        awaitTasks(1);
        drain();
        String enNumber = text("SELECT order_number FROM commerce_order WHERE id = ?", en);
        UnifiedSendRequest enWa = calls(en, "ORDER_CONFIRMED", "WHATSAPP").get(0);
        assertEquals("en", enWa.getLanguageCode());
        assertEquals("commerce_order_confirmed", enWa.getTemplateName());
        assertEquals(new HashSet<>(CommerceNotificationTrigger.ORDER_CONFIRMED.variables()),
                enWa.getRecipients().get(0).getVariables().keySet());
        enWa.getRecipients().get(0).getVariables().values().forEach(v -> assertFalse(DEVANAGARI.matcher(v).find(), v));
        UnifiedSendRequest enMail = calls(en, "ORDER_CONFIRMED", "EMAIL").get(0);
        assertFalse(DEVANAGARI.matcher(enMail.getOptions().getEmailSubject()).find());
        assertFalse(DEVANAGARI.matcher(enMail.getOptions().getEmailBody()).find());
        assertTrue(enMail.getOptions().getEmailBody().contains(enNumber));
        assertEquals("en", delivery(en, "ORDER_CONFIRMED", "EMAIL").get("locale"));
        assertEquals(2, calls(en).size());
        before = sent.size();
        job.runOnce();
        assertEquals(before, sent.size());
        noDrift("proof 3");
    }

    // ------------------------------------------------------------------ 4. gate 1, link

    @Test
    @Order(5)
    void proof4_gate1_theMessageLinkOpensTheOrderOverHttpAndExpiredRevokedAndForeignLinksDoNot() throws Exception {
        assertNotNull(hiShippedLink, "proof 3 ran");
        String token = hiShippedLink.substring(hiShippedLink.indexOf("#l=") + 3);
        assertTrue(token.matches("l1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+") && token.length() <= 200, token);

        HttpResponse<String> opened = exchange(keyA, token);
        assertEquals(200, opened.statusCode(), opened.body());
        assertEquals("no-store", opened.headers().firstValue("Cache-Control").orElse(null));
        JsonNode answer = json(opened.body());
        String accessToken = answer.path("order_access_token").asText();
        assertTrue(accessToken.startsWith("v1."), "a short order token");
        Instant expires = Instant.parse(answer.path("order_access_token_expires_at").asText());
        assertTrue(expires.isBefore(Instant.now().plusSeconds(24 * 3600 + 60)), "at most 24 hours");
        assertTrue(answer.path("phone_verified").asBoolean());

        HttpResponse<String> shown = view(keyA, accessToken);
        assertEquals(200, shown.statusCode(), shown.body());
        JsonNode viewed = json(shown.body());
        assertEquals(hiOrder, viewed.path("order_id").asText());
        assertEquals(text("SELECT order_number FROM commerce_order WHERE id = ?", hiOrder),
                viewed.path("order_number").asText());
        assertEquals("SHIPPED", viewed.path("status").asText());

        // Shop A's link with shop B's key: 403.
        HttpResponse<String> foreign = exchange(keyB, token);
        assertEquals(403, foreign.statusCode(), foreign.body());
        assertTrue(foreign.body().contains("\"link_invalid\""), foreign.body());

        // A link minted with an end in the past: 410.
        java.lang.reflect.Method issue = CommerceOrderLinkTokens.class.getDeclaredMethod("issue", String.class,
                String.class, int.class, String.class, Instant.class);
        issue.setAccessible(true);
        String expired = (String) issue.invoke(linkTokens, inst, hiOrder, 0, "OS", Instant.now().minusSeconds(60));
        HttpResponse<String> gone = exchange(keyA, expired);
        assertEquals(410, gone.statusCode(), gone.body());
        assertTrue(gone.body().contains("\"link_expired\""), gone.body());

        // Revoked: the link of the message stops working; a link minted after the revoke works.
        Map<String, Object> revoked = linkService.revoke(admin, inst, hiOrder);
        assertEquals(1, revoked.get("link_epoch"));
        assertEquals(1, count("SELECT link_epoch FROM commerce_order WHERE id = ?", hiOrder));
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND reference_id = ? AND "
                + "kind = 'ORDER_LINKS_REVOKED'", inst, hiOrder));
        HttpResponse<String> afterRevoke = exchange(keyA, token);
        assertEquals(403, afterRevoke.statusCode(), afterRevoke.body());
        assertTrue(afterRevoke.body().contains("\"link_invalid\""), afterRevoke.body());
        String fresh = linkTokens.issue(inst, hiOrder, 1, "OS", java.time.Duration.ofDays(14));
        assertEquals(200, exchange(keyA, fresh).statusCode());
        // The short token taken before the revoke still opens the order (at most 24 h, by design).
        assertEquals(200, view(keyA, accessToken).statusCode());
        // A broken MAC: the same answer as every unusable link.
        String broken = token.substring(0, token.length() - 2) + (token.endsWith("AA") ? "BB" : "AA");
        HttpResponse<String> bad = exchange(keyA, broken);
        assertEquals(403, bad.statusCode());
        assertTrue(bad.body().contains("\"link_invalid\""), bad.body());
        // Nothing of the token in the error answers.
        assertFalse(foreign.body().contains(token) || gone.body().contains(expired) || bad.body().contains(broken));
        noDrift("proof 4");
    }

    // ------------------------------------------------------------------ 5. one send under a race

    @Test
    @Order(6)
    void proof5_twoSendersOnOneDueDeliveryBehindARowLock_exactlyOneCall() {
        templateStatus = "APPROVED";
        String orderId = paidOrder("en", true, true);
        awaitTasks(1);
        listenerTasks.clear(); // not dispatched: the event is planned by hand below
        String event = eventId(orderId, "ORDER_CONFIRMED");
        assertEquals("PLANNED", dispatcher.plan(store.findEvent(event)));
        String id = String.valueOf(delivery(orderId, "ORDER_CONFIRMED", "EMAIL").get("id"));
        assertEquals("PENDING", text("SELECT status FROM commerce_notification_delivery WHERE id = ?", id));
        int before = calls(orderId).size();
        assertEquals(0, before);

        List<Object> results = behindRowLock("commerce_notification_delivery", id, List.of(
                () -> dispatcher.send(id), () -> dispatcher.send(id)));
        assertTrue(results.contains(CommerceNotificationDispatcher.Result.SENT), results.toString());
        assertTrue(results.contains(CommerceNotificationDispatcher.Result.NOT_CLAIMED), results.toString());
        List<UnifiedSendRequest> emailCalls = calls(orderId, "ORDER_CONFIRMED", "EMAIL");
        assertEquals(1, emailCalls.size(), "exactly one sendUnified call");
        assertEquals(id, emailCalls.get(0).getOptions().getSourceId());
        Map<String, Object> row = delivery(orderId, "ORDER_CONFIRMED", "EMAIL");
        assertEquals("SENT", row.get("status"));
        assertEquals(1, ((Number) row.get("attempts")).intValue(), "claimed once");
        // The rest of the order's messages, then nothing more.
        job.runOnce();
        assertEquals(2, calls(orderId).size());
        job.runOnce();
        assertEquals(2, calls(orderId).size());
        noDrift("proof 5");
    }

    // ------------------------------------------------------------------ 6. commerce off

    @Test
    @Order(7)
    void proof6_anEventOfAShopWithCommerceOffIsSkippedForGoodAndNothingIsSent() {
        templateStatus = "APPROVED";
        String orderId = paidOrder("en", true, true);
        awaitTasks(1);
        drain();
        int callsBefore = calls(orderId).size();
        ship(orderId);
        awaitTasks(1);
        Runnable heldBack = listenerTasks.poll();
        assertNotNull(heldBack);
        String event = eventId(orderId, "ORDER_SHIPPED");
        assertEquals("PENDING", text("SELECT status FROM commerce_notification_event WHERE id = ?", event));

        db.update("UPDATE institute_module_entitlement SET enabled = false WHERE institute_id = ? AND key = 'commerce'",
                inst);
        capabilityResolver.evict(inst);
        try {
            job.runOnce();
            assertEquals("SKIPPED", text("SELECT status FROM commerce_notification_event WHERE id = ?", event));
            assertEquals("COMMERCE_OFF", text("SELECT skip_reason FROM commerce_notification_event WHERE id = ?", event));
            assertEquals(0, count("SELECT count(*) FROM commerce_notification_delivery WHERE event_id = ?", event));
            assertEquals(callsBefore, calls(orderId).size(), "zero calls");
        } finally {
            db.update("UPDATE institute_module_entitlement SET enabled = true WHERE institute_id = ? AND key = "
                    + "'commerce'", inst);
            capabilityResolver.evict(inst);
        }
        // On again: the held-back after-commit task and two job runs send nothing for that event.
        heldBack.run();
        job.runOnce();
        job.runOnce();
        assertEquals("SKIPPED", text("SELECT status FROM commerce_notification_event WHERE id = ?", event));
        assertEquals(0, count("SELECT count(*) FROM commerce_notification_delivery WHERE event_id = ?", event));
        assertEquals(callsBefore, calls(orderId).size(), "never sent later");

        // Planned while commerce was on, switched off before the send: every planned message ends
        // SKIPPED COMMERCE_OFF at send time, and nothing goes out when it is turned on again.
        String second = paidOrder("en", true, true);
        awaitTasks(1);
        drain();
        int secondBefore = calls(second).size();
        ship(second);
        awaitTasks(1);
        Runnable later = listenerTasks.poll();
        assertNotNull(later);
        String shipped = eventId(second, "ORDER_SHIPPED");
        assertEquals("PLANNED", dispatcher.plan(store.findEvent(shipped)));
        assertEquals(2, count("SELECT count(*) FROM commerce_notification_delivery WHERE event_id = ? "
                + "AND status = 'PENDING'", shipped));
        db.update("UPDATE institute_module_entitlement SET enabled = false WHERE institute_id = ? AND key = 'commerce'",
                inst);
        capabilityResolver.evict(inst);
        try {
            job.runOnce();
            assertEquals(2, count("SELECT count(*) FROM commerce_notification_delivery WHERE event_id = ? "
                    + "AND status = 'SKIPPED' AND error_code = 'COMMERCE_OFF'", shipped));
            assertEquals(secondBefore, calls(second).size(), "zero calls at send time");
        } finally {
            db.update("UPDATE institute_module_entitlement SET enabled = true WHERE institute_id = ? AND key = "
                    + "'commerce'", inst);
            capabilityResolver.evict(inst);
        }
        later.run();
        job.runOnce();
        assertEquals(2, count("SELECT count(*) FROM commerce_notification_delivery WHERE event_id = ? "
                + "AND status = 'SKIPPED' AND error_code = 'COMMERCE_OFF'", shipped));
        assertEquals(secondBefore, calls(second).size(), "never sent later");
        noDrift("proof 6");
    }

    // ------------------------------------------------------------------ 7. two refunds, two messages

    @Test
    @Order(8)
    void proof7_twoProcessedRefundsOfOneOrderAreTwoEventsAndTwoMessagesPerChannel() {
        templateStatus = "APPROVED";
        String orderId = paidOrder("en", true, true);
        awaitTasks(1);
        drain();
        move(orderId, "CONFIRMED", "CANCELLED");
        awaitTasks(1);
        drain();
        assertEquals("SENT", delivery(orderId, "ORDER_CANCELLED", "EMAIL").get("status"));
        BigDecimal paid = db.queryForObject("SELECT amount_paid FROM commerce_order WHERE id = ?", BigDecimal.class,
                orderId);
        BigDecimal half = paid.divide(new BigDecimal("2"), 2, RoundingMode.DOWN);
        RefundDtos.RefundView first = refunds.create(admin, inst, RefundDtos.CreateRefundRequest.builder()
                .clientRequestId(key()).orderId(orderId).amount(half).method("BANK_TRANSFER").reference("UTR" + run)
                .reason("proof refund").build());
        assertEquals("PROCESSED", first.getStatus());
        awaitTasks(1);
        drain();
        RefundDtos.RefundView second = refunds.create(admin, inst, RefundDtos.CreateRefundRequest.builder()
                .clientRequestId(key()).orderId(orderId).amount(paid.subtract(half)).method("UPI")
                .reference("UPI" + run).reason("proof refund").build());
        assertEquals("PROCESSED", second.getStatus());
        awaitTasks(1);
        drain();
        List<Map<String, Object>> refundEvents = eventsOf(orderId, "REFUND_PROCESSED");
        assertEquals(2, refundEvents.size());
        assertEquals(Set.of(first.getId(), second.getId()),
                Set.of(refundEvents.get(0).get("ref_id"), refundEvents.get(1).get("ref_id")), "refs are the refund ids");
        assertEquals(2, count("SELECT count(*) FROM commerce_notification_delivery WHERE order_id = ? AND trigger_code "
                + "= 'REFUND_PROCESSED' AND channel = 'EMAIL' AND status = 'SENT'", orderId));
        assertEquals(2, count("SELECT count(*) FROM commerce_notification_delivery WHERE order_id = ? AND trigger_code "
                + "= 'REFUND_PROCESSED' AND channel = 'WHATSAPP' AND status = 'SENT'", orderId));
        List<UnifiedSendRequest> refundMails = calls(orderId, "REFUND_PROCESSED", "EMAIL");
        assertEquals(2, refundMails.size());
        assertTrue(refundMails.stream().anyMatch(r -> r.getOptions().getEmailBody().contains("UTR" + run)),
                "the bank reference is in its email");
        List<UnifiedSendRequest> refundWas = calls(orderId, "REFUND_PROCESSED", "WHATSAPP");
        assertEquals(2, refundWas.size());
        assertEquals(Set.of("commerce_refund_processed"),
                Set.copyOf(refundWas.stream().map(UnifiedSendRequest::getTemplateName).toList()));
        int before = sent.size();
        job.runOnce();
        assertEquals(before, sent.size());
        noDrift("proof 7");
    }

    // ------------------------------------------------------------------ 8. phone-only buyer

    @Test
    @Order(9)
    void proof8_aPhoneOnlyBuyerGetsNoEmailAndNoRequestNamesAnInvalidAddress() {
        templateStatus = "APPROVED";
        settings("{\"buyer_identity\": \"PHONE_OTP\"}");
        String orderId;
        try {
            int accounts = accountEmails.size();
            orderId = paidOrder("hi", true, false);
            assertTrue(accountEmails.size() > accounts && accountEmails.get(accountEmails.size() - 1)
                    .endsWith("@buyer.invalid"), "the buyer is the holder account of the phone");
        } finally {
            settings("{\"buyer_identity\": \"EITHER\"}");
        }
        assertNull(order(orderId).get("customer_email"), "no typed address");
        awaitTasks(1);
        drain();
        Map<String, Object> email = delivery(orderId, "ORDER_CONFIRMED", "EMAIL");
        assertEquals("SKIPPED", email.get("status"));
        assertEquals("NO_EMAIL", email.get("error_code"));
        assertEquals("SENT", delivery(orderId, "ORDER_CONFIRMED", "WHATSAPP").get("status"), "WhatsApp carries it");
        assertEquals(1, calls(orderId).size());
        synchronized (sent) {
            for (UnifiedSendRequest r : sent) {
                for (UnifiedSendRequest.Recipient to : r.getRecipients()) {
                    assertFalse(to.getEmail() != null && to.getEmail().toLowerCase().endsWith(".invalid"),
                            "a request named an undeliverable address");
                }
            }
        }
        noDrift("proof 8");
    }

    // ------------------------------------------------------------------ 9. lost claim

    @Test
    @Order(10)
    void proof9_aDeliveryLeftSendingForElevenMinutesBecomesUnknownAndIsNeverSent() {
        templateStatus = "APPROVED";
        String orderId = paidOrder("en", true, true);
        awaitTasks(1);
        listenerTasks.clear();
        String event = eventId(orderId, "ORDER_CONFIRMED");
        assertEquals("PLANNED", dispatcher.plan(store.findEvent(event)));
        // As a pod that died during the call leaves them: SENDING, claimed 11 and 9 minutes ago.
        db.update("UPDATE commerce_notification_delivery SET status = 'SENDING', attempts = 1, "
                + "claimed_at = now() - interval '11 minutes' WHERE event_id = ? AND channel = 'EMAIL'", event);
        db.update("UPDATE commerce_notification_delivery SET status = 'SENDING', attempts = 1, "
                + "claimed_at = now() - interval '9 minutes' WHERE event_id = ? AND channel = 'WHATSAPP'", event);
        Map<String, Integer> counts = job.runOnce();
        assertEquals(1, counts.get("claims_lost"), String.valueOf(counts));
        Map<String, Object> lost = delivery(orderId, "ORDER_CONFIRMED", "EMAIL");
        assertEquals("UNKNOWN", lost.get("status"));
        assertEquals("CLAIM_LOST", lost.get("error_code"));
        assertEquals("SENDING", delivery(orderId, "ORDER_CONFIRMED", "WHATSAPP").get("status"),
                "under ten minutes: left alone");
        assertEquals(0, calls(orderId).size(), "no call");
        db.update("UPDATE commerce_notification_delivery SET claimed_at = now() - interval '11 minutes' "
                + "WHERE event_id = ? AND channel = 'WHATSAPP'", event);
        assertEquals(1, dispatcher.reapLostClaims(100));
        assertEquals("UNKNOWN", delivery(orderId, "ORDER_CONFIRMED", "WHATSAPP").get("status"));
        job.runOnce();
        assertEquals(0, calls(orderId).size(), "never resent");
        noDrift("proof 9");
    }

    // ------------------------------------------------------------------ 10. workflow stands in

    @Test
    @Order(11)
    void proof10_anActiveWorkflowOfTheTriggerReplacesBothChannels() {
        templateStatus = "APPROVED";
        // The institute's workflow for ORDER_DELIVERED is ACTIVE (the engine is a mock here).
        when(workflowTriggerService.hasActiveWorkflow(eq("ORDER_DELIVERED"), anyString(), eq(inst))).thenReturn(true);
        String orderId = paidOrder("en", true, true);
        awaitTasks(1);
        drain();
        String shipment = ship(orderId);
        awaitTasks(1);
        drain();
        delivered(orderId);
        awaitTasks(1);
        drain();
        String event = eventId(orderId, "ORDER_DELIVERED");
        List<Map<String, Object>> rows = db.queryForList("SELECT channel, status FROM commerce_notification_delivery "
                + "WHERE event_id = ?", event);
        assertEquals(1, rows.size(), rows.toString());
        assertEquals("WORKFLOW", rows.get(0).get("channel"));
        assertEquals("SENT", rows.get(0).get("status"));
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> context = ArgumentCaptor.forClass(Map.class);
        verify(workflowTriggerService, times(1)).handleTriggerEvents(eq("ORDER_DELIVERED"), eq(orderId), eq(inst),
                context.capture());
        Map<String, Object> ctx = context.getValue();
        assertEquals(Set.of("orderId", "orderNumber", "trigger", "locale", "customerName", "customerPhone",
                "customerEmail", "userId", "orderTotal", "orderLink", "shopName", "shipmentId"), ctx.keySet());
        assertEquals(orderId, ctx.get("orderId"));
        assertEquals("ORDER_DELIVERED", ctx.get("trigger"));
        assertEquals(shipment, ctx.get("shipmentId"));
        assertTrue(String.valueOf(ctx.get("orderLink")).startsWith("https://" + host + "/order#l=l1."));
        assertEquals(0, calls(orderId, "ORDER_DELIVERED", "EMAIL").size() + calls(orderId, "ORDER_DELIVERED",
                "WHATSAPP").size(), "no default message");
        // The shipped message (no workflow) went the default way.
        assertEquals("SENT", delivery(orderId, "ORDER_SHIPPED", "EMAIL").get("status"));
        verify(workflowTriggerService, never()).handleTriggerEvents(eq("ORDER_SHIPPED"), anyString(), anyString(),
                anyMap());
        job.runOnce();
        verify(workflowTriggerService, times(1)).handleTriggerEvents(eq("ORDER_DELIVERED"), eq(orderId), eq(inst),
                anyMap());
        noDrift("proof 10");
    }

    // ------------------------------------------------------------------ 11. COD

    @Test
    @Order(12)
    void proof11_cod_aConfirmationRequestPlannedThenConfirmedByStaffIsStaleAndTheConfirmationGoesOut() {
        templateStatus = "APPROVED";
        // (a) placed, its event planned, then staff confirm before the deliveries are sent.
        String orderId = codOrder(Map.of(big, 1));
        assertEquals("COD_PENDING_CONFIRMATION", status(orderId));
        awaitTasks(1);
        listenerTasks.clear();
        String event = eventId(orderId, "COD_CONFIRMATION_NEEDED");
        assertEquals("PLANNED", dispatcher.plan(store.findEvent(event)));
        assertEquals(2, count("SELECT count(*) FROM commerce_notification_delivery WHERE event_id = ? AND status = "
                + "'PENDING'", event));
        move(orderId, "COD_PENDING_CONFIRMATION", "CONFIRMED");
        assertEquals("CONFIRMED", status(orderId));
        awaitTasks(1);
        listenerTasks.clear();
        job.runOnce();
        for (String channel : List.of("EMAIL", "WHATSAPP")) {
            Map<String, Object> stale = delivery(orderId, "COD_CONFIRMATION_NEEDED", channel);
            assertEquals("SKIPPED", stale.get("status"), channel);
            assertEquals("STALE", stale.get("error_code"), channel);
            assertEquals("SENT", delivery(orderId, "ORDER_CONFIRMED", channel).get("status"), channel);
        }
        assertEquals(0, calls(orderId, "COD_CONFIRMATION_NEEDED", "EMAIL").size()
                + calls(orderId, "COD_CONFIRMATION_NEEDED", "WHATSAPP").size(), "no stale request");
        assertEquals(2, calls(orderId).size(), "the confirmation, once per channel");

        // (b) confirmed before the job ever planned the event: the event itself is STALE.
        String later = codOrder(Map.of(big, 1));
        awaitTasks(1);
        listenerTasks.clear();
        move(later, "COD_PENDING_CONFIRMATION", "CONFIRMED");
        awaitTasks(1);
        listenerTasks.clear();
        job.runOnce();
        String laterEvent = eventId(later, "COD_CONFIRMATION_NEEDED");
        assertEquals("SKIPPED", text("SELECT status FROM commerce_notification_event WHERE id = ?", laterEvent));
        assertEquals("STALE", text("SELECT skip_reason FROM commerce_notification_event WHERE id = ?", laterEvent));
        assertEquals(0, count("SELECT count(*) FROM commerce_notification_delivery WHERE event_id = ?", laterEvent));
        assertEquals(2, calls(later).size());
        assertEquals("SENT", delivery(later, "ORDER_CONFIRMED", "EMAIL").get("status"));

        // (c) a COD order that still waits for the call: the request goes out.
        String waiting = codOrder(Map.of(big, 1));
        awaitTasks(1);
        drain();
        assertEquals("SENT", delivery(waiting, "COD_CONFIRMATION_NEEDED", "EMAIL").get("status"));
        assertEquals("SENT", delivery(waiting, "COD_CONFIRMATION_NEEDED", "WHATSAPP").get("status"));
        noDrift("proof 11");
    }

    // ------------------------------------------------------------------ 12. V721 + the whole run

    @Test
    @Order(13)
    void proof12_v721RanAndNoRequestWasMadeInsideATransactionOrToAnInvalidAddress() {
        assertEquals(1, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version = '721' AND "
                + "script = 'V721__Commerce_order_notifications.sql'"));
        assertEquals(3, count("SELECT count(*) FROM pg_tables WHERE tablename IN ('commerce_notification_setting', "
                + "'commerce_notification_event', 'commerce_notification_delivery')"));
        assertEquals(1, count("SELECT count(*) FROM information_schema.columns WHERE table_name = 'commerce_order' "
                + "AND column_name = 'link_epoch'"));
        assertEquals(0, sentInsideTransaction.get(), "the send API is never called inside a transaction");
        assertFalse(sent.isEmpty());
        synchronized (sent) {
            for (UnifiedSendRequest r : sent) {
                assertEquals("COMMERCE_ORDER", r.getOptions().getSource());
                assertEquals(1, r.getRecipients().size());
                for (UnifiedSendRequest.Recipient to : r.getRecipients()) {
                    assertFalse(to.getEmail() != null && to.getEmail().toLowerCase().endsWith(".invalid"));
                }
            }
        }
        assertEquals(0, count("SELECT count(*) FROM commerce_notification_delivery WHERE institute_id = ? AND "
                + "(recipient_masked LIKE '%Proof%' OR error_detail IS NOT NULL)", inst));
        assertEquals(0, count("SELECT count(*) FROM commerce_notification_delivery WHERE institute_id = ? AND status "
                + "IN ('PENDING', 'SENDING')", inst), "nothing left half-way");
        noDrift("end");
    }
}
