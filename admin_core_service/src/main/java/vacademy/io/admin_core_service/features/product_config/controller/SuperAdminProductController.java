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
import vacademy.io.admin_core_service.features.product_config.dto.AlertResultDTO;
import vacademy.io.admin_core_service.features.product_config.dto.AlertTemplateDTO;
import vacademy.io.admin_core_service.features.product_config.dto.ProductInstituteDTO;
import vacademy.io.admin_core_service.features.product_config.dto.ProductSettingsDTO;
import vacademy.io.admin_core_service.features.product_config.dto.TrialChangeDTO;
import vacademy.io.admin_core_service.features.product_config.service.ProductAlertService;
import vacademy.io.admin_core_service.features.product_config.service.ProductSignupService;

import java.util.List;

/** The health dashboard's Products page. */
@RestController
@RequestMapping("/admin-core-service/super-admin/v1/products")
@RequiredArgsConstructor
public class SuperAdminProductController {

    private final PlatformProductService service;
    private final ProductSignupService signups;
    private final ProductAlertService alerts;

    @GetMapping
    public List<ProductSettingsDTO> list(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return service.list();
    }

    @PutMapping("/{productKey}")
    public ProductSettingsDTO update(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable String productKey, @RequestBody ProductSettingsDTO body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return service.update(productKey, body, user.getUsername());
    }

    @GetMapping("/{productKey}/institutes")
    public java.util.Map<String, Object> institutes(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable String productKey,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "0") int page,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "20") int size,
            @org.springframework.web.bind.annotation.RequestParam(required = false) String search,
            @org.springframework.web.bind.annotation.RequestParam(required = false) String status) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return signups.list(productKey, page, size, search, status);
    }

    @PutMapping("/{productKey}/institutes/{instituteId}/trial")
    public ProductInstituteDTO changeTrial(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable String productKey, @PathVariable String instituteId, @RequestBody TrialChangeDTO body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return signups.changeTrial(productKey, instituteId, body, user.getUsername());
    }

    @GetMapping("/{productKey}/alert-template")
    public AlertTemplateDTO alertTemplate(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable String productKey) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return alerts.template(productKey);
    }

    @org.springframework.web.bind.annotation.PostMapping("/{productKey}/alert-template")
    public AlertTemplateDTO registerAlertTemplate(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable String productKey, @RequestBody AlertTemplateDTO body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return alerts.registerTemplate(productKey, body.getBody());
    }

    @org.springframework.web.bind.annotation.PostMapping("/{productKey}/signup-alert/test")
    public AlertResultDTO testAlert(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable String productKey) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return alerts.sendTest(productKey);
    }
}
