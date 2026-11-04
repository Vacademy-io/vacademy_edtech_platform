package vacademy.io.admin_core_service.features.product_config.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.product_config.service.PlatformProductService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.product.ProductConfigDTO;

import java.util.List;

/** The health dashboard's Products page. */
@RestController
@RequestMapping("/admin-core-service/super-admin/v1/products")
@RequiredArgsConstructor
public class SuperAdminProductController {

    private final PlatformProductService service;

    @GetMapping
    public List<ProductConfigDTO> list(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return service.list();
    }

    @PutMapping("/{productKey}")
    public ProductConfigDTO update(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable String productKey, @RequestBody ProductConfigDTO body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return service.update(productKey, body, user.getUsername());
    }
}
