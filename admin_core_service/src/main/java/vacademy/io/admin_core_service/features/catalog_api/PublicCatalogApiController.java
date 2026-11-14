package vacademy.io.admin_core_service.features.catalog_api;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.catalog_api.auth.CatalogApiAuth;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogApiService;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogLeadService;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Pattern;

/**
 * Catalogue API v1: an institute's courses, streams and learning paths for its own website, read
 * from the same data the hosted catalogue site renders, plus enquiries into the CRM. Public base
 * URL https://api.vacademy.ai/catalog/v1 (ingress rewrite to this path); authenticated with a
 * publishable catalogue key ({@code vak_pub_…}, X-API-Key or Bearer). JSON is snake_case; errors
 * are {"error":{"code","message","request_id","details"?}} (CatalogApiErrorAdvice).
 *
 * <p>Every read needs scope {@code catalog:read} and is cacheable for 60 s
 * ({@code Cache-Control: public, max-age=60}); POST /leads needs {@code leads:write}.
 */
@RestController
@RequestMapping(PublicCatalogApiController.PREFIX)
@RequiredArgsConstructor
public class PublicCatalogApiController {

    static final String PREFIX = "/admin-core-service/open/catalog/v1";

    /** Every route of this API, for telling a wrong method (405) from an unknown path (404). */
    private static final Pattern KNOWN_PATHS = Pattern.compile(
            "^/(site|courses(/[^/]+(/outline)?)?|streams|learning-paths(/[^/]+)?|sitemap|leads)$");

    private final CatalogApiAuth auth;
    private final CatalogApiService service;
    private final CatalogLeadService leads;

    @GetMapping("/site")
    public ResponseEntity<Map<String, Object>> site(HttpServletRequest http) {
        var p = auth.authenticate(http, CatalogApiAuth.SCOPE_READ);
        return cacheable(service.site(p.instituteId()));
    }

    @GetMapping("/courses")
    public ResponseEntity<Map<String, Object>> courses(HttpServletRequest http) {
        var p = auth.authenticate(http, CatalogApiAuth.SCOPE_READ);
        return cacheable(service.courses(p.instituteId(), courseQuery(http::getParameter)));
    }

    /**
     * The /courses query parameters (q, stream, category, format, language, tag, availability,
     * page, page_size, sort, level, instructor, session, badge, price, price_min, price_max, custom,
     * facets) as a {@link CatalogApiService.CourseQuery}; 400 invalid_request for a non-numeric page
     * or page_size or a non-boolean facets. Shared with the Site Assistant internal catalogue proxy so
     * both parse a query the same way.
     */
    public static CatalogApiService.CourseQuery courseQuery(Function<String, String> param) {
        int pageNo = intParam("page", param.apply("page"), 1);
        int size = intParam("page_size", param.apply("page_size"), 24);
        return new CatalogApiService.CourseQuery(param.apply("q"), param.apply("stream"), param.apply("category"),
                param.apply("format"), param.apply("language"), param.apply("tag"), param.apply("availability"),
                pageNo, size, param.apply("sort"), param.apply("level"), param.apply("instructor"),
                param.apply("session"), param.apply("badge"), param.apply("price"), param.apply("price_min"),
                param.apply("price_max"), param.apply("custom"), boolParam("facets", param.apply("facets")));
    }

    @GetMapping("/courses/{id}")
    public ResponseEntity<Map<String, Object>> course(HttpServletRequest http, @PathVariable("id") String id,
            @RequestParam(value = "language", required = false) String language) {
        var p = auth.authenticate(http, CatalogApiAuth.SCOPE_READ);
        return cacheable(service.course(p.instituteId(), id, language));
    }

    @GetMapping("/courses/{id}/outline")
    public ResponseEntity<Map<String, Object>> outline(HttpServletRequest http, @PathVariable("id") String id,
            @RequestParam(value = "language", required = false) String language) {
        var p = auth.authenticate(http, CatalogApiAuth.SCOPE_READ);
        return cacheable(service.outline(p.instituteId(), id, language));
    }

    @GetMapping("/streams")
    public ResponseEntity<Map<String, Object>> streams(HttpServletRequest http) {
        var p = auth.authenticate(http, CatalogApiAuth.SCOPE_READ);
        return cacheable(service.streams(p.instituteId()));
    }

    @GetMapping("/learning-paths")
    public ResponseEntity<Map<String, Object>> learningPaths(HttpServletRequest http,
            @RequestParam(value = "stream", required = false) String stream) {
        var p = auth.authenticate(http, CatalogApiAuth.SCOPE_READ);
        return cacheable(service.learningPaths(p.instituteId(), stream));
    }

    @GetMapping("/learning-paths/{code}")
    public ResponseEntity<Map<String, Object>> learningPath(HttpServletRequest http, @PathVariable("code") String code) {
        var p = auth.authenticate(http, CatalogApiAuth.SCOPE_READ);
        return cacheable(service.learningPath(p.instituteId(), code));
    }

    @GetMapping("/sitemap")
    public ResponseEntity<Map<String, Object>> sitemap(HttpServletRequest http) {
        var p = auth.authenticate(http, CatalogApiAuth.SCOPE_READ);
        return cacheable(service.sitemap(p.instituteId()));
    }

    @PostMapping("/leads")
    public ResponseEntity<Map<String, Object>> lead(HttpServletRequest http,
            @RequestBody(required = false) JsonNode body) {
        var p = auth.authenticate(http, CatalogApiAuth.SCOPE_LEADS_WRITE);
        auth.rateLimitLead(p, http);
        CatalogLeadService.Lead lead = CatalogLeadService.validate(body);
        CatalogLeadService.Outcome outcome = leads.submit(p.instituteId(), lead);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", outcome.status());
        return ResponseEntity.status(outcome.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .header("Cache-Control", "no-store")
                .body(out);
    }

    /**
     * Anything no route above matched: an unknown path is 404 and a known path with the wrong
     * method is 405, both in the API's error shape (without this, Spring's own /error dispatch
     * answers with a bare 403 because /error is not a public route).
     */
    @RequestMapping("/**")
    public ResponseEntity<Map<String, Object>> fallback(HttpServletRequest http) {
        String uri = http.getRequestURI();
        String path = uri.startsWith(PREFIX) ? uri.substring(PREFIX.length()) : uri;
        if (KNOWN_PATHS.matcher(path).matches()) {
            throw new CatalogApiException(HttpStatus.METHOD_NOT_ALLOWED, "method_not_allowed",
                    http.getMethod() + " is not supported on /catalog/v1" + path + ".");
        }
        throw new CatalogApiException(HttpStatus.NOT_FOUND, "not_found",
                "No such endpoint: " + http.getMethod() + " /catalog/v1" + path + ".");
    }

    static int intParam(String name, String raw, int fallback) {
        if (raw == null || raw.isBlank()) return fallback;
        try {
            return Integer.parseInt(raw.trim());
        } catch (NumberFormatException e) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("param", name);
            throw new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request", name + " must be a whole number.",
                    details, null);
        }
    }

    static boolean boolParam(String name, String raw) {
        if (raw == null || raw.isBlank()) return false;
        String v = raw.trim().toLowerCase(java.util.Locale.ROOT);
        if (v.equals("true") || v.equals("1")) return true;
        if (v.equals("false") || v.equals("0")) return false;
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("param", name);
        throw new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request", name + " must be true or false.",
                details, null);
    }

    private static ResponseEntity<Map<String, Object>> cacheable(Map<String, Object> body) {
        return ResponseEntity.ok()
                .header("Cache-Control", "public, max-age=60")
                .header("Vary", "Origin, X-API-Key, Authorization")
                .body(body);
    }
}
