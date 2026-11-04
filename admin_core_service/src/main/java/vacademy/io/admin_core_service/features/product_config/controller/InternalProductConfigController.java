package vacademy.io.admin_core_service.features.product_config.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.product_config.service.PlatformProductService;
import vacademy.io.common.product.ProductConfigDTO;

/** Service to service (HMAC): auth-service and notification-service read a product's settings here. */
@RestController
@RequestMapping("/admin-core-service/internal/product-config/v1")
@RequiredArgsConstructor
public class InternalProductConfigController {

    private final PlatformProductService service;

    @GetMapping("/{productKey}")
    public ProductConfigDTO get(@PathVariable String productKey) {
        return service.get(productKey);
    }
}
