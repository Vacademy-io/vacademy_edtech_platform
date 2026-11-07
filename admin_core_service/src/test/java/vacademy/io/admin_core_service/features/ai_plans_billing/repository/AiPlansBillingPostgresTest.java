package vacademy.io.admin_core_service.features.ai_plans_billing.repository;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore.Mandate;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiPlansBillingSettings;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.StorefrontAccessService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformBillingFlags;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The plain-JDBC SQL of AI-plan billing (mandate store, payment lookups, storefront access) on a
 * real Postgres 16 with the prod platform_* DDL plus V586-V590 applied, so every string-built
 * statement, CAST, make_interval, JSONB read and partial unique index is exercised for real.
 *
 * <p>Skipped unless {@code AI_PLANS_BILLING_PG_URL} (a JDBC URL) points at a scratch database
 * built that way. It writes rows and may create {@code institute_suborg}; never point it at a
 * real database.
 */
class AiPlansBillingPostgresTest {

    static JdbcTemplate jdbc;
    String inst;
    String sub;

    @BeforeAll
    static void boot() {
        String url = System.getenv("AI_PLANS_BILLING_PG_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "AI_PLANS_BILLING_PG_URL not set");
        DriverManagerDataSource ds = new DriverManagerDataSource(url);
        ds.setDriverClassName("org.postgresql.Driver");
        jdbc = new JdbcTemplate(ds);
        // prodbase lacks this V106 table; same DDL.
        jdbc.execute("CREATE TABLE IF NOT EXISTS institute_suborg (id VARCHAR(255) PRIMARY KEY, institute_id VARCHAR(255), "
                + "suborg_id VARCHAR(255), name VARCHAR(255), description VARCHAR(255), status VARCHAR(255), "
                + "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
    }

    @BeforeEach
    void seed() {
        inst = "pgt-" + UUID.randomUUID().toString().substring(0, 8);
        String plan = UUID.randomUUID().toString();
        String version = UUID.randomUUID().toString();
        sub = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO ai_plan (id, plan_key, name) VALUES (CAST(? AS UUID), ?, 'PG test plan')", plan,
                "pgt_" + plan.substring(0, 8));
        jdbc.update("INSERT INTO ai_plan_version (id, plan_id, version_no) VALUES (CAST(? AS UUID), CAST(? AS UUID), 1)",
                version, plan);
        jdbc.update("INSERT INTO institute_ai_subscription (id, institute_id, plan_version_id, status, enforcement, source, "
                + "anchor_at, start_at, created_by) VALUES (CAST(? AS UUID), ?, CAST(? AS UUID), 'PENDING', 'LIVE', 'PAYMENT', "
                + "now(), now(), 'pg-test')", sub, inst, version);
    }

    // ── ai_subscription_mandate ─────────────────────────────────────────

    @Test
    void mandateLifecycleOnTheRealTable() {
        AiSubscriptionMandateStore store = new AiSubscriptionMandateStore(jdbc);
        String id = store.insertPending(inst, sub, "cust_pg", "UPI", 1_500_000L, "as_presented", "u1");
        store.setRegistrationLink(id, "inv_pg1", "https://rzp.io/i/pg1", "order_pg1");
        Mandate m = store.findById(id).orElseThrow();
        assertEquals("PENDING", m.status());
        assertEquals(sub, m.subscriptionId());
        assertEquals("order_pg1", m.authOrderId());
        assertEquals(1_500_000L, m.maxAmountMinor());
        assertEquals("cust_pg", store.findCustomerIdForInstitute(inst).orElseThrow());

        assertEquals(1, store.recordToken(id, "token_" + inst, "cust_other", "pay_auth"));
        assertEquals(0, store.recordToken(id, "token_different", null, null), "never overwrites a token");
        m = store.findByTokenId("token_" + inst).orElseThrow();
        assertEquals("cust_pg", m.razorpayCustomerId(), "customer kept");
        assertTrue(store.findPendingWithToken(500).stream().anyMatch(x -> x.id().equals(id)));

        assertEquals(1, store.updateStatus(id, "ACTIVE", null));
        assertEquals(0, store.updateStatus(id, "ACTIVE", null), "no-op when already there");
        assertEquals(id, store.findActiveForSubscription(sub).orElseThrow().id());
        assertEquals(1, store.findUsableForInstitute(inst).size());
        assertEquals(id, store.findLatestForInstitute(inst).orElseThrow().id());

        // ux_asm_usable: one ACTIVE / PAUSED mandate per subscription.
        String second = store.insertPending(inst, sub, "cust_pg", "CARD", 1_500_000L, "as_presented", "u1");
        assertEquals(List.of(id), store.findOtherUsable(sub, second).stream().map(Mandate::id).toList());
        assertThrows(DataIntegrityViolationException.class, () -> store.updateStatus(second, "ACTIVE", null));

        assertEquals(1, store.updateStatus(id, "CANCELLED", "cancelled by institute"));
        assertNotNull(jdbc.queryForObject("SELECT cancelled_at FROM ai_subscription_mandate WHERE id = CAST(? AS UUID)",
                java.sql.Timestamp.class, id));
        assertEquals("cancelled by institute", store.findById(id).orElseThrow().failureReason());

        jdbc.update("UPDATE ai_subscription_mandate SET created_at = now() - interval '5 days' WHERE id = CAST(? AS UUID)",
                second);
        assertTrue(store.findLapsedPending(3, 500).stream().anyMatch(x -> x.id().equals(second)));
        store.attachSubscription(second, sub); // already attached: no change, no error
    }

    @Test
    void mandateTransitionsAreForwardOnlyAndOlderEventsAreDropped() {
        AiSubscriptionMandateStore store = new AiSubscriptionMandateStore(jdbc);
        String id = store.insertPending(inst, sub, "cust_pg", "UPI", 1_500_000L, "as_presented", "u1");
        java.time.Instant t0 = java.time.Instant.parse("2026-10-16T10:00:00Z");
        assertEquals(0, store.transition(id, "PAUSED", null, t0), "PENDING never goes PAUSED");
        assertEquals(1, store.transition(id, "ACTIVE", null, t0));
        assertEquals(1, store.transition(id, "PAUSED", null, t0.plusSeconds(60)), "customer paused");
        // Razorpay retries the older token.confirmed: dropped, the mandate stays PAUSED
        assertTrue(store.isStaleEvent(id, t0.plusSeconds(30)));
        assertEquals(0, store.transition(id, "ACTIVE", null, t0.plusSeconds(30)));
        assertEquals("PAUSED", store.findById(id).orElseThrow().status());
        assertEquals(1, store.transition(id, "ACTIVE", null, t0.plusSeconds(120)), "a newer resume applies");
        assertEquals(1, store.updateStatus(id, "CANCELLED", "cancelled by institute"));
        // terminal: nothing brings it back, with or without an event time
        assertEquals(0, store.transition(id, "ACTIVE", null, t0.plusSeconds(600)));
        assertEquals(0, store.updateStatus(id, "ACTIVE", null));
        assertEquals(0, store.updateStatus(id, "PAUSED", null));
        assertEquals(0, store.updateStatus(id, "EXPIRED", null));
        assertEquals("CANCELLED", store.findById(id).orElseThrow().status());
        assertNotNull(jdbc.queryForObject("SELECT last_event_at FROM ai_subscription_mandate WHERE id = CAST(? AS UUID)",
                java.sql.Timestamp.class, id));
        String rejected = store.insertPending(inst, sub, "cust_pg", "CARD", 1_500_000L, "as_presented", "u1");
        assertEquals(1, store.updateStatus(rejected, "REJECTED", "declined"));
        assertEquals(0, store.updateStatus(rejected, "ACTIVE", null));
        assertEquals(0, store.updateStatus(rejected, "CANCELLED", null));
    }

    // ── platform_payment lookups ────────────────────────────────────────

    private String payment(String status, String result, String vendorOrderId, String createdAgo, String disposition,
            String data) {
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO platform_payment (id, institute_id, vendor, vendor_order_id, currency, base_amount_minor, "
                + "tax_amount_minor, total_amount_minor, status, payment_status, disposition, payment_specific_data, "
                + "created_at, updated_at, link_expires_at) VALUES (?, ?, 'RAZORPAY', ?, 'INR', 500000, 90000, 590000, ?, ?, ?, CAST(? AS JSONB), "
                + "now() - CAST(? AS INTERVAL), now() - CAST(? AS INTERVAL), now() + interval '1 day')",
                id, inst, vendorOrderId, status, result, disposition, data, createdAgo, createdAgo);
        jdbc.update("INSERT INTO platform_payment_item (id, platform_payment_id, pack_id, pack_code_snapshot, credits, currency, "
                + "base_amount_minor, tax_rate_bps, tax_amount_minor, total_amount_minor, hsn_sac_snapshot, item_kind, "
                + "subscription_charge_id, description_snapshot) VALUES (?, ?, NULL, 'AI_SUB:pro', 0, 'INR', 500000, 1800, "
                + "90000, 590000, '998315', 'AI_SUBSCRIPTION', ?, 'AI Pro subscription')",
                UUID.randomUUID().toString(), id, "charge-" + inst);
        return id;
    }

    @Test
    void paymentLookupsOnTheRealTables() {
        AiSubscriptionPaymentQueries q = new AiSubscriptionPaymentQueries(jdbc);
        String open = payment("INITIATED", "PAYMENT_PENDING", "plink_" + inst, "2 hours", "NORMAL", null);
        String fresh = payment("INITIATED", "PAYMENT_PENDING", "plink_f" + inst, "5 minutes", "NORMAL", null);
        String paid = payment("SUCCESS", "PAID", "plink_p" + inst, "1 hour", "NORMAL", null);
        String dup = payment("SUCCESS", "PAID", "plink_d" + inst, "1 hour", "DUPLICATE", null);
        String refunded = payment("SUCCESS", "PARTIALLY_REFUNDED", "plink_r" + inst, "1 hour", "NORMAL",
                "{\"refundSyncPending\":\"rfnd_1\"}");

        List<String> forCharge = q.paymentIdsForCharge("charge-" + inst);
        assertEquals(5, forCharge.size());
        List<String> stale = q.staleOpenPaymentIds(30, 2000);
        assertTrue(stale.contains(open));
        assertFalse(stale.contains(fresh), "younger than 30 min");
        assertFalse(stale.contains(paid));
        List<String> noInvoice = q.paidWithoutInvoice(15, 2000);
        assertTrue(noInvoice.contains(paid));
        assertFalse(noInvoice.contains(dup), "never invoice a DUPLICATE");
        assertTrue(noInvoice.contains(refunded), "a payment refunded before its invoice is still invoiced");
        // the grace counts from paid_at (updated_at is never written): a link made days ago and paid
        // a minute ago is left to the webhook thread that is invoicing it
        String justPaid = payment("SUCCESS", "PAID", "plink_j" + inst, "6 days", "NORMAL", null);
        jdbc.update("UPDATE platform_payment SET paid_at = now() - interval '1 minute' WHERE id = ?", justPaid);
        assertFalse(q.paidWithoutInvoice(15, 2000).contains(justPaid));
        jdbc.update("UPDATE platform_payment SET paid_at = now() - interval '20 minutes' WHERE id = ?", justPaid);
        assertTrue(q.paidWithoutInvoice(15, 2000).contains(justPaid));
        assertEquals(6, q.paymentIdsForInstitute(inst, 50).size());
        assertTrue(q.refundSyncPending(2000).contains(refunded));
        assertFalse(q.refundSyncPending(2000).contains(paid));
    }

    @Test
    void vendorPaymentIdIsUniqueOnPlatformPayment() {
        String a = payment("SUCCESS", "PAID", "plink_u1" + inst, "1 hour", "NORMAL", null);
        String b = payment("SUCCESS", "PAID", "plink_u2" + inst, "1 hour", "NORMAL", null);
        jdbc.update("UPDATE platform_payment SET vendor_payment_id = ? WHERE id = ?", "pay_" + inst, a);
        assertThrows(DataIntegrityViolationException.class,
                () -> jdbc.update("UPDATE platform_payment SET vendor_payment_id = ? WHERE id = ?", "pay_" + inst, b));
    }

    // ── storefront access ───────────────────────────────────────────────

    private StorefrontAccessService access(String mode) {
        jdbc.update("DELETE FROM ai_platform_settings WHERE setting_key = 'billing.storefront.mode'");
        if (mode != null) {
            jdbc.update("INSERT INTO ai_platform_settings (setting_key, setting_value, updated_by) VALUES "
                    + "('billing.storefront.mode', CAST(? AS JSONB), 'pg-test')", "\"" + mode + "\"");
        }
        AiPlansBillingSettings settings = new AiPlansBillingSettings(new PlatformBillingFlags(jdbc), jdbc);
        return new StorefrontAccessService(settings, jdbc);
    }

    @Test
    void storefrontRulesOnTheRealTables() {
        assertFalse(access(null).isOpen(inst), "absent = OFF");
        assertFalse(access("OFF").isOpen(inst));
        assertFalse(access("ALLOWLIST").isOpen(inst), "not allow-listed");
        assertTrue(access("ALL").isOpen(inst));

        jdbc.update("INSERT INTO ai_storefront_audience (rule, institute_id, created_by) VALUES ('INCLUDE', ?, 't')", inst);
        assertTrue(access("ALLOWLIST").isOpen(inst));

        jdbc.update("INSERT INTO ai_storefront_institute (institute_id, storefront_enabled) VALUES (?, FALSE)", inst);
        assertFalse(access("ALL").isOpen(inst), "an explicit off always wins");
        jdbc.update("UPDATE ai_storefront_institute SET storefront_enabled = NULL WHERE institute_id = ?", inst);

        String seg = "seg_" + inst;
        String other = "pgo-" + UUID.randomUUID().toString().substring(0, 8);
        jdbc.update("INSERT INTO ai_institute_segment (institute_id, segment_key, created_by) VALUES (?, ?, 't')", other, seg);
        jdbc.update("INSERT INTO ai_storefront_audience (rule, segment_key, created_by) VALUES ('INCLUDE', ?, 't')", seg);
        assertFalse(access("ALLOWLIST").isOpen(other), "segments count only in SEGMENTS mode");
        assertTrue(access("SEGMENTS").isOpen(other));

        jdbc.update("INSERT INTO ai_storefront_audience (rule, institute_id, created_by) VALUES ('EXCLUDE', ?, 't')", other);
        assertFalse(access("ALL").isOpen(other), "EXCLUDE wins");

        jdbc.update("INSERT INTO institute_suborg (id, institute_id, suborg_id, status) VALUES (?, 'parent', ?, 'ACTIVE')",
                UUID.randomUUID().toString(), inst);
        assertFalse(access("ALL").isOpen(inst), "a sub-org child never buys (the parent does)");
        jdbc.update("DELETE FROM ai_platform_settings WHERE setting_key = 'billing.storefront.mode'");
    }
}
