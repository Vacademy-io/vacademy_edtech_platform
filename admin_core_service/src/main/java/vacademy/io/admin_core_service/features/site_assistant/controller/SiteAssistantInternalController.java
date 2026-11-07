package vacademy.io.admin_core_service.features.site_assistant.controller;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.PublicCatalogApiController;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogApiService;
import vacademy.io.admin_core_service.features.live_session.service.PublicLiveSessionService;
import vacademy.io.admin_core_service.features.site_assistant.service.SiteAssistantLeadService;
import vacademy.io.admin_core_service.features.site_assistant.service.SiteAssistantSiteService;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Service-to-service endpoints the Site Assistant engine (ai_service) calls (docs/site-assistant/SPEC.md 3.2).
 *
 * <p>Guarded by {@code InternalAuthFilter} (HMAC {@code clientName} + {@code Signature} headers):
 * the path has an exact {@code internal} segment, and {@code /admin-core-service/internal/**} is an
 * authenticated matcher in ApplicationSecurityConfig, so a user JWT or an anonymous call never
 * reaches it. The institute comes from the caller (which took it from the visitor's signed session),
 * not from any browser input.
 *
 * <p>Catalogue proxies answer exactly the Catalogue API v1 view JSON ({@link CatalogApiService},
 * query parsing shared with {@link PublicCatalogApiController#courseQuery}), with no key, origin lock
 * or rate limit. Errors use the Catalogue API envelope {"error":{"code","message","request_id"}}
 * ({@link SiteAssistantErrorAdvice}).
 */
@RestController
@RequestMapping("/admin-core-service/internal/site-assistant/v1")
@RequiredArgsConstructor
public class SiteAssistantInternalController {

    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9_\\-]{1,64}$");

    private final CatalogApiService catalog;
    private final SiteAssistantLeadService leads;
    private final SiteAssistantSiteService sites;
    private final PublicLiveSessionService liveSessions;

    // ── Catalogue (Catalogue API v1 views) ─────────────────────────────────────

    @GetMapping("/catalog/site")
    public ResponseEntity<Map<String, Object>> site(@RequestParam(value = "instituteId", required = false) String instituteId) {
        return ok(catalog.site(institute(instituteId)));
    }

    @GetMapping("/catalog/courses")
    public ResponseEntity<Map<String, Object>> courses(HttpServletRequest http,
            @RequestParam(value = "instituteId", required = false) String instituteId) {
        String iid = institute(instituteId);
        return ok(catalog.courses(iid, PublicCatalogApiController.courseQuery(http::getParameter)));
    }

    @GetMapping("/catalog/courses/{id}")
    public ResponseEntity<Map<String, Object>> course(@PathVariable("id") String id,
            @RequestParam(value = "instituteId", required = false) String instituteId,
            @RequestParam(value = "language", required = false) String language) {
        return ok(catalog.course(institute(instituteId), id, language));
    }

    @GetMapping("/catalog/courses/{id}/outline")
    public ResponseEntity<Map<String, Object>> outline(@PathVariable("id") String id,
            @RequestParam(value = "instituteId", required = false) String instituteId,
            @RequestParam(value = "language", required = false) String language) {
        return ok(catalog.outline(institute(instituteId), id, language));
    }

    @GetMapping("/catalog/learning-paths")
    public ResponseEntity<Map<String, Object>> learningPaths(
            @RequestParam(value = "instituteId", required = false) String instituteId,
            @RequestParam(value = "stream", required = false) String stream) {
        return ok(catalog.learningPaths(institute(instituteId), stream));
    }

    @GetMapping("/catalog/learning-paths/{code}")
    public ResponseEntity<Map<String, Object>> learningPath(@PathVariable("code") String code,
            @RequestParam(value = "instituteId", required = false) String instituteId) {
        return ok(catalog.learningPath(institute(instituteId), code));
    }

    @GetMapping("/catalog/streams")
    public ResponseEntity<Map<String, Object>> streams(
            @RequestParam(value = "instituteId", required = false) String instituteId) {
        return ok(catalog.streams(institute(instituteId)));
    }

    // ── Live classes (SPEC 3.1 without the per-IP limit of the open endpoint) ──

    @GetMapping("/live-sessions")
    public ResponseEntity<Map<String, Object>> liveSessions(
            @RequestParam(value = "instituteId", required = false) String instituteId,
            @RequestParam(value = "from", required = false) String from,
            @RequestParam(value = "days", required = false) String days,
            @RequestParam(value = "limit", required = false) String limit) {
        PublicLiveSessionService.Query query;
        try {
            query = liveSessions.parse(instituteId, from, days, limit);
        } catch (IllegalArgumentException e) {
            throw new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request", e.getMessage());
        }
        return ok(liveSessions.list(query));
    }

    // ── Leads ───────────────────────────────────────────────────────────────

    @PostMapping("/leads")
    public ResponseEntity<Map<String, Object>> lead(@RequestBody(required = false) JsonNode body) {
        SiteAssistantLeadService.Outcome outcome = leads.submit(SiteAssistantLeadService.validate(body));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", outcome.status());
        out.put("lead_ref", outcome.leadRef());
        return ResponseEntity.status("received".equals(outcome.status()) ? HttpStatus.CREATED : HttpStatus.OK)
                .header("Cache-Control", "no-store")
                .body(out);
    }

    // ── Where the visitor is ─────────────────────────────────────────────────

    @GetMapping("/origin-check")
    public ResponseEntity<Map<String, Object>> originCheck(
            @RequestParam(value = "instituteId", required = false) String instituteId,
            @RequestParam(value = "host", required = false) String host) {
        String iid = institute(instituteId);
        if (!StringUtils.hasText(host)) {
            throw new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request", "host is required.");
        }
        return ok(Map.of("allowed", sites.originAllowed(iid, host)));
    }

    @GetMapping("/resolve-site")
    public ResponseEntity<Map<String, Object>> resolveSite(
            @RequestParam(value = "host", required = false) String host,
            @RequestParam(value = "tag", required = false) String tag) {
        if (!StringUtils.hasText(host)) {
            throw new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request", "host is required.");
        }
        SiteAssistantSiteService.ResolvedSite site = sites.resolveSite(host, tag)
                .orElseThrow(() -> new CatalogApiException(HttpStatus.NOT_FOUND, "not_found",
                        "No institute site is served on this host."));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("institute_id", site.instituteId());
        out.put("site_tag", site.siteTag());
        return ok(out);
    }

    private static String institute(String instituteId) {
        if (!StringUtils.hasText(instituteId) || !ID.matcher(instituteId.trim()).matches()) {
            throw new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request", "instituteId is required.");
        }
        return instituteId.trim();
    }

    private static ResponseEntity<Map<String, Object>> ok(Map<String, Object> body) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(body);
    }
}
