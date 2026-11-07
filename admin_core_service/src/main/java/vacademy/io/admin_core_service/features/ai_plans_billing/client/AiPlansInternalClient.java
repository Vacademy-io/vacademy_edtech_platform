package vacademy.io.admin_core_service.features.ai_plans_billing.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Client for ai_service's internal AI-plan subscription endpoints
 * ({@code /ai-service/internal/plans/v1/**}, guarded by {@code X-Internal-Service-Token}).
 *
 * <p>ai_service owns plan eligibility, the subscription state machine and every charge; admin_core
 * owns money (Razorpay, platform_payment, GST documents). Every method here <b>throws</b> on a
 * non-2xx answer ({@link AiPlansUpstreamException}) instead of returning a soft failure: a
 * swallowed error is how a paid order ends up with nothing delivered (F1).
 *
 * <p>Responses are returned as plain maps: the JSON shape is ai_service's contract, and the
 * billing service reads it through {@link Json} helpers that tolerate extra fields.
 */
@Slf4j
@Component
public class AiPlansInternalClient {

    static final String BASE = "/ai-service/internal/plans/v1";
    private static final ParameterizedTypeReference<Map<String, Object>> MAP =
            new ParameterizedTypeReference<>() {};

    private final RestTemplate restTemplate;
    private final String aiServiceUrl;
    private final String internalServiceToken;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Autowired
    public AiPlansInternalClient(
            @Value("${ai.service.url:http://localhost:8077}") String aiServiceUrl,
            @Value("${ai.service.internal-token:}") String internalServiceToken) {
        this(timeoutRestTemplate(), aiServiceUrl, internalServiceToken);
    }

    /** Tests: an explicit RestTemplate (bind a MockRestServiceServer to it). */
    public AiPlansInternalClient(RestTemplate restTemplate, String aiServiceUrl, String internalServiceToken) {
        this.restTemplate = restTemplate;
        this.aiServiceUrl = aiServiceUrl;
        this.internalServiceToken = internalServiceToken;
    }

    /**
     * JDK HttpClient: unlike HttpURLConnection it supports PATCH. Pinned to HTTP/1.1: over plain
     * http the JDK default (HTTP/2) sends {@code Upgrade: h2c} with a chunked body, and uvicorn
     * (h11, ai_service's server) then drops the body, so every POST/PATCH arrived empty (422).
     * Found by the wire E2E test against the real router (AiPlansWireE2ETest).
     */
    static java.net.http.HttpClient http11Client() {
        return java.net.http.HttpClient.newBuilder()
                .version(java.net.http.HttpClient.Version.HTTP_1_1)
                .connectTimeout(java.time.Duration.ofSeconds(3))
                .build();
    }

    private static RestTemplate timeoutRestTemplate() {
        java.net.http.HttpClient http = http11Client();
        JdkClientHttpRequestFactory f = new JdkClientHttpRequestFactory(http);
        f.setReadTimeout(java.time.Duration.ofSeconds(30));
        return new RestTemplate(f);
    }

    // ── storefront ───────────────────────────────────────────────────────

    /** Listed, audience-eligible plans for the institute plus its current subscription (no tax). */
    public Map<String, Object> storefrontCatalog(String instituteId) {
        return get(uri("/storefront/catalog").queryParam("institute_id", instituteId).toUriString());
    }

    /** {action: NEW|UPGRADE|DOWNGRADE} -> {base_minor, period start/end, proration detail}. */
    public Map<String, Object> quote(String instituteId, String planVersionId, String action) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("institute_id", instituteId);
        body.put("plan_version_id", planVersionId);
        body.put("action", action);
        return post(BASE + "/subscriptions/quote", body);
    }

    /** Creates a PENDING subscription (source PAYMENT) and its DUE first PERIOD charge. Idempotent on the key. */
    public Map<String, Object> checkout(String instituteId, String planVersionId, String actor, String idempotencyKey) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("institute_id", instituteId);
        body.put("plan_version_id", planVersionId);
        body.put("actor", actor);
        body.put("idempotency_key", idempotencyKey);
        return post(BASE + "/subscriptions/checkout", body);
    }

    /** {action: UPGRADE|DOWNGRADE|CANCEL|RESUME}; an upgrade answers with its UPGRADE charge. */
    public Map<String, Object> changeSubscription(String subscriptionId, String action, String planVersionId,
            String actor) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("action", action);
        if (planVersionId != null) {
            body.put("plan_version_id", planVersionId);
        }
        body.put("actor", actor);
        return post(BASE + "/subscriptions/" + seg(subscriptionId) + "/change", body);
    }

    // ── charges ──────────────────────────────────────────────────────────

    /**
     * Charges admin_core must act on (critique #6: the billing job reads its work from state, not
     * from a roll report): {@code GET /charges?status=DUE&needs_collection=true}.
     */
    public List<Map<String, Object>> chargesNeedingCollection() {
        Map<String, Object> resp = get(uri("/charges")
                .queryParam("status", "DUE")
                .queryParam("needs_collection", "true")
                .toUriString());
        return Json.listOfMaps(resp, "charges", "items", "data");
    }

    /**
     * Open charges whose link is still live ({@code GET /charges?status=LINK_SENT}): the reminder
     * pass (T-3, T-0, grace) needs them, and {@code needs_collection} lists a LINK_SENT charge only
     * once its link has expired.
     */
    public List<Map<String, Object>> chargesWithLiveLinks() {
        Map<String, Object> resp = get(uri("/charges").queryParam("status", "LINK_SENT").toUriString());
        return Json.listOfMaps(resp, "charges", "items", "data");
    }

    /**
     * One charge by id; null when ai_service does not know it. ai_service filters
     * {@code GET /charges} by institute / subscription (not by id), so the institute narrows the
     * list and the id is matched here ({@code charge_id} is sent too, for a server that filters).
     */
    public Map<String, Object> charge(String chargeId, String instituteId) {
        UriComponentsBuilder b = uri("/charges").queryParam("charge_id", chargeId).queryParam("limit", 2000);
        if (instituteId != null && !instituteId.isBlank()) {
            b.queryParam("institute_id", instituteId);
        }
        Map<String, Object> resp = get(b.toUriString());
        List<Map<String, Object>> rows = Json.listOfMaps(resp, "charges", "items", "data");
        for (Map<String, Object> row : rows) {
            if (chargeId.equals(Json.str(row, "id", "charge_id"))) {
                return row;
            }
        }
        return Json.has(resp, "id") && chargeId.equals(Json.str(resp, "id")) ? resp : null;
    }

    /** Link / mandate / tax snapshot and status transitions. */
    public Map<String, Object> patchCharge(String chargeId, Map<String, Object> fields) {
        return exchange(HttpMethod.PATCH, BASE + "/charges/" + seg(chargeId), fields);
    }

    /**
     * The charge was paid. ai_service locks the charge, checks {@code amount_minor == total_minor},
     * activates / renews / upgrades, and answers {@code action}: ACTIVATED | RENEWAL_PAID |
     * GRACE_CLEARED | UPGRADED | ALREADY_PROCESSED | DUPLICATE | REFUND_REQUIRED | AMOUNT_MISMATCH.
     */
    public Map<String, Object> chargePaid(String chargeId, String platformPaymentId, String vendorPaymentId,
            long amountMinor) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("platform_payment_id", platformPaymentId);
        body.put("vendor_payment_id", vendorPaymentId);
        body.put("amount_minor", amountMinor);
        return post(BASE + "/charges/" + seg(chargeId) + "/paid", body);
    }

    /**
     * A refund of the charge's own payment. {@code totalRefundedMinor} is the CUMULATIVE amount
     * refunded on that payment so a replay or a late, older event is harmless; ai_service refuses
     * when {@code vendor_payment_id} is not the charge's (a duplicate's refund must never touch the
     * paid charge, critique #7).
     */
    public Map<String, Object> chargeRefunded(String chargeId, String vendorPaymentId, long refundAmountMinor,
            long totalRefundedMinor, String vendorRefundId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("vendor_payment_id", vendorPaymentId);
        body.put("amount_minor", refundAmountMinor);
        body.put("total_refunded_minor", totalRefundedMinor);
        if (vendorRefundId != null) {
            body.put("refund_id", vendorRefundId);
        }
        body.put("actor", "system:ai-plans-billing");
        return post(BASE + "/charges/" + seg(chargeId) + "/refunded", body);
    }

    /** Staff waiver ({@code POST /charges/{id}/waive}): the period's benefits without payment, no invoice. */
    public Map<String, Object> waiveCharge(String chargeId, String reason, String actor) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("reason", reason);
        body.put("actor", actor);
        return post(BASE + "/charges/" + seg(chargeId) + "/waive", body);
    }

    public Map<String, Object> voidCharge(String chargeId, String reason, String actor) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("reason", reason);
        body.put("actor", actor);
        return post(BASE + "/charges/" + seg(chargeId) + "/void", body);
    }

    // ── plumbing ─────────────────────────────────────────────────────────

    private UriComponentsBuilder uri(String path) {
        return UriComponentsBuilder.fromHttpUrl(aiServiceUrl + BASE + path);
    }

    private static String seg(String id) {
        if (id == null || id.isBlank() || !id.matches("[A-Za-z0-9_-]+")) {
            throw new IllegalArgumentException("bad id: " + id);
        }
        return id;
    }

    private Map<String, Object> get(String absoluteUrl) {
        return call(HttpMethod.GET, absoluteUrl, null);
    }

    private Map<String, Object> post(String path, Map<String, Object> body) {
        return exchange(HttpMethod.POST, path, body);
    }

    private Map<String, Object> exchange(HttpMethod method, String path, Map<String, Object> body) {
        return call(method, aiServiceUrl + path, body);
    }

    private Map<String, Object> call(HttpMethod method, String url, Map<String, Object> body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-Internal-Service-Token", internalServiceToken == null ? "" : internalServiceToken);
        try {
            ResponseEntity<Map<String, Object>> resp = restTemplate.exchange(
                    url, method, new HttpEntity<>(body, headers), MAP);
            Map<String, Object> out = resp.getBody();
            return out == null ? new LinkedHashMap<>() : out;
        } catch (HttpStatusCodeException e) {
            int status = e.getStatusCode().value();
            String code = errorCode(e.getResponseBodyAsString());
            boolean retryable = status >= 500 || status == 429 || status == 401 || status == 503;
            log.warn("[ai-plans-billing] ai_service {} {} -> {} {}", method, path(url), status, code);
            throw new AiPlansUpstreamException(status, code,
                    "ai_service answered " + status + " (" + code + ") for " + path(url), retryable);
        } catch (RestClientException e) {
            log.warn("[ai-plans-billing] ai_service {} {} failed: {}", method, path(url), e.getMessage());
            throw new AiPlansUpstreamException(0, "UPSTREAM_UNREACHABLE",
                    "ai_service could not be reached for " + path(url), true);
        }
    }

    private static String path(String url) {
        int q = url.indexOf('?');
        return q < 0 ? url : url.substring(0, q);
    }

    /** FastAPI bodies: {"detail": {"error_code"|"code": ...}} or {"detail": "..."} or {"error_code": ...}. */
    String errorCode(String body) {
        if (body == null || body.isBlank()) {
            return "UPSTREAM_ERROR";
        }
        try {
            JsonNode root = objectMapper.readTree(body);
            JsonNode detail = root.get("detail");
            for (JsonNode n : new JsonNode[] { detail, root }) {
                if (n != null && n.isObject()) {
                    for (String k : new String[] { "error_code", "code", "reason" }) {
                        JsonNode v = n.get(k);
                        if (v != null && v.isTextual() && !v.asText().isBlank()) {
                            return v.asText();
                        }
                    }
                }
            }
            if (detail != null && detail.isTextual()) {
                String d = detail.asText().trim();
                if (d.matches("[A-Z][A-Z0-9_]{2,63}")) {
                    return d;
                }
            }
        } catch (Exception ignored) {
            // not JSON
        }
        return "UPSTREAM_ERROR";
    }

    /** Null-tolerant readers for ai_service's JSON maps (several accepted key spellings each). */
    public static final class Json {
        private Json() {
        }

        public static boolean has(Map<String, Object> m, String key) {
            return m != null && m.get(key) != null;
        }

        public static Object raw(Map<String, Object> m, String... keys) {
            if (m == null) {
                return null;
            }
            for (String k : keys) {
                Object v = m.get(k);
                if (v != null) {
                    return v;
                }
            }
            return null;
        }

        public static String str(Map<String, Object> m, String... keys) {
            Object v = raw(m, keys);
            return v == null ? null : v.toString();
        }

        public static Long lng(Map<String, Object> m, String... keys) {
            Object v = raw(m, keys);
            if (v instanceof Number n) {
                return n.longValue();
            }
            if (v != null) {
                try {
                    return Long.parseLong(v.toString().trim());
                } catch (NumberFormatException e) {
                    return null;
                }
            }
            return null;
        }

        public static boolean bool(Map<String, Object> m, String... keys) {
            Object v = raw(m, keys);
            return v instanceof Boolean b ? b : v != null && "true".equalsIgnoreCase(v.toString());
        }

        @SuppressWarnings("unchecked")
        public static Map<String, Object> map(Map<String, Object> m, String... keys) {
            Object v = raw(m, keys);
            return v instanceof Map ? (Map<String, Object>) v : null;
        }

        @SuppressWarnings("unchecked")
        public static List<Map<String, Object>> listOfMaps(Map<String, Object> m, String... keys) {
            Object v = raw(m, keys);
            if (!(v instanceof List<?> list)) {
                return Collections.emptyList();
            }
            List<Map<String, Object>> out = new ArrayList<>();
            for (Object o : list) {
                if (o instanceof Map) {
                    out.add((Map<String, Object>) o);
                }
            }
            return out;
        }
    }
}
