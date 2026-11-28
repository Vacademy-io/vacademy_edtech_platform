package vacademy.io.admin_core_service.features.commerce.tax.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.security.CommerceSetupAccess;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxSettingDTO;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Set;

/**
 * Tax mode and the calculator settings (under {@code /settings}).
 * The store manager writes; the accountant reads. The same two calls also answer on
 * {@code /settings}, the path the admin app uses. Setup belongs to no single feature,
 * so any commerce feature of the institute opens it.
 */
@RestController
@RequestMapping({"/admin-core-service/commerce/v1/settings/tax", "/admin-core-service/commerce/v1/settings"})
@RequiredArgsConstructor
public class CommerceTaxSettingController {

    private static final Set<CommerceRole> WRITE = Set.of(CommerceRole.STORE_MANAGER);
    private static final Set<CommerceRole> READ = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);

    private final CommerceTaxSettingService taxSettingService;
    private final CommerceSetupAccess setupAccess;

    @GetMapping
    public ResponseEntity<TaxSettingDTO> get(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        setupAccess.require(user, instituteId, READ);
        return ResponseEntity.ok(taxSettingService.get(instituteId));
    }

    @PutMapping
    public ResponseEntity<TaxSettingDTO> update(
            @RequestBody TaxSettingDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        setupAccess.require(user, instituteId, WRITE);
        return ResponseEntity.ok(taxSettingService.update(instituteId, user.getUserId(), request));
    }
}
