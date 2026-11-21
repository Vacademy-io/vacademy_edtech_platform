package vacademy.io.admin_core_service.features.commerce.accounts;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.accounts.crypto.CommerceFieldCipher;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierSecretRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockAccess;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * {@code /commerce/v1/accounts}: what the signed-in staff member may do in the accounts work, and
 * (institute ADMIN) whether field encryption is set up. Neither answer holds key material or a PAN.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/accounts")
@RequiredArgsConstructor
public class AccountsMeController {

    private final CommerceAccessGuard accessGuard;
    private final CommerceFieldCipher cipher;
    private final CommerceSupplierSecretRepository secretRepository;

    @GetMapping("/me")
    public ResponseEntity<Map<String, Object>> me(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestParam("instituteId") String instituteId) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ANY_STAFF);
        List<String> roles = CommerceAccessGuard.rolesOf(user).stream().map(CommerceRole::authority).sorted().toList();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("institute_wide", accessGuard.isInstituteWide(user, instituteId));
        out.put("roles", roles);
        out.put("is_admin", StockAccess.isAdmin(user));
        return ResponseEntity.ok(out);
    }

    @GetMapping("/encryption-status")
    public ResponseEntity<Map<String, Object>> encryptionStatus(@RequestAttribute("user") CustomUserDetails user,
                                                                @RequestParam("instituteId") String instituteId) {
        accessGuard.require(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ADMIN_ONLY);
        boolean configured = cipher.isConfigured();
        Map<String, Long> rows = new LinkedHashMap<>();
        for (Object[] row : secretRepository.countByKeyId(instituteId)) {
            rows.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("configured", configured);
        out.put("active_key_id", cipher.activeKeyId());
        out.put("previous_key_ids", cipher.previousKeyIds());
        out.put("round_trip_ok", configured ? cipher.roundTrip() : null);
        out.put("rows_by_key_id", rows);
        return ResponseEntity.ok(out);
    }
}
