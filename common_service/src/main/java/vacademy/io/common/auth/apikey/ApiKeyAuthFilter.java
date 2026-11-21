package vacademy.io.common.auth.apikey;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UriUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * Authenticates institute API keys ({@code X-API-Key}) on public partner paths.
 *
 * <p><b>Not a {@code @Component}</b>, on purpose: a Filter bean is auto-registered by Spring
 * Boot on the servlet container for every path, outside the security chain. Construct it in
 * the service's security config and add it to the chain only, e.g.
 * <pre>
 * http.addFilterBefore(new ApiKeyAuthFilter(verifier, ApiKeyAuthFilter.Settings.builder()
 *         .pathPrefixes(List.of("/assessment-service/open/"))
 *         .requiredKeyPathPrefixes(List.of("/assessment-service/open/evaluation/v1/"))
 *         .exemptPaths(Set.of("/assessment-service/open/evaluation/v1/openapi.json"))
 *         .requiredProduct("evaluation")
 *         .build()), AssessmentJwtAuthFilter.class);
 * </pre>
 * and authorize those paths with {@code auth instanceof ApiKeyAuthentication}.
 *
 * <p>Behaviour:
 * <ul>
 *   <li>Path outside {@code pathPrefixes}, or in {@code exemptPaths}: untouched.</li>
 *   <li>No key: untouched, except under {@code requiredKeyPathPrefixes} where it is
 *       401 {@code missing_api_key}. (Other {@code /open/} endpoints keep working.)</li>
 *   <li>Malformed, unknown, revoked or expired key: 401 {@code invalid_api_key}. One code for
 *       all four so a caller cannot tell which.</li>
 *   <li>Key valid but the institute's product access is off, or the key is not for the
 *       product: 403 {@code product_not_enabled}.</li>
 *   <li>Key store unreachable and key not cached: 503 {@code auth_unavailable}.</li>
 *   <li>Otherwise an {@link ApiKeyAuthentication} is placed in the SecurityContext for the
 *       rest of the chain.</li>
 * </ul>
 * Error bodies use the public API envelope ({@link ApiErrorWriter}) and carry the request id.
 * The key itself is never logged; only the key id is, and it goes into the MDC as
 * {@value #MDC_KEY_ID} while the request runs.
 */
@Slf4j
public class ApiKeyAuthFilter extends OncePerRequestFilter {

    public static final String MDC_KEY_ID = "apiKeyId";

    /** Request attribute holding the {@link ApiKeyPrincipal} once authenticated. */
    public static final String PRINCIPAL_ATTRIBUTE = ApiKeyAuthFilter.class.getName() + ".principal";

    private final ApiKeyVerifier verifier;
    private final Settings settings;

    public ApiKeyAuthFilter(ApiKeyVerifier verifier, Settings settings) {
        this.verifier = Objects.requireNonNull(verifier, "verifier");
        this.settings = Objects.requireNonNull(settings, "settings");
        if (settings.pathPrefixes.isEmpty()) {
            throw new IllegalArgumentException("ApiKeyAuthFilter needs at least one path prefix");
        }
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        String rawPath = request.getRequestURI();
        String decodedPath = decode(rawPath);
        if (!startsWithAny(rawPath, decodedPath, settings.pathPrefixes)
                || settings.exemptPaths.contains(rawPath) || settings.exemptPaths.contains(decodedPath)) {
            chain.doFilter(request, response);
            return;
        }

        String key = request.getHeader(ApiKeyFormat.HEADER);
        if (key == null || key.isBlank()) {
            if (startsWithAny(rawPath, decodedPath, settings.requiredKeyPathPrefixes)) {
                ApiErrorWriter.write(request, response, HttpServletResponse.SC_UNAUTHORIZED,
                        ApiErrorWriter.MISSING_API_KEY, "Send your API key in the X-API-Key header.", null);
                return;
            }
            chain.doFilter(request, response);
            return;
        }

        key = key.trim();
        if (!ApiKeyFormat.isWellFormed(key)) {
            rejectInvalid(request, response);
            return;
        }

        Optional<ApiKeyPrincipal> resolved;
        try {
            resolved = verifier.verify(ApiKeyFormat.sha256Hex(key));
        } catch (ApiKeyVerifierUnavailableException e) {
            log.warn("API key verification unavailable (prefix {}): {}", ApiKeyFormat.displayPrefix(key),
                    e.getMessage());
            rejectUnavailable(request, response);
            return;
        } catch (RuntimeException e) {
            // A verifier bug must not turn into "unknown key" (401) or a raw 500 page.
            log.error("API key verifier failed (prefix {})", ApiKeyFormat.displayPrefix(key), e);
            rejectUnavailable(request, response);
            return;
        }

        if (resolved.isEmpty()) {
            rejectInvalid(request, response);
            return;
        }
        ApiKeyPrincipal principal = resolved.get();
        // Re-checked here, not only at the source: a cached principal must not outlive its
        // expiry or a revocation that the cache has already picked up.
        if (!principal.isActive() || principal.isExpired(settings.clock.instant())) {
            rejectInvalid(request, response);
            return;
        }
        if (settings.requiredProduct != null
                && (!principal.isAccessEnabled() || !principal.hasProduct(settings.requiredProduct))) {
            ApiErrorWriter.write(request, response, HttpServletResponse.SC_FORBIDDEN,
                    ApiErrorWriter.PRODUCT_NOT_ENABLED,
                    "The " + settings.requiredProduct + " API is not enabled for this institute. Contact Vacademy to enable it.",
                    null);
            return;
        }

        ApiKeyAuthentication authentication = new ApiKeyAuthentication(principal);
        SecurityContext previous = SecurityContextHolder.getContext();
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        request.setAttribute(PRINCIPAL_ATTRIBUTE, principal);
        String previousKeyId = MDC.get(MDC_KEY_ID);
        MDC.put(MDC_KEY_ID, String.valueOf(principal.getKeyId()));
        try {
            chain.doFilter(request, response);
        } finally {
            if (previousKeyId != null) {
                MDC.put(MDC_KEY_ID, previousKeyId);
            } else {
                MDC.remove(MDC_KEY_ID);
            }
            // Leave nothing of this key on a pooled thread. Inside the security chain
            // SecurityContextHolderFilter also clears; this covers any other placement.
            Authentication current = SecurityContextHolder.getContext().getAuthentication();
            if (current == authentication) {
                SecurityContextHolder.setContext(previous);
            }
        }
    }

    private void rejectInvalid(HttpServletRequest request, HttpServletResponse response) throws IOException {
        ApiErrorWriter.write(request, response, HttpServletResponse.SC_UNAUTHORIZED,
                ApiErrorWriter.INVALID_API_KEY, "The API key is not valid.", null);
    }

    private void rejectUnavailable(HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader("Retry-After", "5");
        ApiErrorWriter.write(request, response, HttpServletResponse.SC_SERVICE_UNAVAILABLE,
                ApiErrorWriter.AUTH_UNAVAILABLE, "Authentication is temporarily unavailable. Retry shortly.", null);
    }

    private static boolean startsWithAny(String rawPath, String decodedPath, List<String> prefixes) {
        for (String prefix : prefixes) {
            if ((rawPath != null && rawPath.startsWith(prefix))
                    || (decodedPath != null && decodedPath.startsWith(prefix))) {
                return true;
            }
        }
        return false;
    }

    /**
     * Spring routes {@code /%6Fpen/…} to the same handler as {@code /open/…}, so the decoded
     * form is matched too. Undecodable paths are matched raw only.
     */
    static String decode(String path) {
        if (path == null || path.indexOf('%') < 0) {
            return path;
        }
        try {
            return UriUtils.decode(path, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException malformed) {
            return path;
        }
    }

    /** Where the filter acts and what it requires. */
    public static final class Settings {
        private final List<String> pathPrefixes;
        private final List<String> requiredKeyPathPrefixes;
        private final Set<String> exemptPaths;
        private final String requiredProduct;
        private final Clock clock;

        private Settings(Builder b) {
            this.pathPrefixes = List.copyOf(b.pathPrefixes);
            this.requiredKeyPathPrefixes = List.copyOf(b.requiredKeyPathPrefixes);
            this.exemptPaths = Set.copyOf(b.exemptPaths);
            this.requiredProduct = b.requiredProduct;
            this.clock = b.clock;
        }

        public static Builder builder() {
            return new Builder();
        }

        public static final class Builder {
            private List<String> pathPrefixes = List.of();
            private List<String> requiredKeyPathPrefixes = List.of();
            private Set<String> exemptPaths = Set.of();
            private String requiredProduct;
            private Clock clock = Clock.systemUTC();

            /** Paths on which a present X-API-Key is authenticated, e.g. {@code /assessment-service/open/}. */
            public Builder pathPrefixes(List<String> prefixes) {
                this.pathPrefixes = Objects.requireNonNull(prefixes);
                return this;
            }

            /** Paths on which a missing key is 401 {@code missing_api_key} instead of passing through. */
            public Builder requiredKeyPathPrefixes(List<String> prefixes) {
                this.requiredKeyPathPrefixes = Objects.requireNonNull(prefixes);
                return this;
            }

            /** Exact paths the filter never touches (e.g. the OpenAPI document). */
            public Builder exemptPaths(Set<String> paths) {
                this.exemptPaths = Objects.requireNonNull(paths);
                return this;
            }

            /** Product the key and the institute must have enabled, e.g. {@code evaluation}; null skips the check. */
            public Builder requiredProduct(String product) {
                this.requiredProduct = product;
                return this;
            }

            public Builder clock(Clock clock) {
                this.clock = Objects.requireNonNull(clock);
                return this;
            }

            public Settings build() {
                return new Settings(this);
            }
        }
    }
}
