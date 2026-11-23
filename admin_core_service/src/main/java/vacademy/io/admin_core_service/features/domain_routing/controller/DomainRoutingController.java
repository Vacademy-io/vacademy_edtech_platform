package vacademy.io.admin_core_service.features.domain_routing.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.domain_routing.dto.DomainRoutingResolveRequest;
import vacademy.io.admin_core_service.features.domain_routing.dto.DomainRoutingResolveResponse;
import vacademy.io.admin_core_service.features.domain_routing.service.DomainRoutingService;
import vacademy.io.admin_core_service.config.cache.ClientCacheable;
import vacademy.io.admin_core_service.config.cache.CacheScope;

import java.util.Optional;

@RestController
@RequestMapping("/admin-core-service/public/domain-routing/v1")
@RequiredArgsConstructor
public class DomainRoutingController {

    private final DomainRoutingService domainRoutingService;

    @PostMapping("/resolve")
    public ResponseEntity<DomainRoutingResolveResponse> resolve(@RequestBody DomainRoutingResolveRequest request) {
        Optional<DomainRoutingResolveResponse> response = domainRoutingService.resolve(request.getDomain(), request.getSubdomain());
        return response.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/resolve")
    @ClientCacheable(maxAgeSeconds = 7200, scope = CacheScope.PRIVATE)
    public ResponseEntity<DomainRoutingResolveResponse> resolveGet(@RequestParam("domain") String domain,
                                                                   @RequestParam("subdomain") String subdomain,
                                                                   @RequestParam(value = "role", required = false) String role) {
        Optional<DomainRoutingResolveResponse> response = domainRoutingService.resolve(domain, subdomain, role);
        return response.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    // Resolve branding/theme by a fixed institute id (not by host). Used by
    // native flavors such as the Vacademy Admin app, which are anchored to a
    // single institute and have no meaningful WebView hostname.
    @GetMapping("/resolve-by-institute")
    @ClientCacheable(maxAgeSeconds = 7200, scope = CacheScope.PRIVATE)
    public ResponseEntity<DomainRoutingResolveResponse> resolveByInstitute(
            @RequestParam("instituteId") String instituteId) {
        Optional<DomainRoutingResolveResponse> response = domainRoutingService.resolveByInstituteId(instituteId);
        return response.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }
}


