package vacademy.io.admin_core_service.features.commerce.order.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.order.dto.ShippingRuleDTO;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceShippingRuleService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.security.CommerceSetupAccess;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Set;

/**
 * The delivery charge rule ({@code /shipping-rule} under Setup). The
 * store manager writes; the accountant reads. The institute is the one the guard checked.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/shipping-rule")
@RequiredArgsConstructor
public class CommerceShippingRuleController {

    private static final Set<CommerceRole> WRITE = Set.of(CommerceRole.STORE_MANAGER);
    private static final Set<CommerceRole> READ = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);

    private final CommerceShippingRuleService shippingRuleService;
    private final CommerceSetupAccess setupAccess;

    @GetMapping
    public ResponseEntity<ShippingRuleDTO> get(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        setupAccess.require(user, instituteId, READ);
        return ResponseEntity.ok(shippingRuleService.get(instituteId));
    }

    @PutMapping
    public ResponseEntity<ShippingRuleDTO> save(
            @RequestBody ShippingRuleDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        setupAccess.require(user, instituteId, WRITE);
        return ResponseEntity.ok(shippingRuleService.save(instituteId, user.getUserId(), request));
    }
}
