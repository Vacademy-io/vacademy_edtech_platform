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
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.CollectionDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.CollectionProductsRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceCollectionService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Set;

/** Admin categories and collections. A collection is retired by status ARCHIVED, never deleted. */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/collections")
@RequiredArgsConstructor
public class CommerceCollectionController {

    private final CommerceCollectionService collectionService;
    private final CommerceAccessGuard commerceAccessGuard;

    /** The catalogue is for the store manager (an institute ADMIN always passes). */
    private static final Set<CommerceRole> ROLES = Set.of(CommerceRole.STORE_MANAGER);

    @GetMapping
    public ResponseEntity<Page<CollectionDTO>> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "50") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(collectionService.list(instituteId, page, size));
    }

    @GetMapping("/tree")
    public ResponseEntity<List<CollectionDTO>> tree(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(collectionService.tree(instituteId));
    }

    @GetMapping("/{collectionId}")
    public ResponseEntity<CollectionDTO> get(
            @PathVariable("collectionId") String collectionId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(collectionService.get(instituteId, collectionId));
    }

    @PostMapping
    public ResponseEntity<CollectionDTO> create(
            @RequestBody CollectionDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(collectionService.create(instituteId, user.getUserId(), request));
    }

    @PutMapping("/{collectionId}")
    public ResponseEntity<CollectionDTO> update(
            @PathVariable("collectionId") String collectionId,
            @RequestBody CollectionDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(collectionService.update(instituteId, user.getUserId(), collectionId, request));
    }

    @GetMapping("/{collectionId}/products")
    public ResponseEntity<List<String>> products(
            @PathVariable("collectionId") String collectionId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(collectionService.products(instituteId, collectionId));
    }

    @PutMapping("/{collectionId}/products")
    public ResponseEntity<List<String>> setProducts(
            @PathVariable("collectionId") String collectionId,
            @RequestBody CollectionProductsRequest request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(collectionService.setProducts(instituteId, user.getUserId(), collectionId,
                request == null ? null : request.getPackageIds()));
    }
}
