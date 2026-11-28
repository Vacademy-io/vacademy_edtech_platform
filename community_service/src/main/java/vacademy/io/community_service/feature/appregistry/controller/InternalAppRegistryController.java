package vacademy.io.community_service.feature.appregistry.controller;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.community_service.feature.appregistry.service.AppRegistryService;

import java.util.List;

/**
 * Service-to-service read path for the app registry, consumed by admin_core_service's
 * institute-facing app-status endpoint.
 *
 * <p>community_service and admin_core_service run on separate databases (assessment_service vs
 * admin_core_service), so the institute-membership check that gates this data cannot be a local
 * JPA join against {@code user_role} here — that table doesn't exist in this service's database.
 * admin_core_service already owns that check (see WhiteLabelService#assertInstituteAccess); this
 * endpoint trusts it and only verifies HMAC service identity via {@link
 * vacademy.io.common.auth.filter.InternalAuthFilter}, matched on {@code /community-service/internal/**}
 * in {@code CommunityApplicationSecurityConfig}. It must never be exposed to browsers directly.
 */
@RestController
@RequestMapping("/community-service/internal/v1/app-registry")
public class InternalAppRegistryController {

    @Autowired
    private AppRegistryService service;

    @GetMapping("/by-institute")
    public ResponseEntity<List<JsonNode>> byInstitute(@RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(service.listByInstitute(instituteId));
    }
}
