package vacademy.io.admin_core_service.features.commerce.audit;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

class CommerceAuditServiceTest {

    private final CommerceAuditRepository repository = mock(CommerceAuditRepository.class);
    private final CommerceAuditService service = new CommerceAuditService(repository);

    private CommerceAudit saved() {
        ArgumentCaptor<CommerceAudit> captor = ArgumentCaptor.forClass(CommerceAudit.class);
        verify(repository).save(captor.capture());
        return captor.getValue();
    }

    @Test
    void shortFormMapsOntoTheAuditColumns() {
        service.record("inst-1", "user-1", "PRICE_CHANGE", "VARIANT", "ps-1", "{\"price\":120}");
        CommerceAudit row = saved();
        assertEquals("inst-1", row.getInstituteId());
        assertEquals("user-1", row.getActorUserId());
        assertEquals("PRICE_CHANGE", row.getKind());
        assertEquals("VARIANT", row.getReferenceType());
        assertEquals("ps-1", row.getReferenceId());
        assertEquals("{\"price\":120}", row.getNewValueJson());
        assertNull(row.getOldValueJson());
        assertNull(row.getLocationId());
        assertNull(row.getReason());
    }

    @Test
    void fullFormKeepsOldValueLocationAndReason() {
        service.record("inst-1", "user-1", "loc-1", "PRICE_CHANGE", "VARIANT", "ps-1",
                "{\"price\":100}", "{\"price\":120}", "new season");
        CommerceAudit row = saved();
        assertEquals("loc-1", row.getLocationId());
        assertEquals("{\"price\":100}", row.getOldValueJson());
        assertEquals("{\"price\":120}", row.getNewValueJson());
        assertEquals("new season", row.getReason());
    }

    @Test
    void blankDetailIsStoredAsNull() {
        service.record("inst-1", "user-1", "STAFF_PIN_SET", "STAFF", "user-1", " ");
        assertNull(saved().getNewValueJson());
    }

    @Test
    void malformedJsonMissingInstituteAndLongKindAreRefused() {
        assertThrows(IllegalArgumentException.class,
                () -> service.record("inst-1", "user-1", "PRICE_CHANGE", "VARIANT", "ps-1", "{price:"));
        assertThrows(IllegalArgumentException.class,
                () -> service.record(" ", "user-1", "PRICE_CHANGE", "VARIANT", "ps-1", null));
        assertThrows(IllegalArgumentException.class,
                () -> service.record("inst-1", "user-1", "K".repeat(33), "VARIANT", "ps-1", null));
        assertThrows(IllegalArgumentException.class,
                () -> service.record("inst-1", "user-1", null, "VARIANT", "ps-1", null));
        verify(repository, never()).save(any(CommerceAudit.class));
    }
}
