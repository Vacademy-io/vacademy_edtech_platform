package vacademy.io.admin_core_service.features.ai_plans_billing.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansInternalClient;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.ChargeView;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.PaymentLinkRequest;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionBillingService.PayRequest;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionCollectionService.Report;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformBillingProfile;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentDisposition;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Wire end-to-end: admin_core's real billing services (facade, payment service, collection job,
 * webhook handler and S2's PlatformRazorpayWebHookService) talk over HTTP, through the real
 * {@link AiPlansInternalClient}, to the REAL ai_service plan routers running on Postgres 16 with
 * V590 (psycopg 3), and share that database for {@code ai_subscription_mandate} via the real JDBC
 * {@link AiSubscriptionMandateStore}. Razorpay is mocked; platform_payment rows are in memory.
 *
 * <p>Skipped unless AI_PLANS_E2E_URL (the ai_service base URL, with the test-only
 * {@code /__test/clock|seed|sql} endpoints of scratchpad/int2/e2e_server.py) and
 * AI_PLANS_E2E_JDBC (the same database) are set.
 */
class AiPlansWireE2ETest {

    static final String RETURN = "https://admin.inst.test/settings?aiSection=grp-plan";
    static final long PRO_TOTAL = 590_000L;
    static final ObjectMapper JSON = new ObjectMapper();

    String url;
    BillingFixture f;
    String inst;
    String version;
    long offsetSeconds;
    /** Razorpay ids are unique per run: the database is shared across runs. */
    final String t = java.util.UUID.randomUUID().toString().substring(0, 8);
    final HttpClient http = HttpClient.newHttpClient();

    @BeforeEach
    void boot() throws Exception {
        url = System.getenv("AI_PLANS_E2E_URL");
        String jdbcUrl = System.getenv("AI_PLANS_E2E_JDBC");
        Assumptions.assumeTrue(url != null && !url.isBlank() && jdbcUrl != null, "AI_PLANS_E2E_URL not set");
        DriverManagerDataSource ds = new DriverManagerDataSource(jdbcUrl);
        ds.setDriverClassName("org.postgresql.Driver");
        // The production constructor (same HTTP/1.1 JDK client and timeouts as in admin_core).
        AiPlansInternalClient client = new AiPlansInternalClient(url, "svc-token");
        f = new BillingFixture(client, new AiSubscriptionMandateStore(new JdbcTemplate(ds)));
        clock(0);
        Map<String, Object> seeded = postJson("/__test/seed");
        inst = (String) seeded.get("institute_id");
        version = (String) seeded.get("plan_version_id");
        Institute i = new Institute();
        i.setId(inst);
        i.setEmail("admin@inst.test");
        i.setMobileNumber("9876543210");
        when(f.instituteRepo.findById(inst)).thenReturn(Optional.of(i));
        PlatformBillingProfile prof = new PlatformBillingProfile();
        prof.setInstituteId(inst);
        prof.setLegalName("E2E Institute Pvt Ltd");
        prof.setStateCode("27");
        prof.setBillingEmail("accounts@inst.test");
        f.profiles.put(inst, prof);
    }

    // ── helpers: clock, sql, roll ────────────────────────────────────────

    /** Moves ai_service's clock and the fixture's clock together. */
    void clock(long offsetS) throws Exception {
        offsetSeconds = offsetS;
        postJson("/__test/clock?offset_s=" + offsetS);
        f.now = Instant.now().plusSeconds(offsetS);
    }

    void clockAt(Instant at) throws Exception {
        clock(Duration.between(Instant.now(), at).getSeconds());
    }

    List<Map<String, Object>> sql(String q) throws Exception {
        HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create(url + "/__test/sql?q="
                + URLEncoder.encode(q, StandardCharsets.UTF_8))).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, r.statusCode(), r.body());
        return JSON.readValue(r.body(), new TypeReference<>() {});
    }

    Object one(String q) throws Exception {
        List<Map<String, Object>> rows = sql(q);
        return rows.isEmpty() ? null : rows.get(0).values().iterator().next();
    }

    Map<String, Object> postJson(String path) throws Exception {
        HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create(url + path))
                .header("X-Internal-Service-Token", "svc-token")
                .POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, r.statusCode(), r.body());
        return JSON.readValue(r.body(), new TypeReference<>() {});
    }

    /** ai_service's scheduled roll (renewal charge at T-7, grace, expiry), as the scheduler calls it. */
    Map<String, Object> roll() throws Exception {
        return postJson("/ai-service/internal/plans/v1/roll?institute_id=" + inst);
    }

    String subStatus() throws Exception {
        return (String) one("SELECT status FROM institute_ai_subscription WHERE institute_id = '" + inst + "'");
    }

    long paidPeriods() throws Exception {
        return ((Number) one("SELECT count(*) FROM ai_subscription_period p JOIN institute_ai_subscription s "
                + "ON s.id = p.subscription_id WHERE s.institute_id = '" + inst + "' AND p.payment_status = 'PAID'"))
                .longValue();
    }

    Instant latestPeriodEnd() throws Exception {
        Object v = one("SELECT to_char(max(p.period_end) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                + "FROM ai_subscription_period p JOIN institute_ai_subscription s ON s.id = p.subscription_id "
                + "WHERE s.institute_id = '" + inst + "'");
        return Instant.parse((String) v);
    }

    Map<String, Object> chargeRow(String where) throws Exception {
        List<Map<String, Object>> rows = sql("SELECT CAST(c.id AS TEXT) AS id, c.status, c.kind, c.total_minor, "
                + "c.base_minor, c.tax_minor, c.place_of_supply, c.tax_head, c.platform_payment_id, c.vendor_payment_id, "
                + "to_char(c.next_attempt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS next_attempt_at "
                + "FROM ai_subscription_charge c WHERE c.institute_id = '" + inst + "' AND " + where
                + " ORDER BY c.created_at DESC LIMIT 1");
        return rows.isEmpty() ? null : rows.get(0);
    }

    PayRequest pay(boolean autopay, String key) {
        return new PayRequest(version, autopay, autopay ? "UPI" : null, autopay ? "9876543210" : null, RETURN, key);
    }

    // ── (b) payments enabled: first purchase by link ─────────────────────

    @Test
    void firstPurchaseByLinkActivatesOnCaptureIdempotentlyAndRefundsADuplicateOnce() throws Exception {
        Map<String, Object> out = f.billing.checkout(inst, pay(false, "e2e-k1"), "user-1", "admin@inst.test");
        assertEquals("LINK", out.get("mode"));
        assertEquals(PRO_TOTAL, out.get("total_minor"), "Rs 5,000 + 18% GST");
        assertEquals("PENDING", subStatus());
        Map<String, Object> ch = chargeRow("c.kind = 'PERIOD'");
        assertEquals("LINK_SENT", ch.get("status"));
        assertEquals(PRO_TOTAL, ((Number) ch.get("total_minor")).longValue(), "tax snapshot on the charge before the link");
        assertEquals("27", ch.get("place_of_supply"));
        assertEquals("IGST", ch.get("tax_head"));

        PlatformPayment pp = f.payments.get((String) out.get("platform_payment_id"));
        assertEquals(200, f.deliver(f.capturedEvent(pp.getId(), "pay_e2e_1_" + t, PRO_TOTAL, null, null))
                .getStatusCode().value());
        assertEquals(PlatformPaymentResult.PAID, pp.getPaymentStatus());
        assertEquals("ACTIVE", subStatus());
        assertEquals(1, paidPeriods());
        ch = chargeRow("c.kind = 'PERIOD'");
        assertEquals("PAID", ch.get("status"));
        assertEquals("pay_e2e_1_" + t, ch.get("vendor_payment_id"));
        verify(f.invoiceService, times(1)).generateInvoice(pp.getId());
        verify(f.documentMail, times(1)).sendInvoiceEmail(any());

        // order.paid / Razorpay retry of the same payment: nothing new anywhere.
        assertEquals(200, f.deliver(f.capturedEvent(pp.getId(), "pay_e2e_1_" + t, PRO_TOTAL, null, null))
                .getStatusCode().value());
        assertEquals(1, paidPeriods());
        verify(f.documentMail, times(1)).sendInvoiceEmail(any());

        // A second, different payment for the paid charge (another payable row): refunded once, never invoiced.
        ChargeView cv = ChargeView.from(f.api.charge((String) ch.get("id"), inst));
        PlatformPayment second = f.paymentService.createPaymentRow(AiSubscriptionBillingService.withInstitute(cv, inst),
                f.paymentService.price(AiSubscriptionBillingService.withInstitute(cv, inst)), null,
                Map.of("purpose", "LINK"));
        assertEquals(200, f.deliver(f.capturedEvent(second.getId(), "pay_e2e_2_" + t, PRO_TOTAL, null, null))
                .getStatusCode().value());
        assertEquals(PlatformPaymentDisposition.DUPLICATE, second.getDisposition());
        assertEquals(List.of("pay_e2e_2_" + t + ":" + PRO_TOTAL), f.refunds);
        f.deliver(f.capturedEvent(second.getId(), "pay_e2e_2_" + t, PRO_TOTAL, null, null));
        assertEquals(1, f.refunds.size(), "never a second refund");
        verify(f.invoiceService, never()).generateInvoice(second.getId());
        assertEquals(1, paidPeriods());
    }

    // ── (c) autopay: registration, token.confirmed, renewal debit, failed debit -> link -> grace -> expired ──

    @Test
    void autopayRenewsByDebitThenAFailedDebitFallsBackToALinkThenGraceThenExpiry() throws Exception {
        Map<String, Object> out = f.billing.checkout(inst, pay(true, "e2e-auto"), "user-1", "admin@inst.test");
        assertEquals("MANDATE", out.get("mode"));
        PlatformPayment reg = f.payments.get((String) out.get("platform_payment_id"));
        String mandateId = (String) one("SELECT CAST(id AS TEXT) FROM ai_subscription_mandate WHERE institute_id = '"
                + inst + "'");
        assertEquals("PENDING", one("SELECT status FROM ai_subscription_mandate WHERE id = CAST('" + mandateId
                + "' AS UUID)"));

        // The authorisation payment pays the first period; ACTIVE mandate only on token.confirmed.
        f.deliver(f.capturedEvent(null, "pay_auth_e2e_" + t, PRO_TOTAL, "token_e2e_" + t, reg.getVendorOrderId()));
        assertEquals(PlatformPaymentResult.PAID, reg.getPaymentStatus());
        assertEquals("ACTIVE", subStatus());
        assertEquals(200, f.deliver(f.tokenEvent("token.confirmed", "token_e2e_" + t, "confirmed")).getStatusCode().value());
        assertEquals("ACTIVE", one("SELECT status FROM ai_subscription_mandate WHERE id = CAST('" + mandateId
                + "' AS UUID)"));

        // Renewal 1: T-71 h (inside the 72 h notice window) -> roll creates the charge, the job sends the notice and schedules the debit.
        Instant end1 = latestPeriodEnd();
        clockAt(end1.minus(Duration.ofHours(71)));
        roll();
        Report r = f.collection.runOnce();
        assertEquals(1, r.counts.get("pre_debit_notices"), r.toString());
        Map<String, Object> ch = chargeRow("c.kind = 'PERIOD' AND c.status NOT IN ('PAID','VOID')");
        assertEquals("DEBIT_SCHEDULED", ch.get("status"));
        Instant next = Instant.parse((String) ch.get("next_attempt_at"));
        assertEquals(end1.minus(Duration.ofHours(40)), next,
                "raised 40 h before the start: Razorpay debits UPI 24-36 h and cards 36 h 5 min later");
        clockAt(next.plusSeconds(60));
        r = f.collection.runOnce();
        assertEquals(1, r.counts.get("debits_created"), r.toString());
        PlatformPayment debit = f.payments.values().stream()
                .filter(p -> p.getVendorOrderId() != null && p.getVendorOrderId().startsWith("order_debit"))
                .reduce((a, b) -> b).orElseThrow();
        f.deliver(f.capturedEvent(debit.getId(), "pay_debit_e2e_1_" + t, PRO_TOTAL, "token_e2e_" + t, debit.getVendorOrderId()));
        assertEquals(PlatformPaymentResult.PAID, debit.getPaymentStatus());
        assertEquals(2, paidPeriods(), "the next period is paid by the debit");
        verify(f.invoiceService).generateInvoice(debit.getId());

        // Renewal 2: the debit fails -> FAILED -> payment link at once -> unpaid -> GRACE -> EXPIRED.
        Instant end2 = latestPeriodEnd();
        assertTrue(end2.isAfter(end1));
        clockAt(end2.minus(Duration.ofHours(71)));
        roll();
        f.collection.runOnce();
        ch = chargeRow("c.kind = 'PERIOD' AND c.status NOT IN ('PAID','VOID')");
        clockAt(Instant.parse((String) ch.get("next_attempt_at")).plusSeconds(60));
        f.collection.runOnce();
        PlatformPayment debit2 = f.payments.values().stream()
                .filter(p -> p.getVendorOrderId() != null && p.getVendorOrderId().startsWith("order_debit"))
                .reduce((a, b) -> b).orElseThrow();
        assertNotEquals(debit.getId(), debit2.getId());
        assertEquals(200, f.deliver(f.failedEvent(debit2.getId(), "pay_fail_e2e_" + t)).getStatusCode().value());
        ArgumentCaptor<PaymentLinkRequest> lr = ArgumentCaptor.forClass(PaymentLinkRequest.class);
        verify(f.gateway, atLeastOnce()).createPaymentLink(lr.capture());
        assertEquals(PRO_TOTAL, lr.getValue().amountMinor());
        assertEquals("LINK_SENT", chargeRow("c.id = CAST('" + ch.get("id") + "' AS UUID)").get("status"));

        clockAt(end2.plus(Duration.ofHours(1)));
        roll();
        assertEquals("GRACE", subStatus());
        Report g = f.collection.runOnce();
        assertNotNull(g);

        clockAt(end2.plus(Duration.ofDays(7)).plus(Duration.ofHours(1)));
        roll();
        assertEquals("EXPIRED", subStatus());
        assertEquals("VOID", chargeRow("c.id = CAST('" + ch.get("id") + "' AS UUID)").get("status"));
        // reconcile: the open fallback link of the charge ai_service voided is cancelled at Razorpay
        // (platform_payment is in memory here, so the stale-payment query is answered from it).
        PlatformPayment fallback = f.payments.values().stream()
                .filter(p -> p.getVendorOrderId() != null && p.getVendorOrderId().startsWith("plink_"))
                .reduce((a, b) -> b).orElseThrow();
        when(f.queries.staleOpenPaymentIds(org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyInt()))
                .thenReturn(List.of(fallback.getId()));
        clearInvocations(f.gateway);
        f.collection.runOnce();
        verify(f.gateway).cancelPaymentLink(fallback.getVendorOrderId());
        assertEquals(2, paidPeriods());
    }

    // ── (d) upgrade: day-based pro-rata net charge with its own invoice; refund ──

    @Test
    void upgradeIsChargedProRataAndInvoicedSeparatelyAndARefundIsReportedToAiService() throws Exception {
        // a second, dearer published version on another plan
        Map<String, Object> max = postJson("/__test/seed?price_minor=1000000&name=Max");
        String maxVersion = (String) max.get("plan_version_id");
        Map<String, Object> out = f.billing.checkout(inst, pay(false, "e2e-up"), "user-1", "admin@inst.test");
        PlatformPayment first = f.payments.get((String) out.get("platform_payment_id"));
        f.deliver(f.capturedEvent(first.getId(), "pay_up_1_" + t, PRO_TOTAL, null, null));
        assertEquals("ACTIVE", subStatus());

        // half-way through the period
        Instant end = latestPeriodEnd();
        Instant start = Instant.parse((String) one("SELECT to_char(min(p.period_start) AT TIME ZONE 'UTC', "
                + "'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM ai_subscription_period p JOIN institute_ai_subscription s "
                + "ON s.id = p.subscription_id WHERE s.institute_id = '" + inst + "'"));
        clockAt(start.plus(Duration.between(start, end).dividedBy(2)));
        Map<String, Object> quote = f.billing.change(inst, "UPGRADE", maxVersion, RETURN, true, "user-1", null);
        Map<String, Object> change = f.billing.change(inst, "UPGRADE", maxVersion, RETURN, false, "user-1", null);
        assertEquals("LINK", change.get("mode"), change.toString());
        long total = ((Number) change.get("total_minor")).longValue();
        assertTrue(total > 0 && total < 1_180_000L, "pro-rata, below a full Max period: " + total + " " + quote);
        Map<String, Object> up = chargeRow("c.kind = 'UPGRADE'");
        assertEquals(total, ((Number) up.get("total_minor")).longValue());
        assertEquals(((Number) up.get("base_minor")).longValue() + ((Number) up.get("tax_minor")).longValue(), total);

        PlatformPayment upPay = f.payments.get((String) change.get("platform_payment_id"));
        f.deliver(f.capturedEvent(upPay.getId(), "pay_up_2_" + t, total, null, null));
        assertEquals(PlatformPaymentResult.PAID, upPay.getPaymentStatus());
        assertEquals("PAID", chargeRow("c.kind = 'UPGRADE'").get("status"));
        assertEquals(maxVersion, one("SELECT CAST(plan_version_id AS TEXT) FROM institute_ai_subscription "
                + "WHERE institute_id = '" + inst + "'"), "the upgrade switches the version at once");
        verify(f.invoiceService).generateInvoice(upPay.getId());

        // refund webhook on the upgrade payment: credit note + /refunded on the charge.
        String refund = "{\"event\":\"refund.processed\",\"payload\":{\"refund\":{\"entity\":{\"id\":\"rfnd_e2e_" + t + "\","
                + "\"payment_id\":\"pay_up_2_" + t + "\",\"amount\":" + total + ",\"currency\":\"INR\",\"status\":\"processed\"}},"
                + "\"payment\":{\"entity\":{\"id\":\"pay_up_2_" + t + "\",\"amount\":" + total + ",\"amount_refunded\":" + total
                + ",\"currency\":\"INR\",\"status\":\"refunded\",\"notes\":{\"orderId\":\"" + upPay.getId()
                + "\",\"payment_type\":\"AI_SUBSCRIPTION\"}}}}}";
        assertEquals(200, f.deliver(refund).getStatusCode().value());
        verify(f.creditNotes, atLeastOnce()).issueForRefund(eq(upPay.getId()), eq("rfnd_e2e_" + t), eq(total), any(), any());
        Object st = chargeRow("c.kind = 'UPGRADE'").get("status");
        assertEquals("REFUNDED", st, "ai_service told about the refund");
    }
}
