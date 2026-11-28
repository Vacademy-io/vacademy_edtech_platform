package vacademy.io.admin_core_service.features.commerce.tax.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.security.CommerceSetupAccess;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxClassDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxRateRuleDTO;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxClassService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Set;

/**
 * Tax classes and their rate rules ({@code /tax-classes}). The store
 * manager writes; the accountant reads, and so does warehouse staff, who pick a tax class when
 * they quick-add an item at the door. Setup belongs to no single feature,
 * so any commerce feature of the institute opens it.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/tax-classes")
@RequiredArgsConstructor
public class CommerceTaxClassController {

    private static final Set<CommerceRole> WRITE = Set.of(CommerceRole.STORE_MANAGER);
    private static final Set<CommerceRole> READ = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT,
            CommerceRole.WAREHOUSE_STAFF);

    private final CommerceTaxClassService taxClassService;
    private final CommerceSetupAccess setupAccess;

    @GetMapping
    public ResponseEntity<Page<TaxClassDTO>> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "50") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        setupAccess.require(user, instituteId, READ);
        return ResponseEntity.ok(taxClassService.list(instituteId, page, size));
    }

    @GetMapping("/{taxClassId}")
    public ResponseEntity<TaxClassDTO> get(
            @PathVariable("taxClassId") String taxClassId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        setupAccess.require(user, instituteId, READ);
        return ResponseEntity.ok(taxClassService.get(instituteId, taxClassId));
    }

    @PostMapping
    public ResponseEntity<TaxClassDTO> create(
            @RequestBody TaxClassDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        setupAccess.require(user, instituteId, WRITE);
        return ResponseEntity.ok(taxClassService.create(instituteId, user.getUserId(), request));
    }

    @PutMapping("/{taxClassId}")
    public ResponseEntity<TaxClassDTO> update(
            @PathVariable("taxClassId") String taxClassId,
            @RequestBody TaxClassDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        setupAccess.require(user, instituteId, WRITE);
        return ResponseEntity.ok(taxClassService.update(instituteId, user.getUserId(), taxClassId, request));
    }

    @PostMapping("/{taxClassId}/rate-rules")
    public ResponseEntity<TaxClassDTO> addRule(
            @PathVariable("taxClassId") String taxClassId,
            @RequestBody TaxRateRuleDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        setupAccess.require(user, instituteId, WRITE);
        return ResponseEntity.ok(taxClassService.addRule(instituteId, user.getUserId(), taxClassId, request));
    }

    @PutMapping("/{taxClassId}/rate-rules/{ruleId}")
    public ResponseEntity<TaxClassDTO> updateRule(
            @PathVariable("taxClassId") String taxClassId,
            @PathVariable("ruleId") String ruleId,
            @RequestBody TaxRateRuleDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        setupAccess.require(user, instituteId, WRITE);
        return ResponseEntity.ok(
                taxClassService.updateRule(instituteId, user.getUserId(), taxClassId, ruleId, request));
    }

    @DeleteMapping("/{taxClassId}/rate-rules/{ruleId}")
    public ResponseEntity<TaxClassDTO> deleteRule(
            @PathVariable("taxClassId") String taxClassId,
            @PathVariable("ruleId") String ruleId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        setupAccess.require(user, instituteId, WRITE);
        return ResponseEntity.ok(taxClassService.deleteRule(instituteId, user.getUserId(), taxClassId, ruleId));
    }
}
