package vacademy.io.admin_core_service.features.commerce.accounts.supplier;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAccess;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAuditKinds;
import vacademy.io.admin_core_service.features.commerce.accounts.crypto.CommerceFieldCipher;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplierSecret;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierSecretRepository;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Shows a supplier's full PAN to an institute-wide manager or accountant. Every reveal is audited
 * (without the value) in the transaction of the read: when the audit row cannot be written, nothing
 * is shown.
 */
@Service
public class SupplierSensitiveService {

    private final CommerceAccessGuard accessGuard;
    private final CommerceSupplierRepository supplierRepository;
    private final CommerceSupplierSecretRepository secretRepository;
    private final CommerceFieldCipher cipher;
    private final CommerceAuditService auditService;
    private final TransactionTemplate transaction;

    public SupplierSensitiveService(CommerceAccessGuard accessGuard,
                                    CommerceSupplierRepository supplierRepository,
                                    CommerceSupplierSecretRepository secretRepository,
                                    CommerceFieldCipher cipher,
                                    CommerceAuditService auditService,
                                    PlatformTransactionManager transactionManager) {
        this.accessGuard = accessGuard;
        this.supplierRepository = supplierRepository;
        this.secretRepository = secretRepository;
        this.cipher = cipher;
        this.auditService = auditService;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    /** {@code {supplier_id, pan}}; {@code pan} is null when none is stored. */
    public Map<String, Object> reveal(CustomUserDetails user, String instituteId, String supplierId,
                                      SupplierDtos.SensitiveRequest request) {
        accessGuard.requireInstituteWide(user, instituteId, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        if (request == null || !SupplierService.FIELD_PAN.equals(SupplierRules.trim(request.getField()))) {
            throw SupplierRules.validation("field must be pan");
        }
        String id = SupplierRules.trim(supplierId);
        return transaction.execute(status -> {
            if (id == null || id.length() > 36 || supplierRepository.findByInstituteIdAndId(instituteId, id).isEmpty()) {
                throw SupplierService.notFound();
            }
            Optional<CommerceSupplierSecret> secret = secretRepository.findByInstituteIdAndSupplierId(instituteId, id);
            String pan = null;
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("field", SupplierService.FIELD_PAN);
            if (secret.isEmpty()) {
                detail.put("has_pan", false);
            } else {
                pan = decrypt(instituteId, id, secret.get());
                detail.put("pan_last4", secret.get().getPanLast4());
            }
            auditService.record(instituteId, user.getUserId(), null, AccountsAuditKinds.SUPPLIER_SENSITIVE_VIEW,
                    AccountsAuditKinds.REF_SUPPLIER, id, null, CommerceInputRules.json(detail), null);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("supplier_id", id);
            out.put("pan", pan);
            return out;
        });
    }

    private String decrypt(String instituteId, String supplierId, CommerceSupplierSecret secret) {
        try {
            return cipher.decrypt(secret.getPanEncrypted(),
                    CommerceFieldCipher.aad(instituteId, supplierId, SupplierService.FIELD_PAN));
        } catch (IllegalStateException e) {
            throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "STORED_VALUE_UNREADABLE: the stored PAN cannot be read");
        }
    }
}
