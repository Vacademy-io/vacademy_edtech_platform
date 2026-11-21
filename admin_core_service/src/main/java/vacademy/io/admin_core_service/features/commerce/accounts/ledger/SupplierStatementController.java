package vacademy.io.admin_core_service.features.commerce.accounts.ledger;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAccess;
import vacademy.io.admin_core_service.features.commerce.accounts.ledger.SupplierStatementService.StatementView;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;

/** A supplier's statement ({@code GET /commerce/v1/suppliers/{id}/statement}): manager and accountant, any location. */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/suppliers")
public class SupplierStatementController {

    private final CommerceAccessGuard accessGuard;
    private final SupplierStatementService statementService;

    public SupplierStatementController(CommerceAccessGuard accessGuard, SupplierStatementService statementService) {
        this.accessGuard = accessGuard;
        this.statementService = statementService;
    }

    @GetMapping("/{supplierId}/statement")
    public ResponseEntity<StatementView> statement(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @PathVariable("supplierId") String supplierId,
            @RequestParam(value = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(value = "to", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        return ResponseEntity.ok(statementService.statement(instituteId, supplierId, from, to));
    }
}
