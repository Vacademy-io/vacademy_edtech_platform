package vacademy.io.common.external;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpRequest;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.ExchangeFilterFunction;
import org.springframework.web.reactive.function.client.ExchangeFunction;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import vacademy.io.common.logging.PayloadRedactor;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Every FAILED call a Java service makes to an integrated third-party API, in admin-core's
 * {@code external_api_call_log}, with what we sent and what the vendor answered, so the platform
 * portal can show the failure and the reason for it.
 *
 * <p>One hook per kind of client, used where the client is built or the call is made:
 * <ul>
 *   <li>RestTemplate: {@link #attach(RestTemplate)}</li>
 *   <li>WebClient: {@link #attach(WebClient.Builder)}</li>
 *   <li>java.net.http.HttpClient: {@link #send} / {@link #sendAsync}</li>
 *   <li>a vendor SDK (Razorpay, Stripe, SES, Firebase): {@link #sdkFailure} in its catch block</li>
 * </ul>
 * {@code ExternalCallCoverageTest} in each service fails the build when a new client is built
 * without one of these, so a new integration cannot fail out of sight.
 *
 * <p>Only failures (a status of 400 or more, or no answer) and only integrated vendors
 * ({@link IntegratedVendors}): our own services, private addresses and any other site are
 * skipped. Bodies are kept after redaction (credentials, payment-instrument fields, phones,
 * emails, OTPs) and cut to 4,000 characters; headers and query values never. An error response is
 * read once and replayed, so the caller sees exactly what it would have. Rows go to the
 * {@link Sink} on one background thread with a bounded queue; when the queue is full the row is
 * dropped, so the caller never waits and never fails because of it.
 */
public final class ExternalCallLog {

    private static final Logger log = LoggerFactory.getLogger(ExternalCallLog.class);
    private static final List<String> OWN_SUFFIXES = List.of(".vacademy.io", ".svc", ".svc.cluster.local",
            ".internal", ".local");
    private static final int MAX_BODY_CHARS = 4000;
    private static final Interceptor INTERCEPTOR = new Interceptor();
    private static final ExchangeFilterFunction FILTER = new Filter();
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final PayloadRedactor REDACTOR = new PayloadRedactor(List.of(
            "phone", "phoneNumber", "phone_number", "mobile", "mobileNumber", "msisdn", "email", "otp",
            "to", "from", "caller", "callerId", "vpa", "upiId", "contact"));

    /** Field names that hold a credential or a person's details, however a vendor spells them. */
    private static final Pattern SECRET_KEY = Pattern.compile(
            "(?i)(api[_-]?key|key|token|secret|password|passwd|authorization|auth|signature|otp|phone|mobile"
                    + "|msisdn|email|card|cvv|account_number|ifsc)");
    private static final String SECRETISH =
            "(?i)(key|token|secret|authorization|bearer|password)[\\s:=\"']+(?:bearer\\s+)?[^\\s,;\"'&]+";

    /** One failed call, ready to store. {@code request} and {@code response} are JSON text. */
    public record Failure(Instant at, String vendor, String sourceService, String operation, Integer httpStatus,
                          String error, String request, String response) {
    }

    /** Where failures go: admin-core writes the table, every other service posts to admin-core. */
    public interface Sink {
        void write(Failure failure);
    }

    private static volatile Sink sink;
    private static volatile String sourceService = "unknown";
    private static final ThreadPoolExecutor WRITER = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(500), r -> {
                Thread t = new Thread(r, "external-call-log");
                t.setDaemon(true);
                return t;
            }, new ThreadPoolExecutor.DiscardPolicy());

    private ExternalCallLog() {
    }

    /** Called once at start-up by {@link ExternalCallLogInstaller}. */
    public static void install(Sink target, String source) {
        sourceService = source == null || source.isBlank() ? "unknown" : source;
        sink = target;
    }

    // ---- hooks --------------------------------------------------------------------------------

    /** Adds failure logging to a RestTemplate and returns it, for use where it is built. */
    public static RestTemplate attach(RestTemplate rest) {
        List<ClientHttpRequestInterceptor> list = new ArrayList<>(rest.getInterceptors());
        if (!list.contains(INTERCEPTOR)) {
            list.add(INTERCEPTOR);
            rest.setInterceptors(list);
        }
        return rest;
    }

    /** Adds failure logging to a WebClient builder and returns it, for use where it is built. */
    public static WebClient.Builder attach(WebClient.Builder builder) {
        return builder.filters(list -> {
            if (!list.contains(FILTER)) list.add(FILTER);
        });
    }

    /** Adds failure logging to a RestClient builder and returns it, for use where it is built. */
    public static org.springframework.web.client.RestClient.Builder attach(
            org.springframework.web.client.RestClient.Builder builder) {
        return builder.requestInterceptors(list -> {
            if (!list.contains(INTERCEPTOR)) list.add(INTERCEPTOR);
        });
    }

    /**
     * A call made with HttpURLConnection that failed: {@code status} null when there was no
     * answer, {@code error} the exception's name then. Pass the bytes already sent and read.
     */
    public static void connectionFailed(java.net.URL url, String method, Integer status, String error, byte[] sent,
            byte[] answered) {
        try {
            if (url == null || (status != null && status < 400 && error == null)) return;
            URI uri = url.toURI();
            failed(uri, method, status, error, requestSummary(method, uri, sent),
                    status == null ? null : responseSummary(status, null, answered));
        } catch (Exception e) {
            log.debug("connection failure not recorded: {}", e.getClass().getSimpleName());
        }
    }

    /**
     * {@code conn.getInputStream()} for an HttpURLConnection download (a call recording, a Drive
     * or Zoom file), recording the failure when it throws: the status and the vendor's error text.
     */
    public static InputStream openStream(java.net.URLConnection conn) throws IOException {
        try {
            return conn.getInputStream();
        } catch (IOException e) {
            Integer status = null;
            byte[] answered = null;
            String method = "GET";
            if (conn instanceof java.net.HttpURLConnection http) {
                method = http.getRequestMethod();
                try {
                    status = http.getResponseCode();
                    InputStream err = http.getErrorStream();
                    if (err != null) answered = err.readNBytes(MAX_BODY_CHARS * 2);
                } catch (IOException ignored) {
                    status = null;
                }
            }
            connectionFailed(conn.getURL(), method, status != null && status > 0 ? status : null,
                    status != null && status > 0 ? null : e.getClass().getSimpleName(), null, answered);
            throw e;
        }
    }

    /** {@code client.send(request, handler)}, with a failure recorded. */
    public static <T> java.net.http.HttpResponse<T> send(HttpClient client, java.net.http.HttpRequest request,
            java.net.http.HttpResponse.BodyHandler<T> handler) throws IOException, InterruptedException {
        return send(client, request, handler, null);
    }

    /** As {@link #send(HttpClient, java.net.http.HttpRequest, java.net.http.HttpResponse.BodyHandler)},
     *  keeping {@code sent} (the body the request publishes) as "what we sent". */
    public static <T> java.net.http.HttpResponse<T> send(HttpClient client, java.net.http.HttpRequest request,
            java.net.http.HttpResponse.BodyHandler<T> handler, byte[] sent) throws IOException, InterruptedException {
        java.net.http.HttpResponse<T> response;
        try {
            response = client.send(request, handler);
        } catch (IOException | RuntimeException e) {
            failed(request.uri(), request.method(), null, e.getClass().getSimpleName(),
                    requestSummary(request.method(), request.uri(), sent), null);
            throw e;
        }
        observe(request, response, sent);
        return response;
    }

    /** {@code client.sendAsync(request, handler)}, with a failure recorded. */
    public static <T> CompletableFuture<java.net.http.HttpResponse<T>> sendAsync(HttpClient client,
            java.net.http.HttpRequest request, java.net.http.HttpResponse.BodyHandler<T> handler) {
        return client.sendAsync(request, handler).whenComplete((response, error) -> {
            if (error != null) {
                Throwable cause = error.getCause() != null ? error.getCause() : error;
                failed(request.uri(), request.method(), null, cause.getClass().getSimpleName(),
                        requestSummary(request.method(), request.uri(), null), null);
            } else {
                observe(request, response, null);
            }
        });
    }

    private static void observe(java.net.http.HttpRequest request, java.net.http.HttpResponse<?> response,
            byte[] sent) {
        if (response == null || response.statusCode() < 400) return;
        Object body = response.body();
        byte[] bytes = body instanceof byte[] b ? b
                : body instanceof String s ? s.getBytes(StandardCharsets.UTF_8) : null;
        failed(request.uri(), request.method(), response.statusCode(), null,
                requestSummary(request.method(), request.uri(), sent),
                responseSummary(response.statusCode(), null, bytes));
    }

    /**
     * A vendor SDK call that failed (Razorpay, Stripe, SES, Firebase): call from its catch block.
     * {@code vendor} is a host from {@link IntegratedVendors} or one of its names. {@code request}
     * may be a Map, a JSON string or null; it is redacted like any body.
     */
    public static void sdkFailure(String vendor, String operation, Integer httpStatus, Throwable error,
            Object request) {
        try {
            if (!IntegratedVendors.isIntegrated(vendor)) return;
            String message = error == null ? null : error.getClass().getSimpleName()
                    + (error.getMessage() == null ? "" : ": " + error.getMessage());
            byte[] sent = request == null ? null
                    : request instanceof String s ? s.getBytes(StandardCharsets.UTF_8) : JSON.writeValueAsBytes(request);
            Map<String, Object> req = new LinkedHashMap<>();
            req.put("operation", operation);
            String b = bodySummary(sent);
            if (b != null) req.put("body", JSON.readTree(b));
            Map<String, Object> res = new LinkedHashMap<>();
            res.put("status", httpStatus);
            if (message != null) res.put("error", hide(message, 0));
            enqueue(new Failure(Instant.now(), vendor.toLowerCase(Locale.ROOT), sourceService, cut(operation, 64),
                    httpStatus, cut(message, 500), JSON.writeValueAsString(req), JSON.writeValueAsString(res)));
        } catch (Exception e) {
            log.debug("sdk failure not recorded: {}", e.getClass().getSimpleName());
        }
    }

    // ---- what counts and how it is described --------------------------------------------------

    public static boolean external(String host) {
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
    public static boolean recorded(String host) {
        return external(host) && IntegratedVendors.isIntegrated(host);
    }

    public static String operation(String method, String path) {
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
    public static String bodySummary(byte[] body) {
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
                Map<String, Object> form = formFields(text);
                if (form != null) {
                    String out = JSON.writeValueAsString(hide(REDACTOR.redact(form), 0));
                    return out.length() <= MAX_BODY_CHARS ? out
                            : JSON.writeValueAsString(Map.of("truncated_json", out.substring(0, MAX_BODY_CHARS)));
                }
                String cut = text.length() <= MAX_BODY_CHARS ? text : text.substring(0, MAX_BODY_CHARS);
                return JSON.writeValueAsString(Map.of("text", cut.replaceAll(SECRETISH, "$1=<hidden>")));
            } catch (Exception e) {
                return null;
            }
        }
    }

    private static final Pattern FORM = Pattern.compile("[A-Za-z0-9_.\\[\\]%-]+=[^&\\s]*(&[A-Za-z0-9_.\\[\\]%-]+=[^&\\s]*)*");

    /**
     * A form-encoded body (Stripe, Plivo, Exotel) as field -> value, so the same field-name rules
     * hide emails, phone numbers and card fields; null when the text is not a form.
     */
    static Map<String, Object> formFields(String text) {
        if (!FORM.matcher(text).matches()) return null;
        Map<String, Object> out = new LinkedHashMap<>();
        for (String pair : text.split("&")) {
            String[] kv = pair.split("=", 2);
            String key = java.net.URLDecoder.decode(kv[0], StandardCharsets.UTF_8);
            String value = kv.length > 1 ? java.net.URLDecoder.decode(kv[1], StandardCharsets.UTF_8) : "";
            out.put(key, value);
        }
        return out;
    }

    /**
     * Second pass after the shared redactor, which matches exact names only: any field whose name
     * looks like a credential or personal detail is hidden, and long strings are cut.
     */
    public static Object hide(Object value, int depth) {
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

    public static String requestSummary(String method, URI uri, byte[] body) {
        try {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("method", method);
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

    public static String responseSummary(Integer status, String reason, byte[] body) {
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

    static void failed(URI uri, String method, Integer status, String reason, String request, String response) {
        if (uri == null || !recorded(uri.getHost())) return;
        enqueue(new Failure(Instant.now(), uri.getHost().toLowerCase(Locale.ROOT), sourceService,
                operation(method, uri.getPath()), status, reason, request, response));
    }

    private static void enqueue(Failure failure) {
        Sink target = sink;
        if (target == null) return;
        WRITER.execute(() -> {
            try {
                target.write(failure);
            } catch (Exception e) {
                log.debug("external call failure not recorded: {}", e.getClass().getSimpleName());
            }
        });
    }

    private static String cut(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }

    // ---- RestTemplate -------------------------------------------------------------------------

    static final class Interceptor implements ClientHttpRequestInterceptor {
        @Override
        public ClientHttpResponse intercept(HttpRequest request, byte[] body, ClientHttpRequestExecution execution)
                throws IOException {
            boolean watch = recorded(request.getURI().getHost());
            ClientHttpResponse response;
            try {
                response = execution.execute(request, body);
            } catch (IOException | RuntimeException e) {
                if (watch) {
                    failed(request.getURI(), request.getMethod().name(), null, e.getClass().getSimpleName(),
                            requestSummary(request.getMethod().name(), request.getURI(), body), null);
                }
                throw e;
            }
            if (!watch) return response;
            try {
                int status = response.getStatusCode().value();
                if (status < 400) return response;
                // Read the error body once, keep a redacted copy, and hand the caller a replay of it.
                byte[] errorBody = response.getBody().readAllBytes();
                failed(request.getURI(), request.getMethod().name(), status, null,
                        requestSummary(request.getMethod().name(), request.getURI(), body),
                        responseSummary(status, response.getStatusText(), errorBody));
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

    // ---- WebClient ----------------------------------------------------------------------------

    /**
     * WebClient does not expose the body it sends, so a WebClient failure keeps the method, path
     * and query parameter names as "what we sent", and the vendor's whole error answer.
     */
    static final class Filter implements ExchangeFilterFunction {
        @Override
        public Mono<ClientResponse> filter(ClientRequest request, ExchangeFunction next) {
            URI uri = request.url();
            if (!recorded(uri.getHost())) return next.exchange(request);
            String method = request.method().name();
            return next.exchange(request)
                    .doOnError(e -> failed(uri, method, null, e.getClass().getSimpleName(),
                            requestSummary(method, uri, null), null))
                    .flatMap(response -> {
                        int status = response.statusCode().value();
                        if (status < 400) return Mono.just(response);
                        return response.bodyToMono(String.class).defaultIfEmpty("").map(text -> {
                            failed(uri, method, status, null, requestSummary(method, uri, null),
                                    responseSummary(status, null, text.getBytes(StandardCharsets.UTF_8)));
                            return response.mutate().body(text).build();
                        });
                    });
        }
    }
}
