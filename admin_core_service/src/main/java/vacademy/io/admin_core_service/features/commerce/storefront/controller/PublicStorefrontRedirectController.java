package vacademy.io.admin_core_service.features.commerce.storefront.controller;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiEnvelope;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.auth.CatalogApiAuth;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.storefront.redirect.SiteRedirectResolver;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Old-site redirects and label scans of a shop:
 * <pre>
 * GET /open/commerce/v1/q/{code}
 *     200 {"path": "/p/cotton-shirt?v=CS-M", "slug": "cotton-shirt", "sku": "CS-M"}
 *     404 not_found
 * GET /open/commerce/v1/redirects/resolve?path=/old/path?x=1
 *     200 {"status_code": 301, "to_path": "/p/new-slug?lang=en"}
 *     200 {"status_code": 410}
 *     404 not_found when no row matches
 * </pre>
 * Behind the publishable Catalogue API key like the other shop routes, with limits of its own;
 * the institute is the key's. Asked by the edge for a path that is no page of the site, so the
 * answer (a miss too) may be cached for five minutes.
 */
@RestController
@RequestMapping("/admin-core-service/open/commerce/v1")
@RequiredArgsConstructor
public class PublicStorefrontRedirectController implements CatalogApiEnvelope {

    /** Per minute and pod, separately for browser calls and for server-side calls. */
    static final int REDIRECT_PER_KEY = 3000;
    static final int REDIRECT_PER_VISITOR = 60;

    static final int SCAN_PER_KEY = 1500;
    static final int SCAN_PER_VISITOR = 30;

    private final CatalogApiAuth auth;
    private final StorefrontFeatureGate featureGate;
    private final SiteRedirectResolver resolver;

    @GetMapping("/redirects/resolve")
    public ResponseEntity<Map<String, Object>> resolve(HttpServletRequest http,
                                                       @RequestParam(value = "path", required = false) String path) {
        var p = auth.authenticateUnmetered(http, CatalogApiAuth.SCOPE_READ);
        featureGate.require(p.instituteId(), CommerceFeature.CATALOGUE);
        auth.rateLimit(p, http, "redirect", REDIRECT_PER_KEY, REDIRECT_PER_VISITOR);
        if (SiteRedirectResolver.normalise(path) == null) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("param", "path");
            throw new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request",
                    "path is required: a site path that starts with a slash.", details, null);
        }
        SiteRedirectResolver.Redirect found = resolver.resolve(p.instituteId(), path)
                .orElseThrow(() -> new CatalogApiException(HttpStatus.NOT_FOUND, "not_found",
                        "No redirect for this path."));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status_code", found.statusCode());
        if (found.toPath() != null) {
            body.put("to_path", found.toPath());
        }
        return ResponseEntity.ok()
                .header("Cache-Control", "public, max-age=300")
                .header("Vary", "Origin, X-API-Key, Authorization")
                .body(body);
    }

    /**
     * {@code GET /open/commerce/v1/q/{code}}: where the QR code of a printed label leads.
     * 200 {"path": "/p/<slug>?v=<sku>", "slug": "...", "sku": "..."}; 404 for a code that names
     * no product on sale. Public product data only.
     */
    @GetMapping("/q/{code}")
    public ResponseEntity<Map<String, Object>> scan(HttpServletRequest http, @PathVariable("code") String code) {
        var p = auth.authenticateUnmetered(http, CatalogApiAuth.SCOPE_READ);
        featureGate.require(p.instituteId(), CommerceFeature.CATALOGUE);
        auth.rateLimit(p, http, "scan", SCAN_PER_KEY, SCAN_PER_VISITOR);
        SiteRedirectResolver.ScanTarget found = resolver.scan(p.instituteId(), code)
                .orElseThrow(() -> new CatalogApiException(HttpStatus.NOT_FOUND, "not_found",
                        "This code names no product on sale."));
        Map<String, Object> body = new LinkedHashMap<>();
        String path = "/p/" + found.slug();
        if (found.sku() != null) {
            path += "?v=" + URLEncoder.encode(found.sku(), StandardCharsets.UTF_8);
        }
        body.put("path", path);
        body.put("slug", found.slug());
        body.put("sku", found.sku());
        return ResponseEntity.ok()
                .header("Cache-Control", "public, max-age=60")
                .header("Vary", "Origin, X-API-Key, Authorization")
                .body(body);
    }
}
