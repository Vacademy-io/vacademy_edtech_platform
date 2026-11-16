package vacademy.io.admin_core_service.features.commerce.storefront.controller;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.security.CommerceSetupAccess;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceCheckoutSettingsService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;
import java.util.Set;

/**
 * Checkout settings of a shop for staff:
 * <pre>
 * GET /admin-core-service/commerce/v1/checkout-settings?instituteId=
 * PUT /admin-core-service/commerce/v1/checkout-settings?instituteId=
 *     { "buyer_identity": "EITHER", "otp_institute_hourly_cap": 300,
 *       "cod": { "enabled": false, "max_order_value": 5000.00, "staff_confirm_threshold": 3000.00,
 *                "max_open_orders_per_phone": 2, "max_refusals": 2 },
 *       "orders": { "refund_shipping_on_rto": true } }
 * </pre>
 * The store manager writes; the accountant reads. A key left out of the PUT keeps its value.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/checkout-settings")
@RequiredArgsConstructor
public class CommerceCheckoutSettingsController {

    static final Set<CommerceRole> WRITE = Set.of(CommerceRole.STORE_MANAGER);
    static final Set<CommerceRole> READ = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);

    private final CommerceCheckoutSettingsService settingsService;
    private final CommerceSetupAccess setupAccess;

    @GetMapping
    public ResponseEntity<Map<String, Object>> get(@RequestParam("instituteId") String instituteId,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        setupAccess.require(user, instituteId, READ);
        return ResponseEntity.ok(settingsService.get(instituteId));
    }

    @PutMapping
    public ResponseEntity<Map<String, Object>> update(@RequestBody JsonNode body,
                                                      @RequestParam("instituteId") String instituteId,
                                                      @RequestAttribute("user") CustomUserDetails user) {
        setupAccess.require(user, instituteId, WRITE);
        return ResponseEntity.ok(settingsService.update(instituteId, user.getUserId(), body));
    }
}
