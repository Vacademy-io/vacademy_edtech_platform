package vacademy.io.admin_core_service.features.commerce.accounts.supplier;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAccess;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAuditKinds;
import vacademy.io.admin_core_service.features.commerce.accounts.crypto.CommerceFieldCipher;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplier;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplierSecret;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierSecretRepository;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class SupplierSensitiveServiceTest {

    private static final String INST = "inst-1";
    private static final String PAN = SupplierRulesTest.PAN;

    private CommerceAccessGuard guard;
    private CommerceSupplierRepository suppliers;
    private CommerceSupplierSecretRepository secrets;
    private CommerceAuditService audit;
    private CustomUserDetails user;
    private SupplierDtos.SensitiveRequest panField;

    @BeforeEach
    void setUp() {
        guard = mock(CommerceAccessGuard.class);
        suppliers = mock(CommerceSupplierRepository.class);
        secrets = mock(CommerceSupplierSecretRepository.class);
        audit = mock(CommerceAuditService.class);
        user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("user-1");
        CommerceSupplier s = new CommerceSupplier();
        s.setId("sup-1");
        s.setInstituteId(INST);
        when(suppliers.findByInstituteIdAndId(INST, "sup-1")).thenReturn(Optional.of(s));
        panField = new SupplierDtos.SensitiveRequest();
        panField.setField("pan");
    }

    private static CommerceFieldCipher cipherWithTestKey() {
        byte[] raw = new byte[32];
        new SecureRandom().nextBytes(raw);
        return new CommerceFieldCipher("t1:" + Base64.getEncoder().encodeToString(raw), "");
    }

    private SupplierSensitiveService service(CommerceFieldCipher cipher) {
        return new SupplierSensitiveService(guard, suppliers, secrets, cipher, audit,
                mock(PlatformTransactionManager.class));
    }

    private static CommerceSupplierSecret secret(CommerceFieldCipher cipher) {
        CommerceSupplierSecret row = new CommerceSupplierSecret();
        row.setInstituteId(INST);
        row.setSupplierId("sup-1");
        row.setPanEncrypted(cipher.encrypt(PAN, CommerceFieldCipher.aad(INST, "sup-1", "pan")));
        row.setKeyId("t1");
        row.setPanHash("ab".repeat(32));
        row.setPanLast4(PAN.substring(6));
        return row;
    }

    @Test
    void revealReturnsThePanAndAuditsWithoutIt() {
        CommerceFieldCipher cipher = cipherWithTestKey();
        when(secrets.findByInstituteIdAndSupplierId(INST, "sup-1")).thenReturn(Optional.of(secret(cipher)));
        Map<String, Object> answer = service(cipher).reveal(user, INST, "sup-1", panField);
        assertEquals("sup-1", answer.get("supplier_id"));
        assertEquals(PAN, answer.get("pan"));
        verify(guard).requireInstituteWide(user, INST, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq(INST), eq("user-1"), isNull(), eq(AccountsAuditKinds.SUPPLIER_SENSITIVE_VIEW),
                eq("SUPPLIER"), eq("sup-1"), isNull(), json.capture(), isNull());
        assertEquals("{\"field\":\"pan\",\"pan_last4\":\"" + PAN.substring(6) + "\"}", json.getValue());
        assertFalse(json.getValue().contains(PAN));
    }

    @Test
    void noStoredPanAnswersNullAndStillAudits() {
        Map<String, Object> answer = service(cipherWithTestKey()).reveal(user, INST, "sup-1", panField);
        assertTrue(answer.containsKey("pan"));
        assertNull(answer.get("pan"));
        verify(audit).record(eq(INST), eq("user-1"), isNull(), eq(AccountsAuditKinds.SUPPLIER_SENSITIVE_VIEW),
                eq("SUPPLIER"), eq("sup-1"), isNull(), eq("{\"field\":\"pan\",\"has_pan\":false}"), isNull());
    }

    @Test
    void noKeyIs503AndNothingIsAudited() {
        CommerceSupplierSecret row = secret(cipherWithTestKey());
        when(secrets.findByInstituteIdAndSupplierId(INST, "sup-1")).thenReturn(Optional.of(row));
        VacademyException e = assertThrows(VacademyException.class,
                () -> service(new CommerceFieldCipher("", "")).reveal(user, INST, "sup-1", panField));
        assertEquals(503, e.getStatus().value());
        assertFalse(e.getMessage().contains(PAN));
        verifyNoInteractions(audit);
    }

    @Test
    void unreadableValueIs500WithoutTheValue() {
        CommerceSupplierSecret row = secret(cipherWithTestKey());
        when(secrets.findByInstituteIdAndSupplierId(INST, "sup-1")).thenReturn(Optional.of(row));
        // Same key id, other key bytes: the check fails.
        VacademyException e = assertThrows(VacademyException.class,
                () -> service(cipherWithTestKey()).reveal(user, INST, "sup-1", panField));
        assertEquals(500, e.getStatus().value());
        assertTrue(e.getMessage().startsWith("STORED_VALUE_UNREADABLE: "));
        verifyNoInteractions(audit);
    }

    @Test
    void anotherInstitutesSupplierIs404() {
        when(suppliers.findByInstituteIdAndId(eq(INST), anyString())).thenReturn(Optional.empty());
        VacademyException e = assertThrows(VacademyException.class,
                () -> service(cipherWithTestKey()).reveal(user, INST, "sup-of-inst-2", panField));
        assertEquals(404, e.getStatus().value());
        verifyNoInteractions(secrets, audit);
    }

    @Test
    void guardRefusalReadsNothingAndOnlyThePanFieldIsAccepted() {
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.INSTITUTE_WIDE_REQUIRED, "no"))
                .when(guard).requireInstituteWide(user, INST, CommerceFeature.ACCOUNTS, AccountsAccess.ACCOUNTS_STAFF);
        assertThrows(CommerceAccessDeniedException.class,
                () -> service(cipherWithTestKey()).reveal(user, INST, "sup-1", panField));
        verifyNoInteractions(suppliers, secrets, audit);

        setUp();
        SupplierDtos.SensitiveRequest other = new SupplierDtos.SensitiveRequest();
        other.setField("gstin");
        assertThrows(InvalidRequestException.class, () -> service(cipherWithTestKey()).reveal(user, INST, "sup-1", other));
        assertThrows(InvalidRequestException.class, () -> service(cipherWithTestKey()).reveal(user, INST, "sup-1", null));
        verifyNoInteractions(secrets, audit);
    }
}
