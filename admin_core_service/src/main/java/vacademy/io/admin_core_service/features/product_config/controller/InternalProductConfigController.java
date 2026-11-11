package vacademy.io.admin_core_service.features.product_config.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.product_config.service.PlatformProductService;
import vacademy.io.admin_core_service.features.product_config.dto.AlertResultDTO;
import vacademy.io.admin_core_service.features.product_config.dto.ProductSettingsDTO;
import vacademy.io.admin_core_service.features.product_config.dto.SignupEventDTO;
import vacademy.io.admin_core_service.features.product_config.dto.SignupRulesDTO;
import vacademy.io.admin_core_service.features.telleo.service.TelleoTrialService;
import vacademy.io.admin_core_service.features.product_config.service.ProductAlertService;

/** Service to service (HMAC): auth-service and notification-service read a product's settings here. */
@RestController
@RequestMapping("/admin-core-service/internal/product-config/v1")
@RequiredArgsConstructor
public class InternalProductConfigController {

    private final PlatformProductService service;
    private final ProductAlertService alerts;
    private final TelleoTrialService trialService;

    @GetMapping("/{productKey}")
    public ProductSettingsDTO get(@PathVariable String productKey) {
        return service.get(productKey);
    }

    /** auth_service: how this product's sign-up form differs from the default. Empty = default. */
    @GetMapping("/{productKey}/signup-rules")
    public SignupRulesDTO signupRules(@PathVariable String productKey) {
        return service.signupRulesFor(productKey);
    }

    /**
     * auth_service, before it sends a phone code and again before it creates anything: one free
     * trial per phone. The unique key on telleo_trial_phone is the final word; this only lets the
     * form say so early.
     */
    @GetMapping("/{productKey}/trial-phone-available")
    public java.util.Map<String, Object> trialPhoneAvailable(@PathVariable String productKey,
            @org.springframework.web.bind.annotation.RequestParam String phone) {
        boolean locked = service.signupRulesFor(productKey).locksTrialDialling();
        return java.util.Map.of("available", !locked || trialService.isPhoneAvailable(phone));
    }

    /** auth_service, after a self sign-up: tell the team. */
    @org.springframework.web.bind.annotation.PostMapping("/{productKey}/signup-event")
    public AlertResultDTO signupEvent(@org.springframework.web.bind.annotation.PathVariable String productKey,
            @org.springframework.web.bind.annotation.RequestBody SignupEventDTO event) {
        return alerts.signupCompleted(productKey, event);
    }
}
