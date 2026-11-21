package vacademy.io.admin_core_service.features.commerce.catalogue.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.AttributeDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.AttributeValueDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceAttributeService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Set;

/** Admin attributes and attribute values. */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/attributes")
@RequiredArgsConstructor
public class CommerceAttributeController {

    private final CommerceAttributeService attributeService;
    private final CommerceAccessGuard commerceAccessGuard;

    /** The catalogue is for the store manager (an institute ADMIN always passes). */
    private static final Set<CommerceRole> ROLES = Set.of(CommerceRole.STORE_MANAGER);

    @GetMapping
    public ResponseEntity<Page<AttributeDTO>> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "50") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(attributeService.list(instituteId, page, size));
    }

    @GetMapping("/{attributeId}")
    public ResponseEntity<AttributeDTO> get(
            @PathVariable("attributeId") String attributeId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(attributeService.get(instituteId, attributeId));
    }

    @PostMapping
    public ResponseEntity<AttributeDTO> create(
            @RequestBody AttributeDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(attributeService.create(instituteId, user.getUserId(), request));
    }

    @PutMapping("/{attributeId}")
    public ResponseEntity<AttributeDTO> update(
            @PathVariable("attributeId") String attributeId,
            @RequestBody AttributeDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(attributeService.update(instituteId, user.getUserId(), attributeId, request));
    }

    @DeleteMapping("/{attributeId}")
    public ResponseEntity<Void> delete(
            @PathVariable("attributeId") String attributeId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        attributeService.delete(instituteId, user.getUserId(), attributeId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{attributeId}/values")
    public ResponseEntity<AttributeValueDTO> createValue(
            @PathVariable("attributeId") String attributeId,
            @RequestBody AttributeValueDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(attributeService.createValue(instituteId, user.getUserId(), attributeId, request));
    }

    @PutMapping("/{attributeId}/values/{valueId}")
    public ResponseEntity<AttributeValueDTO> updateValue(
            @PathVariable("attributeId") String attributeId,
            @PathVariable("valueId") String valueId,
            @RequestBody AttributeValueDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(
                attributeService.updateValue(instituteId, user.getUserId(), attributeId, valueId, request));
    }

    @DeleteMapping("/{attributeId}/values/{valueId}")
    public ResponseEntity<Void> deleteValue(
            @PathVariable("attributeId") String attributeId,
            @PathVariable("valueId") String valueId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        attributeService.deleteValue(instituteId, user.getUserId(), attributeId, valueId);
        return ResponseEntity.noContent().build();
    }
}
