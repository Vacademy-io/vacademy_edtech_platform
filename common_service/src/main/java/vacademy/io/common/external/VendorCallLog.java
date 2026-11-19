package vacademy.io.common.external;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClientResponseException;
import vacademy.io.common.logging.PayloadRedactor;

import java.lang.reflect.Method;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

/**
 * Records a FAILED call to an integrated third-party API (Plivo, Razorpay, WATI, OpenRouter...)
 * in admin-core's {@code external_api_call_log}, with what we sent and what the vendor answered,
 * so the platform portal shows the failure and its reason.
 *
 * <p>Called explicitly from the vendor client's own error handling, after the failure:
 * <pre>{@code
 * try {
 *     return rest.postForObject(url, request, String.class);
 * } catch (RestClientException e) {
 *     VendorCallLog.failed("api.plivo.com", "make call", request, e);
 *     throw e;
 * }
 * }</pre>
 * For a client that does not throw on an error status (java.net.http.HttpClient, a RestTemplate
 * with a lenient error handler) pass the status and the body instead:
 * {@link #failed(String, String, Object, int, Object)}.
 *
 * <p>It never changes the call: nothing is intercepted, buffered or replayed, it never throws,
 * and the caller never waits. The row is built and handed to one background thread; when its
 * queue is full, or more than {@value #MAX_PER_SECOND} failures a second arrive (a vendor that
 * is down), the extra rows are dropped.
 *
 * <p>Only integrated vendors ({@link IntegratedVendors}) are recorded. Bodies are redacted
 * (credentials, payment-instrument fields, phones, emails, OTPs) and cut to 4,000 characters;
 * a body over 64 KB or a file upload is not kept at all, only its size. Headers and query
 * values are never kept.
 */
public final class VendorCallLog {

    private static final Logger log = LoggerFactory.getLogger(VendorCallLog.class);

    static final int MAX_PER_SECOND = 20;
    private static final int MAX_BODY_CHARS = 4000;
    private static final int MAX_BODY_BYTES = 64 * 1024;
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
    private static final Pattern EMAIL = Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");
    private static final Pattern LONG_NUMBER = Pattern.compile("\\+?\\d[\\d -]{8,}\\d");
    private static final Pattern FORM =
            Pattern.compile("[A-Za-z0-9_.\\[\\]%-]+=[^&\\s]*(&[A-Za-z0-9_.\\[\\]%-]+=[^&\\s]*)*");

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
    private static final AtomicLong windowSecond = new AtomicLong();
    private static final AtomicInteger inWindow = new AtomicInteger();
    private static final ThreadPoolExecutor WRITER = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(500), r -> {
                Thread t = new Thread(r, "vendor-call-log");
                t.setDaemon(true);
                return t;
            }, new ThreadPoolExecutor.DiscardPolicy());

    private VendorCallLog() {
    }

    /** Called once at start-up by {@link VendorCallLogInstaller}. */
    public static void install(Sink target, String source) {
        sourceService = source == null || source.isBlank() ? "unknown" : source;
        sink = target;
    }

    // ---- what call sites use ------------------------------------------------------------------

    /**
     * A vendor call that threw. The status and the vendor's answer are read from the exception
     * when it carries them (RestTemplate/RestClient and WebClient errors, Stripe, AWS); a timeout
     * or refused connection is recorded with no status.
     *
     * @param vendor    the vendor's host ("api.plivo.com"), a URL on it, or a name from
     *                  {@link IntegratedVendors#NAMES}
     * @param operation what we asked for, in a few words ("make call", "create order")
     * @param request   what we sent: a Map, DTO, JSON or form string, byte[], HttpEntity, or null
     * @param error     what the call threw
     */
    public static void failed(String vendor, String operation, Object request, Throwable error) {
        try {
            String host = vendorOf(vendor);
            if (!IntegratedVendors.isIntegrated(host) || !admit()) return;
            Integer status = statusOf(error);
            byte[] answer = answerOf(error);
            String reason = error == null ? null : clean(describe(error), 500);
            enqueue(new Failure(Instant.now(), host, sourceService, clean(operation, 64), status, reason,
                    requestJson(request), responseJson(status, answer, reason)));
        } catch (Exception e) {
            log.debug("vendor failure not recorded: {}", e.getClass().getSimpleName());
        }
    }

    /**
     * A vendor call that answered with an error status without throwing.
     * {@code response} is the body: a String, byte[] or anything Jackson can write.
     */
    public static void failed(String vendor, String operation, Object request, int status, Object response) {
        try {
            if (status < 400) return;
            String host = vendorOf(vendor);
            if (!IntegratedVendors.isIntegrated(host) || !admit()) return;
            enqueue(new Failure(Instant.now(), host, sourceService, clean(operation, 64), status, null,
                    requestJson(request), responseJson(status, bytesOf(response), null)));
        } catch (Exception e) {
            log.debug("vendor failure not recorded: {}", e.getClass().getSimpleName());
        }
    }

    // ---- reading the failure ------------------------------------------------------------------

    /** "https://api.plivo.com/v1/..." or "api.plivo.com" -> "api.plivo.com". */
    static String vendorOf(String vendor) {
        if (vendor == null) return "";
        String v = vendor.trim();
        if (v.contains("://")) {
            try {
                String host = URI.create(v).getHost();
                return host == null ? "" : host.toLowerCase(Locale.ROOT);
            } catch (Exception e) {
                return "";
            }
        }
        return v.toLowerCase(Locale.ROOT);
    }

    /** The HTTP status the exception (or one it wraps) carries, or null when there was no answer. */
    static Integer statusOf(Throwable error) {
        for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof RestClientResponseException r) return r.getStatusCode().value();
            Integer s = reflectStatus(t);
            if (s != null) return s;
        }
        return null;
    }

    /** The vendor's answer the exception (or one it wraps) carries. */
    static byte[] answerOf(Throwable error) {
        for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof RestClientResponseException r) return r.getResponseBodyAsByteArray();
            byte[] b = reflectBody(t);
            if (b != null) return b;
        }
        return null;
    }

    /**
     * WebClientResponseException (in spring-webflux), Stripe's and AWS's exceptions expose the
     * status as getStatusCode(); read it without depending on those libraries.
     */
    private static Integer reflectStatus(Throwable t) {
        try {
            Method m = t.getClass().getMethod("getStatusCode");
            Object v = m.invoke(t);
            if (v instanceof Integer i) return i > 0 ? i : null;
            if (v instanceof org.springframework.http.HttpStatusCode c) return c.value();
        } catch (Exception ignored) {
            // not an exception that carries a status
        }
        return null;
    }

    private static byte[] reflectBody(Throwable t) {
        try {
            Object v = t.getClass().getMethod("getResponseBodyAsByteArray").invoke(t);
            return v instanceof byte[] b ? b : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String describe(Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        String name = error.getClass().getSimpleName();
        String msg = error.getMessage();
        if (root != error) {
            name = name + " (" + root.getClass().getSimpleName() + ")";
            if (msg == null) msg = root.getMessage();
        }
        return msg == null ? name : name + ": " + msg;
    }

    // ---- describing it safely -----------------------------------------------------------------

    static String requestJson(Object request) {
        try {
            Map<String, Object> out = new LinkedHashMap<>();
            Object body = request instanceof HttpEntity<?> e ? e.getBody() : request;
            Object summary = bodySummary(body);
            if (summary != null) out.put("body", summary);
            return out.isEmpty() ? null : JSON.writeValueAsString(out);
        } catch (Exception e) {
            return null;
        }
    }

    static String responseJson(Integer status, byte[] answer, String reason) {
        try {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("status", status);
            if (reason != null) out.put("error", reason);
            Object summary = bodySummary(answer);
            if (summary != null) out.put("body", summary);
            return JSON.writeValueAsString(out);
        } catch (Exception e) {
            return null;
        }
    }

    /** A body as something safe to keep: redacted JSON, form fields, or short text. */
    static Object bodySummary(Object body) throws Exception {
        if (body == null) return null;
        if (body instanceof MultiValueMap<?, ?> form) {
            if (hasFile(form)) return Map.of("omitted", "file upload");
            Map<String, Object> flat = new LinkedHashMap<>();
            form.forEach((k, v) -> flat.put(String.valueOf(k), v == null || v.size() != 1 ? v : v.get(0)));
            return hide(REDACTOR.redact(flat), 0);
        }
        if (body instanceof Resource) return Map.of("omitted", "file upload");
        byte[] bytes = bytesOf(body);
        if (bytes == null || bytes.length == 0) return null;
        if (bytes.length > MAX_BODY_BYTES) return Map.of("omitted", bytes.length + " bytes");
        String text = new String(bytes, StandardCharsets.UTF_8).trim();
        if (text.isEmpty()) return null;
        if (text.startsWith("--") && text.contains("Content-Disposition")) return Map.of("omitted", "file upload");
        Object kept;
        try {
            kept = hide(REDACTOR.redact(JSON.readValue(text, Object.class)), 0);
        } catch (Exception notJson) {
            Map<String, Object> fields = formFields(text);
            kept = fields != null ? hide(REDACTOR.redact(fields), 0)
                    : Map.of("text", clean(text, MAX_BODY_CHARS));
        }
        String out = JSON.writeValueAsString(kept);
        return out.length() <= MAX_BODY_CHARS ? kept : Map.of("truncated", out.substring(0, MAX_BODY_CHARS));
    }

    private static boolean hasFile(MultiValueMap<?, ?> form) {
        for (List<?> values : form.values()) {
            if (values == null) continue;
            for (Object v : values) {
                Object b = v instanceof HttpEntity<?> e ? e.getBody() : v;
                if (b instanceof Resource || b instanceof byte[]) return true;
            }
        }
        return false;
    }

    private static byte[] bytesOf(Object body) throws Exception {
        if (body == null) return null;
        if (body instanceof byte[] b) return b;
        if (body instanceof String s) return s.getBytes(StandardCharsets.UTF_8);
        return JSON.writeValueAsBytes(body);
    }

    /** A form-encoded body (Stripe, Plivo, Exotel) as field -> value; null when it is not a form. */
    static Map<String, Object> formFields(String text) {
        if (!FORM.matcher(text).matches()) return null;
        Map<String, Object> out = new LinkedHashMap<>();
        for (String pair : text.split("&")) {
            String[] kv = pair.split("=", 2);
            out.put(java.net.URLDecoder.decode(kv[0], StandardCharsets.UTF_8),
                    kv.length > 1 ? java.net.URLDecoder.decode(kv[1], StandardCharsets.UTF_8) : "");
        }
        return out;
    }

    /**
     * Second pass after the shared redactor, which matches exact names only: any field whose name
     * looks like a credential or personal detail is hidden, and long strings are cut.
     */
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
        if (value instanceof String s) return clean(s, 500);
        return value;
    }

    /** Free text with credentials, emails and phone-like numbers hidden, cut to {@code max}. */
    static String clean(String s, int max) {
        if (s == null) return null;
        String v = s.replaceAll(SECRETISH, "$1=<hidden>");
        v = EMAIL.matcher(v).replaceAll("<email>");
        v = LONG_NUMBER.matcher(v).replaceAll("<number>");
        return v.length() <= max ? v : v.substring(0, max) + "…";
    }

    // ---- writing it ---------------------------------------------------------------------------

    /** At most MAX_PER_SECOND rows a second, so a vendor outage cannot flood admin-core. */
    private static boolean admit() {
        long now = System.currentTimeMillis() / 1000;
        long window = windowSecond.get();
        if (window != now && windowSecond.compareAndSet(window, now)) inWindow.set(0);
        return inWindow.incrementAndGet() <= MAX_PER_SECOND;
    }

    /** Tests only: start a fresh one-second window. */
    static void resetRate() {
        windowSecond.set(System.currentTimeMillis() / 1000);
        inWindow.set(0);
    }

    private static void enqueue(Failure failure) {
        Sink target = sink;
        if (target == null) return;
        WRITER.execute(() -> {
            try {
                target.write(failure);
            } catch (Exception e) {
                log.debug("vendor failure not recorded: {}", e.getClass().getSimpleName());
            }
        });
    }
}
