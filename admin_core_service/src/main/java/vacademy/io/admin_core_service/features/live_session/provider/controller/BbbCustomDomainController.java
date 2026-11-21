package vacademy.io.admin_core_service.features.live_session.provider.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.live_session.provider.manager.BbbMeetingManager;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Serves the list of per-institute custom live-class hostnames to the BBB pool
 * start workflow, which uses it to rebuild each server's nginx {@code
 * server_name} list, its certificate SAN set, and the alias DNS records.
 *
 * <p><b>Auth.</b> Gated by the shared cluster secret in the
 * {@code X-Internal-Service-Token} header, following the same pattern as
 * assessment_service's copy-check callbacks. The path is in the security
 * config's permitAll list purely so no JWT is demanded; this controller is the
 * thing that actually authorises the call, so the token check must not be
 * removed.
 *
 * <p><b>Why not {@code /internal/...}.</b> {@code InternalAuthFilter} triggers on
 * {@code request.getRequestURI().contains("internal")} — a substring match, not
 * a path prefix — and demands {@code clientName} + {@code Signature} HMAC
 * headers. Putting the word "internal" anywhere in this path would silently 401
 * every call from GitHub Actions, so the path deliberately avoids it.
 */
@RestController
@RequestMapping("/admin-core-service/bbb/custom-domains")
@RequiredArgsConstructor
@Slf4j
public class BbbCustomDomainController {

    private final InstituteRepository instituteRepository;

    /**
     * The shared cluster secret.
     *
     * Falls back to {@code ai.service.internal.token} because admin_core's deploy
     * workflow historically injected the very same GitHub secret under the name
     * AI_SERVICE_INTERNAL_TOKEN and never set INTERNAL_SERVICE_TOKEN at all — so
     * without this fallback the property resolves to empty and every call 401s,
     * including one carrying the correct token. Same two-level pattern
     * assessment_service's copy-check callbacks use.
     */
    @Value("${internal.service.token:${ai.service.internal.token:}}")
    private String expectedToken;

    @jakarta.annotation.PostConstruct
    void logTokenConfig() {
        // Length only, never the value — makes a misconfigured deploy obvious at
        // startup instead of surfacing as an unexplained 401 hours later.
        if (expectedToken == null || expectedToken.isEmpty()) {
            log.error("[BBB] custom-domains token is EMPTY at startup — every call will 401. "
                    + "Set INTERNAL_SERVICE_TOKEN on admin-core-service.");
        } else {
            log.info("[BBB] custom-domains token loaded (length={})", expectedToken.length());
        }
    }

    /**
     * GET /admin-core-service/bbb/custom-domains
     *
     * Returns {@code {"domains": ["meet.zoeedtech.com", ...], "count": n}}.
     *
     * Values are re-normalised on the way out rather than trusted from the
     * database: this list is interpolated into an nginx {@code server_name}
     * directive and a certbot command line on the pool server, so a malformed
     * row must be dropped here rather than become a config-injection vector.
     */
    @GetMapping
    public ResponseEntity<Map<String, Object>> listCustomDomains(
            @RequestHeader(value = "X-Internal-Service-Token", required = false) String token) {

        if (!verify(token)) {
            return ResponseEntity.status(401).body(Map.of("error", "invalid token"));
        }

        List<String> raw = instituteRepository.findDistinctLiveSessionBaseUrls();
        Set<String> clean = new LinkedHashSet<>();
        List<String> rejected = new ArrayList<>();
        for (String candidate : raw) {
            String host = BbbMeetingManager.normalizeLiveSessionHost(candidate);
            if (host != null) {
                clean.add(host);
            } else if (candidate != null && !candidate.isBlank()) {
                rejected.add(candidate);
            }
        }
        if (!rejected.isEmpty()) {
            log.warn("[BBB] Ignoring {} malformed live_session_base_url value(s): {}",
                    rejected.size(), rejected);
        }

        List<String> domains = new ArrayList<>(clean);
        log.info("[BBB] Serving {} custom live-class domain(s) to the pool workflow", domains.size());
        return ResponseEntity.ok(Map.of("domains", domains, "count", domains.size()));
    }

    /** Constant-time comparison so the token cannot be recovered by timing. */
    private boolean verify(String token) {
        if (expectedToken == null || expectedToken.isEmpty()) {
            log.error("[BBB] custom-domains rejected: internal.service.token is not configured");
            return false;
        }
        if (token == null || token.isEmpty()) {
            log.warn("[BBB] custom-domains rejected: missing X-Internal-Service-Token header");
            return false;
        }
        return MessageDigest.isEqual(
                token.getBytes(StandardCharsets.UTF_8),
                expectedToken.getBytes(StandardCharsets.UTF_8));
    }
}
