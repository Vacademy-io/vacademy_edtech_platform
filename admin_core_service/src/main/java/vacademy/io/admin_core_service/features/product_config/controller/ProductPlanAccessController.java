package vacademy.io.admin_core_service.features.product_config.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.product_config.dto.ProductPlanAccessDTO;
import vacademy.io.admin_core_service.features.product_config.service.ProductPlanAccessService;
import vacademy.io.common.auth.model.CustomUserDetails;

/** The product app (Evalezy) asks what its workspace bought: trial or plan, and how many users. */
@RestController
@RequestMapping("/admin-core-service/product/v1/institutes")
@RequiredArgsConstructor
public class ProductPlanAccessController {

    private final ProductPlanAccessService service;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping("/{instituteId}/plan-access")
    public ProductPlanAccessDTO planAccess(@PathVariable String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return service.access(instituteId);
    }
}
