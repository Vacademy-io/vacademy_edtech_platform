package vacademy.io.admin_core_service.features.commerce.accounts.ledger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.repository.CrudRepository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplierLedgerEntry;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.SupplierLedgerType;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierLedgerRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierRepository;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The supplier ledger post: shape, sign, reversal arithmetic and the one-row-per-key rule. */
class SupplierLedgerServiceTest {

    private static final String INST = "inst-1";
    private static final String SUP = "sup-1";
    private static final LocalDate DAY = LocalDate.of(2026, 10, 15);

    private CommerceSupplierLedgerRepository ledger;
    private CommerceSupplierRepository suppliers;
    private StockLocationRepository locations;
    private SupplierLedgerService service;
    private final AtomicReference<CommerceSupplierLedgerEntry> inserted = new AtomicReference<>();

    @BeforeEach
    void setUp() {
        ledger = mock(CommerceSupplierLedgerRepository.class);
        suppliers = mock(CommerceSupplierRepository.class);
        locations = mock(StockLocationRepository.class);
        service = new SupplierLedgerService(ledger, suppliers, locations);
        when(suppliers.lockForPosting(INST, SUP)).thenReturn(Optional.of(SUP));
        when(ledger.findByInstituteIdAndIdempotencyKey(anyString(), anyString())).thenReturn(Optional.empty());
        when(ledger.sumReversalsOf(anyString(), anyString())).thenReturn(BigDecimal.ZERO);
        // The insert records the row; the read by id answers it, as the database would.
        when(ledger.insertIfAbsent(anyString(), anyString(), anyString(), any(), anyString(), any(), any(), any(),
                any(), any(), any(), any(), any(), anyString())).thenAnswer(inv -> {
                    CommerceSupplierLedgerEntry e = new CommerceSupplierLedgerEntry();
                    e.setId(inv.getArgument(0));
                    e.setInstituteId(inv.getArgument(1));
                    e.setSupplierId(inv.getArgument(2));
                    e.setBookDate(inv.getArgument(3));
                    e.setType(inv.getArgument(4));
                    e.setAmount(inv.getArgument(5));
                    e.setReferenceType(inv.getArgument(6));
                    e.setReferenceId(inv.getArgument(7));
                    e.setReversesEntryId(inv.getArgument(12));
                    e.setIdempotencyKey(inv.getArgument(13));
                    inserted.set(e);
                    return 1;
                });
        when(ledger.findByInstituteIdAndId(eq(INST), anyString())).thenAnswer(inv -> {
            CommerceSupplierLedgerEntry e = inserted.get();
            return e != null && e.getId().equals(inv.getArgument(1)) ? Optional.of(e) : Optional.empty();
        });
    }

    private static SupplierLedgerPost post(SupplierLedgerType type, String amount, String key) {
        return post(type, amount, key, null);
    }

    private static SupplierLedgerPost post(SupplierLedgerType type, String amount, String key, String reverses) {
        return new SupplierLedgerPost(INST, SUP, DAY, type, amount == null ? null : new BigDecimal(amount),
                "PURCHASE_BILL", "doc-1", "B-1", null, null, "user-1", reverses, key);
    }

    private static String validationMessage(Runnable call) {
        InvalidRequestException e = assertThrows(InvalidRequestException.class, call::run);
        assertTrue(e.getMessage().startsWith("VALIDATION: "), e.getMessage());
        return e.getMessage();
    }

    // ------------------------------------------------------------------ shape and sign

    @Test
    void signTablePerType() {
        int n = 0;
        for (SupplierLedgerType type : SupplierLedgerType.values()) {
            boolean positiveOk = switch (type) {
                case DEBIT_NOTE, PAYMENT, TDS -> false;
                default -> true;
            };
            boolean negativeOk = switch (type) {
                case BILL, EXPENSE, REFUND_RECEIVED -> false;
                default -> true;
            };
            String plusKey = "K_" + type.name().substring(0, Math.min(10, type.name().length())) + ":p" + n;
            String minusKey = "K_" + type.name().substring(0, Math.min(10, type.name().length())) + ":m" + n;
            n++;
            if (positiveOk) {
                assertTrue(service.post(post(type, "100.00", plusKey)).created(), type + " +");
            } else {
                String msg = validationMessage(() -> service.post(post(type, "100.00", plusKey)));
                assertTrue(msg.contains(type + " must be negative"), msg);
            }
            if (negativeOk) {
                assertTrue(service.post(post(type, "-100.00", minusKey)).created(), type + " -");
            } else {
                String msg = validationMessage(() -> service.post(post(type, "-100.00", minusKey)));
                assertTrue(msg.contains(type + " must be positive"), msg);
            }
        }
    }

    @Test
    void zeroThreePlacesAndOverMaxAre400() {
        validationMessage(() -> service.post(post(SupplierLedgerType.BILL, "0.00", "BILL:a")));
        validationMessage(() -> service.post(post(SupplierLedgerType.BILL, "10.005", "BILL:a")));
        validationMessage(() -> service.post(post(SupplierLedgerType.BILL, "10000000000.00", "BILL:a")));
        validationMessage(() -> service.post(post(SupplierLedgerType.OPENING, "-10000000000.00", "OPENING:a")));
        verify(ledger, never()).insertIfAbsent(anyString(), anyString(), anyString(), any(), anyString(), any(), any(),
                any(), any(), any(), any(), any(), any(), anyString());
    }

    @Test
    void trailingZerosAndTheMaximumAreAccepted() {
        assertEquals(new BigDecimal("10.50"),
                service.post(post(SupplierLedgerType.BILL, "10.500", "BILL:a")).entry().getAmount());
        assertTrue(service.post(post(SupplierLedgerType.BILL, "9999999999.99", "BILL:b")).created());
        assertEquals(new BigDecimal("7.00"),
                service.post(post(SupplierLedgerType.BILL, "7", "BILL:c")).entry().getAmount());
    }

    @Test
    void requiredFieldsAndKeyShape() {
        validationMessage(() -> service.post(post(SupplierLedgerType.BILL, null, "BILL:a")));
        validationMessage(() -> service.post(post(SupplierLedgerType.BILL, "1", null)));
        validationMessage(() -> service.post(post(null, "1", "BILL:a")));
        validationMessage(() -> service.post(new SupplierLedgerPost(INST, SUP, null, SupplierLedgerType.BILL,
                BigDecimal.ONE, null, null, null, null, null, null, null, "BILL:a")));
        validationMessage(() -> service.post(new SupplierLedgerPost(INST, " ", DAY, SupplierLedgerType.BILL,
                BigDecimal.ONE, null, null, null, null, null, null, null, "BILL:a")));
        validationMessage(() -> service.post(new SupplierLedgerPost(null, SUP, DAY, SupplierLedgerType.BILL,
                BigDecimal.ONE, null, null, null, null, null, null, null, "BILL:a")));
        for (String bad : new String[]{"bill:a", "BILL", "BILL:", "B:a", "BILL:a b", "BILL:a/b",
                "ABCDEFGHIJKLMNOPQRSTU:a", "BILL:" + "x".repeat(80)}) {
            validationMessage(() -> service.post(post(SupplierLedgerType.BILL, "1", bad)));
        }
        for (String good : new String[]{"BILL:abc-1:r2", "PAY:9f1c.x_y", "OPENING:src-1", "AB:" + "x".repeat(79)}) {
            assertDoesNotThrow(() -> service.post(post(SupplierLedgerType.BILL, "1", good)), good);
        }
    }

    @Test
    void aLocationOfAnotherInstituteIsRefusedBeforeAnything() {
        SupplierLedgerPost other = new SupplierLedgerPost(INST, SUP, DAY, SupplierLedgerType.BILL, BigDecimal.ONE,
                null, null, null, "loc-of-inst-2", null, "user-1", null, "BILL:loc1");
        VacademyException e = assertThrows(VacademyException.class, () -> service.post(other));
        assertEquals(404, e.getStatus().value());
        assertTrue(e.getMessage().startsWith("NOT_FOUND: no such location"), e.getMessage());
        verify(suppliers, never()).lockForPosting(anyString(), anyString());
        verify(ledger, never()).insertIfAbsent(anyString(), anyString(), anyString(), any(), anyString(), any(), any(),
                any(), any(), any(), any(), any(), any(), anyString());

        when(locations.findByInstituteIdAndId(INST, "loc-1")).thenReturn(Optional.of(new StockLocation()));
        assertDoesNotThrow(() -> service.post(new SupplierLedgerPost(INST, SUP, DAY, SupplierLedgerType.BILL,
                BigDecimal.ONE, null, null, null, "loc-1", null, "user-1", null, "BILL:loc2")));
    }

    @Test
    void theSupplierLockDoesNotBlockForeignKeyChecks() throws Exception {
        org.springframework.data.jpa.repository.Query q = CommerceSupplierRepository.class
                .getMethod("lockForPosting", String.class, String.class)
                .getAnnotation(org.springframework.data.jpa.repository.Query.class);
        String sql = q.value().replaceAll("\\s+", " ");
        assertTrue(sql.endsWith(" FOR NO KEY UPDATE"), sql);
    }

    @Test
    void lengthLimits() {
        validationMessage(() -> service.post(new SupplierLedgerPost(INST, SUP, DAY, SupplierLedgerType.BILL,
                BigDecimal.ONE, "R".repeat(33), null, null, null, null, null, null, "BILL:a")));
        validationMessage(() -> service.post(new SupplierLedgerPost(INST, SUP, DAY, SupplierLedgerType.BILL,
                BigDecimal.ONE, null, "r".repeat(37), null, null, null, null, null, "BILL:a")));
        validationMessage(() -> service.post(new SupplierLedgerPost(INST, SUP, DAY, SupplierLedgerType.BILL,
                BigDecimal.ONE, null, null, "d".repeat(65), null, null, null, null, "BILL:a")));
        validationMessage(() -> service.post(new SupplierLedgerPost(INST, SUP, DAY, SupplierLedgerType.BILL,
                BigDecimal.ONE, null, null, null, null, "n".repeat(501), null, null, "BILL:a")));
        assertDoesNotThrow(() -> service.post(new SupplierLedgerPost(INST, SUP, DAY, SupplierLedgerType.BILL,
                BigDecimal.ONE, "R".repeat(32), "r".repeat(36), "d".repeat(64), null, "n".repeat(500), null, null,
                "BILL:a")));
    }

    @Test
    void supplierOfAnotherInstituteIs404AndWritesNothing() {
        when(suppliers.lockForPosting("inst-2", SUP)).thenReturn(Optional.empty());
        VacademyException e = assertThrows(VacademyException.class, () -> service.post(new SupplierLedgerPost(
                "inst-2", SUP, DAY, SupplierLedgerType.BILL, BigDecimal.TEN, null, null, null, null, null, null, null,
                "BILL:a")));
        assertTrue(e.getMessage().startsWith("NOT_FOUND"), e.getMessage());
        verify(ledger, never()).insertIfAbsent(anyString(), anyString(), anyString(), any(), anyString(), any(), any(),
                any(), any(), any(), any(), any(), any(), anyString());
    }

    @Test
    void theSupplierIsLockedBeforeAnythingIsReadOrWritten() {
        service.post(post(SupplierLedgerType.BILL, "5", "BILL:a"));
        var order = org.mockito.Mockito.inOrder(suppliers, ledger);
        order.verify(suppliers).lockForPosting(INST, SUP);
        order.verify(ledger).findByInstituteIdAndIdempotencyKey(INST, "BILL:a");
        order.verify(ledger).insertIfAbsent(anyString(), eq(INST), eq(SUP), eq(DAY), eq("BILL"), any(), any(), any(),
                any(), any(), any(), any(), any(), eq("BILL:a"));
    }

    @Test
    void inactiveSupplierMayStillBePosted() {
        // lockForPosting does not filter by status: a supplier made INACTIVE keeps its ledger.
        assertTrue(service.post(post(SupplierLedgerType.PAYMENT, "-5", "PAY:a")).created());
    }

    // ------------------------------------------------------------------ reversal

    private CommerceSupplierLedgerEntry original(String id, String type, String amount, String reverses) {
        CommerceSupplierLedgerEntry e = new CommerceSupplierLedgerEntry();
        e.setId(id);
        e.setInstituteId(INST);
        e.setSupplierId(SUP);
        e.setType(type);
        e.setAmount(new BigDecimal(amount));
        e.setReversesEntryId(reverses);
        when(ledger.findByInstituteIdAndId(INST, id)).thenReturn(Optional.of(e));
        return e;
    }

    private static String reversalMessage(Runnable call) {
        ConflictException e = assertThrows(ConflictException.class, call::run);
        assertTrue(e.getMessage().startsWith("INVALID_REVERSAL: "), e.getMessage());
        return e.getMessage();
    }

    @Test
    void reversalRules() {
        original("bill-1", "BILL", "1000.00", null);
        // Opposite sign required (a positive "reversal" of a positive bill).
        reversalMessage(() -> service.post(post(SupplierLedgerType.BILL, "100", "BILL:bill-1:r1", "bill-1")));
        // Same type.
        reversalMessage(() -> service.post(post(SupplierLedgerType.PAYMENT, "-100", "BILL:bill-1:r1", "bill-1")));
        // Unknown original (or another institute's).
        reversalMessage(() -> service.post(post(SupplierLedgerType.BILL, "-100", "BILL:x:r1", "missing")));
        // Another supplier's row.
        CommerceSupplierLedgerEntry other = original("bill-2", "BILL", "1000.00", null);
        other.setSupplierId("sup-2");
        reversalMessage(() -> service.post(post(SupplierLedgerType.BILL, "-100", "BILL:bill-2:r1", "bill-2")));
        // Not a reversal of a reversal.
        original("rev-1", "BILL", "-100.00", "bill-1");
        reversalMessage(() -> service.post(post(SupplierLedgerType.BILL, "100", "BILL:rev-1:r1", "rev-1")));
        verify(ledger, never()).insertIfAbsent(anyString(), anyString(), anyString(), any(), anyString(), any(), any(),
                any(), any(), any(), any(), any(), any(), anyString());
    }

    @Test
    void cumulativeReversalsCannotExceedTheOriginal() {
        original("bill-1", "BILL", "1000.00", null);
        when(ledger.sumReversalsOf(INST, "bill-1")).thenReturn(new BigDecimal("-600.00"));
        String msg = reversalMessage(() -> service.post(post(SupplierLedgerType.BILL, "-400.01", "BILL:bill-1:r2",
                "bill-1")));
        assertTrue(msg.contains("400.00"), msg);
        SupplierLedgerResult ok = service.post(post(SupplierLedgerType.BILL, "-400.00", "BILL:bill-1:r2", "bill-1"));
        assertTrue(ok.created());
        assertEquals("bill-1", ok.entry().getReversesEntryId());
    }

    @Test
    void aReversalSkipsTheSignTable() {
        // Reversing a payment is positive although PAYMENT rows are negative.
        original("pay-1", "PAYMENT", "-500.00", null);
        assertTrue(service.post(post(SupplierLedgerType.PAYMENT, "500", "PAY:pay-1:r1", "pay-1")).created());
    }

    // ------------------------------------------------------------------ repeat

    @Test
    void repeatSameContentAnswersFirstRowAndInsertsOnce() {
        SupplierLedgerResult first = service.post(post(SupplierLedgerType.OPENING, "1000", "OPENING:a"));
        assertTrue(first.created());
        when(ledger.findByInstituteIdAndIdempotencyKey(INST, "OPENING:a")).thenReturn(Optional.of(first.entry()));

        SupplierLedgerResult again = service.post(post(SupplierLedgerType.OPENING, "1000.00", "OPENING:a"));
        assertFalse(again.created());
        assertSame(first.entry(), again.entry());
        verify(ledger, times(1)).insertIfAbsent(anyString(), anyString(), anyString(), any(), anyString(), any(),
                any(), any(), any(), any(), any(), any(), any(), anyString());
    }

    @Test
    void repeatOfAFullReversalIsAnsweredNotRefused() {
        original("bill-1", "BILL", "100.00", null);
        SupplierLedgerResult first = service.post(post(SupplierLedgerType.BILL, "-100", "BILL:bill-1:r1", "bill-1"));
        when(ledger.findByInstituteIdAndIdempotencyKey(INST, "BILL:bill-1:r1")).thenReturn(Optional.of(first.entry()));
        when(ledger.sumReversalsOf(INST, "bill-1")).thenReturn(new BigDecimal("-100.00"));
        assertFalse(service.post(post(SupplierLedgerType.BILL, "-100", "BILL:bill-1:r1", "bill-1")).created());
    }

    @Test
    void repeatOtherContentIs409() {
        SupplierLedgerResult first = service.post(post(SupplierLedgerType.OPENING, "1000", "OPENING:a"));
        when(ledger.findByInstituteIdAndIdempotencyKey(INST, "OPENING:a")).thenReturn(Optional.of(first.entry()));
        for (SupplierLedgerPost other : new SupplierLedgerPost[]{
                post(SupplierLedgerType.OPENING, "-1000", "OPENING:a"),
                post(SupplierLedgerType.SETTLEMENT, "1000", "OPENING:a"),
                new SupplierLedgerPost(INST, SUP, DAY.plusDays(1), SupplierLedgerType.OPENING, new BigDecimal("1000"),
                        "PURCHASE_BILL", "doc-1", "B-1", null, null, "user-1", null, "OPENING:a"),
                new SupplierLedgerPost(INST, SUP, DAY, SupplierLedgerType.OPENING, new BigDecimal("1000"),
                        "PURCHASE_BILL", "doc-2", "B-1", null, null, "user-1", null, "OPENING:a")}) {
            ConflictException e = assertThrows(ConflictException.class, () -> service.post(other));
            assertTrue(e.getMessage().startsWith("IDEMPOTENCY_KEY_REUSED: "), e.getMessage());
        }
        verify(ledger, times(1)).insertIfAbsent(anyString(), anyString(), anyString(), any(), anyString(), any(),
                any(), any(), any(), any(), any(), any(), any(), anyString());
    }

    @Test
    void keyTakenWhileWaitingIsAnsweredFromTheCommittedRow() {
        CommerceSupplierLedgerEntry committed = new CommerceSupplierLedgerEntry();
        committed.setId("first");
        committed.setSupplierId(SUP);
        committed.setType("OPENING");
        committed.setAmount(new BigDecimal("1000.00"));
        committed.setBookDate(DAY);
        committed.setReferenceType("PURCHASE_BILL");
        committed.setReferenceId("doc-1");
        when(ledger.insertIfAbsent(anyString(), anyString(), anyString(), any(), anyString(), any(), any(), any(),
                any(), any(), any(), any(), any(), anyString())).thenReturn(0);
        when(ledger.findByInstituteIdAndIdempotencyKey(INST, "OPENING:a"))
                .thenReturn(Optional.empty(), Optional.of(committed));
        SupplierLedgerResult result = service.post(post(SupplierLedgerType.OPENING, "1000", "OPENING:a"));
        assertFalse(result.created());
        assertSame(committed, result.entry());
    }

    // ------------------------------------------------------------------ structure

    @Test
    void isMandatoryPropagation() throws NoSuchMethodException {
        Method post = SupplierLedgerService.class.getMethod("post", SupplierLedgerPost.class);
        Transactional tx = post.getAnnotation(Transactional.class);
        assertNotNull(tx);
        assertEquals(Propagation.MANDATORY, tx.propagation());
    }

    @Test
    void repositoryHasNoUpdateOrDeleteMethod() {
        assertFalse(CrudRepository.class.isAssignableFrom(CommerceSupplierLedgerRepository.class));
        for (Method m : CommerceSupplierLedgerRepository.class.getMethods()) {
            String name = m.getName().toLowerCase(Locale.ROOT);
            assertFalse(name.startsWith("save") || name.startsWith("delete") || name.startsWith("update")
                    || name.startsWith("remove") || name.startsWith("merge") || name.startsWith("flush"),
                    "ledger repository exposes " + m.getName());
        }
    }
}
