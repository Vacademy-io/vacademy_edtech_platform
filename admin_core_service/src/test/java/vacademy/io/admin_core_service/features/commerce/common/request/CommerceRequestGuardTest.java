package vacademy.io.admin_core_service.features.commerce.common.request;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Exactly once per client key: the row is inserted first in the change's own transaction; a
 * repeat with the same body is answered from the current state, another body is 409
 * IDEMPOTENCY_MISMATCH; a key lost to a racing request is answered the same way; a change that
 * fails leaves no row, so the key can be sent again.
 */
class CommerceRequestGuardTest {

    private CommerceRequestRepository repository;
    private PlatformTransactionManager transactionManager;
    private CommerceRequestGuard guard;

    @BeforeEach
    void setUp() {
        repository = mock(CommerceRequestRepository.class);
        transactionManager = mock(PlatformTransactionManager.class);
        guard = new CommerceRequestGuard(repository, transactionManager);
    }

    private static CommerceRequestGuard.Key key(String hash) {
        return new CommerceRequestGuard.Key("inst-1", "key-12345678", "SHIPMENT_SHIP", "SHIPMENT", "sh-1", hash,
                "user-1");
    }

    private static CommerceRequest stored(String hash, String action) {
        CommerceRequest row = new CommerceRequest();
        row.setInstituteId("inst-1");
        row.setClientRequestId("key-12345678");
        row.setAction(action);
        row.setRequestHash(hash);
        return row;
    }

    @Test
    void theFirstRequestInsertsItsRowFirstAndRunsTheChangeOnceInANewTransaction() {
        when(repository.findByInstituteIdAndClientRequestId("inst-1", "key-12345678")).thenReturn(Optional.empty());
        List<String> order = new java.util.ArrayList<>();
        when(repository.insert(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString())).thenAnswer(call -> {
                    order.add("insert");
                    return 1;
                });
        CommerceRequestGuard.Outcome<String> outcome = guard.run(key("h1"), () -> {
            order.add("work");
            return "done";
        }, () -> "current");
        assertEquals("done", outcome.value());
        assertFalse(outcome.replayed());
        assertEquals(List.of("insert", "work"), order);
        verify(transactionManager, org.mockito.Mockito.atLeastOnce()).getTransaction(org.mockito.ArgumentMatchers
                .argThat((TransactionDefinition d) -> d.getPropagationBehavior()
                        == TransactionDefinition.PROPAGATION_REQUIRES_NEW));
    }

    @Test
    void aRepeatWithTheSameBodyIsAnsweredFromTheCurrentStateAndChangesNothing() {
        when(repository.findByInstituteIdAndClientRequestId("inst-1", "key-12345678"))
                .thenReturn(Optional.of(stored("h1", "SHIPMENT_SHIP")));
        AtomicInteger work = new AtomicInteger();
        CommerceRequestGuard.Outcome<String> outcome = guard.run(key("h1"), () -> {
            work.incrementAndGet();
            return "done";
        }, () -> "current");
        assertEquals("current", outcome.value());
        assertTrue(outcome.replayed());
        assertEquals(0, work.get());
        verify(repository, never()).insert(anyString(), anyString(), anyString(), anyString(), any(), any(),
                anyString(), any());
    }

    @Test
    void aRepeatWithAnotherBodyOrActionIsIdempotencyMismatch() {
        when(repository.findByInstituteIdAndClientRequestId("inst-1", "key-12345678"))
                .thenReturn(Optional.of(stored("h1", "SHIPMENT_SHIP")));
        ConflictException body = assertThrows(ConflictException.class,
                () -> guard.run(key("h2"), () -> "done", () -> "current"));
        assertTrue(body.getMessage().startsWith("IDEMPOTENCY_MISMATCH"));

        when(repository.findByInstituteIdAndClientRequestId("inst-1", "key-12345678"))
                .thenReturn(Optional.of(stored("h1", "ORDER_TRANSITION")));
        assertThrows(ConflictException.class, () -> guard.run(key("h1"), () -> "done", () -> "current"));
    }

    @Test
    void aKeyLostToARacingRequestIsAnsweredAsARepeat() {
        // First look: no row. The insert then meets the row the other request committed.
        when(repository.findByInstituteIdAndClientRequestId("inst-1", "key-12345678"))
                .thenReturn(Optional.empty(), Optional.of(stored("h1", "SHIPMENT_SHIP")));
        when(repository.insert(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString())).thenThrow(new DataIntegrityViolationException("uq_commerce_request"));
        CommerceRequestGuard.Outcome<String> outcome = guard.run(key("h1"), () -> "done", () -> "current");
        assertTrue(outcome.replayed());
        assertEquals("current", outcome.value());
    }

    @Test
    void anotherConstraintThatRefusesTheChangeIsNotTakenForAReplay() {
        when(repository.findByInstituteIdAndClientRequestId("inst-1", "key-12345678")).thenReturn(Optional.empty());
        DataIntegrityViolationException other = new DataIntegrityViolationException("uq_commerce_shipment_live_order");
        assertSame(other, assertThrows(DataIntegrityViolationException.class, () -> guard.run(key("h1"), () -> {
            throw other;
        }, () -> "current")));
    }

    @Test
    void theClientKeyIs8To64SafeCharacters() {
        assertEquals("abcd-123_X", CommerceRequestGuard.requireClientKey(" abcd-123_X "));
        assertEquals("a".repeat(64), CommerceRequestGuard.requireClientKey("a".repeat(64)));
        for (String bad : new String[]{null, "", "short", "a".repeat(65), "has space1", "colon:12345", "ü-1234567"}) {
            InvalidRequestException e = assertThrows(InvalidRequestException.class,
                    () -> CommerceRequestGuard.requireClientKey(bad), String.valueOf(bad));
            assertTrue(e.getMessage().startsWith("VALIDATION"));
        }
    }

    @Test
    void theHashLeavesOutTheKeyAndIgnoresOrderOfFieldsNullsAndTrailingZeros() {
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("client_request_id", "one-key-1");
        a.put("to_status", "CANCELLED");
        a.put("amount", new BigDecimal("10.50"));
        a.put("note", null);
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("amount", new BigDecimal("10.5"));
        b.put("to_status", "CANCELLED");
        b.put("client_request_id", "another-key-2");
        assertEquals(CommerceRequestGuard.hash("X", a, "order-1"), CommerceRequestGuard.hash("X", b, "order-1"));
        assertNotEquals(CommerceRequestGuard.hash("X", a, "order-1"), CommerceRequestGuard.hash("X", a, "order-2"));
        assertNotEquals(CommerceRequestGuard.hash("X", a, "order-1"), CommerceRequestGuard.hash("Y", a, "order-1"));
        b.put("to_status", "PACKED");
        assertNotEquals(CommerceRequestGuard.hash("X", a, "order-1"), CommerceRequestGuard.hash("X", b, "order-1"));
        assertEquals(64, CommerceRequestGuard.hash("X", null).length());
    }
}
