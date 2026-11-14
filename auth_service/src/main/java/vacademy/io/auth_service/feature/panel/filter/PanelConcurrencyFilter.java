package vacademy.io.auth_service.feature.panel.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;

import java.io.IOException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * Keeps panel traffic from taking the connections login and the health probes depend on. Panel
 * public calls share a small per-pod pool of permits, held for the whole request. A filter runs
 * outside the open-in-view interceptor, so a permit covers everything the request does with the
 * database. A caller that cannot get one within 100 ms is told BUSY with no database work, and
 * panels treat that like a network failure.
 *
 * <p>It stays at the default (late) filter order on purpose: the security chain has already added
 * CORS headers by then, so a browser can read the 429 body.
 */
@Component
public class PanelConcurrencyFilter extends OncePerRequestFilter {

    public static final String PUBLIC_PREFIX = "/auth-service/public/v1/panel/";

    private static final long WAIT_MS = 100;
    /** Far above any real panel body. Anything larger is refused before it is parsed. */
    private static final long MAX_BODY_BYTES = 8 * 1024;
    private static final String BUSY_BODY =
            "{\"code\":\"BUSY\",\"message\":\"Try again shortly\",\"retry_after_ms\":2000}";
    private static final String TOO_LARGE_BODY =
            "{\"code\":\"BAD_REQUEST\",\"message\":\"Request is too large\"}";

    private final Semaphore permits;

    public PanelConcurrencyFilter(PanelProperties properties) {
        this.permits = new Semaphore(properties.getPublicMaxConcurrent());
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !"POST".equals(request.getMethod()) || !routedPath(request).startsWith(PUBLIC_PREFIX);
    }

    /**
     * The path the dispatcher routes on: servlet path plus path info, which the container has
     * already decoded and normalised. The raw request URI is not used, because a percent-encoded
     * spelling of the prefix reaches the same controller.
     */
    static String routedPath(HttpServletRequest request) {
        String servletPath = request.getServletPath() == null ? "" : request.getServletPath();
        String pathInfo = request.getPathInfo();
        return pathInfo == null ? servletPath : servletPath + pathInfo;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getContentLengthLong() > MAX_BODY_BYTES) {
            write(response, HttpStatus.BAD_REQUEST, TOO_LARGE_BODY);
            return;
        }
        boolean acquired = false;
        try {
            acquired = permits.tryAcquire(WAIT_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        if (!acquired) {
            write(response, HttpStatus.TOO_MANY_REQUESTS, BUSY_BODY);
            return;
        }
        try {
            chain.doFilter(request, response);
        } finally {
            permits.release();
        }
    }

    private static void write(HttpServletResponse response, HttpStatus status, String body) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(body);
    }
}
