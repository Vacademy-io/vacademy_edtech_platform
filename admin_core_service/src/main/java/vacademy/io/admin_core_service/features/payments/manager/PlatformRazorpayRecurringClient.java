package vacademy.io.admin_core_service.features.payments.manager;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformPaymentConfigService;
import vacademy.io.common.exceptions.VacademyException;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/**
 * Razorpay recurring payments (UPI Autopay, card e-mandate, e-mandate) on the PLATFORM account,
 * for AI plan autopay (owner decision D5). Talks to the REST API directly so every call can be
 * unit-tested against a mocked transport; the credentials are the platform's
 * ({@link PlatformPaymentConfigService#getRazorpayCredsMap()}), never an institute's.
 *
 * <p>Flow (our own renewal job drives the debits, not Razorpay Subscriptions):
 * <ol>
 *   <li>{@link #createCustomer} once per institute (idempotent: {@code fail_existing=0}).</li>
 *   <li>{@link #createRegistrationLink}: a hosted authorisation link whose payment is the first
 *       period's charge and which registers the mandate. Razorpay calls it an invoice
 *       ({@code inv_...}); paying it fires {@code payment.captured}, {@code order.paid},
 *       {@code invoice.paid} and, when the bank confirms, {@code token.confirmed}.
 *       https://razorpay.com/docs/api/payments/recurring-payments/upi/create-authorization-transaction/</li>
 *   <li>{@link #fetchPayment} on the authorisation payment gives {@code token_id} and
 *       {@code customer_id}; {@link #fetchToken} gives the token state
 *       ({@code recurring_details.status}).
 *       https://razorpay.com/docs/api/payments/recurring-payments/upi/tokens/</li>
 *   <li>Each renewal: {@link #createRecurringOrder} then {@link #createRecurringPayment}.
 *       Pre-debit notice: UPI debits about 25 h and cards about 36 h 5 min after Razorpay's
 *       pre-debit notification is delivered; passing {@code notification.token_id} on the order
 *       lets us choose {@code payment_after}, but then Razorpay does NOT retry a failed debit, so
 *       the caller falls back to a payment link (D5).
 *       https://razorpay.com/docs/api/payments/recurring-payments/upi/create-subsequent-payments/
 *       https://razorpay.com/docs/api/payments/recurring-payments/cards/create-subsequent-payments/</li>
 *   <li>{@link #cancelToken}: UPI {@code PUT /customers/:cid/tokens/:tid/cancel} (cancels the
 *       mandate with NPCI; {@code token.cancelled} follows); cards / e-mandate
 *       {@code DELETE /customers/:cid/tokens/:tid}.</li>
 * </ol>
 *
 * <p>Money guards enforced here, before any HTTP call: a debit above
 * {@link #AFA_FREE_CEILING_MINOR} (Rs 15,000, the RBI e-mandate limit for debits without
 * additional factor authentication) or above the mandate's {@code max_amount} is refused with
 * {@link RecurringNotAllowedException}, so the caller sends a payment link instead (D5).
 *
 * <p>No call here retries: every method maps a non-2xx answer to {@link RazorpayApiException}
 * carrying Razorpay's {@code error.code} / {@code error.description}.
 */
@Slf4j
@Component
public class PlatformRazorpayRecurringClient {

    /** Rs 15,000 in paise: the largest autopay debit without additional factor authentication (D5). */
    public static final long AFA_FREE_CEILING_MINOR = 1_500_000L;

    static final String API_BASE = "https://api.razorpay.com/v1";

    /** Mandate methods as Razorpay names them. */
    public enum Method {
        UPI("upi"), CARD("card"), EMANDATE("emandate");

        private final String wire;

        Method(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static Method parse(String raw) {
            if (raw == null) return null;
            String v = raw.trim().toUpperCase(Locale.ROOT);
            for (Method m : values()) {
                if (m.name().equals(v) || m.wire.equalsIgnoreCase(v)) return m;
            }
            return null;
        }
    }

    /** Raised for a non-2xx Razorpay answer. */
    public static class RazorpayApiException extends VacademyException {
        private final int status;
        private final String code;

        public RazorpayApiException(int status, String code, String message) {
            super("Razorpay " + status + (code != null ? " " + code : "") + ": " + message);
            this.status = status;
            this.code = code;
        }

        public int getHttpStatus() {
            return status;
        }

        public String getCode() {
            return code;
        }
    }

    /** The debit must not go through autopay (amount over the AFA ceiling or the mandate cap). */
    public static class RecurringNotAllowedException extends VacademyException {
        public RecurringNotAllowedException(String message) {
            super(message);
        }
    }

    /** Minimal HTTP seam so tests can mock Razorpay. Body is JSON or null. */
    public interface Transport {
        Response send(String method, String url, String basicAuth, String jsonBody);

        record Response(int status, String body) {}
    }

    /** {@link Transport} over java.net.http with 10 s connect / 30 s read timeouts. */
    static final class JdkTransport implements Transport {
        private final HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();

        @Override
        public Response send(String method, String url, String basicAuth, String jsonBody) {
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(30))
                    .header("Authorization", basicAuth)
                    .header("Accept", "application/json");
            HttpRequest.BodyPublisher body = jsonBody == null
                    ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(jsonBody, StandardCharsets.UTF_8);
            if (jsonBody != null) {
                b.header("Content-Type", "application/json");
            }
            b.method(method, body);
            try {
                HttpResponse<String> r = client.send(b.build(), HttpResponse.BodyHandlers.ofString());
                return new Response(r.statusCode(), r.body());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new VacademyException("Razorpay call interrupted: " + method + " " + url);
            } catch (Exception e) {
                throw new VacademyException("Razorpay call failed: " + method + " " + url + ": " + e.getMessage());
            }
        }
    }

    private final ObjectMapper mapper = new ObjectMapper();
    private final PlatformPaymentConfigService configService;
    private final Transport transport;
    private final String apiBase;

    @Autowired
    public PlatformRazorpayRecurringClient(PlatformPaymentConfigService configService) {
        this(configService, new JdkTransport(), API_BASE);
    }

    PlatformRazorpayRecurringClient(PlatformPaymentConfigService configService, Transport transport, String apiBase) {
        this.configService = configService;
        this.transport = transport;
        this.apiBase = apiBase;
    }

    // ── customer ─────────────────────────────────────────────────────────

    /**
     * {@code POST /customers} with {@code fail_existing=0}: returns the existing customer for the
     * same email/contact instead of failing.
     *
     * @return the Razorpay customer id ({@code cust_...})
     */
    public String createCustomer(String name, String email, String contact, Map<String, String> notes) {
        ObjectNode body = mapper.createObjectNode();
        if (StringUtils.hasText(name)) body.put("name", clip(name, 50));
        if (StringUtils.hasText(email)) body.put("email", email.trim());
        if (StringUtils.hasText(contact)) body.put("contact", contact.trim());
        body.put("fail_existing", "0");
        putNotes(body, notes, 15);
        JsonNode r = call("POST", "/customers", body);
        return textOrNull(r, "id");
    }

    // ── authorisation (registration link) ────────────────────────────────

    /** Input for {@link #createRegistrationLink}. Amounts in paise. */
    public record RegistrationLinkRequest(
            String customerName,
            String customerEmail,
            String customerContact,
            long firstAmountMinor,
            String description,
            Method method,
            long maxAmountMinor,
            Instant mandateExpireAt,
            String frequency,
            String receipt,
            Instant linkExpireBy,
            Map<String, String> notes) {}

    /**
     * {@code POST /subscription_registration/auth_links}. The customer pays
     * {@code firstAmountMinor} (the first period's charge; Razorpay's minimum is Rs 1) and
     * authorises a mandate of up to {@code maxAmountMinor} per debit. SMS / email from Razorpay
     * are off: we send our own brand-correct emails. Registration links do not support a
     * {@code callback_url}.
     *
     * @return {@code id} (inv_...), {@code short_url}, {@code order_id}, {@code status}
     */
    public Map<String, Object> createRegistrationLink(RegistrationLinkRequest req) {
        JsonNode r = call("POST", "/subscription_registration/auth_links", buildRegistrationLinkBody(req));
        return summarize(r, "id", "short_url", "order_id", "status", "customer_id", "expire_by");
    }

    /** The registration-link body; package-private for tests. */
    ObjectNode buildRegistrationLinkBody(RegistrationLinkRequest req) {
        if (req == null || req.method() == null) {
            throw new VacademyException("Registration link needs a mandate method");
        }
        if (req.firstAmountMinor() < 100) {
            throw new VacademyException("Registration link amount must be at least Rs 1");
        }
        if (req.maxAmountMinor() < req.firstAmountMinor()) {
            throw new VacademyException("Mandate max_amount must cover the first charge");
        }
        if (req.maxAmountMinor() > AFA_FREE_CEILING_MINOR) {
            throw new RecurringNotAllowedException("Mandate max_amount above Rs 15,000 needs a payment link (D5)");
        }
        ObjectNode body = mapper.createObjectNode();
        ObjectNode customer = body.putObject("customer");
        customer.put("name", clip(StringUtils.hasText(req.customerName()) ? req.customerName() : "Customer", 50));
        if (StringUtils.hasText(req.customerEmail())) customer.put("email", req.customerEmail().trim());
        if (StringUtils.hasText(req.customerContact())) customer.put("contact", req.customerContact().trim());
        body.put("type", "link");
        body.put("amount", req.firstAmountMinor());
        body.put("currency", "INR");
        body.put("description", clip(StringUtils.hasText(req.description()) ? req.description() : "Subscription", 255));
        ObjectNode reg = body.putObject("subscription_registration");
        reg.put("method", req.method().wire());
        reg.put("max_amount", req.maxAmountMinor());
        if (req.mandateExpireAt() != null) reg.put("expire_at", req.mandateExpireAt().getEpochSecond());
        reg.put("frequency", StringUtils.hasText(req.frequency()) ? req.frequency() : "as_presented");
        if (StringUtils.hasText(req.receipt())) body.put("receipt", clip(req.receipt(), 40));
        if (req.linkExpireBy() != null) body.put("expire_by", req.linkExpireBy().getEpochSecond());
        body.put("sms_notify", 0);
        body.put("email_notify", 0);
        putNotes(body, req.notes(), 15);
        return body;
    }

    /** {@code GET /invoices/:id}: status (issued | paid | cancelled | expired), payment_id, order_id. */
    public Map<String, Object> fetchRegistrationLink(String invoiceId) {
        JsonNode r = call("GET", "/invoices/" + enc(required(invoiceId, "invoice id")), null);
        return summarize(r, "id", "status", "payment_id", "order_id", "customer_id", "short_url", "expire_by");
    }

    /** {@code POST /invoices/:id/cancel}; only an {@code issued} link can be cancelled. */
    public Map<String, Object> cancelRegistrationLink(String invoiceId) {
        JsonNode r = call("POST", "/invoices/" + enc(required(invoiceId, "invoice id")) + "/cancel", null);
        return summarize(r, "id", "status");
    }

    // ── payments and tokens ──────────────────────────────────────────────

    /**
     * {@code GET /payments/:id}: {@code status}, {@code amount}, {@code amount_refunded},
     * {@code order_id}, {@code invoice_id}, {@code token_id}, {@code customer_id},
     * {@code method}, {@code notes}.
     */
    public JsonNode fetchPayment(String paymentId) {
        return call("GET", "/payments/" + enc(required(paymentId, "payment id")), null);
    }

    /** {@code GET /customers/:cid/tokens/:tid}; status is {@code recurring_details.status}. */
    public JsonNode fetchToken(String customerId, String tokenId) {
        return call("GET", "/customers/" + enc(required(customerId, "customer id")) + "/tokens/"
                + enc(required(tokenId, "token id")), null);
    }

    /** {@code GET /customers/:cid/tokens}: the customer's usable tokens. */
    public List<JsonNode> fetchTokens(String customerId) {
        JsonNode r = call("GET", "/customers/" + enc(required(customerId, "customer id")) + "/tokens", null);
        List<JsonNode> out = new ArrayList<>();
        JsonNode items = r == null ? null : r.get("items");
        if (items instanceof ArrayNode arr) {
            arr.forEach(out::add);
        }
        return out;
    }

    /** The token's mandate status, lower case ({@code confirmed}, {@code paused}, ...), or null. */
    public static String tokenStatus(JsonNode token) {
        if (token == null) return null;
        JsonNode rd = token.get("recurring_details");
        String s = rd != null ? textOrNull(rd, "status") : null;
        return s != null ? s.toLowerCase(Locale.ROOT) : null;
    }

    /**
     * Stops a mandate. UPI: {@code PUT /customers/:cid/tokens/:tid/cancel} (cancels the mandate
     * with NPCI; the mandate is CANCELLED only when {@code token.cancelled} arrives). Card and
     * e-mandate: {@code DELETE /customers/:cid/tokens/:tid}.
     */
    public void cancelToken(String customerId, String tokenId, Method method) {
        String path = "/customers/" + enc(required(customerId, "customer id")) + "/tokens/"
                + enc(required(tokenId, "token id"));
        if (method == Method.UPI) {
            call("PUT", path + "/cancel", null);
        } else {
            call("DELETE", path, null);
        }
    }

    // ── renewal debits ───────────────────────────────────────────────────

    /** Input for {@link #createRecurringOrder}. Amounts in paise. */
    public record RecurringOrderRequest(
            long amountMinor,
            long mandateMaxAmountMinor,
            String receipt,
            String tokenId,
            Instant paymentAfter,
            Map<String, String> notes) {}

    /**
     * {@code POST /orders} for one renewal debit ({@code payment_capture} on). When
     * {@code paymentAfter} is set the order carries {@code notification.token_id} and
     * {@code notification.payment_after} (Razorpay then sends the pre-debit notification and will
     * not retry a failed debit). Amount guards: see the class comment.
     *
     * @return the order id ({@code order_...})
     */
    public String createRecurringOrder(RecurringOrderRequest req) {
        return textOrNull(call("POST", "/orders", buildRecurringOrderBody(req)), "id");
    }

    ObjectNode buildRecurringOrderBody(RecurringOrderRequest req) {
        checkDebitAmount(req.amountMinor(), req.mandateMaxAmountMinor());
        ObjectNode body = mapper.createObjectNode();
        body.put("amount", req.amountMinor());
        body.put("currency", "INR");
        if (StringUtils.hasText(req.receipt())) body.put("receipt", clip(req.receipt(), 40));
        body.put("payment_capture", true);
        if (req.paymentAfter() != null) {
            ObjectNode n = body.putObject("notification");
            n.put("token_id", required(req.tokenId(), "token id"));
            n.put("payment_after", req.paymentAfter().getEpochSecond());
        }
        putNotes(body, req.notes(), 15);
        return body;
    }

    /** Input for {@link #createRecurringPayment}. */
    public record RecurringPaymentRequest(
            String email,
            String contact,
            long amountMinor,
            long mandateMaxAmountMinor,
            String orderId,
            String customerId,
            String tokenId,
            String description,
            Map<String, String> notes) {}

    /**
     * {@code POST /payments/create/recurring}: debits the token for the order. The capture
     * still arrives as {@code payment.captured} (or {@code payment.failed}) on the platform
     * webhook, routed by {@code notes.payment_type}.
     *
     * @return {@code razorpay_payment_id} (some banks leave the payment in {@code created} while a
     *         file-based debit is pending)
     */
    public String createRecurringPayment(RecurringPaymentRequest req) {
        return textOrNull(call("POST", "/payments/create/recurring", buildRecurringPaymentBody(req)),
                "razorpay_payment_id");
    }

    ObjectNode buildRecurringPaymentBody(RecurringPaymentRequest req) {
        checkDebitAmount(req.amountMinor(), req.mandateMaxAmountMinor());
        ObjectNode body = mapper.createObjectNode();
        if (StringUtils.hasText(req.email())) body.put("email", req.email().trim());
        if (StringUtils.hasText(req.contact())) body.put("contact", req.contact().trim());
        body.put("amount", req.amountMinor());
        body.put("currency", "INR");
        body.put("order_id", required(req.orderId(), "order id"));
        body.put("customer_id", required(req.customerId(), "customer id"));
        body.put("token", required(req.tokenId(), "token id"));
        // "1" as RazorpayPaymentManager.chargeRecurring sends it in production today.
        body.put("recurring", "1");
        if (StringUtils.hasText(req.description())) body.put("description", clip(req.description(), 255));
        putNotes(body, req.notes(), 15);
        return body;
    }

    /** Refuses a debit above the AFA-free ceiling or the mandate's max_amount. */
    public static void checkDebitAmount(long amountMinor, long mandateMaxAmountMinor) {
        if (amountMinor <= 0) {
            throw new VacademyException("Debit amount must be positive");
        }
        if (amountMinor > AFA_FREE_CEILING_MINOR) {
            throw new RecurringNotAllowedException("Debit of " + amountMinor
                    + " paise is above the Rs 15,000 autopay ceiling; send a payment link");
        }
        if (mandateMaxAmountMinor > 0 && amountMinor > mandateMaxAmountMinor) {
            throw new RecurringNotAllowedException("Debit of " + amountMinor
                    + " paise is above the mandate max_amount " + mandateMaxAmountMinor);
        }
    }

    // ── plumbing ─────────────────────────────────────────────────────────

    JsonNode call(String method, String path, JsonNode body) {
        Map<String, Object> creds = configService.getRazorpayCredsMap();
        String keyId = str(creds.get("apiKey"), creds.get("keyId"));
        String secret = str(creds.get("keySecret"), creds.get("publishableKey"));
        if (!StringUtils.hasText(keyId) || !StringUtils.hasText(secret)) {
            throw new VacademyException("Platform Razorpay credentials are not configured");
        }
        String auth = "Basic " + Base64.getEncoder()
                .encodeToString((keyId + ":" + secret).getBytes(StandardCharsets.UTF_8));
        String json;
        try {
            json = body == null ? null : mapper.writeValueAsString(body);
        } catch (Exception e) {
            throw new VacademyException("Could not serialise Razorpay request: " + e.getMessage());
        }
        Transport.Response r = transport.send(method, apiBase + path, auth, json);
        JsonNode parsed = parse(r.body());
        if (r.status() < 200 || r.status() >= 300) {
            JsonNode err = parsed == null ? null : parsed.get("error");
            String code = err == null ? null : textOrNull(err, "code");
            String desc = err == null ? r.body() : textOrNull(err, "description");
            log.warn("[razorpay-recurring] {} {} -> {} {}", method, path, r.status(), desc);
            throw new RazorpayApiException(r.status(), code, desc == null ? "error" : desc);
        }
        return parsed;
    }

    private JsonNode parse(String body) {
        if (!StringUtils.hasText(body)) return null;
        try {
            return mapper.readTree(body);
        } catch (Exception e) {
            return null;
        }
    }

    private Map<String, Object> summarize(JsonNode r, String... fields) {
        Map<String, Object> out = new TreeMap<>();
        for (String f : fields) {
            JsonNode v = r == null ? null : r.get(f);
            if (v != null && !v.isNull()) {
                out.put(f, v.isNumber() ? (Object) v.asLong() : v.asText());
            }
        }
        return out;
    }

    private static void putNotes(ObjectNode body, Map<String, String> notes, int max) {
        if (notes == null || notes.isEmpty()) return;
        ObjectNode n = body.putObject("notes");
        TreeMap<String, String> sorted = new TreeMap<>();
        notes.forEach((k, v) -> {
            if (k != null && v != null) sorted.put(k, v);
        });
        for (Map.Entry<String, String> e : sorted.entrySet()) {
            if (n.size() >= max) break;
            n.put(e.getKey(), clip(e.getValue(), 255));
        }
    }

    static String textOrNull(JsonNode node, String field) {
        if (node == null || !node.has(field) || node.get(field).isNull()) return null;
        return node.get(field).asText();
    }

    private static String clip(String s, int max) {
        String t = s.trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    private static String required(String v, String what) {
        if (!StringUtils.hasText(v)) {
            throw new VacademyException("Razorpay call needs a " + what);
        }
        return v.trim();
    }

    private static String enc(String v) {
        return URLEncoder.encode(v, StandardCharsets.UTF_8);
    }

    private static String str(Object a, Object b) {
        if (a != null && StringUtils.hasText(a.toString())) return a.toString();
        return b == null ? null : b.toString();
    }
}
