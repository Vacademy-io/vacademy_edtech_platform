package vacademy.io.admin_core_service.features.commerce.catalogue.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Set;

/**
 * Admin variants. The variant id in every path is the package session id. Writes go through the
 * product service, so the rules on the whole variant set of the product are checked each time.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/variants")
@RequiredArgsConstructor
public class CommerceVariantController {

    private final CommerceProductService productService;
    private final CommerceAccessGuard commerceAccessGuard;

    /** The catalogue is for the store manager (an institute ADMIN always passes). */
    private static final Set<CommerceRole> ROLES = Set.of(CommerceRole.STORE_MANAGER);

    @GetMapping
    public ResponseEntity<Page<VariantResponse>> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("packageId") String packageId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "50") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(productService.listVariants(instituteId, packageId, page, size));
    }

    @GetMapping("/{packageSessionId}")
    public ResponseEntity<VariantResponse> get(
            @PathVariable("packageSessionId") String packageSessionId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(productService.getVariant(instituteId, packageSessionId));
    }

    /** Adds or updates variants of one product in one transaction. */
    @PostMapping
    public ResponseEntity<ProductResponse> save(
            @RequestBody List<VariantRequest> variants,
            @RequestParam("instituteId") String instituteId,
            @RequestParam("packageId") String packageId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(productService.saveVariants(instituteId, user.getUserId(), packageId, variants));
    }

    /** Updates one variant: price, status (ARCHIVED retires it), name, SKU and the rest. */
    @PutMapping("/{packageSessionId}")
    public ResponseEntity<ProductResponse> update(
            @PathVariable("packageSessionId") String packageSessionId,
            @RequestBody VariantRequest request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(productService.updateVariant(instituteId, user.getUserId(), packageSessionId,
                request));
    }
}
