package vacademy.io.admin_core_service.features.catalog_api.website;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Institute-admin management of approved websites (Settings → Integrations → Catalogue API & websites): the
 * hosts whose browser pages may call the public Catalogue API with the institute's publishable
 * key. Same guard as the API key routes: {@code requireInstituteAdmin} (ADMIN role in that
 * institute, no root-user bypass).
 */
@RestController
@RequestMapping("/admin-core-service/v1/websites")
@RequiredArgsConstructor
public class InstituteWebsiteAdminController {

    private final InstituteWebsiteService websiteService;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> list(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(websiteService.list(instituteId).stream()
                .map(InstituteWebsiteService::view)
                .toList());
    }

    /** Body {"host": "www.example.com"}; any URL form is accepted and normalised. Returns the row with its dns_record. */
    @PostMapping
    public ResponseEntity<Map<String, Object>> add(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) JsonNode body,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        String host = body != null && body.hasNonNull("host") ? body.get("host").asText() : null;
        return ResponseEntity.ok(InstituteWebsiteService.view(websiteService.add(instituteId, host, user)));
    }

    /** Looks the TXT record up now: VERIFIED, or still PENDING with last_error. */
    @PostMapping("/{websiteId}/verify")
    public ResponseEntity<Map<String, Object>> verify(
            @PathVariable("websiteId") String websiteId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(InstituteWebsiteService.view(websiteService.verify(instituteId, websiteId, user)));
    }

    @DeleteMapping("/{websiteId}")
    public ResponseEntity<Map<String, Object>> remove(
            @PathVariable("websiteId") String websiteId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        websiteService.remove(instituteId, websiteId, user);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("removed", true);
        return ResponseEntity.ok(out);
    }
}
