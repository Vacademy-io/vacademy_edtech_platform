package vacademy.io.admin_core_service.features.ai_plans_billing.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.ai_plans_billing.AiPlansBillingException;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansInternalClient;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansInternalClient.Json;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.ChargeView;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.RazorpayGatewayException;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore.Mandate;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionPaymentService.LinkOutcome;
import vacademy.io.admin_core_service.features.credits.dto.TaxBreakup;
import vacademy.io.admin_core_service.features.credits.util.ReturnUrlPolicy;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver.BuyerTaxIdentity;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver.SaleKind;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformBillingProfile;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformCreditNote;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoiceLineItem;
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
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformInvoicePdfService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformPaymentConfigService;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * The tenant billing facade for AI plans (behind {@code /admin-core-service/ai-plans/v1}). The
 * controller has already checked {@code requireInstituteAdmin}; every method here re-checks that
 * the storefront is open for the institute (404 STOREFRONT_OFF otherwise) and that every id the
 * caller names belongs to that institute.
 *
 * <p>ai_service decides eligibility, plan actions and subscription state; this class adds money:
 * GST from the institute's billing profile, the payment link or autopay registration, documents.
 * Responses are snake_case maps built from a whitelist: no internal cap, cost or USD field from
 * ai_service is ever passed through.
 */
@Slf4j
@Service
public class AiSubscriptionBillingService {

    public static final String MODE_LINK = "LINK";
    public static final String MODE_MANDATE = "MANDATE";
    public static final String MODE_APPLIED = "APPLIED";
    public static final String MODE_QUOTE = "QUOTE";
    static final Set<String> CHANGE_ACTIONS = Set.of("UPGRADE", "DOWNGRADE", "CANCEL", "RESUME");
    static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    static final Pattern MOBILE = Pattern.compile("^\\+?[0-9]{10,13}$");

    private final StorefrontAccessService storefront;
    private final AiPlansBillingSettings settings;
    private final AiPlansInternalClient client;
    private final AiSubscriptionPaymentService payments;
    private final AiSubscriptionMandateStore mandates;
    private final PlatformRazorpayGateway gateway;
    private final PlatformBillingProfileRepository profileRepository;
    private final PlatformPaymentConfigService configService;
    private final BrandModeService brandModeService;
    private final TaxResolver taxResolver;
    private final ReturnUrlPolicy returnUrlPolicy;
    private final PlatformInvoiceRepository invoiceRepository;
    private final PlatformInvoiceLineItemRepository invoiceLineRepository;
    private final PlatformCreditNoteRepository creditNoteRepository;
    private final PlatformInvoicePdfService pdfService;
    private final PlatformPaymentRepository paymentRepository;
    private final PlatformPaymentItemRepository itemRepository;

    public AiSubscriptionBillingService(
            StorefrontAccessService storefront,
            AiPlansBillingSettings settings,
            AiPlansInternalClient client,
            AiSubscriptionPaymentService payments,
            AiSubscriptionMandateStore mandates,
            PlatformRazorpayGateway gateway,
            PlatformBillingProfileRepository profileRepository,
            PlatformPaymentConfigService configService,
            BrandModeService brandModeService,
            TaxResolver taxResolver,
            ReturnUrlPolicy returnUrlPolicy,
            PlatformInvoiceRepository invoiceRepository,
            PlatformInvoiceLineItemRepository invoiceLineRepository,
            PlatformCreditNoteRepository creditNoteRepository,
            PlatformInvoicePdfService pdfService,
            PlatformPaymentRepository paymentRepository,
            PlatformPaymentItemRepository itemRepository) {
        this.storefront = storefront;
        this.settings = settings;
        this.client = client;
        this.payments = payments;
        this.mandates = mandates;
        this.gateway = gateway;
        this.profileRepository = profileRepository;
        this.configService = configService;
        this.brandModeService = brandModeService;
        this.taxResolver = taxResolver;
        this.returnUrlPolicy = returnUrlPolicy;
        this.invoiceRepository = invoiceRepository;
        this.invoiceLineRepository = invoiceLineRepository;
        this.creditNoteRepository = creditNoteRepository;
        this.pdfService = pdfService;
        this.paymentRepository = paymentRepository;
        this.itemRepository = itemRepository;
    }

    // ═════════════════════════════════════════════════════════════════════
    // Storefront
    // ═════════════════════════════════════════════════════════════════════

    public Map<String, Object> storefront(String instituteId) {
        storefront.requireOpen(instituteId);
        Map<String, Object> catalog = client.storefrontCatalog(instituteId);
        PlatformBillingProfile profile = profileRepository.findById(instituteId).orElse(null);
        BrandMode brand = brandModeService.resolve(instituteId);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("brand_mode", brand.name());
        out.put("payments_enabled", settings.paymentsEnabled());
        out.put("supplier", supplier(instituteId, brand));
        Map<String, Object> autopay = new LinkedHashMap<>();
        autopay.put("enabled", settings.autopayEnabled());
        autopay.put("max_debit_minor", AiSubscriptionPaymentService.AFA_FREE_MAX_MINOR);
        out.put("autopay", autopay);

        List<Map<String, Object>> plans = new ArrayList<>();
        for (Map<String, Object> raw : Json.listOfMaps(catalog, "plans", "catalog", "items")) {
            Map<String, Object> plan = plan(raw, profile);
            if (plan != null) {
                plans.add(plan);
            }
        }
        plans.sort(Comparator.comparingLong(p -> ((Number) p.getOrDefault("sort_order", 100)).longValue()));
        out.put("plans", plans);
        Map<String, Object> current = currentOf(catalog);
        out.put("subscription", subscription(current));
        // The full charge (top-level, as GET /charges lists it) when ai_service sends it, else the summary's.
        Map<String, Object> charge = Json.map(catalog, "open_charge");
        if (charge == null && current != null) {
            charge = Json.map(current, "open_charge");
        }
        out.put("open_charge", openCharge(charge, current == null ? null : Json.str(current, "grace_until")));
        out.put("billing_profile", profile == null ? null : profileView(profile));
        out.put("mandate", mandates.findLatestForInstitute(instituteId).map(this::mandateView).orElse(null));
        return out;
    }

    Map<String, Object> supplier(String instituteId, BrandMode brand) {
        Map<String, Object> s = new LinkedHashMap<>();
        PlatformPaymentConfig cfg;
        try {
            cfg = configService.load();
        } catch (Exception e) {
            return s;
        }
        boolean vacademy = brand == BrandMode.VACADEMY;
        s.put("legal_name", cfg.getSupplierLegalName());
        s.put("gstin", cfg.getSupplierGstin());
        s.put("trade_name", vacademy ? cfg.getTradeName() : null);
        s.put("logo_url", vacademy ? cfg.getBrandLogoUrl() : null);
        s.put("neutral_display_name", cfg.getNeutralDisplayName());
        s.put("display_name", payments.checkoutName(instituteId));
        String support = cfg.getBillingSupportEmail();
        if (!vacademy && support != null && (support.toLowerCase(Locale.ROOT).contains("vacademy")
                || brandModeService.isVacademyOwnedHost(support.substring(support.lastIndexOf('@') + 1)))) {
            support = null;
        }
        s.put("support_email", support);
        return s;
    }

    /** ai_service's current subscription summary ({@code current}; older spellings tolerated). */
    static Map<String, Object> currentOf(Map<String, Object> catalog) {
        return Json.map(catalog, "current", "subscription", "current_subscription");
    }

    /** One plan card from ai_service's catalog, with the price taxed for this buyer. Whitelisted fields only. */
    Map<String, Object> plan(Map<String, Object> raw, PlatformBillingProfile profile) {
        String versionId = Json.str(raw, "plan_version_id", "version_id", "listing_version_id");
        String name = Json.str(raw, "name", "plan_name");
        if (versionId == null || name == null) {
            return null;
        }
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("plan_id", Json.str(raw, "plan_id", "id"));
        p.put("plan_key", Json.str(raw, "plan_key", "key"));
        p.put("plan_version_id", versionId);
        p.put("name", name);
        p.put("tagline", Json.str(raw, "tagline"));
        Object highlights = Json.raw(raw, "highlights");
        p.put("highlights", highlights instanceof List<?> l ? l : List.of());
        p.put("badge", Json.str(raw, "badge"));
        Long sort = Json.lng(raw, "sort_order");
        p.put("sort_order", sort == null ? 100L : sort);
        Map<String, Object> rawPrice = Json.map(raw, "price");
        Map<String, Object> priceSrc = rawPrice != null ? rawPrice : raw;
        Long months = Json.lng(raw, "period_months");
        if (months == null) {
            months = Json.lng(priceSrc, "period_months");
        }
        p.put("period_months", months == null ? 1L : months);
        String currency = Json.str(raw, "currency");
        if (currency == null) {
            currency = Json.str(priceSrc, "currency");
        }
        currency = currency == null ? "INR" : currency;
        p.put("currency", currency);
        // price_minor is the list price: the base for an exclusive price, the total for an
        // inclusive one (GST split out of it, never added on top).
        Long amount = Json.lng(priceSrc, "price_minor", "base_minor", "amount_minor");
        boolean inclusive = Json.bool(priceSrc, "is_tax_inclusive");
        TaxBreakup tax = preview(currency, amount == null ? 0L : amount, inclusive, profile);
        p.put("price", priceView(tax, currency));
        Long allowance = Json.lng(raw, "allowance_credits", "monthly_allowance_credits");
        p.put("allowance_credits", allowance == null ? 0L : allowance);
        List<Map<String, Object>> features = new ArrayList<>();
        for (Map<String, Object> f : Json.listOfMaps(raw, "features", "items")) {
            String key = Json.str(f, "feature_key", "key");
            if (key == null) {
                continue;
            }
            Map<String, Object> fv = new LinkedHashMap<>();
            fv.put("feature_key", key);
            fv.put("label", firstNonNull(Json.str(f, "tenant_label"), Json.str(f, "label"), key));
            fv.put("mode", Json.str(f, "mode"));
            fv.put("display_cap_text", Json.str(f, "display_cap_text"));
            features.add(fv);
        }
        p.put("features", features);
        p.put("is_current", Json.bool(raw, "is_current", "current"));
        p.put("action", Json.str(raw, "action"));
        p.put("effective_at", Json.str(raw, "effective_at"));
        Long grace = Json.lng(raw, "grace_days");
        p.put("grace_days", grace);
        p.put("autopay_eligible", settings.autopayEnabled()
                && AiSubscriptionPaymentService.autopayEligible(tax.getTotalAmountMinor()));
        Map<String, Object> quote = Json.map(raw, "upgrade_quote", "quote");
        if (quote != null) {
            Map<String, Object> q = new LinkedHashMap<>(quote);
            q.putIfAbsent("is_tax_inclusive", inclusive);
            p.put("upgrade_quote", quoteView(q, currency, profile));
        }
        return p;
    }

    /** Tax preview: exact for a buyer with a state; else IGST 18% (the label says "18% GST"). */
    TaxBreakup preview(String currency, long amount, boolean inclusive, PlatformBillingProfile profile) {
        String supplierState = supplierState();
        BuyerTaxIdentity buyer = profile == null ? null
                : new BuyerTaxIdentity(profile.getStateCode(), profile.getGstin(), null);
        try {
            return taxResolver.resolveForBuyer(SaleKind.CREDIT_PACK, buyer, currency, amount, inclusive, supplierState,
                    false);
        } catch (RuntimeException e) {
            return taxResolver.resolveForBuyer(SaleKind.CREDIT_PACK, null, currency, amount, inclusive, supplierState,
                    false);
        }
    }

    private String supplierState() {
        try {
            return configService.load().getSupplierStateCode();
        } catch (Exception e) {
            return null;
        }
    }

    static Map<String, Object> priceView(TaxBreakup t, String currency) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("currency", currency);
        m.put("base_minor", t.getBaseAmountMinor());
        m.put("tax_minor", t.getTaxAmountMinor());
        m.put("total_minor", t.getTotalAmountMinor());
        int bps = t.getCgstRateBps() + t.getSgstRateBps() + t.getIgstRateBps();
        m.put("tax_rate_bps", bps);
        m.put("tax_label", t.isExport() ? "No GST (export)"
                : t.getCgstRateBps() > 0 ? "CGST 9% + SGST 9%" : bps > 0 ? "18% GST" : null);
        return m;
    }

    /**
     * A quote (ai_service /quote, a plan card's upgrade_quote, or a change answer) taxed for this
     * buyer. An inclusive upgrade carries its total ({@code total_minor}); an exclusive one its
     * base. Whitelisted fields only.
     */
    @SuppressWarnings("unchecked")
    Map<String, Object> quoteView(Map<String, Object> q, String currency, PlatformBillingProfile profile) {
        Long base = Json.lng(q, "base_minor", "base_due_minor", "due_base_minor");
        Long inclusiveTotal = Json.bool(q, "is_tax_inclusive") ? Json.lng(q, "total_minor") : null;
        Map<String, Object> m = new LinkedHashMap<>();
        if (inclusiveTotal != null || base != null) {
            TaxBreakup t = inclusiveTotal != null ? preview(currency, inclusiveTotal, true, profile)
                    : preview(currency, base, false, profile);
            m.put("base_minor", t.getBaseAmountMinor());
            m.put("tax_minor", t.getTaxAmountMinor());
            m.put("total_minor", t.getTotalAmountMinor());
        }
        m.put("free", Json.bool(q, "free"));
        m.put("service_start", Json.str(q, "service_start", "from"));
        m.put("service_end", Json.str(q, "service_end", "until", "period_end"));
        m.put("effective_at", Json.str(q, "effective_at"));
        m.put("quote_expires_at", Json.str(q, "quote_expires_at"));
        Object detail = Json.raw(q, "proration", "detail");
        Map<String, Object> d = detail instanceof Map<?, ?> dm ? (Map<String, Object>) dm : q;
        Map<String, Object> dv = new LinkedHashMap<>();
        for (String k : List.of("remaining_days", "period_days", "credit_minor", "new_price_minor",
                "old_price_minor", "new_minor", "allowance_delta", "next_period_price_minor")) {
            if (d.get(k) != null) {
                dv.put(k, d.get(k));
            }
        }
        m.put("proration", dv);
        return m;
    }

    static Map<String, Object> subscription(Map<String, Object> s) {
        if (s == null || Json.str(s, "id", "subscription_id") == null) {
            return null;
        }
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("id", Json.str(s, "id", "subscription_id"));
        for (String k : List.of("plan_id", "plan_version_id", "plan_name", "plan_key", "status", "source",
                "period_start", "period_end", "renews_at", "end_at", "grace_until", "price_override_base_minor")) {
            v.put(k, Json.raw(s, k));
        }
        v.put("cancel_at_period_end", Json.bool(s, "cancel_at_period_end"));
        Map<String, Object> pending = Json.map(s, "pending_plan");
        if (pending != null) {
            Map<String, Object> pv = new LinkedHashMap<>();
            pv.put("name", Json.str(pending, "name", "plan_name"));
            pv.put("effective_at", Json.str(pending, "effective_at"));
            v.put("pending_plan", pv);
        } else {
            v.put("pending_plan", null);
        }
        return v;
    }

    static Map<String, Object> openCharge(Map<String, Object> c, String graceUntil) {
        ChargeView ch = ChargeView.from(c);
        if (ch == null) {
            return null;
        }
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("charge_id", ch.id());
        v.put("kind", ch.kind());
        v.put("status", ch.status());
        v.put("total_minor", ch.totalMinor());
        v.put("currency", ch.currency());
        String dueAt = Json.str(c, "due_at");
        v.put("due_at", dueAt != null ? dueAt : ch.serviceStart() == null ? null : ch.serviceStart().toString());
        boolean live = ch.linkExpiresAt() != null && ch.linkExpiresAt().isAfter(Instant.now());
        v.put("link_url", live ? ch.paymentLinkUrl() : null);
        v.put("link_expires_at", live ? ch.linkExpiresAt().toString() : null);
        v.put("platform_payment_id", ch.platformPaymentId());
        v.put("next_attempt_at", ch.nextAttemptAt() == null ? null : ch.nextAttemptAt().toString());
        v.put("grace_until", graceUntil);
        return v;
    }

    static Map<String, Object> profileView(PlatformBillingProfile p) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("legal_name", p.getLegalName());
        v.put("gstin", p.getGstin());
        v.put("state_code", p.getStateCode());
        v.put("address", p.getAddress());
        v.put("billing_email", p.getBillingEmail());
        return v;
    }

    Map<String, Object> mandateView(Mandate m) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("id", m.id());
        v.put("status", m.status());
        v.put("method", m.method());
        v.put("max_amount_minor", m.maxAmountMinor());
        return v;
    }

    // ═════════════════════════════════════════════════════════════════════
    // Billing profile
    // ═════════════════════════════════════════════════════════════════════

    /** Validates and saves the buyer's GST identity (never writes {@code institutes}). */
    public Map<String, Object> saveBillingProfile(String instituteId, Map<String, Object> body, String actor) {
        storefront.requireOpen(instituteId);
        String legalName = trimTo(Json.str(body, "legal_name", "legalName"), 255);
        String gstinRaw = Json.str(body, "gstin");
        String stateRaw = Json.str(body, "state_code", "stateCode");
        String address = trimTo(Json.str(body, "address"), 2000);
        String email = trimTo(Json.str(body, "billing_email", "email"), 255);
        String gstin = StringUtils.hasText(gstinRaw) ? gstinRaw.trim().toUpperCase(Locale.ROOT) : null;
        String state;
        try {
            state = TaxResolver.resolveBuyerState(gstin, stateRaw);
        } catch (TaxResolver.TaxException e) {
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY, e.getCode(), e.getMessage());
        }
        if (state == null) {
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY,
                    AiPlansBillingException.BUYER_STATE_REQUIRED, "The billing state is required");
        }
        if (email != null && !EMAIL.matcher(email).matches()) {
            throw AiPlansBillingException.invalid("Invalid billing email");
        }
        if (!StringUtils.hasText(legalName)) {
            throw AiPlansBillingException.invalid("The legal name is required");
        }
        if (gstin != null && !StringUtils.hasText(address)) {
            // CGST Rule 46(e): a tax invoice to a GST-registered buyer carries its address.
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY,
                    AiSubscriptionPaymentService.BUYER_ADDRESS_REQUIRED,
                    "The billing address is required with a GSTIN");
        }
        PlatformBillingProfile p = profileRepository.findById(instituteId).orElseGet(() -> {
            PlatformBillingProfile n = new PlatformBillingProfile();
            n.setInstituteId(instituteId);
            return n;
        });
        p.setLegalName(legalName);
        p.setGstin(gstin);
        p.setStateCode(state);
        p.setAddress(address);
        p.setBillingEmail(email);
        p.setUpdatedBy(actor);
        p.setUpdatedAt(Instant.now());
        return profileView(profileRepository.save(p));
    }

    // ═════════════════════════════════════════════════════════════════════
    // Checkout
    // ═════════════════════════════════════════════════════════════════════

    /** Request of POST checkout / change / mandate setup (snake_case or camelCase keys). */
    public record PayRequest(String planVersionId, boolean autopay, String autopayMethod, String contact,
            String returnUrl, String idempotencyKey) {}

    public Map<String, Object> checkout(String instituteId, PayRequest req, String actorUserId, String actorEmail) {
        storefront.requireOpen(instituteId);
        requirePayments();
        if (!StringUtils.hasText(req.planVersionId())) {
            throw AiPlansBillingException.invalid("plan_version_id is required");
        }
        String returnUrl = allowedReturnUrl(instituteId, req.returnUrl());
        requireBuyerState(instituteId);
        String key = StringUtils.hasText(req.idempotencyKey()) ? trimTo(req.idempotencyKey(), 64)
                : UUID.randomUUID().toString();
        Map<String, Object> resp = client.checkout(instituteId, req.planVersionId(), actorUserId, key);
        closeVoidedLinks(resp); // an earlier pending checkout for another plan was superseded
        ChargeView charge = chargeFrom(resp, instituteId);
        if (charge == null) {
            throw new AiPlansBillingException(HttpStatus.BAD_GATEWAY, AiPlansBillingException.UPSTREAM_ERROR,
                    "ai_service returned no charge for the checkout");
        }
        // Idempotent replay of a checkout that already raised its autopay registration.
        if (charge.mandateId() != null && "LINK_SENT".equalsIgnoreCase(charge.status())
                && StringUtils.hasText(charge.paymentLinkUrl()) && charge.linkExpiresAt() != null
                && charge.linkExpiresAt().isAfter(payments.now())) {
            return redirect(MODE_MANDATE, charge.paymentLinkUrl(), charge.platformPaymentId(), charge.totalMinor(),
                    charge.linkExpiresAt());
        }
        Instant expireBy = payments.now().plus(AiSubscriptionPaymentService.FIRST_PURCHASE_TTL);
        if (req.autopay() && settings.autopayEnabled()) {
            String contact = contactOrNull(req.contact(), instituteId);
            if (contact != null) {
                try {
                    LinkOutcome reg = payments.createRegistrationForCharge(charge, methodOrDefault(req.autopayMethod()),
                            returnUrl, expireBy, actorUserId, null, actorEmail, contact);
                    if (!reg.alreadyPaid()) {
                        return redirect(MODE_MANDATE, reg.url(), reg.platformPaymentId(), reg.totalMinor(),
                                reg.expiresAt());
                    }
                    return redirect(MODE_APPLIED, null, reg.platformPaymentId(), reg.totalMinor(), null);
                } catch (AiPlansBillingException e) {
                    if (!AiPlansBillingException.AUTOPAY_UNAVAILABLE.equals(e.getCode())
                            && !(e instanceof RazorpayGatewayException)) {
                        throw e;
                    }
                    log.info("[ai-plans-billing] autopay not possible for {} ({}); payment link instead",
                            instituteId, e.getMessage());
                    // The charge may have been re-read by now; fetch it again before the link.
                    ChargeView fresh = ChargeView.from(client.charge(charge.id(), instituteId));
                    charge = fresh != null ? withInstitute(fresh, instituteId) : charge;
                }
            }
        }
        LinkOutcome link = payments.createLinkForCharge(charge, returnUrl, expireBy, actorUserId, actorEmail, null);
        if (link.alreadyPaid()) {
            return redirect(MODE_APPLIED, null, link.platformPaymentId(), link.totalMinor(), null);
        }
        return redirect(MODE_LINK, link.url(), link.platformPaymentId(), link.totalMinor(), link.expiresAt());
    }

    /** Pay an open charge of this institute now (renewal due, failed debit, expired link). */
    public Map<String, Object> payCharge(String instituteId, String chargeId, String returnUrlRaw, String actorUserId,
            String actorEmail) {
        storefront.requireOpen(instituteId);
        requirePayments();
        String returnUrl = allowedReturnUrl(instituteId, returnUrlRaw);
        ChargeView charge = ownCharge(instituteId, chargeId);
        // Paying by link now would very likely charge twice (the second is refunded, but still).
        payments.requireNoDebitInFlight(charge);
        Instant expireBy = expiryFor(charge);
        LinkOutcome link = payments.createLinkForCharge(charge, returnUrl, expireBy, actorUserId, actorEmail, null);
        if (link.alreadyPaid()) {
            return redirect(MODE_APPLIED, null, link.platformPaymentId(), link.totalMinor(), null);
        }
        return redirect(MODE_LINK, link.url(), link.platformPaymentId(), link.totalMinor(), link.expiresAt());
    }

    /** First purchase: 48 h; upgrade: 2 h; renewal: until the grace end. */
    Instant expiryFor(ChargeView charge) {
        Instant now = payments.now();
        if (charge.isUpgrade()) {
            return now.plus(AiSubscriptionPaymentService.UPGRADE_TTL);
        }
        if (charge.isFirstPurchase()) {
            return now.plus(AiSubscriptionPaymentService.FIRST_PURCHASE_TTL);
        }
        Instant grace = charge.graceEnd();
        return grace != null && grace.isAfter(now) ? grace : now.plus(AiSubscriptionPaymentService.FIRST_PURCHASE_TTL);
    }

    // ═════════════════════════════════════════════════════════════════════
    // Plan changes
    // ═════════════════════════════════════════════════════════════════════

    public Map<String, Object> change(String instituteId, String actionRaw, String planVersionId, String returnUrlRaw,
            boolean dryRun, String actorUserId, String actorEmail) {
        storefront.requireOpen(instituteId);
        String action = actionRaw == null ? "" : actionRaw.trim().toUpperCase(Locale.ROOT);
        if (!CHANGE_ACTIONS.contains(action)) {
            throw AiPlansBillingException.invalid("action must be UPGRADE, DOWNGRADE, CANCEL or RESUME");
        }
        if (("UPGRADE".equals(action) || "DOWNGRADE".equals(action)) && !StringUtils.hasText(planVersionId)) {
            throw AiPlansBillingException.invalid("plan_version_id is required to change plan");
        }
        PlatformBillingProfile profile = profileRepository.findById(instituteId).orElse(null);
        if (dryRun) {
            if (!"UPGRADE".equals(action) && !"DOWNGRADE".equals(action)) {
                throw AiPlansBillingException.invalid("dry_run is for UPGRADE or DOWNGRADE");
            }
            Map<String, Object> q = client.quote(instituteId, planVersionId, action);
            Map<String, Object> out = redirect(MODE_QUOTE, null, null, null, null);
            out.put("quote", quoteView(q, "INR", profile));
            return out;
        }
        if ("UPGRADE".equals(action)) {
            requirePayments();
            requireBuyerState(instituteId);
        }
        String returnUrl = allowedReturnUrl(instituteId, returnUrlRaw);
        String subscriptionId = currentSubscriptionId(instituteId);
        Map<String, Object> resp = client.changeSubscription(subscriptionId, action, planVersionId, actorUserId);
        closeVoidedLinks(resp);
        if ("CANCEL".equals(action) && "CANCELLED".equalsIgnoreCase(Json.str(resp, "status"))) {
            // Ended now (a pending checkout, or a plan in grace): no debit may follow.
            try {
                cancelMandatesOf(instituteId, "plan cancelled");
            } catch (RuntimeException e) {
                log.warn("[ai-plans-billing] could not cancel the autopay of {}: {}", instituteId, e.getMessage());
            }
        }
        if ("UPGRADE".equals(action)) {
            ChargeView charge = chargeFrom(resp, instituteId);
            if (charge == null || Json.bool(resp, "applied") || !charge.isOpen()) {
                return redirect(MODE_APPLIED, null, null, null, null);
            }
            LinkOutcome link = payments.createLinkForCharge(charge, returnUrl,
                    payments.now().plus(AiSubscriptionPaymentService.UPGRADE_TTL), actorUserId, actorEmail, null);
            if (link.alreadyPaid()) {
                return redirect(MODE_APPLIED, null, link.platformPaymentId(), link.totalMinor(), null);
            }
            Map<String, Object> out = redirect(MODE_LINK, link.url(), link.platformPaymentId(), link.totalMinor(),
                    link.expiresAt());
            Map<String, Object> quote = Json.map(resp, "quote");
            if (quote != null) {
                out.put("quote", quoteView(quote, "INR", profile));
            }
            return out;
        }
        return redirect(MODE_APPLIED, null, null, null, null);
    }

    /** ai_service may void the next renewal charge (downgrade re-price, cancel): close its link. */
    void closeVoidedLinks(Map<String, Object> resp) {
        List<Map<String, Object>> voided = new ArrayList<>(Json.listOfMaps(resp, "voided_charges", "voided"));
        voided.addAll(Json.listOfMaps(resp, "superseded"));
        for (Map<String, Object> v : voided) {
            String linkId = Json.str(v, "payment_link_id");
            if (linkId == null || !linkId.startsWith("plink_") && !linkId.startsWith("inv_")) {
                continue;
            }
            try {
                payments.closeLink(linkId, Json.str(v, "platform_payment_id"));
            } catch (Exception e) {
                log.warn("[ai-plans-billing] could not close link {} of a voided charge: {}", linkId, e.getMessage());
            }
        }
    }

    String currentSubscriptionId(String instituteId) {
        Map<String, Object> catalog = client.storefrontCatalog(instituteId);
        Map<String, Object> sub = currentOf(catalog);
        String id = Json.str(sub, "id", "subscription_id");
        if (id == null) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.NO_SUBSCRIPTION,
                    "There is no plan to change");
        }
        return id;
    }

    // ═════════════════════════════════════════════════════════════════════
    // Autopay mandate
    // ═════════════════════════════════════════════════════════════════════

    public Map<String, Object> setupMandate(String instituteId, String method, String contactRaw, String returnUrlRaw,
            String actorUserId, String actorEmail) {
        storefront.requireOpen(instituteId);
        requirePayments();
        if (!settings.autopayEnabled()) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.AUTOPAY_UNAVAILABLE,
                    "Autopay is not available");
        }
        allowedReturnUrl(instituteId, returnUrlRaw);
        String contact = contactOrNull(contactRaw, instituteId);
        if (contact == null) {
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY, AiPlansBillingException.AUTOPAY_UNAVAILABLE,
                    "A mobile number is required for autopay");
        }
        Map<String, Object> catalog = client.storefrontCatalog(instituteId);
        Map<String, Object> sub = currentOf(catalog);
        String subId = Json.str(sub, "id", "subscription_id");
        String status = Json.str(sub, "status");
        if (subId == null || status == null || !Set.of("ACTIVE", "GRACE").contains(status.toUpperCase(Locale.ROOT))) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.NO_SUBSCRIPTION,
                    "Autopay needs an active plan");
        }
        if (mandates.findActiveForSubscription(subId).isPresent()) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.CONFLICT,
                    "Autopay is already set up");
        }
        ChargeView open = ChargeView.from(sub == null ? null : Json.map(sub, "open_charge"));
        // A card registration is a Rs 1 authorisation (Razorpay), so it never pays a charge: cards
        // always register standalone; the open charge keeps its link.
        boolean upi = "UPI".equalsIgnoreCase(methodOrDefault(method).trim());
        if (upi && open != null && open.isOpen() && !open.isUpgrade() && !payments.debitInFlight(open)) {
            open = withInstitute(open, instituteId);
            ChargeView fresh = ChargeView.from(client.charge(open.id(), instituteId));
            open = fresh == null ? open : withInstitute(fresh, instituteId);
            LinkOutcome reg = payments.createRegistrationForCharge(open, methodOrDefault(method), null,
                    expiryFor(open), actorUserId, null, actorEmail, contact);
            if (!reg.alreadyPaid()) {
                return redirect(MODE_MANDATE, reg.url(), reg.platformPaymentId(), reg.totalMinor(), reg.expiresAt());
            }
        }
        LinkOutcome reg = payments.createStandaloneRegistration(instituteId, subId, methodOrDefault(method),
                actorUserId, null, actorEmail, contact);
        return redirect(MODE_MANDATE, reg.url(), reg.platformPaymentId(), reg.totalMinor(), reg.expiresAt());
    }

    /** Cancels the institute's autopay: Razorpay token cancel, and no further debits from now. */
    public Map<String, Object> cancelMandate(String instituteId, String reason) {
        storefront.requireOpen(instituteId);
        int cancelled = cancelMandatesOf(instituteId, reason == null ? "cancelled by institute" : reason);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("cancelled", cancelled);
        return out;
    }

    public int cancelMandatesOf(String instituteId, String reason) {
        int n = 0;
        for (Mandate m : mandates.findUsableForInstitute(instituteId)) {
            cancelMandate(m, reason);
            n++;
        }
        return n;
    }

    public void cancelMandate(Mandate m, String reason) {
        if (StringUtils.hasText(m.tokenId()) && StringUtils.hasText(m.razorpayCustomerId())) {
            // UPI: cancel (token.cancelled follows); cards: delete. See PlatformRazorpayGateway#cancelToken.
            gateway.cancelToken(m.razorpayCustomerId(), m.tokenId(), m.method());
        } else if (AiSubscriptionMandateStore.PENDING.equals(m.status())
                && StringUtils.hasText(m.registrationLinkId())) {
            // No token yet: close the open registration link, so it cannot complete later. If it was
            // completed meanwhile, the token webhook finds the mandate CANCELLED and cancels the token.
            try {
                String rowId = StringUtils.hasText(m.authOrderId())
                        ? paymentRepository.findByVendorOrderId(m.authOrderId()).map(PlatformPayment::getId).orElse(null)
                        : null;
                payments.closeLink(m.registrationLinkId(), rowId);
            } catch (RuntimeException e) {
                log.warn("[ai-plans-billing] could not close registration link {} of mandate {}: {}",
                        m.registrationLinkId(), m.id(), e.getMessage());
            }
        }
        mandates.updateStatus(m.id(), AiSubscriptionMandateStore.CANCELLED, trimTo(reason, 255));
    }

    // ═════════════════════════════════════════════════════════════════════
    // Documents
    // ═════════════════════════════════════════════════════════════════════

    /** Invoices (packs and subscriptions) and credit notes, newest first. Never creates an invoice. */
    public List<Map<String, Object>> documents(String instituteId) {
        storefront.requireOpen(instituteId);
        return listDocuments(instituteId);
    }

    /**
     * The document list without the storefront gate: for the super-admin ops controller only
     * (staff see an institute's invoices whatever the rollout mode).
     */
    public List<Map<String, Object>> listDocuments(String instituteId) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (PlatformInvoice inv : invoiceRepository.findByBuyerInstituteIdOrderByIssuedAtDesc(instituteId)) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("id", inv.getId());
            d.put("doc_type", "INVOICE");
            d.put("doc_kind", "INVOICE");
            d.put("platform_payment_id", inv.getPlatformPaymentId());
            d.put("item_kind", inv.getSourceKind() == null ? "CREDIT_PACK" : inv.getSourceKind().name());
            d.put("number", inv.getInvoiceNumber());
            Instant issued = inv.getIssuedAtTz() != null ? inv.getIssuedAtTz()
                    : inv.getIssuedAt() == null ? null : inv.getIssuedAt().toInstant(java.time.ZoneOffset.UTC);
            d.put("issued_at", issued == null ? null : issued.toString());
            List<PlatformInvoiceLineItem> lines = invoiceLineRepository.findByPlatformInvoiceId(inv.getId());
            d.put("description", lines.isEmpty() ? null : lines.get(0).getDescription());
            d.put("service_start", inv.getServicePeriodStart() == null ? null : inv.getServicePeriodStart().toString());
            d.put("service_end", inv.getServicePeriodEnd() == null ? null : inv.getServicePeriodEnd().toString());
            d.put("total_minor", inv.getTotalAmountMinor());
            d.put("tax_minor", nz(inv.getCgstAmountMinor()) + nz(inv.getSgstAmountMinor()) + nz(inv.getIgstAmountMinor()));
            d.put("currency", inv.getCurrency());
            d.put("status", paymentRepository.findById(inv.getPlatformPaymentId())
                    .map(p -> p.getPaymentStatus() == null ? null : p.getPaymentStatus().name()).orElse(null));
            d.put("_sort", issued == null ? Instant.EPOCH : issued);
            out.add(d);
        }
        for (PlatformCreditNote cn : creditNoteRepository.findByBuyerInstituteIdOrderByIssuedAtDesc(instituteId)) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("id", cn.getId());
            d.put("doc_type", "CREDIT_NOTE");
            d.put("doc_kind", "CREDIT_NOTE");
            d.put("invoice_id", cn.getInvoiceId());
            d.put("invoice_number", cn.getInvoiceNumber());
            d.put("item_kind", cn.getItemKind() == null ? "CREDIT_PACK" : cn.getItemKind().name());
            d.put("number", cn.getCreditNoteNumber());
            d.put("issued_at", cn.getIssuedAt() == null ? null : cn.getIssuedAt().toString());
            d.put("description", cn.getDescription());
            d.put("against_invoice_number", cn.getInvoiceNumber());
            d.put("total_minor", cn.getTotalAmountMinor());
            d.put("tax_minor", nz(cn.getCgstAmountMinor()) + nz(cn.getSgstAmountMinor()) + nz(cn.getIgstAmountMinor()));
            d.put("currency", cn.getCurrency());
            d.put("status", "ISSUED");
            d.put("_sort", cn.getIssuedAt() == null ? Instant.EPOCH : cn.getIssuedAt());
            out.add(d);
        }
        out.sort((a, b) -> ((Instant) b.get("_sort")).compareTo((Instant) a.get("_sort")));
        out.forEach(d -> d.remove("_sort"));
        return out;
    }

    public PlatformInvoice ownInvoice(String instituteId, String invoiceId) {
        storefront.requireOpen(instituteId);
        return invoiceOf(instituteId, invoiceId);
    }

    /** The institute's invoice without the storefront gate (super-admin ops only). */
    public PlatformInvoice invoiceOf(String instituteId, String invoiceId) {
        PlatformInvoice inv = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> AiPlansBillingException.notFound("Invoice"));
        if (!instituteId.equals(inv.getBuyerInstituteId())) {
            throw AiPlansBillingException.notFound("Invoice");
        }
        return inv;
    }

    public byte[] invoicePdf(PlatformInvoice inv) {
        return pdfService.renderPdf(inv);
    }

    public String invoiceFileName(PlatformInvoice inv) {
        return pdfService.fileName(inv);
    }

    public PlatformCreditNote ownCreditNote(String instituteId, String creditNoteId) {
        storefront.requireOpen(instituteId);
        return creditNoteOf(instituteId, creditNoteId);
    }

    /** The institute's credit note without the storefront gate (super-admin ops only). */
    public PlatformCreditNote creditNoteOf(String instituteId, String creditNoteId) {
        PlatformCreditNote cn = creditNoteRepository.findById(creditNoteId)
                .orElseThrow(() -> AiPlansBillingException.notFound("Credit note"));
        if (!instituteId.equals(cn.getBuyerInstituteId())) {
            throw AiPlansBillingException.notFound("Credit note");
        }
        return cn;
    }

    public byte[] creditNotePdf(PlatformCreditNote cn) {
        return pdfService.renderCreditNotePdf(cn);
    }

    public String creditNoteFileName(PlatformCreditNote cn) {
        return pdfService.fileName(cn);
    }

    /** Polled by the admin UI after the Razorpay redirect. */
    public Map<String, Object> orderStatus(String instituteId, String platformPaymentId) {
        storefront.requireOpen(instituteId);
        PlatformPayment p = paymentRepository.findById(platformPaymentId)
                .orElseThrow(() -> AiPlansBillingException.notFound("Payment"));
        if (!instituteId.equals(p.getInstituteId())) {
            throw AiPlansBillingException.notFound("Payment");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("platform_payment_id", p.getId());
        out.put("status", p.getStatus() == null ? null : p.getStatus().name());
        out.put("payment_status", p.getPaymentStatus() == null ? null : p.getPaymentStatus().name());
        List<PlatformPaymentItem> items = itemRepository.findByPlatformPaymentId(p.getId());
        out.put("item_kind", items.isEmpty() || items.get(0).getItemKind() == null ? null
                : items.get(0).getItemKind().name());
        out.put("description", items.isEmpty() ? null : items.get(0).getDescriptionSnapshot());
        Optional<PlatformInvoice> inv = invoiceRepository.findByPlatformPaymentId(p.getId());
        out.put("invoice_id", inv.map(PlatformInvoice::getId).orElse(null));
        out.put("invoice_number", inv.map(PlatformInvoice::getInvoiceNumber).orElse(null));
        return out;
    }

    // ═════════════════════════════════════════════════════════════════════
    // helpers
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Money moves only with {@code billing.subscriptions.payments.enabled}, and subscriptions are
     * invoiced only on the v2 series ({@code billing.invoice.series_v2.enabled}, owner default).
     */
    void requirePayments() {
        if (!settings.paymentsEnabled()) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.PAYMENTS_DISABLED,
                    "Plan payments are not available yet");
        }
        if (!settings.invoiceSeriesV2Enabled()) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.INVOICE_SERIES_V2_REQUIRED,
                    "Plan payments need the new invoice series to be switched on first");
        }
    }

    void requireBuyerState(String instituteId) {
        PlatformBillingProfile p = profileRepository.findById(instituteId).orElse(null);
        if (p == null || !StringUtils.hasText(p.getStateCode()) && !StringUtils.hasText(p.getGstin())) {
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY,
                    AiPlansBillingException.BUYER_STATE_REQUIRED, "Add the billing state before paying for a plan");
        }
    }

    /** Null when none was given; 422 RETURN_URL_NOT_ALLOWED when given but not on an allowed host. */
    String allowedReturnUrl(String instituteId, String returnUrl) {
        if (!StringUtils.hasText(returnUrl)) {
            return null;
        }
        String ok = returnUrlPolicy.sanitize(instituteId, returnUrl.trim());
        if (ok == null) {
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY,
                    AiPlansBillingException.RETURN_URL_NOT_ALLOWED, "The return URL is not allowed");
        }
        return ok;
    }

    ChargeView ownCharge(String instituteId, String chargeId) {
        ChargeView c = ChargeView.from(client.charge(chargeId, instituteId));
        if (c == null || c.instituteId() != null && !instituteId.equals(c.instituteId())) {
            throw AiPlansBillingException.notFound("Charge");
        }
        return withInstitute(c, instituteId);
    }

    /** The charge in a checkout / change answer ({@code charge} object, or the answer itself). */
    static ChargeView chargeFrom(Map<String, Object> resp, String instituteId) {
        if (resp == null) {
            return null;
        }
        Map<String, Object> m = Json.map(resp, "charge");
        Map<String, Object> src = new LinkedHashMap<>(m != null ? m : resp);
        if (m != null) {
            // context from the envelope
            for (String k : List.of("subscription_id", "plan_name", "plan_key", "subscription_status", "grace_days")) {
                if (src.get(k) == null && resp.get(k) != null) {
                    src.put(k, resp.get(k));
                }
            }
            // A checkout answers {status: <subscription status>, charge: {...}}.
            if (src.get("subscription_status") == null && resp.get("status") != null) {
                src.put("subscription_status", resp.get("status"));
            }
            Map<String, Object> sub = Json.map(resp, "subscription");
            if (sub != null) {
                src.putIfAbsent("subscription", sub);
            }
        }
        src.putIfAbsent("institute_id", instituteId);
        if (src.get("institute_id") == null) {
            src.put("institute_id", instituteId);
        }
        return ChargeView.from(src);
    }

    static ChargeView withInstitute(ChargeView c, String instituteId) {
        if (c.instituteId() != null) {
            return c;
        }
        return new ChargeView(c.id(), c.subscriptionId(), instituteId, c.kind(), c.status(), c.serviceStart(),
                c.serviceEnd(), c.planVersionId(), c.currency(), c.taxInclusive(), c.sacCode(), c.description(),
                c.baseMinor(), c.taxMinor(), c.totalMinor(), c.listPriceMinor(), c.platformPaymentId(),
                c.vendorPaymentId(), c.paymentLinkId(), c.paymentLinkUrl(), c.linkExpiresAt(), c.mandateId(),
                c.debitAttempts(), c.nextAttemptAt(), c.preDebitNoticeSentAt(), c.subscriptionStatus(), c.planKey(),
                c.planName(), c.graceUntil(), c.graceDays());
    }

    String contactOrNull(String contactRaw, String instituteId) {
        String c = contactRaw == null ? null : contactRaw.replaceAll("[\\s-]", "");
        if (StringUtils.hasText(c)) {
            if (!MOBILE.matcher(c).matches()) {
                throw AiPlansBillingException.invalid("Invalid mobile number");
            }
            return c;
        }
        String fallback = payments.instituteContact(instituteId);
        if (fallback == null) {
            return null;
        }
        String f = fallback.replaceAll("[\\s-]", "");
        return MOBILE.matcher(f).matches() ? f : null;
    }

    static String methodOrDefault(String m) {
        return StringUtils.hasText(m) ? m : "UPI";
    }

    static Map<String, Object> redirect(String mode, String url, String ppId, Long totalMinor, Instant expiresAt) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("mode", mode);
        m.put("url", url);
        m.put("platform_payment_id", ppId);
        m.put("total_minor", totalMinor);
        m.put("link_expires_at", expiresAt == null ? null : expiresAt.toString());
        return m;
    }

    static String trimTo(String s, int max) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        if (t.isEmpty()) {
            return null;
        }
        return t.length() > max ? t.substring(0, max) : t;
    }

    @SafeVarargs
    static <T> T firstNonNull(T... v) {
        for (T t : v) {
            if (t != null) {
                return t;
            }
        }
        return null;
    }

    private static long nz(Long v) {
        return v == null ? 0L : v;
    }
}
