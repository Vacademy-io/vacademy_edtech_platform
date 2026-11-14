package vacademy.io.admin_core_service.features.telephony.queue;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.telephony.core.AiCallService;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallResponseDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.enums.CallTrigger;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentRepository;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiCallQueueItem;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallLaneRepository;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The copy of a claimed item must say what the claim wrote while the dial is in flight.
 *
 * <p>On the manual click that copy is still managed (open-session-in-view), and the
 * call-log insert inside {@code placeCall} flushes it. When it still said QUEUED, that
 * flush un-claimed the item and the next drain tick rang the same lead a second time
 * (call 650b923d / 5f1995d9, 2026-10-23: 81 manual calls placed twice).
 */
class AiCallQueueClaimMirrorTest {

    private static final String INST = "inst-1";

    private AiCallQueueItemRepository repository;
    private AiCallCapacityService capacity;
    private AiCallService aiCallService;
    private AiCallQueueDrainJob job;
    private AiCallQueueItem item;

    @BeforeEach
    void setUp() {
        repository = mock(AiCallQueueItemRepository.class);
        capacity = mock(AiCallCapacityService.class);
        AiCallingSettingsService settingsService = mock(AiCallingSettingsService.class);
        when(settingsService.get(INST)).thenReturn(new AiCallingSettingsPojo());
        AiAgentRepository agents = mock(AiAgentRepository.class);
        when(agents.findIdNameEnabledByInstituteId(INST)).thenReturn(List.of());

        job = new AiCallQueueDrainJob(repository, mock(AiCallLaneRepository.class), capacity,
                mock(AiCallQueueService.class), settingsService, agents);
        aiCallService = mock(AiCallService.class);
        ReflectionTestUtils.setField(job, "aiCallService", aiCallService);

        item = AiCallQueueItem.builder().id("q-1").instituteId(INST).provider("VACADEMY_AI")
                .callTrigger(CallTrigger.MANUAL.name()).status(AiCallQueueStatus.QUEUED.name())
                .attempts(0).priority(200).createdAt(Instant.now()).build();
        when(repository.findById("q-1")).thenReturn(Optional.of(item));
        when(repository.countAheadInLane(eq(INST), anyInt(), any())).thenReturn(0L);
        when(repository.claimForDispatch("q-1")).thenReturn(1);
        when(capacity.snapshot()).thenReturn(new AiCallCapacityService.Snapshot(
                new HashMap<>(), new HashMap<>(), new HashMap<>(Map.of("VACADEMY_AI", 4)), 1, Map.of()));
    }

    @Test
    void theManualFastPathHoldsTheClaimedStatusWhileDialling() {
        AtomicReference<String> statusAtDial = new AtomicReference<>();
        AtomicReference<Integer> attemptsAtDial = new AtomicReference<>();
        when(aiCallService.placeCall(any(), any(), eq(CallTrigger.MANUAL))).thenAnswer(inv -> {
            // What an auto-flush during placeCall would write to the row.
            statusAtDial.set(item.getStatus());
            attemptsAtDial.set(item.getAttempts());
            return AiCallResponseDTO.builder().callLogId("log-1").dispatched(true).build();
        });

        Optional<AiCallResponseDTO> resp = job.dispatchNowIfLineFree("q-1");

        assertTrue(resp.isPresent());
        assertEquals(AiCallQueueStatus.DISPATCHING.name(), statusAtDial.get(),
                "a flush mid-dial must not put the item back in the queue");
        assertEquals(1, attemptsAtDial.get());
        assertEquals(AiCallQueueStatus.DIALED.name(), item.getStatus());
        assertEquals("log-1", item.getCallLogId());
        verify(aiCallService, times(1)).placeCall(any(), any(), any());
    }

    @Test
    void aTollFreeLeadFailsAtOnceAndTheClickerHearsWhy() {
        when(aiCallService.placeCall(any(), any(), any())).thenReturn(AiCallResponseDTO.builder()
                .status(AiCallService.SKIPPED_TOLL_FREE).dispatched(false)
                .providerMessage(AiCallService.TOLL_FREE_MESSAGE).build());

        VacademyException e = assertThrows(VacademyException.class, () -> job.dispatchNowIfLineFree("q-1"));

        assertEquals(AiCallService.TOLL_FREE_MESSAGE, e.getMessage());
        assertEquals(AiCallQueueStatus.FAILED.name(), item.getStatus(), "not re-queued for three refused dials");
        assertNull(item.getNotBefore());
    }

    @Test
    void tollFreeNumbers() {
        for (String n : new String[]{"18001234567", "1800 123 4567", "+91 1800 123 4567", "9118001234567",
                "01800123456", "1800123456", "18601234567"}) {
            assertTrue(AiCallService.isTollFree(n), n);
        }
        for (String n : new String[]{"+919876543210", "9876543210", "919166908033", "08023456789",
                "+918035374489", "1800", "", null}) {
            assertFalse(AiCallService.isTollFree(n), String.valueOf(n));
        }
    }

    @Test
    void aFailedFastPathDialStillGoesBackToTheQueue() {
        when(aiCallService.placeCall(any(), any(), any())).thenThrow(new RuntimeException("plivo down"));

        assertTrue(job.dispatchNowIfLineFree("q-1").isEmpty());

        assertEquals(AiCallQueueStatus.QUEUED.name(), item.getStatus());
        assertEquals(1, item.getAttempts());
        assertNotNull(item.getNotBefore());
    }
}
