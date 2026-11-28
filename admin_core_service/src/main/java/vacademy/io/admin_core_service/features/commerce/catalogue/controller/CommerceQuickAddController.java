package vacademy.io.admin_core_service.features.commerce.catalogue.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceQuickAddService;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceQuickAddService.QuickAddAnswer;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceQuickAddService.QuickAddRequest;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Set;

/**
 * {@code POST /commerce/v1/products/quick-add}: a DRAFT item with no price, made while receiving
 * goods. Feature {@code commerce.stock}; manager, warehouse staff or accountant.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/products")
@RequiredArgsConstructor
public class CommerceQuickAddController {

    private static final Set<CommerceRole> ROLES = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF,
            CommerceRole.ACCOUNTANT);

    private final CommerceAccessGuard accessGuard;
    private final CommerceQuickAddService quickAddService;

    @PostMapping("/quick-add")
    public ResponseEntity<QuickAddAnswer> quickAdd(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam("instituteId") String instituteId,
                                                   @RequestBody QuickAddRequest request) {
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, ROLES);
        return ResponseEntity.ok(quickAddService.quickAdd(instituteId, user.getUserId(), request));
    }
}
