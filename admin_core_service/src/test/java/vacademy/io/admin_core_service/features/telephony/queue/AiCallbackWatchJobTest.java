package vacademy.io.admin_core_service.features.telephony.queue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.service.EngagementPointsOfContact;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.util.List;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AiCallbackWatchJobTest {

    @Test
    @DisplayName("an unreached callback is marked, put on the timeline and the points of contact are told, once")
    void tellsOnce() {
        AiCallQueueItemRepository repo = mock(AiCallQueueItemRepository.class);
        EngagementPointsOfContact poc = mock(EngagementPointsOfContact.class);
        TimelineEventService timeline = mock(TimelineEventService.class);
        when(repo.findUnreachedEngineCallbacks(any())).thenReturn(List.<Object[]>of(new Object[]{
                "q1", "inst1", "resp1", "user1", "+919968858268", "Priyanshu", "The call was placed but not answered (NO_ANSWER)."}));
        when(repo.markAlerted("q1")).thenReturn(1);
        new AiCallbackWatchJob(repo, poc, timeline).sweep();
        verify(repo).markAlerted("q1");
        verify(timeline).logEvent(eq("AUDIENCE_RESPONSE"), eq("resp1"), eq("AI_CALLBACK"), any(), any(), any(),
                eq("Callback call did not connect"), contains("Please call them"), any(), eq("user1"));
        verify(poc).alert(eq("inst1"), eq("user1"), startsWith("Callback did not connect: Priyanshu"), contains("NO_ANSWER"),
                eq("AI_CALLBACK"), eq("q1"));
    }

    @Test
    @DisplayName("an item another pod already marked is skipped")
    void skipsAlreadyMarked() {
        AiCallQueueItemRepository repo = mock(AiCallQueueItemRepository.class);
        EngagementPointsOfContact poc = mock(EngagementPointsOfContact.class);
        when(repo.findUnreachedEngineCallbacks(any())).thenReturn(List.<Object[]>of(new Object[]{
                "q1", "inst1", "resp1", "user1", "+91", "P", "why"}));
        when(repo.markAlerted("q1")).thenReturn(0);
        new AiCallbackWatchJob(repo, poc, mock(TimelineEventService.class)).sweep();
        verifyNoInteractions(poc);
    }
}
