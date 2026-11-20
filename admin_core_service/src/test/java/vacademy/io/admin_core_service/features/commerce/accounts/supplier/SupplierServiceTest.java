package vacademy.io.admin_core_service.features.commerce.accounts.supplier;

import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAuditKinds;
import vacademy.io.admin_core_service.features.commerce.accounts.crypto.CommerceFieldCipher;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceAccountHead;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplier;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceAccountHeadRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierLedgerRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierSecretRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.StatusRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRow;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierView;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class SupplierServiceTest {

    private static final String INST = "inst-1";
    private static final String ACTOR = "user-1";
    private static final String PAN = SupplierRulesTest.PAN;
    private static final String GSTIN = SupplierRulesTest.GSTIN;

    private CommerceSupplierRepository suppliers;
    private CommerceSupplierSecretRepository secrets;
    private CommerceSupplierLedgerRepository ledger;
    private CommerceAccountHeadRepository heads;
    private CommerceCustomerRepository customers;
    private CommerceCounterService counters;
    private CommerceAuditService audit;
    private CommerceFieldCipher cipher;
    private SupplierService service;

    @BeforeEach
    void setUp() {
        suppliers = mock(CommerceSupplierRepository.class);
        secrets = mock(CommerceSupplierSecretRepository.class);
        ledger = mock(CommerceSupplierLedgerRepository.class);
        heads = mock(CommerceAccountHeadRepository.class);
        customers = mock(CommerceCustomerRepository.class);
        counters = mock(CommerceCounterService.class);
        audit = mock(CommerceAuditService.class);
        cipher = mock(CommerceFieldCipher.class);
        service = new SupplierService(suppliers, secrets, ledger, heads, customers, counters, audit, cipher,
                mock(PlatformTransactionManager.class));
        when(suppliers.saveAndFlush(any())).thenAnswer(inv -> {
            CommerceSupplier s = inv.getArgument(0);
            if (s != null && s.getVersion() == null) {
                s.setVersion(0L);
            }
            return s;
        });
        when(suppliers.findByInstituteIdAndClientRequestId(anyString(), anyString())).thenReturn(Optional.empty());
        when(counters.nextNumber(INST, "S")).thenReturn("S-000001", "S-000002");
        when(cipher.isConfigured()).thenReturn(true);
        when(cipher.activeKeyId()).thenReturn("k1");
        when(cipher.encrypt(anyString(), anyString())).thenReturn("cfc1:k1:sealed");
        when(cipher.keyedHash(anyString(), anyString(), anyString())).thenReturn("ab".repeat(32));
    }

    private static SupplierRequest request() {
        SupplierRequest r = SupplierRulesTest.base();
        r.setClientRequestId("create-key-0001");
        return r;
    }

    private static CommerceSupplier stored(String id) {
        CommerceSupplier s = new CommerceSupplier();
        s.setId(id);
        s.setInstituteId(INST);
        s.setCode("S-000009");
        s.setName("Sample Traders");
        s.setStateCode("27");
        s.setSearchText("sample traders s-000009");
        s.setVersion(3L);
        return s;
    }

    private static DataIntegrityViolationException duplicate(String constraint) {
        return new DataIntegrityViolationException("duplicate key",
                new ConstraintViolationException("duplicate key", new SQLException("duplicate key"), constraint));
    }

    private static CommerceSupplierLedgerRepository.SupplierSum sum(String id, String amount) {
        return new CommerceSupplierLedgerRepository.SupplierSum() {
            @Override
            public String getSupplierId() {
                return id;
            }

            @Override
            public BigDecimal getBalance() {
                return new BigDecimal(amount);
            }
        };
    }

    /** Every argument passed to the audit mock, as text. */
    private List<String> auditArguments() {
        List<String> out = new ArrayList<>();
        mockingDetails(audit).getInvocations().forEach(inv -> {
            for (Object arg : inv.getArguments()) {
                out.add(String.valueOf(arg));
            }
        });
        return out;
    }

    private static int status(Runnable call) {
        return assertThrows(VacademyException.class, call::run).getStatus().value();
    }

    // ── Create ──────────────────────────────────────────────────────────────

    @Test
    void generatedCodeIsTheNextCounterNumber() {
        SupplierView view = service.create(INST, ACTOR, request());
        ArgumentCaptor<CommerceSupplier> saved = ArgumentCaptor.forClass(CommerceSupplier.class);
        verify(suppliers).saveAndFlush(saved.capture());
        CommerceSupplier s = saved.getValue();
        assertEquals("S-000001", s.getCode());
        assertEquals("S-000001", view.getCode());
        assertEquals(36, s.getId().length());
        assertEquals(0L, s.getVersion());
        assertEquals("ACTIVE", s.getStatus());
        assertEquals("create-key-0001", s.getClientRequestId());
        assertEquals(64, s.getRequestHash().length());
        assertEquals(ACTOR, s.getCreatedBy());
        assertEquals("test supplier one s-000001", s.getSearchText());
        assertEquals("0.00", view.getBalance());
        assertFalse(view.isHasPan());
        assertNull(view.getPanMasked());
        verify(audit).record(eq(INST), eq(ACTOR), isNull(), eq(AccountsAuditKinds.SUPPLIER_CREATE),
                eq("SUPPLIER"), eq(s.getId()), isNull(), anyString(), isNull());
    }

    @Test
    void typedCodeIsUpperCasedAndAClashIs409() {
        SupplierRequest r = request();
        r.setCode("st-1");
        when(suppliers.saveAndFlush(any())).thenThrow(duplicate("uq_commerce_supplier_code"));
        ConflictException e = assertThrows(ConflictException.class, () -> service.create(INST, ACTOR, r));
        assertTrue(e.getMessage().startsWith("DUPLICATE_CODE: "));
        verify(counters, never()).nextNumber(anyString(), anyString());
        verify(suppliers, times(1)).saveAndFlush(any());
    }

    @Test
    void generatedCodeThatClashesWithATypedCodeTakesTheNextNumberOnce() {
        when(suppliers.saveAndFlush(any())).thenThrow(duplicate("uq_commerce_supplier_code"))
                .thenAnswer(inv -> inv.getArgument(0));
        assertEquals("S-000002", service.create(INST, ACTOR, request()).getCode());

        when(suppliers.saveAndFlush(any())).thenThrow(duplicate("uq_commerce_supplier_code"));
        when(counters.nextNumber(INST, "S")).thenReturn("S-000003", "S-000004");
        ConflictException e = assertThrows(ConflictException.class, () -> service.create(INST, ACTOR, request()));
        assertTrue(e.getMessage().startsWith("DUPLICATE_CODE: "));
    }

    @Test
    void externalRefClashIs409() {
        SupplierRequest r = request();
        r.setExternalRef("EXT-1");
        when(suppliers.saveAndFlush(any())).thenThrow(duplicate("uq_commerce_supplier_external_ref"));
        ConflictException e = assertThrows(ConflictException.class, () -> service.create(INST, ACTOR, r));
        assertTrue(e.getMessage().startsWith("DUPLICATE_EXTERNAL_REF: "));
    }

    @Test
    void createReplayWithTheSameBodyAnswersTheFirstSupplierAndAnotherBodyIs409() {
        SupplierRequest r = request();
        r.setPan(PAN);
        SupplierView first = service.create(INST, ACTOR, r);
        ArgumentCaptor<CommerceSupplier> saved = ArgumentCaptor.forClass(CommerceSupplier.class);
        verify(suppliers).saveAndFlush(saved.capture());
        when(suppliers.findByInstituteIdAndClientRequestId(INST, "create-key-0001"))
                .thenReturn(Optional.of(saved.getValue()));

        SupplierRequest again = request();
        again.setName("  Test Supplier One ");
        again.setPan(PAN.toLowerCase());
        // Whitespace in a text field is part of the body: a different body.
        assertThrows(ConflictException.class, () -> service.create(INST, ACTOR, again));

        SupplierRequest same = request();
        same.setPan(PAN);
        assertEquals(first.getId(), service.create(INST, ACTOR, same).getId());
        verify(suppliers, times(1)).saveAndFlush(any());

        // The hash does not hold the PAN itself: another PAN under the same key is the same body.
        SupplierRequest otherPan = request();
        otherPan.setPan(TestGstin.pan("BBBPZ", 4321, 'D'));
        assertEquals(first.getId(), service.create(INST, ACTOR, otherPan).getId());
        assertFalse(saved.getValue().getRequestHash().contains(PAN));

        SupplierRequest other = request();
        other.setCity("Another City");
        other.setPan(PAN);
        ConflictException e = assertThrows(ConflictException.class, () -> service.create(INST, ACTOR, other));
        assertTrue(e.getMessage().startsWith("IDEMPOTENCY_MISMATCH: "));
    }

    @Test
    void createNeedsAClientKey() {
        SupplierRequest r = request();
        r.setClientRequestId("short");
        assertThrows(InvalidRequestException.class, () -> service.create(INST, ACTOR, r));
        verifyNoInteractions(suppliers);
    }

    @Test
    void doubleTapThatLosesTheKeyAnswersTheWinner() {
        CommerceSupplier winner = stored("sup-w");
        SupplierRequest r = request();
        service.create(INST, ACTOR, r);
        ArgumentCaptor<CommerceSupplier> saved = ArgumentCaptor.forClass(CommerceSupplier.class);
        verify(suppliers).saveAndFlush(saved.capture());
        winner.setRequestHash(saved.getValue().getRequestHash());
        when(suppliers.saveAndFlush(any())).thenThrow(duplicate("uq_commerce_supplier_client_request"));
        when(suppliers.findByInstituteIdAndClientRequestId(INST, "create-key-0001"))
                .thenReturn(Optional.empty(), Optional.of(winner));
        assertEquals("sup-w", service.create(INST, ACTOR, request()).getId());
    }

    // ── PAN and the cipher ──────────────────────────────────────────────────

    @Test
    void panIsEncryptedWithTheSupplierIdInTheAdditionalData() {
        SupplierRequest r = request();
        r.setPan(PAN);
        SupplierView view = service.create(INST, ACTOR, r);
        verify(cipher).encrypt(PAN, CommerceFieldCipher.aad(INST, view.getId(), "pan"));
        verify(cipher).keyedHash("pan", INST, PAN);
        verify(secrets).upsert(anyString(), eq(INST), eq(view.getId()), eq("cfc1:k1:sealed"), eq("k1"),
                eq("ab".repeat(32)), eq(PAN.substring(6)), eq(ACTOR));
        assertEquals("******" + PAN.substring(6), view.getPanMasked());
        assertTrue(view.isHasPan());
    }

    @Test
    void panWithoutKeyIs503AndWritesNothing() {
        when(cipher.isConfigured()).thenReturn(false);
        SupplierRequest r = request();
        r.setPan(PAN);
        VacademyException e = assertThrows(VacademyException.class, () -> service.create(INST, ACTOR, r));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        assertTrue(e.getMessage().startsWith("ENCRYPTION_NOT_CONFIGURED: "));
        assertFalse(e.getMessage().contains(PAN));
        verifyNoInteractions(suppliers, secrets, audit, counters);

        SupplierRequest edit = SupplierRulesTest.base();
        edit.setVersion(3L);
        edit.setPan(PAN);
        assertEquals(503, status(() -> service.update(INST, ACTOR, "sup-1", edit)));
        verifyNoInteractions(suppliers, secrets, audit, counters);
    }

    @Test
    void supplierWithoutPanSavesWithoutKey() {
        when(cipher.isConfigured()).thenReturn(false);
        SupplierView view = service.create(INST, ACTOR, request());
        assertEquals("S-000001", view.getCode());
        verify(cipher, never()).encrypt(anyString(), anyString());
        verify(secrets, never()).upsert(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void removingPanNeedsNoKey() {
        when(cipher.isConfigured()).thenReturn(false);
        CommerceSupplier s = stored("sup-1");
        when(suppliers.findByInstituteIdAndId(INST, "sup-1")).thenReturn(Optional.of(s));
        when(secrets.findLast4(INST, "sup-1")).thenReturn(Optional.of("234C"));
        SupplierRequest edit = SupplierRulesTest.base();
        edit.setName("Sample Traders");
        edit.setVersion(3L);
        edit.setPan("");
        SupplierView view = service.update(INST, ACTOR, "sup-1", edit);
        verify(secrets).deleteByInstituteIdAndSupplierId(INST, "sup-1");
        assertNull(view.getPanMasked());
        assertFalse(view.isHasPan());
        verify(cipher, never()).encrypt(anyString(), anyString());
        ArgumentCaptor<String> newJson = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> oldJson = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq(INST), eq(ACTOR), isNull(), eq(AccountsAuditKinds.SUPPLIER_EDIT), eq("SUPPLIER"),
                eq("sup-1"), oldJson.capture(), newJson.capture(), isNull());
        assertTrue(oldJson.getValue().contains("\"pan_masked\":\"******234C\""));
        assertTrue(newJson.getValue().contains("\"pan_masked\":null"));
    }

    @Test
    void auditJsonHoldsTheMaskOnlyForCreateEditAndStatus() {
        SupplierRequest r = request();
        // A GSTIN carries a PAN in plain text by law; this one carries another PAN than the one stored.
        r.setGstin(TestGstin.valid("27", TestGstin.pan("CCCPZ", 1111, 'E')));
        r.setPan(PAN);
        SupplierView created = service.create(INST, ACTOR, r);

        CommerceSupplier s = stored(created.getId());
        when(suppliers.findByInstituteIdAndId(INST, created.getId())).thenReturn(Optional.of(s));
        when(secrets.findLast4(INST, created.getId())).thenReturn(Optional.of(PAN.substring(6)));
        SupplierRequest edit = SupplierRulesTest.base();
        edit.setVersion(3L);
        edit.setPan(TestGstin.pan("BBBPZ", 4321, 'D'));
        service.update(INST, ACTOR, created.getId(), edit);

        StatusRequest st = new StatusRequest();
        st.setStatus("INACTIVE");
        st.setReason("no longer used");
        service.setStatus(INST, ACTOR, created.getId(), st);

        verify(audit, times(3)).record(any(), any(), any(), any(), any(), any(), any(), any(), any());
        List<String> args = auditArguments();
        String joined = String.join("|", args);
        assertFalse(joined.contains(PAN), "a full PAN reached the audit");
        assertFalse(joined.contains(TestGstin.pan("BBBPZ", 4321, 'D')), "a full PAN reached the audit");
        assertFalse(joined.contains("cfc1:"));
        assertFalse(joined.contains("ab".repeat(32)));
        assertTrue(joined.contains("******" + PAN.substring(6)));
        assertTrue(joined.contains("\"status\":\"INACTIVE\""));
        assertTrue(joined.contains("no longer used"));
    }

    @Test
    void listLookupAndDetailNeverTouchCipherOrSecretEntity() {
        CommerceSupplier s = stored("sup-1");
        when(suppliers.search(eq(INST), any(), any(), any(), any(), anyBoolean(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(s)));
        when(suppliers.lookup(eq(INST), anyString(), any(Pageable.class))).thenReturn(List.of(s));
        when(suppliers.findByInstituteIdAndId(INST, "sup-1")).thenReturn(Optional.of(s));
        when(secrets.findLast4(INST, "sup-1")).thenReturn(Optional.of("234C"));

        service.list(INST, "sample", null, null, false, 0, 50);
        service.lookup(INST, "sam");
        service.groups(INST);
        SupplierView detail = service.get(INST, "sup-1");

        assertEquals("******234C", detail.getPanMasked());
        verifyNoInteractions(cipher);
        verify(secrets, atLeastOnce()).findLast4(INST, "sup-1");
        verifyNoMoreInteractions(secrets);
    }

    // ── Edit and status ─────────────────────────────────────────────────────

    @Test
    void editWithAStaleVersionIs409() {
        when(suppliers.findByInstituteIdAndId(INST, "sup-1")).thenReturn(Optional.of(stored("sup-1")));
        SupplierRequest edit = SupplierRulesTest.base();
        edit.setVersion(2L);
        ConflictException e = assertThrows(ConflictException.class, () -> service.update(INST, ACTOR, "sup-1", edit));
        assertTrue(e.getMessage().startsWith("SUPPLIER_CHANGED: "));
        verify(suppliers, never()).saveAndFlush(any());

        edit.setVersion(3L);
        when(suppliers.saveAndFlush(any())).thenThrow(new ObjectOptimisticLockingFailureException(CommerceSupplier.class, "sup-1"));
        e = assertThrows(ConflictException.class, () -> service.update(INST, ACTOR, "sup-1", edit));
        assertTrue(e.getMessage().startsWith("SUPPLIER_CHANGED: "));

        SupplierRequest noVersion = SupplierRulesTest.base();
        assertThrows(InvalidRequestException.class, () -> service.update(INST, ACTOR, "sup-1", noVersion));
    }

    @Test
    void editAuditsChangedFieldsOnlyAndKeepsTheCodeWhenBlank() {
        CommerceSupplier s = stored("sup-1");
        when(suppliers.findByInstituteIdAndId(INST, "sup-1")).thenReturn(Optional.of(s));
        SupplierRequest edit = SupplierRulesTest.base();
        edit.setName("Sample Traders");
        edit.setCity("Test City");
        edit.setVersion(3L);
        SupplierView view = service.update(INST, ACTOR, "sup-1", edit);
        assertEquals("S-000009", view.getCode());
        ArgumentCaptor<String> oldJson = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> newJson = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq(INST), eq(ACTOR), isNull(), eq(AccountsAuditKinds.SUPPLIER_EDIT), eq("SUPPLIER"),
                eq("sup-1"), oldJson.capture(), newJson.capture(), isNull());
        assertEquals("{\"city\":null,\"pincode\":null}", oldJson.getValue());
        assertEquals("{\"city\":\"Test City\",\"pincode\":\"100001\"}", newJson.getValue());
        assertEquals(ACTOR, s.getUpdatedBy());
    }

    @Test
    void editThatChangesNothingWritesNoAudit() {
        CommerceSupplier s = stored("sup-1");
        s.setCity("Test City");
        s.setPincode("100001");
        when(suppliers.findByInstituteIdAndId(INST, "sup-1")).thenReturn(Optional.of(s));
        SupplierRequest edit = SupplierRulesTest.base();
        edit.setName("Sample Traders");
        edit.setVersion(3L);
        service.update(INST, ACTOR, "sup-1", edit);
        verifyNoInteractions(audit);
        verify(suppliers, never()).saveAndFlush(any());
    }

    @Test
    void sameStatusChangesNothing() {
        CommerceSupplier s = stored("sup-1");
        when(suppliers.findByInstituteIdAndId(INST, "sup-1")).thenReturn(Optional.of(s));
        StatusRequest st = new StatusRequest();
        st.setStatus("active");
        assertEquals("ACTIVE", service.setStatus(INST, ACTOR, "sup-1", st).getStatus());
        verifyNoInteractions(audit);
        st.setReason("r".repeat(501));
        assertThrows(InvalidRequestException.class, () -> service.setStatus(INST, ACTOR, "sup-1", st));
    }

    @Test
    void anotherInstitutesIdIs404() {
        when(suppliers.findByInstituteIdAndId(eq(INST), anyString())).thenReturn(Optional.empty());
        SupplierRequest edit = SupplierRulesTest.base();
        edit.setVersion(1L);
        StatusRequest st = new StatusRequest();
        st.setStatus("INACTIVE");
        assertEquals(404, status(() -> service.get(INST, "sup-of-inst-2")));
        assertEquals(404, status(() -> service.update(INST, ACTOR, "sup-of-inst-2", edit)));
        assertEquals(404, status(() -> service.setStatus(INST, ACTOR, "sup-of-inst-2", st)));
        assertEquals(404, status(() -> service.get(INST, "x".repeat(37))));
        verifyNoInteractions(audit);
    }

    // ── References ──────────────────────────────────────────────────────────

    private static CommerceAccountHead head(String nature, String status) {
        CommerceAccountHead h = new CommerceAccountHead();
        h.setId("head-1");
        h.setInstituteId(INST);
        h.setNature(nature);
        h.setStatus(status);
        return h;
    }

    @Test
    void defaultHeadMustBeAnActiveExpenseHeadOfTheInstitute() {
        SupplierRequest r = request();
        r.setDefaultHeadId("head-1");
        when(heads.findByInstituteIdAndId(INST, "head-1")).thenReturn(Optional.of(head("INCOME", "ACTIVE")));
        assertThrows(InvalidRequestException.class, () -> service.create(INST, ACTOR, r));
        when(heads.findByInstituteIdAndId(INST, "head-1")).thenReturn(Optional.of(head("EXPENSE", "INACTIVE")));
        assertThrows(InvalidRequestException.class, () -> service.create(INST, ACTOR, r));
        when(heads.findByInstituteIdAndId(INST, "head-1")).thenReturn(Optional.empty());
        assertEquals(404, status(() -> service.create(INST, ACTOR, r)));
        verify(suppliers, never()).saveAndFlush(any());
        when(heads.findByInstituteIdAndId(INST, "head-1")).thenReturn(Optional.of(head("EXPENSE", "ACTIVE")));
        assertEquals("head-1", service.create(INST, ACTOR, r).getDefaultHeadId());
    }

    @Test
    void linkedCustomerMustBeOfTheInstitute() {
        SupplierRequest r = request();
        r.setCustomerId("cust-1");
        when(customers.findByIdAndInstituteId("cust-1", INST)).thenReturn(Optional.empty());
        assertEquals(404, status(() -> service.create(INST, ACTOR, r)));
        verify(suppliers, never()).saveAndFlush(any());
    }

    @Test
    void duplicateGstinIsAWarningNamingTheOtherSupplier() {
        CommerceSupplier other = stored("sup-9");
        when(suppliers.findByInstituteIdAndGstinAndIdNot(eq(INST), eq(GSTIN), anyString())).thenReturn(List.of(other));
        SupplierRequest r = request();
        r.setGstin(GSTIN);
        SupplierView view = service.create(INST, ACTOR, r);
        assertEquals(1, view.getWarnings().size());
        assertEquals("GSTIN_USED_BY", view.getWarnings().get(0).getCode());
        assertEquals("sup-9", view.getWarnings().get(0).getSupplierId());
        assertEquals("S-000009", view.getWarnings().get(0).getCodeOfOther());
        assertEquals("Sample Traders", view.getWarnings().get(0).getNameOfOther());
    }

    // ── List ────────────────────────────────────────────────────────────────

    @Test
    void listBalanceComesFromOneGroupedSumAndAMissingSupplierIsZero() {
        CommerceSupplier a = stored("sup-a");
        CommerceSupplier b = stored("sup-b");
        when(suppliers.search(eq(INST), any(), any(), any(), any(), anyBoolean(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(a, b)));
        when(ledger.sumBySupplierIds(eq(INST), anyCollection())).thenReturn(List.of(sum("sup-a", "1250.5")));
        Page<SupplierRow> page = service.list(INST, null, null, null, false, 0, 50);
        assertEquals("1250.50", page.getContent().get(0).getBalance());
        assertEquals("0.00", page.getContent().get(1).getBalance());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<String>> ids = ArgumentCaptor.forClass(Collection.class);
        verify(ledger, times(1)).sumBySupplierIds(eq(INST), ids.capture());
        assertEquals(List.of("sup-a", "sup-b"), new ArrayList<>(ids.getValue()));
    }

    @Test
    void emptyPageMakesNoSumQuery() {
        when(suppliers.search(eq(INST), any(), any(), any(), any(), anyBoolean(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of()));
        service.list(INST, null, null, null, false, 0, 50);
        verifyNoInteractions(ledger);
    }

    @Test
    void listFiltersPassThrough() {
        when(suppliers.search(eq(INST), any(), any(), any(), any(), anyBoolean(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of()));
        service.list(INST, " 50%_x ", "service_provider", null, true, 0, 50);
        verify(suppliers).search(eq(INST), eq("ACTIVE"), eq("SERVICE_PROVIDER"), eq("%50\\%\\_x%"), eq("50%_x"),
                eq(true), any(Pageable.class));
        service.list(INST, null, null, "all", false, 1, 100);
        verify(suppliers).search(eq(INST), isNull(), isNull(), isNull(), isNull(), eq(false), any(Pageable.class));
        service.list(INST, null, null, "inactive", false, 0, 10);
        verify(suppliers).search(eq(INST), eq("INACTIVE"), isNull(), isNull(), isNull(), eq(false), any(Pageable.class));
        assertThrows(InvalidRequestException.class, () -> service.list(INST, null, null, null, false, 0, 101));
        assertThrows(InvalidRequestException.class, () -> service.list(INST, "q".repeat(101), null, null, false, 0, 10));
        assertThrows(InvalidRequestException.class, () -> service.list(INST, null, null, "GONE", false, 0, 10));
        assertThrows(InvalidRequestException.class, () -> service.list(INST, null, "bad group", null, false, 0, 10));
    }

    @Test
    void lookupNeedsAQueryAndGroupsAddTheStandardOnes() {
        assertThrows(InvalidRequestException.class, () -> service.lookup(INST, " "));
        assertThrows(InvalidRequestException.class, () -> service.lookup(INST, "q".repeat(101)));
        when(suppliers.distinctGroupCodes(INST)).thenReturn(List.of("OTHER", "WORKER"));
        assertEquals(List.of("SUPPLIER", "SERVICE_PROVIDER", "OTHER", "WORKER"), service.groups(INST));
        when(suppliers.lookup(eq(INST), eq("%sam%"), any(Pageable.class))).thenReturn(List.of(stored("sup-1")));
        assertEquals("sup-1", service.lookup(INST, "Sam").get(0).getId());
        ArgumentCaptor<Pageable> top = ArgumentCaptor.forClass(Pageable.class);
        verify(suppliers).lookup(eq(INST), eq("%sam%"), top.capture());
        assertEquals(20, top.getValue().getPageSize());
    }

    @Test
    void moneyHasTwoPlacesAndTheMaskIsSixStars() {
        assertEquals("12.30", SupplierService.money(new BigDecimal("12.3")));
        assertEquals("0.00", SupplierService.money(null));
        assertEquals("-5.00", SupplierService.money(new BigDecimal("-5")));
        assertNull(SupplierService.mask(null));
        assertEquals("******234C", SupplierService.mask("234C"));
    }
}
