package vacademy.io.admin_core_service.features.commerce;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
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
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.AdminCoreServiceApplication;
import vacademy.io.admin_core_service.features.auth_service.service.AsyncEnrollmentEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.ReissueB2bRequest;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceCreditNoteService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceInvoiceService;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionClient;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceCheckoutService;
import vacademy.io.admin_core_service.features.commerce.order.cod.CommerceCodRemittanceService;
import vacademy.io.admin_core_service.features.commerce.order.cod.dto.CodRemittanceDtos;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceReceiptService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStaffOrderService;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.OrderDeskDtos;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.StaffOrderRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.ShippingRuleDTO;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceShippingRuleService;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpService;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpTransport;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosCorrectionService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosRegisterService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosReturnService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSaleService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSessionService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSettingsService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosUserNames;
import vacademy.io.admin_core_service.features.commerce.report.controller.CommerceAuditController;
import vacademy.io.admin_core_service.features.commerce.report.controller.CommerceReportController;
import vacademy.io.admin_core_service.features.commerce.report.service.CodDuesReportService;
import vacademy.io.admin_core_service.features.commerce.report.service.DayBookService;
import vacademy.io.admin_core_service.features.commerce.report.service.GstReportService;
import vacademy.io.admin_core_service.features.commerce.report.service.PaymentModesService;
import vacademy.io.admin_core_service.features.commerce.report.service.PosSessionsReportService;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportAccess;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRunner;
import vacademy.io.admin_core_service.features.commerce.report.service.SalesReportService;
import vacademy.io.admin_core_service.features.commerce.returns.dto.RefundDtos;
import vacademy.io.admin_core_service.features.commerce.returns.dto.ReturnDtos;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundService;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceReturnService;
import vacademy.io.admin_core_service.features.commerce.security.CommercePinService;
import vacademy.io.admin_core_service.features.commerce.shipment.dto.ShipmentDtos;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockTransferController;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos;
import vacademy.io.admin_core_service.features.commerce.stock.scheduler.StockReconciliationJob;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
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
import vacademy.io.admin_core_service.features.payments.manager.RazorpayPaymentManager;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.StringReader;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

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
 * WP-50 gate 9 against a real Postgres 16 with the whole Flyway chain and the real Spring context:
 * a test month of the shop is made through the real services (online checkout paid by a signed
 * webhook, COD orders remitted, outstanding, in transit and RTO, counter sales with round-off, a
 * void, a B2B bill and a reissue, a 0% bill, measured cloth by length, counter returns incl. a
 * capped note with negative round-off, paper bill-book entries with a skipped page, a part-paid
 * staff credit order (whose return before payment the desk refuses), a paid staff order with a
 * return, a back-dated credit note, a delivery challan, two places
 * with two GSTINs), and every report of contract section 2 is held against sums the proof computes
 * itself from the document tables ({@code invoice}, {@code invoice_line_item},
 * {@code commerce_credit_note(_line)}, tenders, refunds, cash movements). Never against report code.
 *
 * <p>Date controls moved by SQL after seeding (the services date every document "today"): one paid
 * online invoice (order F) is moved to the last day of the previous month with its tender at
 * 18:29 UTC that day (23:59 India), and gets a credit note back-dated to that day; order A's
 * gateway tender is moved to 18:31 UTC on the last day of the previous month (00:01 India on the
 * 1st); COD order C's delivery is moved 3 days back and COD order D's 12 days back so the
 * "as of" rules and the red flag have something to show.
 *
 * <p>Runs only when {@code COMMERCE_IT_PG_URL} names a database on this machine. Every tax rate is
 * a TEST placeholder; GSTINs are test numbers with a valid check character.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CommerceReportsDatabaseProofIT {

    private static final String G1 = "09AAACH7409R1ZZ";
    private static final String G2 = "09AAACH7409R2ZY";
    private static final String B2B_GSTIN = "09AABCB1234C1ZC";
    private static final String REISSUE_GSTIN = "09AABCR5678D1Z6";
    private static final String PIN = "482917";
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final String WEBHOOK_SECRET = "whsec-local-proof-only";
    private static final String KEY_SECRET = "key-secret-local-proof-only";
    private static final String KEY_ID = "rzp_test_localproof";
    private static final String WEBHOOK_PATH = "/admin-core-service/payments/webhook/callback/razorpay";
    private static final String PINCODE = "100001";
    private static final String HYPERLINK = "=HYPERLINK(\"http://x\")";
    private static final BigDecimal ZERO = new BigDecimal("0.00");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "24");
        registry.add("commerce.order-token.secret", () -> "local-proof-only-not-a-secret");
        registry.add("commerce.turnstile.required", () -> "false");
        registry.add("commerce.payment-fetch.cron", () -> "-");
        registry.add("commerce.refund-poll.cron", () -> "-");
        registry.add("commerce.cod-confirm-timeout.cron", () -> "-");
        registry.add("commerce.cod.placement-enabled", () -> "true");
    }

    /** The JVM zone before this proof; put back after it. */
    private static final java.util.TimeZone PREVIOUS_ZONE = java.util.TimeZone.getDefault();

    static {
        // Production runs admin_core in UTC: stored timestamps are UTC wall times and the report SQL
        // buckets them with AT TIME ZONE 'UTC' (contract 3.1). This proof runs the same way, whatever
        // the zone of the machine; the zone is put back after the class.
        java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
        System.setProperty("https.proxyHost", "127.0.0.1");
        System.setProperty("https.proxyPort", "9");
        System.setProperty("http.nonProxyHosts", "localhost|127.0.0.1");
    }

    @Autowired private JdbcTemplate db;
    @Autowired private NamedParameterJdbcTemplate namedJdbc;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private CapabilityResolver capabilityResolver;
    @Autowired private CommerceProductService productService;
    @Autowired private StockLocationService locationService;
    @Autowired private StockReceiptService receiptService;
    @Autowired private CommerceTaxSettingService taxSettingService;
    @Autowired private CommerceTaxClassService taxClassService;
    @Autowired private CommerceDocumentSeriesService seriesService;
    @Autowired private StorefrontSnapshotLoader snapshotLoader;
    @Autowired private StockReconciliationJob reconciliationJob;
    @Autowired private CommercePinService pinService;
    @Autowired private CommerceOrderService orderService;
    @Autowired private CommerceCheckoutService checkoutService;
    @Autowired private CommerceShippingRuleService shippingRuleService;
    @Autowired private CommerceCheckoutSettingsService checkoutSettings;
    @Autowired private CommerceOtpService otpService;
    @Autowired private CommerceShipmentService shipments;
    @Autowired private CommerceCodRemittanceService remittances;
    @Autowired private CommerceStaffOrderService staffOrders;
    @Autowired private CommerceReceiptService receipts;
    @Autowired private CommerceReturnService returns;
    @Autowired private CommerceRefundService refunds;
    @Autowired private CommerceInvoiceService invoices;
    @Autowired private CommerceCreditNoteService creditNotes;
    @Autowired private PosRegisterService registers;
    @Autowired private PosSessionService sessions;
    @Autowired private PosSaleService sales;
    @Autowired private PosSettingsService settings;
    @Autowired private PosReturnService posReturns;
    @Autowired private PosCorrectionService corrections;
    @Autowired private StockTransferController transfers;
    @Autowired private CommerceReportController reports;
    @Autowired private CommerceAuditController auditList;
    @Autowired private ReportAccess reportAccess;
    @Autowired private ReportRunner reportRunner;
    @Autowired private StockClock stockClock;
    @Autowired private GstReportService gstReports;
    @Autowired private DayBookService dayBookService;
    @Autowired private PaymentModesService paymentModesService;
    @Autowired private CodDuesReportService codDuesService;
    @Autowired private PosSessionsReportService posSessionsService;
    @Autowired private SalesReportService salesReportService;
    @Autowired private PosUserNames userNames;
    @Autowired private CommerceAuditService auditService;
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
    @MockBean private CommerceOtpTransport otpTransport;

    private final String inst = UUID.randomUUID().toString();
    private final String otherInst = UUID.randomUUID().toString();
    private final String run = inst.substring(0, 8);
    private final String r2 = run.substring(0, 2).toUpperCase();
    private final AtomicInteger keys = new AtomicInteger();
    private final AtomicInteger phones = new AtomicInteger(700);
    private final AtomicInteger ips = new AtomicInteger(20);
    private final AtomicInteger gatewayOrders = new AtomicInteger();
    private final AtomicInteger buyers = new AtomicInteger();
    private final Map<String, String> lastCode = new ConcurrentHashMap<>();

    private final String adminId = "admin-" + run;
    private final String cashierId = "cashier-" + run;
    private final String managerId = "manager-" + run;
    private final String accountantId = "accountant-" + run;
    private final String warehouseId = "warehouse-" + run;
    private CustomUserDetails admin;
    private CustomUserDetails cashier;
    private CustomUserDetails manager;
    private CustomUserDetails accountant;
    private CustomUserDetails warehouse;

    private LocalDate today;
    private LocalDate monthStart;
    private LocalDate prevLast;

    private String l1;
    private String l2;
    private String l3;
    private String r1;
    private String r2Register;
    private String clothClass;
    private String steelClass;
    private String garmentClass;
    private String zeroClass;
    private String shippingClass;
    private String cotton;
    private String bottle;
    private String bottleSku;
    private String scarf;
    private String yarn;
    private String ribbon;
    private String cup;
    private String cupSku;

    // the orders of the month
    private String orderA;
    private String orderB;
    private String orderC;
    private String orderD;
    private String orderE;
    private String orderF;
    private String orderG;
    private String orderH;
    private String p1;
    private String p2;
    private String p3;
    private String p4;
    private String p5;
    private String p6;
    private String pRibbon;
    private String p7;
    private String staffOrder;
    private String staffPaid;
    private String sessionR1;
    private String sessionR2;
    private String p3Number;
    private String p5FirstInvoice;
    private String p5Reissued;
    private String noteB;
    private String noteP5;
    private String noteF;
    private String cappedNote;
    private String remittanceId;
    private String transferNumber;

    @BeforeEach
    void local() {
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), anyString(), anyBoolean()))
                .thenAnswer(call -> {
                    UserDTO user = new UserDTO();
                    user.setId("buyer-" + run + "-" + buyers.incrementAndGet());
                    return user;
                });
        when(authService.getUsersFromAuthServiceByUserIds(any())).thenAnswer(call -> {
            List<UserDTO> out = new ArrayList<>();
            Object asked = call.getArgument(0);
            if (asked instanceof java.util.Collection<?> ids) {
                for (Object id : ids) {
                    String name = id.equals(cashierId) ? "Test Cashier" : id.equals(adminId) ? "Test Admin"
                            : id.equals(managerId) ? "Test Manager" : null;
                    if (name != null) {
                        UserDTO user = new UserDTO();
                        user.setId(String.valueOf(id));
                        user.setFullName(name);
                        out.add(user);
                    }
                }
            }
            return out;
        });
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
            lastCode.put(call.getArgument(1), call.getArgument(2));
            return null;
        }).when(otpTransport).send(anyString(), anyString(), anyString());
        header(inst);
        admin = user(adminId, "ADMIN");
        cashier = user(cashierId, "COMMERCE_POS_CASHIER");
        manager = user(managerId, "COMMERCE_STORE_MANAGER");
        accountant = user(accountantId, "COMMERCE_ACCOUNTANT");
        warehouse = user(warehouseId, "COMMERCE_WAREHOUSE_STAFF");
        today = LocalDate.now(INDIA);
        monthStart = today.withDayOfMonth(1);
        prevLast = monthStart.minusDays(1);
    }

    @AfterEach
    void reconciled() {
        header(inst);
        for (String open : db.queryForList("SELECT id FROM pos_session WHERE institute_id = ? AND status = 'OPEN'",
                String.class, inst)) {
            sessions.close(admin, inst, open, new PosDtos.SessionCloseRequest(key(), expected(open), null, null, null));
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

    private static CustomUserDetails user(String id, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(id);
        dto.setUsername(id);
        dto.setFullName("Proof " + id);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private String key() {
        return "rp-" + run + "-" + keys.incrementAndGet();
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
        BigDecimal value = db.queryForObject(query, BigDecimal.class, args);
        return value == null ? ZERO : value;
    }

    private static BigDecimal amount(String value) {
        return new BigDecimal(value);
    }

    private static void same(BigDecimal expected, BigDecimal actual, String what) {
        assertNotNull(actual, what + ": no value");
        assertEquals(0, expected.compareTo(actual), what + ": expected " + expected + ", got " + actual);
    }

    private static void same(BigDecimal expected, JsonNode actual, String what) {
        same(expected, dec(actual), what);
    }

    private static BigDecimal dec(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return null;
        }
        return node.isNumber() ? node.decimalValue() : new BigDecimal(node.asText());
    }

    private static BigDecimal decOr0(JsonNode node) {
        BigDecimal value = dec(node);
        return value == null ? BigDecimal.ZERO : value;
    }

    private static void note(String line) {
        System.out.println("REPORTS-PROOF " + line);
    }

    private void noDrift(String step) {
        List<StockReconciliationJob.Drift> drift = reconciliationJob.findSellableDrift().stream()
                .filter(d -> inst.equals(d.instituteId())).toList();
        assertTrue(drift.isEmpty(), "drift after " + step + ": " + drift);
    }

    /** The refusal's message starts with {@code code}; returns the refusal. */
    private static RuntimeException refused(String code, Executable call) {
        RuntimeException e = assertThrows(RuntimeException.class, call);
        assertTrue(e.getMessage() != null && e.getMessage().startsWith(code), "expected " + code + ", got " + e);
        return e;
    }

    private String status(String orderId) {
        return text("SELECT status FROM commerce_order WHERE id = ?", orderId);
    }

    private String orderNumber(String orderId) {
        return text("SELECT order_number FROM commerce_order WHERE id = ?", orderId);
    }

    private String liveInvoice(String orderId) {
        return text("SELECT id FROM invoice WHERE commerce_order_id = ? AND cancelled_at IS NULL ORDER BY created_at "
                + "LIMIT 1", orderId);
    }

    private String invoiceNumber(String invoiceId) {
        return text("SELECT invoice_number FROM invoice WHERE id = ?", invoiceId);
    }

    private String locationName(String locationId) {
        return text("SELECT name FROM stock_location WHERE id = ?", locationId);
    }

    // ---------------------------------------------------------------- report calls

    /** Report parameters as name/value pairs. */
    private static Map<String, String> p(String... pairs) {
        Map<String, String> out = new LinkedHashMap<>();
        for (int i = 0; i + 1 < pairs.length; i += 2) {
            if (pairs[i + 1] != null) {
                out.put(pairs[i], pairs[i + 1]);
            }
        }
        return out;
    }

    private Map<String, String> month(String... pairs) {
        Map<String, String> out = p("from", monthStart.toString(), "to", today.toString(), "size", "200");
        out.putAll(p(pairs));
        return out;
    }

    private static LocalDate date(String value) {
        return value == null ? null : LocalDate.parse(value);
    }

    private ResponseEntity<?> call(CommerceReportController controller, CustomUserDetails who, String name,
                                   Map<String, String> q) {
        return controller.report(who, name, inst, date(q.get("from")), date(q.get("to")), q.get("month"),
                q.get("locationId"), q.get("channel"), q.get("sellerGstin"), q.get("status"), q.get("b2clLimit"),
                q.get("cursor"), q.get("size") == null ? null : Integer.valueOf(q.get("size")), q.get("groupBy"),
                date(q.get("asOf")), q.get("format"), "en", null);
    }

    private JsonNode report(CustomUserDetails who, String name, Map<String, String> q) {
        ResponseEntity<?> answer = call(reports, who, name, q);
        assertEquals(200, answer.getStatusCode().value());
        return objectMapper.valueToTree(answer.getBody());
    }

    private JsonNode report(String name, Map<String, String> q) {
        return report(admin, name, q);
    }

    private byte[] file(String name, Map<String, String> q, String format) {
        Map<String, String> asked = new LinkedHashMap<>(q);
        asked.put("format", format);
        ResponseEntity<?> answer = call(reports, admin, name, asked);
        assertEquals(200, answer.getStatusCode().value());
        return (byte[]) answer.getBody();
    }

    private static JsonNode section(JsonNode answer, String key) {
        for (JsonNode s : answer.path("sections")) {
            if (key.equals(s.path("key").asText())) {
                return s;
            }
        }
        throw new AssertionError("no section " + key + " in " + answer.path("report").asText());
    }

    private static List<JsonNode> rows(JsonNode block) {
        List<JsonNode> out = new ArrayList<>();
        block.path("rows").forEach(out::add);
        return out;
    }

    private static boolean hasWarning(JsonNode answer, String code) {
        for (JsonNode w : answer.path("warnings")) {
            if (code.equals(w.path("code").asText())) {
                return true;
            }
        }
        return false;
    }

    private static Set<String> texts(JsonNode block, String column) {
        Set<String> out = new HashSet<>();
        for (JsonNode row : block.path("rows")) {
            if (!row.path(column).isNull() && !row.path(column).isMissingNode()) {
                out.add(row.path(column).asText());
            }
        }
        return out;
    }

    // ---------------------------------------------------------------- independent sums

    private static final String[] TAX = {"taxable_value", "cgst", "sgst", "igst", "cess"};

    /** Σ of the live invoice lines of one GSTIN dated in the range (tax invoices only when asked). */
    private Map<String, BigDecimal> invoiceLines(String gstin, LocalDate from, LocalDate to, boolean taxInvoices,
                                                 String locationId) {
        Map<String, Object> row = db.queryForMap("SELECT COALESCE(SUM(li.taxable_value), 0) AS taxable_value, "
                + "COALESCE(SUM(li.cgst), 0) AS cgst, COALESCE(SUM(li.sgst), 0) AS sgst, "
                + "COALESCE(SUM(li.igst), 0) AS igst, COALESCE(SUM(li.cess), 0) AS cess "
                + "FROM invoice i JOIN invoice_line_item li ON li.invoice_id = i.id "
                + "WHERE i.institute_id = ? AND i.document_type IS NOT NULL AND i.cancelled_at IS NULL "
                + "AND (CAST(? AS VARCHAR) IS NULL OR i.seller_gstin = ?) AND i.document_date BETWEEN ? AND ? "
                + "AND (? = false OR i.document_type = 'TAX_INVOICE') AND (CAST(? AS VARCHAR) IS NULL OR i.location_id = ?)",
                inst, gstin, gstin, from, to, taxInvoices, locationId, locationId);
        return decimals(row);
    }

    /** Σ of the credit-note lines of one GSTIN dated in the range (notes on tax invoices only when asked). */
    private Map<String, BigDecimal> noteLines(String gstin, LocalDate from, LocalDate to, boolean taxInvoices,
                                              String locationId) {
        Map<String, Object> row = db.queryForMap("SELECT COALESCE(SUM(l.taxable_value), 0) AS taxable_value, "
                + "COALESCE(SUM(l.cgst), 0) AS cgst, COALESCE(SUM(l.sgst), 0) AS sgst, "
                + "COALESCE(SUM(l.igst), 0) AS igst, COALESCE(SUM(l.cess), 0) AS cess "
                + "FROM commerce_credit_note n JOIN commerce_credit_note_line l ON l.credit_note_id = n.id "
                + "JOIN invoice i ON i.id = n.invoice_id "
                + "WHERE n.institute_id = ? AND (CAST(? AS VARCHAR) IS NULL OR n.seller_gstin = ?) AND n.document_date BETWEEN ? AND ? "
                + "AND (? = false OR i.document_type = 'TAX_INVOICE') AND (CAST(? AS VARCHAR) IS NULL OR i.location_id = ?)",
                inst, gstin, gstin, from, to, taxInvoices, locationId, locationId);
        return decimals(row);
    }

    private static Map<String, BigDecimal> decimals(Map<String, Object> row) {
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        row.forEach((k, v) -> out.put(k, v == null ? BigDecimal.ZERO : new BigDecimal(v.toString())));
        return out;
    }

    /** Header sums of live invoices: round-off, total, count. */
    private Map<String, Object> invoiceHeads(String gstin, LocalDate from, LocalDate to, boolean live,
                                             String taxInvoiceOnly, String locationId) {
        return db.queryForMap("SELECT COALESCE(SUM(round_off), 0) AS round_off, COALESCE(SUM(total_amount), 0) AS "
                + "total, count(*) AS n FROM invoice WHERE institute_id = ? AND document_type IS NOT NULL "
                + "AND (cancelled_at IS NULL) = ? AND (CAST(? AS VARCHAR) IS NULL OR seller_gstin = ?) AND document_date BETWEEN ? AND ? "
                + "AND (CAST(? AS VARCHAR) IS NULL OR document_type = ?) AND (CAST(? AS VARCHAR) IS NULL OR location_id = ?)",
                inst, live, gstin, gstin, from, to, taxInvoiceOnly, taxInvoiceOnly, locationId, locationId);
    }

    private Map<String, Object> noteHeads(String gstin, LocalDate from, LocalDate to, String taxInvoiceOnly,
                                          String locationId) {
        return db.queryForMap("SELECT COALESCE(SUM(n.round_off), 0) AS round_off, COALESCE(SUM(n.total), 0) AS total, "
                + "count(*) AS n FROM commerce_credit_note n JOIN invoice i ON i.id = n.invoice_id "
                + "WHERE n.institute_id = ? AND (CAST(? AS VARCHAR) IS NULL OR n.seller_gstin = ?) AND n.document_date BETWEEN ? AND ? "
                + "AND (CAST(? AS VARCHAR) IS NULL OR i.document_type = ?) AND (CAST(? AS VARCHAR) IS NULL OR i.location_id = ?)",
                inst, gstin, gstin, from, to, taxInvoiceOnly, taxInvoiceOnly, locationId, locationId);
    }

    private static BigDecimal big(Object value) {
        return value == null ? BigDecimal.ZERO : new BigDecimal(value.toString());
    }

    /** India day of a stored UTC wall time, as SQL. */
    private static String indiaDay(String column) {
        return "((" + column + ") AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date";
    }

    /** Money received (RECEIVED tenders, not CREDIT) by mode in the range; COD dated by its remittance. */
    private Map<String, BigDecimal> tendersByMode(LocalDate from, LocalDate to, String locationId) {
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        for (Map<String, Object> row : db.queryForList("SELECT t.mode, SUM(t.amount) AS amount "
                + "FROM commerce_order_tender t JOIN commerce_order o ON o.id = t.order_id "
                + "LEFT JOIN commerce_cod_remittance r ON r.id = o.cod_remittance_id "
                + "LEFT JOIN pos_session ps ON ps.id = t.pos_session_id "
                + "WHERE t.institute_id = ? AND t.status = 'RECEIVED' AND t.mode <> 'CREDIT' "
                + "AND (CASE WHEN t.mode = 'COD' THEN r.received_on ELSE " + indiaDay("t.received_at") + " END) "
                + "BETWEEN ? AND ? AND (CAST(? AS VARCHAR) IS NULL OR COALESCE(ps.location_id, o.fulfilment_location_id) = ?) "
                + "GROUP BY t.mode", inst, from, to, locationId, locationId)) {
            out.put(String.valueOf(row.get("mode")), big(row.get("amount")));
        }
        return out;
    }

    /** Refunds paid (PROCESSED, not exchange credit) by method in the range. */
    private Map<String, BigDecimal> refundsByMethod(LocalDate from, LocalDate to, String locationId) {
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        for (Map<String, Object> row : db.queryForList("SELECT f.method, SUM(f.amount) AS amount "
                + "FROM commerce_refund f JOIN commerce_order o ON o.id = f.order_id "
                + "LEFT JOIN pos_session ps ON ps.id = f.pos_session_id "
                + "WHERE f.institute_id = ? AND f.status = 'PROCESSED' AND f.method <> 'EXCHANGE_CREDIT' "
                + "AND COALESCE(f.paid_on, " + indiaDay("f.processed_at") + ") BETWEEN ? AND ? "
                + "AND (CAST(? AS VARCHAR) IS NULL OR COALESCE(ps.location_id, o.fulfilment_location_id) = ?) GROUP BY f.method",
                inst, from, to, locationId, locationId)) {
            out.put(String.valueOf(row.get("method")), big(row.get("amount")));
        }
        return out;
    }

    private BigDecimal cashMoves(String type, LocalDate from, LocalDate to, String locationId) {
        return money("SELECT COALESCE(SUM(m.amount), 0) FROM pos_cash_movement m JOIN pos_session ps ON ps.id = "
                + "m.session_id WHERE m.institute_id = ? AND m.type = ? AND COALESCE(m.document_date, "
                + indiaDay("m.created_at") + ") BETWEEN ? AND ? AND (CAST(? AS VARCHAR) IS NULL OR ps.location_id = ?)",
                inst, type, from, to, locationId, locationId);
    }

    private static BigDecimal of(Map<String, BigDecimal> map, String key) {
        return map.getOrDefault(key, BigDecimal.ZERO);
    }

    // ---------------------------------------------------------------- seed helpers

    private String location(String code, String gstin, boolean store, boolean pos, boolean online) {
        LocationRequest location = new LocationRequest();
        location.setCode(code + "-" + run);
        location.setName(code + " " + run);
        location.setAddressLine1("1 Test Road");
        location.setCity("Test City");
        location.setPincode(PINCODE);
        location.setStateCode("09");
        location.setGstin(gstin);
        location.setIsStore(store);
        location.setIsWarehouse(!store || online);
        location.setIsPosEnabled(pos);
        location.setSellsOnline(online);
        return locationService.create(inst, adminId, true, location).getId();
    }

    private String taxClass(String code, String name, String hsn, String unit, List<TaxRateRuleDTO> rules) {
        return taxClassService.create(inst, adminId, TaxClassDTO.builder().code(code).name(name).hsnCode(hsn)
                .unit(unit).rules(rules).build()).getId();
    }

    private static TaxRateRuleDTO rate(String from, String percent) {
        return TaxRateRuleDTO.builder().minUnitPrice(new BigDecimal(from)).ratePercent(new BigDecimal(percent))
                .effectiveFrom(LocalDate.of(2020, 4, 1)).build();
    }

    private ProductResponse product(String slug, String name, String sku, String price, String unit, Integer scale,
                                    String classId) {
        ProductRequest request = ProductRequest.builder().slug(slug + "-" + run)
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name(name).build()))
                .taxClassId(classId).status("ACTIVE").stockMode("QUANTITY")
                .unit(unit).qtyScale(scale).qtyStep(1)
                .variants(List.of(VariantRequest.builder().sku(sku + "-" + run).name("One size")
                        .price(new BigDecimal(price)).weightGrams(200).build()))
                .build();
        return productService.save(inst, adminId, request);
    }

    private static String variantOf(ProductResponse product) {
        return product.getVariants().get(0).getPackageSessionId();
    }

    private void receive(String locationId, String variant, int quantity, String unitCost) {
        ReceiptRequest request = new ReceiptRequest();
        request.setLocationId(locationId);
        request.setSourceKind("OTHER");
        request.setNote("proof stock");
        request.setClientRequestId("rc-" + key());
        ReceiptRequest.Line line = new ReceiptRequest.Line();
        line.setPackageSessionId(variant);
        line.setQuantity(quantity);
        line.setUnitCost(new BigDecimal(unitCost));
        request.setLines(List.of(line));
        receiptService.create(inst, adminId, true, request);
    }

    private void assign(String userId, String locationId) {
        db.update("INSERT INTO commerce_staff_location (id, institute_id, user_id, location_id, created_by) "
                + "VALUES (?, ?, ?, ?, ?)", UUID.randomUUID().toString(), inst, userId, locationId, adminId);
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

    private static List<CartPriceRequest.Line> lines(Map<String, Integer> quantities) {
        List<CartPriceRequest.Line> lines = new ArrayList<>();
        quantities.forEach((variantId, quantity) -> lines.add(CartPriceRequest.Line.builder().variantId(variantId)
                .quantity(quantity).build()));
        return lines;
    }

    private String newPhone() {
        return "98767" + String.format("%05d", phones.incrementAndGet());
    }

    /** A prepaid order through the built checkout to {@code state}, paid by the webhook: CONFIRMED. */
    private String paidOrder(Map<String, Integer> quantities, String state, String pincode) {
        BigDecimal total = orderService.priceCart(inst, CartPriceRequest.builder().lines(lines(quantities))
                .pincode(pincode).stateCode(state).build()).snapshot().getTotal();
        String phone = newPhone();
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, CheckoutRequest.builder()
                .clientRequestId("order-" + key())
                .lines(lines(quantities)).expectedTotal(total)
                .customer(CheckoutRequest.Customer.builder().name("Proof Buyer").phone(phone)
                        .email("buyer-" + phone + "@example.invalid").build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("1 Test Road").city("Test City")
                        .stateCode(state).pincode(pincode).build())
                .build(), "127.0.0.1");
        payByWebhook(placed.getOrderId());
        assertEquals("CONFIRMED", status(placed.getOrderId()));
        return placed.getOrderId();
    }

    /** A COD order through the real checkout with a fresh OTP of a new phone. */
    private String codOrder(Map<String, Integer> quantities) {
        String phone = newPhone();
        String ip = "203.0.113." + ips.incrementAndGet();
        otpService.requestOtp(inst, phone, "CHECKOUT", ip);
        String code = lastCode.get("91" + phone);
        assertNotNull(code, "the stub transport recorded the code");
        String token = otpService.verifyOtp(inst, phone, code, "CHECKOUT", ip);
        BigDecimal total = orderService.priceCart(inst, CartPriceRequest.builder().lines(lines(quantities))
                .pincode(PINCODE).stateCode("09").paymentMethod("COD").build()).snapshot().getTotal();
        CheckoutDtos.Placed placed = checkoutService.placeOrder(inst, CheckoutRequest.builder()
                .clientRequestId("cod-" + key()).paymentMethod("COD").phoneToken(token)
                .lines(lines(quantities)).expectedTotal(total)
                .customer(CheckoutRequest.Customer.builder().name("Cod Buyer").phone(phone).build())
                .shippingAddress(CheckoutRequest.Address.builder().line1("1 Test Road").city("Test City")
                        .stateCode("09").pincode(PINCODE).build())
                .build(), null);
        assertEquals("CONFIRMED", status(placed.getOrderId()));
        return placed.getOrderId();
    }

    private void pack(String orderId) {
        List<ShipmentDtos.PackLine> out = new ArrayList<>();
        for (Map<String, Object> row : db.queryForList("SELECT id, quantity - qty_cancelled - qty_shipped AS open "
                + "FROM commerce_order_line WHERE order_id = ? AND line_type = 'ITEM' ORDER BY line_no", orderId)) {
            int open = ((Number) row.get("open")).intValue();
            if (open > 0) {
                out.add(ShipmentDtos.PackLine.builder().orderLineId(String.valueOf(row.get("id"))).quantity(open)
                        .build());
            }
        }
        shipments.pack(admin, inst, ShipmentDtos.PackRequest.builder().clientRequestId(key()).orderId(orderId)
                .fromStatus("CONFIRMED").lines(out).build());
        assertEquals("PACKED", status(orderId));
    }

    private String liveShipment(String orderId) {
        return text("SELECT id FROM commerce_shipment WHERE order_id = ? AND status <> 'CANCELLED'", orderId);
    }

    private void ship(String orderId) {
        shipments.ship(admin, inst, liveShipment(orderId), ShipmentDtos.ShipRequest.builder()
                .clientRequestId(key()).carrierName("Test Post").trackingNumber("TP" + keys.incrementAndGet() + "IN")
                .trackingUrl("https://track.example.com/").build());
        assertEquals("SHIPPED", status(orderId));
    }

    private void toStatus(String orderId, ShipmentDtos.StatusRequest.StatusRequestBuilder b) {
        shipments.status(admin, inst, liveShipment(orderId), b.clientRequestId(key()).build());
    }

    private void deliver(String orderId) {
        toStatus(orderId, ShipmentDtos.StatusRequest.builder().to("DELIVERED"));
        assertEquals("DELIVERED", status(orderId));
    }

    private String lineOf(String orderId, String variant) {
        return text("SELECT id FROM commerce_order_line WHERE order_id = ? AND package_session_id = ? ORDER BY line_no "
                + "LIMIT 1", orderId, variant);
    }

    /** A desk return asked, approved and received in one go (one order line, resaleable). */
    private ReturnDtos.ReturnView returnReceived(String orderId, String line, int quantity) {
        ReturnDtos.ReturnView created = returns.create(admin, inst, ReturnDtos.CreateReturnRequest.builder()
                .clientRequestId(key()).orderId(orderId).reason("DEFECTIVE")
                .lines(List.of(ReturnDtos.LineRequest.builder().orderLineId(line).quantity(quantity).build()))
                .approveNow(true).build());
        assertEquals("APPROVED", created.getStatus());
        return returns.receive(admin, inst, created.getId(), ReturnDtos.ReceiveRequest.builder()
                .clientRequestId(key()).fromStatus("APPROVED").lines(List.of(ReturnDtos.ReceiveLine.builder()
                        .orderLineId(line).condition("RESALEABLE").quantity(quantity).build())).build());
    }

    private static PosDtos.SaleLine line(String ref, String variant, int quantity) {
        return new PosDtos.SaleLine(ref, variant, quantity, null, null, null);
    }

    private static PosDtos.Tender cash(BigDecimal amount) {
        return new PosDtos.Tender("CASH", amount, null, null);
    }

    private static PosDtos.Approval pin(String approver, String raw) {
        return new PosDtos.Approval(approver, raw, "Checked at the counter");
    }

    private BigDecimal quoteTotal(String session, List<PosDtos.SaleLine> saleLines) {
        return sales.quote(cashier, inst, new PosDtos.SaleRequest(null, session, saleLines, null, null, null, null,
                null, null, null, null)).totals().total();
    }

    private PosSaleService.Outcome sell(String session, List<PosDtos.SaleLine> saleLines,
                                        List<PosDtos.Tender> tenders, PosDtos.Customer customer) {
        return sales.sale(cashier, inst, new PosDtos.SaleRequest(key(), session, saleLines, null, customer, tenders,
                null, null, null, null, null));
    }

    /** A cash bill of the quoted total; returns its order id. */
    private String cashSale(String session, List<PosDtos.SaleLine> saleLines, PosDtos.Customer customer) {
        BigDecimal total = quoteTotal(session, saleLines);
        return sell(session, saleLines, List.of(cash(total)), customer).answer().sale().orderId();
    }

    private PosReturnService.Outcome counterReturn(String session, String orderId, String orderLine, int quantity) {
        return posReturns.create(cashier, inst, new PosDtos.ReturnRequest(key(), session, orderId,
                List.of(new PosDtos.ReturnLine(orderLine, quantity, "RESALEABLE", null)), "DEFECTIVE", null, null,
                new PosDtos.Settle("REFUND", "CASH", null), pin(managerId, PIN)));
    }

    private String openSession(String register, String opening) {
        return sessions.open(cashier, inst, new PosDtos.SessionOpenRequest(key(), register, amount(opening), null))
                .session().id();
    }

    private BigDecimal expected(String session) {
        return sessions.detail(admin, inst, session).summary().expectedCash();
    }

    // ================================================================== 1. the month

    @Test
    @Order(1)
    void seedMonth() throws Exception {
        assertEquals("730", text("SELECT version FROM flyway_schema_history WHERE success AND version IS NOT NULL "
                + "ORDER BY installed_rank DESC LIMIT 1"), "Flyway target 730, no new migration");
        assertEquals(ZoneId.of("UTC"), ZoneId.systemDefault(), "the JVM runs in UTC as in production");
        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', "
                + "'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), "
                + "('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", inst,
                "Reports Proof " + run, "https://shop-" + run + ".example.com");
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", otherInst,
                "Other Proof " + run, "https://other-" + run + ".example.com");
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)",
                inst);
        capabilityResolver.evict(inst);
        taxSettingService.update(inst, adminId, TaxSettingDTO.builder().taxMode("REGULAR").sellerGstin(G1)
                .sellerLegalName("Proof Seller " + run).sellerAddress("1 Test Road, Test City 100001")
                .roundTotalTo("RUPEE").build());
        clothClass = taxClass("cloth_test", "cloth TEST", "5208", "MTR", List.of(rate("0", "5")));
        steelClass = taxClass("steel_test", "steel goods TEST", "7323", "PCS", List.of(rate("0", "5")));
        garmentClass = taxClass("garment_test", "garment slab TEST", "6204", "PCS",
                List.of(TaxRateRuleDTO.builder().minUnitPrice(BigDecimal.ZERO).maxUnitPrice(new BigDecimal("999.99")).ratePercent(new BigDecimal("5")).effectiveFrom(LocalDate.of(2020, 4, 1)).build(), rate("1000", "12")));
        zeroClass = taxClass("zero_test", "zero TEST", "5007", "PCS", List.of(rate("0", "0")));
        shippingClass = taxClass("shipping_test", "delivery TEST", "9965", "NA", List.of(rate("0", "18")));

        // Series: invoices and credit notes per GSTIN, a delivery-challan series; registers bring their own.
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("TAX_INVOICE").sellerGstin(G1)
                .prefix("IA" + r2).build());
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("TAX_INVOICE").sellerGstin(G2)
                .prefix("IB" + r2).build());
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("CREDIT_NOTE").sellerGstin(G1)
                .prefix("CA" + r2).build());
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("CREDIT_NOTE").sellerGstin(G2)
                .prefix("CB" + r2).build());

        l1 = location("L1", G1, true, true, true);
        l2 = location("L2", G2, true, true, false);
        l3 = location("L3", G1, false, false, false);
        seriesService.create(inst, adminId, DocumentSeriesDTO.builder().documentType("TAX_INVOICE").kind("MANUAL_BOOK")
                .prefix("BB" + r2).locationId(l2).bookFrom(100L).bookTo(199L).build());
        transfers.createChallanSeries(admin, inst, new StockOpsDtos.ChallanSeriesRequest("DC" + r2, null, null, null));

        cotton = variantOf(product("cotton-cloth", "Cotton cloth", "COTTON", "12.34", "MTR", 10, clothClass));
        ProductResponse bottleMade = product("steel-bottle", "Steel bottle", "BOTTLE", "450.00", "PCS", 1, steelClass);
        bottle = variantOf(bottleMade);
        bottleSku = "BOTTLE-" + run;
        scarf = variantOf(product("silk-scarf", "Silk scarf", "SCARF", "1200.00", "PCS", 1, garmentClass));
        yarn = variantOf(product("plain-yarn", "Plain yarn", "YARN", "100.00", "PCS", 1, zeroClass));
        ribbon = variantOf(product("satin-ribbon", "Satin ribbon", "RIBBON", "0.35", "MTR", 100, clothClass));
        cup = variantOf(product("steel-cup", "Steel cup", "CUP", "250.00", "PCS", 1, steelClass));
        cupSku = "CUP-" + run;
        receive(l1, cotton, 100, "8.0000");
        receive(l1, bottle, 40, "100.00");
        receive(l2, bottle, 10, "100.00");
        receive(l1, scarf, 3, "500.00");
        receive(l1, yarn, 10, "40.00");
        receive(l1, ribbon, 400, "0.2000");
        receive(l1, cup, 5, "120.00");

        db.update("INSERT INTO institute_payment_gateway_mapping (id, vendor, institute_id, "
                        + "payment_gateway_specific_data, status) VALUES (?, 'RAZORPAY', ?, ?, 'ACTIVE')",
                UUID.randomUUID().toString(), inst,
                "{\"apiKey\":\"" + KEY_ID + "\",\"apiSecret\":\"" + KEY_SECRET + "\",\"keySecret\":\"" + KEY_SECRET
                        + "\",\"webhookSecret\":\"" + WEBHOOK_SECRET + "\"}");
        Map<String, Object> tier = new HashMap<>();
        tier.put("up_to", null);
        tier.put("charge", new BigDecimal("50.00"));
        shippingRuleService.save(inst, adminId, ShippingRuleDTO.builder().basis("FLAT").tiers(List.of(tier))
                .codCharge(new BigDecimal("40.00")).taxClassId(shippingClass).build());
        checkoutSettings.update(inst, adminId, objectMapper.readTree("""
                {"cod": {"enabled": true, "max_order_value": 5000, "staff_confirm_threshold": 3000,
                         "max_open_orders_per_phone": 2, "max_refusals": 2, "confirm_within_hours": 48}}"""));
        snapshotLoader.evict(inst);

        assign(cashierId, l1);
        assign(cashierId, l2);
        assign(managerId, l1);
        assign(managerId, l2);
        assign(managerId, l3);
        assign(accountantId, l2);
        assign(warehouseId, l1);
        pinService.setPin(inst, managerId, PIN);
        settings.update(admin, inst, new PosDtos.SettingsRequest(amount("5.00"), amount("2000.00"), amount("0.00")));
        r1 = registers.create(admin, inst, new PosDtos.RegisterCreateRequest(key(), l1, "r1-" + run.substring(0, 4),
                "Front counter", "RA" + r2, null)).register().id();
        r2Register = registers.create(admin, inst, new PosDtos.RegisterCreateRequest(key(), l2,
                "r2-" + run.substring(0, 4), "Store counter", "RB" + r2, null)).register().id();

        // ---- online at L1 (G1)
        orderA = paidOrder(Map.of(cotton, 25, bottle, 1), "09", PINCODE);
        pack(orderA);
        ship(orderA);
        deliver(orderA);
        orderB = paidOrder(Map.of(scarf, 1, bottle, 1), "27", "400001");
        pack(orderB);
        ship(orderB);
        deliver(orderB);
        assertEquals("IGST", text("SELECT tax_head FROM invoice WHERE commerce_order_id = ?", orderB),
                "order B goes to another state");
        ReturnDtos.ReturnView backB = returnReceived(orderB, lineOf(orderB, bottle), 1);
        noteB = backB.getCreditNote().getId();
        RefundDtos.RefundView bankRefund = refunds.create(admin, inst, RefundDtos.CreateRefundRequest.builder()
                .clientRequestId(key()).orderId(orderB).returnId(backB.getId()).amount(backB.getCreditTotal())
                .method("BANK_TRANSFER").reference("UTR" + run).reason("proof refund").build());
        assertEquals("PROCESSED", bankRefund.getStatus());

        orderC = codOrder(Map.of(bottle, 1));
        pack(orderC);
        ship(orderC);
        deliver(orderC);
        BigDecimal codC = money("SELECT cod_amount FROM commerce_order WHERE id = ?", orderC);
        remittanceId = remittances.record(admin, inst, CodRemittanceDtos.RemittanceRequest.builder()
                .clientRequestId(key()).reference("STMT-" + run).courierName("Test Post").receivedOn(today)
                .grossAmount(codC).deductions(new BigDecimal("30.00")).netAmount(codC.subtract(new BigDecimal("30.00")))
                .differenceReason("Courier fee").orderIds(List.of(orderC)).build()).view().getId();
        orderD = codOrder(Map.of(bottle, 1));
        pack(orderD);
        ship(orderD);
        deliver(orderD);
        orderE = codOrder(Map.of(bottle, 1));
        pack(orderE);
        ship(orderE);
        toStatus(orderE, ShipmentDtos.StatusRequest.builder().to("RTO").rtoReason("REFUSED"));
        assertEquals("RTO", status(orderE));
        assertEquals(1, count("SELECT count(*) FROM commerce_credit_note WHERE commerce_order_id = ?", orderE),
                "the RTO credits the invoice");
        orderG = codOrder(Map.of(bottle, 1));
        pack(orderG);
        ship(orderG);
        orderF = paidOrder(Map.of(bottle, 1), "09", PINCODE);
        pack(orderF);
        orderH = paidOrder(Map.of(bottle, 1), "09", PINCODE);
        noDrift("online");

        // ---- the counter at L1 (R1, G1)
        sessionR1 = openSession(r1, "1000.00");
        p1 = cashSale(sessionR1, List.of(line("l1", cotton, 34)), null);
        same(amount("420.00"), money("SELECT total_amount FROM invoice WHERE commerce_order_id = ?", p1),
                "3.4 m at 123.40 / m rounds to 420");
        BigDecimal p2Total = quoteTotal(sessionR1, List.of(line("l1", bottle, 1)));
        p2 = sell(sessionR1, List.of(line("l1", bottle, 1)), List.of(cash(new BigDecimal("200.00")),
                new PosDtos.Tender("UPI", p2Total.subtract(new BigDecimal("200.00")), null, "UPI 7001")),
                new PosDtos.Customer(null, HYPERLINK, null, null)).answer().sale().orderId();
        p3 = cashSale(sessionR1, List.of(line("l1", bottle, 1)), null);
        p3Number = invoiceNumber(liveInvoice(p3));
        corrections.voidSale(cashier, inst, p3, new PosDtos.VoidRequest(key(), "Keyed twice", pin(managerId, PIN)));
        assertEquals(1, count("SELECT count(*) FROM invoice WHERE commerce_order_id = ? AND cancelled_at IS NOT NULL",
                p3));
        p4 = cashSale(sessionR1, List.of(line("l1", bottle, 2)), new PosDtos.Customer(null, "Registered buyer",
                B2B_GSTIN, "Registered Buyer Test Pvt Ltd"));
        assertEquals(B2B_GSTIN, text("SELECT buyer_gstin FROM invoice WHERE commerce_order_id = ?", p4));
        p5 = cashSale(sessionR1, List.of(line("l1", bottle, 1)), null);
        p5FirstInvoice = liveInvoice(p5);
        p5Reissued = invoices.reissueAsB2b(inst, adminId, p5FirstInvoice, ReissueB2bRequest.builder()
                .buyerGstin(REISSUE_GSTIN).buyerName("Reissue Buyer Test Pvt Ltd").build()).getId();
        noteP5 = text("SELECT id FROM commerce_credit_note WHERE invoice_id = ?", p5FirstInvoice);
        assertNotNull(noteP5, "the reissue credits the first invoice in full");
        p6 = cashSale(sessionR1, List.of(line("l1", yarn, 3)), null);
        pRibbon = cashSale(sessionR1, List.of(line("l1", ribbon, 347)), null);
        same(amount("121.00"), money("SELECT total_amount FROM invoice WHERE commerce_order_id = ?", pRibbon),
                "121.45 rounded down to the rupee");
        String p1Line = lineOf(p1, cotton);
        counterReturn(sessionR1, p1, p1Line, 12);
        counterReturn(sessionR1, p1, p1Line, 21);
        counterReturn(sessionR1, p1, p1Line, 1);
        String ribbonLine = lineOf(pRibbon, ribbon);
        PosReturnService.Outcome most = counterReturn(sessionR1, pRibbon, ribbonLine, 346);
        cappedNote = most.answer().creditNoteId();
        same(amount("121.00"), most.answer().credit(), "capped at what is left of the bill");
        same(amount("-0.10"), money("SELECT round_off FROM commerce_credit_note WHERE id = ?", cappedNote),
                "the cut is the note's negative round-off");
        counterReturn(sessionR1, pRibbon, ribbonLine, 1);
        sessions.cashMovement(admin, inst, sessionR1, new PosDtos.CashMovementRequest(key(), "CASH_IN",
                amount("200.00"), "Change float"));
        sessions.cashMovement(admin, inst, sessionR1, new PosDtos.CashMovementRequest(key(), "CASH_OUT",
                amount("100.00"), "Shop supplies"));
        sessions.close(cashier, inst, sessionR1, new PosDtos.SessionCloseRequest(key(), expected(sessionR1), null,
                null, null));

        // ---- the counter at L2 (R2, G2): a sale, paper bills 101 and 103 (102 left blank), ten over at close
        sessionR2 = openSession(r2Register, "500.00");
        p7 = cashSale(sessionR2, List.of(line("l1", bottle, 1)), null);
        for (String page : List.of("101", "103")) {
            sales.billBook(cashier, inst, new PosDtos.SaleRequest(key(), sessionR2, List.of(line("l1", bottle, 1)),
                    null, null, List.of(cash(new BigDecimal("450.00"))), null, pin(managerId, PIN), null, page,
                    today.toString()));
        }
        BigDecimal r2Expected = expected(sessionR2);
        sessions.close(cashier, inst, sessionR2, new PosDtos.SessionCloseRequest(key(),
                r2Expected.add(new BigDecimal("10.00")), null, "Ten over at close", pin(managerId, PIN)));
        same(amount("10.00"), money("SELECT variance FROM pos_session WHERE id = ?", sessionR2), "R2 variance");

        // ---- a staff credit order at L1: 2 bottles handed over, part paid. A return before the rest
        // is paid (F1) is refused by the return desk (requireReturnable: ORDER_NOT_PAID), so the dues
        // report has no return to net here; finding recorded in build-proof.md.
        staffOrder = staffOrders.create(admin, inst, StaffOrderRequest.builder().clientRequestId(key())
                .customer(StaffOrderRequest.Customer.builder().phone(newPhone()).name("Credit Buyer").build())
                .lines(List.of(StaffOrderRequest.Line.builder().variantId(bottle).quantity(2).build()))
                .restOnCredit(true).handOverNow(true).build()).detail().getOrder().getId();
        assertEquals("DELIVERED", status(staffOrder));
        receipts.record(admin, inst, staffOrder, OrderDeskDtos.ReceiptRequest.builder().clientRequestId(key())
                .mode("UPI").amount(new BigDecimal("300.00")).reference("UPI-" + run).build());
        String creditLine = lineOf(staffOrder, bottle);
        refused("ORDER_NOT_PAID", () -> returns.create(admin, inst, ReturnDtos.CreateReturnRequest.builder()
                .clientRequestId(key()).orderId(staffOrder).reason("DEFECTIVE")
                .lines(List.of(ReturnDtos.LineRequest.builder().orderLineId(creditLine).quantity(1).build()))
                .approveNow(true).build()));
        // ---- a paid staff order at L1, one bottle back: a credit note on an ADMIN invoice
        staffPaid = staffOrders.create(admin, inst, StaffOrderRequest.builder().clientRequestId(key())
                .customer(StaffOrderRequest.Customer.builder().phone(newPhone()).name("Desk Buyer").build())
                .lines(List.of(StaffOrderRequest.Line.builder().variantId(bottle).quantity(2).build()))
                .tenders(List.of(StaffOrderRequest.Tender.builder().mode("CASH").amount(new BigDecimal("900.00"))
                        .build())).handOverNow(true).build()).detail().getOrder().getId();
        assertEquals("PAID", text("SELECT payment_status FROM commerce_order WHERE id = ?", staffPaid));
        returnReceived(staffPaid, lineOf(staffPaid, bottle), 1);

        // ---- a delivery challan L1 -> L3 (one GSTIN: a challan; L1 -> L2 would need the CA's document)
        String draft = transfers.create(admin, inst, new StockOpsDtos.TransferCreateRequest(key(), l1, l3, null,
                List.of(new StockOpsDtos.TransferLineInput(bottle, 1, null, null, null)))).getBody().id();
        StockOpsDtos.TransferView sent = transfers.dispatch(admin, inst, draft,
                new StockOpsDtos.TransferDispatchRequest(key(), null, null, null, null)).getBody();
        transferNumber = text("SELECT document_number FROM stock_transfer WHERE id = ?", sent.id());
        assertEquals("DELIVERY_CHALLAN", text("SELECT document_type FROM stock_transfer WHERE id = ?", sent.id()));

        // ---- a price change (audit) on a product never sold
        productService.updateVariant(inst, adminId, cup, VariantRequest.builder().sku(cupSku).name("One size")
                .price(new BigDecimal("260.00")).weightGrams(200).build());

        // ---- date controls (see the class comment)
        String invoiceF = liveInvoice(orderF);
        db.update("UPDATE invoice SET document_date = ? WHERE id = ?", prevLast, invoiceF);
        db.update("UPDATE commerce_order_tender SET received_at = ? WHERE order_id = ? AND status = 'RECEIVED'",
                java.sql.Timestamp.valueOf(prevLast.atTime(18, 29)), orderF);
        noteF = creditNotes.issue(inst, adminId, CreditNoteRequest.builder().invoiceId(invoiceF).full(true)
                .documentDate(prevLast).reason("Back-dated proof note").clientRequestId(key()).build()).getId();
        assertEquals(prevLast.toString(), text("SELECT document_date::text FROM commerce_credit_note WHERE id = ?",
                noteF));
        db.update("UPDATE commerce_order_tender SET received_at = ? WHERE order_id = ? AND status = 'RECEIVED' "
                + "AND mode = 'GATEWAY'", java.sql.Timestamp.valueOf(prevLast.atTime(18, 31)), orderA);
        db.update("UPDATE commerce_order SET delivered_at = ? WHERE id = ?",
                java.sql.Timestamp.valueOf(today.minusDays(3).atTime(6, 0)), orderC);
        db.update("UPDATE commerce_order SET delivered_at = ? WHERE id = ?",
                java.sql.Timestamp.valueOf(today.minusDays(12).atTime(6, 0)), orderD);

        note("seed: today " + today + ", month " + monthStart + ".." + today + ", previous day " + prevLast);
        for (Map<String, Object> row : db.queryForList("SELECT i.invoice_number, i.document_date, i.channel, "
                + "i.seller_gstin, i.buyer_gstin, i.tax_head, i.total_amount, i.round_off, i.cancelled_at IS NOT NULL "
                + "AS cancelled, s.kind FROM invoice i JOIN commerce_document_series s ON s.id = i.series_id "
                + "WHERE i.institute_id = ? ORDER BY i.created_at", inst)) {
            note("invoice " + row);
        }
        for (Map<String, Object> row : db.queryForList("SELECT credit_note_number, document_date, seller_gstin, "
                + "total, round_off FROM commerce_credit_note WHERE institute_id = ? ORDER BY created_at", inst)) {
            note("credit note " + row);
        }
        noDrift("seed");
    }

    // ================================================================== 2. GST pack

    @Test
    @Order(2)
    void gate9_salesRegisterEqualsInvoices() {
        for (String gstin : List.of(G1, G2)) {
            JsonNode answer = report("sales-register", month("sellerGstin", gstin));
            JsonNode totals = answer.path("totals");
            Map<String, BigDecimal> lines = invoiceLines(gstin, monthStart, today, false, null);
            for (String column : TAX) {
                same(lines.get(column), totals.path(column), gstin + " sales register " + column);
            }
            Map<String, Object> heads = invoiceHeads(gstin, monthStart, today, true, null, null);
            same(big(heads.get("round_off")), totals.path("round_off"), gstin + " round-off");
            same(big(heads.get("total")), totals.path("invoice_total"), gstin + " invoice total");
            assertEquals(((Number) heads.get("n")).longValue(), totals.path("invoices").asLong(), gstin + " count");
            Map<String, Object> cancelled = invoiceHeads(gstin, monthStart, today, false, null, null);
            assertEquals(((Number) cancelled.get("n")).longValue(), totals.path("cancelled_invoices").asLong());
            same(big(cancelled.get("total")), totals.path("cancelled_total"), gstin + " cancelled total");
            same(ZERO, answer.path("check").path("difference"), gstin + " register check");
            note("sales register " + gstin + " totals " + totals);
        }
        JsonNode g1 = report("sales-register", month("sellerGstin", G1));
        Set<String> statuses = new HashSet<>();
        boolean hyperlink = false;
        for (JsonNode row : rows(g1)) {
            if (p3Number.equals(row.path("invoice_number").asText())) {
                statuses.add(row.path("status").asText());
            }
            hyperlink |= HYPERLINK.equals(row.path("customer").asText());
        }
        assertEquals(Set.of("CANCELLED"), statuses, "P3 listed as cancelled");
        assertTrue(hyperlink, "the customer cell comes from the snapshot as typed");
        assertFalse(texts(g1, "invoice_number").contains(invoiceNumber(liveInvoice(orderF))),
                "the invoice moved to the previous month is not in this month");
    }

    @Test
    @Order(3)
    void gate9_creditNotesEqualDocuments() {
        for (String gstin : List.of(G1, G2)) {
            JsonNode answer = report("credit-notes", month("sellerGstin", gstin));
            JsonNode totals = answer.path("totals");
            Map<String, BigDecimal> lines = noteLines(gstin, monthStart, today, false, null);
            for (String column : TAX) {
                same(lines.get(column), totals.path(column), gstin + " credit notes " + column);
            }
            Map<String, Object> heads = noteHeads(gstin, monthStart, today, null, null);
            same(big(heads.get("round_off")), totals.path("round_off"), gstin + " note round-off");
            same(big(heads.get("total")), totals.path("note_total"), gstin + " note totals");
            note("credit notes " + gstin + " totals " + totals);
        }
        JsonNode g1 = report("credit-notes", month("sellerGstin", G1));
        String capped = text("SELECT credit_note_number FROM commerce_credit_note WHERE id = ?", cappedNote);
        boolean cappedSeen = false;
        boolean metres = false;
        for (JsonNode row : rows(g1)) {
            if (capped.equals(row.path("note_number").asText())) {
                cappedSeen = true;
                same(amount("-0.10"), row.path("round_off"), "negative round-off carried");
                same(amount("121.00"), row.path("note_total"), "the capped note");
            }
            if ("1.2 m".equals(row.path("quantity_text").asText())) {
                metres = true;
                assertEquals("₹123.40 / m", row.path("rate_text").asText());
            }
        }
        assertTrue(cappedSeen, "the capped note is listed");
        assertTrue(metres, "1.2 m at ₹123.40 / m is listed");
        BigDecimal ribbonNotes = money("SELECT SUM(total) FROM commerce_credit_note WHERE invoice_id = ?",
                liveInvoice(pRibbon));
        assertTrue(ribbonNotes.compareTo(money("SELECT total_amount FROM invoice WHERE commerce_order_id = ?", pRibbon))
                <= 0, "the notes never pass the bill");
        assertFalse(texts(g1, "note_number").contains(text("SELECT credit_note_number FROM commerce_credit_note "
                + "WHERE id = ?", noteF)), "the back-dated note sits in its own month");
    }

    @Test
    @Order(4)
    void gate9_gstr1SectionsAddUp() {
        for (String gstin : List.of(G1, G2)) {
            for (String limit : new String[] {"500", null}) {
                JsonNode answer = report("gstr1", month("sellerGstin", gstin, "b2clLimit", limit));
                same(ZERO, answer.path("check").path("difference"), gstin + " GSTR-1 check");
                assertFalse(hasWarning(answer, "GSTR1_DOES_NOT_ADD_UP"));
                Map<String, BigDecimal> inv = invoiceLines(gstin, monthStart, today, true, null);
                Map<String, BigDecimal> cn = noteLines(gstin, monthStart, today, true, null);
                for (String column : TAX) {
                    BigDecimal sections = decOr0(section(answer, "b2b").path("totals").path(column))
                            .add(decOr0(section(answer, "b2cl").path("totals").path(column)))
                            .add(decOr0(section(answer, "b2cs").path("totals").path(column)))
                            .subtract(decOr0(section(answer, "cdnr").path("totals").path(column)))
                            .subtract(decOr0(section(answer, "cdnur").path("totals").path(column)));
                    if (column.equals("taxable_value")) {
                        sections = sections.add(decOr0(section(answer, "exemp").path("totals").path("nil_or_exempt")));
                    }
                    same(inv.get(column).subtract(cn.get(column)), sections, gstin + " limit " + limit + " " + column
                            + ": sections = invoices - notes");
                }
                note("gstr1 " + gstin + " limit " + limit + " check " + answer.path("check"));
            }
        }
        String numberB = invoiceNumber(liveInvoice(orderB));
        String noteBNumber = text("SELECT credit_note_number FROM commerce_credit_note WHERE id = ?", noteB);
        String noteP5Number = text("SELECT credit_note_number FROM commerce_credit_note WHERE id = ?", noteP5);
        JsonNode low = report("gstr1", month("sellerGstin", G1, "b2clLimit", "500"));
        assertTrue(texts(section(low, "b2b"), "invoice_number").containsAll(List.of(invoiceNumber(liveInvoice(p4)),
                invoiceNumber(p5Reissued))), "P4 and the reissued bill are B2B");
        assertEquals(Set.of(numberB), texts(section(low, "b2cl"), "invoice_number"), "order B is B2C large at 500");
        assertTrue(texts(section(low, "cdnur"), "note_number").contains(noteBNumber), "its note is CDNUR");
        assertTrue(texts(section(low, "b2cs_credit_notes"), "note_number").contains(noteP5Number),
                "the reissue note is netted into B2CS");
        assertFalse(texts(section(low, "cdnr"), "note_number").contains(noteP5Number), "never in CDNR");
        BigDecimal yarnTaxable = money("SELECT SUM(li.taxable_value) FROM invoice_line_item li JOIN invoice i ON "
                + "i.id = li.invoice_id WHERE i.commerce_order_id = ? AND li.tax_rate = 0", p6);
        boolean intraUnregistered = false;
        for (JsonNode row : rows(section(low, "exemp"))) {
            String what = row.path("description").asText().toLowerCase();
            if (what.contains("intra") && what.contains("unregistered")) {
                same(yarnTaxable, row.path("nil_or_exempt"), "P6 in exemp, intra-state, unregistered");
                intraUnregistered = true;
            }
        }
        assertTrue(intraUnregistered, "an intra-state unregistered exemp row");
        JsonNode standard = report("gstr1", month("sellerGstin", G1));
        assertTrue(rows(section(standard, "b2cl")).isEmpty(), "nothing above the default limit");
        assertTrue(rows(section(standard, "cdnur")).isEmpty());
        assertTrue(texts(section(standard, "b2cs"), "place_of_supply").stream().anyMatch(s -> s.startsWith("27")),
                "order B in B2CS at the default limit");
        refused("GSTIN_REQUIRED", () -> report("gstr1", month()));
    }

    @Test
    @Order(5)
    void gate9_hsnAndTaxByRate() {
        for (String gstin : List.of(G1, G2)) {
            JsonNode hsn = report("hsn-summary", month("sellerGstin", gstin));
            Map<String, BigDecimal> inv = invoiceLines(gstin, monthStart, today, true, null);
            Map<String, BigDecimal> cn = noteLines(gstin, monthStart, today, true, null);
            for (String column : TAX) {
                BigDecimal sum = decOr0(section(hsn, "hsn_b2b").path("totals").path(column))
                        .add(decOr0(section(hsn, "hsn_b2c").path("totals").path(column)));
                same(inv.get(column).subtract(cn.get(column)), sum, gstin + " HSN " + column);
            }
            Map<String, Object> ih = invoiceHeads(gstin, monthStart, today, true, "TAX_INVOICE", null);
            Map<String, Object> nh = noteHeads(gstin, monthStart, today, "TAX_INVOICE", null);
            BigDecimal roundOff = big(ih.get("round_off")).subtract(big(nh.get("round_off")));
            same(roundOff, hsn.path("totals").path("round_off"), gstin + " HSN round-off line");
            BigDecimal values = decOr0(section(hsn, "hsn_b2b").path("totals").path("total_value"))
                    .add(decOr0(section(hsn, "hsn_b2c").path("totals").path("total_value")));
            same(big(ih.get("total")).subtract(big(nh.get("total"))), values.add(roundOff),
                    gstin + " HSN values + round-off line = invoice totals - note totals");
            same(ZERO, hsn.path("check").path("difference"), gstin + " HSN check");

            JsonNode byRate = report("tax-by-rate", month("sellerGstin", gstin));
            for (String column : TAX) {
                same(inv.get(column).subtract(cn.get(column)), section(byRate, "net").path("totals").path(column),
                        gstin + " tax by rate net " + column);
            }
            note("hsn " + gstin + " b2b " + section(hsn, "hsn_b2b").path("totals") + " b2c "
                    + section(hsn, "hsn_b2c").path("totals") + " round-off " + roundOff);
        }
        JsonNode hsn = report("hsn-summary", month("sellerGstin", G1));
        BigDecimal metres = money("SELECT COALESCE(SUM(li.quantity::numeric / ol.qty_scale), 0) FROM invoice i "
                + "JOIN invoice_line_item li ON li.invoice_id = i.id JOIN commerce_order_line ol ON ol.order_id = "
                + "i.commerce_order_id AND ol.line_ref = li.source_id WHERE i.institute_id = ? AND i.cancelled_at IS "
                + "NULL AND i.document_type = 'TAX_INVOICE' AND i.buyer_gstin IS NULL AND i.seller_gstin = ? AND "
                + "li.hsn_code = '5208' AND i.document_date BETWEEN ? AND ?", inst, G1, monthStart, today)
                .subtract(money("SELECT COALESCE(SUM(l.quantity::numeric / ol.qty_scale), 0) FROM commerce_credit_note n "
                        + "JOIN commerce_credit_note_line l ON l.credit_note_id = n.id JOIN invoice_line_item li ON li.id "
                        + "= l.invoice_line_item_id JOIN invoice i ON i.id = n.invoice_id JOIN commerce_order_line ol ON "
                        + "ol.order_id = i.commerce_order_id AND ol.line_ref = li.source_id WHERE n.institute_id = ? AND "
                        + "i.document_type = 'TAX_INVOICE' AND i.buyer_gstin IS NULL AND n.seller_gstin = ? AND "
                        + "l.hsn_code = '5208' AND n.document_date BETWEEN ? AND ?", inst, G1, monthStart, today));
        same(new BigDecimal("2.5"), metres, "2.5 + 3.4 - 1.2 - 2.1 - 0.1 m of cloth (+ 3.47 - 3.47 m of ribbon)");
        boolean cloth = false;
        boolean delivery = false;
        for (JsonNode row : rows(section(hsn, "hsn_b2c"))) {
            if ("5208".equals(row.path("hsn").asText())) {
                assertEquals("MTR", row.path("uqc").asText());
                same(metres, row.path("quantity"), "cloth in metres, not base units");
                cloth = true;
            }
            if ("9965".equals(row.path("hsn").asText())) {
                assertEquals("NA", row.path("uqc").asText());
                same(BigDecimal.ZERO, row.path("quantity"), "delivery is a service");
                delivery = true;
            }
        }
        assertTrue(cloth && delivery, "cloth and delivery rows in the B2C table");
        Map<String, Object> scale = db.queryForMap("SELECT count(*) AS lines, count(*) FILTER (WHERE ol.qty_scale IS "
                + "NOT NULL AND snap.s IS NOT NULL) AS both_known, count(*) FILTER (WHERE ol.qty_scale <> snap.s) AS "
                + "differ FROM invoice i JOIN invoice_line_item li ON li.invoice_id = i.id LEFT JOIN commerce_order_line "
                + "ol ON ol.order_id = i.commerce_order_id AND ol.line_ref = li.source_id LEFT JOIN LATERAL (SELECT "
                + "(e ->> 'qty_scale')::int AS s FROM jsonb_array_elements(COALESCE(i.invoice_data_json::jsonb #> "
                + "'{tax,lines}', '[]'::jsonb)) e WHERE e ->> 'line_ref' = li.source_id LIMIT 1) snap ON TRUE WHERE "
                + "i.institute_id = ? AND i.document_type IS NOT NULL AND li.item_type = 'COMMERCE_ITEM'", inst);
        note("scale join vs snapshot: " + scale);
        assertEquals(0L, ((Number) scale.get("differ")).longValue(), "the order-line scale = the snapshot scale");
        assertEquals(((Number) scale.get("lines")).longValue(), ((Number) scale.get("both_known")).longValue(),
                "every item line has both");
        JsonNode gstr1 = report("gstr1", month("sellerGstin", G1));
        JsonNode byRate = report("tax-by-rate", month("sellerGstin", G1));
        for (JsonNode column : gstr1.path("check").path("columns")) {
            same(dec(column.path("documents")), section(byRate, "net").path("totals").path(column.path("key").asText()),
                    "tax by rate net = GSTR-1 documents " + column.path("key").asText());
        }
    }

    @Test
    @Order(6)
    void documentsIssuedNoGapBillBookSeparate() {
        // All time, every system series of the institute: next_value - 1 = documents = highest sequence.
        for (Map<String, Object> series : db.queryForList("SELECT id, prefix, document_type, next_value FROM "
                + "commerce_document_series WHERE institute_id = ? AND kind = 'SYSTEM'", inst)) {
            String id = String.valueOf(series.get("id"));
            List<String> numbers = db.queryForList("SELECT invoice_number FROM invoice WHERE series_id = ? UNION ALL "
                    + "SELECT credit_note_number FROM commerce_credit_note WHERE series_id = ? UNION ALL "
                    + "SELECT document_number FROM stock_transfer WHERE document_series_id = ?", String.class, id, id, id);
            long highest = numbers.stream().mapToLong(n -> Long.parseLong(n.substring(n.lastIndexOf('-') + 1)))
                    .max().orElse(0);
            long next = ((Number) series.get("next_value")).longValue();
            assertEquals(next - 1, numbers.size(), series + " documents");
            assertEquals(next - 1, highest, series + " highest sequence");
            note("series " + series.get("prefix") + " " + series.get("document_type") + ": " + numbers.size()
                    + " documents, highest " + highest);
        }
        String r1Prefix = "RA" + r2;
        String r2Prefix = "RB" + r2;
        for (String gstin : List.of(G1, G2)) {
            JsonNode answer = report("documents-issued", month("sellerGstin", gstin));
            assertFalse(hasWarning(answer, "SERIES_GAP"), gstin + " has no gap");
            long expectedTotal = count("SELECT count(*) FROM invoice i JOIN commerce_document_series s ON s.id = "
                    + "i.series_id WHERE i.institute_id = ? AND s.kind = 'SYSTEM' AND i.seller_gstin = ? AND "
                    + "i.document_date BETWEEN ? AND ?", inst, gstin, monthStart, today)
                    + count("SELECT count(*) FROM commerce_credit_note WHERE institute_id = ? AND seller_gstin = ? AND "
                    + "document_date BETWEEN ? AND ?", inst, gstin, monthStart, today)
                    + count("SELECT count(*) FROM stock_transfer WHERE institute_id = ? AND document_type = "
                    + "'DELIVERY_CHALLAN' AND from_gstin = ? AND document_date BETWEEN ? AND ?", inst, gstin,
                    monthStart, today);
            JsonNode system = section(answer, "system");
            assertEquals(expectedTotal, system.path("totals").path("total").asLong(), gstin + " documents in range");
            long cancelled = count("SELECT count(*) FROM invoice i JOIN commerce_document_series s ON s.id = "
                    + "i.series_id WHERE i.institute_id = ? AND s.kind = 'SYSTEM' AND i.seller_gstin = ? AND "
                    + "i.cancelled_at IS NOT NULL AND i.document_date BETWEEN ? AND ?", inst, gstin, monthStart, today);
            assertEquals(cancelled, system.path("totals").path("cancelled").asLong(), gstin + " cancelled");
            for (JsonNode row : rows(system)) {
                assertEquals("none", row.path("gap").asText(), gstin + " gap in " + row);
                assertFalse(row.path("prefix").asText().startsWith("BB"), "the bill book is not a system row");
            }
            note("documents issued " + gstin + " " + system.path("rows"));
            JsonNode docs = section(report("gstr1", month("sellerGstin", gstin)), "docs");
            assertEquals(system.path("rows"), docs.path("rows"), "GSTR-1 docs = documents issued");
            if (gstin.equals(G1)) {
                boolean r1Row = false;
                boolean challan = false;
                boolean otherPeriod = false;
                for (JsonNode row : rows(system)) {
                    if (row.path("prefix").asText().startsWith(r1Prefix)) {
                        assertEquals(1, row.path("cancelled").asLong(), "P3 counted cancelled");
                        r1Row = true;
                    }
                    if ("DELIVERY_CHALLAN".equals(row.path("document_type").asText())) {
                        assertEquals(transferNumber, row.path("to_number").asText());
                        challan = true;
                    }
                    otherPeriod |= !row.path("dated_in_other_period").isNull()
                            && !row.path("dated_in_other_period").asText().isBlank();
                }
                assertTrue(r1Row && challan, "R1 series and the challan series are listed");
                assertTrue(otherPeriod, "the back-dated documents are 'dated in another period', not a gap");
                assertTrue(rows(section(answer, "bill_books")).isEmpty(), "no bill book at G1");
            } else {
                assertTrue(rows(system).stream().anyMatch(r -> r.path("prefix").asText().startsWith(r2Prefix)),
                        "R2's series is a system row");
                List<JsonNode> books = rows(section(answer, "bill_books"));
                assertEquals(1, books.size(), "the bill book is listed apart");
                JsonNode book = books.get(0);
                assertTrue(book.path("prefix").asText().startsWith("BB" + r2));
                assertEquals("101", book.path("from_page").asText());
                assertEquals("103", book.path("to_page").asText());
                assertEquals(2, book.path("total").asLong());
                assertEquals("102", book.path("not_entered").asText(), "page 102 not entered");
            }
        }
    }

    // ================================================================== 3. money and counter

    @Test
    @Order(7)
    void dayBookAndPaymentModes() {
        // payment modes over the month, all places: every column = the proof's own sums
        JsonNode modes = report("payment-modes", month());
        JsonNode totals = modes.path("totals");
        Map<String, BigDecimal> tenders = tendersByMode(monthStart, today, null);
        Map<String, BigDecimal> refundsPaid = refundsByMethod(monthStart, today, null);
        same(of(tenders, "CASH"), totals.path("cash"), "cash");
        same(of(tenders, "UPI"), totals.path("upi"), "upi");
        same(of(tenders, "GATEWAY"), totals.path("gateway"), "gateway");
        same(of(tenders, "BANK_TRANSFER"), totals.path("bank_transfer"), "bank transfer");
        same(of(tenders, "COD"), totals.path("cod_collected"), "cod collected");
        same(of(refundsPaid, "CASH"), totals.path("refund_cash"), "cash refunds");
        same(of(refundsPaid, "BANK_TRANSFER"), totals.path("refund_bank_transfer"), "bank refunds");
        BigDecimal in = cashMoves("CASH_IN", monthStart, today, null);
        BigDecimal out = cashMoves("CASH_OUT", monthStart, today, null);
        same(in, totals.path("cash_in"), "cash in");
        same(out, totals.path("cash_out"), "cash out");
        BigDecimal received = tenders.entrySet().stream().filter(e -> !e.getKey().equals("CREDIT_NOTE"))
                .map(Map.Entry::getValue).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal refunded = refundsPaid.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        same(received.add(in).subtract(refunded).subtract(out), totals.path("net_money"), "net money");
        note("payment modes month totals " + totals);

        // IST day boundary: A's tender at 18:31 UTC on the last day of last month counts on the 1st;
        // F's at 18:29 UTC (23:59 India) stays on that last day.
        BigDecimal gatewayA = money("SELECT amount FROM commerce_order_tender WHERE order_id = ? AND mode = 'GATEWAY'",
                orderA);
        BigDecimal gatewayF = money("SELECT amount FROM commerce_order_tender WHERE order_id = ? AND mode = 'GATEWAY'",
                orderF);
        same(money("SELECT COALESCE(SUM(amount), 0) FROM commerce_order_tender WHERE institute_id = ? AND mode = "
                + "'GATEWAY' AND status = 'RECEIVED'", inst).subtract(gatewayF), totals.path("gateway"),
                "every gateway payment but F's (23:59 India last month) is in the month");
        BigDecimal firstDay = BigDecimal.ZERO;
        for (JsonNode row : rows(modes)) {
            if (monthStart.toString().equals(row.path("date").asText())) {
                firstDay = firstDay.add(decOr0(row.path("gateway")));
            }
        }
        assertTrue(firstDay.compareTo(gatewayA) >= 0, "A's gateway payment counts on the 1st: " + firstDay);
        JsonNode lastMonthDay = report("payment-modes", p("from", prevLast.toString(), "to", prevLast.toString()));
        same(gatewayF, lastMonthDay.path("totals").path("gateway"), "only F's payment on the last day of last month");

        // L1 today: the day book against payment modes and the documents
        JsonNode book = report("day-book", p("from", today.toString(), "to", today.toString(), "locationId", l1));
        JsonNode l1Modes = report("payment-modes", p("from", today.toString(), "to", today.toString(),
                "locationId", l1));
        JsonNode pm = l1Modes.path("totals");
        Map<String, BigDecimal> byModeIn = new HashMap<>();
        Map<String, BigDecimal> byModeOut = new HashMap<>();
        for (JsonNode row : rows(section(book, "by_mode"))) {
            byModeIn.put(row.path("payment_mode").asText(), decOr0(row.path("amount_in")));
            byModeOut.put(row.path("payment_mode").asText(), decOr0(row.path("amount_out")));
        }
        same(decOr0(pm.path("cash")).add(decOr0(pm.path("cash_in"))), of(byModeIn, "CASH"), "day book cash in");
        same(decOr0(pm.path("refund_cash")).add(decOr0(pm.path("cash_out"))), of(byModeOut, "CASH"),
                "day book cash out");
        same(decOr0(pm.path("upi")), of(byModeIn, "UPI"), "day book UPI");
        same(decOr0(pm.path("net_money")), book.path("totals").path("net_money"), "day book net = payment modes net");
        Map<String, BigDecimal> l1Tenders = tendersByMode(today, today, l1);
        Map<String, BigDecimal> l1Refunds = refundsByMethod(today, today, l1);
        BigDecimal l1In = l1Tenders.entrySet().stream().filter(e -> !e.getKey().equals("CREDIT_NOTE"))
                .map(Map.Entry::getValue).reduce(BigDecimal.ZERO, BigDecimal::add).add(cashMoves("CASH_IN", today,
                        today, l1));
        BigDecimal l1Out = l1Refunds.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add)
                .add(cashMoves("CASH_OUT", today, today, l1));
        same(l1In, book.path("totals").path("amount_in"), "L1 money in today");
        same(l1Out, book.path("totals").path("amount_out"), "L1 money out today");

        JsonNode docs = section(book, "documents");
        long invoicesToday = count("SELECT count(*) FROM invoice WHERE institute_id = ? AND document_type IS NOT NULL "
                + "AND location_id = ? AND document_date = ?", inst, l1, today);
        long notesToday = count("SELECT count(*) FROM commerce_credit_note n JOIN invoice i ON i.id = n.invoice_id "
                + "WHERE n.institute_id = ? AND i.location_id = ? AND n.document_date = ?", inst, l1, today);
        assertEquals(invoicesToday + notesToday, rows(docs).size(), "document rows = invoices + notes of L1 today");
        Map<String, Object> liveToday = invoiceHeads(null, today, today, true, null, l1);
        same(big(liveToday.get("total")), book.path("totals").path("invoices_value"), "invoice value of the day");
        same(big(noteHeads(null, today, today, null, l1).get("total")), book.path("totals").path("credit_notes_value"),
                "credit note value of the day");

        List<JsonNode> money = rows(section(book, "money"));
        Set<String> p2Modes = new HashSet<>();
        boolean receipt = false;
        boolean cod = false;
        boolean refund = false;
        boolean cashIn = false;
        boolean cashOut = false;
        for (JsonNode row : money) {
            String number = row.path("number").asText();
            String type = row.path("type").asText();
            if (orderNumber(p2).equals(number)) {
                p2Modes.add(row.path("payment_mode").asText());
            }
            assertFalse(orderNumber(p3).equals(number), "the voided bill's tenders are not money");
            if ("RECEIPT_ON_CREDIT".equals(type) && orderNumber(staffOrder).equals(number)) {
                receipt = true;
            }
            if ("COD_COLLECTED".equals(type) && orderNumber(orderC).equals(number)) {
                assertEquals(today.toString(), row.path("date").asText(), "dated by the remittance");
                assertEquals("—", row.path("time").asText(), "a date-only event");
                cod = true;
            }
            refund |= "REFUND_PAID".equals(type) && "CASH".equals(row.path("payment_mode").asText());
            cashIn |= "CASH_IN".equals(type);
            cashOut |= "CASH_OUT".equals(type);
        }
        assertEquals(Set.of("CASH", "UPI"), p2Modes, "P2 cash and UPI");
        assertTrue(receipt, "the staff receipt is a receipt on credit");
        assertTrue(cod && refund && cashIn && cashOut, "COD collected, cash refunds, cash in and out");
        same(money("SELECT counted_cash FROM pos_session WHERE id = ?", sessionR1),
                book.path("totals").path("cash_at_tills"), "cash at the tills = R1 counted");
        note("day book L1 " + today + " totals " + book.path("totals"));
        note("payment modes L1 today " + pm);
    }

    @Test
    @Order(8)
    void codOutstandingAndRto() {
        JsonNode now = report("cod-outstanding", month());
        Set<String> outstanding = texts(section(now, "outstanding"), "order_number");
        assertEquals(Set.of(orderNumber(orderD)), outstanding, "D is outstanding, C was remitted");
        JsonNode d = rows(section(now, "outstanding")).get(0);
        assertEquals(12, d.path("days_outstanding").asInt(), "India days since delivery");
        assertTrue(d.path("red_flag").asBoolean(), "more than 10 days");
        same(money("SELECT cod_amount FROM commerce_order WHERE id = ?", orderD), d.path("cod_amount"), "D amount");
        same(money("SELECT cod_amount FROM commerce_order WHERE id = ?", orderD),
                now.path("totals").path("outstanding_amount"), "outstanding total");
        assertEquals(Set.of(orderNumber(orderG)), texts(section(now, "in_transit"), "order_number"), "G in transit");

        JsonNode yesterday = report("cod-outstanding", month("asOf", today.minusDays(1).toString()));
        assertEquals(Set.of(orderNumber(orderC), orderNumber(orderD)),
                texts(section(yesterday, "outstanding"), "order_number"),
                "the day before its remittance C was outstanding too");

        Map<String, Object> remittance = db.queryForMap("SELECT gross_amount, deductions, net_amount FROM "
                + "commerce_cod_remittance WHERE id = ?", remittanceId);
        JsonNode rem = section(now, "remittances");
        assertEquals(1, rows(rem).size());
        same(big(remittance.get("gross_amount")), rem.path("totals").path("gross"), "gross");
        same(big(remittance.get("deductions")), rem.path("totals").path("deductions"), "deductions");
        same(big(remittance.get("net_amount")), rem.path("totals").path("net"), "net");

        for (JsonNode row : rows(section(now, "rto"))) {
            String method = row.path("payment_method").asText();
            Map<String, Object> expected = db.queryForMap("SELECT count(*) AS shipped, count(*) FILTER (WHERE "
                    + "status = 'RTO') AS rto FROM commerce_order WHERE institute_id = ? AND payment_method = ? AND "
                    + indiaDay("shipped_at") + " BETWEEN ? AND ?", inst, method, monthStart, today);
            assertEquals(((Number) expected.get("shipped")).longValue(), row.path("shipped").asLong(), method);
            assertEquals(((Number) expected.get("rto")).longValue(), row.path("rto").asLong(), method);
            note("rto " + row);
        }
        JsonNode codRow = rows(section(now, "rto")).stream().filter(r -> "COD".equals(r.path("payment_method")
                .asText())).findFirst().orElseThrow();
        assertEquals(4, codRow.path("shipped").asLong(), "C, D, E, G shipped");
        assertEquals(1, codRow.path("rto").asLong(), "E came back");
    }

    @Test
    @Order(9)
    void customerDuesNetOfReturn() {
        JsonNode dues = report("customer-dues", month());
        List<JsonNode> list = rows(dues);
        assertEquals(1, list.size(), "the staff credit order is the one due");
        JsonNode row = list.get(0);
        assertEquals(orderNumber(staffOrder), row.path("order_number").asText());
        BigDecimal total = money("SELECT total FROM commerce_order WHERE id = ?", staffOrder);
        BigDecimal paid = money("SELECT amount_paid FROM commerce_order WHERE id = ?", staffOrder);
        BigDecimal credited = money("SELECT COALESCE(SUM(credit_total - due_raised), 0) FROM commerce_return WHERE "
                + "order_id = ? AND status IN ('RECEIVED', 'CLOSED')", staffOrder);
        BigDecimal due = total.subtract(paid).subtract(credited).max(BigDecimal.ZERO);
        same(total, row.path("total"), "total");
        same(paid, row.path("received"), "received");
        same(credited, row.path("credited_by_returns"), "credited by returns");
        same(due, row.path("due"), "due = total - received - credit not raised");
        same(due, dues.path("totals").path("due"), "dues total = rows");
        if (credited.signum() > 0) {
            assertTrue(hasWarning(dues, "DUE_REDUCED_BY_RETURN"), "the lowered due is flagged");
        }
        note("dues " + row);
    }

    @Test
    @Order(10)
    void posSessionsEqualZReports() throws Exception {
        JsonNode answer = report("pos-sessions", month());
        Map<String, JsonNode> byId = new HashMap<>();
        rows(answer).forEach(r -> byId.put(r.path("session_id").asText(), r));
        for (String session : List.of(sessionR1, sessionR2)) {
            JsonNode row = byId.get(session);
            assertNotNull(row, "session " + session + " listed");
            JsonNode z = objectMapper.readTree(text("SELECT z_report_json FROM pos_session WHERE id = ?", session));
            assertEquals(z.path("bills").path("count").asLong(), row.path("bills").asLong(), "bills");
            same(dec(z.path("bills").path("total")), row.path("bills_value"), "bills value");
            assertEquals(z.path("voided").path("count").asLong(), row.path("voided").asLong(), "voided");
            same(dec(z.path("expected_cash")), row.path("expected"), "expected");
            same(dec(z.path("counted_cash")), row.path("counted"), "counted");
            same(dec(z.path("variance")), row.path("variance"), "variance");
            note("session row " + row);
        }
        same(amount("10.00"), byId.get(sessionR2).path("variance"), "R2 ten over");
        assertEquals(1, byId.get(sessionR1).path("voided").asLong(), "P3 voided at R1");
        assertEquals(2, byId.get(sessionR2).path("bill_book_bills").asLong(), "two paper bills at R2");
        BigDecimal liveInvoices = money("SELECT COALESCE(SUM(i.total_amount), 0) FROM invoice i JOIN commerce_order o "
                + "ON o.id = i.commerce_order_id WHERE o.pos_session_id IN (?, ?) AND i.cancelled_at IS NULL", sessionR1,
                sessionR2);
        BigDecimal reissued = money("SELECT COALESCE(SUM(n.total), 0) FROM commerce_credit_note n JOIN invoice i ON "
                + "i.id = n.invoice_id JOIN commerce_order o ON o.id = i.commerce_order_id WHERE o.pos_session_id IN "
                + "(?, ?) AND n.client_request_id LIKE 'REISSUE:%'", sessionR1, sessionR2);
        BigDecimal billsValue = decOr0(answer.path("totals").path("bills_value"))
                .add(decOr0(answer.path("totals").path("bill_book_value")));
        note("pos sessions check " + answer.path("check") + "; live invoices " + liveInvoices + ", reissue notes "
                + reissued);
        same(liveInvoices.subtract(reissued), billsValue,
                "bills value (+ paper) = live POS invoices less the replaced bill");
        same(ZERO, answer.path("check").path("difference"), "the report's own check");
    }

    @Test
    @Order(11)
    void salesAndProducts() {
        JsonNode sold = report("sales", month());
        Map<String, Object> live = invoiceHeads(null, monthStart, today, true, null, null);
        Map<String, Object> notes = noteHeads(null, monthStart, today, null, null);
        same(big(live.get("total")), sold.path("totals").path("net"), "sales net = live invoice totals");
        same(big(notes.get("total")), sold.path("totals").path("returns"), "returns = note totals");
        same(big(live.get("total")).subtract(big(notes.get("total"))), sold.path("totals").path("net_after_returns"),
                "net after returns");
        assertEquals(((Number) live.get("n")).longValue(), sold.path("totals").path("invoices").asLong());

        JsonNode byStaff = report("sales", month("groupBy", "staff"));
        String staffColumn = byStaff.path("columns").get(0).path("key").asText();
        Set<String> staff = texts(byStaff, staffColumn);
        assertTrue(staff.contains("Test Cashier"), "the cashier by name: " + staff);
        assertTrue(staff.contains("Online"), "online rows read Online: " + staff);
        same(big(live.get("total")), byStaff.path("totals").path("net"), "by staff adds to the same net");

        JsonNode products = report("products", month());
        JsonNode cloth = rows(products).stream().filter(r -> "Cotton cloth".equals(r.path("product").asText()))
                .findFirst().orElseThrow();
        assertEquals("5.9 m", cloth.path("sold_text").asText());
        assertEquals("3.4 m", cloth.path("returned_text").asText());
        assertEquals("2.5 m", cloth.path("net_text").asText());
        assertEquals("₹123.40 / m", cloth.path("average_rate_text").asText());
        BigDecimal clothValue = money("SELECT COALESCE(SUM(li.amount), 0) FROM invoice_line_item li JOIN invoice i ON "
                + "i.id = li.invoice_id WHERE i.institute_id = ? AND i.cancelled_at IS NULL AND li.package_session_id = ? "
                + "AND i.document_date BETWEEN ? AND ?", inst, cotton, monthStart, today)
                .subtract(money("SELECT COALESCE(SUM(l.amount), 0) FROM commerce_credit_note_line l JOIN "
                        + "commerce_credit_note n ON n.id = l.credit_note_id WHERE n.institute_id = ? AND "
                        + "l.package_session_id = ? AND n.document_date BETWEEN ? AND ?", inst, cotton, monthStart, today));
        same(clothValue, cloth.path("net_value"), "cloth net value");
        assertTrue(texts(section(products, "never_sold"), "product").contains("Steel cup"), "the unsold cup");
        assertEquals(count("SELECT count(DISTINCT i.id) FROM invoice i JOIN invoice_line_item li ON li.invoice_id = "
                + "i.id WHERE i.institute_id = ? AND i.document_type IS NOT NULL AND i.cancelled_at IS NULL AND "
                + "li.package_session_id IS NOT NULL AND i.document_date BETWEEN ? AND ?", inst, monthStart, today),
                products.path("totals").path("invoices").asLong(), "products: distinct invoices with goods");
        note("products cloth " + cloth);
        note("sales totals " + sold.path("totals"));
    }

    // ================================================================== 4. files

    private static final List<String> EXPORTED = List.of("sales-register", "credit-notes", "tax-by-rate",
            "hsn-summary", "gstr1", "documents-issued", "day-book", "payment-modes", "cod-outstanding",
            "customer-dues", "pos-sessions", "sales", "products");

    private record Block(String key, List<JsonNode> columns, int rows, JsonNode totals) {
    }

    private static List<Block> blocks(JsonNode answer) {
        List<Block> out = new ArrayList<>();
        if (answer.path("columns").size() > 0) {
            List<JsonNode> columns = new ArrayList<>();
            answer.path("columns").forEach(columns::add);
            out.add(new Block(null, columns, answer.path("rows").size(), answer.path("totals")));
        }
        for (JsonNode s : answer.path("sections")) {
            List<JsonNode> columns = new ArrayList<>();
            s.path("columns").forEach(columns::add);
            out.add(new Block(s.path("key").asText(), columns, s.path("rows").size(), s.path("totals")));
        }
        return out;
    }

    /** CSV column sums = JSON totals; for the sales register, ACTIVE rows only (status forward-filled). */
    private void csvAgrees(String name, JsonNode answer, byte[] bytes) throws IOException {
        assertTrue(bytes.length >= 3 && (bytes[0] & 0xFF) == 0xEF && (bytes[1] & 0xFF) == 0xBB
                && (bytes[2] & 0xFF) == 0xBF, name + " CSV starts with the BOM");
        String body = new String(bytes, 3, bytes.length - 3, StandardCharsets.UTF_8);
        List<CSVRecord> records;
        List<String> header;
        try (CSVParser parser = CSVParser.parse(new StringReader(body), CSVFormat.DEFAULT.withFirstRecordAsHeader())) {
            header = parser.getHeaderNames();
            records = parser.getRecords();
        }
        boolean sectioned = !header.isEmpty() && "section".equals(header.get(0));
        Map<String, List<CSVRecord>> groups = new LinkedHashMap<>();
        for (CSVRecord record : records) {
            groups.computeIfAbsent(sectioned ? record.get("section") : "", k -> new ArrayList<>()).add(record);
        }
        List<Block> blocks = blocks(answer);
        int compared = 0;
        for (Block block : blocks) {
            String groupKey = !sectioned ? "" : block.key() != null ? block.key() : null;
            List<CSVRecord> group;
            if (groupKey == null) {
                // the main table of a block report: the CSV section that is no JSON section
                Set<String> sectionKeys = new HashSet<>();
                blocks.forEach(b -> {
                    if (b.key() != null) {
                        sectionKeys.add(b.key());
                    }
                });
                group = groups.entrySet().stream().filter(e -> !sectionKeys.contains(e.getKey()))
                        .map(Map.Entry::getValue).findFirst().orElse(List.of());
            } else {
                group = groups.getOrDefault(groupKey, List.of());
            }
            assertEquals(block.rows(), group.size(), name + " " + block.key() + " CSV rows = JSON rows");
            String lastStatus = null;
            Map<String, BigDecimal> sums = new HashMap<>();
            for (CSVRecord record : group) {
                if ("sales-register".equals(name)) {
                    String s = record.get("status");
                    lastStatus = s == null || s.isBlank() ? lastStatus : s;
                    if (!"ACTIVE".equals(lastStatus)) {
                        continue;
                    }
                }
                for (JsonNode column : block.columns()) {
                    String key = column.path("key").asText();
                    if (!summed(column) || !record.isMapped(key)) {
                        continue;
                    }
                    String cell = record.get(key);
                    if (cell != null && !cell.isBlank()) {
                        sums.merge(key, new BigDecimal(cell), BigDecimal::add);
                    }
                }
            }
            for (JsonNode column : block.columns()) {
                String key = column.path("key").asText();
                JsonNode total = block.totals().path(key);
                if (summed(column) && total.isNumber() && !distinctCount(name, key)) {
                    same(dec(total), sums.getOrDefault(key, BigDecimal.ZERO), name + " " + block.key() + " CSV "
                            + key);
                    compared++;
                }
            }
        }
        note(name + " CSV: " + records.size() + " rows, " + compared + " totals equal");
    }

    /** XLSX bold totals rows = JSON totals, block by block in workbook order. */
    private int xlsxAgrees(String name, List<Block> blocks, byte[] bytes) throws IOException {
        int compared = 0;
        try (XSSFWorkbook book = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
            int sheetAt = 0;
            int rowAt = 0;
            for (Block block : blocks) {
                List<String> labels = block.columns().stream().map(c -> c.path("label").asText()).toList();
                int[] found = null;
                for (int s = sheetAt; s < book.getNumberOfSheets() && found == null; s++) {
                    Sheet sheet = book.getSheetAt(s);
                    for (int r = s == sheetAt ? rowAt : 0; r <= sheet.getLastRowNum(); r++) {
                        if (labels.equals(cells(sheet.getRow(r), labels.size()))) {
                            found = new int[] {s, r};
                            break;
                        }
                    }
                }
                assertNotNull(found, name + ": header of block " + block.key() + " " + labels);
                Sheet sheet = book.getSheetAt(found[0]);
                int r = found[1] + 1;
                int data = 0;
                Row totals = null;
                for (; r <= sheet.getLastRowNum(); r++) {
                    Row row = sheet.getRow(r);
                    if (row == null || row.getPhysicalNumberOfCells() == 0) {
                        break;
                    }
                    if (bold(book, row)) {
                        totals = row;
                        r++;
                        break;
                    }
                    data++;
                }
                assertEquals(block.rows(), data, name + " " + block.key() + " XLSX data rows");
                for (int i = 0; i < block.columns().size(); i++) {
                    JsonNode column = block.columns().get(i);
                    JsonNode total = block.totals().path(column.path("key").asText());
                    if (summed(column) && total.isNumber() && !distinctCount(name, column.path("key").asText())) {
                        assertNotNull(totals, name + " " + block.key() + " has a totals row");
                        Cell cell = totals.getCell(i);
                        assertNotNull(cell, name + " " + block.key() + " total of " + column.path("key").asText());
                        assertEquals(CellType.NUMERIC, cell.getCellType());
                        same(dec(total), BigDecimal.valueOf(cell.getNumericCellValue()).setScale(2, RoundingMode.HALF_UP),
                                name + " " + block.key() + " XLSX " + column.path("key").asText());
                        compared++;
                    }
                }
                sheetAt = found[0];
                rowAt = r;
            }
        }
        return compared;
    }

    /**
     * The products report's {@code invoices} total is the number of distinct invoices, not the sum
     * of the per-row counts (an invoice of two products is one invoice); held against SQL in
     * {@code salesAndProducts} instead.
     */
    private static boolean distinctCount(String report, String key) {
        return "products".equals(report) && "invoices".equals(key);
    }

    /** Money and count columns are compared (their totals are sums of the rows). */
    private static boolean summed(JsonNode column) {
        String type = column.path("type").asText();
        return "MONEY".equals(type) || "INT".equals(type);
    }

    private static List<String> cells(Row row, int n) {
        List<String> out = new ArrayList<>();
        if (row == null) {
            return out;
        }
        for (int i = 0; i < n; i++) {
            Cell cell = row.getCell(i);
            out.add(cell == null || cell.getCellType() != CellType.STRING ? null : cell.getStringCellValue());
        }
        return out;
    }

    private static boolean bold(XSSFWorkbook book, Row row) {
        for (Cell cell : row) {
            if (book.getFontAt(cell.getCellStyle().getFontIndex()).getBold()) {
                return true;
            }
        }
        return false;
    }

    private long exportRows(String report) {
        return count("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = 'REPORT_EXPORTED' AND "
                + "reference_type = 'REPORT' AND reference_id = ?", inst, report);
    }

    @Test
    @Order(12)
    void exportsEqualJson() throws Exception {
        for (String name : EXPORTED) {
            Map<String, String> q = name.equals("day-book") ? p("from", today.toString(), "to", today.toString())
                    : month("sellerGstin", ReportAccess.kindOf(name) == ReportAccess.Kind.GST ? G1 : null);
            JsonNode answer = report(name, q);
            long before = exportRows(name);
            byte[] csv = file(name, q, "csv");
            csvAgrees(name, answer, csv);
            byte[] xlsx = file(name, q, "xlsx");
            int compared = xlsxAgrees(name, blocks(answer), xlsx);
            note(name + " XLSX: " + compared + " totals equal");
            assertEquals(before + 2, exportRows(name), name + ": one REPORT_EXPORTED row per export");
            if (name.equals("sales-register")) {
                assertTrue(new String(csv, StandardCharsets.UTF_8).contains("\"'=HYPERLINK(\"\"http://x\"\")\""),
                        "the formula customer is defused with a leading quote");
            }
        }
        // the GST pack: the GSTR-1 sheets, then the sales register, credit notes and tax by rate
        Map<String, String> q = month("sellerGstin", G1);
        List<Block> pack = new ArrayList<>(blocks(report("gstr1", q)));
        pack.addAll(blocks(report("sales-register", q)));
        pack.addAll(blocks(report("credit-notes", q)));
        pack.addAll(blocks(report("tax-by-rate", q)));
        long before = exportRows("gst-pack");
        byte[] workbook = file("gst-pack", q, "xlsx");
        note("gst-pack XLSX: " + xlsxAgrees("gst-pack", pack, workbook) + " totals equal");
        assertEquals(before + 1, exportRows("gst-pack"));
        String audit = text("SELECT new_value_json::text FROM commerce_audit WHERE institute_id = ? AND kind = "
                + "'REPORT_EXPORTED' AND reference_id = 'gst-pack' ORDER BY created_at DESC LIMIT 1", inst);
        assertTrue(audit.contains("\"format\"") && audit.contains("\"rows\""), audit);
    }

    // ================================================================== 5. who may see what

    @Test
    @Order(13)
    void accessAndScope() {
        JsonNode mine = report(accountant, "sales", month("groupBy", "location"));
        String l2Name = locationName(l2);
        for (JsonNode row : rows(mine)) {
            assertEquals(l2Name, row.path("location").asText(), "an L2 accountant sees L2 only");
        }
        same(big(invoiceHeads(null, monthStart, today, true, null, l2).get("total")), mine.path("totals").path("net"),
                "L2 net = live L2 invoices");
        refused("LOCATION_NOT_ALLOWED", () -> report(accountant, "sales", month("locationId", l1)));
        refused("LOCATION_NOT_ALLOWED", () -> report(accountant, "sales-register", month("sellerGstin", G2)));
        refused("LOCATION_NOT_ALLOWED", () -> call(reports, accountant, "gst-pack", month("sellerGstin", G2)));
        for (CustomUserDetails who : List.of(cashier, warehouse)) {
            for (String name : EXPORTED) {
                refused("ROLE_NOT_ALLOWED", () -> report(who, name, month("sellerGstin", G1)));
            }
            refused("ROLE_NOT_ALLOWED", () -> auditList.list(who, inst, monthStart, today, null, null, null, null,
                    null, null, null));
        }
        header(otherInst);
        try {
            CustomUserDetails otherAdmin = user("admin-other-" + run, "ADMIN");
            refused("ACCESS_DENIED", () -> report(otherAdmin, "sales", month()));
        } finally {
            header(inst);
        }
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, "
                + "'commerce.tax_reports', false)", inst);
        capabilityResolver.evict(inst);
        try {
            refused("FEATURE_DISABLED", () -> report("sales-register", month("sellerGstin", G1)));
            refused("FEATURE_DISABLED", () -> report("day-book", p()));
            assertEquals("sales", report("sales", month()).path("report").asText(), "sales still answers");
        } finally {
            db.update("DELETE FROM institute_module_entitlement WHERE institute_id = ? AND key = "
                    + "'commerce.tax_reports'", inst);
            capabilityResolver.evict(inst);
        }
    }

    @Test
    @Order(14)
    void auditLog() {
        JsonNode price = objectMapper.valueToTree(auditList.list(admin, inst, monthStart, today, null, null,
                "VARIANT_PRICE_CHANGED", null, null, null, null).getBody());
        assertEquals(1, price.path("rows").size(), "the price change");
        boolean newPrice = false;
        for (JsonNode change : price.path("rows").get(0).path("changes")) {
            newPrice |= "new_price".equals(change.path("key").asText());
        }
        assertTrue(newPrice, "old -> new per key: " + price.path("rows").get(0));
        JsonNode approvals = objectMapper.valueToTree(auditList.approvals(admin, inst, monthStart, today, null,
                p3Number, null, null).getBody());
        assertTrue(texts(approvals, "action").contains("POS_VOID"), "the void approval: " + approvals);
        JsonNode byNumber = objectMapper.valueToTree(auditList.list(admin, inst, monthStart, today, null, null, null,
                p3Number, null, null, null).getBody());
        Set<String> refs = texts(byNumber, "reference_id");
        assertTrue(refs.contains(p3) || refs.contains(liveOrCancelledInvoice(p3)), "rows of the voided bill: " + refs);
        note("audit rows of " + p3Number + ": " + texts(byNumber, "kind"));
        JsonNode first = objectMapper.valueToTree(auditList.list(admin, inst, monthStart, today, null, null, null, null,
                null, 3, null).getBody());
        assertEquals(3, first.path("rows").size());
        String cursor = first.path("next_cursor").asText();
        assertFalse(cursor.isBlank(), "a second page");
        JsonNode second = objectMapper.valueToTree(auditList.list(admin, inst, monthStart, today, null, null, null,
                null, cursor, 3, null).getBody());
        Set<String> ids = texts(first, "id");
        for (JsonNode row : second.path("rows")) {
            assertFalse(ids.contains(row.path("id").asText()), "no repeats on page 2");
        }
        assertTrue(second.path("rows").size() > 0);
    }

    private String liveOrCancelledInvoice(String orderId) {
        return text("SELECT id FROM invoice WHERE commerce_order_id = ? ORDER BY created_at LIMIT 1", orderId);
    }

    // ================================================================== 6. limits and timing

    @Test
    @Order(15)
    void limitsAndTimeout() throws Exception {
        refused("VALIDATION", () -> report("sales", p("from", today.minusDays(366).toString(), "to",
                today.toString())));
        assertEquals("25s", reportRunner.screen(() -> db.queryForObject("SHOW statement_timeout", String.class)),
                "the screen read runs with the 25 s statement timeout");

        // The export cap lowered to 5 rows (the property commerce.reports.export-max-rows=5).
        ReportRunner small = new ReportRunner(namedJdbc, transactionManager, auditService, 5);
        CommerceReportController capped = new CommerceReportController(reportAccess, small, stockClock, gstReports,
                dayBookService, paymentModesService, codDuesService, posSessionsService, salesReportService, userNames);
        long before = exportRows("sales-register");
        Map<String, String> csv = month("sellerGstin", G1, "format", "csv");
        refused("EXPORT_TOO_LARGE", () -> call(capped, admin, "sales-register", csv));
        assertEquals(before, exportRows("sales-register"), "a refused export writes no audit row");

        // A second export while one runs: 429.
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicReference<Throwable> failed = new AtomicReference<>();
        Thread holder = new Thread(() -> {
            try {
                small.export(new ReportRunner.ExportAudit(inst, adminId, null, "busy-probe", monthStart.toString(),
                        today.toString(), Map.of(), "csv"), (out, maxRows) -> {
                    started.countDown();
                    try {
                        assertTrue(release.await(60, TimeUnit.SECONDS));
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                    return 0;
                });
            } catch (Throwable e) {
                failed.set(e);
            }
        });
        holder.start();
        try {
            assertTrue(started.await(30, TimeUnit.SECONDS));
            refused("REPORT_BUSY", () -> call(capped, admin, "customer-dues", month("format", "csv")));
        } finally {
            release.countDown();
            holder.join(60_000);
        }
        assertNull(failed.get());

        // Timing of every report on the seed (the lead's input; no migration is added).
        for (String name : EXPORTED) {
            Map<String, String> q = name.equals("day-book") ? p("from", today.toString(), "to", today.toString())
                    : month("sellerGstin", ReportAccess.kindOf(name) == ReportAccess.Kind.GST ? G1 : null);
            long start = System.nanoTime();
            report(name, q);
            note("timing " + name + " " + (System.nanoTime() - start) / 1_000_000 + " ms");
        }
        for (String plan : List.of(
                "EXPLAIN SELECT mode, SUM(amount) FROM commerce_order_tender WHERE institute_id = '" + inst
                        + "' AND status = 'RECEIVED' AND received_at >= '" + monthStart + "' GROUP BY mode",
                "EXPLAIN SELECT count(*) FROM invoice WHERE institute_id = '" + inst + "' AND document_type IS NOT NULL "
                        + "AND document_date BETWEEN '" + monthStart + "' AND '" + today + "'")) {
            note("plan " + String.join(" | ", db.queryForList(plan, String.class)));
        }
    }
}
