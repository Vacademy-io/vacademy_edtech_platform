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
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
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
import vacademy.io.admin_core_service.features.commerce.order.checkout.CheckoutException;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceCheckoutConfig;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceCheckoutService;
import vacademy.io.admin_core_service.features.commerce.order.cod.CommerceCodConfirmTimeoutJob;
import vacademy.io.admin_core_service.features.commerce.order.cod.CommerceCodRemittanceService;
import vacademy.io.admin_core_service.features.commerce.order.cod.dto.CodRemittanceDtos;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceLineCancelService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.ShippingRuleDTO;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceShippingRuleService;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpService;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpTransport;
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
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
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
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

/**
 * Database-backed proof of cash on delivery (WP-31) on a local Postgres with the real Flyway chain
 * (V688 included) and the real Spring context, with the deployment switch on for this context
 * only. A real OTP round trip (the stub transport records the code) proves the phone; then:
 * gate 2 (COD placed, packed, shipped, delivered and paid by a courier remittance); a COD request
 * without a verified phone creates nothing; the staff-confirmation amount, staff confirm and the
 * timer; a remittance of an order with one cancelled line; a remittance that does not add up;
 * the open-COD limit of one phone under two parallel orders; the COD half of gate 3 (RTO); and
 * two parallel remittances naming one order. The reconciliation finds no drift after every step.
 *
 * <p>Same pattern as {@link CommerceOrderDeskDatabaseProofIT}: skipped unless
 * {@code COMMERCE_IT_PG_URL} names a database on this machine; nothing leaves the machine (the
 * auth service and the OTP transport are mocks; no gateway is ever asked). Every tax rate is a
 * TEST placeholder.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CommerceCodDatabaseProofIT {

    private static final String SELLER_GSTIN = "09AAACH7409R1ZZ";
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        registry.add("commerce.order-token.secret", () -> "local-proof-only-not-a-secret");
        registry.add("commerce.turnstile.required", () -> "false");
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "40");
        registry.add("commerce.payment-fetch.cron", () -> "-");
        // The deployment switch, on for this proof only (default false).
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
    @Autowired private CommerceCheckoutConfig checkoutConfig;
    @Autowired private StorefrontSnapshotLoader snapshotLoader;
    @Autowired private CommerceOrderService orderService;
    @Autowired private CommerceCheckoutService checkoutService;
    @Autowired private CommerceOtpService otpService;
    @Autowired private CommerceOrderDeskService desk;
    @Autowired private CommerceShipmentService shipments;
    @Autowired private CommerceLineCancelService lineCancels;
    @Autowired private CommerceCodRemittanceService remittances;
    @Autowired private CommerceCodConfirmTimeoutJob confirmTimeoutJob;
    @Autowired private StockReconciliationJob reconciliationJob;
    @Autowired private ObjectMapper objectMapper;

    @MockBean private AuthService authService;
    @MockBean private InvoiceService invoiceService;
    @MockBean private WorkflowTriggerService workflowTriggerService;
    @MockBean private PaymentNotificatonService paymentNotificatonService;
    @MockBean private DynamicNotificationService dynamicNotificationService;
    @MockBean private AsyncEnrollmentEmailService asyncEnrollmentEmailService;
    @MockBean private MediaService mediaService;
    @MockBean private CommerceRenditionClient renditionClient;
    /** The delivery of a shop OTP (a WhatsApp message): the code it was asked to send is read here. */
    @MockBean private CommerceOtpTransport otpTransport;

    private final String inst = UUID.randomUUID().toString();
    private final String run = inst.substring(0, 8);
    private final String actor = "admin-" + run;
    private final AtomicInteger users = new AtomicInteger();
    private final AtomicInteger keys = new AtomicInteger();
    private final AtomicInteger phones = new AtomicInteger(500);
    private final AtomicInteger ips = new AtomicInteger(10);
    private final Map<String, String> lastCode = new java.util.concurrent.ConcurrentHashMap<>();

    private String wh;
    private String taxClass;
    private String codA;   // 30 in stock, 1000.00
    private String codB;   // 10 in stock, 500.00
    private String big;    // 5 in stock, 3500.00: above the confirmation amount
    private String raceV;  // 10 in stock, 300.00: the parallel orders and remittances

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
            lastCode.put(call.getArgument(1), call.getArgument(2));
            return null;
        }).when(otpTransport).send(anyString(), anyString(), anyString());
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
        return "cod-" + run + "-" + keys.incrementAndGet();
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

    private String newPhone() {
        return "98766" + String.format("%05d", phones.incrementAndGet());
    }

    private static String stored(String phone) {
        return "91" + phone;
    }

    private String nextIp() {
        return "203.0.113." + ips.incrementAndGet();
    }

    /** The verified-phone token of a real OTP round trip on this database. */
    private String phoneToken(String phone) {
        String ip = nextIp();
        otpService.requestOtp(inst, phone, "CHECKOUT", ip);
        String code = lastCode.get(stored(phone));
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
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private List<CartPriceRequest.Line> lines(Map<String, Integer> quantities) {
        List<CartPriceRequest.Line> lines = new ArrayList<>();
        quantities.forEach((variantId, quantity) -> lines.add(CartPriceRequest.Line.builder().variantId(variantId)
                .quantity(quantity).build()));
        return lines;
    }

    private CartPriceSnapshot codPrice(Map<String, Integer> quantities) {
        return orderService.priceCart(inst, CartPriceRequest.builder().lines(lines(quantities)).pincode("226001")
                .paymentMethod("COD").build()).snapshot();
    }

    private CheckoutRequest codRequest(String clientKey, String phone, String token, Map<String, Integer> quantities) {
        CartPriceSnapshot priced = codPrice(quantities);
        assertEquals("COD", priced.getPaymentMethod(), "the cart qualifies for COD");
        return CheckoutRequest.builder()
                .clientRequestId(clientKey)
                .paymentMethod("COD")
                .phoneToken(token)
                .lines(lines(quantities)).expectedTotal(priced.getTotal())
                .customer(CheckoutRequest.Customer.builder().name("Proof Buyer").phone(phone).build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("1 Proof Road").city("Lucknow")
                        .pincode("226001").build())
                .build();
    }

    /** A COD order through the real checkout with a fresh OTP of a new phone. */
    private String codOrder(Map<String, Integer> quantities) {
        String phone = newPhone();
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, codRequest(key(), phone, phoneToken(phone),
                quantities), null);
        assertNull(placed.getPayment());
        assertNull(placed.getHold());
        assertFalse(placed.isPaymentRetryable());
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

    private void pack(String orderId) {
        shipments.pack(admin, inst, ShipmentDtos.PackRequest.builder().clientRequestId(key()).orderId(orderId)
                .fromStatus("CONFIRMED").lines(openLines(orderId)).build());
        assertEquals("PACKED", status(orderId));
    }

    private String liveShipment(String orderId) {
        return text("SELECT id FROM commerce_shipment WHERE order_id = ? AND status <> 'CANCELLED'", orderId);
    }

    private void ship(String orderId) {
        shipments.ship(admin, inst, liveShipment(orderId), ShipmentDtos.ShipRequest.builder()
                .clientRequestId(key()).carrierName("India Post").trackingNumber("EM" + run + keys.get() + "IN")
                .trackingUrl("https://www.indiapost.gov.in/track").build());
        assertEquals("SHIPPED", status(orderId));
    }

    private void toStatus(String orderId, ShipmentDtos.StatusRequest.StatusRequestBuilder b) {
        shipments.status(admin, inst, liveShipment(orderId), b.clientRequestId(key()).build());
    }

    private void deliver(String orderId) {
        toStatus(orderId, ShipmentDtos.StatusRequest.builder().to("DELIVERED"));
        assertEquals("DELIVERED", status(orderId));
    }

    private void move(String orderId, String from, String to) {
        desk.transition(admin, inst, orderId, OrderDeskDtos.TransitionRequest.builder().clientRequestId(key())
                .fromStatus(from).toStatus(to).reason("proof").build());
    }

    private CodRemittanceDtos.RemittanceRequest remittance(String reference, BigDecimal gross, BigDecimal deductions,
                                                           String reason, String... orderIds) {
        return CodRemittanceDtos.RemittanceRequest.builder().clientRequestId(key()).reference(reference)
                .courierName("India Post").receivedOn(LocalDate.now(INDIA)).grossAmount(gross)
                .deductions(deductions).netAmount(gross.subtract(deductions)).differenceReason(reason)
                .orderIds(List.of(orderIds)).build();
    }

    private BigDecimal codAmount(String orderId) {
        return money("SELECT cod_amount FROM commerce_order WHERE id = ?", orderId);
    }

    private long liveInvoices(String orderId) {
        return count("SELECT count(*) FROM invoice i WHERE i.commerce_order_id = ? AND i.cancelled_at IS NULL "
                + "AND i.total_amount > COALESCE((SELECT SUM(cn.total) FROM commerce_credit_note cn "
                + "WHERE cn.invoice_id = i.id), 0)", orderId);
    }

    /** Invariants 1 to 3 and 12 of the contract on one COD order. */
    private void moneyInvariants(String orderId) {
        Map<String, Object> o = db.queryForMap("SELECT * FROM commerce_order WHERE id = ?", orderId);
        BigDecimal total = (BigDecimal) o.get("total");
        BigDecimal paid = (BigDecimal) o.get("amount_paid");
        BigDecimal received = money("SELECT COALESCE(SUM(amount), 0) FROM commerce_order_tender WHERE order_id = ? "
                + "AND status = 'RECEIVED'", orderId);
        assertEquals(0, received.compareTo(paid), "received tenders = amount_paid");
        String status = String.valueOf(o.get("status"));
        if (!"CANCELLED".equals(status) && !"RTO".equals(status)) {
            BigDecimal pending = money("SELECT COALESCE(SUM(amount), 0) FROM commerce_order_tender WHERE order_id = ? "
                    + "AND status = 'PENDING'", orderId);
            assertEquals(0, pending.compareTo(total.subtract(paid)), "pending tenders = total - paid");
            assertEquals(0, total.compareTo((BigDecimal) o.get("cod_amount")), "cod_amount = total");
        }
        BigDecimal logs = money("SELECT COALESCE(SUM(p.payment_amount), 0)::numeric(12,2) FROM payment_log p "
                + "JOIN commerce_order_line l ON l.payment_log_id = p.id WHERE l.order_id = ?", orderId);
        assertEquals(0, logs.compareTo(total.max(paid)), "log amounts = max(total, paid)");
        assertEquals(Boolean.TRUE, o.get("phone_verified"));
        // Invariant 13: a CONSUMED challenge of the order's phone.
        assertTrue(count("SELECT count(*) FROM commerce_otp_challenge WHERE institute_id = ? AND phone_hash = ? "
                + "AND status = 'CONSUMED'", inst, CommerceOtpService.phoneHash(inst, String.valueOf(o.get(
                "customer_phone")))) >= 1, "a COD order has a spent OTP of its phone");
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

    // ------------------------------------------------------------------ seed

    @Test
    @Order(1)
    void seed_aShopWithStockSeriesAndCodSwitchedOn() {
        assertEquals(1, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version = '688'"),
                "V688 is in the Flyway history");
        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", inst,
                "COD Proof " + run, "https://shop-" + run + ".example.com");
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
                .prefix("CI" + run.substring(0, 2)).build());
        seriesService.create(inst, actor, DocumentSeriesDTO.builder().documentType("CREDIT_NOTE")
                .prefix("CC" + run.substring(0, 2)).build());

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

        codA = variant("cod-a", "CA", "1000.00");
        codB = variant("cod-b", "CB", "500.00");
        big = variant("big", "BG", "3500.00");
        raceV = variant("race", "RC", "300.00");
        receive(codA, 30);
        receive(codB, 10);
        receive(big, 5);
        receive(raceV, 10);
        snapshotLoader.evict(inst);

        // No delivery charge; a COD charge of 40.00, taxed with the TEST class.
        Map<String, Object> tier = new HashMap<>();
        tier.put("up_to", null);
        tier.put("charge", BigDecimal.ZERO);
        shippingRuleService.save(inst, actor, ShippingRuleDTO.builder().basis("FLAT").tiers(List.of(tier))
                .codCharge(new BigDecimal("40.00")).taxClassId(taxClass).build());

        // Before the shop switches COD on: the cart says COD_DISABLED, the config not online.
        assertEquals("COD_DISABLED", orderService.priceCart(inst, CartPriceRequest.builder().lines(lines(Map.of(codA,
                1))).pincode("226001").paymentMethod("COD").build()).view().getCod().getReason());
        settings("""
                {"cod": {"enabled": true, "max_order_value": 5000, "staff_confirm_threshold": 3000,
                         "max_open_orders_per_phone": 2, "max_refusals": 2, "confirm_within_hours": 48,
                         "blocked_pincodes": ["190001"]}}""");
        @SuppressWarnings("unchecked")
        Map<String, Object> cod = (Map<String, Object>) checkoutConfig.config(inst).get("cod");
        assertEquals(true, cod.get("online"), "switch on (this context) and the shop on");
        assertEquals(List.of("PREPAID", "COD"), checkoutConfig.config(inst).get("payment_methods"));
        assertEquals("PINCODE_BLOCKED", orderService.priceCart(inst, CartPriceRequest.builder()
                .lines(lines(Map.of(codA, 1))).pincode("190001").paymentMethod("COD").build()).view().getCod()
                .getReason());
        assertEquals(30, slots(codA));
        noDrift("seed");
    }

    // ------------------------------------------------------------------ gate 2

    @Test
    @Order(2)
    void gate2_otpCodPlacedPackedShippedDeliveredAndPaidByARemittance() {
        int available = slots(codA);
        String phone = newPhone();
        String token = phoneToken(phone);
        CheckoutRequest request = codRequest(key(), phone, token, Map.of(codA, 2));
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, request, null);
        String orderId = placed.getOrderId();

        // 2 x 1000 + 5 % + 40 COD charge (+ its tax), below the 3000 confirmation amount.
        assertEquals("CONFIRMED", placed.getStatus());
        assertNull(placed.getPayment());
        assertNull(placed.getHold());
        assertFalse(placed.isPaymentRetryable());
        Map<String, Object> o = db.queryForMap("SELECT * FROM commerce_order WHERE id = ?", orderId);
        assertEquals("COD", o.get("payment_method"));
        assertEquals("UNPAID", o.get("payment_status"));
        assertEquals(Boolean.TRUE, o.get("phone_verified"));
        assertNull(o.get("hold_expires_at"));
        assertNotNull(o.get("confirmed_at"));
        assertNull(o.get("cod_confirm_due_at"));
        assertEquals(0, ((BigDecimal) o.get("total")).compareTo((BigDecimal) o.get("cod_amount")));
        assertTrue(((BigDecimal) o.get("cod_charge")).signum() > 0);
        assertEquals(1, count("SELECT count(*) FROM commerce_order_line WHERE order_id = ? AND line_type = 'COD_CHARGE'",
                orderId), "the COD charge is a line of its own");
        assertEquals(0, count("SELECT count(*) FROM commerce_gateway_order WHERE commerce_order_id = ?", orderId),
                "no gateway order");
        assertEquals("SOLD", text("SELECT h.status FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND l.line_type = 'ITEM'", orderId), "sold at placement");
        assertEquals(available - 2, slots(codA));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND mode = 'COD' AND "
                + "status = 'PENDING' AND amount = ?", orderId, o.get("total")));
        assertEquals(1, count("SELECT count(*) FROM payment_log p JOIN commerce_order_line l ON l.payment_log_id = p.id "
                + "WHERE l.order_id = ? AND p.vendor = 'OFFLINE' AND p.payment_mode = 'COD' "
                + "AND p.payment_status = 'PAYMENT_PENDING'", orderId));
        assertEquals("CONSUMED", text("SELECT status FROM commerce_otp_challenge WHERE institute_id = ? AND phone_hash = ? "
                + "ORDER BY created_at DESC LIMIT 1", inst, CommerceOtpService.phoneHash(inst, stored(phone))));
        assertEquals("verified", text("SELECT CASE WHEN phone IS NOT NULL THEN 'verified' END FROM commerce_customer "
                + "WHERE institute_id = ? AND phone = ?", inst, stored(phone)));
        moneyInvariants(orderId);
        noDrift("placed");

        // The same request again answers the same order; the spent token places nothing more.
        CheckoutDtos.Placed again = checkoutService.placeOrder(inst, request, null);
        assertEquals(orderId, again.getOrderId());
        assertTrue(again.isReplayed());
        CheckoutRequest reuse = codRequest(key(), phone, token, Map.of(codA, 1));
        CheckoutException spent = assertThrows(CheckoutException.class,
                () -> checkoutService.placeOrder(inst, reuse, null));
        assertEquals(HttpStatus.FORBIDDEN, spent.getStatus());
        assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE institute_id = ? AND customer_phone = ?", inst,
                stored(phone)));

        pack(orderId);
        assertEquals(1, liveInvoices(orderId), "one invoice at pack");
        assertEquals(0, money("SELECT total_amount FROM invoice WHERE commerce_order_id = ?", orderId)
                .compareTo((BigDecimal) o.get("total")), "invoice total = order total, COD charge included");
        noDrift("pack");
        ship(orderId);
        noDrift("ship");
        deliver(orderId);
        noDrift("deliver");
        moneyInvariants(orderId);

        BigDecimal due = codAmount(orderId);
        CommerceCodRemittanceService.Recorded recorded = remittances.record(admin, inst,
                remittance("STMT-" + run + "-1", due, new BigDecimal("30.00"), null, orderId));
        assertTrue(recorded.created());
        assertEquals(0, due.compareTo(recorded.view().getOrdersTotal()));
        assertEquals(1, recorded.view().getOrders().size());
        Map<String, Object> paid = db.queryForMap("SELECT * FROM commerce_order WHERE id = ?", orderId);
        assertEquals("PAID", paid.get("payment_status"));
        assertEquals(0, due.compareTo((BigDecimal) paid.get("amount_paid")));
        assertEquals(recorded.view().getId(), paid.get("cod_remittance_id"));
        assertNotNull(paid.get("cod_collected_at"));
        assertEquals("DELIVERED", paid.get("status"));
        assertEquals(0, count("SELECT count(*) FROM payment_log p JOIN commerce_order_line l ON l.payment_log_id = p.id "
                + "WHERE l.order_id = ? AND p.payment_status <> 'PAID'", orderId), "every log PAID");
        assertEquals(0, count("SELECT count(*) FROM user_plan u JOIN commerce_order_line l ON l.user_plan_id = u.id "
                + "WHERE l.order_id = ? AND u.status <> 'ACTIVE'", orderId), "every plan ACTIVE");
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND mode = 'COD' "
                + "AND status = 'RECEIVED' AND reference = ?", orderId, "STMT-" + run + "-1"));
        assertEquals(1, liveInvoices(orderId), "exactly one invoice");
        assertEquals(1, count("SELECT count(*) FROM invoice WHERE commerce_order_id = ?", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_audit WHERE reference_id = ? AND kind = "
                + "'COD_REMITTANCE_RECORDED'", recorded.view().getId()));
        Map<String, Object> row = db.queryForMap("SELECT * FROM commerce_cod_remittance WHERE id = ?",
                recorded.view().getId());
        assertEquals(0, ((BigDecimal) row.get("net_amount")).compareTo(due.subtract(new BigDecimal("30.00"))));
        moneyInvariants(orderId);
        noDrift("remitted");

        // The same remittance again answers the first; delivered can no longer be undone.
        CodRemittanceDtos.RemittanceRequest repeat = remittance("STMT-" + run + "-1", due, new BigDecimal("30.00"),
                null, orderId);
        assertEquals(recorded.view().getId(), remittances.record(admin, inst, repeat).view().getId());
        assertEquals(1, count("SELECT count(*) FROM commerce_cod_remittance WHERE institute_id = ?", inst));
        ConflictException undo = assertThrows(ConflictException.class, () -> move(orderId, "DELIVERED", "SHIPPED"));
        assertTrue(undo.getMessage().startsWith("COD_COLLECTED"), undo.getMessage());
    }

    // ------------------------------------------------------------------ no verified phone

    private Map<String, Object> footprint(String phone) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("orders", count("SELECT count(*) FROM commerce_order WHERE institute_id = ?", inst));
        out.put("lines", count("SELECT count(*) FROM commerce_order_line WHERE institute_id = ?", inst));
        out.put("holds", count("SELECT count(*) FROM stock_hold"));
        out.put("logs", count("SELECT count(*) FROM payment_log"));
        out.put("plans", count("SELECT count(*) FROM user_plan"));
        out.put("tenders", count("SELECT count(*) FROM commerce_order_tender WHERE institute_id = ?", inst));
        out.put("customers", count("SELECT count(*) FROM commerce_customer WHERE institute_id = ?", inst));
        out.put("customerOfPhone", count("SELECT count(*) FROM commerce_customer WHERE institute_id = ? AND phone = ?",
                inst, stored(phone)));
        out.put("refusals", count("SELECT COALESCE(SUM(cod_refusals), 0) FROM commerce_customer WHERE institute_id = ?",
                inst));
        out.put("available", slots(codA));
        out.put("counter", count("SELECT COALESCE(SUM(next_value), 0) FROM commerce_counter WHERE institute_id = ?",
                inst));
        out.put("checkoutLimits", count("SELECT COALESCE(SUM(hits), 0) FROM commerce_rate_limit WHERE institute_id = ? "
                + "AND scope LIKE 'checkout%'", inst));
        out.put("consumed", count("SELECT count(*) FROM commerce_otp_challenge WHERE institute_id = ? AND status = "
                + "'CONSUMED'", inst));
        return out;
    }

    @Test
    @Order(3)
    void aCodRequestWithoutAVerifiedPhoneCreatesNothing() {
        String phone = newPhone();
        String other = newPhone();
        String otherToken = phoneToken(other);
        // A token that was spent already (by an order of its own phone).
        String spentPhone = newPhone();
        String spentToken = phoneToken(spentPhone);
        checkoutService.placeOrder(inst, codRequest(key(), spentPhone, spentToken, Map.of(codA, 1)), null);

        Map<String, Object> before = footprint(phone);
        Map<String, Object> beforeSpent = footprint(spentPhone);
        String ip = "198.51.100.7";
        // No token at all.
        CheckoutException none = assertThrows(CheckoutException.class,
                () -> checkoutService.placeOrder(inst, codRequest(key(), phone, null, Map.of(codA, 1)), ip));
        assertEquals(HttpStatus.FORBIDDEN, none.getStatus());
        assertEquals(CheckoutException.PHONE_VERIFICATION_REQUIRED, none.getCode());
        assertEquals("cod", none.getDetails().get("reason"));
        // The token of another phone.
        CheckoutException otherPhone = assertThrows(CheckoutException.class,
                () -> checkoutService.placeOrder(inst, codRequest(key(), phone, otherToken, Map.of(codA, 1)), ip));
        assertEquals("cod", otherPhone.getDetails().get("reason"));
        assertEquals(before, footprint(phone), "nothing written, no counter taken");
        // A spent token, for its own phone.
        CheckoutException spent = assertThrows(CheckoutException.class,
                () -> checkoutService.placeOrder(inst, codRequest(key(), spentPhone, spentToken, Map.of(codA, 1)), ip));
        assertEquals("cod", spent.getDetails().get("reason"));
        assertEquals(beforeSpent, footprint(spentPhone));
        assertEquals("VERIFIED", text("SELECT status FROM commerce_otp_challenge WHERE institute_id = ? AND "
                + "phone_hash = ?", inst, CommerceOtpService.phoneHash(inst, stored(other))),
                "the other phone's token was only read, not spent");
        noDrift("refused");
    }

    // ------------------------------------------------------------------ staff confirmation and the timer

    @Test
    @Order(4)
    void aboveTheConfirmationAmountStaffConfirmAndTheTimerCancelsAnother() {
        int available = slots(big);
        long before = System.currentTimeMillis();
        String confirmed = codOrder(Map.of(big, 1));
        assertEquals("COD_PENDING_CONFIRMATION", status(confirmed));
        java.sql.Timestamp due = db.queryForObject("SELECT cod_confirm_due_at FROM commerce_order WHERE id = ?",
                java.sql.Timestamp.class, confirmed);
        long hours = (due.getTime() - before) / 3_600_000L;
        assertTrue(hours >= 47 && hours <= 48, "due in 48 hours: " + hours);
        assertEquals("SOLD", text("SELECT h.status FROM stock_hold h JOIN commerce_order_line l ON l.user_plan_id = "
                + "h.user_plan_id WHERE l.order_id = ? AND l.line_type = 'ITEM'", confirmed));
        assertEquals(available - 1, slots(big));
        moneyInvariants(confirmed);
        noDrift("pending");

        move(confirmed, "COD_PENDING_CONFIRMATION", "CONFIRMED");
        assertEquals("CONFIRMED", status(confirmed));
        assertNull(db.queryForObject("SELECT cod_confirm_due_at FROM commerce_order WHERE id = ?",
                java.sql.Timestamp.class, confirmed));
        assertNotNull(db.queryForObject("SELECT confirmed_at FROM commerce_order WHERE id = ?",
                java.sql.Timestamp.class, confirmed));

        String late = codOrder(Map.of(big, 1));
        String notYet = codOrder(Map.of(big, 1));
        assertEquals("COD_PENDING_CONFIRMATION", status(late));
        assertEquals(available - 3, slots(big));
        // Bound from Java, as the writer and the timer bind their dates.
        db.update("UPDATE commerce_order SET cod_confirm_due_at = ? WHERE id = ?",
                new java.sql.Timestamp(System.currentTimeMillis() - 60_000L), late);
        // One run (its ShedLock holds for at least 20 s): the due order is cancelled, the other is left.
        confirmTimeoutJob.run();
        assertEquals("CANCELLED", status(late));
        assertEquals("COD_PENDING_CONFIRMATION", status(notYet), "not due yet: left alone");
        assertEquals("COD_NOT_CONFIRMED", text("SELECT cancel_reason FROM commerce_order WHERE id = ?", late));
        assertNull(db.queryForObject("SELECT cod_confirm_due_at FROM commerce_order WHERE id = ?",
                java.sql.Timestamp.class, late));
        assertEquals(available - 2, slots(big), "the unit is back on sale");
        assertEquals(0, count("SELECT count(*) FROM user_plan u JOIN commerce_order_line l ON l.user_plan_id = u.id "
                + "WHERE l.order_id = ? AND u.status <> 'CANCELED'", late), "plans CANCELED");
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND mode = 'COD' AND "
                + "status = 'VOID'", late));
        assertEquals(0, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = 'PENDING'",
                late));
        assertEquals("CONFIRMED", status(confirmed), "the confirmed one is left alone");
        noDrift("timer");
    }

    // ------------------------------------------------------------------ remittance and a cancelled line

    @Test
    @Order(5)
    void aRemittanceForAnOrderWithOneCancelledLineLeavesThatLinesLogUnpaid() {
        String orderId = codOrder(Map.of(codA, 1, codB, 1));
        assertEquals("CONFIRMED", status(orderId));
        String lineB = text("SELECT id FROM commerce_order_line WHERE order_id = ? AND package_session_id = ?", orderId,
                codB);
        String lineA = text("SELECT id FROM commerce_order_line WHERE order_id = ? AND package_session_id = ?", orderId,
                codA);
        BigDecimal totalBefore = codAmount(orderId);
        int availableB = slots(codB);
        lineCancels.cancelLine(admin, inst, orderId, lineB, OrderDeskDtos.LineCancelRequest.builder()
                .clientRequestId(key()).quantity(1).reason("asked on the phone").build());
        assertEquals(availableB + 1, slots(codB));
        assertTrue(codAmount(orderId).compareTo(totalBefore) < 0, "cod_amount follows the new total");
        moneyInvariants(orderId);
        noDrift("line cancel");

        pack(orderId);
        ship(orderId);
        deliver(orderId);
        BigDecimal due = codAmount(orderId);
        remittances.record(admin, inst, remittance("STMT-" + run + "-2", due, BigDecimal.ZERO, null, orderId));

        assertEquals("PAID", text("SELECT payment_status FROM commerce_order WHERE id = ?", orderId));
        Map<String, Object> logB = db.queryForMap("SELECT p.* FROM payment_log p JOIN commerce_order_line l ON "
                + "l.payment_log_id = p.id WHERE l.id = ?", lineB);
        assertEquals("PAYMENT_PENDING", logB.get("payment_status"), "the cancelled line's log stays unpaid");
        assertEquals(0, ((Number) logB.get("payment_amount")).doubleValue());
        assertEquals("CANCELED", text("SELECT u.status FROM user_plan u JOIN commerce_order_line l ON l.user_plan_id = "
                + "u.id WHERE l.id = ?", lineB));
        assertEquals("PAID", text("SELECT p.payment_status FROM payment_log p JOIN commerce_order_line l ON "
                + "l.payment_log_id = p.id WHERE l.id = ?", lineA));
        assertEquals("ACTIVE", text("SELECT u.status FROM user_plan u JOIN commerce_order_line l ON l.user_plan_id = "
                + "u.id WHERE l.id = ?", lineA));
        moneyInvariants(orderId);
        noDrift("remitted");
    }

    // ------------------------------------------------------------------ a remittance that does not add up

    @Test
    @Order(6)
    void aRemittanceThatDoesNotAddUpIsRefusedWithoutAReasonAndRecordedWithOne() {
        String orderId = codOrder(Map.of(codA, 1));
        pack(orderId);
        ship(orderId);
        deliver(orderId);
        BigDecimal due = codAmount(orderId);
        long rows = count("SELECT count(*) FROM commerce_cod_remittance WHERE institute_id = ?", inst);

        InvalidRequestException refused = assertThrows(InvalidRequestException.class, () -> remittances.record(admin,
                inst, remittance("STMT-" + run + "-3", due.subtract(new BigDecimal("50.00")), BigDecimal.ZERO, null,
                        orderId)));
        assertTrue(refused.getMessage().startsWith("REMITTANCE_DIFFERENCE_REASON_REQUIRED"), refused.getMessage());
        assertEquals(rows, count("SELECT count(*) FROM commerce_cod_remittance WHERE institute_id = ?", inst),
                "nothing written");
        assertEquals("UNPAID", text("SELECT payment_status FROM commerce_order WHERE id = ?", orderId));
        assertNull(text("SELECT cod_remittance_id FROM commerce_order WHERE id = ?", orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = 'PENDING'",
                orderId));
        assertEquals(0, count("SELECT count(*) FROM payment_log p JOIN commerce_order_line l ON l.payment_log_id = p.id "
                + "WHERE l.order_id = ? AND p.payment_status = 'PAID'", orderId));

        // The same courier statement with a written reason is recorded; the order reads PAID in full.
        CommerceCodRemittanceService.Recorded recorded = remittances.record(admin, inst,
                remittance("STMT-" + run + "-3", due.subtract(new BigDecimal("50.00")), BigDecimal.ZERO,
                        "Courier short-paid by 50; claim raised", orderId));
        assertEquals("PAID", text("SELECT payment_status FROM commerce_order WHERE id = ?", orderId));
        assertEquals(0, due.compareTo(money("SELECT amount_paid FROM commerce_order WHERE id = ?", orderId)));
        assertEquals("Courier short-paid by 50; claim raised", text("SELECT difference_reason FROM "
                + "commerce_cod_remittance WHERE id = ?", recorded.view().getId()));
        moneyInvariants(orderId);
        noDrift("short remittance");
    }

    // ------------------------------------------------------------------ the limit of one phone, in parallel

    @Test
    @Order(7)
    void twoParallelCodOrdersOfOnePhoneWithACapOfOneGiveExactlyOneOrder() {
        settings("{\"cod\": {\"max_open_orders_per_phone\": 1}}");
        try {
            String phone = newPhone();
            String first = phoneToken(phone);
            // The one-minute resend gap of the phone is cleared for the proof (a second code a
            // minute later is what a real shopper would get).
            db.update("DELETE FROM commerce_rate_limit WHERE institute_id = ? AND scope = 'otp-send-gap'", inst);
            String second = phoneToken(phone);
            CheckoutRequest a = codRequest(key(), phone, first, Map.of(raceV, 1));
            CheckoutRequest b = codRequest(key(), phone, second, Map.of(raceV, 1));
            int available = slots(raceV);
            List<Object> results = atOnce(List.of(() -> checkoutService.placeOrder(inst, a, null),
                    () -> checkoutService.placeOrder(inst, b, null)));
            int placed = 0;
            for (Object result : results) {
                if (result instanceof CheckoutDtos.Placed) {
                    placed++;
                } else {
                    assertInstanceOf(CheckoutException.class, result, String.valueOf(result));
                    CheckoutException e = (CheckoutException) result;
                    assertEquals(CheckoutException.PAYMENT_METHOD_NOT_AVAILABLE, e.getCode());
                    assertEquals("OPEN_COD_ORDERS", e.getDetails().get("reason"));
                }
            }
            assertEquals(1, placed, "exactly one placed: " + results);
            assertEquals(1, count("SELECT count(*) FROM commerce_order WHERE institute_id = ? AND customer_phone = ?",
                    inst, stored(phone)));
            assertEquals(available - 1, slots(raceV));
            assertEquals(1, count("SELECT count(*) FROM commerce_otp_challenge WHERE institute_id = ? AND phone_hash = ? "
                    + "AND status = 'CONSUMED'", inst, CommerceOtpService.phoneHash(inst, stored(phone))),
                    "the losing request's token was given back by the rollback");
            noDrift("parallel orders");
        } finally {
            settings("{\"cod\": {\"max_open_orders_per_phone\": 2}}");
        }
    }

    // ------------------------------------------------------------------ gate 3, COD half

    @Test
    @Order(8)
    void gate3_codHalf_rtoVoidsTheTenderCountsARefusalAndKeepsTheUnitOffSale() {
        String orderId = codOrder(Map.of(codA, 1));
        String phone = text("SELECT customer_phone FROM commerce_order WHERE id = ?", orderId);
        pack(orderId);
        ship(orderId);
        int afterShip = slots(codA);
        long refusals = count("SELECT cod_refusals FROM commerce_customer WHERE institute_id = ? AND phone = ?", inst,
                phone);
        noDrift("ship");

        toStatus(orderId, ShipmentDtos.StatusRequest.builder().to("RTO").rtoReason("REFUSED"));
        assertEquals("RTO", status(orderId));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND mode = 'COD' AND "
                + "status = 'VOID'", orderId));
        assertEquals(0, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = 'PENDING'",
                orderId));
        assertEquals(refusals + 1, count("SELECT cod_refusals FROM commerce_customer WHERE institute_id = ? AND "
                + "phone = ?", inst, phone));
        assertEquals(0, liveInvoices(orderId), "the RTO credits the invoice in full");
        assertEquals(1, count("SELECT count(*) FROM commerce_credit_note WHERE commerce_order_id = ?", orderId));
        assertEquals(0, count("SELECT count(*) FROM user_plan u JOIN commerce_order_line l ON l.user_plan_id = u.id "
                + "WHERE l.order_id = ? AND u.status <> 'CANCELED'", orderId), "unpaid plans CANCELED");
        assertEquals(afterShip, slots(codA), "not buyable until it is received back");
        noDrift("rto");

        String line = text("SELECT id FROM commerce_order_line WHERE order_id = ? AND line_type = 'ITEM'", orderId);
        toStatus(orderId, ShipmentDtos.StatusRequest.builder().to("RTO_RECEIVED").lines(List.of(
                ShipmentDtos.StatusLine.builder().orderLineId(line).condition("RESALEABLE").quantity(1).build())));
        assertEquals(afterShip + 1, slots(codA), "back on sale");
        assertEquals(0, ((BigDecimal) db.queryForObject("SELECT refund_due FROM commerce_order WHERE id = ?",
                BigDecimal.class, orderId)).signum(), "nothing was paid, nothing is due back");
        noDrift("rto received");
    }

    // ------------------------------------------------------------------ parallel remittances

    @Test
    @Order(9)
    void twoParallelRemittancesNamingOneOrderGiveOneWinnerAndOne409() {
        String orderId = codOrder(Map.of(raceV, 1));
        pack(orderId);
        ship(orderId);
        deliver(orderId);
        BigDecimal due = codAmount(orderId);
        CodRemittanceDtos.RemittanceRequest one = remittance("STMT-" + run + "-R1", due, BigDecimal.ZERO, null,
                orderId);
        CodRemittanceDtos.RemittanceRequest two = remittance("STMT-" + run + "-R2", due, BigDecimal.ZERO, null,
                orderId);
        List<Object> results = atOnce(List.of(() -> remittances.record(admin, inst, one),
                () -> remittances.record(admin, inst, two)));
        int won = 0;
        for (Object result : results) {
            if (result instanceof CommerceCodRemittanceService.Recorded recorded) {
                assertTrue(recorded.created());
                won++;
            } else {
                assertInstanceOf(ConflictException.class, result, String.valueOf(result));
                assertTrue(((ConflictException) result).getMessage().startsWith("REMITTANCE_ORDER_NOT_DUE"),
                        ((ConflictException) result).getMessage());
            }
        }
        assertEquals(1, won, "one winner: " + results);
        assertEquals(1, count("SELECT count(*) FROM commerce_cod_remittance WHERE institute_id = ? AND reference IN "
                + "(?, ?)", inst, "STMT-" + run + "-R1", "STMT-" + run + "-R2"));
        assertEquals(1, count("SELECT count(*) FROM commerce_order_tender WHERE order_id = ? AND status = 'RECEIVED'",
                orderId));
        moneyInvariants(orderId);
        noDrift("parallel remittances");
    }

    // ------------------------------------------------------------------ every COD order

    @Test
    @Order(10)
    void everyCodOrderHasAProvedPhoneAndASpentOtp() {
        List<String> ids = db.queryForList("SELECT id FROM commerce_order WHERE institute_id = ? AND payment_method = "
                + "'COD'", String.class, inst);
        assertTrue(ids.size() >= 8, "orders: " + ids.size());
        for (String id : ids) {
            assertEquals(Boolean.TRUE, db.queryForObject("SELECT phone_verified FROM commerce_order WHERE id = ?",
                    Boolean.class, id));
            String phone = text("SELECT customer_phone FROM commerce_order WHERE id = ?", id);
            assertTrue(count("SELECT count(*) FROM commerce_otp_challenge WHERE institute_id = ? AND phone_hash = ? "
                    + "AND status = 'CONSUMED'", inst, CommerceOtpService.phoneHash(inst, phone)) >= 1, id);
            assertEquals(0, count("SELECT count(*) FROM commerce_gateway_order WHERE commerce_order_id = ?", id));
        }
        // A COD order is never on the lists of the payment jobs: none is PENDING_PAYMENT.
        assertEquals(0, count("SELECT count(*) FROM commerce_order WHERE institute_id = ? AND payment_method = 'COD' "
                + "AND status = 'PENDING_PAYMENT'", inst));
        noDrift("end");
    }
}
