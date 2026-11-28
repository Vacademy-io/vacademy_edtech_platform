package vacademy.io.admin_core_service.features.ai_plans_billing.service;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansInternalClient;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansUpstreamException;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.Customer;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.PaymentLink;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.RecurringDebit;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.RegistrationLink;
import vacademy.io.admin_core_service.features.ai_plans_billing.notify.AiPlansBillingMailer;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionPaymentQueries;
import vacademy.io.admin_core_service.features.ai_plans_billing.webhook.AiSubscriptionPaymentHandler;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.util.ReturnUrlPolicy;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.payments.manager.RazorpayPaymentManager;
import vacademy.io.admin_core_service.features.payments.service.WebHookService;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformBillingProfile;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformBillingProfileRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformCreditNoteRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.BrandModeService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformCreditNoteService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformDocumentMailService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformInvoicePdfService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformInvoiceService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformPaymentConfigService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformRazorpayWebHookService;
import vacademy.io.admin_core_service.features.platform_billing.service.SubscriptionPaymentHandler;
import vacademy.io.common.institute.entity.Institute;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The whole admin_core side of AI-plan billing wired for real (payment service, facade,
 * collection job, webhook handler, and S2's {@link PlatformRazorpayWebHookService}), with:
 * an in-memory ai_service ({@link FakeAiPlans}, mirroring the contract of
 * {@code plans_billing_internal.py}: amount lock, total check, DUPLICATE / ALREADY_PROCESSED,
 * pre-debit 24 h rule), in-memory platform_payment / item / profile / mandate tables, and a
 * mocked Razorpay gateway. No network, no database.
 */
class BillingFixture {

    static final String INST = "inst-1";
    static final String PV_PRO = "11111111-1111-1111-1111-111111111111";
    static final String PV_MAX = "22222222-2222-2222-2222-222222222222";
    static final String PV_STARTER = "33333333-3333-3333-3333-333333333333";
    /** Rs 5,000 + GST = Rs 5,900. */
    static final long PRO_BASE = 500_000L;
    static final long MAX_BASE = 1_000_000L;
    static final long STARTER_BASE = 200_000L;

    Instant now = Instant.parse("2026-11-01T06:30:00Z");
    final Clock clock = new Clock() {
        @Override
        public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    };

    final Map<String, PlatformPayment> payments = new LinkedHashMap<>();
    final Map<String, List<PlatformPaymentItem>> items = new HashMap<>();
    final Map<String, PlatformBillingProfile> profiles = new HashMap<>();
    final Map<String, PlatformInvoice> invoices = new HashMap<>();
    final InMemoryMandates mandates = new InMemoryMandates();
    final FakeAiPlans ai = new FakeAiPlans();
    /** What the services talk to: {@link #ai} unless a real client is given (wire E2E). */
    final AiPlansInternalClient api;
    /** The mandate store the services use: {@link #mandates} unless a JDBC store is given (wire E2E). */
    final AiSubscriptionMandateStore mandateStore;
    final AtomicInteger seq = new AtomicInteger();

    final PlatformRazorpayGateway gateway = mock(PlatformRazorpayGateway.class);
    final AiPlansBillingSettings settings = mock(AiPlansBillingSettings.class);
    final StorefrontAccessService storefront = mock(StorefrontAccessService.class);
    final BrandModeService brand = mock(BrandModeService.class);
    final PlatformPaymentConfigService config = mock(PlatformPaymentConfigService.class);
    final PlatformPaymentRepository paymentRepo = mock(PlatformPaymentRepository.class);
    final PlatformPaymentItemRepository itemRepo = mock(PlatformPaymentItemRepository.class);
    final PlatformBillingProfileRepository profileRepo = mock(PlatformBillingProfileRepository.class);
    final PlatformInvoiceRepository invoiceRepo = mock(PlatformInvoiceRepository.class);
    final PlatformInvoiceService invoiceService = mock(PlatformInvoiceService.class);
    final PlatformCreditNoteService creditNotes = mock(PlatformCreditNoteService.class);
    final PlatformCreditNoteRepository creditNoteRepo = mock(PlatformCreditNoteRepository.class);
    final PlatformDocumentMailService documentMail = mock(PlatformDocumentMailService.class);
    final AiPlansBillingMailer mailer = mock(AiPlansBillingMailer.class);
    final InstituteRepository instituteRepo = mock(InstituteRepository.class);
    final ReturnUrlPolicy returnUrls = mock(ReturnUrlPolicy.class);
    final RazorpayPaymentManager razorpayManager = mock(RazorpayPaymentManager.class);
    final CreditClient creditClient = mock(CreditClient.class);
    final AiSubscriptionPaymentQueries queries = mock(AiSubscriptionPaymentQueries.class);

    final AiSubscriptionPaymentService paymentService;
    final AiSubscriptionPaymentHandler handler;
    final AiSubscriptionBillingService billing;
    final AiSubscriptionCollectionService collection;
    final AiSubscriptionOpsService ops;
    final PlatformRazorpayWebHookService webhook;
    final List<String> refunds = new ArrayList<>();

    BillingFixture() {
        this(null, null);
    }

    /**
     * @param realApi      a real {@link AiPlansInternalClient} (HTTP to a running ai_service), or null
     * @param realMandates a JDBC {@link AiSubscriptionMandateStore} on the same database, or null
     */
    @SuppressWarnings("unchecked")
    BillingFixture(AiPlansInternalClient realApi, AiSubscriptionMandateStore realMandates) {
        api = realApi == null ? ai : realApi;
        mandateStore = realMandates == null ? mandates : realMandates;
        PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
        when(settings.paymentsEnabled()).thenReturn(true);
        when(settings.autopayEnabled()).thenReturn(true);
        when(settings.invoiceSeriesV2Enabled()).thenReturn(true);
        when(storefront.isOpen(anyString())).thenReturn(true);
        // the lifecycle mailer handed the email over (a pre-debit notice is recorded only then)
        when(mailer.send(any())).thenReturn(1);
        when(brand.resolve(anyString())).thenReturn(BrandMode.NEUTRAL);
        PlatformPaymentConfig cfg = new PlatformPaymentConfig();
        cfg.setSupplierLegalName("Vidyayatan Technologies LLP");
        cfg.setSupplierStateCode("23");
        cfg.setSupplierGstin("23AAYFV8247N1Z3");
        cfg.setTradeName("Vacademy");
        cfg.setNeutralDisplayName("Vidyayatan Technologies");
        when(config.load()).thenReturn(cfg);
        when(config.getRazorpayCredsMap()).thenReturn(Map.of("apiKey", "k", "keySecret", "s"));
        when(config.getWebhookSecret()).thenReturn("whsec");
        when(returnUrls.sanitize(anyString(), anyString())).thenAnswer(i -> {
            String u = i.getArgument(1);
            return u.startsWith("https://admin.inst.test/") ? u : null;
        });
        Institute inst = new Institute();
        inst.setId(INST);
        inst.setEmail("admin@inst.test");
        inst.setMobileNumber("9876543210");
        when(instituteRepo.findById(INST)).thenReturn(Optional.of(inst));

        PlatformBillingProfile prof = new PlatformBillingProfile();
        prof.setInstituteId(INST);
        prof.setLegalName("Inst One Pvt Ltd");
        prof.setStateCode("27");
        prof.setBillingEmail("accounts@inst.test");
        profiles.put(INST, prof);
        when(profileRepo.findById(anyString())).thenAnswer(i -> Optional.ofNullable(profiles.get(i.<String>getArgument(0))));
        when(profileRepo.save(any())).thenAnswer(i -> {
            PlatformBillingProfile p = i.getArgument(0);
            profiles.put(p.getInstituteId(), p);
            return p;
        });

        when(paymentRepo.findById(anyString())).thenAnswer(i -> Optional.ofNullable(payments.get(i.<String>getArgument(0))));
        when(paymentRepo.findByIdForUpdate(anyString())).thenAnswer(i -> Optional.ofNullable(payments.get(i.<String>getArgument(0))));
        when(paymentRepo.findByVendorPaymentId(anyString())).thenAnswer(i -> payments.values().stream()
                .filter(p -> i.getArgument(0).equals(p.getVendorPaymentId())).findFirst());
        when(paymentRepo.findByVendorPaymentIdForUpdate(anyString())).thenAnswer(i -> payments.values().stream()
                .filter(p -> i.getArgument(0).equals(p.getVendorPaymentId())).findFirst());
        when(paymentRepo.findByVendorOrderId(anyString())).thenAnswer(i -> payments.values().stream()
                .filter(p -> i.getArgument(0).equals(p.getVendorOrderId())).findFirst());
        when(paymentRepo.save(any())).thenAnswer(i -> storePayment(i.getArgument(0)));
        when(paymentRepo.saveAndFlush(any())).thenAnswer(i -> storePayment(i.getArgument(0)));
        when(itemRepo.save(any())).thenAnswer(i -> {
            PlatformPaymentItem it = i.getArgument(0);
            items.computeIfAbsent(it.getPlatformPaymentId(), k -> new ArrayList<>()).add(it);
            return it;
        });
        when(itemRepo.findByPlatformPaymentId(anyString()))
                .thenAnswer(i -> items.getOrDefault(i.<String>getArgument(0), List.of()));
        when(invoiceRepo.findByPlatformPaymentId(anyString()))
                .thenAnswer(i -> Optional.ofNullable(invoices.get(i.<String>getArgument(0))));
        when(invoiceService.generateInvoice(anyString())).thenAnswer(i -> {
            String ppId = i.getArgument(0);
            return invoices.computeIfAbsent(ppId, k -> {
                PlatformInvoice inv = new PlatformInvoice();
                inv.setId("inv-" + seq.incrementAndGet());
                inv.setPlatformPaymentId(k);
                inv.setInvoiceNumber("VT/2026-27/I" + String.format("%05d", seq.get()));
                inv.setBuyerInstituteId(INST);
                PlatformPayment p = payments.get(k);
                inv.setTotalAmountMinor(p.getTotalAmountMinor());
                inv.setBaseAmountMinor(p.getBaseAmountMinor());
                return inv;
            });
        });

        // Razorpay (platform account), mocked.
        when(gateway.createPaymentLink(any())).thenAnswer(i -> {
            PlatformRazorpayGateway.PaymentLinkRequest r = i.getArgument(0);
            int n = seq.incrementAndGet();
            return new PaymentLink("plink_" + n, "https://rzp.io/l/" + n, "created", r.expireByEpochSeconds(), List.of());
        });
        when(gateway.cancelPaymentLink(anyString())).thenAnswer(i ->
                new PaymentLink(i.getArgument(0), null, "cancelled", null, List.of()));
        when(gateway.cancelRegistrationLink(anyString())).thenAnswer(i ->
                new PaymentLink(i.getArgument(0), null, "cancelled", null, List.of()));
        when(gateway.createRegistrationLink(any())).thenAnswer(i -> {
            int n = seq.incrementAndGet();
            return new RegistrationLink("inv_" + n, "https://rzp.io/i/" + n, "order_reg" + n, "issued");
        });
        when(gateway.createOrGetCustomer(any(), any(), any(), any())).thenReturn("cust_1");
        when(gateway.fetchCustomer(anyString())).thenReturn(new Customer("cust_1", "Inst One", "accounts@inst.test",
                "9876543210"));
        when(gateway.createRecurringDebit(any())).thenAnswer(i -> {
            int n = seq.incrementAndGet();
            return new RecurringDebit("order_debit" + n, "pay_debit" + n);
        });
        when(razorpayManager.fetchPayment(anyString(), any())).thenAnswer(i -> {
            Map<String, Object> rp = new HashMap<>();
            rp.put("id", i.<String>getArgument(0));
            rp.put("amount", 590_000L);
            rp.put("amount_refunded", 0L);
            return rp;
        });
        when(razorpayManager.refundPayment(anyString(), anyLong(), anyString(), any(), any())).thenAnswer(i -> {
            refunds.add(i.getArgument(0) + ":" + i.getArgument(1));
            return Map.of("id", "rfnd_" + refunds.size());
        });

        paymentService = new AiSubscriptionPaymentService(api, gateway, paymentRepo, itemRepo, profileRepo, config,
                new TaxResolver(), brand, mandateStore, instituteRepo, tm);
        paymentService.setClock(clock);
        handler = new AiSubscriptionPaymentHandler(api, paymentService, mandateStore, gateway, invoiceService, creditNotes,
                creditNoteRepo, documentMail, paymentRepo, invoiceRepo, mailer, tm);
        ObjectProvider<SubscriptionPaymentHandler> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(handler);
        webhook = new PlatformRazorpayWebHookService(mock(WebHookService.class), config, paymentRepo, itemRepo,
                invoiceService, mock(PlatformInvoicePdfService.class), creditClient, instituteRepo,
                mock(PaymentNotificatonService.class), razorpayManager, provider, tm);
        billing = new AiSubscriptionBillingService(storefront, settings, api, paymentService, mandateStore, gateway,
                profileRepo, config, brand, new TaxResolver(), returnUrls, invoiceRepo,
                mock(PlatformInvoiceLineItemRepository.class), creditNoteRepo, mock(PlatformInvoicePdfService.class),
                paymentRepo, itemRepo);
        collection = new AiSubscriptionCollectionService(settings, api, paymentService, mandateStore, queries, gateway,
                paymentRepo, itemRepo, webhook, handler, mailer, tm);
        ops = new AiSubscriptionOpsService(api, paymentService, billing, mandateStore, queries, gateway, paymentRepo,
                itemRepo, invoiceRepo, webhook, mailer, tm, creditNotes, documentMail);
    }

    private PlatformPayment storePayment(PlatformPayment p) {
        if (p.getId() == null) {
            p.setId(UUID.randomUUID().toString());
            p.setCreatedAt(java.time.LocalDateTime.ofInstant(now, ZoneOffset.UTC));
        }
        payments.put(p.getId(), p);
        return p;
    }

    void advance(Duration d) {
        now = now.plus(d);
    }

    /** A captured-payment webhook as Razorpay sends it (signed with the fixture's secret). */
    String capturedEvent(String platformPaymentId, String payId, long amount, String tokenId, String orderId) {
        return "{\"event\":\"payment.captured\",\"payload\":{\"payment\":{\"entity\":{\"id\":\"" + payId
                + "\",\"amount\":" + amount + ",\"currency\":\"INR\",\"status\":\"captured\""
                + (orderId == null ? "" : ",\"order_id\":\"" + orderId + "\"")
                + (tokenId == null ? "" : ",\"token_id\":\"" + tokenId + "\",\"customer_id\":\"cust_1\"")
                + ",\"notes\":" + (platformPaymentId == null ? "{}" : "{\"orderId\":\"" + platformPaymentId
                + "\",\"payment_type\":\"AI_SUBSCRIPTION\"}") + "}}}}";
    }

    String failedEvent(String platformPaymentId, String payId) {
        return "{\"event\":\"payment.failed\",\"payload\":{\"payment\":{\"entity\":{\"id\":\"" + payId
                + "\",\"amount\":590000,\"currency\":\"INR\",\"status\":\"failed\",\"error_description\":\"insufficient funds\","
                + "\"notes\":{\"orderId\":\"" + platformPaymentId + "\",\"payment_type\":\"AI_SUBSCRIPTION\"}}}}}";
    }

    String tokenEvent(String event, String tokenId, String status) {
        return "{\"event\":\"" + event + "\",\"payload\":{\"token\":{\"entity\":{\"id\":\"" + tokenId
                + "\",\"method\":\"upi\",\"recurring_details\":{\"status\":\"" + status + "\"}}}}}";
    }

    org.springframework.http.ResponseEntity<String> deliver(String payload) throws Exception {
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec("whsec".getBytes(java.nio.charset.StandardCharsets.UTF_8),
                "HmacSHA256"));
        StringBuilder hex = new StringBuilder();
        for (byte b : mac.doFinal(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8))) {
            hex.append(String.format("%02x", b));
        }
        return webhook.handleWebhook(payload, hex.toString());
    }

    // ═════════════════════════════════════════════════════════════════════

    /** ai_service's internal plans API in memory (same JSON shapes as plans_billing_internal.py). */
    class FakeAiPlans extends AiPlansInternalClient {
        final Map<String, Map<String, Object>> charges = new LinkedHashMap<>();
        final Map<String, Map<String, Object>> subs = new LinkedHashMap<>();
        final List<String> calls = new ArrayList<>();
        final Map<String, Long> prices = new HashMap<>(Map.of(PV_PRO, PRO_BASE, PV_MAX, MAX_BASE, PV_STARTER, STARTER_BASE));
        final Map<String, String> names = Map.of(PV_PRO, "AI Pro", PV_MAX, "AI Max", PV_STARTER, "AI Starter");
        /** Test hook: a PATCH whose fields match fails like an ai_service outage (503). */
        java.util.function.Predicate<Map<String, Object>> failPatch;

        FakeAiPlans() {
            super(new RestTemplate(), "http://ai.fake", "tok");
        }

        Map<String, Object> sub() {
            return subs.values().stream().reduce((a, b) -> b).orElse(null);
        }

        Map<String, Object> newCharge(String sid, String kind, String pv, Instant start, Instant end, long base) {
            Map<String, Object> c = new LinkedHashMap<>();
            String id = UUID.randomUUID().toString();
            c.put("id", id);
            c.put("subscription_id", sid);
            c.put("institute_id", INST);
            c.put("kind", kind);
            c.put("status", "DUE");
            c.put("service_start", start.toString());
            c.put("service_end", end.toString());
            c.put("plan_version_id", pv);
            c.put("currency", "INR");
            c.put("is_tax_inclusive", false);
            c.put("sac_code", "998315");
            c.put("base_minor", base);
            c.put("tax_minor", null);
            c.put("total_minor", null);
            c.put("debit_attempts", 0);
            c.put("plan_name", names.get(pv));
            c.put("grace_days", 7);
            c.put("description", ("UPGRADE".equals(kind) ? "Upgrade to " : "") + names.get(pv) + " subscription");
            charges.put(id, c);
            return c;
        }

        Map<String, Object> view(Map<String, Object> c) {
            Map<String, Object> v = new LinkedHashMap<>(c);
            Map<String, Object> s = subs.get((String) c.get("subscription_id"));
            v.put("subscription_status", s == null ? null : s.get("status"));
            return v;
        }

        /** A live ACTIVE subscription on PRO with a paid current period [start, start + 30 d). */
        Map<String, Object> activeSubscription(Instant periodStart) {
            Map<String, Object> s = new LinkedHashMap<>();
            String sid = UUID.randomUUID().toString();
            s.put("subscription_id", sid);
            s.put("status", "ACTIVE");
            s.put("source", "PAYMENT");
            s.put("plan_version_id", PV_PRO);
            s.put("plan_name", "AI Pro");
            s.put("period_start", periodStart.toString());
            s.put("period_end", periodStart.plus(Duration.ofDays(30)).toString());
            s.put("cancel_at_period_end", false);
            subs.put(sid, s);
            return s;
        }

        @Override
        public Map<String, Object> storefrontCatalog(String instituteId) {
            calls.add("catalog");
            Map<String, Object> out = new LinkedHashMap<>();
            Map<String, Object> cur = sub() == null ? null : new LinkedHashMap<>(sub());
            if (cur != null) {
                charges.values().stream()
                        .filter(c -> cur.get("subscription_id").equals(c.get("subscription_id")))
                        .filter(c -> List.of("DUE", "LINK_SENT", "DEBIT_SCHEDULED", "FAILED").contains(c.get("status")))
                        .findFirst().ifPresent(c -> cur.put("open_charge", view(c)));
            }
            out.put("current", cur);
            List<Map<String, Object>> plans = new ArrayList<>();
            for (String pv : List.of(PV_STARTER, PV_PRO, PV_MAX)) {
                Map<String, Object> card = new LinkedHashMap<>();
                card.put("plan_id", "plan-" + pv.charAt(0));
                card.put("plan_key", names.get(pv).toLowerCase().replace(' ', '_'));
                card.put("name", names.get(pv));
                card.put("version_id", pv);
                card.put("price", Map.of("price_minor", prices.get(pv), "is_tax_inclusive", false,
                        "base_minor", prices.get(pv), "currency", "INR", "period_months", 1));
                card.put("features", List.of(Map.of("feature_key", "ai_tutor", "label", "AI tutor", "mode", "INCLUDED",
                        "internal_cost_cap_usd", 12.5)));
                card.put("internal_cost_cap_usd", 99);
                card.put("action", cur == null ? "SUBSCRIBE" : pv.equals(cur.get("plan_version_id")) ? "CURRENT"
                        : prices.get(pv) > PRO_BASE ? "UPGRADE" : "DOWNGRADE");
                plans.add(card);
            }
            out.put("plans", plans);
            return out;
        }

        @Override
        public Map<String, Object> checkout(String instituteId, String planVersionId, String actor, String key) {
            calls.add("checkout:" + key);
            for (Map<String, Object> s : subs.values()) {
                if (key != null && key.equals(s.get("idem"))) {
                    Map<String, Object> c = charges.get((String) s.get("charge_id"));
                    return Map.of("subscription_id", s.get("subscription_id"), "status", s.get("status"),
                            "charge", view(c), "replayed", true);
                }
                if (List.of("ACTIVE", "GRACE").contains(s.get("status"))) {
                    throw new AiPlansUpstreamException(409, "ALREADY_SUBSCRIBED", "already subscribed", false);
                }
            }
            Map<String, Object> s = new LinkedHashMap<>();
            String sid = UUID.randomUUID().toString();
            s.put("subscription_id", sid);
            s.put("status", "PENDING");
            s.put("source", "PAYMENT");
            s.put("plan_version_id", planVersionId);
            s.put("plan_name", names.get(planVersionId));
            s.put("idem", key);
            subs.put(sid, s);
            Map<String, Object> c = newCharge(sid, "PERIOD", planVersionId, now, now.plus(Duration.ofDays(30)),
                    prices.get(planVersionId));
            s.put("charge_id", c.get("id"));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("subscription_id", sid);
            out.put("status", "PENDING");
            out.put("charge", view(c));
            return out;
        }

        @Override
        public Map<String, Object> quote(String instituteId, String planVersionId, String action) {
            Map<String, Object> q = new LinkedHashMap<>();
            q.put("action", action);
            q.put("base_minor", 250_000L);
            q.put("remaining_days", 15);
            q.put("period_days", 30);
            q.put("credit_minor", 250_000L);
            q.put("internal_cost_cap_usd", 3);
            return q;
        }

        @Override
        public Map<String, Object> changeSubscription(String sid, String action, String pv, String actor) {
            calls.add("change:" + action);
            Map<String, Object> s = subs.get(sid);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("action", action);
            out.put("subscription_id", sid);
            List<Map<String, Object>> voided = new ArrayList<>();
            out.put("voided_charges", voided);
            Instant pEnd = Instant.parse((String) s.get("period_end"));
            switch (action) {
                case "UPGRADE" -> {
                    // 15 of 30 days left: net = (10,000 - 5,000) * 15 / 30 = Rs 2,500.
                    Map<String, Object> c = newCharge(sid, "UPGRADE", pv, now, pEnd, 250_000L);
                    out.put("charge", view(c));
                    out.put("quote", Map.of("base_minor", 250_000L, "remaining_days", 15, "period_days", 30));
                    out.put("applied", false);
                }
                case "DOWNGRADE" -> {
                    for (Map<String, Object> c : charges.values()) {
                        if (sid.equals(c.get("subscription_id")) && "PERIOD".equals(c.get("kind"))
                                && List.of("DUE", "LINK_SENT").contains(c.get("status"))) {
                            c.put("status", "VOID");
                            voided.add(Map.of("charge_id", c.get("id"), "payment_link_id",
                                    String.valueOf(c.get("payment_link_id")), "platform_payment_id",
                                    String.valueOf(c.get("platform_payment_id"))));
                        }
                    }
                    s.put("pending_plan_version_id", pv);
                    Map<String, Object> c = newCharge(sid, "PERIOD", pv, pEnd, pEnd.plus(Duration.ofDays(30)),
                            prices.get(pv));
                    out.put("charge", view(c));
                    out.put("applied", true);
                    out.put("effective_at", pEnd.toString());
                }
                case "CANCEL" -> {
                    for (Map<String, Object> c : charges.values()) {
                        if (sid.equals(c.get("subscription_id"))
                                && List.of("DUE", "LINK_SENT", "DEBIT_SCHEDULED", "FAILED").contains(c.get("status"))) {
                            c.put("status", "VOID");
                            voided.add(Map.of("charge_id", c.get("id"), "payment_link_id",
                                    String.valueOf(c.get("payment_link_id")), "platform_payment_id",
                                    String.valueOf(c.get("platform_payment_id"))));
                        }
                    }
                    s.put("cancel_at_period_end", true);
                    out.put("applied", true);
                    out.put("status", s.get("status"));
                    out.put("effective_at", pEnd.toString());
                }
                default -> out.put("applied", true);
            }
            return out;
        }

        @Override
        public List<Map<String, Object>> chargesNeedingCollection() {
            calls.add("needs_collection");
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> c : charges.values()) {
                Map<String, Object> s = subs.get((String) c.get("subscription_id"));
                if (s == null || !List.of("PENDING", "ACTIVE", "GRACE").contains(s.get("status"))) {
                    continue;
                }
                String st = (String) c.get("status");
                boolean due = "DUE".equals(st) || "FAILED".equals(st)
                        || "LINK_SENT".equals(st) && c.get("link_expires_at") != null
                                && !Instant.parse((String) c.get("link_expires_at")).isAfter(now)
                        || "DEBIT_SCHEDULED".equals(st) && c.get("next_attempt_at") != null
                                && !Instant.parse((String) c.get("next_attempt_at")).isAfter(now);
                if (due) {
                    out.add(view(c));
                }
            }
            return out;
        }

        @Override
        public List<Map<String, Object>> chargesWithLiveLinks() {
            return charges.values().stream().filter(c -> "LINK_SENT".equals(c.get("status"))).map(this::view).toList();
        }

        @Override
        public Map<String, Object> charge(String chargeId, String instituteId) {
            Map<String, Object> c = charges.get(chargeId);
            return c == null ? null : view(c);
        }

        @Override
        public Map<String, Object> patchCharge(String chargeId, Map<String, Object> fields) {
            calls.add("patch:" + fields.keySet());
            if (failPatch != null && failPatch.test(fields)) {
                throw new AiPlansUpstreamException(503, null, "ai_service unavailable", true);
            }
            Map<String, Object> c = charges.get(chargeId);
            String st = (String) c.get("status");
            if (!List.of("DUE", "LINK_SENT", "DEBIT_SCHEDULED", "FAILED").contains(st)) {
                throw new AiPlansUpstreamException(409, "CHARGE_CLOSED", "closed", false);
            }
            String newSt = (String) fields.getOrDefault("status", st);
            if (!List.of("DUE", "LINK_SENT", "DEBIT_SCHEDULED", "FAILED").contains(newSt)) {
                throw new AiPlansUpstreamException(422, "BAD_STATUS", "bad status " + newSt, false);
            }
            boolean amountChanges = false;
            for (String k : List.of("base_minor", "tax_minor", "total_minor")) {
                if (fields.containsKey(k) && !java.util.Objects.equals(num(fields.get(k)), num(c.get(k)))) {
                    amountChanges = true;
                }
            }
            boolean relinked = fields.containsKey("payment_link_id") || fields.containsKey("platform_payment_id");
            if (amountChanges && !List.of("DUE", "FAILED").contains(newSt) && !relinked) {
                throw new AiPlansUpstreamException(409, "AMOUNT_LOCKED", "amount locked", false);
            }
            if ("DEBIT_SCHEDULED".equals(newSt)) {
                Object notice = fields.getOrDefault("pre_debit_notice_sent_at", c.get("pre_debit_notice_sent_at"));
                Object at = fields.getOrDefault("next_attempt_at", c.get("next_attempt_at"));
                if (notice == null || at == null || Instant.parse((String) at)
                        .isBefore(Instant.parse((String) notice).plus(Duration.ofHours(24)))) {
                    throw new AiPlansUpstreamException(422, "PRE_DEBIT_NOTICE", "24 h", false);
                }
            }
            c.putAll(fields);
            return view(c);
        }

        @Override
        public Map<String, Object> chargePaid(String chargeId, String ppId, String vendorPaymentId, long amountMinor) {
            calls.add("paid:" + vendorPaymentId);
            Map<String, Object> c = charges.get(chargeId);
            for (Map<String, Object> o : charges.values()) {
                if (o != c && vendorPaymentId.equals(o.get("vendor_payment_id"))) {
                    throw new AiPlansUpstreamException(409, "VENDOR_PAYMENT_REUSED", "reused", false);
                }
            }
            Map<String, Object> s = subs.get((String) c.get("subscription_id"));
            if ("PAID".equals(c.get("status"))) {
                return Map.of("action", vendorPaymentId.equals(c.get("vendor_payment_id")) ? "ALREADY_PROCESSED"
                        : "DUPLICATE", "institute_id", INST);
            }
            if (c.get("total_minor") == null) {
                throw new AiPlansUpstreamException(409, "TOTAL_NOT_SET", "no total", false);
            }
            if (amountMinor != num(c.get("total_minor"))) {
                throw new AiPlansUpstreamException(409, "AMOUNT_MISMATCH", "paid amount differs", false);
            }
            if ("VOID".equals(c.get("status"))) {
                return Map.of("action", "REFUND_REQUIRED", "institute_id", INST);
            }
            c.put("status", "PAID");
            c.put("vendor_payment_id", vendorPaymentId);
            String action;
            if ("UPGRADE".equals(c.get("kind"))) {
                s.put("plan_version_id", c.get("plan_version_id"));
                action = "UPGRADED";
            } else if ("PENDING".equals(s.get("status"))) {
                s.put("status", "ACTIVE");
                s.put("period_start", now.toString());
                s.put("period_end", now.plus(Duration.ofDays(30)).toString());
                // like ai_service: the first period starts when it is paid
                c.put("service_start", now.toString());
                c.put("service_end", now.plus(Duration.ofDays(30)).toString());
                action = "ACTIVATED";
                return Map.of("action", action, "institute_id", INST, "charge", view(c), "invoice",
                        Map.of("service_start", now.toString(), "service_end", now.plus(Duration.ofDays(30)).toString(),
                                "description", names.get((String) c.get("plan_version_id")) + " subscription, paid period"));
            } else if ("GRACE".equals(s.get("status"))) {
                s.put("status", "ACTIVE");
                action = "GRACE_CLEARED";
            } else {
                action = "RENEWAL_PAID";
            }
            return Map.of("action", action, "institute_id", INST, "charge", view(c));
        }

        @Override
        public Map<String, Object> chargeRefunded(String chargeId, String vpid, long amount, long total, String refundId) {
            calls.add("refunded:" + vpid + ":" + amount + ":" + total);
            return Map.of("action", "REFUNDED");
        }

        @Override
        public Map<String, Object> voidCharge(String chargeId, String reason, String actor) {
            calls.add("void:" + reason);
            Map<String, Object> c = charges.get(chargeId);
            c.put("status", "VOID");
            Map<String, Object> s = subs.get((String) c.get("subscription_id"));
            if ("PENDING".equals(s.get("status"))) {
                s.put("status", "CANCELLED");
            }
            return Map.of("action", "VOIDED");
        }

        @Override
        public Map<String, Object> waiveCharge(String chargeId, String reason, String actor) {
            calls.add("waive:" + reason);
            charges.get(chargeId).put("status", "WAIVED");
            return Map.of("action", "WAIVED");
        }

        Long num(Object o) {
            return o == null ? null : ((Number) o).longValue();
        }
    }

    /** ai_subscription_mandate in memory. */
    static class InMemoryMandates extends AiSubscriptionMandateStore {
        final Map<String, Mandate> rows = new LinkedHashMap<>();

        InMemoryMandates() {
            super(null);
        }

        private void put(Mandate m) {
            rows.put(m.id(), m);
        }

        private static Mandate with(Mandate m, String token, String customer, String status, String reason,
                String linkId, String linkUrl, String orderId, String subscriptionId) {
            return new Mandate(m.id(), m.instituteId(), subscriptionId, customer, token, m.method(), m.maxAmountMinor(),
                    m.frequency(), status, linkId, linkUrl, orderId, m.authPaymentId(), reason, m.createdAt(),
                    Instant.now());
        }

        @Override
        public String insertPending(String iid, String sid, String customerId, String method, long max, String freq,
                String actor) {
            String id = UUID.randomUUID().toString();
            put(new Mandate(id, iid, sid, customerId, null, method, max, freq, PENDING, null, null, null, null, null,
                    Instant.now(), Instant.now()));
            return id;
        }

        @Override
        public void setRegistrationLink(String id, String linkId, String url, String orderId) {
            Mandate m = rows.get(id);
            put(with(m, m.tokenId(), m.razorpayCustomerId(), m.status(), m.failureReason(), linkId, url, orderId,
                    m.subscriptionId()));
        }

        @Override
        public Optional<Mandate> findById(String id) {
            return Optional.ofNullable(id == null ? null : rows.get(id));
        }

        @Override
        public Optional<Mandate> findByIdForUpdate(String id) {
            return findById(id);
        }

        @Override
        public Optional<Mandate> findByTokenId(String tokenId) {
            return rows.values().stream().filter(m -> tokenId != null && tokenId.equals(m.tokenId())).findFirst();
        }

        @Override
        public Optional<Mandate> findActiveForSubscription(String sid) {
            return rows.values().stream().filter(m -> ACTIVE.equals(m.status()) && sid != null
                    && sid.equals(m.subscriptionId())).reduce((a, b) -> b);
        }

        @Override
        public Optional<Mandate> findLatestForInstitute(String iid) {
            return rows.values().stream().filter(m -> iid.equals(m.instituteId())).reduce((a, b) -> b);
        }

        @Override
        public List<Mandate> findForInstitute(String iid) {
            return rows.values().stream().filter(m -> iid.equals(m.instituteId())).toList();
        }

        @Override
        public Optional<String> findCustomerIdForInstitute(String iid) {
            return rows.values().stream().filter(m -> iid.equals(m.instituteId()) && m.razorpayCustomerId() != null)
                    .map(Mandate::razorpayCustomerId).findFirst();
        }

        @Override
        public List<Mandate> findPendingWithToken(int limit) {
            return rows.values().stream().filter(m -> PENDING.equals(m.status()) && m.tokenId() != null).toList();
        }

        @Override
        public int recordToken(String id, String tokenId, String customerId, String authPaymentId) {
            Mandate m = rows.get(id);
            if (m == null || m.tokenId() != null && !m.tokenId().equals(tokenId)) {
                return 0;
            }
            put(with(m, tokenId, m.razorpayCustomerId() == null ? customerId : m.razorpayCustomerId(), m.status(),
                    m.failureReason(), m.registrationLinkId(), m.registrationLinkUrl(), m.authOrderId(),
                    m.subscriptionId()));
            return 1;
        }

        @Override
        public int updateStatus(String id, String status, String reason) {
            return transition(id, status, reason, null);
        }

        @Override
        public boolean isStaleEvent(String id, Instant eventAt) {
            return false;
        }

        @Override
        public int transition(String id, String status, String reason, Instant eventAt) {
            Mandate m = rows.get(id);
            if (m == null || status.equals(m.status()) || !allowedFrom(status).contains(m.status())) {
                return 0;
            }
            put(with(m, m.tokenId(), m.razorpayCustomerId(), status, reason == null ? m.failureReason() : reason,
                    m.registrationLinkId(), m.registrationLinkUrl(), m.authOrderId(), m.subscriptionId()));
            return 1;
        }

        @Override
        public List<Mandate> findLapsedPending(int days, int limit) {
            return List.of();
        }

        @Override
        public List<Mandate> findOtherUsable(String sid, String keepId) {
            return rows.values().stream().filter(m -> sid != null && sid.equals(m.subscriptionId())
                    && (ACTIVE.equals(m.status()) || PAUSED.equals(m.status())) && !m.id().equals(keepId)).toList();
        }

        @Override
        public List<Mandate> findUsableForInstitute(String iid) {
            return rows.values().stream().filter(m -> iid.equals(m.instituteId())
                    && List.of(ACTIVE, PAUSED, PENDING).contains(m.status())).toList();
        }

        @Override
        public void attachSubscription(String id, String sid) {
        }

        /** Test helper: an ACTIVE UPI mandate with a token for a subscription. */
        Mandate active(String sid) {
            String id = UUID.randomUUID().toString();
            Mandate m = new Mandate(id, INST, sid, "cust_1", "token_" + id.substring(0, 6), "UPI", 1_500_000L,
                    "as_presented", ACTIVE, null, null, null, null, null, Instant.now(), Instant.now());
            put(m);
            return m;
        }
    }
}
