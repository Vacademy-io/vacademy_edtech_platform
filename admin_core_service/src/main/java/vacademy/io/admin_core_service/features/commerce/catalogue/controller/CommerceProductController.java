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
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductStatusRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductSummaryResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Set;

/** Admin products. The product id in every path is the package id. */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/products")
@RequiredArgsConstructor
public class CommerceProductController {

    private final CommerceProductService productService;
    private final CommerceAccessGuard commerceAccessGuard;

    /** The catalogue is for the store manager (an institute ADMIN always passes). */
    private static final Set<CommerceRole> ROLES = Set.of(CommerceRole.STORE_MANAGER);

    @GetMapping
    public ResponseEntity<Page<ProductSummaryResponse>> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "collectionId", required = false) String collectionId,
            @RequestParam(value = "taxClassMissing", defaultValue = "false") boolean taxClassMissing,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(productService.list(instituteId, status, q, collectionId, taxClassMissing, page,
                size));
    }

    @GetMapping("/{packageId}")
    public ResponseEntity<ProductResponse> get(
            @PathVariable("packageId") String packageId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(productService.get(instituteId, packageId));
    }

    /** Creates a product with its variants, or updates the product that has the same external_ref. */
    @PostMapping
    public ResponseEntity<ProductResponse> save(
            @RequestBody ProductRequest request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(productService.save(instituteId, user.getUserId(), request));
    }

    @PutMapping("/{packageId}")
    public ResponseEntity<ProductResponse> update(
            @PathVariable("packageId") String packageId,
            @RequestBody ProductRequest request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(productService.update(instituteId, user.getUserId(), packageId, request));
    }

    /** Publish (ACTIVE), unpublish (DRAFT) or archive (ARCHIVED). */
    @PostMapping("/{packageId}/status")
    public ResponseEntity<ProductResponse> changeStatus(
            @PathVariable("packageId") String packageId,
            @RequestBody ProductStatusRequest request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(productService.changeStatus(instituteId, user.getUserId(), packageId,
                request == null ? null : request.getStatus()));
    }
}
