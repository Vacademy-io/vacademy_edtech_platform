package vacademy.io.common.tracing;

import io.sentry.Breadcrumb;
import io.sentry.ISpan;
import io.sentry.Sentry;
import io.sentry.SentryLevel;
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.web.util.OnCommittedResponseWrapper;
import org.springframework.stereotype.Component;
import vacademy.io.common.logging.SentrySensitiveDataScrubber;

import java.io.IOException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * A filter that automatically traces all HTTP requests and logs slow APIs.
 * This filter:
 * - Records request timing information
 * - Logs slow requests (configurable threshold)
 * - Adds breadcrumbs to Sentry for debugging
 * - Tags requests with useful metadata
 * 
 * Can be disabled via:
 * - vacademy.tracing.enabled=false (master toggle)
 * - vacademy.tracing.request-filter-enabled=false (individual toggle)
 * 
 * Add this filter to any Spring Boot service for automatic API latency
 * tracking.
 */
@Slf4j
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestTracingFilter implements Filter {

    /** How many committed responses could not carry Server-Timing (see helper below). */
    private static final AtomicLong serverTimingSkippedCount = new AtomicLong();

    /** Log the skip counter every Nth occurrence rather than per request. */
    private static final long SERVER_TIMING_SKIP_LOG_INTERVAL = 500;

    @Autowired
    private TracingProperties tracingProperties;

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        if (!(request instanceof HttpServletRequest httpRequest)
                || !(response instanceof HttpServletResponse httpResponse)) {
            chain.doFilter(request, response);
            return;
        }

        // The request id is a contract (it is in every public API error body and forwarded
        // on internal calls), not an observability extra, so it is bound even when the
        // tracing toggles below are off.
        String previousRequestId = MDC.get(RequestIds.MDC_KEY);
        String requestId = bindRequestId(httpRequest, httpResponse);
        try {
            if (!tracingProperties.isRequestFilterEffectivelyEnabled()) {
                chain.doFilter(request, response);
                return;
            }
            traceRequest(httpRequest, httpResponse, chain, requestId);
        } finally {
            // Pooled thread: never leave this request's id behind for the next one.
            if (previousRequestId != null) {
                MDC.put(RequestIds.MDC_KEY, previousRequestId);
            } else {
                MDC.remove(RequestIds.MDC_KEY);
            }
        }
    }

    /**
     * Accept a well-formed inbound {@code X-Request-Id} or mint one, then make it visible to
     * logs (MDC), to later filters and controllers (request attribute) and to the caller
     * (response header, set now while the response cannot have committed yet).
     */
    static String bindRequestId(HttpServletRequest request, HttpServletResponse response) {
        String requestId = RequestIds.acceptOrGenerate(request.getHeader(RequestIds.HEADER));
        request.setAttribute(RequestIds.ATTRIBUTE, requestId);
        MDC.put(RequestIds.MDC_KEY, requestId);
        try {
            if (!response.isCommitted()) {
                response.setHeader(RequestIds.HEADER, requestId);
            }
        } catch (Exception e) {
            // Observability must never break the response it is observing.
        }
        return requestId;
    }

    private void traceRequest(HttpServletRequest httpRequest, HttpServletResponse httpResponse, FilterChain chain,
            String requestId) throws IOException, ServletException {
        ServletRequest request = httpRequest;
        ServletResponse response = httpResponse;

        // Extract request info
        String method = httpRequest.getMethod();
        String uri = httpRequest.getRequestURI();
        String fullPath = loggablePath(uri, httpRequest.getQueryString());
        String clientIp = getClientIp(httpRequest);

        // Start timing
        long startTime = System.nanoTime();
        // Start attributing third-party wait separately, so a slow provider does not
        // read as us being slow. Cleared in the finally below — it is a ThreadLocal on
        // a pooled thread.
        ExternalCallTimer.begin();

        // Add start breadcrumb to Sentry
        addRequestStartBreadcrumb(method, fullPath, clientIp, requestId);

        // Tag the current Sentry span
        tagCurrentSpan(method, uri, clientIp);

        // Wrap the response so the header can be written at the moment it commits.
        // Setting it after chain.doFilter() does NOT work: Spring MVC flushes the
        // message converter's output, which commits the response before the
        // outermost filter regains control — measured, for a 2-byte body.
        ServerTimingResponseWrapper timingWrapper = createTimingWrapper(httpResponse, startTime);
        ServletResponse effectiveResponse = timingWrapper != null ? timingWrapper : response;

        try {
            // Execute the actual request
            chain.doFilter(request, effectiveResponse);
        } finally {
            // Calculate duration
            long durationNanos = System.nanoTime() - startTime;
            long durationMs = TimeUnit.NANOSECONDS.toMillis(durationNanos);

            // Tell the browser how much of the round trip was OUR processing, so the
            // client can subtract it and attribute the remainder to the network. This
            // is what lets us say "your connection is slow" instead of guessing when a
            // client reports "the LMS is slow".
            //
            // Normally the wrapper has already written this at commit time. This call
            // covers the rare response that never commits at all (e.g. an empty body),
            // and is a no-op if the header was already written.
            if (timingWrapper != null) {
                timingWrapper.writeServerTiming();
            } else {
                emitServerTimingHeader(httpResponse, uri, durationMs);
            }

            // Get response status
            int status = httpResponse.getStatus();

            // Log based on duration and status
            logRequestCompletion(method, fullPath, status, durationMs, clientIp, requestId);

            // Add completion breadcrumb to Sentry
            addRequestCompleteBreadcrumb(method, fullPath, status, durationMs);

            // Never leave the counter on a pooled thread.
            ExternalCallTimer.clear();
        }
    }

    /**
     * The path as it goes to logs, breadcrumbs and Sentry extras. Public `/open/` endpoints
     * can carry partner identifiers and tokens in the query string, so theirs is dropped;
     * elsewhere secret-looking parameters (?token=, ?signature=, ...) are filtered.
     */
    static String loggablePath(String uri, String queryString) {
        if (queryString == null || SentrySensitiveDataScrubber.isOpenPath(uri)) {
            return uri;
        }
        return uri + "?" + SentrySensitiveDataScrubber.redactQueryString(queryString);
    }

    /**
     * Build the response wrapper that stamps `Server-Timing` at commit time, or null
     * if the feature is off (or wrapping fails, which must never break the request).
     */
    private ServerTimingResponseWrapper createTimingWrapper(HttpServletResponse response, long startNanos) {
        try {
            if (!tracingProperties.isServerTimingHeaderEffectivelyEnabled()) {
                return null;
            }
            return new ServerTimingResponseWrapper(response, startNanos);
        } catch (Exception e) {
            log.debug("Could not wrap response for Server-Timing: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Writes `Server-Timing: app;dur=<ms>` at the last possible moment before the
     * response commits.
     *
     * WHY A WRAPPER IS NECESSARY — this was measured, not assumed. Setting the header
     * after chain.doFilter() returns does not work for ANY normal Spring MVC response,
     * not merely large ones: the message converter flushes its output, which commits
     * the response (headers and all) before the outermost filter regains control. A
     * 2-byte text/plain body was already committed. An earlier version of this filter
     * set the header in a `finally` block and was, in production, a silent no-op.
     *
     * OnCommittedResponseWrapper (Spring Security, already a direct dependency of
     * common_service) exists for exactly this: it intercepts the operations that would
     * commit a response — getOutputStream/getWriter writes, flushBuffer, sendError,
     * sendRedirect, reaching Content-Length — and calls onResponseCommitted() first,
     * while headers can still be set.
     *
     * For a streamed response (SSE, large download) the number recorded is therefore
     * time-to-first-byte rather than total duration. That is the more useful figure
     * anyway: the remainder is transfer time, not server work.
     */
    private static final class ServerTimingResponseWrapper extends OnCommittedResponseWrapper {

        private final long startNanos;
        private final AtomicBoolean written = new AtomicBoolean(false);

        private ServerTimingResponseWrapper(HttpServletResponse response, long startNanos) {
            super(response);
            this.startNanos = startNanos;
        }

        @Override
        protected void onResponseCommitted() {
            writeServerTiming();
            // Stop intercepting: the headers are set, and there is nothing further to
            // do on subsequent writes of a streamed body.
            disableOnResponseCommitted();
        }

        /** Idempotent — whichever of commit-time or the filter's finally runs first wins. */
        private void writeServerTiming() {
            if (!written.compareAndSet(false, true)) {
                return;
            }
            try {
                if (isCommitted()) {
                    serverTimingSkippedCount.incrementAndGet();
                    return;
                }
                long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
                setHeader("Server-Timing", buildServerTimingValue(durationMs));
                // Required for the value to be readable cross-origin via the Resource
                // Timing API; reading it off a fetch/axios response additionally needs
                // Access-Control-Expose-Headers, set in each service's CorsConfig.
                setHeader("Timing-Allow-Origin", "*");
            } catch (Exception e) {
                // Observability must never break the response it is observing.
            }
        }
    }

    /**
     * Build the header value, splitting our own compute from third-party wait:
     *
     *   Server-Timing: app;dur=95, ext;dur=2035
     *
     * `app` is what the browser judges us on, so it must exclude time spent waiting
     * on someone else's API (see {@link ExternalCallTimer}). `ext` is emitted only
     * when there was such a wait, so endpoints that call nobody keep a single clean
     * metric. Clamped at zero because the two clocks are read a moment apart and a
     * tiny negative would otherwise be possible.
     */
    private static String buildServerTimingValue(long durationMs) {
        long externalMs = ExternalCallTimer.elapsedMillis();
        if (externalMs <= 0) {
            return "app;dur=" + durationMs;
        }
        long appMs = Math.max(0, durationMs - externalMs);
        return "app;dur=" + appMs + ", ext;dur=" + externalMs;
    }

    /**
     * Fallback for when the response could not be wrapped at all. Kept because it is
     * still correct for an uncommitted response, but note that in practice a normal
     * Spring MVC response is ALREADY committed by the time this runs — see the wrapper
     * above. Absence of the header therefore means "could not annotate", never "the
     * server was fast".
     */
    private void emitServerTimingHeader(HttpServletResponse response, String uri, long durationMs) {
        try {
            if (!tracingProperties.isServerTimingHeaderEffectivelyEnabled()) {
                return;
            }

            // Already committed (large response, SSE stream, streamed download) — the
            // headers are gone. Count it so the size of the gap is observable.
            if (response.isCommitted()) {
                long skipped = serverTimingSkippedCount.incrementAndGet();
                if (skipped % SERVER_TIMING_SKIP_LOG_INTERVAL == 1) {
                    log.debug(
                            "Server-Timing skipped (response already committed) for {} — {} skipped so far",
                            truncatePath(uri), skipped);
                }
                return;
            }

            response.setHeader("Server-Timing", buildServerTimingValue(durationMs));
            response.setHeader("Timing-Allow-Origin", "*");
        } catch (Exception e) {
            // Observability must never break the response it is observing.
            log.debug("Failed to set Server-Timing header: {}", e.getMessage());
        }
    }

    /**
     * Extract client IP, handling proxies and load balancers
     */
    private String getClientIp(HttpServletRequest request) {
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isEmpty()) {
            // Take the first IP if there are multiple
            return xForwardedFor.split(",")[0].trim();
        }
        String xRealIp = request.getHeader("X-Real-IP");
        if (xRealIp != null && !xRealIp.isEmpty()) {
            return xRealIp;
        }
        return request.getRemoteAddr();
    }

    /**
     * Add request start breadcrumb for Sentry debugging
     */
    private void addRequestStartBreadcrumb(String method, String path, String clientIp, String requestId) {
        try {
            Breadcrumb breadcrumb = new Breadcrumb();
            breadcrumb.setCategory("http.request");
            breadcrumb.setLevel(SentryLevel.INFO);
            breadcrumb.setMessage(method + " " + path);
            breadcrumb.setData("client_ip", clientIp);
            breadcrumb.setData("request_id", requestId);
            breadcrumb.setData("phase", "start");
            Sentry.addBreadcrumb(breadcrumb);
        } catch (Exception e) {
            // Silently ignore Sentry errors to not affect the request
        }
    }

    /**
     * Add request completion breadcrumb with timing
     */
    private void addRequestCompleteBreadcrumb(String method, String path, int status, long durationMs) {
        try {
            Breadcrumb breadcrumb = new Breadcrumb();
            breadcrumb.setCategory("http.request");
            breadcrumb.setMessage(method + " " + path + " completed");
            breadcrumb.setData("status", status);
            breadcrumb.setData("duration_ms", durationMs);
            breadcrumb.setData("phase", "complete");

            // Set level based on duration and status
            if (status >= 500 || durationMs >= tracingProperties.getCriticalRequestThresholdMs()) {
                breadcrumb.setLevel(SentryLevel.ERROR);
            } else if (status >= 400 || durationMs >= tracingProperties.getSlowRequestThresholdMs()) {
                breadcrumb.setLevel(SentryLevel.WARNING);
            } else {
                breadcrumb.setLevel(SentryLevel.INFO);
            }

            Sentry.addBreadcrumb(breadcrumb);
        } catch (Exception e) {
            // Silently ignore Sentry errors
        }
    }

    /**
     * Tag the current Sentry span with request metadata
     */
    private void tagCurrentSpan(String method, String uri, String clientIp) {
        try {
            ISpan span = Sentry.getSpan();
            if (span != null) {
                span.setTag("http.method", method);
                span.setTag("http.url", uri);
                span.setTag("client.ip", clientIp);
            }
        } catch (Exception e) {
            // Silently ignore
        }
    }

    /**
     * Log request completion with appropriate log level based on duration
     */
    private void logRequestCompletion(String method, String path, int status, long durationMs, String clientIp,
            String requestId) {
        String logMessage = String.format(
                "%s %s | Status: %d | Duration: %dms | Client: %s | RequestId: %s",
                method, truncatePath(path), status, durationMs, clientIp, requestId);

        if (durationMs >= tracingProperties.getCriticalRequestThresholdMs()) {
            // Critical slowness - log as ERROR with full details
            log.error("🔴 CRITICAL SLOW REQUEST: {} | Consider investigating immediately!", logMessage);

            // Also capture in Sentry as a specific event
            captureSentrySlowRequestEvent(method, path, status, durationMs, "critical");

        } else if (durationMs >= tracingProperties.getSlowRequestThresholdMs()) {
            // Slow request - log as WARNING
            log.warn("🟡 SLOW REQUEST: {}", logMessage);

            // Capture in Sentry
            captureSentrySlowRequestEvent(method, path, status, durationMs, "warning");

        } else if (status >= 500) {
            // Server error
            log.error("🔴 SERVER ERROR: {}", logMessage);

        } else if (status >= 400) {
            // Client error - log at debug level (expected behavior)
            log.debug("🟠 CLIENT ERROR: {}", logMessage);

        } else {
            // Normal request
            log.debug("✅ {}", logMessage);
        }
    }

    /**
     * Capture slow request as a Sentry event for alerting
     */
    private void captureSentrySlowRequestEvent(String method, String path, int status, long durationMs,
            String severity) {
        try {
            Sentry.configureScope(scope -> {
                scope.setTag("slow_request", "true");
                scope.setTag("slow_request_severity", severity);
                scope.setExtra("request_duration_ms", String.valueOf(durationMs));
                scope.setExtra("request_method", method);
                scope.setExtra("request_path", path);
                scope.setExtra("response_status", String.valueOf(status));
            });
        } catch (Exception e) {
            // Silently ignore
        }
    }

    /**
     * Truncate long paths for logging (e.g., remove long query strings)
     */
    private String truncatePath(String path) {
        if (path == null)
            return "";
        if (path.length() <= 150)
            return path;
        return path.substring(0, 147) + "...";
    }

    @Override
    public void init(FilterConfig filterConfig) throws ServletException {
        log.info("RequestTracingFilter initialized - Enabled: {}, Slow threshold: {}ms, Critical threshold: {}ms",
                tracingProperties.isRequestFilterEffectivelyEnabled(),
                tracingProperties.getSlowRequestThresholdMs(),
                tracingProperties.getCriticalRequestThresholdMs());
    }

    @Override
    public void destroy() {
        log.info("RequestTracingFilter destroyed");
    }
}
