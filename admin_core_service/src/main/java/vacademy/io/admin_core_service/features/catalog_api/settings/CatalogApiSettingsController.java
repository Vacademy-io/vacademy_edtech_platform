package vacademy.io.admin_core_service.features.catalog_api.settings;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogDataLoader;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.net.URI;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Settings → Integrations → Catalogue API: which site drives the institute's public catalogue
 * API and where its course pages live. Institute admins only ({@code requireInstituteAdmin}).
 *
 * <p>GET/PUT {@code ?instituteId=} → {@code {site_tag, course_base_url, resolved:{site_tag,
 * course_base_url, source}}}. PUT: a field left out (or null) keeps its value, "" clears it.
 */
@RestController
@RequestMapping("/admin-core-service/v1/catalog-api/settings")
@RequiredArgsConstructor
public class CatalogApiSettingsController {

    static final int MAX_URL = 500;
    static final int MAX_TAG = 255;

    private final InstituteCatalogApiSettingsRepository repository;
    private final CatalogSiteResolver resolver;
    private final CatalogDataLoader loader;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping
    public ResponseEntity<Map<String, Object>> get(@RequestParam("instituteId") String instituteId,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(view(repository.findById(instituteId).orElse(null), resolver.resolve(instituteId)));
    }

    @PutMapping
    public ResponseEntity<Map<String, Object>> put(@RequestParam("instituteId") String instituteId,
                                                   @RequestBody(required = false) SettingsBody body,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        if (body == null) throw new VacademyException(HttpStatus.BAD_REQUEST, "Send a JSON body.");
        InstituteCatalogApiSettings row = repository.findById(instituteId)
                .orElseGet(() -> InstituteCatalogApiSettings.builder().instituteId(instituteId).build());
        if (body.getSiteTag() != null) {
            String tag = body.getSiteTag().trim();
            if (tag.isEmpty()) {
                row.setSiteTag(null);
            } else {
                if (tag.length() > MAX_TAG) throw new VacademyException(HttpStatus.BAD_REQUEST, "site_tag is too long.");
                if (!resolver.catalogueExists(instituteId, tag)) {
                    throw new VacademyException(HttpStatus.BAD_REQUEST,
                            "No catalogue site with tag '" + tag + "' exists for this institute.");
                }
                row.setSiteTag(tag);
            }
        }
        if (body.getCourseBaseUrl() != null) {
            String url = body.getCourseBaseUrl().trim();
            row.setCourseBaseUrl(url.isEmpty() ? null : validateBaseUrl(url));
        }
        row.setUpdatedBy(user == null ? null : user.getUserId());
        row.setUpdatedAt(Instant.now());
        repository.save(row);
        loader.evict(instituteId);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(view(row, resolver.resolve(instituteId)));
    }

    /** https only, a host, no query or fragment, at most 500 characters; trailing slashes dropped. */
    static String validateBaseUrl(String url) {
        if (url.length() > MAX_URL) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "course_base_url must be at most " + MAX_URL + " characters.");
        }
        URI uri;
        try {
            uri = new URI(url);
        } catch (Exception e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "course_base_url is not a valid URL.");
        }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getHost().isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "course_base_url must be an https:// URL, e.g. https://learning.example.com/store.");
        }
        if (uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getRawUserInfo() != null) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "course_base_url must not carry a query or a fragment.");
        }
        String out = url;
        while (out.endsWith("/")) out = out.substring(0, out.length() - 1);
        return out;
    }

    static Map<String, Object> view(InstituteCatalogApiSettings row, CatalogSiteResolver.Resolution resolved) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("site_tag", resolved.siteTag());
        r.put("course_base_url", resolved.courseBaseUrl());
        r.put("source", resolved.source());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("site_tag", row == null ? null : row.getSiteTag());
        out.put("course_base_url", row == null ? null : row.getCourseBaseUrl());
        out.put("resolved", r);
        return out;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class SettingsBody {
        @JsonProperty("site_tag")
        private String siteTag;
        @JsonProperty("course_base_url")
        private String courseBaseUrl;
    }
}
