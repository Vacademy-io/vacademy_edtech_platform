package vacademy.io.admin_core_service.features.commerce.accounts.supplier;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAccess;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.LookupRow;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SensitiveRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.StatusRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRow;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierView;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

/**
 * Suppliers ({@code /commerce/v1/suppliers}), under the accounts feature. Suppliers belong to the
 * whole institute, so no location is checked. Manager and accountant read and write; every commerce
 * role may use the picker; the full PAN is shown to institute-wide staff only.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/suppliers")
@RequiredArgsConstructor
public class SupplierController {

    private final CommerceAccessGuard accessGuard;
    private final SupplierService supplierService;
    private final SupplierSensitiveService sensitiveService;

    @GetMapping
    public ResponseEntity<Page<SupplierRow>> list(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestParam("instituteId") String instituteId,
                                                  @RequestParam(value = "q", required = false) String q,
                                                  @RequestParam(value = "group", required = false) String group,
                                                  @RequestParam(value = "status", required = false) String status,
                                                  @RequestParam(value = "hasDue", defaultValue = "false") boolean hasDue,
                                                  @RequestParam(value = "page", defaultValue = "0") int page,
                                                  @RequestParam(value = "size", defaultValue = "50") int size) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        return ResponseEntity.ok(supplierService.list(instituteId, q, group, status, hasDue, page, size));
    }

    @GetMapping("/lookup")
    public ResponseEntity<List<LookupRow>> lookup(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestParam("instituteId") String instituteId,
                                                  @RequestParam(value = "q", required = false) String q) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ANY_STAFF);
        return ResponseEntity.ok(supplierService.lookup(instituteId, q));
    }

    @GetMapping("/groups")
    public ResponseEntity<List<String>> groups(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestParam("instituteId") String instituteId) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        return ResponseEntity.ok(supplierService.groups(instituteId));
    }

    @PostMapping
    public ResponseEntity<SupplierView> create(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestParam("instituteId") String instituteId,
                                               @RequestBody SupplierRequest request) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(supplierService.create(instituteId, user.getUserId(), request));
    }

    @GetMapping("/{supplierId}")
    public ResponseEntity<SupplierView> get(@RequestAttribute("user") CustomUserDetails user,
                                            @RequestParam("instituteId") String instituteId,
                                            @PathVariable("supplierId") String supplierId) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        return ResponseEntity.ok(supplierService.get(instituteId, supplierId));
    }

    @PutMapping("/{supplierId}")
    public ResponseEntity<SupplierView> update(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestParam("instituteId") String instituteId,
                                               @PathVariable("supplierId") String supplierId,
                                               @RequestBody SupplierRequest request) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        return ResponseEntity.ok(supplierService.update(instituteId, user.getUserId(), supplierId, request));
    }

    @PostMapping("/{supplierId}/status")
    public ResponseEntity<SupplierView> setStatus(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestParam("instituteId") String instituteId,
                                                  @PathVariable("supplierId") String supplierId,
                                                  @RequestBody StatusRequest request) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        return ResponseEntity.ok(supplierService.setStatus(instituteId, user.getUserId(), supplierId, request));
    }

    /** The full PAN; institute-wide manager or accountant; audited; never cached. */
    @PostMapping("/{supplierId}/sensitive")
    public ResponseEntity<Map<String, Object>> sensitive(@RequestAttribute("user") CustomUserDetails user,
                                                         @RequestParam("instituteId") String instituteId,
                                                         @PathVariable("supplierId") String supplierId,
                                                         @RequestBody(required = false) SensitiveRequest request) {
        Map<String, Object> body = sensitiveService.reveal(user, instituteId, supplierId, request);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }
}
