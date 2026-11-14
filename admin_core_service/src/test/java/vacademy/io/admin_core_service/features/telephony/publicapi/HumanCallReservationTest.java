package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.telephony.core.CallLifecycleTxOps;
import vacademy.io.admin_core_service.features.telephony.core.CallOrchestrator;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.HumanCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.HumanCallApiCallRepository;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Two clicks a moment apart must not both pass "counsellor not on a call" before either
 * inserted its call row. The reservation takes the counsellor's and the number's advisory
 * locks first, then runs the checks and both inserts in the same transaction; the dial is
 * not part of it. (The locking itself is Postgres's; these tests pin the order and scope.)
 */
class HumanCallReservationTest {

    private final HumanCallApiCallRepository calls = mock(HumanCallApiCallRepository.class);
    private final HumanCallGuards guards = mock(HumanCallGuards.class);
    private final CallLifecycleTxOps callTx = mock(CallLifecycleTxOps.class);
    private final HumanCallReservation reservation = new HumanCallReservation(calls, guards, callTx);
    private final CallLifecycleTxOps.DialTarget target =
            new CallLifecycleTxOps.DialTarget(null, "u", "+919876543210", "API_CONTACT", "hcall_1");

    HumanCallReservationTest() {
        when(calls.saveAndFlush(any())).thenAnswer(i -> i.getArgument(0));
        when(callTx.prepareAndPersistForCounsellor(anyString(), anyString(), any()))
                .thenReturn(new CallOrchestrator.Prepared("log-1", "EXOTEL", null, null, null, null));
    }

    private static HumanCallApiCall row(String idem) {
        return HumanCallApiCall.builder().id("hcall_1").instituteId("inst-1").counsellorUserId("c-1")
                .phoneNumber("+91 98765 43210").idempotencyKey(idem).build();
    }

    @Test
    void locksComeFirstThenTheChecksThenBothInserts() {
        HumanCallReservation.Reserved r = reservation.reserve(row(null), "EXOTEL", 3, target, null);
        InOrder order = inOrder(calls, guards, callTx);
        order.verify(calls).advisoryXactLock("human-call:counsellor:inst-1:c-1");
        order.verify(calls).advisoryXactLock("human-call:number:inst-1:9876543210");
        order.verify(guards).requireCounsellorFree("inst-1", "c-1", "EXOTEL");
        order.verify(guards).requireNumberAllowed(eq("inst-1"), eq("+91 98765 43210"), any(), eq(3));
        order.verify(calls).saveAndFlush(any());
        order.verify(callTx).prepareAndPersistForCounsellor("inst-1", "c-1", target);
        order.verify(calls).setDialed("hcall_1", "log-1", "EXOTEL", null);
        assertEquals("log-1", r.prepared().callLogId());
        assertNull(r.prior());
    }

    @Test
    void theNumberLockIgnoresFormatting() {
        assertEquals(HumanCallReservation.numberLockKey("inst-1", "+919876543210"),
                HumanCallReservation.numberLockKey("inst-1", "+91 98765-43210"));
        assertNotEquals(HumanCallReservation.numberLockKey("inst-1", "+919876543210"),
                HumanCallReservation.numberLockKey("inst-2", "+919876543210"));
    }

    @Test
    void aBusyCounsellorInsertsNothing() {
        doThrow(new AiCallingApiException(HttpStatus.CONFLICT, "counsellor_busy", "busy"))
                .when(guards).requireCounsellorFree(any(), any(), any());
        assertThrows(AiCallingApiException.class, () -> reservation.reserve(row(null), "EXOTEL", 3, target, null));
        verify(calls, never()).saveAndFlush(any());
        verifyNoInteractions(callTx);
    }

    @Test
    void aRetryThatWaitedOnTheLockFindsTheFirstCall() {
        HumanCallApiCall first = row("k-1");
        when(calls.findByInstituteIdAndIdempotencyKey("inst-1", "k-1")).thenReturn(Optional.of(first));
        HumanCallReservation.Reserved r = reservation.reserve(row("k-1"), "EXOTEL", 3, target, null);
        assertSame(first, r.prior());
        verify(calls, times(2)).advisoryXactLock(anyString());
        verifyNoInteractions(guards, callTx);
        verify(calls, never()).saveAndFlush(any());
    }

    @Test
    void theReservationIsOneTransaction() throws Exception {
        assertNotNull(HumanCallReservation.class.getMethod("reserve", HumanCallApiCall.class, String.class, int.class,
                CallLifecycleTxOps.DialTarget.class, String.class).getAnnotation(Transactional.class));
    }
}
