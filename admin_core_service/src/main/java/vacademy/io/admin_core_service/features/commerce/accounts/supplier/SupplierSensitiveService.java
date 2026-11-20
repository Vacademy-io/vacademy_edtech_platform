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
import vacademy.io.admin_core_service.features.commerce.otp.CommerceRateLimiter;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Shows a supplier's full PAN to an institute-wide manager or accountant. Every reveal is audited
 * (without the value) in the transaction of the read: when the audit row cannot be written, nothing
 * is shown. A refused reveal (key not loaded, value unreadable) is audited with its outcome in a
 * transaction of its own. At most {@value #REVEAL_LIMIT} reveals per user per institute per 10 minutes.
 */
@Service
public class SupplierSensitiveService {

    static final String RATE_SCOPE = "supplier-pan-reveal";
    static final Duration REVEAL_WINDOW = Duration.ofMinutes(10);
    static final int REVEAL_LIMIT = 30;
    static final String OUTCOME_KEY_NOT_LOADED = "KEY_NOT_LOADED";
    static final String OUTCOME_UNREADABLE = "UNREADABLE";

    private final CommerceAccessGuard accessGuard;
    private final CommerceSupplierRepository supplierRepository;
    private final CommerceSupplierSecretRepository secretRepository;
    private final CommerceFieldCipher cipher;
    private final CommerceAuditService auditService;
    private final CommerceRateLimiter rateLimiter;
    private final TransactionTemplate transaction;

    public SupplierSensitiveService(CommerceAccessGuard accessGuard,
                                    CommerceSupplierRepository supplierRepository,
                                    CommerceSupplierSecretRepository secretRepository,
                                    CommerceFieldCipher cipher,
                                    CommerceAuditService auditService,
                                    CommerceRateLimiter rateLimiter,
                                    PlatformTransactionManager transactionManager) {
        this.accessGuard = accessGuard;
        this.supplierRepository = supplierRepository;
        this.secretRepository = secretRepository;
        this.cipher = cipher;
        this.auditService = auditService;
        this.rateLimiter = rateLimiter;
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
        if (!rateLimiter.allow(instituteId, RATE_SCOPE, user.getUserId(), REVEAL_WINDOW, REVEAL_LIMIT)) {
            throw new VacademyException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited: at most " + REVEAL_LIMIT
                    + " PAN views per 10 minutes; try again later");
        }
        try {
            return transaction.execute(status -> read(user, instituteId, id));
        } catch (Refused refused) {
            // The read rolled back; the refusal is recorded on its own, without any value.
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("field", SupplierService.FIELD_PAN);
            detail.put("outcome", refused.outcome);
            transaction.executeWithoutResult(status -> auditService.record(instituteId, user.getUserId(), null,
                    AccountsAuditKinds.SUPPLIER_SENSITIVE_VIEW, AccountsAuditKinds.REF_SUPPLIER, id, null,
                    CommerceInputRules.json(detail), null));
            throw refused.answer;
        }
    }

    private Map<String, Object> read(CustomUserDetails user, String instituteId, String id) {
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
    }

    private String decrypt(String instituteId, String supplierId, CommerceSupplierSecret secret) {
        try {
            return cipher.decrypt(secret.getPanEncrypted(),
                    CommerceFieldCipher.aad(instituteId, supplierId, SupplierService.FIELD_PAN));
        } catch (IllegalStateException e) {
            throw new Refused(OUTCOME_UNREADABLE, new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "STORED_VALUE_UNREADABLE: the stored PAN cannot be read"));
        } catch (VacademyException e) {
            if (e.getStatus() != null && e.getStatus().value() == HttpStatus.SERVICE_UNAVAILABLE.value()) {
                throw new Refused(OUTCOME_KEY_NOT_LOADED, e);
            }
            throw e;
        }
    }

    /** A reveal refused after the supplier was found: rolls the read back, then is audited and answered. */
    private static final class Refused extends RuntimeException {
        private final String outcome;
        private final VacademyException answer;

        Refused(String outcome, VacademyException answer) {
            super(outcome, null, false, false);
            this.outcome = outcome;
            this.answer = answer;
        }
    }
}
