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
import vacademy.io.admin_core_service.features.product_config.service.ProductAlertService;

/** Service to service (HMAC): auth-service and notification-service read a product's settings here. */
@RestController
@RequestMapping("/admin-core-service/internal/product-config/v1")
@RequiredArgsConstructor
public class InternalProductConfigController {

    private final PlatformProductService service;
    private final ProductAlertService alerts;

    @GetMapping("/{productKey}")
    public ProductSettingsDTO get(@PathVariable String productKey) {
        return service.get(productKey);
    }

    /** auth_service, after a self sign-up: tell the team. */
    @org.springframework.web.bind.annotation.PostMapping("/{productKey}/signup-event")
    public AlertResultDTO signupEvent(@org.springframework.web.bind.annotation.PathVariable String productKey,
            @org.springframework.web.bind.annotation.RequestBody SignupEventDTO event) {
        return alerts.signupCompleted(productKey, event);
    }
}
