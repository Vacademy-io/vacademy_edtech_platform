package vacademy.io.admin_core_service.features.ai_plans_billing.gateway;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformPaymentConfigService;

import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * {@link PlatformRazorpayGateway} over Razorpay's REST API (basic auth with the platform key from
 * {@code platform_payment_config}). Plain HTTP instead of the Java SDK so every endpoint we need
 * (registration links, token cancel) is reachable with one code path and testable with
 * {@code MockRestServiceServer}. No call is made unless a billing flag is on.
 */
@Slf4j
@Component
public class RazorpayHttpPlatformGateway implements PlatformRazorpayGateway {

    private final RestTemplate restTemplate;
    private final String apiBase;
    private final Supplier<String[]> credentials;
    private final ObjectMapper mapper = new ObjectMapper();

    @Autowired
    public RazorpayHttpPlatformGateway(
            PlatformPaymentConfigService configService,
            @Value("${razorpay.platform.api-base:https://api.razorpay.com/v1}") String apiBase) {
        this(defaultRestTemplate(), apiBase, () -> {
            Map<String, Object> creds = configService.getRazorpayCredsMap();
            return new String[] { (String) creds.get("apiKey"), (String) creds.get("keySecret") };
        });
    }

    /** Tests. */
    public RazorpayHttpPlatformGateway(RestTemplate restTemplate, String apiBase, Supplier<String[]> credentials) {
        this.restTemplate = restTemplate;
        this.apiBase = apiBase.endsWith("/") ? apiBase.substring(0, apiBase.length() - 1) : apiBase;
        this.credentials = credentials;
    }

    private static RestTemplate defaultRestTemplate() {
        HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        JdkClientHttpRequestFactory f = new JdkClientHttpRequestFactory(http);
        f.setReadTimeout(Duration.ofSeconds(30));
        return new RestTemplate(f);
    }

    // ── Payment Links ────────────────────────────────────────────────────

    @Override
    public PaymentLink createPaymentLink(PaymentLinkRequest r) {
        ObjectNode body = mapper.createObjectNode();
        body.put("amount", r.amountMinor());
        body.put("currency", r.currency());
        body.put("accept_partial", false);
        // Unique per link, at most 40 characters (our platform_payment id: a 36-character UUID).
        body.put("reference_id", truncate(r.referenceId(), 40));
        body.put("expire_by", r.expireByEpochSeconds());
        if (StringUtils.hasText(r.description())) {
            body.put("description", truncate(r.description(), 2048));
        }
        ObjectNode customer = mapper.createObjectNode();
        putIfText(customer, "name", r.customerName());
        putIfText(customer, "email", r.customerEmail());
        putIfText(customer, "contact", r.customerContact());
        if (customer.size() > 0) {
            body.set("customer", customer);
        }
        // We send our own (brand-aware) emails; Razorpay's SMS/email and reminders stay off.
        ObjectNode notify = body.putObject("notify");
        notify.put("sms", false);
        notify.put("email", false);
        body.put("reminder_enable", false);
        body.set("notes", notes(r.notes()));
        if (StringUtils.hasText(r.callbackUrl())) {
            body.put("callback_url", r.callbackUrl());
            body.put("callback_method", "get");
        }
        if (StringUtils.hasText(r.checkoutName())) {
            // https://razorpay.com/docs/api/payments/payment-links/change-business-name/
            body.putObject("options").putObject("checkout").put("name", truncate(r.checkoutName(), 120));
        }
        return toLink(call(HttpMethod.POST, "/payment_links", body));
    }

    @Override
    public PaymentLink fetchPaymentLink(String linkId) {
        return toLink(call(HttpMethod.GET, "/payment_links/" + seg(linkId), null));
    }

    @Override
    public PaymentLink cancelPaymentLink(String linkId) {
        return toLink(call(HttpMethod.POST, "/payment_links/" + seg(linkId) + "/cancel", mapper.createObjectNode()));
    }

    private PaymentLink toLink(JsonNode n) {
        List<LinkPayment> payments = new ArrayList<>();
        JsonNode ps = n.get("payments");
        if (ps != null && ps.isArray()) {
            for (JsonNode p : ps) {
                payments.add(new LinkPayment(text(p, "payment_id"), p.path("amount").asLong(0), text(p, "status")));
            }
        }
        Long expireBy = n.hasNonNull("expire_by") ? n.get("expire_by").asLong() : null;
        return new PaymentLink(text(n, "id"), text(n, "short_url"), text(n, "status"), expireBy, payments);
    }

    // ── Recurring ────────────────────────────────────────────────────────

    @Override
    public String createOrGetCustomer(String name, String email, String contact, Map<String, String> notes) {
        ObjectNode body = mapper.createObjectNode();
        putIfText(body, "name", truncate(name, 50));
        putIfText(body, "email", email);
        putIfText(body, "contact", contact);
        body.put("fail_existing", "0");
        body.set("notes", notes(notes));
        return text(call(HttpMethod.POST, "/customers", body), "id");
    }

    @Override
    public Customer fetchCustomer(String customerId) {
        JsonNode n = call(HttpMethod.GET, "/customers/" + seg(customerId), null);
        return new Customer(text(n, "id"), text(n, "name"), text(n, "email"), text(n, "contact"));
    }

    @Override
    public RegistrationLink createRegistrationLink(RegistrationLinkRequest r) {
        ObjectNode body = mapper.createObjectNode();
        ObjectNode customer = body.putObject("customer");
        putIfText(customer, "name", r.customerName());
        putIfText(customer, "email", r.customerEmail());
        putIfText(customer, "contact", r.customerContact());
        body.put("type", "link");
        body.put("amount", r.amountMinor());
        body.put("currency", r.currency());
        body.put("description", truncate(r.description(), 255));
        ObjectNode reg = body.putObject("subscription_registration");
        reg.put("method", r.method());
        reg.put("max_amount", r.maxAmountMinor());
        reg.put("frequency", r.frequency());
        if (r.tokenExpireAtEpochSeconds() != null) {
            reg.put("expire_at", r.tokenExpireAtEpochSeconds());
        }
        putIfText(body, "receipt", truncate(r.receipt(), 40));
        body.put("expire_by", r.linkExpireByEpochSeconds());
        // We send our own emails.
        body.put("sms_notify", false);
        body.put("email_notify", false);
        body.set("notes", notes(r.notes()));
        JsonNode n = call(HttpMethod.POST, "/subscription_registration/auth_links", body);
        return new RegistrationLink(text(n, "id"), text(n, "short_url"), text(n, "order_id"), text(n, "status"));
    }

    @Override
    public PaymentLink fetchRegistrationLink(String invoiceId) {
        return invoiceAsLink(call(HttpMethod.GET, "/invoices/" + seg(invoiceId), null));
    }

    @Override
    public PaymentLink cancelRegistrationLink(String invoiceId) {
        return invoiceAsLink(call(HttpMethod.POST, "/invoices/" + seg(invoiceId) + "/cancel", mapper.createObjectNode()));
    }

    private PaymentLink invoiceAsLink(JsonNode n) {
        String st = text(n, "status");
        String mapped = st == null ? null : switch (st.toLowerCase(java.util.Locale.ROOT)) {
            case "paid" -> "paid";
            case "cancelled", "deleted" -> "cancelled";
            case "expired" -> "expired";
            default -> "created";
        };
        List<LinkPayment> payments = new ArrayList<>();
        if (text(n, "payment_id") != null) {
            payments.add(new LinkPayment(text(n, "payment_id"), n.path("amount_paid").asLong(0), "captured"));
        }
        Long expireBy = n.hasNonNull("expire_by") ? n.get("expire_by").asLong() : null;
        return new PaymentLink(text(n, "id"), text(n, "short_url"), mapped, expireBy, payments);
    }

    @Override
    public List<TokenInfo> fetchTokens(String customerId) {
        JsonNode n = call(HttpMethod.GET, "/customers/" + seg(customerId) + "/tokens", null);
        List<TokenInfo> out = new ArrayList<>();
        JsonNode items = n.get("items");
        if (items != null && items.isArray()) {
            for (JsonNode t : items) {
                JsonNode rd = t.path("recurring_details");
                out.add(new TokenInfo(
                        text(t, "id"),
                        text(t, "method"),
                        rd.hasNonNull("status") ? rd.get("status").asText() : null,
                        t.hasNonNull("max_amount") ? t.get("max_amount").asLong() : null,
                        t.hasNonNull("expired_at") ? t.get("expired_at").asLong() : null));
            }
        }
        return out;
    }

    @Override
    public void cancelToken(String customerId, String tokenId, String method) {
        if ("CARD".equalsIgnoreCase(method)) {
            call(HttpMethod.DELETE, "/customers/" + seg(customerId) + "/tokens/" + seg(tokenId), null);
            return;
        }
        call(HttpMethod.PUT, "/customers/" + seg(customerId) + "/tokens/" + seg(tokenId) + "/cancel",
                mapper.createObjectNode());
    }

    @Override
    public RecurringDebit createRecurringDebit(RecurringDebitRequest r) {
        ObjectNode order = mapper.createObjectNode();
        order.put("amount", r.amountMinor());
        order.put("currency", r.currency());
        order.put("payment_capture", true);
        putIfText(order, "receipt", truncate(r.receipt(), 40));
        // No top-level token_id on the order: the platform account rejects it (see
        // RazorpayPaymentManager.chargeRecurring). Without a notification object Razorpay sends the
        // pre-debit notice itself and debits later: UPI about 25 h after the notice, "may take
        // between 24-36 hours" (https://razorpay.com/docs/api/payments/recurring-payments/upi/create-subsequent-payments/);
        // cards "after 36 hours and 5 minutes"
        // (https://razorpay.com/docs/api/payments/recurring-payments/cards/create-subsequent-payments/).
        // AiSubscriptionCollectionService raises debits early enough for both.
        order.set("notes", notes(r.notes()));
        String orderId;
        try {
            orderId = text(call(HttpMethod.POST, "/orders", order), "id");
        } catch (RazorpayGatewayException e) {
            // No order, so no payment can exist: a clean refusal.
            throw new RazorpayDebitException(e, null);
        }

        ObjectNode pay = mapper.createObjectNode();
        putIfText(pay, "email", r.email());
        putIfText(pay, "contact", r.contact());
        pay.put("currency", r.currency());
        pay.put("amount", r.amountMinor());
        pay.put("order_id", orderId);
        pay.put("customer_id", r.customerId());
        pay.put("token", r.tokenId());
        pay.put("recurring", true);
        putIfText(pay, "description", truncate(r.description(), 255));
        pay.set("notes", notes(r.notes()));
        JsonNode p;
        try {
            p = call(HttpMethod.POST, "/payments/create/recurring", pay);
        } catch (RazorpayGatewayException e) {
            // The order exists. A 4xx is a refusal (no payment); a timeout / 5xx / unreadable answer
            // may still have created the payment: the caller waits for the webhook or the order
            // reconcile instead of sending a link (RazorpayDebitException#paymentMayExist).
            throw new RazorpayDebitException(e, orderId);
        }
        String paymentId = text(p, "razorpay_payment_id");
        if (paymentId == null) {
            paymentId = text(p, "id");
        }
        return new RecurringDebit(orderId, paymentId);
    }

    // ── Payments / refunds ───────────────────────────────────────────────

    @Override
    public PaymentInfo fetchPayment(String paymentId) {
        return toPayment(call(HttpMethod.GET, "/payments/" + seg(paymentId), null));
    }

    @Override
    public List<PaymentInfo> fetchOrderPayments(String orderId) {
        JsonNode n = call(HttpMethod.GET, "/orders/" + seg(orderId) + "/payments", null);
        List<PaymentInfo> out = new ArrayList<>();
        JsonNode items = n.get("items");
        if (items != null && items.isArray()) {
            for (JsonNode p : items) {
                out.add(toPayment(p));
            }
        }
        return out;
    }

    private PaymentInfo toPayment(JsonNode n) {
        Map<String, String> notes = new LinkedHashMap<>();
        JsonNode nn = n.get("notes");
        if (nn != null && nn.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> it = nn.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                notes.put(e.getKey(), e.getValue().asText());
            }
        }
        return new PaymentInfo(text(n, "id"), text(n, "status"), n.path("amount").asLong(0),
                n.path("amount_refunded").asLong(0), text(n, "currency"), text(n, "order_id"),
                text(n, "token_id"), text(n, "customer_id"), text(n, "method"), notes);
    }

    @Override
    public Refund refund(String paymentId, Long amountMinor, String receipt, Map<String, String> notes) {
        ObjectNode body = mapper.createObjectNode();
        if (amountMinor != null) {
            body.put("amount", amountMinor);
        }
        body.put("speed", "normal");
        putIfText(body, "receipt", truncate(receipt, 40));
        body.set("notes", notes(notes));
        JsonNode n = call(HttpMethod.POST, "/payments/" + seg(paymentId) + "/refund", body);
        return new Refund(text(n, "id"), n.path("amount").asLong(0), text(n, "status"));
    }

    // ── plumbing ─────────────────────────────────────────────────────────

    private JsonNode call(HttpMethod method, String path, JsonNode body) {
        String[] creds = credentials.get();
        if (creds == null || !StringUtils.hasText(creds[0]) || !StringUtils.hasText(creds[1])) {
            throw new RazorpayGatewayException(0, "NO_CREDENTIALS", "platform Razorpay credentials are not configured");
        }
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set(HttpHeaders.AUTHORIZATION, "Basic " + Base64.getEncoder()
                .encodeToString((creds[0] + ":" + creds[1]).getBytes(StandardCharsets.UTF_8)));
        try {
            ResponseEntity<String> resp = restTemplate.exchange(apiBase + path, method,
                    new HttpEntity<>(body == null ? null : body.toString(), headers), String.class);
            String s = resp.getBody();
            return s == null || s.isBlank() ? mapper.createObjectNode() : mapper.readTree(s);
        } catch (HttpStatusCodeException e) {
            String code = null;
            String desc = e.getStatusText();
            try {
                JsonNode err = mapper.readTree(e.getResponseBodyAsString()).path("error");
                code = text(err, "code");
                if (text(err, "description") != null) {
                    desc = text(err, "description");
                }
            } catch (Exception ignored) {
                // body not JSON
            }
            log.warn("[ai-plans-billing] Razorpay {} {} -> {} {}", method, path, e.getStatusCode().value(), code);
            throw new RazorpayGatewayException(e.getStatusCode().value(), code,
                    "Razorpay " + method + " " + path + " failed: " + desc);
        } catch (RestClientException e) {
            throw new RazorpayGatewayException(0, "UNREACHABLE", "Razorpay " + method + " " + path
                    + " failed: " + e.getMessage());
        } catch (RazorpayGatewayException e) {
            throw e;
        } catch (Exception e) {
            throw new RazorpayGatewayException(0, "BAD_RESPONSE", "Razorpay " + path + ": " + e.getMessage());
        }
    }

    private ObjectNode notes(Map<String, String> notes) {
        // Razorpay: at most 15 notes; values up to 256 characters per the docs, but the validation
        // error says 255, so stay at 255 (https://razorpay.com/docs/api/payments/payment-links/create-standard/).
        ObjectNode n = mapper.createObjectNode();
        if (notes != null) {
            int i = 0;
            for (Map.Entry<String, String> e : notes.entrySet()) {
                if (e.getValue() == null || i++ >= 15) {
                    continue;
                }
                n.put(e.getKey(), truncate(e.getValue(), 255));
            }
        }
        return n;
    }

    private static String seg(String id) {
        if (id == null || !id.matches("[A-Za-z0-9_]+")) {
            throw new IllegalArgumentException("bad Razorpay id: " + id);
        }
        return id;
    }

    private static void putIfText(ObjectNode n, String k, String v) {
        if (StringUtils.hasText(v)) {
            n.put(k, v);
        }
    }

    private static String text(JsonNode n, String field) {
        if (n == null || !n.hasNonNull(field)) {
            return null;
        }
        return n.get(field).asText();
    }

    static String truncate(String s, int max) {
        if (s == null) {
            return null;
        }
        return s.length() <= max ? s : s.substring(0, max);
    }
}
