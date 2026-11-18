package vacademy.io.admin_core_service.core.external;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpRequest;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.logging.PayloadRedactor;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Every FAILED call admin-core makes to an integrated third-party API, in
 * {@code external_api_call_log}, with what we sent and what the vendor answered, so the
 * platform portal can show the failure and the reason for it. Plivo, Exotel, Airtel, Aavtaar,
 * Razorpay, Meta WhatsApp, WATI, FX rates, workflow HTTP steps and the rest each build their own
 * RestTemplate; each one is passed through {@link #attach} where it is built.
 *
 * <p>Only failures (a status of 400 or more, or no answer) and only integrated vendors
 * ({@link IntegratedVendors}): our own services, private addresses and any other site are
 * skipped. The request body and the vendor's error body are kept after redaction (credentials,
 * payment-instrument fields, phones, emails, OTPs) and cut to 4,000 characters; headers and
 * query values never. The error response is read once and replayed, so the caller sees exactly
 * what it would have. The write happens on one background thread with a bounded queue; when the
 * queue is full the row is dropped, so the caller never waits and never fails because of it.
 */
@Component
public class ExternalCallLog {

    private static final Logger log = LoggerFactory.getLogger(ExternalCallLog.class);
    private static final String SOURCE_SERVICE = "admin_core";
    private static final List<String> OWN_SUFFIXES = List.of(".vacademy.io", ".svc", ".svc.cluster.local",
            ".internal", ".local");
    private static final int MAX_BODY_CHARS = 4000;
    private static final Interceptor INTERCEPTOR = new Interceptor();
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final PayloadRedactor REDACTOR = new PayloadRedactor(List.of(
            "phone", "phoneNumber", "phone_number", "mobile", "mobileNumber", "msisdn", "email", "otp",
            "to", "from", "caller", "callerId", "vpa", "upiId", "contact"));

    private static volatile ExternalCallLog instance;

    private final JdbcTemplate jdbc;
    private final ThreadPoolExecutor writer = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(500), r -> {
                Thread t = new Thread(r, "external-call-log");
                t.setDaemon(true);
                return t;
            }, new ThreadPoolExecutor.DiscardPolicy());

    public ExternalCallLog(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostConstruct
    void register() {
        instance = this;
    }

    /** Adds failure logging to a RestTemplate and returns it, for use where it is built. */
    public static RestTemplate attach(RestTemplate rest) {
        List<ClientHttpRequestInterceptor> list = new ArrayList<>(rest.getInterceptors());
        if (!list.contains(INTERCEPTOR)) {
            list.add(INTERCEPTOR);
            rest.setInterceptors(list);
        }
        return rest;
    }

    static boolean external(String host) {
        String h = host == null ? "" : host.trim().toLowerCase(Locale.ROOT);
        if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        if (h.isEmpty() || h.equals("localhost") || !h.contains(".")) return false;
        if (h.equals("vacademy.io")) return false;
        for (String s : OWN_SUFFIXES) {
            if (h.endsWith(s)) return false;
        }
        if (h.matches("[0-9.]+") || h.contains(":")) {
            try {
                InetAddress a = InetAddress.getByName(h);
                return !(a.isSiteLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress());
            } catch (Exception e) {
                return false;
            }
        }
        return true;
    }

    /** Recorded only when the host is outside our network AND an integrated vendor. */
    static boolean recorded(String host) {
        return external(host) && IntegratedVendors.isIntegrated(host);
    }

    static String operation(String method, String path) {
        StringBuilder op = new StringBuilder(method == null ? "GET" : method).append(" /");
        int taken = 0;
        for (String seg : (path == null ? "" : path).split("/")) {
            if (seg.isBlank()) continue;
            if (taken++ == 2) break;
            if (taken > 1) op.append('/');
            op.append(seg);
        }
        return op.length() > 64 ? op.substring(0, 64) : op.toString();
    }

    /** A body as JSON safe to keep: redacted JSON, or {"text": ...} for anything else. */
    static String bodySummary(byte[] body) {
        if (body == null || body.length == 0) return null;
        String text = new String(body, StandardCharsets.UTF_8).trim();
        if (text.isEmpty()) return null;
        try {
            Object tree = JSON.readValue(text, Object.class);
            String out = JSON.writeValueAsString(hide(REDACTOR.redact(tree), 0));
            return out.length() <= MAX_BODY_CHARS ? out
                    : JSON.writeValueAsString(Map.of("truncated_json", out.substring(0, MAX_BODY_CHARS)));
        } catch (Exception notJson) {
            try {
                String cut = text.length() <= MAX_BODY_CHARS ? text : text.substring(0, MAX_BODY_CHARS);
                return JSON.writeValueAsString(Map.of("text", cut.replaceAll(
                        "(?i)(key|token|secret|authorization|bearer|password)[\\s:=\"']+(?:bearer\\s+)?[^\\s,;\"'&]+",
                        "$1=<hidden>")));
            } catch (Exception e) {
                return null;
            }
        }
    }

    /** Field names that hold a credential or a person's details, however a vendor spells them. */
    private static final java.util.regex.Pattern SECRET_KEY = java.util.regex.Pattern.compile(
            "(?i)(api[_-]?key|key|token|secret|password|passwd|authorization|auth|signature|otp|phone|mobile"
                    + "|msisdn|email|card|cvv|account_number|ifsc)");
    private static final String SECRETISH =
            "(?i)(key|token|secret|authorization|bearer|password)[\\s:=\"']+(?:bearer\\s+)?[^\\s,;\"'&]+";

    /**
     * Second pass after the shared redactor, which matches exact names only: any field whose name
     * looks like a credential or personal detail is hidden, and long strings are cut.
     */
    @SuppressWarnings("unchecked")
    static Object hide(Object value, int depth) {
        if (depth > 8) return "…";
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> out = new LinkedHashMap<>();
            map.forEach((k, v) -> out.put(String.valueOf(k),
                    SECRET_KEY.matcher(String.valueOf(k)).find() ? "<hidden>" : hide(v, depth + 1)));
            return out;
        }
        if (value instanceof List<?> list) {
            List<Object> out = new ArrayList<>();
            for (int i = 0; i < Math.min(list.size(), 50); i++) out.add(hide(list.get(i), depth + 1));
            return out;
        }
        if (value instanceof String str) {
            String v = str.replaceAll(SECRETISH, "$1=<hidden>");
            return v.length() <= 500 ? v : v.substring(0, 500) + "… (" + v.length() + " chars)";
        }
        return value;
    }

    static String requestSummary(HttpRequest request, byte[] body) {
        try {
            Map<String, Object> out = new LinkedHashMap<>();
            URI uri = request.getURI();
            out.put("method", request.getMethod().name());
            out.put("path", uri.getPath());
            if (uri.getRawQuery() != null && !uri.getRawQuery().isBlank()) {
                TreeSet<String> names = new TreeSet<>();
                for (String pair : uri.getRawQuery().split("&")) {
                    if (!pair.isBlank()) names.add(pair.split("=", 2)[0]);
                }
                out.put("query_params", names);
            }
            String b = bodySummary(body);
            if (b != null) out.put("body", JSON.readTree(b));
            return JSON.writeValueAsString(out);
        } catch (Exception e) {
            return null;
        }
    }

    static String responseSummary(Integer status, String reason, byte[] body) {
        try {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("status", status);
            if (reason != null) out.put("reason", reason);
            String b = bodySummary(body);
            if (b != null) out.put("body", JSON.readTree(b));
            return JSON.writeValueAsString(out);
        } catch (Exception e) {
            return null;
        }
    }

    void failed(URI uri, String method, Integer status, String reason, String request, String response) {
        if (uri == null || !recorded(uri.getHost())) return;
        Timestamp at = Timestamp.from(Instant.now());
        String vendor = uri.getHost().toLowerCase(Locale.ROOT);
        String op = operation(method, uri.getPath());
        writer.execute(() -> {
            try {
                jdbc.update("""
                        INSERT INTO external_api_call_log
                            (occurred_at, vendor, source_service, operation, status, http_status, error_message,
                             request_summary, response_summary)
                        VALUES (?, ?, ?, ?, 'FAILED', ?, ?, CAST(? AS jsonb), CAST(? AS jsonb))""",
                        at, vendor, SOURCE_SERVICE, op, status, reason, request, response);
            } catch (Exception e) {
                log.debug("external call failure not recorded: {}", e.getClass().getSimpleName());
            }
        });
    }

    static final class Interceptor implements ClientHttpRequestInterceptor {
        @Override
        public ClientHttpResponse intercept(HttpRequest request, byte[] body, ClientHttpRequestExecution execution)
                throws IOException {
            ExternalCallLog sink = instance;
            boolean watch = sink != null && recorded(request.getURI().getHost());
            ClientHttpResponse response;
            try {
                response = execution.execute(request, body);
            } catch (IOException | RuntimeException e) {
                if (watch) {
                    sink.failed(request.getURI(), request.getMethod().name(), null, e.getClass().getSimpleName(),
                            requestSummary(request, body), null);
                }
                throw e;
            }
            if (!watch) return response;
            try {
                int status = response.getStatusCode().value();
                if (status < 400) return response;
                // Read the error body once, keep a redacted copy, and hand the caller a replay of it.
                byte[] errorBody = response.getBody().readAllBytes();
                sink.failed(request.getURI(), request.getMethod().name(), status, null,
                        requestSummary(request, body), responseSummary(status, response.getStatusText(), errorBody));
                return new Replayed(response, errorBody);
            } catch (Exception ignored) {
                // Reading the status or body must never change what the caller gets.
                return response;
            }
        }
    }

    /** The original response with its body served from the bytes already read. */
    static final class Replayed implements ClientHttpResponse {
        private final ClientHttpResponse original;
        private final byte[] body;

        Replayed(ClientHttpResponse original, byte[] body) {
            this.original = original;
            this.body = body;
        }

        @Override
        public HttpStatusCode getStatusCode() throws IOException {
            return original.getStatusCode();
        }

        @Override
        public String getStatusText() throws IOException {
            return original.getStatusText();
        }

        @Override
        public HttpHeaders getHeaders() {
            return original.getHeaders();
        }

        @Override
        public InputStream getBody() {
            return new ByteArrayInputStream(body);
        }

        @Override
        public void close() {
            original.close();
        }
    }
}
