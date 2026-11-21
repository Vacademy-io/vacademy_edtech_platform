package vacademy.io.common.tracing;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.MDC;

import java.util.UUID;
import java.util.regex.Pattern;

/**
 * One id per request, shared by logs, error bodies and downstream internal calls.
 *
 * <p>{@link RequestTracingFilter} resolves it first thing (accepting a well-formed inbound
 * {@code X-Request-Id}, otherwise minting one), stores it in the MDC under {@link #MDC_KEY}
 * and as a request attribute, and echoes it on the response. {@code InternalClientUtils}
 * forwards it, so one partner call can be followed across services, and
 * {@link MdcTaskDecorator} carries it into {@code @Async} work.
 */
public final class RequestIds {

    public static final String HEADER = "X-Request-Id";
    public static final String MDC_KEY = "requestId";
    public static final String ATTRIBUTE = RequestIds.class.getName() + ".id";

    /**
     * What an inbound id may look like. Anything else is replaced, never echoed: the value
     * goes into response headers and log lines, so CR/LF or markup must not get through.
     */
    private static final Pattern ACCEPTED = Pattern.compile("^[A-Za-z0-9._:-]{1,128}$");

    private RequestIds() {
    }

    /** A new id such as {@code req_3f2a...} (32 hex characters after the prefix). */
    public static String generate() {
        return "req_" + UUID.randomUUID().toString().replace("-", "");
    }

    /** The inbound value when it is safe to reuse, otherwise a fresh id. */
    public static String acceptOrGenerate(String inbound) {
        if (inbound != null) {
            String trimmed = inbound.trim();
            if (ACCEPTED.matcher(trimmed).matches()) {
                return trimmed;
            }
        }
        return generate();
    }

    /** The id of the request this thread is working on, or null outside a request. */
    public static String current() {
        return MDC.get(MDC_KEY);
    }

    /**
     * The id for this request: the one {@link RequestTracingFilter} stored, else the MDC
     * value, else a well-formed inbound header, else a new one (stored on the request so
     * every later caller sees the same value).
     */
    public static String resolve(HttpServletRequest request) {
        if (request != null) {
            Object stored = request.getAttribute(ATTRIBUTE);
            if (stored instanceof String s && !s.isEmpty()) {
                return s;
            }
        }
        String fromMdc = current();
        if (fromMdc != null && !fromMdc.isEmpty()) {
            return fromMdc;
        }
        String id = acceptOrGenerate(request != null ? request.getHeader(HEADER) : null);
        if (request != null) {
            request.setAttribute(ATTRIBUTE, id);
        }
        return id;
    }
}
