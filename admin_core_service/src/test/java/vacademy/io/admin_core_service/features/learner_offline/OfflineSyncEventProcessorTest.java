package vacademy.io.admin_core_service.features.learner_offline;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.learner_offline.dto.OfflineSyncEventRequestDTO;
import vacademy.io.admin_core_service.features.learner_offline.dto.OfflineSyncEventResultDTO;
import vacademy.io.admin_core_service.features.learner_offline.entity.OfflineSyncEvent;
import vacademy.io.admin_core_service.features.learner_offline.enums.OfflineSyncEventStatus;
import vacademy.io.admin_core_service.features.learner_offline.repository.OfflineSyncDiscrepancyRepository;
import vacademy.io.admin_core_service.features.learner_offline.repository.OfflineSyncEventRepository;
import vacademy.io.admin_core_service.features.learner_offline.service.*;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.service.AssignmentSlideActivityLogService;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingService;
import vacademy.io.admin_core_service.features.learner_tracking.service.QuestionSlideActivityLogService;
import vacademy.io.admin_core_service.features.learner_tracking.service.QuizSlideActivityLogService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Per-event dedup/retry/stale-guard/re-scoring semantics (offline plan Part A4). */
@ExtendWith(MockitoExtension.class)
class OfflineSyncEventProcessorTest {

    private static final String DEVICE = "dev1";

    @Mock private OfflineSyncEventRepository offlineSyncEventRepository;
    @Mock private OfflineSyncDiscrepancyRepository offlineSyncDiscrepancyRepository;
    @Mock private OfflineQuizRescoringService offlineQuizRescoringService;
    @Mock private OfflineDownloadStateService offlineDownloadStateService;
    @Mock private LearnerTrackingService learnerTrackingService;
    @Mock private QuestionSlideActivityLogService questionSlideActivityLogService;
    @Mock private QuizSlideActivityLogService quizSlideActivityLogService;
    @Mock private AssignmentSlideActivityLogService assignmentSlideActivityLogService;

    private OfflineSyncEventProcessor processor;
    private CustomUserDetails user;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        processor = new OfflineSyncEventProcessor(offlineSyncEventRepository, offlineSyncDiscrepancyRepository,
                offlineQuizRescoringService, offlineDownloadStateService, learnerTrackingService,
                questionSlideActivityLogService, quizSlideActivityLogService, assignmentSlideActivityLogService);
        user = new CustomUserDetails();
    }

    private OfflineSyncEventRequestDTO videoEvent(String clientEventId, long clientTs) throws Exception {
        OfflineSyncEventRequestDTO event = new OfflineSyncEventRequestDTO();
        event.setClientEventId(clientEventId);
        event.setSeq(1L);
        event.setClientTs(clientTs);
        event.setEventType("VIDEO");
        event.setSlideId("slide1");
        event.setPackageSessionId("ps1");
        JsonNode payload = mapper.readTree("{\"new_activity\":true,\"videos\":[]}");
        event.setPayload(payload);
        return event;
    }

    @Test
    @DisplayName("duplicate clientEventId (already ACCEPTED) -> DUPLICATE, no dispatch")
    void duplicateEventNotRedispatched() throws Exception {
        OfflineSyncEventRequestDTO event = videoEvent("evt1", 1000L);
        when(offlineSyncEventRepository.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(0);
        OfflineSyncEvent existing = new OfflineSyncEvent();
        existing.setStatus("ACCEPTED");
        when(offlineSyncEventRepository.findByClientEventId("evt1")).thenReturn(Optional.of(existing));

        OfflineSyncEventResultDTO result = processor.process(event, DEVICE, user);

        assertEquals(OfflineSyncEventStatus.DUPLICATE, result.getStatus());
        verify(learnerTrackingService, never()).addOrUpdateVideoActivityLog(any(), any(), any(), any(), any(), any(),
                any());
    }

    @Test
    @DisplayName("previously FAILED ledger row is re-dispatched on retry and marked ACCEPTED")
    void failedRowRetried() throws Exception {
        OfflineSyncEventRequestDTO event = videoEvent("evt2", 1000L);
        when(offlineSyncEventRepository.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(0);
        OfflineSyncEvent existing = new OfflineSyncEvent();
        existing.setStatus("FAILED");
        when(offlineSyncEventRepository.findByClientEventId("evt2")).thenReturn(Optional.of(existing));
        when(learnerTrackingService.addOrUpdateVideoActivityLog(any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(new ActivityLogDTO());

        OfflineSyncEventResultDTO result = processor.process(event, DEVICE, user);

        assertEquals(OfflineSyncEventStatus.ACCEPTED, result.getStatus());
        verify(learnerTrackingService).addOrUpdateVideoActivityLog(any(), any(), any(), any(), any(), any(), any());
        verify(offlineSyncEventRepository).markAccepted("evt2");
    }

    @Test
    @DisplayName("stale clientTs (older than max accepted for device+slide) suppresses position ops but still dispatches")
    void staleEventSuppressesPositionOps() throws Exception {
        OfflineSyncEventRequestDTO event = videoEvent("evt3", 1000L);
        when(offlineSyncEventRepository.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(1);
        when(offlineSyncEventRepository.findMaxAcceptedClientTs(DEVICE, "slide1"))
                .thenReturn(new Timestamp(5000L));
        when(learnerTrackingService.addOrUpdateVideoActivityLog(any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(new ActivityLogDTO());

        OfflineSyncEventResultDTO result = processor.process(event, DEVICE, user);

        assertEquals(OfflineSyncEventStatus.ACCEPTED, result.getStatus());
        ArgumentCaptor<ActivityLogDTO> captor = ArgumentCaptor.forClass(ActivityLogDTO.class);
        verify(learnerTrackingService).addOrUpdateVideoActivityLog(captor.capture(), eq("slide1"), any(), any(),
                any(), any(), any());
        assertTrue(captor.getValue().isSuppressPositionOps());
        assertTrue(captor.getValue().isOfflineReplay());
    }

    @Test
    @DisplayName("re-scoring overwrites a tampered QUIZ response and writes a discrepancy row")
    void quizRescoringOverwritesAndRecordsDiscrepancy() throws Exception {
        OfflineSyncEventRequestDTO event = new OfflineSyncEventRequestDTO();
        event.setClientEventId("evt4");
        event.setSeq(1L);
        event.setClientTs(1000L);
        event.setEventType("QUIZ");
        event.setSlideId("slide2");
        event.setPackageSessionId("ps1");
        event.setPayload(mapper.readTree("{\"new_activity\":true,\"quiz_sides\":[{\"id\":\"r1\",\"question_id\":\"q1\"}]}"));
        when(offlineSyncEventRepository.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(1);
        when(offlineQuizRescoringService.rescoreQuiz(any())).thenReturn(
                List.of(new OfflineQuizRescoringService.OfflineDiscrepancyRecord("q1", "response_status", "CORRECT",
                        "WRONG")));
        when(quizSlideActivityLogService.addOrUpdateQuizSlideActivityLog(any(), any(), any(), any(), any(), any(),
                any(), any())).thenReturn("activity1");

        OfflineSyncEventResultDTO result = processor.process(event, DEVICE, user);

        assertEquals(OfflineSyncEventStatus.ACCEPTED, result.getStatus());
        verify(offlineSyncDiscrepancyRepository).save(any());
    }

    @Test
    @DisplayName("a QUIZ event with no answers on it records nothing")
    void emptyQuizEventRecordsNothing() throws Exception {
        OfflineSyncEventRequestDTO event = new OfflineSyncEventRequestDTO();
        event.setClientEventId("event-empty");
        event.setEventType("QUIZ");
        event.setSlideId("slide-1");
        event.setPayload(mapper.readTree("{\"new_activity\":true,\"quiz_sides\":[]}"));
        when(offlineSyncEventRepository.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(1);

        processor.process(event, DEVICE, user);

        verifyNoInteractions(quizSlideActivityLogService);
    }
}
