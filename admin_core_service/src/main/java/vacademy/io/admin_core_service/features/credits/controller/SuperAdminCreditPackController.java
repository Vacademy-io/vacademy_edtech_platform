package vacademy.io.admin_core_service.features.credits.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.credits.dto.CreditPackAdminDTO;
import vacademy.io.admin_core_service.features.credits.service.CreditPackAdminService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.List;

/** Health dashboard: credit packs, the prices customers pay to recharge. */
@RestController
@RequestMapping("/admin-core-service/super-admin/v1/credit-packs")
@RequiredArgsConstructor
public class SuperAdminCreditPackController {

    private final CreditPackAdminService service;

    @GetMapping
    public List<CreditPackAdminDTO> list(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return service.list();
    }

    @PutMapping("/{packId}")
    public CreditPackAdminDTO update(@RequestAttribute("user") CustomUserDetails user,
            @PathVariable String packId, @RequestBody CreditPackAdminDTO body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return service.update(packId, body);
    }
}
