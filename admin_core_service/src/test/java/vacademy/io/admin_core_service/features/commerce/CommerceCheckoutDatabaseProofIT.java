package vacademy.io.admin_core_service.features.commerce;

import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.AdminCoreServiceApplication;
import vacademy.io.admin_core_service.features.auth_service.service.AsyncEnrollmentEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionClient;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CheckoutException;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceCheckoutService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderPaymentService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderQueryService;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaidOrderReconcileJob;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLocationService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockReceiptService;
import vacademy.io.admin_core_service.features.commerce.storefront.redirect.SiteRedirectResolver;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxClassDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxRateRuleDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxSettingDTO;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxClassService;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkAddCourseRequestDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkAddCourseResponseDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCourseBatchDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCourseInventoryConfigDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCourseItemDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCoursePaymentConfigDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCourseResultDTO;
import vacademy.io.admin_core_service.features.course.service.BulkCourseService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.payments.manager.RazorpayPaymentManager;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Database-backed proof of checkout (WP-12) on a local Postgres with the real Flyway chain and
 * the real Spring context: the direct write of plans, payment logs and stock holds, the
 * idempotent place-order, two shoppers and one piece, the confirm step and its replay, the
 * expiry, and both late-payment branches. Same pattern as {@link CommerceM1DatabaseProofIT}:
 * skipped unless {@code COMMERCE_IT_PG_URL} names a database on this machine.
 *
 * <p>Nothing leaves the machine. The auth service is a mock. The gateway is stubbed at its one
 * remote call, {@code RazorpayPaymentManager.initiatePayment} (the Razorpay order create), so
 * the real {@code RazorpayCommercePaymentGateway} behind {@code CommercePaymentGateway} runs:
 * its "no transaction is open" check and its {@code commerce_gateway_order} row are part of the
 * proof. A payment arrives as it does in production: a payload signed with the institute's
 * webhook secret, posted over HTTP to this application's own port
 * ({@code /admin-core-service/payments/webhook/callback/razorpay}), through the real
 * {@code RazorpayWebHookService}. A few early tests still mark the logs PAID in SQL to drive
 * the order code alone. Every tax rate below is a TEST placeholder.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CommerceCheckoutDatabaseProofIT {

    private static final String SELLER_GSTIN = "09AAACH7409R1ZZ";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        registry.add("commerce.order-token.secret", () -> "local-proof-only-not-a-secret");
        // The proof runs without Cloudflare: said on purpose, as a deployment must.
        registry.add("commerce.turnstile.required", () -> "false");
        // Twenty checkouts run at once below; the default pool of the proof (8) is for one thread.
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "40");
        // The lost-webhook fetch is driven by the proof itself, one run at a time.
        registry.add("commerce.payment-fetch.cron", () -> "-");
    }

    static {
        // Belt and braces: a gateway SDK that did try to call out would hit a closed local port.
        System.setProperty("https.proxyHost", "127.0.0.1");
        System.setProperty("https.proxyPort", "9");
        System.setProperty("http.nonProxyHosts", "localhost|127.0.0.1");
    }

    private static final String WEBHOOK_SECRET = "whsec-local-proof-only";
    private static final String KEY_SECRET = "key-secret-local-proof-only";
    private static final String KEY_ID = "rzp_test_localproof";
    private static final String WEBHOOK_PATH = "/admin-core-service/payments/webhook/callback/razorpay";

    @Autowired
    private JdbcTemplate db;
    @Autowired
    private CapabilityResolver capabilityResolver;
    @Autowired
    private CommerceProductService productService;
    @Autowired
    private StockLocationService locationService;
    @Autowired
    private StockReceiptService receiptService;
    @Autowired
    private CommerceTaxSettingService taxSettingService;
    @Autowired
    private CommerceTaxClassService taxClassService;
    @Autowired
    private StorefrontSnapshotLoader snapshotLoader;
    @Autowired
    private CommerceOrderService orderService;
    @Autowired
    private CommerceCheckoutService checkoutService;
    @Autowired
    private CommerceOrderPaymentService paymentService;
    @Autowired
    private CommerceOrderQueryService queryService;
    @Autowired
    private StockHoldService stockHoldService;
    @Autowired
    private CommercePaidOrderReconcileJob reconcileJob;
    @Autowired
    private vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentFetchJob fetchJob;
    @Autowired
    private vacademy.io.admin_core_service.features.commerce.customer.CommerceShopperSessions shopperSessions;
    @Autowired
    private vacademy.io.admin_core_service.features.commerce.order.payment.CommerceGatewayOrderRepository gatewayRows;
    @Autowired
    private SiteRedirectResolver redirectResolver;
    @Autowired
    private BulkCourseService bulkCourseService;
    @Autowired
    private UserPlanService userPlanService;
    @Autowired
    private PaymentLogService paymentLogService;
    @Autowired
    private PaymentPlanRepository paymentPlanRepository;
    @Autowired
    private PaymentOptionRepository paymentOptionRepository;
    @Autowired
    private EnrollInviteRepository enrollInviteRepository;
    @Autowired
    private PlatformTransactionManager transactionManager;
    @Autowired
    private ObjectMapper objectMapper;
    @LocalServerPort
    private int port;

    // Outside services: mocked so nothing leaves this machine.
    @MockBean
    private AuthService authService;
    /** The one remote call of the gateway (the Razorpay order create) is answered here. */
    @SpyBean
    private RazorpayPaymentManager razorpay;
    @MockBean
    private InvoiceService invoiceService;
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
    @MockBean
    private CommerceRenditionClient renditionClient;
    /** The delivery of a shop OTP (a WhatsApp message): the code it was asked to send is read here. */
    @MockBean
    private vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpTransport otpTransport;
    @Autowired
    private vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpService otpService;
    @Autowired
    @org.springframework.beans.factory.annotation.Qualifier("masterDataSource")
    private javax.sql.DataSource masterDataSource;
    private final java.util.concurrent.atomic.AtomicReference<String> lastOtpCode =
            new java.util.concurrent.atomic.AtomicReference<>();

    private final String inst = UUID.randomUUID().toString();
    private final String run = inst.substring(0, 8);
    private final String actor = "admin-" + run;
    private final AtomicInteger users = new AtomicInteger();
    private final AtomicInteger requests = new AtomicInteger();
    private final AtomicInteger phones = new AtomicInteger(100);
    private final AtomicInteger gatewayOrders = new AtomicInteger();
    private final AtomicInteger gatewayCalls = new AtomicInteger();
    private final AtomicInteger gatewayCallsInsideATransaction = new AtomicInteger();
    /** Set by the blocked-gateway test: the next gateway call waits this long. */
    private final AtomicBoolean blockNextGatewayCall = new AtomicBoolean();
    private volatile CountDownLatch gatewayEntered = new CountDownLatch(1);
    private static final long GATEWAY_BLOCK_MILLIS = 20_000L;
    private Path evidence;

    private String wh;
    private String onePiece;   // 1 in stock, 800.00
    private String plenty;     // 50 in stock, 1500.00
    private String scarce;     // 1 in stock, 600.00: the late-payment variant
    private String flowA;      // 10 in stock, 700.00: the webhook flow
    private String flowB;      // 10 in stock, 450.00
    private String bulk;       // 200 in stock, 300.00: the parallel checkouts
    private static final int RACE_ROUNDS = 5;
    private final List<String> racePieces = new ArrayList<>();   // 1 in stock each
    private String couponCode;

    private CheckoutDtos.Placed first;

    @BeforeEach
    void outsideServicesAnswerLocally() {
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), anyString(), anyBoolean()))
                .thenAnswer(call -> {
                    UserDTO asked = call.getArgument(0);
                    assertTrue(asked.getRoles() == null || asked.getRoles().isEmpty(),
                            "a shop buyer is created with no role");
                    assertFalse((Boolean) call.getArgument(2), "no credentials mail for a shop buyer");
                    UserDTO user = new UserDTO();
                    user.setId("buyer-" + run + "-" + users.incrementAndGet());
                    return user;
                });
        when(authService.getUsersFromAuthServiceWithPasswordByUserId(anyString())).thenAnswer(call -> {
            UserDTO user = new UserDTO();
            user.setId(call.getArgument(0));
            user.setEmail(call.getArgument(0) + "@example.invalid");
            user.setFullName("Proof Learner");
            return user;
        });
        when(authService.getUsersFromAuthServiceByUserIds(org.mockito.ArgumentMatchers.anyList())).thenAnswer(call -> {
            List<UserDTO> found = new ArrayList<>();
            for (Object id : (List<?>) call.getArgument(0)) {
                UserDTO user = new UserDTO();
                user.setId(String.valueOf(id));
                user.setEmail(id + "@example.invalid");
                user.setFullName("Proof Learner");
                found.add(user);
            }
            return found;
        });
        // What Razorpay answers to an order create, without the network.
        doAnswer(call -> {
            gatewayCalls.incrementAndGet();
            if (org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()) {
                gatewayCallsInsideATransaction.incrementAndGet();
            }
            if (blockNextGatewayCall.compareAndSet(true, false)) {
                gatewayEntered.countDown();
                Thread.sleep(GATEWAY_BLOCK_MILLIS);
            }
            PaymentInitiationRequestDTO asked = call.getArgument(1);
            assertEquals(inst, asked.getInstituteId(), "the institute is set on the gateway request");
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
        doAnswer(call -> {
            lastOtpCode.set(call.getArgument(2));
            return null;
        }).when(otpTransport).send(anyString(), anyString(), anyString());
        // The lost-webhook fetch never reaches Razorpay: no payment, unless a test says otherwise.
        doReturn(List.of()).when(razorpay).fetchOrderPayments(any(), any());
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", inst);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @BeforeAll
    void openEvidence() throws IOException {
        String path = System.getenv("COMMERCE_IT_EVIDENCE_CHECKOUT");
        if (path != null && !path.isBlank()) {
            evidence = Path.of(path);
            Files.writeString(evidence, "WP-12 checkout database proof, run " + run + ", institute " + inst + "\n");
        }
    }

    @AfterAll
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    private void note(String line) {
        if (evidence == null) {
            return;
        }
        try {
            Files.writeString(evidence, line + "\n", StandardOpenOption.APPEND);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    // ------------------------------------------------------------------ helpers

    private String nextPhone() {
        return "98765" + String.format("%05d", phones.incrementAndGet());
    }

    private static String stored(String phone) {
        return "91" + phone;
    }

    private String orderIdOf(String phone) {
        return text("SELECT id FROM commerce_order WHERE institute_id = ? AND customer_phone = ?", inst, stored(phone));
    }

    private Map<String, Object> gatewayRow(String orderId) {
        return db.queryForMap("SELECT * FROM commerce_gateway_order WHERE commerce_order_id = ? ORDER BY created_at "
                + "DESC LIMIT 1", orderId);
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

    /** A Razorpay event as the gateway sends it. {@code amountMinor} null leaves the amount out. */
    private String event(String type, String gatewayOrderId, String paymentId, Long amountMinor, String noteOrderId) {
        Map<String, Object> notes = new LinkedHashMap<>();
        notes.put("orderId", noteOrderId);
        notes.put("instituteId", inst);
        notes.put("payment_type", "INITIAL");
        Map<String, Object> entity = new LinkedHashMap<>();
        entity.put("id", paymentId);
        entity.put("entity", "payment");
        entity.put("order_id", gatewayOrderId);
        if (amountMinor != null) {
            entity.put("amount", amountMinor);
        }
        entity.put("currency", "INR");
        entity.put("status", type.equals("payment.failed") ? "failed" : "captured");
        entity.put("notes", notes);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("entity", "event");
        root.put("event", type);
        root.put("payload", Map.of("payment", Map.of("entity", entity)));
        try {
            return objectMapper.writeValueAsString(root);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** One real HTTP POST to the Razorpay webhook route of this application. */
    private HttpResponse<String> postWebhook(String payload, String signature) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + WEBHOOK_PATH))
                    .header("Content-Type", "application/json")
                    .header("X-Razorpay-Signature", signature)
                    .POST(HttpRequest.BodyPublishers.ofString(payload)).build();
            HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
            note("   webhook -> " + response.statusCode() + " " + response.body());
            return response;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    /** The captured event of the order's own gateway order and total, correctly signed. */
    private HttpResponse<String> payByWebhook(String orderId) {
        Map<String, Object> row = gatewayRow(orderId);
        String payload = event("payment.captured", String.valueOf(row.get("gateway_order_id")),
                "pay_" + UUID.randomUUID().toString().substring(0, 14), ((Number) row.get("amount_minor")).longValue(),
                orderId);
        return postWebhook(payload, hmacHex(WEBHOOK_SECRET, payload));
    }

    private long calls(Object mock) {
        return mockingDetails(mock).getInvocations().size();
    }

    /** Runs the tasks at the same moment on their own threads; an exception is the task's result. */
    private List<Object> atOnce(List<Callable<Object>> tasks) {
        ExecutorService pool = Executors.newFixedThreadPool(tasks.size());
        CountDownLatch ready = new CountDownLatch(tasks.size());
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Object>> futures = new ArrayList<>();
        for (Callable<Object> task : tasks) {
            futures.add(pool.submit(() -> {
                MockHttpServletRequest request = new MockHttpServletRequest();
                request.addHeader("clientId", inst);
                RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
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

    private long count(String query, Object... args) {
        Long n = db.queryForObject(query, Long.class, args);
        return n == null ? 0 : n;
    }

    private int slots(String packageSessionId) {
        Integer n = db.queryForObject("SELECT available_slots FROM package_session WHERE id = ?", Integer.class,
                packageSessionId);
        return n == null ? -1 : n;
    }

    private String text(String query, Object... args) {
        return db.queryForObject(query, String.class, args);
    }

    private String variant(String slug, String sku, String price) {
        ProductRequest request = ProductRequest.builder().slug(slug + "-" + run)
                .translations(List.of(ProductTranslationDTO.builder().locale("hi").name(slug + " " + run).build(),
                        ProductTranslationDTO.builder().locale("en").name(slug + " " + run).build()))
                .taxClassId(taxClass).status("ACTIVE")
                .variants(List.of(VariantRequest.builder().sku(sku + "-" + run).name("One size")
                        .price(new BigDecimal(price)).weightGrams(200).build()))
                .build();
        return productService.save(inst, actor, request).getVariants().get(0).getPackageSessionId();
    }

    private String taxClass;

    private void receive(String packageSessionId, int quantity) {
        ReceiptRequest request = new ReceiptRequest();
        request.setLocationId(wh);
        request.setSourceKind("OTHER");
        request.setNote("proof stock");
        request.setClientRequestId("co-" + packageSessionId);
        ReceiptRequest.Line line = new ReceiptRequest.Line();
        line.setPackageSessionId(packageSessionId);
        line.setQuantity(quantity);
        line.setUnitCost(new BigDecimal("100.00"));
        request.setLines(List.of(line));
        receiptService.create(inst, actor, true, request);
    }

    private CheckoutRequest request(String phone, Map<String, Integer> quantities) {
        return request(phone, quantities, null);
    }

    private CheckoutRequest request(String phone, Map<String, Integer> quantities, String couponCode) {
        List<CartPriceRequest.Line> lines = new ArrayList<>();
        quantities.forEach((variantId, quantity) -> lines.add(CartPriceRequest.Line.builder().variantId(variantId)
                .quantity(quantity).build()));
        // What a cart page does: price first, then send the total it showed.
        BigDecimal total = orderService.priceCart(inst, CartPriceRequest.builder().lines(lines).pincode("226001")
                .couponCode(couponCode).build()).snapshot().getTotal();
        return CheckoutRequest.builder()
                .clientRequestId("proof-" + run + "-" + requests.incrementAndGet())
                .lines(lines)
                .couponCode(couponCode)
                .expectedTotal(total)
                .customer(CheckoutRequest.Customer.builder().name("Proof Buyer").phone(phone)
                        .email("buyer-" + phone + "@example.invalid").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("1 Proof Road").city("Lucknow")
                        .pincode("226001").build())
                .saveAddress(true)
                .build();
    }

    private void payAllLogs(String orderId) {
        // What the PAID claim of the webhook writes, for every log of the order's group.
        db.update("UPDATE payment_log SET payment_status = 'PAID', status = 'SUCCESS' WHERE payment_group_id = "
                + "(SELECT payment_group_id FROM commerce_order WHERE id = ?)", orderId);
    }

    private String status(String orderId) {
        return text("SELECT status FROM commerce_order WHERE id = ?", orderId);
    }

    // ------------------------------------------------------------------ tests

    @Test
    @Order(1)
    void seed_aShopWithThreeVariantsInStock() {
        assertEquals(2, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version IN ('685','686')"),
                "V685 and V686 are in the Flyway history");
        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", inst,
                "Checkout Proof " + run, "https://shop-" + run + ".example.com");
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)", inst);
        capabilityResolver.evict(inst);
        taxSettingService.update(inst, actor, TaxSettingDTO.builder().taxMode("REGULAR").sellerGstin(SELLER_GSTIN)
                .sellerLegalName("Proof Seller " + run).sellerAddress("1 Proof Road, Lucknow 226001")
                .roundTotalTo("RUPEE").build());
        LocalDate from = LocalDate.of(2020, 4, 1);
        taxClass = taxClassService.create(inst, actor, TaxClassDTO.builder().code("cloth_test").name("cloth TEST")
                .hsnCode("5208").unit("PCS")
                .rules(List.of(TaxRateRuleDTO.builder().minUnitPrice(new BigDecimal("0"))
                        .ratePercent(new BigDecimal("5")).effectiveFrom(from).build()))
                .build()).getId();

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

        onePiece = variant("one-piece", "OP", "800.00");
        plenty = variant("plenty", "PL", "1500.00");
        scarce = variant("scarce", "SC", "600.00");
        receive(onePiece, 1);
        receive(plenty, 50);
        receive(scarce, 1);
        flowA = variant("flow-a", "FA", "700.00");
        flowB = variant("flow-b", "FB", "450.00");
        bulk = variant("bulk", "BK", "300.00");
        receive(flowA, 10);
        receive(flowB, 10);
        receive(bulk, 200);
        for (int i = 1; i <= RACE_ROUNDS; i++) {
            String piece = variant("race-" + i, "RC" + i, "500.00");
            receive(piece, 1);
            racePieces.add(piece);
        }
        // The institute's own Razorpay account, as the payment settings screen stores it. Local
        // values only; nothing here is a real credential.
        db.update("INSERT INTO institute_payment_gateway_mapping (id, vendor, institute_id, payment_gateway_specific_data, "
                        + "status) VALUES (?, 'RAZORPAY', ?, ?, 'ACTIVE')", UUID.randomUUID().toString(), inst,
                "{\"apiKey\":\"" + KEY_ID + "\",\"apiSecret\":\"" + KEY_SECRET + "\",\"keySecret\":\"" + KEY_SECRET
                        + "\",\"webhookSecret\":\"" + WEBHOOK_SECRET + "\"}");
        // A coupon that can be used once: 10 percent off.
        couponCode = "ONCE" + run.toUpperCase();
        String couponId = UUID.randomUUID().toString();
        db.update("INSERT INTO coupon_code (id, code, status, source_type, institute_id, is_email_restricted, "
                + "usage_limit, can_be_added) VALUES (?, ?, 'ACTIVE', 'INSTITUTE', ?, false, 1, true)", couponId,
                couponCode, inst);
        db.update("INSERT INTO applied_coupon_discount (id, name, discount_type, status, discount_source, currency, "
                + "discount_point, coupon_code_id, institute_id) VALUES (?, 'once', 'PERCENTAGE', 'ACTIVE', "
                + "'COUPON_CODE', 'INR', 10, ?, ?)", UUID.randomUUID().toString(), couponId, inst);
        snapshotLoader.evict(inst);
        assertEquals(1, slots(onePiece));
        assertEquals(50, slots(plenty));
    }

    @Test
    @Order(2)
    void aTwoLineOrderWritesPlansLogsHoldsAndTheGroupAndNoEnrolment() {
        first = checkoutService.placeOrder(inst, request("9876500001", Map.of(onePiece, 1, plenty, 2)), "127.0.0.1");
        String orderId = first.getOrderId();

        assertEquals("PENDING_PAYMENT", first.getStatus());
        assertNotNull(first.getPayment(), "the gateway step ran after the order transaction");
        assertTrue(first.getPayment().getGatewayOrderId().startsWith("order_" + run));
        assertEquals(KEY_ID, first.getPayment().getKeyId());
        assertNotNull(first.getHold().getReleaseToken());
        Map<String, Object> order = db.queryForMap("SELECT * FROM commerce_order WHERE id = ?", orderId);
        assertEquals("ONLINE", order.get("channel"));
        assertEquals("09", order.get("place_of_supply_state"));
        assertEquals(first.getPayment().getGatewayOrderId(), order.get("gateway_order_id"));
        // The row that ties a later payment to this order and to its amount.
        assertEquals(1, count("SELECT count(*) FROM commerce_gateway_order WHERE commerce_order_id = ? AND institute_id = ? "
                + "AND gateway_order_id = ? AND status = 'CREATED' AND currency = 'INR' AND amount_minor = "
                + "(SELECT (total * 100)::bigint FROM commerce_order WHERE id = ?)", orderId, inst,
                first.getPayment().getGatewayOrderId(), orderId));
        assertNotNull(order.get("price_snapshot_json"));
        assertNotNull(order.get("hold_expires_at"));
        assertTrue(String.valueOf(order.get("order_number")).startsWith("ORD-"));
        String group = String.valueOf(order.get("payment_group_id"));
        String buyer = String.valueOf(order.get("user_id"));
        BigDecimal total = new BigDecimal(String.valueOf(order.get("total")));

        // Two item lines, each with its own plan and log.
        assertEquals(2, count("SELECT count(*) FROM commerce_order_line WHERE order_id = ? AND line_type = 'ITEM' "
                + "AND user_plan_id IS NOT NULL AND payment_log_id IS NOT NULL", orderId));
        assertEquals(2, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.status = 'PENDING_FOR_PAYMENT' AND up.user_id = ?", orderId, buyer));
        // Logs: pending, in the order's group, carrying the order id, summing to the total.
        assertEquals(2, count("SELECT count(*) FROM payment_log WHERE payment_group_id = ? "
                + "AND payment_status = 'PAYMENT_PENDING' AND status = 'ACTIVE' AND user_plan_id IS NOT NULL", group));
        assertEquals(2, count("SELECT count(*) FROM payment_log WHERE payment_group_id = ? AND payment_specific_data "
                + "LIKE '%\"order_id\":\"' || ? || '\"%'", group, orderId));
        BigDecimal logSum = db.queryForObject("SELECT SUM(CAST(payment_amount AS NUMERIC(14,2))) FROM payment_log "
                + "WHERE payment_group_id = ?", BigDecimal.class, group);
        assertEquals(0, total.compareTo(logSum), "log amounts sum to the order total: " + logSum + " vs " + total);
        BigDecimal lineLogSum = db.queryForObject("SELECT SUM(log_amount) FROM commerce_order_line WHERE order_id = ?",
                BigDecimal.class, orderId);
        assertEquals(0, total.compareTo(lineLogSum));

        // Holds: HELD, one per variant, tied to the plan of its line and to the order's first log.
        assertEquals(2, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id AND l.package_session_id = h.package_session_id WHERE l.order_id = ? "
                + "AND h.status = 'HELD' AND h.payment_log_id = ? AND h.fulfilment_location_id = ?", orderId,
                order.get("primary_payment_log_id"), wh));
        assertEquals(0, slots(onePiece));
        assertEquals(48, slots(plenty));

        // No enrolment row for the buyer, on any package session, and nothing in the learner ledger.
        assertEquals(0, count("SELECT count(*) FROM student_session_institute_group_mapping WHERE user_id = ?", buyer));
        assertEquals(0, count("SELECT count(*) FROM user_account_ledger WHERE user_id = ?", buyer));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = 'PENDING' "
                + "AND mode = 'GATEWAY'", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_status_history WHERE order_id = ? "
                + "AND from_status IS NULL AND to_status = 'PENDING_PAYMENT'", orderId));
        // The phone was typed, not proved: the shop keeps a customer row for it with the phone
        // alone. No account, no name and no address are written on the word of a checkout.
        assertEquals(1, count("SELECT count(*) FROM commerce_customer WHERE institute_id = ? AND phone = '919876500001' "
                + "AND user_id IS NULL AND name IS NULL AND email IS NULL AND NOT marketing_consent", inst));
        assertEquals(0, count("SELECT count(*) FROM commerce_customer_address a JOIN commerce_customer c ON c.id = "
                + "a.customer_id WHERE c.institute_id = ?", inst));

        // The order page by token, and the staff detail.
        CheckoutDtos.OrderView view = queryService.viewByToken(inst, first.getOrderAccessToken());
        assertEquals(2, view.getLines().size());
        assertEquals("••••••0001", view.getRecipient().getPhoneMasked());
        StaffOrderDtos.StaffOrderDetail detail = queryService.staffDetail(inst, orderId);
        assertEquals(List.of("CONFIRMED", "CANCELLED"), detail.getNextStatuses());
        assertEquals(1, queryService.staffList(inst, "PENDING_PAYMENT", null, 0, 20).getTotal());
    }

    @Test
    @Order(3)
    void aDoubleSubmitReturnsTheSameOrderAndHoldsNothingTwice() {
        CheckoutRequest request = request("9876500002", Map.of(plenty, 1));
        CheckoutDtos.Placed a = checkoutService.placeOrder(inst, request, null);
        CheckoutDtos.Placed b = checkoutService.placeOrder(inst, request, null);
        assertEquals(a.getOrderId(), b.getOrderId());
        assertTrue(b.isReplayed());
        assertEquals(47, slots(plenty));
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE institute_id = ? AND client_request_id = ?",
                inst, request.getClientRequestId()));

        request.getLines().get(0).setQuantity(2);
        CheckoutException e = assertThrows(CheckoutException.class, () -> checkoutService.placeOrder(inst, request, null));
        assertEquals(CheckoutException.IDEMPOTENCY_KEY_REUSED, e.getCode());
        assertEquals(47, slots(plenty));
        // Leave it unpaid; the expiry test below cancels it.
    }

    @Test
    @Order(4)
    void aSecondShopperDoesNotGetTheOnePieceAndNothingIsWrittenForThem() {
        long ordersBefore = count("SELECT count(*) FROM commerce_order WHERE institute_id = ?", inst);
        long plansBefore = count("SELECT count(*) FROM user_plan");
        // The cart refuses first: the piece is held. That is a 409 with the price.
        CheckoutRequest request = CheckoutRequest.builder()
                .clientRequestId("proof-" + run + "-second")
                .lines(List.of(CartPriceRequest.Line.builder().variantId(onePiece).quantity(1).build()))
                .expectedTotal(new BigDecimal("840.00"))
                .customer(CheckoutRequest.Customer.builder().name("Second Buyer").phone("9876500003")
                        .email("second-" + run + "@example.invalid").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("2 Proof Road").pincode("226001").build())
                .build();
        CheckoutException e = assertThrows(CheckoutException.class, () -> checkoutService.placeOrder(inst, request, null));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertEquals(ordersBefore, count("SELECT count(*) FROM commerce_order WHERE institute_id = ?", inst));
        assertEquals(plansBefore, count("SELECT count(*) FROM user_plan"));
        assertEquals(0, slots(onePiece));
    }

    @Test
    @Order(5)
    void aPaymentConfirmsTheOrderOnceAndTakesNoStockTwice() {
        String orderId = first.getOrderId();
        assertEquals(CommerceOrderPaymentService.Outcome.NOT_PAID_YET, paymentService.ensurePaidOrderConfirmed(orderId));
        payAllLogs(orderId);

        orderService.onPaymentLogPaid(text("SELECT primary_payment_log_id FROM commerce_order WHERE id = ?", orderId));

        assertEquals("CONFIRMED", status(orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE id = ? AND payment_status = 'PAID' "
                + "AND amount_paid = total AND confirmed_at IS NOT NULL", orderId));
        assertEquals(2, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.status = 'ACTIVE'", orderId));
        assertEquals(2, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.status = 'SOLD' AND NOT h.oversold", orderId));
        // HELD became SOLD: no second decrement.
        assertEquals(0, slots(onePiece));
        assertEquals(47, slots(plenty));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = 'RECEIVED' "
                + "AND received_at IS NOT NULL", orderId));
        // Still no enrolment after activation.
        assertEquals(0, count("SELECT count(*) FROM student_session_institute_group_mapping WHERE user_id = "
                + "(SELECT user_id FROM commerce_order WHERE id = ?)", orderId));

        // Replays change nothing.
        assertEquals(CommerceOrderPaymentService.Outcome.ALREADY_SETTLED, orderService.ensurePaidOrderConfirmed(orderId));
        orderService.onPaymentLogPaid(text("SELECT primary_payment_log_id FROM commerce_order WHERE id = ?", orderId));
        assertEquals(2, count("SELECT count(*) FROM commerce_order_status_history WHERE order_id = ?", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ?", orderId));
        assertEquals(47, slots(plenty));
        // The expiry of a paid order does nothing.
        assertFalse(paymentService.onHoldExpired(orderId));
        assertEquals("CONFIRMED", status(orderId));
    }

    @Test
    @Order(6)
    void anUnpaidOrderExpiresAndItsStockComesBack() {
        String orderId = text("SELECT id FROM commerce_order WHERE institute_id = ? AND customer_phone = "
                + "'919876500002'", inst);
        assertEquals(47, slots(plenty));

        orderService.onHoldExpired(orderId);

        assertEquals("CANCELLED", status(orderId));
        assertEquals("PAYMENT_EXPIRED", text("SELECT cancel_reason FROM commerce_order WHERE id = ?", orderId));
        assertEquals(48, slots(plenty));
        assertEquals(1, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.status = 'RELEASED'", orderId));
        assertEquals(1, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.status = 'CANCELED'", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = 'VOID'", orderId));
        // The log is left pending, so a payment that still arrives can be claimed.
        assertEquals(1, count("SELECT count(*) FROM payment_log pl JOIN commerce_order o ON o.payment_group_id = "
                + "pl.payment_group_id WHERE o.id = ? AND pl.payment_status = 'PAYMENT_PENDING'", orderId));
        // A second expiry changes nothing.
        orderService.onHoldExpired(orderId);
        assertEquals(48, slots(plenty));
        assertEquals(2, count("SELECT count(*) FROM commerce_order_status_history WHERE order_id = ?", orderId));
    }

    @Test
    @Order(7)
    void aLatePaymentTakesTheStockAgainAndConfirmsTheCancelledOrder() {
        String orderId = text("SELECT id FROM commerce_order WHERE institute_id = ? AND customer_phone = "
                + "'919876500002'", inst);
        // Gate 18, first branch: the money arrives through the webhook after the order lapsed.
        assertEquals(200, payByWebhook(orderId).statusCode());

        assertEquals("CONFIRMED", status(orderId));
        assertNull(text("SELECT cancel_reason FROM commerce_order WHERE id = ?", orderId));
        assertEquals(47, slots(plenty));
        assertEquals(1, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.status = 'SOLD' AND NOT h.oversold", orderId));
        assertEquals(1, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.status = 'ACTIVE'", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_status_history WHERE order_id = ? "
                + "AND from_status = 'CANCELLED' AND to_status = 'CONFIRMED' AND note = 'LATE_PAYMENT'", orderId));
        // The voided tender stays; the money is a new RECEIVED one.
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = 'VOID'", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = 'RECEIVED'", orderId));
    }

    @Test
    @Order(8)
    void aLatePaymentWithNoStockLeftIsOversoldPaidAndNotFulfilled() {
        // Shopper A holds the one scarce piece, does not pay in time and loses it.
        CheckoutDtos.Placed late = checkoutService.placeOrder(inst, request("9876500004", Map.of(scarce, 1, plenty, 1)), null);
        assertEquals(0, slots(scarce));
        assertEquals(46, slots(plenty));
        assertTrue(paymentService.onHoldExpired(late.getOrderId()));
        assertEquals(1, slots(scarce));
        assertEquals(47, slots(plenty));

        // Shopper B buys it and pays.
        snapshotLoader.evict(inst);
        CheckoutDtos.Placed winner = checkoutService.placeOrder(inst, request("9876500005", Map.of(scarce, 1)), null);
        assertEquals(200, payByWebhook(winner.getOrderId()).statusCode());
        assertEquals("CONFIRMED", status(winner.getOrderId()));
        assertEquals(0, slots(scarce));

        // Gate 18, second branch: now A's payment arrives through the webhook.
        assertEquals(200, payByWebhook(late.getOrderId()).statusCode());

        assertEquals("CANCELLED", status(late.getOrderId()));
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE id = ? AND cancel_reason = 'OVERSOLD_PAID' "
                + "AND payment_status = 'PAID' AND amount_paid = total", late.getOrderId()));
        // The scarce line took nothing and gives nothing back; the other line gives its unit back.
        assertEquals(0, slots(scarce));
        assertEquals(47, slots(plenty));
        assertEquals(2, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.status = 'RESTORED'", late.getOrderId()));
        assertEquals(1, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.oversold", late.getOrderId()));
        // Settled: the next delivery does nothing.
        assertEquals(CommerceOrderPaymentService.Outcome.ALREADY_SETTLED,
                paymentService.ensurePaidOrderConfirmed(late.getOrderId()));
        assertEquals(47, slots(plenty));
        // The winner is untouched.
        assertEquals("CONFIRMED", status(winner.getOrderId()));
    }

    @Test
    @Order(9)
    void logsThatDoNotSumToTheTotalAreRefusedAndTheOrderStaysUnpaid() {
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request("9876500006", Map.of(plenty, 1)), null);
        db.update("UPDATE payment_log SET payment_status = 'PAID', status = 'SUCCESS', payment_amount = 1 "
                + "WHERE payment_group_id = (SELECT payment_group_id FROM commerce_order WHERE id = ?)",
                placed.getOrderId());
        assertEquals(CommerceOrderPaymentService.Outcome.REFUSED_MISMATCH,
                paymentService.ensurePaidOrderConfirmed(placed.getOrderId()));
        assertThrows(IllegalStateException.class, () -> orderService.ensurePaidOrderConfirmed(placed.getOrderId()));
        assertEquals("PENDING_PAYMENT", status(placed.getOrderId()));
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE id = ? AND payment_status = 'UNPAID'",
                placed.getOrderId()));
    }

    // ------------------------------------------------------------------ price mismatch

    @Test
    @Order(10)
    void aTotalOtherThanTheServersIsAnswered409WithTheNewPriceAndNothingIsWritten() {
        long ordersBefore = count("SELECT count(*) FROM commerce_order WHERE institute_id = ?", inst);
        CheckoutRequest request = request(nextPhone(), Map.of(flowA, 1));
        BigDecimal real = request.getExpectedTotal();
        request.setExpectedTotal(real.subtract(new BigDecimal("1.00")));
        CheckoutException e = assertThrows(CheckoutException.class, () -> checkoutService.placeOrder(inst, request, null));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertEquals(CheckoutException.PRICE_CHANGED, e.getCode());
        assertNotNull(e.getDetails().get("price"), "the answer carries the price as it is now");
        assertEquals(ordersBefore, count("SELECT count(*) FROM commerce_order WHERE institute_id = ?", inst));
        assertEquals(10, slots(flowA));
        note("== price mismatch: sent " + request.getExpectedTotal() + ", real " + real + " -> " + e.getStatus() + " "
                + e.getCode());
    }

    @Test
    @Order(10)
    void withoutAProvedPhoneAnEmailIsAlwaysNeeded_theAnswerDoesNotTellWhetherTheShopKnowsThePhone() {
        long ordersBefore = count("SELECT count(*) FROM commerce_order WHERE institute_id = ?", inst);
        int stock = slots(flowA);
        CheckoutRequest fresh = request(nextPhone(), Map.of(flowA, 1));
        fresh.getCustomer().setEmail(null);
        CheckoutException e = assertThrows(CheckoutException.class, () -> checkoutService.placeOrder(inst, fresh, null));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertEquals(CheckoutException.EMAIL_REQUIRED, e.getCode());
        assertEquals("customer.email", e.getDetails().get("param"));
        assertEquals(ordersBefore, count("SELECT count(*) FROM commerce_order WHERE institute_id = ?", inst));
        assertEquals(stock, slots(flowA));

        // The phone of the first order of this run is known to the shop. Nobody proved it here,
        // so the answer is the same: a yes/no on "is this phone a customer" must not exist.
        CheckoutRequest known = request("9876500001", Map.of(flowA, 1));
        known.getCustomer().setEmail(null);
        CheckoutException same = assertThrows(CheckoutException.class,
                () -> checkoutService.placeOrder(inst, known, null));
        assertEquals(e.getStatus(), same.getStatus());
        assertEquals(e.getCode(), same.getCode());
        assertEquals(e.getMessage(), same.getMessage());
        assertEquals(ordersBefore, count("SELECT count(*) FROM commerce_order WHERE institute_id = ?", inst));
        assertEquals(stock, slots(flowA));
        note("== no e-mail, phone not proved: unknown phone and known phone both -> " + same.getStatus().value() + " "
                + same.getCode());
    }

    // ------------------------------------------------------------------ the full prepaid flow

    @Test
    @Order(11)
    void theFullPrepaidFlow_signedWebhookConfirmsOnce_andNoLegacySideEffectRuns() {
        note("");
        note("== full prepaid flow through the signed webhook (HTTP, real RazorpayWebHookService)");
        String phone = nextPhone();
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request(phone, Map.of(flowA, 1, flowB, 2)), "127.0.0.1");
        String orderId = placed.getOrderId();
        Map<String, Object> order = db.queryForMap("SELECT * FROM commerce_order WHERE id = ?", orderId);
        String buyer = String.valueOf(order.get("user_id"));
        String group = String.valueOf(order.get("payment_group_id"));
        BigDecimal total = new BigDecimal(String.valueOf(order.get("total")));
        Map<String, Object> gateway = gatewayRow(orderId);
        String gatewayOrderId = String.valueOf(gateway.get("gateway_order_id"));
        long amountMinor = ((Number) gateway.get("amount_minor")).longValue();
        assertEquals(total.movePointRight(2).longValueExact(), amountMinor);

        // Rows as designed, before any money.
        assertEquals(2, count("SELECT count(*) FROM commerce_order_line WHERE order_id = ? AND line_type = 'ITEM'", orderId),
                "two item lines");
        assertEquals(2, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.status = 'PENDING_FOR_PAYMENT'", orderId));
        assertEquals(0, total.compareTo(db.queryForObject("SELECT SUM(CAST(payment_amount AS NUMERIC(14,2))) FROM "
                + "payment_log WHERE payment_group_id = ?", BigDecimal.class, group)), "logs sum to the order total");
        assertEquals(2, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.status = 'HELD'", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = 'PENDING'", orderId));
        assertEquals(9, slots(flowA));
        assertEquals(8, slots(flowB));
        assertEquals(0, count("SELECT count(*) FROM student_session_institute_group_mapping WHERE user_id = ?", buyer));
        assertEquals(0, count("SELECT count(*) FROM user_account_ledger WHERE user_id = ?", buyer));

        reset(workflowTriggerService, paymentNotificatonService, dynamicNotificationService, asyncEnrollmentEmailService,
                invoiceService, authService);

        // 1. A wrong signature is refused before anything is read.
        String good = event("payment.captured", gatewayOrderId, "pay_" + run + "flow", amountMinor, orderId);
        assertEquals(400, postWebhook(good, hmacHex("another-secret", good)).statusCode());
        assertEquals("PENDING_PAYMENT", status(orderId));

        // 2. A captured amount other than the order's is refused: 200, nothing written.
        String wrongAmount = event("payment.captured", gatewayOrderId, "pay_" + run + "short", amountMinor - 100, orderId);
        HttpResponse<String> refused = postWebhook(wrongAmount, hmacHex(WEBHOOK_SECRET, wrongAmount));
        assertEquals(200, refused.statusCode());
        assertTrue(refused.body().contains("refused"), refused.body());
        assertEquals("PENDING_PAYMENT", status(orderId));
        assertEquals(2, count("SELECT count(*) FROM payment_log WHERE payment_group_id = ? AND payment_status = "
                + "'PAYMENT_PENDING'", group));
        assertEquals(1, count("SELECT count(*) FROM web_hook WHERE order_id = ? AND status = 'FAILED' AND error_message "
                + "LIKE '%AMOUNT_MISMATCH%'", orderId));

        // 3. A payment made on some other gateway order that names this order in its notes
        //    (pay a cheap order, name a dear one) is refused the same way.
        String forged = event("payment.captured", "order_not_ours_" + run, "pay_" + run + "forged", amountMinor, orderId);
        HttpResponse<String> forgedAnswer = postWebhook(forged, hmacHex(WEBHOOK_SECRET, forged));
        assertEquals(200, forgedAnswer.statusCode());
        assertTrue(forgedAnswer.body().contains("refused"), forgedAnswer.body());
        // ... and so is one that names a payment log of the order (the legacy lookup key).
        String forgedLog = event("payment.captured", "order_not_ours2_" + run, "pay_" + run + "forged2", amountMinor,
                String.valueOf(order.get("primary_payment_log_id")));
        assertTrue(postWebhook(forgedLog, hmacHex(WEBHOOK_SECRET, forgedLog)).body().contains("refused"));
        assertEquals("PENDING_PAYMENT", status(orderId));
        assertEquals(2, count("SELECT count(*) FROM payment_log WHERE payment_group_id = ? AND payment_status = "
                + "'PAYMENT_PENDING'", group));
        assertEquals(2, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.status = 'PENDING_FOR_PAYMENT'", orderId));

        // 4. The real payment.
        HttpResponse<String> paid = postWebhook(good, hmacHex(WEBHOOK_SECRET, good));
        assertEquals(200, paid.statusCode());
        assertEquals("Webhook processed successfully", paid.body());
        assertEquals("CONFIRMED", status(orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE id = ? AND payment_status = 'PAID' "
                + "AND amount_paid = total AND confirmed_at IS NOT NULL", orderId));
        assertEquals(2, count("SELECT count(*) FROM payment_log WHERE payment_group_id = ? AND payment_status = 'PAID' "
                + "AND status = 'SUCCESS'", group));
        assertEquals(2, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.status = 'ACTIVE'", orderId));
        assertEquals(2, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.status = 'SOLD' AND NOT h.oversold", orderId));
        assertEquals(9, slots(flowA), "the hold was sold; the stock is not taken a second time");
        assertEquals(8, slots(flowB));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = 'RECEIVED'", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_gateway_order WHERE commerce_order_id = ? AND status = 'PAID' "
                + "AND settled_at IS NOT NULL AND gateway_payment_id = ?", orderId, "pay_" + run + "flow"));
        assertEquals(1, count("SELECT count(*) FROM web_hook WHERE order_id = ? AND status = 'PROCESSED' AND event_type = "
                + "'payment.captured'", orderId));

        // None of the legacy side effects of a paid course.
        assertEquals(0, count("SELECT count(*) FROM student_session_institute_group_mapping WHERE user_id = ?", buyer),
                "no enrolment row");
        assertEquals(0, count("SELECT count(*) FROM user_account_ledger WHERE user_id = ?", buyer), "no learner-ledger row");
        assertEquals(0, count("SELECT count(*) FROM invoice WHERE user_id = ? OR commerce_order_id = ?", buyer, orderId),
                "no course invoice row (the commerce invoice is issued at PACKED)");
        verifyNoInteractions(invoiceService, workflowTriggerService, paymentNotificatonService,
                dynamicNotificationService, asyncEnrollmentEmailService, authService);
        note("   collaborators called for the shop order: invoiceService=" + calls(invoiceService) + " workflowTriggerService="
                + calls(workflowTriggerService) + " paymentNotificatonService=" + calls(paymentNotificatonService)
                + " dynamicNotificationService=" + calls(dynamicNotificationService) + " asyncEnrollmentEmailService="
                + calls(asyncEnrollmentEmailService) + " authService=" + calls(authService));

        // 5. Replays: the same event again, then the sibling order.paid. Nothing changes.
        Map<String, Object> before = db.queryForMap("SELECT status, payment_status, amount_paid, confirmed_at, updated_at "
                + "FROM commerce_order WHERE id = ?", orderId);
        assertEquals(200, postWebhook(good, hmacHex(WEBHOOK_SECRET, good)).statusCode());
        String sibling = event("order.paid", gatewayOrderId, "pay_" + run + "flow", amountMinor, orderId);
        assertEquals(200, postWebhook(sibling, hmacHex(WEBHOOK_SECRET, sibling)).statusCode());
        assertEquals(before, db.queryForMap("SELECT status, payment_status, amount_paid, confirmed_at, updated_at "
                + "FROM commerce_order WHERE id = ?", orderId), "a replay does not touch the order row");
        assertEquals(2, count("SELECT count(*) FROM commerce_order_status_history WHERE order_id = ?", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ?", orderId));
        assertEquals(2, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ?", orderId));
        assertEquals(9, slots(flowA));
        assertEquals(8, slots(flowB));
        verifyNoInteractions(invoiceService, workflowTriggerService, paymentNotificatonService,
                dynamicNotificationService, asyncEnrollmentEmailService);
        outsideServicesAnswerLocally();

        // The order page of the buyer says so.
        CheckoutDtos.OrderView view = queryService.viewByToken(inst, placed.getOrderAccessToken());
        assertEquals("CONFIRMED", view.getStatus());
        assertEquals("PAID", view.getPaymentStatus());
    }

    @Test
    @Order(12)
    void theClientConfirmationNeedsTheCheckoutSignature_andNeverPaysTheOrder_theCapturedWebhookDoes() {
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(flowA, 1)), null);
        String orderId = placed.getOrderId();
        String gatewayOrderId = placed.getPayment().getGatewayOrderId();
        String paymentId = "pay_" + run + "client";

        CheckoutException e = assertThrows(CheckoutException.class, () -> checkoutService.confirmClientPayment(inst,
                orderId, gatewayOrderId, paymentId, "0".repeat(64)));
        assertEquals(CheckoutException.PAYMENT_NOT_CONFIRMED, e.getCode());
        assertEquals("PENDING_PAYMENT", status(orderId));
        // A signature that is right for another order's gateway order is not right for this one.
        String other = text("SELECT gateway_order_id FROM commerce_gateway_order WHERE commerce_order_id <> ? LIMIT 1", orderId);
        assertThrows(CheckoutException.class, () -> checkoutService.confirmClientPayment(inst, orderId, other, paymentId,
                hmacHex(KEY_SECRET, other + "|" + paymentId)));
        assertEquals("PENDING_PAYMENT", status(orderId));

        // A good signature proves an authorisation, not a capture, and carries no amount: the
        // order is not paid by it. (An account on manual capture would give the money back.)
        CheckoutDtos.Placed answer = checkoutService.confirmClientPayment(inst, orderId, gatewayOrderId, paymentId,
                hmacHex(KEY_SECRET, gatewayOrderId + "|" + paymentId));
        assertEquals("PENDING_PAYMENT", answer.getStatus());
        assertEquals("UNPAID", answer.getPaymentStatus());
        assertTrue(answer.isPaymentProcessing());
        assertFalse(answer.isPaymentRetryable());
        assertNull(answer.getPayment());
        assertEquals("PENDING_PAYMENT", status(orderId));
        assertEquals(0, count("SELECT count(*) FROM payment_log pl JOIN commerce_order o ON o.payment_group_id = "
                + "pl.payment_group_id WHERE o.id = ? AND pl.payment_status = 'PAID'", orderId));
        assertEquals(0, count("SELECT count(*) FROM stock_hold h JOIN commerce_order o ON o.primary_payment_log_id = "
                + "h.payment_log_id WHERE o.id = ? AND h.status = 'SOLD'", orderId));
        assertEquals("AUTHORIZED", gatewayRow(orderId).get("status"));
        // The reconcile job does not confirm it either: there is no PAID log.
        reconcileJob.run();
        assertEquals("PENDING_PAYMENT", status(orderId));
        // While the payment is in progress the shopper is offered no second payment step, and
        // the release call does not free the stock.
        CheckoutDtos.Placed retry = checkoutService.retryPayment(inst, orderId, placed.getOrderAccessToken());
        assertTrue(retry.isPaymentProcessing());
        assertNull(retry.getPayment());
        assertEquals(0, stockHoldService.releaseForOrderWithToken(placed.getHold().getPaymentLogId(),
                placed.getHold().getReleaseToken()));
        note("== client confirmation with a good signature: order " + answer.getStatus() + ", payment_processing="
                + answer.isPaymentProcessing() + ", gateway row " + gatewayRow(orderId).get("status") + ", PAID logs 0");

        // The captured webhook is what pays.
        assertEquals(200, payByWebhook(orderId).statusCode());
        assertEquals("CONFIRMED", status(orderId));
        assertEquals(2, count("SELECT count(*) FROM commerce_order_status_history WHERE order_id = ?", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ?", orderId));
        assertEquals(8, slots(flowA));
        // And the client call after it answers the confirmed order.
        CheckoutDtos.Placed after = checkoutService.confirmClientPayment(inst, orderId, gatewayOrderId, paymentId,
                hmacHex(KEY_SECRET, gatewayOrderId + "|" + paymentId));
        assertEquals("CONFIRMED", after.getStatus());
        assertEquals("PAID", after.getPaymentStatus());
        assertFalse(after.isPaymentProcessing());
    }

    @Test
    @Order(13)
    void aFailedAttemptKeepsTheOrderOpen_expiryClosesItsFailedPlans_andALateCaptureStillPays() {
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(flowB, 1)), null);
        String orderId = placed.getOrderId();
        Map<String, Object> gateway = gatewayRow(orderId);
        String failed = event("payment.failed", String.valueOf(gateway.get("gateway_order_id")), "pay_" + run + "fail",
                ((Number) gateway.get("amount_minor")).longValue(), orderId);
        assertEquals(200, postWebhook(failed, hmacHex(WEBHOOK_SECRET, failed)).statusCode());
        assertEquals("PENDING_PAYMENT", status(orderId));
        assertEquals(1, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.status = 'PAYMENT_FAILED'", orderId));
        assertEquals(7, slots(flowB), "a failed attempt releases nothing");

        assertTrue(paymentService.onHoldExpired(orderId));
        assertEquals("CANCELLED", status(orderId));
        assertEquals(8, slots(flowB));
        assertEquals(1, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.status = 'CANCELED'", orderId), "a PAYMENT_FAILED plan is closed too");

        assertEquals(200, payByWebhook(orderId).statusCode());
        assertEquals("CONFIRMED", status(orderId));
        assertEquals(7, slots(flowB));
        assertEquals(1, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.status = 'ACTIVE'", orderId));
    }

    // ------------------------------------------------------------------ expiry by the job

    @Test
    @Order(14)
    void theHoldExpiryJobCancelsTheOrderAndGivesTheStockBackExactly() {
        int a = slots(flowA);
        int b = slots(flowB);
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(flowA, 2, flowB, 3)), null);
        String orderId = placed.getOrderId();
        assertEquals(a - 2, slots(flowA));
        assertEquals(b - 3, slots(flowB));
        // Not yet due: the job leaves it alone.
        stockHoldService.releaseExpired();
        assertEquals("PENDING_PAYMENT", status(orderId));
        assertEquals(a - 2, slots(flowA));

        // The payment window is over (the clock is moved, not the code).
        db.update("UPDATE stock_hold SET expires_at = expires_at - interval '2 hours' WHERE payment_log_id = ?",
                placed.getHold().getPaymentLogId());
        db.update("UPDATE commerce_order SET hold_expires_at = hold_expires_at - interval '2 hours' WHERE id = ?", orderId);
        int released = stockHoldService.releaseExpired();
        assertEquals(2, released, "both holds of the order");

        assertEquals("CANCELLED", status(orderId), "the release hook cancels the order");
        assertEquals("PAYMENT_EXPIRED", text("SELECT cancel_reason FROM commerce_order WHERE id = ?", orderId));
        assertEquals(a, slots(flowA), "exactly what was held comes back");
        assertEquals(b, slots(flowB));
        assertEquals(2, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND h.status = 'RELEASED' AND h.release_reason = 'EXPIRED'", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = 'VOID'", orderId));

        // The job again, and the reconcile job: nothing more comes back.
        stockHoldService.releaseExpired();
        reconcileJob.run();
        assertEquals(a, slots(flowA));
        assertEquals(b, slots(flowB));
        assertEquals(2, count("SELECT count(*) FROM commerce_order_status_history WHERE order_id = ?", orderId));
    }

    // ------------------------------------------------------------------ gate 4, real threads

    @Test
    @Order(15)
    void twoShoppersAndOnePieceOnRealThreads_exactlyOneOrder_theOtherGetsAClearAnswerAndNoMoneyRows() {
        note("");
        note("== gate 4: two shoppers, one piece, two threads started together (" + RACE_ROUNDS + " rounds)");
        Set<String> loserCodes = new TreeSet<>();
        for (String piece : racePieces) {
            assertEquals(1, slots(piece));
            String phoneA = nextPhone();
            String phoneB = nextPhone();
            CheckoutRequest a = request(phoneA, Map.of(piece, 1));
            CheckoutRequest b = request(phoneB, Map.of(piece, 1));
            long plansBefore = count("SELECT count(*) FROM user_plan");
            long logsBefore = count("SELECT count(*) FROM payment_log");
            long ordersBefore = count("SELECT count(*) FROM commerce_order WHERE institute_id = ?", inst);

            List<Object> results = atOnce(List.of(() -> checkoutService.placeOrder(inst, a, null),
                    () -> checkoutService.placeOrder(inst, b, null)));

            List<CheckoutDtos.Placed> won = new ArrayList<>();
            List<CheckoutException> lost = new ArrayList<>();
            for (Object result : results) {
                if (result instanceof CheckoutDtos.Placed placed) {
                    won.add(placed);
                } else if (result instanceof CheckoutException refused) {
                    lost.add(refused);
                } else {
                    throw new AssertionError("neither an order nor a clear refusal: " + result, (Throwable) result);
                }
            }
            assertEquals(1, won.size(), "exactly one shopper gets the piece");
            assertEquals(1, lost.size());
            CheckoutException refusal = lost.get(0);
            assertEquals(HttpStatus.CONFLICT, refusal.getStatus());
            assertTrue(Set.of(CheckoutException.OUT_OF_STOCK, CheckoutException.CART_CHANGED).contains(refusal.getCode()),
                    "a clear out-of-stock answer: " + refusal.getCode());
            if (CheckoutException.CART_CHANGED.equals(refusal.getCode())) {
                assertTrue(String.valueOf(writeJson(refusal.getDetails())).contains("OUT_OF_STOCK"),
                        "the refusal names the line as out of stock");
            }
            loserCodes.add(refusal.getCode());
            String loserPhone = orderIdOfOrNull(phoneA) == null ? phoneA : phoneB;
            assertNull(orderIdOfOrNull(loserPhone), "no order for the shopper who lost");
            assertEquals(ordersBefore + 1, count("SELECT count(*) FROM commerce_order WHERE institute_id = ?", inst));
            assertEquals(plansBefore + 1, count("SELECT count(*) FROM user_plan"), "one plan: the winner's");
            assertEquals(logsBefore + 1, count("SELECT count(*) FROM payment_log"), "one payment log: the winner's");
            assertEquals(1, count("SELECT count(*) FROM stock_hold WHERE package_session_id = ?", piece), "one hold");
            assertEquals(1, count("SELECT count(*) FROM stock_hold WHERE package_session_id = ? AND status = 'HELD' "
                    + "AND quantity = 1", piece));
            assertEquals(0, slots(piece));
            assertEquals(0, count("SELECT count(*) FROM commerce_customer WHERE institute_id = ? AND phone = ?", inst,
                    stored(loserPhone)), "not even a customer row for the shopper who lost");
            note("   " + refusal.getStatus().value() + " " + refusal.getCode() + ": " + refusal.getMessage());
        }
        note("   codes the losing shopper got over the rounds: " + loserCodes);
    }

    private String orderIdOfOrNull(String phone) {
        List<String> ids = db.queryForList("SELECT id FROM commerce_order WHERE institute_id = ? AND customer_phone = ?",
                String.class, inst, stored(phone));
        return ids.isEmpty() ? null : ids.get(0);
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @Order(16)
    void aDoubleSubmitOnTwoThreadsWithOneKeyMakesOneOrder() {
        int before = slots(bulk);
        CheckoutRequest request = request(nextPhone(), Map.of(bulk, 2));
        List<Callable<Object>> tasks = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            tasks.add(() -> checkoutService.placeOrder(inst, request, null));
        }
        List<Object> results = atOnce(tasks);
        Set<String> orderIds = new TreeSet<>();
        int created = 0;
        for (Object result : results) {
            assertTrue(result instanceof CheckoutDtos.Placed, "every submit is answered with the order: " + result);
            CheckoutDtos.Placed placed = (CheckoutDtos.Placed) result;
            orderIds.add(placed.getOrderId());
            if (!placed.isReplayed()) {
                created++;
            }
        }
        assertEquals(1, orderIds.size(), "one order for one idempotency key");
        assertEquals(1, created, "one of the four created it; the others are replays");
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE institute_id = ? AND client_request_id = ?", inst,
                request.getClientRequestId()));
        assertEquals(before - 2, slots(bulk), "the stock is held once");
        assertEquals(1, count("SELECT count(*) FROM commerce_gateway_order WHERE commerce_order_id = ?",
                orderIds.iterator().next()), "one gateway order");
    }

    // ------------------------------------------------------------------ coupon

    @Test
    @Order(17)
    void aSingleUseCouponIsRedeemedOnce_evenByTwoCheckoutsAtTheSameMoment() {
        int before = slots(bulk);
        String phoneA = nextPhone();
        String phoneB = nextPhone();
        CheckoutRequest a = request(phoneA, Map.of(bulk, 1), couponCode);
        CheckoutRequest b = request(phoneB, Map.of(bulk, 1), couponCode);
        BigDecimal plain = request(nextPhone(), Map.of(bulk, 1)).getExpectedTotal();
        assertTrue(a.getExpectedTotal().compareTo(plain) < 0, "the coupon lowers the total: " + a.getExpectedTotal()
                + " < " + plain);

        List<Object> results = atOnce(List.of(() -> checkoutService.placeOrder(inst, a, null),
                () -> checkoutService.placeOrder(inst, b, null)));
        long won = results.stream().filter(r -> r instanceof CheckoutDtos.Placed).count();
        List<CheckoutException> lost = results.stream().filter(r -> r instanceof CheckoutException)
                .map(r -> (CheckoutException) r).toList();
        assertEquals(1, won, "one order takes the coupon: " + results);
        assertEquals(1, lost.size());
        assertEquals(HttpStatus.CONFLICT, lost.get(0).getStatus());
        assertTrue(Set.of(CheckoutException.COUPON_NOT_AVAILABLE, CheckoutException.PRICE_CHANGED)
                .contains(lost.get(0).getCode()), lost.get(0).getCode());
        assertEquals(0, count("SELECT usage_limit FROM coupon_code WHERE institute_id = ? AND code = ?", inst, couponCode));
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE institute_id = ? AND coupon_code = ?", inst,
                couponCode));
        assertEquals(before - 1, slots(bulk), "the order that lost the coupon holds no stock");
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE institute_id = ? AND customer_phone IN (?, ?)",
                inst, stored(phoneA), stored(phoneB)));
        note("== coupon with one use, two checkouts at once: 1 order, the other " + lost.get(0).getStatus().value() + " "
                + lost.get(0).getCode());

        // Afterwards the coupon no longer lowers a cart, so the old total is refused with the new price.
        a.setClientRequestId("proof-" + run + "-coupon-again");
        a.getCustomer().setPhone(nextPhone());
        CheckoutException again = assertThrows(CheckoutException.class, () -> checkoutService.placeOrder(inst, a, null));
        assertEquals(CheckoutException.PRICE_CHANGED, again.getCode());
        assertEquals(before - 1, slots(bulk));
    }

    // ------------------------------------------------------------------ a slow gateway

    @Test
    @Order(18)
    void aGatewayThatBlocksFor20SecondsHoldsNoLockAndDoesNotBlockAnotherCheckout() throws Exception {
        note("");
        note("== a gateway call that blocks for " + (GATEWAY_BLOCK_MILLIS / 1000) + " s");
        int before = slots(bulk);
        String slowPhone = nextPhone();
        CheckoutRequest slow = request(slowPhone, Map.of(bulk, 1));
        CheckoutRequest quick = request(nextPhone(), Map.of(bulk, 1));
        gatewayEntered = new CountDownLatch(1);
        blockNextGatewayCall.set(true);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        long started = System.nanoTime();
        try {
            Future<CheckoutDtos.Placed> blocked = pool.submit(() -> checkoutService.placeOrder(inst, slow, null));
            assertTrue(gatewayEntered.await(30, TimeUnit.SECONDS), "the first checkout reached the gateway");
            String slowOrder = orderIdOf(slowPhone);
            assertEquals("PENDING_PAYMENT", status(slowOrder), "its order transaction has committed");
            assertEquals(before - 1, slots(bulk));

            // No session of this database is inside a transaction, and none holds a row lock.
            long openTransactions = count("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                    + "AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'");
            long writeLocks = count("SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid "
                    + "WHERE a.datname = current_database() AND l.pid <> pg_backend_pid() "
                    + "AND l.locktype IN ('transactionid', 'tuple')");
            long waiting = count("SELECT count(*) FROM pg_locks WHERE NOT granted");
            assertEquals(0, openTransactions, "no session is idle in a transaction while the gateway is slow");
            assertEquals(0, writeLocks, "no write transaction is open while the gateway is slow");
            assertEquals(0, waiting);
            // The rows a checkout locks can be locked at once by a second transaction.
            new TransactionTemplate(transactionManager).executeWithoutResult(tx -> {
                db.queryForList("SELECT id FROM package_session WHERE id = ? FOR UPDATE NOWAIT", bulk);
                db.queryForList("SELECT id FROM stock_level WHERE package_session_id = ? FOR UPDATE NOWAIT", bulk);
                db.queryForList("SELECT id FROM stock_hold WHERE package_session_id = ? FOR UPDATE NOWAIT", bulk);
                db.queryForList("SELECT id FROM commerce_counter WHERE institute_id = ? FOR UPDATE NOWAIT", inst);
                db.queryForList("SELECT id FROM commerce_order WHERE id = ? FOR UPDATE NOWAIT", slowOrder);
            });
            note("   while blocked: idle-in-transaction sessions=" + openTransactions + ", sessions with a write lock="
                    + writeLocks + ", waiting locks=" + waiting + "; FOR UPDATE NOWAIT on the variant, its stock level, "
                    + "its holds, the counter and the order row all succeeded");

            // Another checkout of the same institute and the same variant goes through meanwhile.
            long quickStarted = System.nanoTime();
            CheckoutDtos.Placed other = checkoutService.placeOrder(inst, quick, null);
            long quickMillis = (System.nanoTime() - quickStarted) / 1_000_000;
            assertEquals("PENDING_PAYMENT", other.getStatus());
            assertNotNull(other.getPayment(), "with its own gateway order");
            assertFalse(blocked.isDone(), "the first checkout is still waiting for the gateway");
            assertTrue(quickMillis < 10_000, "the second checkout did not wait: " + quickMillis + " ms");
            assertEquals(before - 2, slots(bulk));
            // The order page of the slow order can be read meanwhile, and says payment can be retried.
            assertEquals("PENDING_PAYMENT", queryService.staffDetail(inst, slowOrder).getOrder().getStatus());

            CheckoutDtos.Placed late = blocked.get(60, TimeUnit.SECONDS);
            long slowMillis = (System.nanoTime() - started) / 1_000_000;
            assertTrue(slowMillis >= GATEWAY_BLOCK_MILLIS - 500, "the gateway really blocked: " + slowMillis + " ms");
            assertNotNull(late.getPayment(), "the slow checkout still gets its gateway order");
            assertEquals(late.getPayment().getGatewayOrderId(), text("SELECT gateway_order_id FROM commerce_order "
                    + "WHERE id = ?", slowOrder));
            note("   second checkout took " + quickMillis + " ms while the first waited; the first finished after "
                    + slowMillis + " ms with its gateway order");
        } finally {
            blockNextGatewayCall.set(false);
            pool.shutdownNow();
        }
        assertEquals(0, gatewayCallsInsideATransaction.get(), "no gateway call of this whole run was made inside a "
                + "database transaction (" + gatewayCalls.get() + " calls)");
        note("   gateway calls in this run: " + gatewayCalls.get() + ", of them inside a database transaction: "
                + gatewayCallsInsideATransaction.get());
    }

    // ------------------------------------------------------------------ the counter

    @Test
    @Order(19)
    void twentyCheckoutsAtOnceGetTwentyConsecutiveOrderNumbers() {
        int before = slots(bulk);
        long counterBefore = count("SELECT next_value FROM commerce_counter WHERE institute_id = ? AND scope_key = 'ORD'", inst);
        List<Callable<Object>> tasks = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            CheckoutRequest request = request(nextPhone(), Map.of(bulk, 1));
            tasks.add(() -> checkoutService.placeOrder(inst, request, null));
        }
        long started = System.nanoTime();
        List<Object> results = atOnce(tasks);
        long millis = (System.nanoTime() - started) / 1_000_000;
        TreeSet<Long> numbers = new TreeSet<>();
        for (Object result : results) {
            assertTrue(result instanceof CheckoutDtos.Placed, "all twenty are placed: " + result);
            CheckoutDtos.Placed placed = (CheckoutDtos.Placed) result;
            assertNotNull(placed.getPayment());
            assertTrue(placed.getOrderNumber().matches("ORD-\\d{6}"), placed.getOrderNumber());
            numbers.add(Long.parseLong(placed.getOrderNumber().substring(4)));
        }
        assertEquals(20, numbers.size(), "no number twice");
        assertEquals(19, numbers.last() - numbers.first(), "no gap: " + numbers);
        long counterAfter = count("SELECT next_value FROM commerce_counter WHERE institute_id = ? AND scope_key = 'ORD'", inst);
        assertEquals(20, counterAfter - counterBefore, "the counter moved by exactly twenty");
        assertEquals(before - 20, slots(bulk));
        // Every order number of the institute so far is used once.
        assertEquals(0, count("SELECT count(*) FROM (SELECT order_number FROM commerce_order WHERE institute_id = ? "
                + "GROUP BY order_number HAVING count(*) > 1) d", inst));
        note("== 20 checkouts at once: order numbers " + numbers.first() + ".." + numbers.last() + " without a gap, in "
                + millis + " ms");
    }

    // ------------------------------------------------------------------ a course is untouched

    @Test
    @Order(20)
    void aCoursePaymentThroughTheSameWebhookStillEnrolsAndInvoicesAsBefore() {
        note("");
        note("== control: a COURSE payment through the same webhook route");
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(actor);
        dto.setUsername(actor);
        dto.setFullName("Proof Admin");
        dto.setRootUser(false);
        dto.setAuthorities(List.of("ADMIN"));
        BulkCourseItemDTO course = BulkCourseItemDTO.builder().courseName("Biology Basics " + run).courseType("COURSE")
                .paymentConfig(BulkCoursePaymentConfigDTO.builder().paymentType("ONE_TIME").price(500.0).currency("INR")
                        .validityInDays(30).build())
                .publishToCatalogue(true)
                .inventoryConfig(BulkCourseInventoryConfigDTO.builder().maxSlots(10).availableSlots(10).build())
                .batches(List.of(new BulkCourseBatchDTO())).build();
        BulkAddCourseResponseDTO made = bulkCourseService.bulkAddCourses(
                BulkAddCourseRequestDTO.builder().courses(List.of(course)).build(), inst, new CustomUserDetails(dto));
        assertEquals(1, made.getSuccessCount(), writeJson(made));
        BulkCourseResultDTO result = made.getResults().get(0);
        String pkg = result.getCourseId();
        String batch = result.getPackageSessionIds().get(0);
        String inviteId = result.getEnrollInviteIds().get(0);
        String optionId = result.getPaymentOptionId();
        assertEquals(0, count("SELECT count(*) FROM commerce_product WHERE package_id = ?", pkg), "a course, not a product");

        String learner = "learner-" + run;
        String invitedSession = text("SELECT id FROM package_session WHERE package_id = ? AND status = 'INVITED'", pkg);
        String planId = text("SELECT id FROM payment_plan WHERE payment_option_id = ?", optionId);
        UserPlan learnerPlan = new TransactionTemplate(transactionManager).execute(tx -> {
            PaymentPlan plan = paymentPlanRepository.findById(planId).orElseThrow();
            EnrollInvite invite = enrollInviteRepository.findById(inviteId).orElseThrow();
            PaymentOption option = paymentOptionRepository.findById(optionId).orElseThrow();
            PaymentInitiationRequestDTO payment = new PaymentInitiationRequestDTO();
            payment.setAmount(500.0);
            payment.setCurrency("INR");
            return userPlanService.createUserPlan(learner, plan, null, invite, option, payment, "PENDING_FOR_PAYMENT");
        });
        db.update("INSERT INTO student_session_institute_group_mapping (id, user_id, package_session_id, "
                        + "destination_package_session_id, institute_id, status, type, user_plan_id, enrolled_date) "
                        + "VALUES (?, ?, ?, ?, ?, 'INVITED', 'PACKAGE_SESSION', ?, now())", UUID.randomUUID().toString(),
                learner, invitedSession, batch, inst, learnerPlan.getId());
        // The payment log as the Razorpay flow stores it once the gateway order exists.
        String courseOrderRef = "order-" + learner;
        String logId = paymentLogService.createPaymentLog(learner, 500.0, "RAZORPAY", "RAZORPAY", "INR", learnerPlan,
                courseOrderRef);
        PaymentInitiationRequestDTO original = new PaymentInitiationRequestDTO();
        original.setAmount(500.0);
        original.setCurrency("INR");
        original.setOrderId(courseOrderRef);
        original.setInstituteId(inst);
        original.setEmail(learner + "@example.invalid");
        original.setVendor("RAZORPAY");
        original.setVendorId("RAZORPAY");
        PaymentResponseDTO response = new PaymentResponseDTO();
        response.setOrderId(courseOrderRef);
        response.setStatus("created");
        Map<String, Object> responseData = new HashMap<>();
        responseData.put("razorpayOrderId", "order_course_" + run);
        responseData.put("paymentStatus", "PAYMENT_PENDING");
        responseData.put("amount", 500.0);
        response.setResponseData(responseData);
        Map<String, Object> logData = new HashMap<>();
        logData.put("response", response);
        logData.put("originalRequest", original);
        paymentLogService.updatePaymentLog(logId, "ACTIVE", "PAYMENT_PENDING",
                vacademy.io.admin_core_service.features.common.util.JsonUtil.toJson(logData));
        assertNull(text("SELECT payment_group_id FROM payment_log WHERE id = ?", logId), "a course log has no group");

        reset(workflowTriggerService, paymentNotificatonService, dynamicNotificationService, asyncEnrollmentEmailService,
                invoiceService, authService);
        outsideServicesAnswerLocally();
        int seatsBefore = slots(batch);
        long commerceOrders = count("SELECT count(*) FROM commerce_order");
        long gatewayRows = count("SELECT count(*) FROM commerce_gateway_order");

        // The amount is left out of the event on purpose: with it the legacy code would ask the
        // gateway for a hosted receipt, which is a remote call. Nothing else differs from a real event.
        String payload = event("payment.captured", "order_course_" + run, "pay_course_" + run, null, courseOrderRef);
        HttpResponse<String> answer = postWebhook(payload, hmacHex(WEBHOOK_SECRET, payload));
        assertEquals(200, answer.statusCode());
        assertEquals("Webhook processed successfully", answer.body());

        assertEquals("PAID", text("SELECT payment_status FROM payment_log WHERE id = ?", logId));
        assertEquals("ACTIVE", text("SELECT status FROM user_plan WHERE id = ?", learnerPlan.getId()));
        assertEquals(1, count("SELECT count(*) FROM student_session_institute_group_mapping WHERE user_id = ? "
                + "AND package_session_id = ? AND status = 'ACTIVE' AND user_plan_id = ?", learner, batch,
                learnerPlan.getId()), "the learner is enrolled in the batch on the paid plan");
        assertEquals(2, count("SELECT count(*) FROM user_account_ledger WHERE user_id = ?", learner),
                "accrual and payment in the fee ledger");
        assertEquals(seatsBefore - 1, slots(batch), "the course seat is taken");
        assertTrue(calls(workflowTriggerService) > 0, "the enrolment workflow trigger fires for a course");
        assertTrue(calls(dynamicNotificationService) + calls(asyncEnrollmentEmailService) > 0,
                "the enrolment mails go out for a course");
        assertTrue(calls(paymentNotificatonService) > 0, "the payment confirmation mail goes out for a course");
        assertTrue(mockingDetails(invoiceService).getInvocations().stream()
                .anyMatch(i -> i.getMethod().getName().equals("generateInvoiceWithResult")), "the course invoice is generated");
        assertEquals(commerceOrders, count("SELECT count(*) FROM commerce_order"));
        assertEquals(gatewayRows, count("SELECT count(*) FROM commerce_gateway_order"));
        assertEquals(1, count("SELECT count(*) FROM web_hook WHERE order_id = ? AND status = 'PROCESSED'", courseOrderRef));
        note("   course: plan ACTIVE, enrolled, 2 ledger rows, seat " + seatsBefore + " -> " + slots(batch)
                + "; workflowTriggerService=" + calls(workflowTriggerService) + " paymentNotificatonService="
                + calls(paymentNotificatonService) + " invoiceService=" + calls(invoiceService)
                + " dynamicNotificationService=" + calls(dynamicNotificationService) + " asyncEnrollmentEmailService="
                + calls(asyncEnrollmentEmailService));
    }

    // ------------------------------------------------------------------ redirects

    @Test
    @Order(21)
    void oldUrlsResolveToA301OrA410_byExactPathThenByTheLongestPrefix() {
        String other = UUID.randomUUID().toString();
        Object[][] rows = {
                {inst, "/product/old-kurta", "EXACT", "/p/khadi-kurta?lang=en", 301},
                {inst, "/product/old-kurta?attribute_pa_colour=red", "EXACT", "/p/khadi-kurta?v=KK-RED", 301},
                {inst, "/hi/elementor-123", "EXACT", null, 410},
                {inst, "/product-category/", "PREFIX", "/shop", 301},
                {inst, "/product-category/sarees", "PREFIX", "/c/sarees", 301},
                {inst, "/feed", "PREFIX", null, 410},
                {inst, "/loop", "EXACT", "/loop/", 301},
                {inst, "/away", "EXACT", "https://elsewhere.example/x", 301},
                {other, "/only-theirs", "EXACT", "/p/theirs", 301},
        };
        for (Object[] row : rows) {
            db.update("INSERT INTO site_redirect (id, institute_id, from_path, match_type, to_path, status_code) "
                    + "VALUES (?, ?, ?, ?, ?, ?)", UUID.randomUUID().toString(), row[0], row[1], row[2], row[3], row[4]);
        }
        assertEquals(new SiteRedirectResolver.Redirect(301, "/p/khadi-kurta?lang=en"),
                redirectResolver.resolve(inst, "/Product/Old-Kurta/").orElseThrow());
        assertEquals(new SiteRedirectResolver.Redirect(301, "/p/khadi-kurta?v=KK-RED"),
                redirectResolver.resolve(inst, "/product/old-kurta/?attribute_pa_colour=red").orElseThrow());
        assertEquals(new SiteRedirectResolver.Redirect(301, "/p/khadi-kurta?lang=en"),
                redirectResolver.resolve(inst, "/product/old-kurta?utm_source=x").orElseThrow(), "falls back to the path");
        assertEquals(new SiteRedirectResolver.Redirect(410, null), redirectResolver.resolve(inst, "/hi/elementor-123/").orElseThrow());
        assertEquals(new SiteRedirectResolver.Redirect(301, "/c/sarees"),
                redirectResolver.resolve(inst, "/product-category/sarees/cotton/").orElseThrow(), "the longest prefix wins");
        assertEquals(new SiteRedirectResolver.Redirect(301, "/shop"),
                redirectResolver.resolve(inst, "/product-category/dhoti").orElseThrow());
        assertEquals(new SiteRedirectResolver.Redirect(410, null), redirectResolver.resolve(inst, "/feed/atom").orElseThrow());
        assertTrue(redirectResolver.resolve(inst, "/nothing-here").isEmpty());
        assertTrue(redirectResolver.resolve(inst, "/only-theirs").isEmpty(), "another institute's row is not seen");
        assertTrue(redirectResolver.resolve(inst, "/loop").isEmpty(), "a row that points at itself is not handed out");
        assertTrue(redirectResolver.resolve(inst, "/away").isEmpty(), "a target on another site is not handed out");
        // A printed label leads to the product of an ACTIVE variant of this shop, by its SKU.
        String sku = "BK-" + run;
        SiteRedirectResolver.ScanTarget scanned = redirectResolver.scan(inst, sku).orElseThrow();
        assertEquals("bulk-" + run, scanned.slug());
        assertEquals(sku, scanned.sku());
        assertTrue(redirectResolver.scan(other, sku).isEmpty(), "not through another institute's key");
        assertTrue(redirectResolver.scan(inst, "no-such-code").isEmpty());
        db.update("UPDATE commerce_variant SET status = 'ARCHIVED' WHERE institute_id = ? AND sku = ?", inst, sku);
        assertTrue(redirectResolver.scan(inst, sku).isEmpty(), "a variant that is not on sale is not named");
        db.update("UPDATE commerce_variant SET status = 'ACTIVE' WHERE institute_id = ? AND sku = ?", inst, sku);
        // The constraints of the table.
        assertThrows(org.springframework.dao.DataAccessException.class, () -> db.update("INSERT INTO site_redirect (id, "
                + "institute_id, from_path, match_type, to_path, status_code) VALUES (?, ?, '/x', 'EXACT', '/y', 302)",
                UUID.randomUUID().toString(), inst));
        assertThrows(org.springframework.dao.DataAccessException.class, () -> db.update("INSERT INTO site_redirect (id, "
                + "institute_id, from_path, match_type, to_path, status_code) VALUES (?, ?, '/x', 'EXACT', NULL, 301)",
                UUID.randomUUID().toString(), inst));
        assertThrows(org.springframework.dao.DataAccessException.class, () -> db.update("INSERT INTO site_redirect (id, "
                + "institute_id, from_path, match_type, to_path, status_code) VALUES (?, ?, '/hi/elementor-123', 'EXACT', "
                + "NULL, 410)", UUID.randomUUID().toString(), inst));
    }
    // ================================================================== review round 4
    // Each test below fails on the code as it was before the fix it names.

    /** A new variant with {@code stock} pieces, visible to the cart at once. */
    private String freshVariant(String slug, String sku, String price, int stock) {
        String packageSessionId = variant(slug, sku, price);
        receive(packageSessionId, stock);
        snapshotLoader.evict(inst);
        return packageSessionId;
    }

    /** A coupon of 10 percent with {@code uses} uses. */
    private String coupon(String code, int uses) {
        String couponId = UUID.randomUUID().toString();
        db.update("INSERT INTO coupon_code (id, code, status, source_type, institute_id, is_email_restricted, "
                + "usage_limit, can_be_added) VALUES (?, ?, 'ACTIVE', 'INSTITUTE', ?, false, ?, true)", couponId,
                code, inst, uses);
        db.update("INSERT INTO applied_coupon_discount (id, name, discount_type, status, discount_source, currency, "
                + "discount_point, coupon_code_id, institute_id) VALUES (?, ?, 'PERCENTAGE', 'ACTIVE', "
                + "'COUPON_CODE', 'INR', 10, ?, ?)", UUID.randomUUID().toString(), code, couponId, inst);
        return code;
    }

    private long usesLeft(String code) {
        return count("SELECT usage_limit FROM coupon_code WHERE institute_id = ? AND code = ?", inst, code);
    }

    /** The verified-phone token of a real OTP round trip on this database. */
    private String phoneToken(String phone, String purpose, String ip) {
        otpService.requestOtp(inst, phone, purpose, ip);
        return otpService.verifyOtp(inst, phone, lastOtpCode.get(), purpose, ip);
    }

    private static String otpCode(vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpException e) {
        return e.getCode();
    }

    // ------------------------------------------------------------------ B1: the shop's own OTP

    @Test
    @Order(22)
    void b1_theShopMakesKeepsAndComparesItsOwnCode_oneUse_fiveTries_noSharedStore() {
        note("");
        note("== B1: the OTP of the shop on a real database");
        String phone = nextPhone();
        otpService.requestOtp(inst, phone, "CHECKOUT", "203.0.113.50");
        String code = lastOtpCode.get();
        assertTrue(code.matches("[0-9]{6}"));
        Map<String, Object> row = db.queryForMap("SELECT * FROM commerce_otp_challenge WHERE institute_id = ? "
                + "ORDER BY created_at DESC LIMIT 1", inst);
        assertTrue(String.valueOf(row.get("code_hash")).matches("[0-9a-f]{64}"), "the row keeps an HMAC");
        for (Object value : row.values()) {
            assertFalse(String.valueOf(value).equals(code), "the code is stored nowhere");
            assertFalse(String.valueOf(value).contains(phone), "nor is the phone");
        }
        // The platform was asked for one thing, to deliver; no call exists that asks it whether
        // a code is right, so only the shop's own row can prove a shop code.
        org.mockito.Mockito.verify(otpTransport).send(inst, stored(phone), code);

        String wrong = "000000".equals(code) ? "111111" : "000000";
        assertEquals("OTP_INVALID", otpCode(assertThrows(
                vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpException.class,
                () -> otpService.verifyOtp(inst, phone, wrong, "CHECKOUT", "203.0.113.50"))));
        String token = otpService.verifyOtp(inst, phone, code, "CHECKOUT", "203.0.113.50");
        assertEquals(stored(phone), otpService.verifyToken(inst, token, "CHECKOUT"));
        // Single use: the same code proves nothing a second time.
        assertEquals("OTP_INVALID", otpCode(assertThrows(
                vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpException.class,
                () -> otpService.verifyOtp(inst, phone, code, "CHECKOUT", "203.0.113.50"))));
        // Two tries were counted on the row: the wrong one and the right one.
        assertEquals(2, count("SELECT attempts FROM commerce_otp_challenge WHERE id = ?", row.get("id")));
        assertEquals("VERIFIED", text("SELECT status FROM commerce_otp_challenge WHERE id = ?", row.get("id")));

        // Five wrong tries lock the code, also for the right one.
        String locked = nextPhone();
        otpService.requestOtp(inst, locked, "TRACK_ORDER", "203.0.113.51");
        String lockedCode = lastOtpCode.get();
        String lockedWrong = "000000".equals(lockedCode) ? "111111" : "000000";
        for (int i = 0; i < 5; i++) {
            assertThrows(vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpException.class,
                    () -> otpService.verifyOtp(inst, locked, lockedWrong, "TRACK_ORDER", "203.0.113.51"));
        }
        assertEquals("OTP_LOCKED", otpCode(assertThrows(
                vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpException.class,
                () -> otpService.verifyOtp(inst, locked, lockedCode, "TRACK_ORDER", "203.0.113.51"))));
        note("   code of 6 digits delivered; row keeps code_hash only; wrong -> OTP_INVALID; right -> token; "
                + "again -> OTP_INVALID; 5 wrong then right -> OTP_LOCKED");
    }

    // ------------------------------------------------------------------ M3: a typed phone proves nothing

    @Test
    @Order(23)
    void m3_aPhoneTypedAtCheckoutWritesNothingIntoTheCustomerOfThatPhone() {
        note("");
        note("== M3: checkout with someone else's phone");
        String victimPhone = nextPhone();
        // The victim proves the phone and saves an address.
        CheckoutRequest own = request(victimPhone, Map.of(bulk, 1));
        String victimToken = phoneToken(victimPhone, "CHECKOUT", "203.0.113.60");
        own.setPhoneToken(victimToken);
        own.setMarketingConsent(false);
        own.getShippingAddress().setIsDefault(true);
        CheckoutDtos.Placed ownOrder = checkoutService.placeOrder(inst, own, null);
        String victimUser = text("SELECT user_id FROM commerce_order WHERE id = ?", ownOrder.getOrderId());
        Map<String, Object> before = db.queryForMap("SELECT * FROM commerce_customer WHERE institute_id = ? AND phone = ?",
                inst, stored(victimPhone));
        assertEquals(victimUser, before.get("user_id"));
        assertEquals("Proof Buyer", before.get("name"));
        assertEquals(1, count("SELECT count(*) FROM commerce_customer_address WHERE customer_id = ?", before.get("id")));

        // Someone else types that phone: own e-mail, own address as the default, consent ticked.
        CheckoutRequest forged = request(victimPhone, Map.of(bulk, 1));
        forged.getCustomer().setName("Mallory");
        forged.getCustomer().setEmail("mallory-" + run + "@example.invalid");
        forged.getShippingAddress().setLine1("1 Attacker Lane");
        forged.getShippingAddress().setIsDefault(true);
        forged.setSaveAddress(true);
        forged.setMarketingConsent(true);
        CheckoutDtos.Placed forgedOrder = checkoutService.placeOrder(inst, forged, null);

        Map<String, Object> after = db.queryForMap("SELECT * FROM commerce_customer WHERE institute_id = ? AND phone = ?",
                inst, stored(victimPhone));
        assertEquals(before.get("user_id"), after.get("user_id"));
        assertEquals(before.get("name"), after.get("name"));
        assertEquals(before.get("email"), after.get("email"));
        assertEquals(Boolean.FALSE, after.get("marketing_consent"), "no consent is recorded for the victim's phone");
        assertEquals(1, count("SELECT count(*) FROM commerce_customer_address WHERE customer_id = ?", before.get("id")),
                "the attacker's address is not in the victim's book");
        assertEquals(1, count("SELECT count(*) FROM commerce_customer_address WHERE customer_id = ? AND is_default "
                + "AND line1 = '1 Proof Road'", before.get("id")), "the victim's default address is still the victim's");
        String forgedUser = text("SELECT user_id FROM commerce_order WHERE id = ?", forgedOrder.getOrderId());
        assertFalse(victimUser.equals(forgedUser), "the order is written for the account of the e-mail, not the victim's");
        assertEquals(0, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.user_id = ?", forgedOrder.getOrderId(), victimUser));
        assertEquals(0, count("SELECT count(*) FROM payment_log pl JOIN commerce_order_line l ON l.payment_log_id = pl.id "
                + "WHERE l.order_id = ? AND pl.user_id = ?", forgedOrder.getOrderId(), victimUser));
        // The victim's own address book, read with the proved phone, is unchanged.
        List<CheckoutDtos.AddressView> book = queryService.myAddresses(inst, victimToken);
        assertEquals(1, book.size());
        assertEquals("1 Proof Road", book.get(0).getLine1());
        note("   victim's customer row, consent and address book unchanged; forged order user " + forgedUser
                + " <> victim " + victimUser);
        assertTrue(paymentService.onHoldExpired(ownOrder.getOrderId()));
        assertTrue(paymentService.onHoldExpired(forgedOrder.getOrderId()));
    }

    // ------------------------------------------------------------------ M-1: a second captured payment

    @Test
    @Order(24)
    void m1_aSecondCapturedPaymentForAPaidOrderIsRecordedForARefund_andAReplayIsNot() {
        note("");
        note("== M-1: two gateway orders of one order, both paid");
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(bulk, 1)), null);
        String orderId = placed.getOrderId();
        Map<String, Object> first = gatewayRow(orderId);
        long amount = ((Number) first.get("amount_minor")).longValue();
        // What a claim that went stale during a very slow gateway call leaves behind.
        String second = "order_" + run + "dup";
        db.update("INSERT INTO commerce_gateway_order (id, institute_id, commerce_order_id, vendor, gateway_order_id, "
                + "key_id, amount_minor, currency, receipt, status, status_at) VALUES (?, ?, ?, 'RAZORPAY', ?, ?, ?, "
                + "'INR', ?, 'CREATED', now())", UUID.randomUUID().toString(), inst, orderId, second, KEY_ID, amount,
                orderId);

        String payOne = event("payment.captured", String.valueOf(first.get("gateway_order_id")), "pay_" + run + "one",
                amount, orderId);
        assertEquals(200, postWebhook(payOne, hmacHex(WEBHOOK_SECRET, payOne)).statusCode());
        assertEquals("CONFIRMED", status(orderId));
        int stock = slots(bulk);
        assertEquals(0, count("SELECT count(*) FROM commerce_payment_exception WHERE commerce_order_id = ?", orderId));

        String payTwo = event("payment.captured", second, "pay_" + run + "two", amount, orderId);
        assertEquals(200, postWebhook(payTwo, hmacHex(WEBHOOK_SECRET, payTwo)).statusCode());
        Map<String, Object> recorded = db.queryForMap("SELECT * FROM commerce_payment_exception WHERE commerce_order_id = ?",
                orderId);
        assertEquals("DUPLICATE_PAYMENT", recorded.get("kind"));
        assertEquals("pay_" + run + "two", recorded.get("gateway_payment_id"));
        assertEquals(second, recorded.get("gateway_order_id"));
        assertEquals("OPEN", recorded.get("status"));
        assertEquals(0, new BigDecimal(String.valueOf(recorded.get("amount")))
                .compareTo(BigDecimal.valueOf(amount, 2)));
        assertEquals(placed.getOrderNumber(), recorded.get("order_number"));

        // Either event delivered again adds nothing; the payment that paid is never flagged.
        assertEquals(200, postWebhook(payTwo, hmacHex(WEBHOOK_SECRET, payTwo)).statusCode());
        assertEquals(200, postWebhook(payOne, hmacHex(WEBHOOK_SECRET, payOne)).statusCode());
        assertEquals(1, count("SELECT count(*) FROM commerce_payment_exception WHERE commerce_order_id = ?", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_gateway_order WHERE commerce_order_id = ? AND paying "
                + "AND gateway_payment_id = ?", orderId, "pay_" + run + "one"));
        assertEquals("CONFIRMED", status(orderId));
        assertEquals(stock, slots(bulk));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ?", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE id = ? AND amount_paid = total", orderId));
        note("   second payment " + recorded.get("gateway_payment_id") + " on " + second + ": payment exception "
                + recorded.get("kind") + " " + recorded.get("status") + " amount " + recorded.get("amount")
                + "; replays add nothing");
    }

    // ------------------------------------------------------------------ M-3: the coupon comes back

    @Test
    @Order(25)
    void m3coupon_anAbandonedCheckoutGivesItsCouponUseBack_alsoWhenExpiryRacesWithThePaymentOnRealThreads() {
        note("");
        note("== M-3: coupon use of an unpaid order");
        String two = coupon("TWO" + run.toUpperCase(), 2);
        for (int i = 0; i < 3; i++) {
            CheckoutDtos.Placed abandoned = checkoutService.placeOrder(inst,
                    request(nextPhone(), Map.of(bulk, 1), two), null);
            assertEquals(1, usesLeft(two));
            assertTrue(paymentService.onHoldExpired(abandoned.getOrderId()));
            assertEquals(2, usesLeft(two), "abandoned checkout " + (i + 1) + " drained nothing");
            assertFalse(paymentService.onHoldExpired(abandoned.getOrderId()));
            assertEquals(2, usesLeft(two), "and a second expiry gives nothing back twice");
        }
        // Real buyers still get both uses.
        CheckoutDtos.Placed buyerOne = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(bulk, 1), two), null);
        CheckoutDtos.Placed buyerTwo = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(bulk, 1), two), null);
        assertEquals(0, usesLeft(two));
        assertEquals(200, payByWebhook(buyerOne.getOrderId()).statusCode());
        assertEquals(200, payByWebhook(buyerTwo.getOrderId()).statusCode());
        assertEquals(0, usesLeft(two), "a paid order keeps its use");
        note("   3 abandoned checkouts on a coupon of 2 uses: 2 uses left; then 2 paid orders: 0 left");

        // Expiry and the captured payment at the same moment: whoever wins, the order ends
        // CONFIRMED with exactly its one use taken (never given back and kept, never taken twice).
        for (int round = 1; round <= 12; round++) {
            String once = coupon("RACE" + round + run.toUpperCase(), 1);
            CheckoutDtos.Placed placed = checkoutService.placeOrder(inst,
                    request(nextPhone(), Map.of(bulk, 1), once), null);
            String orderId = placed.getOrderId();
            assertEquals(0, usesLeft(once));
            List<Callable<Object>> race = new ArrayList<>();
            race.add(() -> Boolean.valueOf(paymentService.onHoldExpired(orderId)));
            race.add(() -> Integer.valueOf(payByWebhook(orderId).statusCode()));
            List<Object> results = atOnce(race);
            assertEquals("CONFIRMED", status(orderId), "round " + round + ": " + results);
            assertEquals(0, usesLeft(once), "round " + round + ": the paid order holds its one use: " + results);
            // Settled once, on the state the row had under the lock: one RECEIVED tender, one
            // CONFIRMED row in the history, no cancel reason left on a confirmed order.
            assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = "
                    + "'RECEIVED'", orderId), "round " + round);
            assertEquals(1, count("SELECT count(*) FROM commerce_order_status_history WHERE order_id = ? AND "
                    + "to_status = 'CONFIRMED'", orderId), "round " + round);
            assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE id = ? AND cancel_reason IS NULL AND "
                    + "payment_status = 'PAID'", orderId), "round " + round);
            note("   round " + round + ": expiry " + results.get(0) + ", webhook " + results.get(1)
                    + " -> CONFIRMED, uses left 0");
        }
    }

    // ------------------------------------------------------------------ M-4: only held stock is offered for payment

    @Test
    @Order(26)
    void m4_anOrderWhoseStockIsNoLongerHeldIsNotOfferedForPayment() throws Exception {
        note("");
        note("== M-4: retry payment after the stock went back on sale");
        // (a) The shopper closes the payment window: the storefront releases the hold by token.
        String last = freshVariant("last-b", "LB", "400.00", 1);
        CheckoutDtos.Placed a = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(last, 1)), null);
        assertEquals(0, slots(last));
        assertEquals(1, stockHoldService.releaseForOrderWithToken(a.getHold().getPaymentLogId(),
                a.getHold().getReleaseToken()));
        assertEquals(1, slots(last), "the piece is back on sale");
        // The order is cancelled on a thread of its own, away from the release request.
        long deadline = System.currentTimeMillis() + 10_000L;
        while (!"CANCELLED".equals(status(a.getOrderId())) && System.currentTimeMillis() < deadline) {
            Thread.sleep(50);
        }
        assertEquals("CANCELLED", status(a.getOrderId()), "a shopper release closes the order");
        assertEquals("SHOPPER_RELEASED", text("SELECT cancel_reason FROM commerce_order WHERE id = ?", a.getOrderId()));
        // B buys and pays for that piece.
        CheckoutDtos.Placed b = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(last, 1)), null);
        assertEquals(200, payByWebhook(b.getOrderId()).statusCode());
        assertEquals("CONFIRMED", status(b.getOrderId()));
        // A presses "retry payment": no payment step, so A cannot pay for a piece that is sold.
        CheckoutException refused = assertThrows(CheckoutException.class,
                () -> checkoutService.retryPayment(inst, a.getOrderId(), a.getOrderAccessToken()));
        assertEquals(HttpStatus.CONFLICT, refused.getStatus());
        assertEquals(CheckoutException.ORDER_NOT_PAYABLE, refused.getCode());
        assertEquals(0, count("SELECT count(*) FROM commerce_payment_exception WHERE commerce_order_id = ?",
                a.getOrderId()));
        note("   (a) released by the shopper: order CANCELLED SHOPPER_RELEASED, B paid the piece, A's retry -> "
                + refused.getStatus().value() + " " + refused.getCode());

        // (b) The hold time is over and the expiry job has not run yet: the stored gateway
        //     order is not handed out; the order is closed and its stock goes back.
        String lastToo = freshVariant("last-c", "LC", "400.00", 1);
        CheckoutRequest lateRequest = request(nextPhone(), Map.of(lastToo, 1));
        CheckoutDtos.Placed late = checkoutService.placeOrder(inst, lateRequest, null);
        assertNotNull(late.getPayment());
        db.update("UPDATE commerce_order SET hold_expires_at = now() - interval '1 minute' WHERE id = ?",
                late.getOrderId());
        CheckoutException tooLate = assertThrows(CheckoutException.class,
                () -> checkoutService.retryPayment(inst, late.getOrderId(), late.getOrderAccessToken()));
        assertEquals(CheckoutException.ORDER_NOT_PAYABLE, tooLate.getCode());
        assertEquals("CANCELLED", status(late.getOrderId()));
        assertEquals("PAYMENT_EXPIRED", text("SELECT cancel_reason FROM commerce_order WHERE id = ?", late.getOrderId()));
        assertEquals(1, slots(lastToo), "its stock is back on sale");
        // And the replay of its checkout shows the closed order with no payment step.
        CheckoutDtos.Placed replay = checkoutService.placeOrder(inst, lateRequest, null);
        assertTrue(replay.isReplayed());
        assertEquals("CANCELLED", replay.getStatus());
        assertNull(replay.getPayment());
        note("   (b) past its hold time: retry -> " + tooLate.getStatus().value() + " " + tooLate.getCode()
                + ", order CANCELLED PAYMENT_EXPIRED, stock back");
    }

    // ------------------------------------------------------------------ M-5: one connection per payment thread

    @Test
    @Order(27)
    void m5_eightPaymentsAtTheSameMomentConfirmOnAPoolOfThree_noThreadHoldsOneConnectionAndWaitsForAnother() throws Exception {
        note("");
        note("== M-5: database connections of a paid webhook");
        int payments = 8;
        String poolA = freshVariant("pool-a", "PA", "350.00", 20);
        String poolB = freshVariant("pool-b", "PB", "250.00", 20);
        List<String> orderIds = new ArrayList<>();
        List<String> payloads = new ArrayList<>();
        for (int i = 0; i < payments; i++) {
            CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(poolA, 1, poolB, 1)),
                    null);
            orderIds.add(placed.getOrderId());
            Map<String, Object> row = gatewayRow(placed.getOrderId());
            payloads.add(event("payment.captured", String.valueOf(row.get("gateway_order_id")),
                    "pay_" + run + "pool" + i, ((Number) row.get("amount_minor")).longValue(), placed.getOrderId()));
        }
        com.zaxxer.hikari.HikariDataSource pool = masterDataSource.unwrap(com.zaxxer.hikari.HikariDataSource.class);
        int poolBefore = pool.getMaximumPoolSize();
        long timeoutBefore = pool.getConnectionTimeout();
        java.util.concurrent.atomic.AtomicInteger peak = new java.util.concurrent.atomic.AtomicInteger();
        java.util.concurrent.atomic.AtomicBoolean sampling = new java.util.concurrent.atomic.AtomicBoolean(true);
        Thread sampler = new Thread(() -> {
            while (sampling.get()) {
                peak.accumulateAndGet(pool.getHikariPoolMXBean().getActiveConnections(), Math::max);
                try {
                    Thread.sleep(1);
                } catch (InterruptedException e) {
                    return;
                }
            }
        });
        List<Object> answers;
        try {
            // Eight payments, a pool of three. Threads that use one connection at a time just
            // take turns. A thread that holds one and asks for a second (as the confirm step
            // did, up to three) meets two others doing the same: nobody can go on, each waits
            // out the timeout, and the orders stay unconfirmed.
            pool.getHikariConfigMXBean().setMinimumIdle(1);
            pool.getHikariConfigMXBean().setMaximumPoolSize(POOL_OF_THE_PROOF);
            pool.getHikariConfigMXBean().setConnectionTimeout(8_000L);
            pool.getHikariPoolMXBean().softEvictConnections();
            Thread.sleep(500);
            sampler.start();
            List<Callable<Object>> tasks = new ArrayList<>();
            for (String payload : payloads) {
                tasks.add(() -> Integer.valueOf(postWebhook(payload, hmacHex(WEBHOOK_SECRET, payload)).statusCode()));
            }
            long started = System.currentTimeMillis();
            answers = atOnce(tasks);
            long took = System.currentTimeMillis() - started;
            sampling.set(false);
            sampler.join(2_000L);
            note("   " + payments + " captured webhooks at once, pool " + POOL_OF_THE_PROOF + ": answers " + answers
                    + ", " + took + " ms, peak connections in use " + peak.get());
        } finally {
            sampling.set(false);
            pool.getHikariConfigMXBean().setMaximumPoolSize(poolBefore);
            pool.getHikariConfigMXBean().setConnectionTimeout(timeoutBefore);
        }
        for (Object answer : answers) {
            assertEquals(200, answer, "every webhook is answered: " + answers);
        }
        // Confirmed by the webhook itself, not later by the reconcile job.
        for (String orderId : orderIds) {
            assertEquals("CONFIRMED", status(orderId));
            assertEquals(2, count("SELECT count(*) FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                    + "h.user_plan_id WHERE l.order_id = ? AND h.status = 'SOLD' AND NOT h.oversold", orderId));
        }
        assertTrue(peak.get() <= POOL_OF_THE_PROOF, "peak connections in use: " + peak.get());
    }

    private static final int POOL_OF_THE_PROOF = 3;

    // ------------------------------------------------------------------ M-6: the duplicate is a replay

    @Test
    @Order(28)
    void m6_aDoubleSubmitThatUsesTheLastCouponUseIsAnsweredWithTheOrderOnBothThreads() {
        note("");
        note("== M-6: double submit with the last use of a coupon, on two threads");
        int refusals = 0;
        for (int round = 1; round <= 6; round++) {
            String once = coupon("DBL" + round + run.toUpperCase(), 1);
            CheckoutRequest request = request(nextPhone(), Map.of(bulk, 1), once);
            List<Callable<Object>> twins = new ArrayList<>();
            twins.add(() -> checkoutService.placeOrder(inst, request, null));
            twins.add(() -> checkoutService.placeOrder(inst, request, null));
            List<Object> results = atOnce(twins);
            Set<String> orderIds = new TreeSet<>();
            for (Object result : results) {
                if (result instanceof CheckoutDtos.Placed placed) {
                    orderIds.add(placed.getOrderId());
                } else {
                    refusals++;
                    note("   round " + round + ": a submit was refused: " + result);
                }
            }
            assertEquals(2, results.stream().filter(r -> r instanceof CheckoutDtos.Placed).count(),
                    "round " + round + ": both submits are answered with the order: " + results);
            assertEquals(1, orderIds.size());
            assertEquals(0, usesLeft(once));
            assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE institute_id = ? AND coupon_code = ?", inst,
                    once));
            assertTrue(paymentService.onHoldExpired(orderIds.iterator().next()));
        }
        assertEquals(0, refusals);
        note("   6 rounds: both submits answered with the one order every time, no coupon_not_available");
    }

    // ------------------------------------------------------------------ M2: the limit of a network address

    @Test
    @Order(29)
    void m2_oneNetworkAddressCannotPlaceOrdersWithoutEnd_aNewPhoneAndEmailEachTimeDoNotHelp() {
        note("");
        note("== M2: orders of one network address, counted in the database");
        String address = "198.51.100." + (10 + (int) (Math.random() * 200));
        List<String> placed = new ArrayList<>();
        CheckoutException stopped = null;
        // Twenty in one hold time; the count may straddle two windows, never three.
        for (int i = 0; i < 45 && stopped == null; i++) {
            CheckoutRequest request = request(nextPhone(), Map.of(bulk, 1));
            try {
                placed.add(checkoutService.placeOrder(inst, request, address).getOrderId());
            } catch (CheckoutException e) {
                stopped = e;
            }
        }
        assertNotNull(stopped, "the address was stopped; orders placed: " + placed.size());
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, stopped.getStatus());
        assertEquals(CheckoutException.RATE_LIMITED, stopped.getCode());
        assertTrue(placed.size() >= 20 && placed.size() <= 40, "orders placed before the stop: " + placed.size());
        assertTrue(count("SELECT COALESCE(max(hits), 0) FROM commerce_rate_limit WHERE institute_id = ? AND scope = "
                + "'checkout-order-ip' AND subject_key = ?", inst, address) > 20);
        // Another address is not affected.
        String other = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(bulk, 1)), "198.51.100.250")
                .getOrderId();
        note("   address " + address + ": " + placed.size() + " orders, then " + stopped.getStatus().value() + " "
                + stopped.getCode() + "; another address still places an order");
        placed.add(other);
        for (String orderId : placed) {
            paymentService.onHoldExpired(orderId);
        }
    }

    // ------------------------------------------------------------------ P2: payment fetch, accounts

    /** What Razorpay answers to "the payments of this order", without the network. */
    private void gatewayReports(String gatewayOrderId, List<Map<String, Object>> payments) {
        doReturn(payments).when(razorpay).fetchOrderPayments(org.mockito.ArgumentMatchers.eq(gatewayOrderId), any());
    }

    private static Map<String, Object> rzpPayment(String id, String gatewayOrderId, String status, long amountMinor) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("id", id);
        p.put("order_id", gatewayOrderId);
        p.put("status", status);
        p.put("amount", amountMinor);
        p.put("currency", "INR");
        p.put("created_at", System.currentTimeMillis() / 1000L - 30);
        return p;
    }

    /**
     * Takes every other gateway row of this shop out of the fetch window, so a run of the job
     * looks only at the orders of the test (earlier tests leave unpaid orders behind).
     */
    private void onlyTheseAreFetched(String... orderIds) {
        db.update("UPDATE commerce_gateway_order SET next_fetch_at = now() + interval '1 day', "
                + "final_fetched_at = COALESCE(final_fetched_at, now()) WHERE institute_id = ? "
                + "AND NOT (commerce_order_id = ANY (?))", inst, orderIds);
    }

    /** Puts the gateway row of an order in the fetch window now (the clock is moved, not the code). */
    private void dueNow(String orderId) {
        db.update("UPDATE commerce_gateway_order SET next_fetch_at = now() - interval '1 second' "
                + "WHERE commerce_order_id = ?", orderId);
    }

    /**
     * A time this far from now, as the application writes it (the proof's JVM and its database
     * session may not share a time zone, so the fetch proofs never mix {@code now()} with it).
     */
    private static java.sql.Timestamp fromNow(java.time.Duration offset) {
        return new java.sql.Timestamp(System.currentTimeMillis() + offset.toMillis());
    }

    /** Milliseconds from now to a time column of the gateway row of an order (negative: past). */
    private long millisUntil(String orderId, String column) {
        Object value = gatewayRow(orderId).get(column);
        assertNotNull(value, column);
        return ((java.util.Date) value).getTime() - System.currentTimeMillis();
    }

    private long paidLogs(String orderId) {
        return count("SELECT count(*) FROM payment_log pl JOIN commerce_order o ON o.payment_group_id = "
                + "pl.payment_group_id WHERE o.id = ? AND pl.payment_status = 'PAID'", orderId);
    }

    @Test
    @Order(30)
    void p2_v687IsAppliedAfterV686() {
        assertEquals(1, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version = '687'"));
        assertTrue(count("SELECT installed_rank FROM flyway_schema_history WHERE version = '687'")
                > count("SELECT installed_rank FROM flyway_schema_history WHERE version = '686'"));
        for (String column : List.of("commerce_customer.session_epoch", "commerce_order.phone_verified",
                "commerce_gateway_order.fetch_count", "commerce_gateway_order.next_fetch_at",
                "commerce_gateway_order.last_fetched_at", "commerce_gateway_order.final_fetched_at",
                "commerce_gateway_order.fetch_errors", "commerce_gateway_order.fetch_started_at")) {
            String[] parts = column.split("\\.");
            assertEquals(1, count("SELECT count(*) FROM information_schema.columns WHERE table_name = ? "
                    + "AND column_name = ?", parts[0], parts[1]), column);
        }
        assertEquals(1, count("SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_commerce_gateway_order_fetch'"));
        note("");
        note("== P2: V687 applied after V686; eight columns and the fetch index exist");
    }

    @Test
    @Order(31)
    void p2_lostWebhook_oneFetchConfirmsThePaidOrder_aSecondRunAndALateWebhookChangeNothing() {
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(bulk, 1)), null);
        String orderId = placed.getOrderId();
        String gatewayOrderId = placed.getPayment().getGatewayOrderId();
        long amount = placed.getPayment().getAmountMinor();
        String paymentId = "pay_fetch_" + run;
        gatewayReports(gatewayOrderId, List.of(rzpPayment(paymentId, gatewayOrderId, "captured", amount)));
        // Not due yet: placed a moment ago, nothing scheduled.
        onlyTheseAreFetched(orderId);
        fetchJob.runOnce(new java.util.Date());
        assertEquals("PENDING_PAYMENT", status(orderId));

        dueNow(orderId);
        onlyTheseAreFetched(orderId);
        Map<?, Integer> first = fetchJob.runOnce(new java.util.Date());

        assertEquals(Integer.valueOf(1), first.get(vacademy.io.admin_core_service.features.commerce.order.payment
                .CommercePaymentFetchService.Outcome.CONFIRMED));
        assertEquals("CONFIRMED", status(orderId));
        long logs = paidLogs(orderId);
        assertTrue(logs >= 1);
        assertEquals(0, count("SELECT count(*) FROM user_plan up JOIN commerce_order_line l ON l.user_plan_id = up.id "
                + "WHERE l.order_id = ? AND up.status <> 'ACTIVE'", orderId), "every plan of the order is active");
        Map<String, Object> row = gatewayRow(orderId);
        assertNotNull(row.get("settled_at"), "the gateway row is settled");
        assertEquals(Boolean.TRUE, row.get("paying"));
        assertEquals(1, ((Number) row.get("fetch_count")).intValue());
        long history = count("SELECT count(*) FROM commerce_order_status_history WHERE order_id = ?", orderId);

        // A second run and then the webhook that was lost: nothing more happens.
        dueNow(orderId);
        fetchJob.runOnce(new java.util.Date());
        String payload = event("payment.captured", gatewayOrderId, paymentId, amount, orderId);
        assertEquals(200, postWebhook(payload, hmacHex(WEBHOOK_SECRET, payload)).statusCode());
        assertEquals(logs, paidLogs(orderId));
        assertEquals(history, count("SELECT count(*) FROM commerce_order_status_history WHERE order_id = ?", orderId));
        assertEquals(1, ((Number) gatewayRow(orderId).get("fetch_count")).intValue(), "a settled row is not fetched");
        note("== P2 lost webhook: one fetch run confirmed order " + orderId + " (" + logs + " PAID log(s), row "
                + "settled); a second run and the late webhook changed nothing");
    }

    @Test
    @Order(32)
    void p2_finalFetch_runsInTheGrace_seesACaptureMadeAfterTheHoldTime_andWithoutOneTheHoldJobExpiresTheOrder() {
        // The stock is held three minutes longer than the order.
        CheckoutDtos.Placed paid = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(bulk, 1)), null);
        String paidId = paid.getOrderId();
        String paidGw = paid.getPayment().getGatewayOrderId();
        long holdGap = count("SELECT CAST(EXTRACT(EPOCH FROM (h.expires_at - o.hold_expires_at)) AS BIGINT) "
                + "FROM stock_hold h JOIN payment_log pl ON pl.id = h.payment_log_id "
                + "JOIN commerce_order o ON o.payment_group_id = pl.payment_group_id WHERE o.id = ? LIMIT 1", paidId);
        assertTrue(holdGap >= 170 && holdGap <= 190, "stock held ~3 min past the order's time, was " + holdGap + " s");

        // Its time is 30 s away: no final fetch yet (a payment may still be started).
        db.update("UPDATE commerce_order SET hold_expires_at = ? WHERE id = ?",
                fromNow(java.time.Duration.ofSeconds(30)), paidId);
        gatewayReports(paidGw, List.of());
        onlyTheseAreFetched(paidId);
        fetchJob.runOnce(new java.util.Date());
        assertNull(gatewayRow(paidId).get("last_fetched_at"), "no final fetch before the hold time");

        // 40 s past its time, in the grace: the final fetch finds nothing yet, and goes on.
        db.update("UPDATE commerce_order SET hold_expires_at = ? WHERE id = ?",
                fromNow(java.time.Duration.ofSeconds(-40)), paidId);
        fetchJob.runOnce(new java.util.Date());
        Map<String, Object> inGrace = gatewayRow(paidId);
        assertNotNull(inGrace.get("last_fetched_at"));
        assertNull(inGrace.get("final_fetched_at"), "a fetch that found no capture in the grace does not end it");
        assertNull(inGrace.get("fetch_started_at"), "the row is free again");
        assertEquals("PENDING_PAYMENT", status(paidId));

        // The payment started just before the hold time is captured now, and its webhook is lost.
        gatewayReports(paidGw, List.of(rzpPayment("pay_final_" + run, paidGw, "captured",
                paid.getPayment().getAmountMinor())));
        fetchJob.runOnce(new java.util.Date());
        assertEquals("CONFIRMED", status(paidId));
        assertNotNull(gatewayRow(paidId).get("final_fetched_at"));
        // The hold job comes later and leaves the confirmed order alone.
        stockHoldService.releaseExpired();
        assertEquals("CONFIRMED", status(paidId));

        // No payment: the final fetches find none, the order waits for the hold job, which expires it.
        CheckoutDtos.Placed unpaid = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(bulk, 1)), null);
        db.update("UPDATE commerce_order SET hold_expires_at = ? WHERE id = ?",
                fromNow(java.time.Duration.ofSeconds(-40)), unpaid.getOrderId());
        gatewayReports(unpaid.getPayment().getGatewayOrderId(), List.of());
        onlyTheseAreFetched(unpaid.getOrderId());
        fetchJob.runOnce(new java.util.Date());
        assertEquals("PENDING_PAYMENT", status(unpaid.getOrderId()));
        assertNull(gatewayRow(unpaid.getOrderId()).get("final_fetched_at"));
        long retryIn = millisUntil(unpaid.getOrderId(), "next_fetch_at");
        assertTrue(retryIn > 0 && retryIn <= 120_000L, "asked again next minute, in " + retryIn + " ms");
        // Two minutes past its time the final stage ends and the late schedule starts.
        db.update("UPDATE commerce_order SET hold_expires_at = ? WHERE id = ?",
                fromNow(java.time.Duration.ofSeconds(-130)), unpaid.getOrderId());
        fetchJob.runOnce(new java.util.Date());
        Map<String, Object> row = gatewayRow(unpaid.getOrderId());
        assertNotNull(row.get("final_fetched_at"));
        assertTrue(millisUntil(unpaid.getOrderId(), "next_fetch_at") > 10 * 60_000L, "the late schedule starts");
        assertEquals(2, ((Number) row.get("fetch_count")).intValue());
        stockHoldService.releaseExpired();
        assertEquals("PENDING_PAYMENT", status(unpaid.getOrderId()), "the stock is still held during the grace");
        db.update("UPDATE stock_hold SET expires_at = now() - interval '1 second' WHERE payment_log_id = ?",
                unpaid.getHold().getPaymentLogId());
        stockHoldService.releaseExpired();
        assertEquals("CANCELLED", status(unpaid.getOrderId()));
        assertEquals("PAYMENT_EXPIRED", text("SELECT cancel_reason FROM commerce_order WHERE id = ?",
                unpaid.getOrderId()));
        note("== P2 final fetch: none before the hold time; in the grace a capture made after the hold time was "
                + "found and confirmed; an unpaid order was asked again until 2 min past its time, then expired by "
                + "the hold job only after the grace (stock held " + holdGap + " s past the order's time)");
    }

    @Test
    @Order(33)
    void p2_aLateCaptureFoundByTheFetchOnACancelledOrderTakesTheLatePaymentPath() {
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(bulk, 1)), null);
        String orderId = placed.getOrderId();
        assertTrue(paymentService.onHoldExpired(orderId));
        assertEquals("CANCELLED", status(orderId));
        gatewayReports(placed.getPayment().getGatewayOrderId(), List.of(rzpPayment("pay_late_" + run,
                placed.getPayment().getGatewayOrderId(), "captured", placed.getPayment().getAmountMinor())));
        // Released before any fetch: due 15 minutes after the cancel.
        db.update("UPDATE commerce_order SET cancelled_at = now() - interval '16 minutes', "
                + "updated_at = now() - interval '16 minutes' WHERE id = ?", orderId);

        onlyTheseAreFetched(orderId);
        fetchJob.runOnce(new java.util.Date());

        assertEquals("CONFIRMED", status(orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_status_history WHERE order_id = ? "
                + "AND from_status = 'CANCELLED' AND to_status = 'CONFIRMED' AND note = 'LATE_PAYMENT'", orderId));
        note("== P2 late capture found by the fetch: cancelled order " + orderId + " confirmed as LATE_PAYMENT");
    }

    @Test
    @Order(34)
    void p2_twoFirstOrdersOfOnePhoneAtOnce_oneCustomerRow_bothOrdersInTheAccount() {
        String phone = nextPhone();
        String token = phoneToken(phone, "CHECKOUT", "203.0.113.90");
        List<Object> results = atOnce(List.of(() -> {
            CheckoutRequest r = request(phone, Map.of(bulk, 1));
            r.setPhoneToken(token);
            r.getCustomer().setEmail(null);
            return checkoutService.placeOrder(inst, r, null);
        }, () -> {
            CheckoutRequest r = request(phone, Map.of(bulk, 1));
            r.setPhoneToken(token);
            r.getCustomer().setEmail(null);
            return checkoutService.placeOrder(inst, r, null);
        }));
        for (Object result : results) {
            assertTrue(result instanceof CheckoutDtos.Placed, String.valueOf(result));
        }
        assertEquals(1, count("SELECT count(*) FROM commerce_customer WHERE institute_id = ? AND phone = ?", inst,
                stored(phone)));
        assertEquals(2, count("SELECT count(*) FROM commerce_order o JOIN commerce_customer c ON c.id = o.customer_id "
                + "WHERE c.institute_id = ? AND c.phone = ? AND o.phone_verified", inst, stored(phone)));

        vacademy.io.admin_core_service.features.commerce.customer.CommerceShopperSessions.Issued session =
                shopperSessions.issueForPhone(inst, stored(phone));
        CheckoutDtos.OrderPage page = queryService.myOrders(inst, session.token(), null, 0, 20);
        assertEquals(2, page.getOrders().size());
        assertTrue(page.getOrders().stream().noneMatch(CheckoutDtos.OrderSummary::isMasked));
        note("== P2 two first orders of one phone at once: one customer row, both orders in the account");
        for (Object result : results) {
            paymentService.onHoldExpired(((CheckoutDtos.Placed) result).getOrderId());
        }
    }

    @Test
    @Order(35)
    void p2_twoLogoutsAtOnceRaiseTheEpochTwice_andTheOldSessionIsRefused() {
        String phone = stored(nextPhone());
        vacademy.io.admin_core_service.features.commerce.customer.CommerceShopperSessions.Issued session =
                shopperSessions.issueForPhone(inst, phone);
        assertNotNull(queryService.me(inst, session.token(), null));
        String customerId = text("SELECT id FROM commerce_customer WHERE institute_id = ? AND phone = ?", inst, phone);

        List<Object> results = atOnce(List.of(
                () -> { shopperSessions.endAll(inst, customerId); return "ok"; },
                () -> { shopperSessions.endAll(inst, customerId); return "ok"; }));
        assertEquals(List.of("ok", "ok"), results);
        assertEquals(2, count("SELECT session_epoch FROM commerce_customer WHERE id = ?", customerId));
        CheckoutException e = assertThrows(CheckoutException.class, () -> queryService.me(inst, session.token(), null));
        assertEquals(CheckoutException.SESSION_INVALID, e.getCode());
        note("== P2 two logouts at once: epoch 0 -> 2, the old session is refused");
    }

    @Test
    @Order(36)
    void p2_aPhoneOnlyBuyerGetsAHolderAccount_noMobileIsSentAndATypedEmailNeverPicksTheAccount() {
        reset(authService);
        List<UserDTO> asked = java.util.Collections.synchronizedList(new ArrayList<>());
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), anyString(), anyBoolean()))
                .thenAnswer(call -> {
                    UserDTO user = call.getArgument(0);
                    asked.add(user);
                    UserDTO created = new UserDTO();
                    created.setId("holder-" + run + "-" + users.incrementAndGet());
                    return created;
                });
        String phone = nextPhone();
        CheckoutRequest r = request(phone, Map.of(bulk, 1));
        r.setPhoneToken(phoneToken(phone, "CHECKOUT", "203.0.113.91"));
        r.getCustomer().setEmail("someone-else-" + run + "@example.invalid");
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, r, null);

        assertEquals(1, asked.size());
        assertNull(asked.get(0).getMobileNumber(), "no phone is sent to the account service");
        assertTrue(asked.get(0).getEmail().matches("^b-[0-9a-f]{24}@buyer\\.invalid$"), asked.get(0).getEmail());
        String holder = text("SELECT user_id FROM commerce_order WHERE id = ?", placed.getOrderId());
        assertEquals(holder, text("SELECT user_id FROM commerce_customer WHERE institute_id = ? AND phone = ?", inst,
                stored(phone)));
        assertEquals("someone-else-" + run + "@example.invalid",
                text("SELECT customer_email FROM commerce_order WHERE id = ?", placed.getOrderId()));
        note("== P2 phone-only buyer: holder account " + holder + " (placeholder address, no mobile sent)");
        paymentService.onHoldExpired(placed.getOrderId());
    }

    @Test
    @Order(37)
    void p2_aLateFetchDoesNotConfirmAPartlyRefundedCapture() {
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(bulk, 1)), null);
        String orderId = placed.getOrderId();
        String gw = placed.getPayment().getGatewayOrderId();
        assertTrue(paymentService.onHoldExpired(orderId));
        Map<String, Object> partly = rzpPayment("pay_partref_" + run, gw, "captured",
                placed.getPayment().getAmountMinor());
        partly.put("amount_refunded", 5000L);
        partly.put("refund_status", "partial");
        gatewayReports(gw, List.of(partly));
        db.update("UPDATE commerce_order SET cancelled_at = ?, updated_at = ? WHERE id = ?",
                fromNow(java.time.Duration.ofMinutes(-16)), fromNow(java.time.Duration.ofMinutes(-16)), orderId);
        onlyTheseAreFetched(orderId);

        Map<?, Integer> counts = fetchJob.runOnce(new java.util.Date());

        assertEquals(Integer.valueOf(1), counts.get(vacademy.io.admin_core_service.features.commerce.order.payment
                .CommercePaymentFetchService.Outcome.REFUSED));
        assertEquals("CANCELLED", status(orderId));
        assertEquals(0, paidLogs(orderId));
        assertNull(gatewayRow(orderId).get("settled_at"));
        note("== P2 late fetch: a captured payment with part of it refunded was refused, order " + orderId
                + " stays cancelled");
    }

    @Test
    @Order(38)
    void p2_aRowAnotherRunIsFetchingIsLeftAlone_andAFetchThatDiedFreesItAfterTheLease() {
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(bulk, 1)), null);
        String orderId = placed.getOrderId();
        String gw = placed.getPayment().getGatewayOrderId();
        String rowId = text("SELECT id FROM commerce_gateway_order WHERE commerce_order_id = ?", orderId);

        // One claim wins; a second one at the same time is refused; the result frees the row.
        java.util.Date now = new java.util.Date();
        java.util.Date claimNext = new java.util.Date(now.getTime() + 180_000L);
        java.util.Date stale = new java.util.Date(now.getTime() - 180_000L);
        List<Object> claims = atOnce(List.of(() -> gatewayRows.claimFetch(rowId, now, claimNext, stale),
                () -> gatewayRows.claimFetch(rowId, now, claimNext, stale)));
        assertEquals(1, claims.stream().mapToInt(c -> (Integer) c).sum(), "claims: " + claims);
        gatewayRows.recordFetch(rowId, now, null, null, claimNext);
        assertNull(gatewayRow(orderId).get("fetch_started_at"));
        db.update("UPDATE commerce_gateway_order SET fetch_count = 0 WHERE id = ?", rowId);

        // Another pod's run is asking the gateway about it right now: this run leaves it alone.
        gatewayReports(gw, List.of(rzpPayment("pay_lease_" + run, gw, "captured", placed.getPayment().getAmountMinor())));
        dueNow(orderId);
        onlyTheseAreFetched(orderId);
        db.update("UPDATE commerce_gateway_order SET fetch_started_at = ? WHERE id = ?",
                fromNow(java.time.Duration.ofSeconds(-20)), rowId);
        Map<?, Integer> busy = fetchJob.runOnce(new java.util.Date());
        assertTrue(busy.isEmpty(), "nothing fetched: " + busy);
        assertEquals("PENDING_PAYMENT", status(orderId));
        assertEquals(0, ((Number) gatewayRow(orderId).get("fetch_count")).intValue());

        // That run died 4 minutes ago: the row is fetched again.
        db.update("UPDATE commerce_gateway_order SET fetch_started_at = ? WHERE id = ?",
                fromNow(java.time.Duration.ofMinutes(-4)), rowId);
        Map<?, Integer> again = fetchJob.runOnce(new java.util.Date());
        assertEquals(Integer.valueOf(1), again.get(vacademy.io.admin_core_service.features.commerce.order.payment
                .CommercePaymentFetchService.Outcome.CONFIRMED));
        assertEquals("CONFIRMED", status(orderId));
        assertNull(gatewayRow(orderId).get("fetch_started_at"));
        note("== P2 fetch lease: of two claims at once one won; a row taken 20 s ago was left alone, one taken "
                + "4 min ago was fetched and confirmed");
    }

    @Test
    @Order(39)
    void p2_aFetchSoonAskedWhileAFetchRunsIsKept() {
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(bulk, 1)), null);
        String orderId = placed.getOrderId();
        String gw = placed.getPayment().getGatewayOrderId();
        String rowId = text("SELECT id FROM commerce_gateway_order WHERE commerce_order_id = ?", orderId);
        // Four open fetches done: the next one after this fetch would be 10 minutes away.
        db.update("UPDATE commerce_gateway_order SET fetch_count = 4 WHERE id = ?", rowId);
        dueNow(orderId);
        onlyTheseAreFetched(orderId);
        // While the gateway is being asked, the storefront says the payment went through.
        org.mockito.Mockito.doAnswer(call -> {
            gatewayRows.fetchSoon(rowId, new java.util.Date(System.currentTimeMillis() + 30_000L));
            return List.of();
        }).when(razorpay).fetchOrderPayments(org.mockito.ArgumentMatchers.eq(gw), any());

        fetchJob.runOnce(new java.util.Date());

        assertEquals(5, ((Number) gatewayRow(orderId).get("fetch_count")).intValue());
        long soon = millisUntil(orderId, "next_fetch_at");
        assertTrue(soon <= 60_000L, "the earlier time asked meanwhile is kept, next fetch in " + soon + " ms");

        // Without anything asked meanwhile the schedule is written as usual (now every 30 minutes).
        dueNow(orderId);
        gatewayReports(gw, List.of());
        fetchJob.runOnce(new java.util.Date());
        long slow = millisUntil(orderId, "next_fetch_at");
        assertTrue(slow > 29 * 60_000L && slow <= 30 * 60_000L,
                "an open order is still asked about every 30 minutes, next in " + slow + " ms");
        note("== P2 fetch-soon during a fetch: kept (next fetch within a minute, not the 10-minute step); then the "
                + "slow open schedule (30 min)");
        paymentService.onHoldExpired(orderId);
    }

    @Test
    @Order(40)
    void p2_theLastLateFetchOfALongHoldIsStillInTheWindow() {
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request(nextPhone(), Map.of(bulk, 1)), null);
        String orderId = placed.getOrderId();
        String gw = placed.getPayment().getGatewayOrderId();
        assertTrue(paymentService.onHoldExpired(orderId));
        gatewayReports(gw, List.of(rzpPayment("pay_longhold_" + run, gw, "captured",
                placed.getPayment().getAmountMinor())));
        // A 24 h hold: made 56 h ago, cancelled 31 h 10 min ago; the last late fetch is due now.
        db.update("UPDATE commerce_gateway_order SET created_at = ?, fetch_count = 4, final_fetched_at = ?, "
                + "next_fetch_at = ? WHERE commerce_order_id = ?", fromNow(java.time.Duration.ofHours(-56)),
                fromNow(java.time.Duration.ofHours(-32)), fromNow(java.time.Duration.ofSeconds(-1)), orderId);
        java.sql.Timestamp cancelled = fromNow(java.time.Duration.ofHours(-31).minusMinutes(10));
        db.update("UPDATE commerce_order SET cancelled_at = ?, updated_at = ? WHERE id = ?", cancelled, cancelled,
                orderId);
        onlyTheseAreFetched(orderId);

        fetchJob.runOnce(new java.util.Date());

        assertEquals("CONFIRMED", status(orderId));
        note("== P2 long hold: the late fetch 56 h after the gateway order was made still ran and confirmed "
                + orderId);
    }
}
