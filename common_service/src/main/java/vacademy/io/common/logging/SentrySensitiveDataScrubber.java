package vacademy.io.common.logging;

import io.sentry.EventProcessor;
import io.sentry.Hint;
import io.sentry.SentryBaseEvent;
import io.sentry.SentryEvent;
import io.sentry.protocol.Request;
import io.sentry.protocol.SentryTransaction;
import org.springframework.stereotype.Component;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Strips credentials from the HTTP request attached to every Sentry error and
 * transaction before it leaves the service.
 *
 * Every Java service runs with sentry.send-default-pii=true, under which the servlet
 * integration copies all request headers and cookies onto the event — JWTs, API keys and
 * the internal service secret included.
 *
 * Registered as an {@link EventProcessor} bean: sentry-spring-boot-starter-jakarta (7.15)
 * adds every such bean to SentryOptions, and SentryClient runs them after the scope's
 * request processor has attached the request and before beforeSend. An EventProcessor is
 * used rather than a BeforeSendCallback because the starter accepts any number of them
 * (it takes a single BeforeSendCallback) and it also sees transactions.
 */
@Component
public class SentrySensitiveDataScrubber implements EventProcessor {

    // Lowercase; header names are compared case-insensitively.
    private static final Set<String> SENSITIVE_HEADERS = Set.of(
            "x-api-key",
            "authorization",
            "proxy-authorization",
            "cookie",
            "set-cookie",
            "x-internal-service-token",
            "signature",
            "idempotency-key",
            "x-review-token");

    // Any header whose lowercased name contains one of these is dropped too, so shared
    // secrets such as X-Webhook-Secret, X-Webhook-Token and X-BBB-Secret are covered
    // without listing each one.
    private static final List<String> SENSITIVE_HEADER_FRAGMENTS = List.of(
            "token", "secret", "signature", "api-key", "apikey", "authorization", "cookie", "password");

    // Query parameters whose value is replaced with [Filtered] on every path: webhook and
    // callback URLs carry ?token=, signed links carry ?signature= / ?sig=.
    private static final Set<String> SENSITIVE_QUERY_PARAMS = Set.of(
            "key", "sig", "otp", "api_key", "apikey");
    private static final List<String> SENSITIVE_QUERY_PARAM_FRAGMENTS = List.of(
            "token", "secret", "signature", "password");

    static final String FILTERED = "[Filtered]";

    @Override
    public SentryEvent process(SentryEvent event, Hint hint) {
        scrub(event);
        return event;
    }

    @Override
    public SentryTransaction process(SentryTransaction transaction, Hint hint) {
        scrub(transaction);
        return transaction;
    }

    static void scrub(SentryBaseEvent event) {
        if (event == null || event.getRequest() == null) {
            return;
        }
        try {
            scrubRequest(event.getRequest());
        } catch (RuntimeException e) {
            // Sentry sends the event unchanged if a processor throws; drop the whole
            // request instead so a scrub failure can never leak a credential.
            event.setRequest(null);
        }
    }

    private static void scrubRequest(Request request) {
        request.setCookies(null);

        Map<String, String> headers = request.getHeaders();
        if (headers != null && !headers.isEmpty()) {
            Map<String, String> kept = new LinkedHashMap<>();
            headers.forEach((name, value) -> {
                if (name != null && !isSensitiveHeader(name)) {
                    kept.put(name, value);
                }
            });
            request.setHeaders(kept);
        }

        // Same rule as RequestTracingFilter: public /open/ endpoints keep their query
        // string out of Sentry, since it can carry partner identifiers and tokens; every
        // other path keeps it with secret-looking parameter values filtered.
        if (isOpenPath(request.getUrl())) {
            request.setQueryString(null);
        } else {
            request.setQueryString(redactQueryString(request.getQueryString()));
        }
    }

    static boolean isSensitiveHeader(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        if (SENSITIVE_HEADERS.contains(lower)) {
            return true;
        }
        for (String fragment : SENSITIVE_HEADER_FRAGMENTS) {
            if (lower.contains(fragment)) {
                return true;
            }
        }
        return false;
    }

    /**
     * The query string with the value of every secret-looking parameter replaced by
     * [Filtered]. Shared with RequestTracingFilter so logs and Sentry agree.
     */
    public static String redactQueryString(String queryString) {
        if (queryString == null || queryString.isEmpty()) {
            return queryString;
        }
        StringBuilder out = new StringBuilder(queryString.length());
        for (String pair : queryString.split("&", -1)) {
            if (out.length() > 0) {
                out.append('&');
            }
            int eq = pair.indexOf('=');
            String name = eq < 0 ? pair : pair.substring(0, eq);
            if (eq >= 0 && isSensitiveQueryParam(decode(name))) {
                out.append(name).append('=').append(FILTERED);
            } else {
                out.append(pair);
            }
        }
        return out.toString();
    }

    private static boolean isSensitiveQueryParam(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        if (SENSITIVE_QUERY_PARAMS.contains(lower)) {
            return true;
        }
        for (String fragment : SENSITIVE_QUERY_PARAM_FRAGMENTS) {
            if (lower.contains(fragment)) {
                return true;
            }
        }
        return false;
    }

    /**
     * True for a public /open/ path. Checked on the percent-decoded form as well, since
     * Spring routes /%6Fpen/ to the same handler as /open/.
     */
    public static boolean isOpenPath(String uriOrUrl) {
        if (uriOrUrl == null) {
            return false;
        }
        String decoded = decode(uriOrUrl).toLowerCase(Locale.ROOT);
        return decoded.contains("/open/") || decoded.endsWith("/open")
                || uriOrUrl.contains("/open/") || uriOrUrl.endsWith("/open");
    }

    private static String decode(String value) {
        try {
            // '+' is literal in a path; keep it so only %XX sequences are decoded.
            return URLDecoder.decode(value.replace("+", "%2B"), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return value;
        }
    }
}
