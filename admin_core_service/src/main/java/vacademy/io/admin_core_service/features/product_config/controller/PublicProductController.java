package vacademy.io.admin_core_service.features.product_config.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.product_config.dto.PublicProductOfferDTO;
import vacademy.io.admin_core_service.features.product_config.service.PlatformProductService;

import java.util.concurrent.TimeUnit;

/** No login: a product's website and sign-up page read the trial offer the health dashboard set. */
@RestController
@RequestMapping("/admin-core-service/public/product/v1")
@RequiredArgsConstructor
public class PublicProductController {

    private final PlatformProductService service;

    @GetMapping("/{productKey}/offer")
    public ResponseEntity<PublicProductOfferDTO> offer(@PathVariable String productKey) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(5, TimeUnit.MINUTES).cachePublic())
                .body(service.publicOffer(productKey));
    }
}
