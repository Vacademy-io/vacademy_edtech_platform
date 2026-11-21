package vacademy.io.admin_core_service.features.commerce.storefront.controller;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiEnvelope;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.auth.CatalogApiAuth;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.storefront.dto.StorefrontDtos;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontCatalogService;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Shop products on the public Catalogue API: the same base path,
 * publishable key ({@code catalog:read}), origin lock, rate limit, 60 s cache and error shape
 * as the course routes of {@code PublicCatalogApiController}. The institute is the one the key
 * belongs to; nothing in the request can name another.
 *
 * <pre>
 * GET /products          locale, q, suggest, collection, filter.&lt;attribute code&gt;=a,b,
 *                        price_min, price_max, in_stock, sort, page, page_size, facets
 * GET /products/{slug}   locale
 * GET /categories        locale, kind, min_in_stock
 * </pre>
 *
 * <p>Prices of goods sold by length or weight ({@code qty_scale} above 1): {@code price_min},
 * {@code price_max}, {@code sort=price_asc|price_desc} and the price facet's min, max and bands
 * are per display unit (per metre of cloth, per kg), while a card's {@code price.amount} stays
 * per base unit (10 cm at {@code qty_scale} 10): a client shows {@code amount × qty_scale}.
 * Counted goods ({@code qty_scale} 1) are the same in both.
 */
@RestController
@RequestMapping("/admin-core-service/open/catalog/v1")
@RequiredArgsConstructor
public class PublicStorefrontCatalogController implements CatalogApiEnvelope {

    private static final String FILTER_PREFIX = "filter.";
    private static final int MAX_FILTERS = 20;
    private static final int MAX_FILTER_VALUES = 50;

    private final CatalogApiAuth auth;
    private final StorefrontFeatureGate featureGate;
    private final StorefrontCatalogService service;

    @GetMapping("/products")
    public ResponseEntity<Object> products(HttpServletRequest http) {
        var p = auth.authenticate(http, CatalogApiAuth.SCOPE_READ);
        featureGate.require(p.instituteId(), CommerceFeature.CATALOGUE);
        String locale = locale(http);
        if (bool("suggest", http.getParameter("suggest"), false)) {
            return cacheable(service.suggest(p.instituteId(), http.getParameter("q"), locale));
        }
        Boolean inStock = http.getParameter("in_stock") == null || http.getParameter("in_stock").isBlank()
                ? null : bool("in_stock", http.getParameter("in_stock"), false);
        StorefrontCatalogService.ProductQuery query = new StorefrontCatalogService.ProductQuery(
                http.getParameter("q"), http.getParameter("collection"), filters(http),
                money("price_min", http.getParameter("price_min")), money("price_max", http.getParameter("price_max")),
                inStock, http.getParameter("sort"), whole("page", http.getParameter("page"), 1),
                whole("page_size", http.getParameter("page_size"), StorefrontCatalogService.DEFAULT_PAGE_SIZE),
                bool("facets", http.getParameter("facets"), false), locale);
        StorefrontDtos.ProductList list = service.list(p.instituteId(), query);
        return cacheable(list);
    }

    @GetMapping("/products/{slug}")
    public ResponseEntity<Object> product(HttpServletRequest http, @PathVariable("slug") String slug) {
        var p = auth.authenticate(http, CatalogApiAuth.SCOPE_READ);
        featureGate.require(p.instituteId(), CommerceFeature.CATALOGUE);
        return cacheable(service.detail(p.instituteId(), slug, locale(http)));
    }

    @GetMapping("/categories")
    public ResponseEntity<Object> categories(HttpServletRequest http) {
        var p = auth.authenticate(http, CatalogApiAuth.SCOPE_READ);
        featureGate.require(p.instituteId(), CommerceFeature.CATALOGUE);
        int minInStock = whole("min_in_stock", http.getParameter("min_in_stock"), 0);
        if (minInStock < 0) {
            throw invalid("min_in_stock cannot be negative.", "min_in_stock");
        }
        return cacheable(service.categories(p.instituteId(), locale(http), http.getParameter("kind"), minInStock));
    }

    /** {@code locale}, or {@code lang} as the storefront URLs name it. */
    private static String locale(HttpServletRequest http) {
        String locale = http.getParameter("locale");
        return locale != null && !locale.isBlank() ? locale : http.getParameter("lang");
    }

    /** {@code filter.colour=red,blue} gives colour -> [red, blue]. */
    static Map<String, List<String>> filters(HttpServletRequest http) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        for (Map.Entry<String, String[]> e : http.getParameterMap().entrySet()) {
            if (!e.getKey().startsWith(FILTER_PREFIX) || e.getKey().length() == FILTER_PREFIX.length()) {
                continue;
            }
            List<String> values = new ArrayList<>();
            for (String raw : e.getValue()) {
                if (raw == null) {
                    continue;
                }
                for (String part : raw.split(",")) {
                    if (!part.isBlank() && values.size() < MAX_FILTER_VALUES && !values.contains(part.trim())) {
                        values.add(part.trim());
                    }
                }
            }
            if (!values.isEmpty()) {
                if (out.size() >= MAX_FILTERS) {
                    throw invalid("Too many filters (at most " + MAX_FILTERS + ").", "filter");
                }
                out.put(e.getKey().substring(FILTER_PREFIX.length()), values);
            }
        }
        return out;
    }

    static int whole(String name, String raw, int fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        try {
            return Integer.parseInt(raw.trim());
        } catch (NumberFormatException e) {
            throw invalid(name + " must be a whole number.", name);
        }
    }

    static boolean bool(String name, String raw, boolean fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        String v = raw.trim().toLowerCase(Locale.ROOT);
        if (v.equals("true") || v.equals("1")) {
            return true;
        }
        if (v.equals("false") || v.equals("0")) {
            return false;
        }
        throw invalid(name + " must be true or false.", name);
    }

    static BigDecimal money(String name, String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            BigDecimal value = new BigDecimal(raw.trim());
            if (value.signum() < 0 || value.precision() - value.scale() > 10) {
                throw new NumberFormatException();
            }
            return value;
        } catch (NumberFormatException e) {
            throw invalid(name + " must be an amount of zero or more.", name);
        }
    }

    private static CatalogApiException invalid(String message, String param) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("param", param);
        return new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request", message, details, null);
    }

    private static ResponseEntity<Object> cacheable(Object body) {
        return ResponseEntity.ok()
                .header("Cache-Control", "public, max-age=60")
                .header("Vary", "Origin, X-API-Key, Authorization")
                .body(body);
    }
}
